//! Destek (ticket) sistemi.
//!
//! Kurulum (Sunucuyu Yönet izni olanlar): /destek-kur kategori | yetkili-ekle | yetkili-cikar | log | limit | panel | durum
//! Ticket içinde (açan kişi ya da yetkili; ekle/çıkar/üstlen yalnızca yetkili):
//!   /destek kapat [sebep] | ekle kullanici | cikar kullanici | ustlen
//! Yasak (yetkili, her kanalda): /destek yasakla kullanici [sebep] [gun] | yasak-kaldir kullanici | yasaklilar
//!
//! Ticket: kategoride "destek-0001" gibi özel kanal; yalnızca açan, yetkili roller ve bot görür.
//! Kapanınca bütün mesajların .txt dökümü açan kişiye özelden ve log kanalına gider, kanal silinir.
//! Metinler ayarlar/mesajlar.json > destek; eksik anahtar için aşağıdaki varsayılan kullanılır.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Method;
use serde_json::{json, Value};

use crate::api::Dosya;
use crate::banner::{self, BannerMetni};
use crate::bot::{ad, Bot};
use crate::etkilesim::{dosyali_mesaj, Etkilesim};
use crate::metin::doldur;
use crate::onbellek::izin;
use crate::veri::{Ticket, Yasak};
use crate::zaman;

const RENK: u32 = 0xe0201e;
const SILME_SN: u64 = 5;
const DOKUM_EN_COK: usize = 10_000;
const EN_COK_LIMIT: i64 = 10;
const TICKET_IZNI: u64 =
    izin::VIEW_CHANNEL | izin::SEND_MESSAGES | izin::READ_MESSAGE_HISTORY | izin::ATTACH_FILES | izin::EMBED_LINKS;

const VARSAYILAN: &[(&str, &str)] = &[
    ("panelBaslik", "🎫 Barbeque Destek"),
    (
        "panelAciklama",
        "Barbeque ile ilgili bir sorun, soru ya da şikayetin mi var?\nAşağıdaki butona bas, sana özel bir destek kanalı açılsın. Yetkililer en kısa sürede ilgilenecek.",
    ),
    ("panelButon", "Destek Talebi Aç"),
    ("bannerUst", "BARBEQUE"),
    ("bannerBaslik", "DESTEK"),
    ("bannerVurgu", "MERKEZİ"),
    ("bannerAltYazi", "Sorun, soru ya da şikayet? Sana özel kanalda yetkililer yardımcı olsun."),
    ("acilisBaslik", "Destek Talebi #{no}"),
    (
        "acilisAciklama",
        "Merhaba {kisi}, destek talebin açıldı.\nSorununu ayrıntılı yaz; ekran görüntüsü varsa ekle. Bir yetkili birazdan seninle ilgilenecek.\n\nİşin bitince **Kapat** butonuna basabilirsin.",
    ),
    ("acilisPing", "{kisi} {roller}"),
    ("butonUstlen", "Üstlen"),
    ("butonUstlenildi", "Üstlenen: {yetkili}"),
    ("butonKapat", "Kapat"),
    ("butonOnay", "Evet, kapat"),
    ("butonVazgec", "Vazgeç"),
    ("acildiCevap", "Destek talebin açıldı: {kanal}"),
    ("limitDolu", "Zaten açık destek talebin var: {kanallar}. Önce onu kapat."),
    ("kurulmamis", "Destek sistemi henüz kurulmamış. Bir yetkiliye haber ver."),
    ("acilamadi", "Destek kanalı açılamadı. Botun \"Kanalları Yönet\" ve \"İzinleri Yönet\" izni olmalı, ayarlanan kategori hâlâ var olmalı."),
    ("ustlenildi", "🙋 {yetkili} bu talebi üstlendi."),
    ("zatenUstlenildi", "Bu talebi zaten {yetkili} üstlenmiş."),
    ("kapatSor", "Bu destek talebini kapatmak istediğine emin misin? Kanal silinecek, döküm sana ve log kanalına gidecek."),
    ("vazgecildi", "Vazgeçildi, talep açık kalıyor."),
    ("kapaniyor", "🔒 Talep {yetkili} tarafından kapatıldı{sebep}. Kanal {saniye} saniye içinde silinecek."),
    ("ozelKapandi", "**{sunucu}** sunucusundaki **#{no}** numaralı destek talebin kapatıldı{sebep}. Konuşmanın dökümü ekte."),
    ("eklendi", "➕ {kullanici} talebe eklendi."),
    ("cikarildi", "➖ {kullanici} talepten çıkarıldı."),
    ("ticketDegil", "Bu komut yalnızca bir destek kanalında kullanılabilir."),
    ("yetkiYok", "Bunu yalnızca destek yetkilileri yapabilir."),
    ("kapatmaYetkiYok", "Bu talebi yalnızca açan kişi ya da bir yetkili kapatabilir."),
    ("logAcildi", "📂 **#{no}** numaralı destek talebi açıldı · {kisi} · {kanal}"),
    ("logBaslik", "📁 Destek Talebi #{no} kapatıldı"),
    ("yasakli", "Destek talebi açman yasaklandı{bitis}.{sebep}"),
    ("yasaklandi", "🚫 {kullanici} destek talebi açmaktan yasaklandı{bitis}.{sebep}"),
    ("yasakKalkti", "✅ {kullanici} için destek talebi yasağı kaldırıldı."),
    ("ozelYasak", "**{sunucu}** sunucusunda destek talebi açman yasaklandı{bitis}.{sebep}"),
];

pub struct Destek {
    aciliyor: Mutex<HashSet<String>>,
    kapaniyor: Mutex<HashSet<String>>,
}

