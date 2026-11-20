//! Barbeque Destek botu (Lucia): guard (link ve küfür engeli), destek (ticket) sistemi, sunucu bildirimleri, seviye.
//!
//! Ayarlar (bbq-deploy panelinden ajan verir; elle çalıştırırken .env ya da ortam değişkeni):
//!   MICUP_TOKEN       destek botunun token'ı
//!   LOG_CHANNEL_ID    guard kayıtlarının yazılacağı kanal (isteğe bağlı)
//!   ALLOWED_DOMAINS   izinli alan adları, virgülle (vars. micup.gg); davet linkleri her zaman yasak
//!   WHITELIST_LINK    link denetiminden muaf kullanıcı, rol ya da kanal ID'leri, virgülle
//!   WHITELIST_KUFUR   küfür denetiminden muaf kullanıcı, rol ya da kanal ID'leri, virgülle
//!   JOIN_CHANNEL_ID   Barbeque bir sunucuya eklenince yazılacak kanal (isteğe bağlı)
//!   LEAVE_CHANNEL_ID  Barbeque bir sunucudan çıkarılınca yazılacak kanal (isteğe bağlı)

mod api;
mod banner;
mod bildirim;
mod bot;
mod destek;
mod etkilesim;
mod filtre;
mod guard;
mod ipc;
mod metin;
mod onbellek;
mod veri;
mod zaman;

use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::{json, Value};
use twilight_gateway::{CloseFrame, ConfigBuilder, Intents, Message, Shard, ShardId};

use crate::api::Api;
use crate::bot::{bos_degil, id_kumesi, Bot};
use crate::destek::Destek;
use crate::etkilesim::Etkilesim;
use crate::guard::Guard;

const METINLER: &str = "ayarlar/mesajlar.json";
const KUFUR: &str = "ayarlar/kufur.txt";
const VERI: &str = "veri";

/// Gateway'in kapanma kodları: düzelmeden yeniden bağlanmanın anlamı olmayanlar.
fn kapanma_ipucu(kod: u16) -> Option<&'static str> {
    match kod {
        4004 => Some("Token geçersiz. Panelde Destek sayfasına destek botunun token'ını yeniden yapıştır."),
        4013 | 4014 => Some(
            "Micup bu botta mesaj içeriği yetkisine izin vermiyor. Micup > Ayarlar > Uygulamalar > destek botu > Bot bölümünde \"Message Content Intent\" anahtarını aç.",
        ),
        4010..=4012 => Some("Micup bağlantıyı kabul etmedi (shard/sürüm). Bu bir hata; çıktıyı geliştiriciye gönder."),
        _ => None,
    }
}

fn env_dosyasi_oku() {
    // Elle çalıştırırken .env (baslat.js/ajan zaten ortam değişkeni verir).
    let Ok(text) = std::fs::read_to_string(".env") else { return };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if std::env::var_os(k.trim()).is_none() {
                // SAFETY: tek iş parçacığıyken, çalışma zamanı kurulmadan önce çağrılır.
                unsafe { std::env::set_var(k.trim(), v.trim()) };
            }
        }
    }
}

fn main() {
    env_dosyasi_oku();
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio");
    let kod = runtime.block_on(calis());
    std::process::exit(kod);
}

async fn calis() -> i32 {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let Some(token) = std::env::var("MICUP_TOKEN").ok().and_then(|t| bos_degil(&t)) else {
        eprintln!("MICUP_TOKEN yok. Panelde destek botunun token'ını gir (ya da .env dosyasına yaz).");
        return 1;
    };
    let metin = match metin::Metinler::oku(METINLER) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let kelimeler = match std::fs::read_to_string(KUFUR) {
        Ok(t) => filtre::kelimeleri_oku(&t),
        Err(e) => {
            eprintln!("{KUFUR} okunamadı: {e}");
            return 1;
        }
    };
    let veri = match veri::Veri::ac(VERI) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Veritabanı açılamadı ({VERI}/destek.db): {e}");
            return 1;
        }
    };
    let api = Api::new(&token);
    let bot = Arc::new(Bot::new(api, veri, metin, kelimeler));
    {
        let p = bot.panel.read().unwrap();
        println!(
            "Küfür listesi: {} kelime, {} kök, {} desen. İzinli alan adları: {}. Beyaz liste: link {} ID, küfür {} ID.",
            bot.kelimeler.tam.len(),
            bot.kelimeler.kokler.len(),
            bot.kelimeler.desenler.len(),
            if p.izinli.is_empty() { "yok".into() } else { p.izinli.join(", ") },
            p.beyaz_link.len(),
            p.beyaz_kufur.len()
        );
    }
    let guard = Arc::new(Guard::new(&bot));
    let destek = Arc::new(Destek::new());

    // Micup'ın gateway adresi REST'ten alınır (discord.js de böyle yapar).
    let gateway = match bot.api.get("/gateway/bot").await {
        Ok(v) => v["url"].as_str().unwrap_or("wss://gateway.micup.gg").trim_end_matches('/').to_string(),
        Err(e) => {
            let ipucu = if e.downcast_ref::<api::ApiHatasi>().is_some_and(|h| h.durum == 401) {
                kapanma_ipucu(4004).unwrap().to_string()
            } else {
                e.to_string()
            };
            eprintln!("Micup'a bağlanılamadı: {ipucu}");
            return 1;
        }
    };
    let intents = Intents::GUILDS | Intents::GUILD_MESSAGES | Intents::MESSAGE_CONTENT;
    let config = ConfigBuilder::new(token, intents).proxy_url(gateway).build();
    let mut shard = Shard::with_config(ShardId::ONE, config);
    let mut ipc = ipc::dinle();

    loop {
        tokio::select! {
            mesaj = shard.next() => {
                match mesaj {
                    Some(Ok(Message::Text(text))) => olay(&bot, &guard, &destek, &text),
                    Some(Ok(Message::Close(frame))) => {
                        if let Some(frame) = frame {
                            if let Some(ipucu) = kapanma_ipucu(frame.code) {
                                eprintln!("Micup'a bağlanılamadı: {ipucu}");
                                return 1;
                            }
                            eprintln!("Bağlantı kapandı ({} {}), yeniden bağlanılıyor.", frame.code, frame.reason);
                        }
                    }
                    Some(Err(e)) => eprintln!("Bağlantı hatası: {e}"),
                    None => {
                        eprintln!("Bağlantı sonlandı.");
                        return 1;
                    }
                }
            }
            Some(m) = ipc.recv() => {
                if m.as_str() == Some("shutdown") {
                    shard.close(CloseFrame::NORMAL);
                    return 0;
                }
                ajan_mesaji(&bot, &m).await;
            }
            _ = tokio::signal::ctrl_c() => {
                shard.close(CloseFrame::NORMAL);
                return 0;
            }
        }
    }
}

