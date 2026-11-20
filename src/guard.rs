//! Guard: link ve küfür engeli.
//! Yasak mesaj silinir, yazan susturulur (zaman aşımı), kanalda birkaç saniye görünen bir uyarı gider, log kanalına
//! kayıt düşülür. Kısa sürede çok ihlal eden atılır, atıldıktan sonra devam eden banlanır (ayarlar/mesajlar.json > ceza).
//! Mesajları Yönet ya da Yönetici izni olanlara ve botlara dokunulmaz. Düzenlenen mesaj da denetlenir.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use reqwest::Method;
use serde_json::{json, Value};

use crate::bot::{ad, sonra_sil, Bot};
use crate::filtre;
use crate::metin::doldur;
use crate::onbellek::{izin, uye_rolleri};
use crate::veri::{Ceza, CezaAyari};
use crate::zaman;

const UYARI_ARALIGI_MS: i64 = 10_000;
// Art arda kısa mesajlarla bölünmüş yazım ("Oros", "Pu", "Ço", "Cı").
const PARCA_EN_UZUN: usize = 15;
const PARCA_SURESI_MS: i64 = 15_000;
const PARCA_SAYISI: usize = 10;

#[derive(Clone, Copy, PartialEq)]
enum Tur {
    Link,
    Kufur,
}

impl Tur {
    fn anahtar(self) -> &'static str {
        match self {
            Tur::Link => "link",
            Tur::Kufur => "kufur",
        }
    }
}

struct Karar {
    tur: Tur,
    eslesen: String,
    /// Parçalara bölünmüş küfürde silinecek öbür mesajlar (kanal, mesaj ID'si, içerik).
    parcalar: Vec<(String, String, String)>,
}

#[derive(Clone)]
struct Parca {
    id: String,
    icerik: String,
    zaman: i64,
}

pub struct Guard {
    parcalar: Mutex<HashMap<String, Vec<Parca>>>,
    son_uyari: Mutex<HashMap<String, i64>>,
    susturma_sn: i64,
    uyari_ms: u64,
    ceza: CezaAyari,
}

impl Guard {
    pub fn new(bot: &Bot) -> Self {
        let m = &bot.metin;
        let sayi = |yol: &str, v: f64| m.sayi(yol, v).max(0.0) as i64;
        let pencere_saat = match sayi("ceza.ihlalSuresiSaat", 24.0) {
            0 => 24,
            n => n,
        };
        let hatirlama_gun = match sayi("ceza.atilmaHatirlamaGun", 30.0) {
            0 => 30,
            n => n,
        };
        Self {
            parcalar: Mutex::new(HashMap::new()),
            son_uyari: Mutex::new(HashMap::new()),
            susturma_sn: sayi("susturmaSaniye", 60.0),
            uyari_ms: (match sayi("uyariSilinmeSaniye", 6.0) {
                0 => 6,
                n => n,
            } * 1000) as u64,
            ceza: CezaAyari {
                atma_icin: sayi("ceza.atmaIcinIhlal", 3.0),
                pencere_ms: pencere_saat * 3_600_000,
                ban_icin: sayi("ceza.banIcinIhlal", 2.0),
                hatirlama_ms: hatirlama_gun * 86_400_000,
            },
        }
    }

    fn sure_metni(&self) -> String {
        zaman::saniye_metni(self.susturma_sn)
    }
}

