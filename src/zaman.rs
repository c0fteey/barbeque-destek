//! Tarih yardımcıları. Türkiye 2016'dan beri sürekli UTC+3; saat dilimi kütüphanesine gerek yok.

use std::time::{SystemTime, UNIX_EPOCH};

const ISTANBUL_MS: i64 = 3 * 3_600_000;

pub fn simdi() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Unix günden (yıl, ay, gün). Howard Hinnant'ın civil_from_days algoritması.
fn takvim(gun: i64) -> (i64, u32, u32) {
    let z = gun + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

struct Parcalar {
    yil: i64,
    ay: u32,
    gun: u32,
    saat: i64,
    dakika: i64,
    saniye: i64,
    ms: i64,
}

fn parcala(ms: i64) -> Parcalar {
    let gun = ms.div_euclid(86_400_000);
    let kalan = ms.rem_euclid(86_400_000);
    let (yil, ay, g) = takvim(gun);
    Parcalar {
        yil,
        ay,
        gun: g,
        saat: kalan / 3_600_000,
        dakika: kalan / 60_000 % 60,
        saniye: kalan / 1000 % 60,
        ms: kalan % 1000,
    }
}

/// ISO 8601 UTC: 2026-11-20T14:03:00.000Z (Micup zaman aşımı alanı için).
pub fn iso(ms: i64) -> String {
    let p = parcala(ms);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", p.yil, p.ay, p.gun, p.saat, p.dakika, p.saniye, p.ms)
}

/// İstanbul saatiyle: 20.11.2026 17:03:00
pub fn tarih(ms: i64) -> String {
    let p = parcala(ms + ISTANBUL_MS);
    format!("{:02}.{:02}.{:04} {:02}:{:02}:{:02}", p.gun, p.ay, p.yil, p.saat, p.dakika, p.saniye)
}

/// Süre metni: 42 dakika, 3 saat 5 dakika, 2 gün 4 saat.
pub fn sure(ms: i64) -> String {
    let m = (ms as f64 / 60_000.0).round().max(1.0) as i64;
    if m < 60 {
        return format!("{m} dakika");
    }
    let h = m / 60;
    if h < 48 {
        return format!("{h} saat {} dakika", m % 60);
    }
    format!("{} gün {} saat", h / 24, h % 24)
}

/// Susturma süresi: 60 → "1 dakika", 90 → "90 saniye", 3600 → "1 saat".
pub fn saniye_metni(s: i64) -> String {
    if s >= 3600 && s % 3600 == 0 {
        format!("{} saat", s / 3600)
    } else if s >= 60 && s % 60 == 0 {
        format!("{} dakika", s / 60)
    } else {
        format!("{s} saniye")
    }
}

/// Snowflake ID'den oluşturulma zamanı (ms). Micup ID'leri Discord'la aynı düzende.
pub fn snowflake_ms(id: &str) -> Option<i64> {
    id.parse::<u64>().ok().map(|n| ((n >> 22) + 1_420_070_400_000) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bicimler() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_795_190_400_123), "2026-11-20T16:00:00.123Z");
        assert_eq!(tarih(1_795_190_400_000), "20.11.2026 19:00:00");
        assert_eq!(tarih(1_709_164_800_000), "29.02.2024 03:00:00");
        assert_eq!(sure(90_000), "2 dakika");
        assert_eq!(sure(3 * 3_600_000 + 5 * 60_000), "3 saat 5 dakika");
        assert_eq!(sure(50 * 3_600_000), "2 gün 2 saat");
        assert_eq!(saniye_metni(60), "1 dakika");
        assert_eq!(saniye_metni(90), "90 saniye");
        assert_eq!(saniye_metni(7200), "2 saat");
    }
}
