//! Gateway olaylarından tutulan küçük önbellek: sunucunun sahibi, rollerin izinleri ve kanallar.
//! Yetki hesabı (yetkili mi, Mesajları Yönet var mı) ve "kanal hâlâ var mı" soruları buradan cevaplanır.

use std::collections::HashMap;
use std::sync::RwLock;

use serde_json::Value;

pub mod izin {
    pub const ADMINISTRATOR: u64 = 1 << 3;
    pub const MANAGE_CHANNELS: u64 = 1 << 4;
    pub const MANAGE_GUILD: u64 = 1 << 5;
    pub const VIEW_CHANNEL: u64 = 1 << 10;
    pub const SEND_MESSAGES: u64 = 1 << 11;
    pub const MANAGE_MESSAGES: u64 = 1 << 13;
    pub const EMBED_LINKS: u64 = 1 << 14;
    pub const ATTACH_FILES: u64 = 1 << 15;
    pub const READ_MESSAGE_HISTORY: u64 = 1 << 16;
    pub const MANAGE_ROLES: u64 = 1 << 28;
}

#[derive(Debug, Clone)]
pub struct Kanal {
    pub ad: String,
    pub ust: Option<String>,
}

#[derive(Default)]
struct Sunucu {
    ad: String,
    sahip: String,
    roller: HashMap<String, u64>,
    kanallar: HashMap<String, Kanal>,
}

#[derive(Default)]
pub struct Onbellek {
    sunucular: RwLock<HashMap<String, Sunucu>>,
    /// Kanal → sunucu (kanal olayında sunucu ID'si gelmezse).
    kanal_sunucu: RwLock<HashMap<String, String>>,
    pub bot: RwLock<BotBilgisi>,
}

#[derive(Default, Clone)]
pub struct BotBilgisi {
    pub id: String,
    pub uygulama: String,
    pub ad: String,
    pub avatar: Option<String>,
}

fn izin_oku(v: &Value) -> u64 {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()).unwrap_or(0)
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn kanal_oku(c: &Value) -> Kanal {
    Kanal { ad: s(&c["name"]), ust: c["parent_id"].as_str().map(String::from) }
}

impl Onbellek {
    pub fn olay(&self, tur: &str, d: &Value) {
        match tur {
            "READY" => {
                let mut bot = self.bot.write().unwrap();
                bot.id = s(&d["user"]["id"]);
                bot.ad = d["user"]["global_name"].as_str().or(d["user"]["username"].as_str()).unwrap_or("").to_string();
                bot.avatar = d["user"]["avatar"].as_str().map(String::from);
                bot.uygulama = d["application"]["id"].as_str().map(String::from).unwrap_or_else(|| bot.id.clone());
            }
            "GUILD_CREATE" | "GUILD_UPDATE" => {
                let id = s(&d["id"]);
                if id.is_empty() || d["unavailable"].as_bool() == Some(true) {
                    return;
                }
                let mut sunucular = self.sunucular.write().unwrap();
                let g = sunucular.entry(id.clone()).or_default();
                g.ad = s(&d["name"]);
                g.sahip = s(&d["owner_id"]);
                if let Some(roles) = d["roles"].as_array() {
                    g.roller = roles.iter().map(|r| (s(&r["id"]), izin_oku(&r["permissions"]))).collect();
                }
                if let Some(channels) = d["channels"].as_array() {
                    g.kanallar = channels.iter().map(|c| (s(&c["id"]), kanal_oku(c))).collect();
                    let mut ks = self.kanal_sunucu.write().unwrap();
                    for c in channels {
                        ks.insert(s(&c["id"]), id.clone());
                    }
                }
            }
            "GUILD_DELETE" => {
                if d["unavailable"].as_bool() != Some(true) {
                    self.sunucular.write().unwrap().remove(&s(&d["id"]));
                }
            }
            "GUILD_ROLE_CREATE" | "GUILD_ROLE_UPDATE" => {
                if let Some(g) = self.sunucular.write().unwrap().get_mut(&s(&d["guild_id"])) {
                    g.roller.insert(s(&d["role"]["id"]), izin_oku(&d["role"]["permissions"]));
                }
            }
            "GUILD_ROLE_DELETE" => {
                if let Some(g) = self.sunucular.write().unwrap().get_mut(&s(&d["guild_id"])) {
                    g.roller.remove(&s(&d["role_id"]));
                }
            }
            "CHANNEL_CREATE" | "CHANNEL_UPDATE" => self.kanal_ekle(d),
            "CHANNEL_DELETE" => {
                let id = s(&d["id"]);
                let gid = d["guild_id"].as_str().map(String::from).or_else(|| self.kanal_sunucu.read().unwrap().get(&id).cloned());
                if let Some(gid) = gid {
                    if let Some(g) = self.sunucular.write().unwrap().get_mut(&gid) {
                        g.kanallar.remove(&id);
                    }
                }
                self.kanal_sunucu.write().unwrap().remove(&id);
            }
            _ => {}
        }
    }