/// Bloğun sonunda kilidi bırakır.
struct Kilit<'a>(&'a Mutex<HashSet<String>>, String);
impl Drop for Kilit<'_> {
    fn drop(&mut self) {
        self.0.lock().unwrap().remove(&self.1);
    }
}
fn kilitle<'a>(set: &'a Mutex<HashSet<String>>, key: &str) -> Option<Kilit<'a>> {
    set.lock().unwrap().insert(key.to_string()).then(|| Kilit(set, key.to_string()))
}

fn t(bot: &Bot, key: &str, degerler: &[(&str, &str)]) -> String {
    let varsayilan = VARSAYILAN.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or("");
    doldur(&bot.metin.al_ya_da(&format!("destek.{key}"), varsayilan), degerler)
}

fn no(n: i64) -> String {
    format!("{n:04}")
}

fn etiket(id: &str) -> String {
    format!("<@{id}>")
}

/// Komut tanımları (Micup'a kaydedilir).
pub fn komutlar() -> Vec<Value> {
    let alt = |ad: &str, aciklama: &str, secenekler: Value| json!({"type": 1, "name": ad, "description": aciklama, "options": secenekler});
    vec![
        json!({
            "name": "destek-kur",
            "description": "Destek (ticket) sistemini ayarla",
            "default_member_permissions": izin::MANAGE_GUILD.to_string(),
            "dm_permission": false,
            "options": [
                alt("kategori", "Ticket kanallarının açılacağı kategori", json!([{"type": 7, "name": "kategori", "description": "Kategori", "required": true, "channel_types": [4]}])),
                alt("yetkili-ekle", "Ticketları görecek yetkili rolü ekle", json!([{"type": 8, "name": "rol", "description": "Yetkili rolü", "required": true}])),
                alt("yetkili-cikar", "Yetkili rolünü çıkar", json!([{"type": 8, "name": "rol", "description": "Yetkili rolü", "required": true}])),
                alt("log", "Ticket kayıtlarının ve dökümlerinin gideceği kanal", json!([{"type": 7, "name": "kanal", "description": "Log kanalı", "required": true, "channel_types": [0]}])),
                alt("limit", "Kişi başı aynı anda açık ticket sayısı", json!([{"type": 4, "name": "sayi", "description": format!("1-{EN_COK_LIMIT}"), "required": true, "min_value": 1, "max_value": EN_COK_LIMIT}])),
                alt("panel", "\"Destek Talebi Aç\" butonlu paneli bir kanala at", json!([{"type": 7, "name": "kanal", "description": "Panelin atılacağı kanal", "required": true, "channel_types": [0]}])),
                alt("durum", "Destek ayarlarını göster", json!([])),
            ],
        }),
        json!({
            "name": "destek",
            "description": "Destek talebi işlemleri",
            "dm_permission": false,
            "options": [
                alt("kapat", "Bu destek talebini kapat", json!([{"type": 3, "name": "sebep", "description": "Kapatma sebebi", "required": false, "max_length": 300}])),
                alt("ekle", "Talebe bir üye ekle", json!([{"type": 6, "name": "kullanici", "description": "Eklenecek üye", "required": true}])),
                alt("cikar", "Talepten bir üyeyi çıkar", json!([{"type": 6, "name": "kullanici", "description": "Çıkarılacak üye", "required": true}])),
                alt("ustlen", "Bu talebi üstlen", json!([])),
                alt("yasakla", "Bir üyenin destek talebi açmasını yasakla", json!([
                    {"type": 6, "name": "kullanici", "description": "Yasaklanacak üye", "required": true},
                    {"type": 3, "name": "sebep", "description": "Yasak sebebi", "required": false, "max_length": 300},
                    {"type": 4, "name": "gun", "description": "Kaç gün (boş = süresiz)", "required": false, "min_value": 1, "max_value": 3650},
                ])),
                alt("yasak-kaldir", "Destek talebi yasağını kaldır", json!([{"type": 6, "name": "kullanici", "description": "Yasağı kaldırılacak üye", "required": true}])),
                alt("yasaklilar", "Destek talebi yasağı olanları listele", json!([])),
            ],
        }),
    ]
}

impl Destek {
    pub fn new() -> Self {
        Self { aciliyor: Mutex::new(HashSet::new()), kapaniyor: Mutex::new(HashSet::new()) }
    }

    /// Bu modülün etkileşimiyse işler ve true döner.
    pub async fn isle(&self, bot: &Arc<Bot>, e: &Etkilesim) -> bool {
        let sonuc = if e.buton_mu() {
            match e.buton() {
                "destek:ac" => self.ac(bot, e).await,
                "destek:ustlen" => self.ustlen(bot, e).await,
                "destek:kapat" => self.kapat_sor(bot, e).await,
                "destek:kapat-onay" => self.kapat(bot, e, None).await,
                "destek:kapat-vazgec" => e.guncelle(&bot.api, json!({"content": t(bot, "vazgecildi", &[]), "components": []})).await,
                _ => return false,
            }
        } else {
            match (e.komut(), e.alt_komut()) {
                ("destek-kur", _) if !e.izin_var(izin::MANAGE_GUILD) => e.fisilda(&bot.api, "Bunun için \"Sunucuyu Yönet\" izni gerekir.").await,
                ("destek-kur", alt) => self.kur(bot, e, alt).await,
                ("destek", "kapat") => self.kapat(bot, e, e.metin("sebep")).await,
                ("destek", "ekle") => self.ekle_cikar(bot, e, true).await,
                ("destek", "cikar") => self.ekle_cikar(bot, e, false).await,
                ("destek", "ustlen") => self.ustlen(bot, e).await,
                ("destek", "yasakla") => self.yasakla(bot, e).await,
                ("destek", "yasak-kaldir") => self.yasak_kaldir(bot, e).await,
                ("destek", "yasaklilar") => self.yasaklilar(bot, e).await,
                _ => return false,
            }
        };
        if let Err(error) = sonuc {
            eprintln!("Destek etkileşimi çalışmadı ({}{}): {error}", e.komut(), e.buton());
            e.hata(&bot.api, "Bir şeyler ters gitti. Birazdan tekrar dene.").await;
        }
        true
    }