/// Mesajı denetler. duzenlendi: MESSAGE_UPDATE'ten geldiyse (parça birleştirmeye girmez).
pub async fn denetle(bot: &Arc<Bot>, guard: &Guard, mut mesaj: Value, duzenlendi: bool) {
    let Some(sunucu) = mesaj["guild_id"].as_str().map(String::from) else { return };
    // Düzenlemede Micup yalnızca değişen alanları gönderebilir; eksikse mesajın tamamı alınır.
    if mesaj["content"].as_str().is_none() || mesaj["author"]["id"].as_str().is_none() {
        let (Some(k), Some(id)) = (mesaj["channel_id"].as_str(), mesaj["id"].as_str()) else { return };
        match bot.api.get(&format!("/channels/{k}/messages/{id}")).await {
            Ok(mut tam) => {
                tam["guild_id"] = json!(sunucu);
                tam["member"] = mesaj["member"].clone();
                mesaj = tam;
            }
            Err(_) => return,
        }
    }
    let yazar = &mesaj["author"];
    if yazar["bot"].as_bool() == Some(true) {
        return;
    }
    let kullanici = yazar["id"].as_str().unwrap_or_default().to_string();
    let kanal = mesaj["channel_id"].as_str().unwrap_or_default().to_string();
    if mesaj["member"].is_null() {
        if let Ok(uye) = bot.api.get(&format!("/guilds/{sunucu}/members/{kullanici}")).await {
            mesaj["member"] = uye;
        }
    }
    let roller = uye_rolleri(&mesaj["member"]);
    let izinler = bot.onbellek.izinler(&sunucu, &kullanici, &roller);
    if izinler & (izin::MANAGE_MESSAGES | izin::ADMINISTRATOR) != 0 {
        return;
    }
    let icerik = mesaj["content"].as_str().unwrap_or("").to_string();
    let beyaz = |tur: Tur| beyaz_listede(bot, tur, &sunucu, &kullanici, &kanal, &roller);

    let karar = {
        let mut karar = None;
        if !beyaz(Tur::Link) {
            let izinli = bot.panel.read().unwrap().izinli.clone();
            if let Some(link) = filtre::link_bul(&icerik, &izinli) {
                karar = Some(Karar { tur: Tur::Link, eslesen: link, parcalar: Vec::new() });
            }
        }
        if karar.is_none() && !beyaz(Tur::Kufur) {
            if let Some(k) = filtre::kufur_bul(&icerik, &bot.kelimeler) {
                karar = Some(Karar { tur: Tur::Kufur, eslesen: k, parcalar: Vec::new() });
            } else if !duzenlendi {
                let id = mesaj["id"].as_str().unwrap_or_default();
                karar = parca_karari(bot, guard, &kanal, &kullanici, id, &icerik);
            }
        }
        karar
    };
    let Some(karar) = karar else { return };
    uygula(bot, guard, &mesaj, &sunucu, &kanal, &kullanici, karar).await;
}

fn beyaz_listede(bot: &Bot, tur: Tur, sunucu: &str, kullanici: &str, kanal: &str, roller: &[String]) -> bool {
    let panel = bot.panel.read().unwrap();
    let liste = match tur {
        Tur::Link => &panel.beyaz_link,
        Tur::Kufur => &panel.beyaz_kufur,
    };
    if liste.is_empty() {
        return false;
    }
    if liste.contains(kullanici) || liste.contains(kanal) || roller.iter().any(|r| liste.contains(r)) {
        return true;
    }
    // Alt başlıksa üst kanal.
    bot.onbellek.kanal(sunucu, kanal).and_then(|k| k.ust).is_some_and(|ust| liste.contains(&ust))
}

