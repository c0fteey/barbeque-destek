//! Barbeque bir sunucuya eklenince ya da çıkarılınca bbq-deploy ajanı bilgisini gönderir
//! ({type: "guild-event", event: "join" | "leave", guild, bot, totalGuilds, at}); bot panelde seçilen kanala embed yazar.
//! Metinler ayarlar/mesajlar.json > sunucu.

use serde_json::{json, Value};

use crate::bot::Bot;
use crate::metin::doldur;

fn kirp(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 1234567 → "1.234.567"
fn binlik(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

fn embed(bot: &Bot, m: &Value, resimli: bool) -> Value {
    let g = &m["guild"];
    let tur = if m["event"].as_str() == Some("leave") { "leave" } else { "join" };
    let sahip = match g["ownerId"].as_str() {
        Some(id) => match g["ownerName"].as_str() {
            Some(ad) => format!("<@{id}> ({})", kirp(ad, 80)),
            None => format!("<@{id}>"),
        },
        None => "—".into(),
    };
    let sayi = |v: &Value| v.as_f64().map(|n| binlik(n as i64)).unwrap_or_else(|| "?".into());
    let kurulus = g["createdAt"].as_f64().map(|ms| format!("<t:{}:D>", (ms / 1000.0) as i64)).unwrap_or_else(|| "—".into());
    let bot_adi = m["bot"]["name"].as_str().unwrap_or("Barbeque").to_string();
    let sunucu = kirp(g["name"].as_str().unwrap_or("?"), 200);
    let id = g["id"].as_str().unwrap_or("?").to_string();
    let (uye, toplam) = (sayi(&g["memberCount"]), sayi(&m["totalGuilds"]));
    let degerler: Vec<(&str, &str)> = vec![
        ("bot", &bot_adi),
        ("sunucu", &sunucu),
        ("id", &id),
        ("uye", &uye),
        ("sahip", &sahip),
        ("kurulus", &kurulus),
        ("toplam", &toplam),
    ];
    let t = |k: &str| bot.metin.al(&format!("sunucu.{k}"));
    let alan = |k: &str, v: &str| bot.metin.al_ya_da(&format!("sunucu.alan.{k}"), v);
    let baslik = kirp(&doldur(&t(&format!("{tur}.baslik")), &degerler), 256);
    let aciklama = kirp(&doldur(&t(&format!("{tur}.aciklama")), &degerler), 4000);
    let mut alanlar = vec![
        json!({"name": alan("ad", "Sunucu"), "value": sunucu, "inline": true}),
        json!({"name": alan("id", "ID"), "value": format!("`{id}`"), "inline": true}),
        json!({"name": alan("uye", "Üye"), "value": uye, "inline": true}),
        json!({"name": alan("sahip", "Sahip"), "value": sahip, "inline": true}),
        json!({"name": alan("kurulus", "Kuruluş"), "value": kurulus, "inline": true}),
        json!({"name": alan("toplam", "Toplam sunucu"), "value": toplam, "inline": true}),
    ];
    if let Some(d) = g["description"].as_str().filter(|d| !d.is_empty()) {
        alanlar.push(json!({"name": alan("aciklama", "Açıklama"), "value": kirp(d, 1000)}));
    }
    let zaman = m["at"].as_f64().map(|n| n as i64).unwrap_or_else(crate::zaman::simdi);
    let mut e = json!({
        "color": if tur == "join" { 0x2ecc71 } else { 0xe8262b },
        "title": if baslik.is_empty() { tur.to_string() } else { baslik },
        "fields": alanlar,
        "timestamp": crate::zaman::iso(zaman),
    });
    if !aciklama.is_empty() {
        e["description"] = json!(aciklama);
    }
    let url = |v: &Value| v.as_str().filter(|s| s.starts_with("http://") || s.starts_with("https://")).map(String::from);
    if resimli {
        if let Some(icon) = url(&g["icon"]) {
            e["thumbnail"] = json!({"url": icon});
        }
        if let Some(banner) = url(&g["banner"]) {
            e["image"] = json!({"url": banner});
        }
    }
    e
}

pub async fn isle(bot: &Bot, m: &Value) {
    let leave = m["event"].as_str() == Some("leave");
    println!(
        "{} {}: {} ({})",
        m["bot"]["name"].as_str().unwrap_or("Barbeque"),
        if leave { "sunucudan çıkarıldı" } else { "sunucuya eklendi" },
        m["guild"]["name"].as_str().unwrap_or("?"),
        m["guild"]["id"].as_str().unwrap_or("?"),
    );
    let kanal = {
        let p = bot.panel.read().unwrap();
        if leave {
            p.ayrilma_kanali.clone()
        } else {
            p.katilma_kanali.clone()
        }
    };
    let Some(kanal) = kanal else { return };
    let body = |resimli| json!({"embeds": [embed(bot, m, resimli)], "allowed_mentions": {"parse": []}});
    if let Err(e) = bot.api.mesaj_gonder(&kanal, &body(true)).await {
        // Micup resimli embed'i reddederse resimsiz yeniden denenir.
        eprintln!("Sunucu bildirimi gönderilemedi (#{kanal}): {e}");
        let _ = bot.api.mesaj_gonder(&kanal, &body(false)).await;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn binlik() {
        assert_eq!(super::binlik(1_234_567), "1.234.567");
        assert_eq!(super::binlik(999), "999");
        assert_eq!(super::binlik(1000), "1.000");
    }
}