    /// Ticket kanalı elle silinirse kaydı da silinir (kişi yeni talep açabilsin).
    pub fn kanal_silindi(&self, bot: &Bot, kanal: &str) {
        if bot.veri.ticket_sil(kanal) {
            println!("Destek kanalı elle silindi, kaydı da silindi ({kanal}).");
        }
    }

    fn yetkili_mi(bot: &Bot, e: &Etkilesim) -> bool {
        if e.izin_var(izin::ADMINISTRATOR | izin::MANAGE_CHANNELS) {
            return true;
        }
        let roller = bot.veri.ayar(&e.sunucu).yetkili_roller;
        e.roller.iter().any(|r| roller.contains(r))
    }

    /// Silinmiş kanallara ait kayıtları temizler (bot kapalıyken elle silinmiş olabilir).
    fn temizle(bot: &Bot, sunucu: &str) {
        for t in bot.veri.ticketlar(sunucu) {
            if bot.onbellek.kanal_var_mi(sunucu, &t.kanal) == Some(false) {
                bot.veri.ticket_sil(&t.kanal);
            }
        }
    }

    fn butonlar(bot: &Bot, ustlenen: Option<&str>) -> Value {
        let ustlen = match ustlenen {
            Some(ad) => {
                let label: String = t(bot, "butonUstlenildi", &[("yetkili", ad)]).chars().take(80).collect();
                json!({"type": 2, "style": 2, "custom_id": "destek:ustlen", "label": label, "emoji": {"name": "🙋"}, "disabled": true})
            }
            None => json!({"type": 2, "style": 3, "custom_id": "destek:ustlen", "label": t(bot, "butonUstlen", &[]), "emoji": {"name": "🙋"}}),
        };
        json!([{"type": 1, "components": [
            ustlen,
            {"type": 2, "style": 4, "custom_id": "destek:kapat", "label": t(bot, "butonKapat", &[]), "emoji": {"name": "🔒"}},
        ]}])
    }

    // ---------- kurulum ----------

    async fn kur(&self, bot: &Arc<Bot>, e: &Etkilesim, alt: &str) -> anyhow::Result<()> {
        let api = &bot.api;
        let g = &e.sunucu;
        match alt {
            "kategori" => {
                let id = e.id("kategori").unwrap_or_default();
                bot.veri.ayar_yaz(g, "kategori", Some(&id))?;
                e.fisilda(api, &format!("Ticketlar artık **{}** kategorisinde açılacak.", e.secilen_kanal_adi(&id))).await
            }
            "yetkili-ekle" | "yetkili-cikar" => {
                let rol = e.id("rol").unwrap_or_default();
                let ekle = alt == "yetkili-ekle";
                if ekle {
                    bot.veri.yetkili_ekle(g, &rol)?;
                } else {
                    bot.veri.yetkili_cikar(g, &rol)?;
                }
                let n = Self::rolu_ticketlara_uygula(bot, g, &rol, ekle).await;
                let metin = if ekle {
                    format!("<@&{rol}> yetkili olarak eklendi. Yeni ticketları ve açık {n} ticketı görecek.")
                } else {
                    format!("<@&{rol}> yetkililerden çıkarıldı; açık {n} ticketdan da izni kaldırıldı.")
                };
                e.fisilda(api, &metin).await
            }
            "log" => {
                let id = e.id("kanal").unwrap_or_default();
                bot.veri.ayar_yaz(g, "log", Some(&id))?;
                e.fisilda(api, &format!("Ticket kayıtları ve dökümleri artık <#{id}> kanalına gidecek.")).await
            }
            "limit" => {
                let n = e.sayi("sayi").unwrap_or(1).clamp(1, EN_COK_LIMIT);
                bot.veri.limit_yaz(g, n)?;
                e.fisilda(api, &format!("Bir kişi aynı anda en fazla **{n}** açık ticket açabilir.")).await
            }
            "panel" => self.panel(bot, e).await,
            "durum" => {
                Self::temizle(bot, g);
                let a = bot.veri.ayar(g);
                let acik = bot.veri.ticketlar(g).len();
                let yasakli = bot.veri.yasaklar(g, zaman::simdi()).len();
                let satirlar = [
                    format!("**Kategori:** {}", a.kategori.map(|k| format!("<#{k}>")).unwrap_or("ayarlanmamış (kanallar kategorisiz açılır)".into())),
                    format!(
                        "**Yetkili roller:** {}",
                        if a.yetkili_roller.is_empty() {
                            "yok (yalnızca Kanalları Yönet izni olanlar)".into()
                        } else {
                            a.yetkili_roller.iter().map(|r| format!("<@&{r}>")).collect::<Vec<_>>().join(", ")
                        }
                    ),
                    format!("**Log kanalı:** {}", a.log.map(|k| format!("<#{k}>")).unwrap_or("ayarlanmamış".into())),
                    format!("**Kişi başı limit:** {}", a.limit),
                    format!("**Panel:** {}", a.panel_kanal.map(|k| format!("<#{k}>")).unwrap_or("atılmamış".into())),
                    format!("**Açık ticket:** {acik} · **Toplam açılan:** {} · **Yasaklı:** {yasakli}", a.sayac),
                ];
                e.gizli_cevap(api, json!({"embeds": [{"color": RENK, "title": "Destek ayarları", "description": satirlar.join("\n")}]})).await
            }
            _ => Ok(()),
        }
    }

