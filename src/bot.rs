//! Botun paylaşılan durumu: Micup istemcisi, önbellek, veritabanı, metinler ve panelden gelen ayarlar.

use std::collections::HashSet;
use std::sync::{Mutex, RwLock};

use serde_json::{json, Value};

use crate::api::Api;
use crate::filtre::{self, Kelimeler};
use crate::metin::Metinler;
use crate::onbellek::Onbellek;
use crate::veri::Veri;

/// Panelden gelen (ajanın verdiği) ayarlar; değişince bot yeniden başlamadan uygulanır.
#[derive(Default)]
pub struct PanelAyari {
    pub log: Option<String>,
    pub izinli: Vec<String>,
    pub beyaz_link: HashSet<String>,
    pub beyaz_kufur: HashSet<String>,
    pub katilma_kanali: Option<String>,
    pub ayrilma_kanali: Option<String>,
}

pub struct Bot {
    pub api: Api,
    pub onbellek: Onbellek,
    pub veri: Veri,
    pub metin: Metinler,
    pub kelimeler: Kelimeler,
    pub panel: RwLock<PanelAyari>,
    /// Micup aynı etkileşimi iki kez gönderebiliyor; ikincisi yok sayılır.
    goruldu: Mutex<(HashSet<String>, Vec<String>)>,
}

pub fn bos_degil(v: &str) -> Option<String> {
    let t = v.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// "1, 2 3" → {"1","2","3"} (yalnızca ID gibi görünenler).
pub fn id_kumesi<'a>(parcalar: impl IntoIterator<Item = &'a str>) -> HashSet<String> {
    parcalar
        .into_iter()
        .flat_map(|p| p.split(|c: char| c == ',' || c.is_whitespace()))
        .filter(|id| (5..=25).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()))
        .map(String::from)
        .collect()
}

impl Bot {
    pub fn new(api: Api, veri: Veri, metin: Metinler, kelimeler: Kelimeler) -> Self {
        let env = |k: &str| std::env::var(k).unwrap_or_default();
        let panel = PanelAyari {
            log: bos_degil(&env("LOG_CHANNEL_ID")),
            izinli: filtre::alan_adlari(&std::env::var("ALLOWED_DOMAINS").unwrap_or_else(|_| "micup.gg".into())),
            beyaz_link: id_kumesi([env("WHITELIST_LINK").as_str()]),
            beyaz_kufur: id_kumesi([env("WHITELIST_KUFUR").as_str()]),
            katilma_kanali: bos_degil(&env("JOIN_CHANNEL_ID")),
            ayrilma_kanali: bos_degil(&env("LEAVE_CHANNEL_ID")),
        };
        Self {
            api,
            onbellek: Onbellek::default(),
            veri,
            metin,
            kelimeler,
            panel: RwLock::new(panel),
            goruldu: Mutex::new((HashSet::new(), Vec::new())),
        }
    }

    /// Etkileşim daha önce işlendiyse true.
    pub fn tekrar_mi(&self, id: &str) -> bool {
        let mut g = self.goruldu.lock().unwrap();
        if !g.0.insert(id.to_string()) {
            return true;
        }
        g.1.push(id.to_string());
        if g.1.len() > 2000 {
            let eski = g.1.remove(0);
            g.0.remove(&eski);
        }
        false
    }

    /// Panelin log kanalına yazar (guard ve sunucu bildirimleri için; destek logu ayrı ayarlanır).
    pub async fn guard_logu(&self, icerik: &str) {
        let kanal = self.panel.read().unwrap().log.clone();
        if let Some(kanal) = kanal {
            let _ = self.api.mesaj_gonder(&kanal, &json!({"content": icerik, "allowed_mentions": {"parse": []}})).await;
        }
    }

    /// Bot avatarının adresi (banner ve embed küçük resmi).
    pub fn logo(&self) -> Option<String> {
        let bot = self.onbellek.bot.read().unwrap();
        bot.avatar.as_ref().map(|hash| format!("https://media.micup.gg/avatars/{}/{hash}.png?size=256", bot.id))
    }
}

/// Kullanıcının görünen adı.
pub fn ad(user: &Value) -> String {
    user["global_name"].as_str().or(user["username"].as_str()).unwrap_or("bilinmiyor").to_string()
}

/// Belirli süre sonra mesajı siler (arka planda).
pub fn sonra_sil(bot: &std::sync::Arc<Bot>, kanal: String, mesaj: String, ms: u64) {
    let bot = bot.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        let _ = bot.api.mesaj_sil(&kanal, &mesaj).await;
    });
}