/// Gateway olayı: önbelleği günceller, işi arka plana verir.
fn olay(bot: &Arc<Bot>, guard: &Arc<Guard>, destek: &Arc<Destek>, text: &str) {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return };
    if v["op"].as_u64() != Some(0) {
        return;
    }
    let Some(tur) = v["t"].as_str() else { return };
    let d = v["d"].clone();
    bot.onbellek.olay(tur, &d);
    let (bot, guard, destek) = (bot.clone(), guard.clone(), destek.clone());
    match tur {
        "READY" => {
            tokio::spawn(async move { hazir(&bot).await });
        }
        "MESSAGE_CREATE" => {
            tokio::spawn(async move {
                if d["guild_id"].is_string() && d["author"]["bot"].as_bool() != Some(true) {
                    if let Some(id) = d["author"]["id"].as_str() {
                        bot.veri.mesaj_xp(id, zaman::simdi(), rand::random_range(15..=25));
                    }
                }
                guard::denetle(&bot, &guard, d, false).await;
            });
        }
        "MESSAGE_UPDATE" => {
            tokio::spawn(async move { guard::denetle(&bot, &guard, d, true).await });
        }
        "INTERACTION_CREATE" => {
            tokio::spawn(async move {
                let Some(e) = Etkilesim::oku(d, &bot.onbellek) else { return };
                if bot.tekrar_mi(&e.id) {
                    return;
                }
                destek.isle(&bot, &e).await;
            });
        }
        "CHANNEL_DELETE" => {
            if let Some(id) = d["id"].as_str() {
                destek.kanal_silindi(&bot, id);
            }
        }
        _ => {}
    }
}

async fn hazir(bot: &Arc<Bot>) {
    let (ad, uygulama) = {
        let b = bot.onbellek.bot.read().unwrap();
        (b.ad.clone(), b.uygulama.clone())
    };
    println!("Barbeque Destek hazır: {ad}.");
    // Bütün slash komutları tek seferde kaydedilir; listede olmayan eski komutlar (/account, /profil) Micup'tan silinir.
    let komutlar = Value::Array(destek::komutlar());
    match bot.api.put(&format!("/applications/{uygulama}/commands"), &komutlar).await {
        Ok(_) => println!("Slash komutları kaydedildi: /destek-kur, /destek."),
        Err(e) => eprintln!("Slash komutları kaydedilemedi: {e}"),
    }
    // Ajan bekleyen sunucu bildirimlerini bunu görünce gönderir.
    ipc::gonder(&json!({"type": "ready"}));
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    println!("{} sunucuda.", bot.onbellek.sunucu_sayisi());
}

/// Ajanın gönderdiği mesajlar: ayarlar, beyaz liste, sunucu bildirimi.
async fn ajan_mesaji(bot: &Arc<Bot>, m: &Value) {
    let strs = |v: &Value| -> Vec<String> { v.as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect() };
    match m["type"].as_str() {
        Some("whitelist") => {
            let mut p = bot.panel.write().unwrap();
            p.beyaz_link = id_kumesi(strs(&m["link"]).iter().map(String::as_str));
            p.beyaz_kufur = id_kumesi(strs(&m["kufur"]).iter().map(String::as_str));
            println!("Beyaz liste güncellendi: link {} ID, küfür {} ID.", p.beyaz_link.len(), p.beyaz_kufur.len());
        }
        Some("settings") => {
            let s = |k: &str| m[k].as_str().and_then(bos_degil);
            let mut p = bot.panel.write().unwrap();
            p.log = s("logChannel");
            p.izinli = filtre::alan_adlari(m["allowed"].as_str().unwrap_or(""));
            p.katilma_kanali = s("joinChannel");
            p.ayrilma_kanali = s("leaveChannel");
            println!(
                "Ayarlar güncellendi: log {}, izinli alan adları {}.",
                p.log.as_deref().unwrap_or("kapalı"),
                if p.izinli.is_empty() { "yok".into() } else { p.izinli.join(", ") }
            );
        }
        Some("guild-event") => bildirim::isle(bot, m).await,
        _ => {}
    }
}