    /// Yetkili rol eklenince/çıkarılınca açık ticket kanallarının izinleri de güncellenir.
    async fn rolu_ticketlara_uygula(bot: &Bot, sunucu: &str, rol: &str, ekle: bool) -> usize {
        Self::temizle(bot, sunucu);
        let mut n = 0;
        for t in bot.veri.ticketlar(sunucu) {
            let path = format!("/channels/{}/permissions/{rol}", t.kanal);
            let sonuc = if ekle {
                bot.api.put(&path, &json!({"type": 0, "allow": (TICKET_IZNI | izin::MANAGE_MESSAGES).to_string()})).await
            } else {
                bot.api.delete(&path).await
            };
            match sonuc {
                Ok(_) => n += 1,
                Err(error) => eprintln!("Destek kanalı izni güncellenemedi (#{}): {error}", t.kanal),
            }
        }
        n
    }

    async fn panel(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let kanal = e.id("kanal").unwrap_or_default();
        e.ertele(&bot.api).await?;
        // 16:9 banner: logo + başlık; çizilemezse panel banner'sız (logolu) gider.
        let logo = match bot.logo() {
            Some(url) => logo_indir(&url).await,
            None => None,
        };
        let metin = |k| t(bot, k, &[]);
        let (ust, baslik, vurgu, alt_yazi) = (metin("bannerUst"), metin("bannerBaslik"), metin("bannerVurgu"), metin("bannerAltYazi"));
        let png = {
            let logo = logo.clone();
            tokio::task::spawn_blocking(move || {
                banner::ciz(logo.as_deref(), &BannerMetni { ust: &ust, baslik: &baslik, vurgu: &vurgu, alt_yazi: &alt_yazi })
            })
            .await
            .ok()
            .and_then(|r| r.map_err(|error| eprintln!("Destek banner'ı çizilemedi: {error}")).ok())
        };
        let mut embed = json!({"color": RENK, "title": metin("panelBaslik"), "description": metin("panelAciklama")});
        if png.is_some() {
            embed["image"] = json!({"url": "attachment://destek-banner.png"});
        } else if let Some(url) = bot.logo() {
            embed["thumbnail"] = json!({"url": url});
        }
        let body = json!({
            "embeds": [embed],
            "components": [{"type": 1, "components": [{"type": 2, "style": 1, "custom_id": "destek:ac", "label": metin("panelButon"), "emoji": {"name": "🎫"}}]}],
        });
        let gonderildi = match png {
            Some(png) => dosyali_mesaj(&bot.api, &kanal, &body, &[Dosya { ad: "destek-banner.png".into(), veri: png }]).await,
            None => bot.api.mesaj_gonder(&kanal, &body).await,
        };
        match gonderildi {
            Ok(m) => {
                // Eski panel kanalda kalmasın.
                let eski = bot.veri.ayar(&e.sunucu);
                if let (Some(k), Some(id)) = (eski.panel_kanal, eski.panel_mesaj) {
                    let _ = bot.api.mesaj_sil(&k, &id).await;
                }
                bot.veri.ayar_yaz(&e.sunucu, "panel_kanal", Some(&kanal))?;
                bot.veri.ayar_yaz(&e.sunucu, "panel_mesaj", m["id"].as_str())?;
                e.duzenle(&bot.api, &format!("Panel <#{kanal}> kanalına atıldı.")).await
            }
            Err(error) => {
                eprintln!("Destek paneli atılamadı (#{kanal}): {error}");
                e.duzenle(&bot.api, "Panel atılamadı. Botun o kanalda mesaj gönderme ve dosya ekleme izni olmalı.").await
            }
        }
    }

    // ---------- açma ----------