    /// Botun kendi açtığı kanal da hemen önbelleğe girsin (CHANNEL_CREATE gelmeden önce kullanılabilir).
    pub fn kanal_ekle(&self, d: &Value) {
        let id = s(&d["id"]);
        let Some(gid) = d["guild_id"].as_str() else { return };
        if let Some(g) = self.sunucular.write().unwrap().get_mut(gid) {
            g.kanallar.insert(id.clone(), kanal_oku(d));
        }
        self.kanal_sunucu.write().unwrap().insert(id, gid.to_string());
    }

    pub fn kanal(&self, sunucu: &str, kanal: &str) -> Option<Kanal> {
        self.sunucular.read().unwrap().get(sunucu)?.kanallar.get(kanal).cloned()
    }

    /// Sunucu önbellekte yoksa (henüz GUILD_CREATE gelmediyse) None: kanal var mı bilinmiyor.
    pub fn kanal_var_mi(&self, sunucu: &str, kanal: &str) -> Option<bool> {
        let sunucular = self.sunucular.read().unwrap();
        Some(sunucular.get(sunucu)?.kanallar.contains_key(kanal))
    }

    pub fn rol_var_mi(&self, sunucu: &str, rol: &str) -> bool {
        self.sunucular.read().unwrap().get(sunucu).is_some_and(|g| g.roller.contains_key(rol))
    }

    pub fn sunucu_adi(&self, sunucu: &str) -> String {
        self.sunucular.read().unwrap().get(sunucu).map(|g| g.ad.clone()).unwrap_or_default()
    }

    pub fn sunucu_sayisi(&self) -> usize {
        self.sunucular.read().unwrap().len()
    }

    /// Sunucu genelindeki izinler (rol izinlerinin birleşimi; sahip ve yönetici her şeye sahip).
    pub fn izinler(&self, sunucu: &str, kullanici: &str, roller: &[String]) -> u64 {
        let sunucular = self.sunucular.read().unwrap();
        let Some(g) = sunucular.get(sunucu) else { return 0 };
        if g.sahip == kullanici {
            return u64::MAX;
        }
        let mut p = g.roller.get(sunucu).copied().unwrap_or(0);
        for r in roller {
            p |= g.roller.get(r).copied().unwrap_or(0);
        }
        if p & izin::ADMINISTRATOR != 0 {
            u64::MAX
        } else {
            p
        }
    }
}

/// Üye nesnesinin rolleri (mesaj ve etkileşimlerdeki "member").
pub fn uye_rolleri(member: &Value) -> Vec<String> {
    member["roles"].as_array().map(|r| r.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Etkileşimde Micup üyenin izinlerini gönderirse o kullanılır.
pub fn uye_izni(member: &Value) -> Option<u64> {
    let p = &member["permissions"];
    if p.is_null() {
        None
    } else {
        Some(izin_oku(p))
    }
}