fn parca_karari(bot: &Bot, guard: &Guard, kanal: &str, kullanici: &str, id: &str, icerik: &str) -> Option<Karar> {
    let text = icerik.trim();
    let key = format!("{kanal}:{kullanici}");
    let simdi = zaman::simdi();
    let mut parcalar = guard.parcalar.lock().unwrap();
    if text.is_empty() || text.chars().count() > PARCA_EN_UZUN {
        parcalar.remove(&key);
        return None;
    }
    if parcalar.len() > 5000 {
        parcalar.clear();
    }
    let liste = parcalar.entry(key.clone()).or_default();
    liste.retain(|p| simdi - p.zaman < PARCA_SURESI_MS);
    liste.push(Parca { id: id.to_string(), icerik: icerik.to_string(), zaman: simdi });
    while liste.len() > PARCA_SAYISI {
        liste.remove(0);
    }
    // Son 2, son 3 ... parça: küfür hangi parçadan başlarsa başlasın yakalanır.
    for k in 2..=liste.len() {
        let son = &liste[liste.len() - k..];
        let metinler: Vec<&str> = son.iter().map(|p| p.icerik.as_str()).collect();
        if let Some(eslesen) = filtre::birlesik_bul(&metinler, &bot.kelimeler) {
            let secilen = son.iter().map(|p| (kanal.to_string(), p.id.clone(), p.icerik.clone())).collect();
            parcalar.remove(&key);
            return Some(Karar { tur: Tur::Kufur, eslesen, parcalar: secilen });
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
async fn uygula(bot: &Arc<Bot>, guard: &Guard, mesaj: &Value, sunucu: &str, kanal: &str, kullanici: &str, karar: Karar) {
    let id = mesaj["id"].as_str().unwrap_or_default();
    // Parçalara bölünmüş küfürde öbür parçalar da silinir.
    for (k, m, _) in karar.parcalar.iter().filter(|(_, m, _)| m != id) {
        let _ = bot.api.mesaj_sil(k, m).await;
    }
    if let Err(e) = bot.api.mesaj_sil(kanal, id).await {
        eprintln!("Mesaj silinemedi (#{kanal}): {e} — botun \"Mesajları Yönet\" izni olmalı.");
        return;
    }
    let yazar = &mesaj["author"];
    let sunucu_adi = bot.onbellek.sunucu_adi(sunucu);
    let sure = guard.sure_metni();
    let (kisi, isim, kanal_etiketi) = (format!("<@{kullanici}>"), ad(yazar), format!("<#{kanal}>"));
    let degerler: Vec<(&str, &str)> = vec![
        ("kisi", &kisi),
        ("ad", &isim),
        ("id", kullanici),
        ("kanal", &kanal_etiketi),
        ("sunucu", &sunucu_adi),
        ("sure", &sure),
    ];
    let m = &bot.metin;
    let kullanici_adi = yazar["username"].as_str().unwrap_or("?");

    // Ceza kademesi: üst üste ihlalde atma, atıldıktan sonra devamında ban. Yapılamazsa susturmaya düşer.
    let ceza = bot.veri.ihlal(sunucu, kullanici, zaman::simdi(), guard.ceza);
    if ceza == Ceza::Banla {
        let _ = bot.api.ozel_mesaj(kullanici, &metin_mesaji(&doldur(&m.al("ozelMesaj.banlandi"), &degerler)), &[]).await;
        let sebep = m.al("sebep.ban");
        match bot.api.sebepli(Method::PUT, &format!("/guilds/{sunucu}/bans/{kullanici}"), Some(&json!({})), &sebep).await {
            Ok(_) => {
                bot.veri.banlandi(sunucu, kullanici);
                println!("Banlandı: {kullanici_adi} ({kullanici})");
                duyur(bot, guard, kanal, &doldur(&m.al("banlandi"), &degerler)).await;
                kaldirma_logu(bot, mesaj, &karar, false, &degerler).await;
                bot.guard_logu(&doldur(&m.al("log.banlandi"), &degerler)).await;
                return;
            }
            Err(e) => eprintln!("Banlanamadı ({kullanici}): {e} — botun \"Üyeleri Yasakla\" izni olmalı ve rolü kişininkinden yüksek olmalı."),
        }
    }
    if ceza == Ceza::At {
        let _ = bot.api.ozel_mesaj(kullanici, &metin_mesaji(&doldur(&m.al("ozelMesaj.atildi"), &degerler)), &[]).await;
        let sebep = m.al("sebep.atma");
        match bot.api.sebepli(Method::DELETE, &format!("/guilds/{sunucu}/members/{kullanici}"), None, &sebep).await {
            Ok(_) => {
                bot.veri.atildi(sunucu, kullanici, zaman::simdi());
                println!("Sunucudan atıldı: {kullanici_adi} ({kullanici})");
                duyur(bot, guard, kanal, &doldur(&m.al("atildi"), &degerler)).await;
                kaldirma_logu(bot, mesaj, &karar, false, &degerler).await;
                bot.guard_logu(&doldur(&m.al("log.atildi"), &degerler)).await;
                return;
            }
            Err(e) => eprintln!("Sunucudan atılamadı ({kullanici}): {e} — botun \"Üyeleri At\" izni olmalı ve rolü kişininkinden yüksek olmalı."),
        }
    }
    let susturuldu = sustur(bot, guard, sunucu, kullanici, &mesaj["member"], karar.tur).await;
    let ne = if karar.tur == Tur::Link { "Link" } else { "Küfür" };
    let ek = if susturuldu { format!(", {sure} zaman aşımı") } else { String::new() };
    let kisa: String = karar.eslesen.chars().take(60).collect();
    println!("{ne} silindi{ek}: {kullanici_adi} ({kullanici}) #{kanal} — {kisa}");
    uyar(bot, guard, kanal, kullanici, karar.tur, susturuldu, &degerler).await;
    kaldirma_logu(bot, mesaj, &karar, susturuldu, &degerler).await;
}

fn metin_mesaji(icerik: &str) -> Value {
    json!({"content": icerik, "allowed_mentions": {"parse": []}})
}

/// Kişiye zaman aşımı verir; verildiyse (ya da zaten susturulmuşsa) true.
async fn sustur(bot: &Bot, guard: &Guard, sunucu: &str, kullanici: &str, uye: &Value, tur: Tur) -> bool {
    if guard.susturma_sn == 0 {
        return false;
    }
    let simdi = zaman::simdi();
    if let Some(bitis) = uye["communication_disabled_until"].as_str() {
        if bitis > zaman::iso(simdi).as_str() {
            return true;
        }
    }
    let bitis = zaman::iso(simdi + guard.susturma_sn * 1000);
    let sebep = bot.metin.al(&format!("sebep.susturma.{}", tur.anahtar()));
    let body = json!({"communication_disabled_until": bitis});
    match bot.api.sebepli(Method::PATCH, &format!("/guilds/{sunucu}/members/{kullanici}"), Some(&body), &sebep).await {
        Ok(_) => true,
        Err(e) => {
            eprintln!("Zaman aşımı verilemedi ({kullanici}): {e} — botun \"Üyelere zaman aşımı uygula\" izni olmalı ve rolü kişininkinden yüksek olmalı.");
            false
        }
    }
}

/// Kanalda birkaç saniye görünen duyuru.
async fn duyur(bot: &Arc<Bot>, guard: &Guard, kanal: &str, metin: &str) {
    if let Ok(m) = bot.api.mesaj_gonder(kanal, &metin_mesaji(metin)).await {
        if let Some(id) = m["id"].as_str() {
            sonra_sil(bot, kanal.to_string(), id.to_string(), guard.uyari_ms);
        }
    }
}

async fn uyar(bot: &Arc<Bot>, guard: &Guard, kanal: &str, kullanici: &str, tur: Tur, susturuldu: bool, degerler: &[(&str, &str)]) {
    {
        let key = format!("{kanal}:{kullanici}");
        let mut son = guard.son_uyari.lock().unwrap();
        let simdi = zaman::simdi();
        if simdi - son.get(&key).copied().unwrap_or(0) < UYARI_ARALIGI_MS {
            return;
        }
        if son.len() > 5000 {
            son.clear();
        }
        son.insert(key, simdi);
    }
    let m = &bot.metin;
    let mut metin = doldur(&m.al(&format!("uyari.{}", tur.anahtar())), degerler);
    if susturuldu {
        metin.push_str(&doldur(&m.al("susturuldu"), degerler));
    }
    let body = json!({"content": metin, "allowed_mentions": {"users": [kullanici]}});
    if let Ok(msg) = bot.api.mesaj_gonder(kanal, &body).await {
        if let Some(id) = msg["id"].as_str() {
            sonra_sil(bot, kanal.to_string(), id.to_string(), guard.uyari_ms);
        }
    }
}

async fn kaldirma_logu(bot: &Bot, mesaj: &Value, karar: &Karar, susturuldu: bool, degerler: &[(&str, &str)]) {
    let orijinal = if karar.parcalar.is_empty() {
        mesaj["content"].as_str().unwrap_or("").to_string()
    } else {
        karar.parcalar.iter().map(|(_, _, c)| c.as_str()).collect::<Vec<_>>().join("\n")
    };
    let icerik: String = orijinal.replace('`', "ˋ").chars().take(1500).collect();
    let m = &bot.metin;
    let tur = m.al_ya_da(&format!("log.tur.{}", karar.tur.anahtar()), karar.tur.anahtar());
    let susturma = if susturuldu { doldur(&m.al("log.susturma"), degerler) } else { String::new() };
    let mut hepsi = degerler.to_vec();
    hepsi.push(("tur", &tur));
    hepsi.push(("susturma", &susturma));
    let satir = doldur(&m.al("log.satir"), &hepsi);
    bot.guard_logu(&format!("{satir}\n```\n{icerik}\n```")).await;
}