    async fn ac(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        let (g, uid) = (&e.sunucu, &e.kullanici_id);
        let Some(_kilit) = kilitle(&self.aciliyor, &format!("{g}:{uid}")) else {
            return e.fisilda(api, "Talebin açılıyor, bir saniye...").await;
        };
        if let Some(y) = bot.veri.yasak(g, uid, zaman::simdi()) {
            let (bitis, sebep) = yasak_degerleri(&y);
            return e.fisilda(api, &t(bot, "yasakli", &[("bitis", &bitis), ("sebep", &sebep)])).await;
        }
        let a = bot.veri.ayar(g);
        if a.kategori.is_none() && a.yetkili_roller.is_empty() {
            return e.fisilda(api, &t(bot, "kurulmamis", &[])).await;
        }
        Self::temizle(bot, g);
        let benim: Vec<Ticket> = bot.veri.ticketlar(g).into_iter().filter(|t| &t.sahip == uid).collect();
        if benim.len() as i64 >= a.limit {
            let kanallar = benim.iter().map(|t| format!("<#{}>", t.kanal)).collect::<Vec<_>>().join(", ");
            return e.fisilda(api, &t(bot, "limitDolu", &[("kanallar", &kanallar)])).await;
        }
        e.ertele(api).await?;

        let n = bot.veri.sonraki_no(g)?;
        let bot_id = bot.onbellek.bot.read().unwrap().id.clone();
        let roller: Vec<String> = a.yetkili_roller.iter().filter(|r| bot.onbellek.rol_var_mi(g, r)).cloned().collect();
        let mut izinler = vec![
            json!({"id": g, "type": 0, "deny": izin::VIEW_CHANNEL.to_string(), "allow": "0"}),
            json!({"id": uid, "type": 1, "allow": TICKET_IZNI.to_string(), "deny": "0"}),
        ];
        for r in &roller {
            izinler.push(json!({"id": r, "type": 0, "allow": (TICKET_IZNI | izin::MANAGE_MESSAGES).to_string(), "deny": "0"}));
        }
        if !bot_id.is_empty() {
            let bot_izni = TICKET_IZNI | izin::MANAGE_CHANNELS | izin::MANAGE_MESSAGES | izin::MANAGE_ROLES;
            izinler.push(json!({"id": bot_id, "type": 1, "allow": bot_izni.to_string(), "deny": "0"}));
        }
        let kullanici_adi = e.kullanici["username"].as_str().unwrap_or("?");
        let mut body = json!({
            "name": format!("destek-{}", no(n)),
            "type": 0,
            "topic": format!("Destek talebi #{} · açan: {kullanici_adi} ({uid})", no(n)),
            "permission_overwrites": izinler,
        });
        if let Some(k) = a.kategori.as_ref().filter(|k| bot.onbellek.kanal_var_mi(g, k) != Some(false)) {
            body["parent_id"] = json!(k);
        }
        let sebep = format!("Destek talebi #{}: {kullanici_adi}", no(n));
        let kanal = match bot.api.sebepli(Method::POST, &format!("/guilds/{g}/channels"), Some(&body), &sebep).await {
            Ok(k) => k,
            Err(error) => {
                eprintln!("Destek kanalı açılamadı: {error}");
                return e.duzenle(api, &t(bot, "acilamadi", &[])).await;
            }
        };
        let kanal_id = kanal["id"].as_str().unwrap_or_default().to_string();
        let mut kanal_kaydi = kanal.clone();
        kanal_kaydi["guild_id"] = json!(g);
        bot.onbellek.kanal_ekle(&kanal_kaydi);
        bot.veri.ticket_ekle(&Ticket {
            kanal: kanal_id.clone(),
            sunucu: g.clone(),
            no: n,
            sahip: uid.clone(),
            acildi: zaman::simdi(),
            ustlenen: None,
            ustlenen_ad: None,
            acilis_mesaj: None,
        })?;

        let kisi = etiket(uid);
        let rol_etiketleri = roller.iter().map(|r| format!("<@&{r}>")).collect::<Vec<_>>().join(" ");
        let mut embed = json!({
            "color": RENK,
            "title": t(bot, "acilisBaslik", &[("no", &no(n))]),
            "description": t(bot, "acilisAciklama", &[("kisi", &kisi), ("no", &no(n))]),
            "footer": {"text": format!("{kullanici_adi} · {uid}")},
            "timestamp": zaman::iso(zaman::simdi()),
        });
        if let Some(url) = bot.logo() {
            embed["thumbnail"] = json!({"url": url});
        }
        let ping = t(bot, "acilisPing", &[("kisi", &kisi), ("roller", &rol_etiketleri)]);
        let mut mesaj = json!({
            "embeds": [embed],
            "components": Self::butonlar(bot, None),
            "allowed_mentions": {"users": [uid], "roles": roller},
        });
        if !ping.trim().is_empty() {
            mesaj["content"] = json!(ping.trim());
        }
        match bot.api.mesaj_gonder(&kanal_id, &mesaj).await {
            Ok(m) => {
                if let Some(id) = m["id"].as_str() {
                    bot.veri.acilis_mesaji(&kanal_id, id);
                }
            }
            Err(error) => eprintln!("Destek açılış mesajı gönderilemedi: {error}"),
        }
        println!("Destek talebi açıldı: #{} {kullanici_adi} ({uid})", no(n));
        let kanal_etiketi = format!("<#{kanal_id}>");
        Self::log(bot, g, &t(bot, "logAcildi", &[("no", &no(n)), ("kisi", &kisi), ("kanal", &kanal_etiketi)])).await;
        e.duzenle(api, &t(bot, "acildiCevap", &[("kanal", &kanal_etiketi)])).await
    }

    async fn log(bot: &Bot, sunucu: &str, icerik: &str) {
        if let Some(log) = bot.veri.ayar(sunucu).log {
            let _ = bot.api.mesaj_gonder(&log, &json!({"content": icerik, "allowed_mentions": {"parse": []}})).await;
        }
    }

    // ---------- talep içi ----------

    async fn ticket_mi(bot: &Bot, e: &Etkilesim) -> anyhow::Result<Option<Ticket>> {
        match bot.veri.ticket(&e.kanal) {
            Some(t) => Ok(Some(t)),
            None => {
                e.fisilda(&bot.api, &t(bot, "ticketDegil", &[])).await?;
                Ok(None)
            }
        }
    }

