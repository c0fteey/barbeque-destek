//! Kalıcı veri: veri/destek.db (SQLite). Klasör .gitignore'da; güncellemede silinmez.
//! Eski JS sürümünün veri/ihlaller.json ve veri/seviye.json dosyaları ilk açılışta bir kez içeri alınır.

use std::sync::Mutex;

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

pub struct Veri(Mutex<Connection>);

#[derive(Debug, Clone, Default)]
pub struct Ayar {
    pub kategori: Option<String>,
    pub log: Option<String>,
    pub limit: i64,
    pub sayac: i64,
    pub panel_kanal: Option<String>,
    pub panel_mesaj: Option<String>,
    pub yetkili_roller: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Ticket {
    pub kanal: String,
    pub sunucu: String,
    pub no: i64,
    pub sahip: String,
    pub acildi: i64,
    pub ustlenen: Option<String>,
    pub ustlenen_ad: Option<String>,
    pub acilis_mesaj: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Yasak {
    pub kullanici: String,
    pub sebep: String,
    pub yetkili: String,
    pub tarih: i64,
    pub bitis: Option<i64>,
}

/// Ceza kademesi ayarları (ayarlar/mesajlar.json > ceza).
#[derive(Debug, Clone, Copy)]
pub struct CezaAyari {
    pub atma_icin: i64,
    pub pencere_ms: i64,
    pub ban_icin: i64,
    pub hatirlama_ms: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Ceza {
    Sustur,
    At,
    Banla,
}

const SEMA: &str = "
CREATE TABLE IF NOT EXISTS ayar (
  sunucu TEXT PRIMARY KEY,
  kategori TEXT,
  log TEXT,
  limit_ INTEGER NOT NULL DEFAULT 1,
  sayac INTEGER NOT NULL DEFAULT 0,
  panel_kanal TEXT,
  panel_mesaj TEXT
);
CREATE TABLE IF NOT EXISTS yetkili_rol (sunucu TEXT NOT NULL, rol TEXT NOT NULL, PRIMARY KEY (sunucu, rol));
CREATE TABLE IF NOT EXISTS ticket (
  kanal TEXT PRIMARY KEY,
  sunucu TEXT NOT NULL,
  no INTEGER NOT NULL,
  sahip TEXT NOT NULL,
  acildi INTEGER NOT NULL,
  ustlenen TEXT,
  ustlenen_ad TEXT,
  acilis_mesaj TEXT
);
CREATE INDEX IF NOT EXISTS ticket_sahip ON ticket (sunucu, sahip);
CREATE TABLE IF NOT EXISTS yasak (
  sunucu TEXT NOT NULL,
  kullanici TEXT NOT NULL,
  sebep TEXT NOT NULL DEFAULT '',
  yetkili TEXT NOT NULL,
  tarih INTEGER NOT NULL,
  bitis INTEGER,
  PRIMARY KEY (sunucu, kullanici)
);
CREATE TABLE IF NOT EXISTS ihlal (sunucu TEXT NOT NULL, kullanici TEXT NOT NULL, zaman INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ihlal_kisi ON ihlal (sunucu, kullanici, zaman);
CREATE TABLE IF NOT EXISTS atilma (sunucu TEXT NOT NULL, kullanici TEXT NOT NULL, zaman INTEGER NOT NULL, PRIMARY KEY (sunucu, kullanici));
CREATE TABLE IF NOT EXISTS seviye (kullanici TEXT PRIMARY KEY, xp INTEGER NOT NULL, mesaj INTEGER NOT NULL, son INTEGER NOT NULL);
";

impl Veri {
    pub fn ac(klasor: &str) -> Result<Self> {
        std::fs::create_dir_all(klasor)?;
        let conn = Connection::open(format!("{klasor}/destek.db"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SEMA)?;
        let veri = Self(Mutex::new(conn));
        veri.eski_json_al(klasor);
        Ok(veri)
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---------- ayarlar ----------

    pub fn ayar(&self, sunucu: &str) -> Ayar {
        let db = self.db();
        let mut ayar = db
            .query_row("SELECT kategori, log, limit_, sayac, panel_kanal, panel_mesaj FROM ayar WHERE sunucu = ?", [sunucu], |r| {
                Ok(Ayar {
                    kategori: r.get(0)?,
                    log: r.get(1)?,
                    limit: r.get(2)?,
                    sayac: r.get(3)?,
                    panel_kanal: r.get(4)?,
                    panel_mesaj: r.get(5)?,
                    yetkili_roller: Vec::new(),
                })
            })
            .optional()
            .ok()
            .flatten()
            .unwrap_or(Ayar { limit: 1, ..Ayar::default() });
        if let Ok(mut st) = db.prepare("SELECT rol FROM yetkili_rol WHERE sunucu = ? ORDER BY rowid") {
            ayar.yetkili_roller = st
                .query_map([sunucu], |r| r.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
        }
        ayar
    }

    /// Tek alan yazar: alan "kategori" | "log" | "panel_kanal" | "panel_mesaj".
    pub fn ayar_yaz(&self, sunucu: &str, alan: &str, deger: Option<&str>) -> Result<()> {
        assert!(["kategori", "log", "panel_kanal", "panel_mesaj"].contains(&alan));
        let db = self.db();
        db.execute("INSERT OR IGNORE INTO ayar (sunucu) VALUES (?)", [sunucu])?;
        db.execute(&format!("UPDATE ayar SET {alan} = ? WHERE sunucu = ?"), params![deger, sunucu])?;
        Ok(())
    }

    pub fn limit_yaz(&self, sunucu: &str, limit: i64) -> Result<()> {
        let db = self.db();
        db.execute("INSERT OR IGNORE INTO ayar (sunucu) VALUES (?)", [sunucu])?;
        db.execute("UPDATE ayar SET limit_ = ? WHERE sunucu = ?", params![limit, sunucu])?;
        Ok(())
    }

    pub fn yetkili_ekle(&self, sunucu: &str, rol: &str) -> Result<()> {
        self.db().execute("INSERT OR IGNORE INTO yetkili_rol (sunucu, rol) VALUES (?, ?)", [sunucu, rol])?;
        Ok(())
    }

    pub fn yetkili_cikar(&self, sunucu: &str, rol: &str) -> Result<bool> {
        Ok(self.db().execute("DELETE FROM yetkili_rol WHERE sunucu = ? AND rol = ?", [sunucu, rol])? > 0)
    }

    // ---------- ticketlar ----------

    /// Sayaç bir artar, yeni numara döner.
    pub fn sonraki_no(&self, sunucu: &str) -> Result<i64> {
        let db = self.db();
        db.execute("INSERT OR IGNORE INTO ayar (sunucu) VALUES (?)", [sunucu])?;
        Ok(db.query_row("UPDATE ayar SET sayac = sayac + 1 WHERE sunucu = ? RETURNING sayac", [sunucu], |r| r.get(0))?)
    }

    pub fn ticket_ekle(&self, t: &Ticket) -> Result<()> {
        self.db().execute(
            "INSERT INTO ticket (kanal, sunucu, no, sahip, acildi) VALUES (?, ?, ?, ?, ?)",
            params![t.kanal, t.sunucu, t.no, t.sahip, t.acildi],
        )?;
        Ok(())
    }

    pub fn ticket(&self, kanal: &str) -> Option<Ticket> {
        self.db()
            .query_row(
                "SELECT kanal, sunucu, no, sahip, acildi, ustlenen, ustlenen_ad, acilis_mesaj FROM ticket WHERE kanal = ?",
                [kanal],
                ticket_satiri,
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn ticketlar(&self, sunucu: &str) -> Vec<Ticket> {
        let db = self.db();
        let Ok(mut st) = db.prepare("SELECT kanal, sunucu, no, sahip, acildi, ustlenen, ustlenen_ad, acilis_mesaj FROM ticket WHERE sunucu = ? ORDER BY no") else {
            return Vec::new();
        };
        st.query_map([sunucu], ticket_satiri).map(|r| r.filter_map(|t| t.ok()).collect()).unwrap_or_default()
    }

    pub fn acilis_mesaji(&self, kanal: &str, mesaj: &str) {
        self.db().execute("UPDATE ticket SET acilis_mesaj = ? WHERE kanal = ?", [mesaj, kanal]).ok();
    }

    pub fn ticket_sil(&self, kanal: &str) -> bool {
        self.db().execute("DELETE FROM ticket WHERE kanal = ?", [kanal]).unwrap_or(0) > 0
    }

    /// Üstlenildiyse true; başkası daha önce üstlendiyse false.
    pub fn ustlen(&self, kanal: &str, yetkili: &str, ad: &str) -> bool {
        self.db()
            .execute("UPDATE ticket SET ustlenen = ?, ustlenen_ad = ? WHERE kanal = ? AND ustlenen IS NULL", [yetkili, ad, kanal])
            .unwrap_or(0)
            > 0
    }

    // ---------- yasaklar ----------

    pub fn yasakla(&self, sunucu: &str, y: &Yasak) -> Result<()> {
        self.db().execute(
            "INSERT OR REPLACE INTO yasak (sunucu, kullanici, sebep, yetkili, tarih, bitis) VALUES (?, ?, ?, ?, ?, ?)",
            params![sunucu, y.kullanici, y.sebep, y.yetkili, y.tarih, y.bitis],
        )?;
        Ok(())
    }

    /// Süresi geçmemiş yasak; süresi geçmişse silinir.
    pub fn yasak(&self, sunucu: &str, kullanici: &str, simdi: i64) -> Option<Yasak> {
        let db = self.db();
        db.execute("DELETE FROM yasak WHERE bitis IS NOT NULL AND bitis <= ?", [simdi]).ok();
        db.query_row(
            "SELECT kullanici, sebep, yetkili, tarih, bitis FROM yasak WHERE sunucu = ? AND kullanici = ?",
            [sunucu, kullanici],
            yasak_satiri,
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn yasak_kaldir(&self, sunucu: &str, kullanici: &str) -> bool {
        self.db().execute("DELETE FROM yasak WHERE sunucu = ? AND kullanici = ?", [sunucu, kullanici]).unwrap_or(0) > 0
    }

    pub fn yasaklar(&self, sunucu: &str, simdi: i64) -> Vec<Yasak> {
        let db = self.db();
        db.execute("DELETE FROM yasak WHERE bitis IS NOT NULL AND bitis <= ?", [simdi]).ok();
        let Ok(mut st) = db.prepare("SELECT kullanici, sebep, yetkili, tarih, bitis FROM yasak WHERE sunucu = ? ORDER BY tarih") else {
            return Vec::new();
        };
        st.query_map([sunucu], yasak_satiri).map(|r| r.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    }

    // ---------- guard ceza kademesi ----------

    /// İhlali kaydeder, uygulanacak cezayı döndürür.
    pub fn ihlal(&self, sunucu: &str, kullanici: &str, simdi: i64, c: CezaAyari) -> Ceza {
        let db = self.db();
        // Süresi geçmiş kayıtlar atılır.
        let unut = simdi - c.pencere_ms.max(c.hatirlama_ms);
        db.execute("DELETE FROM ihlal WHERE zaman < ?", [unut]).ok();
        db.execute("DELETE FROM atilma WHERE zaman < ?", [simdi - c.hatirlama_ms]).ok();
        db.execute("INSERT INTO ihlal (sunucu, kullanici, zaman) VALUES (?, ?, ?)", params![sunucu, kullanici, simdi]).ok();
        let atilma: Option<i64> = db
            .query_row("SELECT zaman FROM atilma WHERE sunucu = ? AND kullanici = ?", [sunucu, kullanici], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        let say = |sonra: i64| -> i64 {
            db.query_row(
                "SELECT COUNT(*) FROM ihlal WHERE sunucu = ? AND kullanici = ? AND zaman > ?",
                params![sunucu, kullanici, sonra],
                |r| r.get(0),
            )
            .unwrap_or(0)
        };
        match atilma {
            Some(at) => {
                if c.ban_icin > 0 && say(at) >= c.ban_icin {
                    Ceza::Banla
                } else {
                    Ceza::Sustur
                }
            }
            None => {
                if c.atma_icin > 0 && say(simdi - c.pencere_ms) >= c.atma_icin {
                    Ceza::At
                } else {
                    Ceza::Sustur
                }
            }
        }
    }

    pub fn atildi(&self, sunucu: &str, kullanici: &str, simdi: i64) {
        let db = self.db();
        db.execute("DELETE FROM ihlal WHERE sunucu = ? AND kullanici = ?", [sunucu, kullanici]).ok();
        db.execute("INSERT OR REPLACE INTO atilma (sunucu, kullanici, zaman) VALUES (?, ?, ?)", params![sunucu, kullanici, simdi])
            .ok();
    }

    pub fn banlandi(&self, sunucu: &str, kullanici: &str) {
        let db = self.db();
        db.execute("DELETE FROM ihlal WHERE sunucu = ? AND kullanici = ?", [sunucu, kullanici]).ok();
        db.execute("DELETE FROM atilma WHERE sunucu = ? AND kullanici = ?", [sunucu, kullanici]).ok();
    }

    // ---------- seviye ----------

    /// Mesaj sayısı her mesajda artar; XP kişi başı dakikada en fazla bir kez (15-25).
    pub fn mesaj_xp(&self, kullanici: &str, simdi: i64, xp: i64) {
        let db = self.db();
        db.execute(
            "INSERT INTO seviye (kullanici, xp, mesaj, son) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT (kullanici) DO UPDATE SET
               mesaj = mesaj + 1,
               xp = CASE WHEN ?3 - son >= 60000 THEN xp + ?2 ELSE xp END,
               son = CASE WHEN ?3 - son >= 60000 THEN ?3 ELSE son END",
            params![kullanici, xp, simdi],
        )
        .ok();
    }

    // ---------- eski JSON dosyaları ----------

    fn eski_json_al(&self, klasor: &str) {
        let ihlaller = format!("{klasor}/ihlaller.json");
        if let Some(data) = json_oku(&ihlaller) {
            let db = self.db();
            let mut sayi = 0;
            for (key, entry) in data.as_object().into_iter().flatten() {
                let Some((g, u)) = key.split_once(':') else { continue };
                for t in entry["times"].as_array().into_iter().flatten().filter_map(|t| t.as_i64()) {
                    db.execute("INSERT INTO ihlal (sunucu, kullanici, zaman) VALUES (?, ?, ?)", params![g, u, t]).ok();
                }
                if let Some(k) = entry["kickedAt"].as_i64() {
                    db.execute("INSERT OR REPLACE INTO atilma (sunucu, kullanici, zaman) VALUES (?, ?, ?)", params![g, u, k]).ok();
                }
                sayi += 1;
            }
            drop(db);
            aktarildi(&ihlaller, sayi, "ihlal kaydı");
        }
        let seviye = format!("{klasor}/seviye.json");
        if let Some(data) = json_oku(&seviye) {
            let db = self.db();
            let mut sayi = 0;
            for (u, e) in data.as_object().into_iter().flatten() {
                db.execute(
                    "INSERT OR REPLACE INTO seviye (kullanici, xp, mesaj, son) VALUES (?, ?, ?, ?)",
                    params![u, e["xp"].as_i64().unwrap_or(0), e["messages"].as_i64().unwrap_or(0), e["last"].as_i64().unwrap_or(0)],
                )
                .ok();
                sayi += 1;
            }
            drop(db);
            aktarildi(&seviye, sayi, "kişinin seviyesi");
        }
    }
}

fn json_oku(yol: &str) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(yol).ok()?;
    serde_json::from_str(&text).ok()
}

/// Aktarılan dosya .aktarildi uzantısıyla saklanır (bir daha okunmaz, istenirse geri alınır).
fn aktarildi(yol: &str, sayi: usize, ne: &str) {
    match std::fs::rename(yol, format!("{yol}.aktarildi")) {
        Ok(()) => println!("{yol}: {sayi} {ne} veritabanına aktarıldı."),
        Err(e) => eprintln!("{yol} aktarıldı ama yeniden adlandırılamadı: {e}"),
    }
}

fn ticket_satiri(r: &rusqlite::Row) -> rusqlite::Result<Ticket> {
    Ok(Ticket {
        kanal: r.get(0)?,
        sunucu: r.get(1)?,
        no: r.get(2)?,
        sahip: r.get(3)?,
        acildi: r.get(4)?,
        ustlenen: r.get(5)?,
        ustlenen_ad: r.get(6)?,
        acilis_mesaj: r.get(7)?,
    })
}

fn yasak_satiri(r: &rusqlite::Row) -> rusqlite::Result<Yasak> {
    Ok(Yasak { kullanici: r.get(0)?, sebep: r.get(1)?, yetkili: r.get(2)?, tarih: r.get(3)?, bitis: r.get(4)? })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gecici() -> Veri {
        let dir = std::env::temp_dir().join(format!("bbq-test-{}", rand::random::<u64>()));
        Veri::ac(dir.to_str().unwrap()).unwrap()
    }

    #[test]
    fn ceza_kademesi() {
        let v = gecici();
        let c = CezaAyari { atma_icin: 3, pencere_ms: 3_600_000, ban_icin: 2, hatirlama_ms: 86_400_000 };
        assert_eq!(v.ihlal("g", "u", 1_000, c), Ceza::Sustur);
        assert_eq!(v.ihlal("g", "u", 2_000, c), Ceza::Sustur);
        assert_eq!(v.ihlal("g", "u", 3_000, c), Ceza::At);
        v.atildi("g", "u", 3_000);
        assert_eq!(v.ihlal("g", "u", 4_000, c), Ceza::Sustur);
        assert_eq!(v.ihlal("g", "u", 5_000, c), Ceza::Banla);
        v.banlandi("g", "u");
        assert_eq!(v.ihlal("g", "u", 6_000, c), Ceza::Sustur);
        // 0 → ceza kapalı.
        let kapali = CezaAyari { atma_icin: 0, ban_icin: 0, ..c };
        for t in 0..5 {
            assert_eq!(v.ihlal("g", "x", 10_000 + t, kapali), Ceza::Sustur);
        }
    }

    #[test]
    fn ticket_ve_yasak() {
        let v = gecici();
        assert_eq!(v.sonraki_no("g").unwrap(), 1);
        assert_eq!(v.sonraki_no("g").unwrap(), 2);
        v.ticket_ekle(&Ticket { kanal: "c".into(), sunucu: "g".into(), no: 2, sahip: "u".into(), acildi: 0, ustlenen: None, ustlenen_ad: None, acilis_mesaj: None })
            .unwrap();
        assert!(v.ustlen("c", "s", "Yetkili"));
        assert!(!v.ustlen("c", "s2", "Başka"));
        assert_eq!(v.ticket("c").unwrap().ustlenen.as_deref(), Some("s"));
        assert!(v.ticket_sil("c"));
        v.yasakla("g", &Yasak { kullanici: "u".into(), sebep: "spam".into(), yetkili: "s".into(), tarih: 0, bitis: Some(100) }).unwrap();
        assert!(v.yasak("g", "u", 50).is_some());
        assert!(v.yasak("g", "u", 150).is_none());
        v.yetkili_ekle("g", "r1").unwrap();
        v.yetkili_ekle("g", "r1").unwrap();
        assert_eq!(v.ayar("g").yetkili_roller, vec!["r1".to_string()]);
        assert_eq!(v.ayar("g").limit, 1);
    }
}