    async fn ustlen(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        let Some(ticket) = Self::ticket_mi(bot, e).await? else { return Ok(()) };
        if !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "yetkiYok", &[])).await;
        }
        let isim = ad(&e.kullanici);
        let kullanici_adi = e.kullanici["username"].as_str().unwrap_or(&isim).to_string();
        if !bot.veri.ustlen(&ticket.kanal, &e.kullanici_id, &kullanici_adi) {
            let kim = bot.veri.ticket(&ticket.kanal).and_then(|t| t.ustlenen).unwrap_or_default();
            return e.fisilda(api, &t(bot, "zatenUstlenildi", &[("yetkili", &etiket(&kim))])).await;
        }
        let duyuru = t(bot, "ustlenildi", &[("yetkili", &etiket(&e.kullanici_id))]);
        if e.buton_mu() {
            e.guncelle(api, json!({"components": Self::butonlar(bot, Some(&isim))})).await?;
            let _ = bot.api.mesaj_gonder(&ticket.kanal, &json!({"content": duyuru, "allowed_mentions": {"parse": []}})).await;
        } else {
            // Slash komutuyla üstlenildiyse açılış mesajındaki buton da güncellensin.
            if let Some(m) = &ticket.acilis_mesaj {
                let _ = bot
                    .api
                    .patch(&format!("/channels/{}/messages/{m}", ticket.kanal), &json!({"components": Self::butonlar(bot, Some(&isim))}))
                    .await;
            }
            e.cevap(api, json!({"content": duyuru})).await?;
        }
        Ok(())
    }

    async fn ekle_cikar(&self, bot: &Arc<Bot>, e: &Etkilesim, ekle: bool) -> anyhow::Result<()> {
        let api = &bot.api;
        let Some(ticket) = Self::ticket_mi(bot, e).await? else { return Ok(()) };
        if !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "yetkiYok", &[])).await;
        }
        let kullanici = e.id("kullanici").unwrap_or_default();
        if !ekle && kullanici == ticket.sahip {
            return e.fisilda(api, "Talebi açan kişi çıkarılamaz; kapatmak için `/destek kapat`.").await;
        }
        let path = format!("/channels/{}/permissions/{kullanici}", ticket.kanal);
        let sonuc = if ekle {
            api.put(&path, &json!({"type": 1, "allow": TICKET_IZNI.to_string(), "deny": "0"})).await
        } else {
            api.delete(&path).await
        };
        if let Err(error) = sonuc {
            eprintln!("Destek kanalı izni değiştirilemedi: {error}");
            return e.fisilda(api, "İzin değiştirilemedi. Botun \"Kanalları Yönet\" / \"İzinleri Yönet\" izni olmalı.").await;
        }
        let k = etiket(&kullanici);
        let metin = t(bot, if ekle { "eklendi" } else { "cikarildi" }, &[("kullanici", &k)]);
        let kimler: Vec<&str> = if ekle { vec![kullanici.as_str()] } else { vec![] };
        e.cevap(api, json!({"content": metin, "allowed_mentions": {"users": kimler}})).await
    }

    // ---------- kapatma ----------

    async fn kapat_sor(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        let Some(ticket) = Self::ticket_mi(bot, e).await? else { return Ok(()) };
        if e.kullanici_id != ticket.sahip && !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "kapatmaYetkiYok", &[])).await;
        }
        e.gizli_cevap(
            api,
            json!({
                "content": t(bot, "kapatSor", &[]),
                "components": [{"type": 1, "components": [
                    {"type": 2, "style": 4, "custom_id": "destek:kapat-onay", "label": t(bot, "butonOnay", &[])},
                    {"type": 2, "style": 2, "custom_id": "destek:kapat-vazgec", "label": t(bot, "butonVazgec", &[])},
                ]}],
            }),
        )
        .await
    }

    async fn kapat(&self, bot: &Arc<Bot>, e: &Etkilesim, sebep: Option<String>) -> anyhow::Result<()> {
        let api = &bot.api;
        let Some(ticket) = Self::ticket_mi(bot, e).await? else { return Ok(()) };
        if e.kullanici_id != ticket.sahip && !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "kapatmaYetkiYok", &[])).await;
        }
        let Some(_kilit) = kilitle(&self.kapaniyor, &ticket.kanal) else {
            return e.fisilda(api, "Talep zaten kapatılıyor.").await;
        };
        let sebep_eki = sebep.as_ref().map(|s| format!(" (sebep: {s})")).unwrap_or_default();
        let kapaniyor = t(
            bot,
            "kapaniyor",
            &[("yetkili", &etiket(&e.kullanici_id)), ("sebep", &sebep_eki), ("saniye", &SILME_SN.to_string())],
        );
        if e.buton_mu() {
            e.guncelle(api, json!({"content": kapaniyor, "components": []})).await?;
            let _ = api.mesaj_gonder(&ticket.kanal, &json!({"content": kapaniyor, "allowed_mentions": {"parse": []}})).await;
        } else {
            e.cevap(api, json!({"content": kapaniyor})).await?;
        }

        let sahip = api.get(&format!("/users/{}", ticket.sahip)).await.ok();
        let mesajlar = tum_mesajlar(bot, &ticket.kanal).await;
        let kanal_adi = bot.onbellek.kanal(&e.sunucu, &ticket.kanal).map(|k| k.ad).unwrap_or_else(|| format!("destek-{}", no(ticket.no)));
        let sunucu_adi = bot.onbellek.sunucu_adi(&e.sunucu);
        let dokum = dokum(&DokumBilgisi {
            sunucu: &sunucu_adi,
            sunucu_id: &e.sunucu,
            kanal_adi: &kanal_adi,
            ticket: &ticket,
            sahip: sahip.as_ref(),
            kapatan: &e.kullanici,
            sebep: sebep.as_deref(),
            mesajlar: &mesajlar,
        });
        let dosya_adi = format!("destek-{}.txt", no(ticket.no));
        let dosya = || Dosya { ad: dosya_adi.clone(), veri: dokum.clone() };

        let a = bot.veri.ayar(&e.sunucu);
        if let Some(log) = &a.log {
            let ustlenen = ticket.ustlenen.as_ref().map(|u| etiket(u)).unwrap_or("-".into());
            let embed = json!({
                "color": RENK,
                "title": t(bot, "logBaslik", &[("no", &no(ticket.no))]),
                "fields": [
                    {"name": "Açan", "value": format!("<@{0}> ({0})", ticket.sahip), "inline": true},
                    {"name": "Kapatan", "value": etiket(&e.kullanici_id), "inline": true},
                    {"name": "Üstlenen", "value": ustlenen, "inline": true},
                    {"name": "Açık kaldığı süre", "value": zaman::sure(zaman::simdi() - ticket.acildi), "inline": true},
                    {"name": "Mesaj", "value": mesajlar.len().to_string(), "inline": true},
                    {"name": "Sebep", "value": sebep.clone().unwrap_or("-".into()), "inline": false},
                ],
                "timestamp": zaman::iso(zaman::simdi()),
            });
            let body = json!({"embeds": [embed], "allowed_mentions": {"parse": []}});
            if let Err(error) = dosyali_mesaj(api, log, &body, &[dosya()]).await {
                eprintln!("Destek logu gönderilemedi: {error}");
            }
        }
        let ozel = t(bot, "ozelKapandi", &[("sunucu", &sunucu_adi), ("no", &no(ticket.no)), ("sebep", &sebep_eki)]);
        // Özel mesajı kapalıysa sessizce geçilir.
        let _ = api.ozel_mesaj(&ticket.sahip, &json!({"content": ozel, "allowed_mentions": {"parse": []}}), &[dosya()]).await;

        bot.veri.ticket_sil(&ticket.kanal);
        println!("Destek talebi kapatıldı: #{} ({}, {} mesaj)", no(ticket.no), e.kullanici["username"].as_str().unwrap_or("?"), mesajlar.len());
        let (bot2, kanal, n) = (bot.clone(), ticket.kanal.clone(), ticket.no);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(SILME_SN)).await;
            let sebep = format!("Destek talebi #{} kapatıldı", no(n));
            if let Err(error) = bot2.api.sebepli(Method::DELETE, &format!("/channels/{kanal}"), None, &sebep).await {
                eprintln!("Destek kanalı silinemedi: {error}");
            }
        });
        Ok(())
    }

    // ---------- yasak ----------

    async fn yasakla(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        if !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "yetkiYok", &[])).await;
        }
        let kullanici = e.id("kullanici").unwrap_or_default();
        if e.secilen_kullanici(&kullanici)["bot"].as_bool() == Some(true) {
            return e.fisilda(api, "Botlar zaten destek talebi açamaz.").await;
        }
        let gun = e.sayi("gun");
        let simdi = zaman::simdi();
        let yasak = Yasak {
            kullanici: kullanici.clone(),
            sebep: e.metin("sebep").unwrap_or_default(),
            yetkili: e.kullanici_id.clone(),
            tarih: simdi,
            bitis: gun.map(|g| simdi + g * 86_400_000),
        };
        bot.veri.yasakla(&e.sunucu, &yasak)?;
        let (bitis, sebep) = yasak_degerleri(&yasak);
        let (k, sunucu) = (etiket(&kullanici), bot.onbellek.sunucu_adi(&e.sunucu));
        let degerler = [("kullanici", k.as_str()), ("sunucu", &sunucu), ("bitis", &bitis), ("sebep", &sebep)];
        let metin = t(bot, "yasaklandi", &degerler);
        e.cevap(api, json!({"content": metin})).await?;
        let _ = api.ozel_mesaj(&kullanici, &json!({"content": t(bot, "ozelYasak", &degerler), "allowed_mentions": {"parse": []}}), &[]).await;
        Self::log(bot, &e.sunucu, &format!("{metin} · yetkili: {}", etiket(&e.kullanici_id))).await;
        println!("Destek yasağı: {kullanici}{}", gun.map(|g| format!(", {g} gün")).unwrap_or(", süresiz".into()));
        Ok(())
    }

    async fn yasak_kaldir(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        if !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "yetkiYok", &[])).await;
        }
        let kullanici = e.id("kullanici").unwrap_or_default();
        if bot.veri.yasak(&e.sunucu, &kullanici, zaman::simdi()).is_none() {
            return e.fisilda(api, "Bu üyenin destek talebi yasağı yok.").await;
        }
        bot.veri.yasak_kaldir(&e.sunucu, &kullanici);
        let metin = t(bot, "yasakKalkti", &[("kullanici", &etiket(&kullanici))]);
        e.cevap(api, json!({"content": metin})).await?;
        Self::log(bot, &e.sunucu, &format!("{metin} · yetkili: {}", etiket(&e.kullanici_id))).await;
        Ok(())
    }

    async fn yasaklilar(&self, bot: &Arc<Bot>, e: &Etkilesim) -> anyhow::Result<()> {
        let api = &bot.api;
        if !Self::yetkili_mi(bot, e) {
            return e.fisilda(api, &t(bot, "yetkiYok", &[])).await;
        }
        let liste = bot.veri.yasaklar(&e.sunucu, zaman::simdi());
        let satirlar: Vec<String> = liste
            .iter()
            .map(|y| {
                let ne_zaman = y.bitis.map(|b| format!("{} tarihine kadar", zaman::tarih(b))).unwrap_or("süresiz".into());
                let sebep = if y.sebep.is_empty() { String::new() } else { format!(" · {}", y.sebep) };
                format!("• <@{}> · {ne_zaman} · <@{}>{sebep}", y.kullanici, y.yetkili)
            })
            .collect();
        let mut govde = if satirlar.is_empty() { "Yasaklı kimse yok.".to_string() } else { satirlar.join("\n") };
        if govde.chars().count() > 3900 {
            govde = govde.chars().take(3900).collect::<String>() + "\n…";
        }
        e.gizli_cevap(api, json!({"embeds": [{"color": RENK, "title": format!("Destek yasakları ({})", liste.len()), "description": govde}]}))
            .await
    }
}

fn yasak_degerleri(y: &Yasak) -> (String, String) {
    let bitis = match y.bitis {
        Some(b) => format!(" ({} tarihine kadar)", zaman::tarih(b)),
        None => " (süresiz)".into(),
    };
    let sebep = if y.sebep.is_empty() { String::new() } else { format!(" Sebep: {}", y.sebep) };
    (bitis, sebep)
}

async fn logo_indir(url: &str) -> Option<Vec<u8>> {
    let res = reqwest::Client::new().get(url).timeout(Duration::from_secs(5)).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.bytes().await.ok().map(|b| b.to_vec())
}

/// Kanaldaki bütün mesajlar, eskiden yeniye.
async fn tum_mesajlar(bot: &Bot, kanal: &str) -> Vec<Value> {
    let mut hepsi: Vec<Value> = Vec::new();
    let mut once: Option<String> = None;
    while hepsi.len() < DOKUM_EN_COK {
        let path = match &once {
            Some(id) => format!("/channels/{kanal}/messages?limit=100&before={id}"),
            None => format!("/channels/{kanal}/messages?limit=100"),
        };
        let Ok(Value::Array(parti)) = bot.api.get(&path).await else { break };
        if parti.is_empty() {
            break;
        }
        let tam = parti.len() == 100;
        once = parti.last().and_then(|m| m["id"].as_str()).map(String::from);
        hepsi.extend(parti);
        if !tam {
            break;
        }
    }
    hepsi.sort_by_key(|m| m["id"].as_str().and_then(|id| id.parse::<u64>().ok()).unwrap_or(0));
    hepsi
}

struct DokumBilgisi<'a> {
    sunucu: &'a str,
    sunucu_id: &'a str,
    kanal_adi: &'a str,
    ticket: &'a Ticket,
    sahip: Option<&'a Value>,
    kapatan: &'a Value,
    sebep: Option<&'a str>,
    mesajlar: &'a [Value],
}

/// .txt dökümü (Windows Not Defteri Türkçe karakterleri doğru göstersin diye BOM'lu, CRLF).
fn dokum(b: &DokumBilgisi) -> Vec<u8> {
    let t = b.ticket;
    let kisi = |u: &Value| format!("{} ({})", u["username"].as_str().unwrap_or("?"), u["id"].as_str().unwrap_or("?"));
    let mut out = vec![
        format!("Barbeque Destek · Talep #{}", no(t.no)),
        format!("Sunucu      : {} ({})", b.sunucu, b.sunucu_id),
        format!("Kanal       : #{} ({})", b.kanal_adi, t.kanal),
        format!("Açan        : {}", b.sahip.map(kisi).unwrap_or_else(|| t.sahip.clone())),
        format!("Açılış      : {}", zaman::tarih(t.acildi)),
        format!(
            "Üstlenen    : {}",
            match (&t.ustlenen_ad, &t.ustlenen) {
                (Some(a), Some(id)) => format!("{a} ({id})"),
                (None, Some(id)) => id.clone(),
                _ => "-".into(),
            }
        ),
        format!("Kapatan     : {}", kisi(b.kapatan)),
        format!("Kapanış     : {}", zaman::tarih(zaman::simdi())),
        format!("Sebep       : {}", b.sebep.unwrap_or("-")),
        format!("Mesaj sayısı: {}", b.mesajlar.len()),
        "=".repeat(60),
        String::new(),
    ];
    for m in b.mesajlar {
        let a = &m["author"];
        let ms = m["id"].as_str().and_then(zaman::snowflake_ms).unwrap_or(0);
        out.push(format!(
            "[{}] {}{} ({}){}",
            zaman::tarih(ms),
            a["username"].as_str().unwrap_or("?"),
            if a["bot"].as_bool() == Some(true) { " [BOT]" } else { "" },
            a["id"].as_str().unwrap_or("?"),
            if m["edited_timestamp"].is_string() { " (düzenlendi)" } else { "" },
        ));
        if let Some(c) = m["content"].as_str().filter(|c| !c.is_empty()) {
            out.extend(c.lines().map(|l| format!("    {l}")));
        }
        for e in m["embeds"].as_array().into_iter().flatten() {
            let mut parcalar: Vec<String> = [&e["title"], &e["description"]].iter().filter_map(|v| v.as_str().map(String::from)).collect();
            for f in e["fields"].as_array().into_iter().flatten() {
                parcalar.push(format!("{}: {}", f["name"].as_str().unwrap_or(""), f["value"].as_str().unwrap_or("")));
            }
            if !parcalar.is_empty() {
                out.push(format!("    [Embed] {}", parcalar.join(" | ").replace('\n', " ")));
            }
        }
        for d in m["attachments"].as_array().into_iter().flatten() {
            out.push(format!("    [Dosya] {} {}", d["filename"].as_str().unwrap_or("?"), d["url"].as_str().unwrap_or("")));
        }
        out.push(String::new());
    }
    let mut bytes = "\u{feff}".as_bytes().to_vec();
    bytes.extend(out.join("\r\n").into_bytes());
    bytes
}

#[cfg(test)]
mod tests {
    /// VARSAYILAN_DOKUM=yol cargo test ile varsayılan metinler JSON olarak yazılır (ayarlar/mesajlar.json > destek için).
    #[test]
    fn varsayilanlar() {
        let mut harita = serde_json::Map::new();
        for (k, v) in super::VARSAYILAN {
            assert!(harita.insert(k.to_string(), serde_json::json!(v)).is_none(), "{k} iki kez");
        }
        if let Ok(yol) = std::env::var("VARSAYILAN_DOKUM") {
            std::fs::write(yol, serde_json::Value::Object(harita).to_string()).unwrap();
        }
    }
}
