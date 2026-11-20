//! Destek panelinin 16:9 banner'ı (1280×720), Barbeque teması: siyah, kırmızı, beyaz, açık ve koyu gri.
//! Solda kırmızı halkalı logo (botun profil fotoğrafı), sağda üst etiket, iki satır başlık ve alt yazı.
//! SVG olarak kurulup resvg ile PNG'ye çevrilir; fontlar exe'nin içine gömülüdür.

use std::sync::{Arc, LazyLock};

use base64::Engine;
use resvg::{tiny_skia, usvg};

const W: f32 = 1280.0;
const H: f32 = 720.0;
const SIYAH: &str = "#0b0b0c";
const KOYU_GRI: &str = "#1c1c1f";
const GRI: &str = "#2a2a2e";
const ACIK_GRI: &str = "#b9b9c0";
const BEYAZ: &str = "#ffffff";
const KIRMIZI: &str = "#e0201e";

const BASLIK_FONT: &str = "font-family=\"Archivo Black\"";
const ETIKET_FONT: &str = "font-family=\"Poppins\" font-weight=\"600\"";
const YAZI_FONT: &str = "font-family=\"Poppins\" font-weight=\"500\"";

static SECENEK: LazyLock<usvg::Options<'static>> = LazyLock::new(|| {
    let mut db = usvg::fontdb::Database::new();
    db.load_font_data(include_bytes!("../assets/fonts/ArchivoBlack-Regular.ttf").to_vec());
    db.load_font_data(include_bytes!("../assets/fonts/Poppins-Medium.ttf").to_vec());
    db.load_font_data(include_bytes!("../assets/fonts/Poppins-SemiBold.ttf").to_vec());
    usvg::Options { fontdb: Arc::new(db), ..usvg::Options::default() }
});

fn kacir(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Metnin piksel genişliği.
fn genislik(text: &str, font: &str, size: f32) -> f32 {
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4000\" height=\"400\"><text x=\"0\" y=\"300\" {font} font-size=\"{size}\">{}</text></svg>",
        kacir(text)
    );
    usvg::Tree::from_str(&svg, &SECENEK).ok().and_then(|t| t.root().abs_bounding_box()).map(|r| r.width()).unwrap_or(0.0)
}

/// Satırı genişliğe sığacak şekilde böler.
fn sar(text: &str, font: &str, size: f32, max: f32) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        for word in paragraph.split(' ') {
            let next = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
            if !line.is_empty() && genislik(&next, font, size) > max {
                lines.push(std::mem::replace(&mut line, word.to_string()));
            } else {
                line = next;
            }
        }
        lines.push(line);
    }
    lines
}

pub struct BannerMetni<'a> {
    pub ust: &'a str,
    pub baslik: &'a str,
    pub vurgu: &'a str,
    pub alt_yazi: &'a str,
}

/// PNG baytları. logo: PNG/JPEG/WebP baytları (yoksa daire boş kalır).
pub fn ciz(logo: Option<&[u8]>, m: &BannerMetni) -> anyhow::Result<Vec<u8>> {
    let mut s = String::new();
    s.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"{W}\" height=\"{H}\" viewBox=\"0 0 {W} {H}\">"
    ));
    s.push_str("<defs><clipPath id=\"logo\"><circle cx=\"290\" cy=\"360\" r=\"180\"/></clipPath></defs>");

    // Arka plan, solda koyu gri çapraz panel ve kenarında ince kırmızı şerit.
    s.push_str(&format!("<rect width=\"{W}\" height=\"{H}\" fill=\"{SIYAH}\"/>"));
    s.push_str(&format!("<polygon points=\"0,0 600,0 480,{H} 0,{H}\" fill=\"{KOYU_GRI}\"/>"));
    s.push_str(&format!("<polygon points=\"600,0 616,0 496,{H} 480,{H}\" fill=\"{KIRMIZI}\"/>"));

    // Sağ altta gri nokta deseni.
    let mut y = 470;
    while y < 690 {
        let mut x = 980;
        while x < 1250 {
            s.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"3\" fill=\"{GRI}\"/>"));
            x += 28;
        }
        y += 28;
    }

    // Logo: kırmızı halka, beyaz daire, daireye kırpılmış resim.
    s.push_str(&format!("<circle cx=\"290\" cy=\"360\" r=\"192\" fill=\"{KIRMIZI}\"/>"));
    s.push_str(&format!("<circle cx=\"290\" cy=\"360\" r=\"180\" fill=\"{BEYAZ}\"/>"));
    if let Some(logo) = logo {
        let mime = if logo.starts_with(b"\x89PNG") {
            "image/png"
        } else if logo.starts_with(b"RIFF") {
            "image/webp"
        } else if logo.starts_with(b"GIF") {
            "image/gif"
        } else {
            "image/jpeg"
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(logo);
        s.push_str(&format!(
            "<image x=\"110\" y=\"180\" width=\"360\" height=\"360\" clip-path=\"url(#logo)\" preserveAspectRatio=\"xMidYMid slice\" xlink:href=\"data:{mime};base64,{b64}\"/>"
        ));
    }

    let left = 680.0;
    let max = W - left - 70.0;

    // Üst etiket: kırmızı zemin, beyaz yazı.
    let etiket_w = genislik(m.ust, ETIKET_FONT, 22.0) + 40.0;
    s.push_str(&format!("<rect x=\"{left}\" y=\"158\" width=\"{etiket_w}\" height=\"44\" rx=\"8\" fill=\"{KIRMIZI}\"/>"));
    s.push_str(&format!(
        "<text x=\"{}\" y=\"189\" {ETIKET_FONT} font-size=\"22\" fill=\"{BEYAZ}\">{}</text>",
        left + 20.0,
        kacir(m.ust)
    ));

    // Başlık: iki satır, ikisi de beyaz ve aynı boyda; genişliğe sığan en büyük boy.
    let satirlar: Vec<&str> = [m.baslik, m.vurgu].into_iter().filter(|l| !l.is_empty()).collect();
    let mut size = 104.0;
    while size > 48.0 && satirlar.iter().any(|l| genislik(l, BASLIK_FONT, size) > max) {
        size -= 4.0;
    }
    let mut y = 210.0 + size;
    for satir in &satirlar {
        s.push_str(&format!(
            "<text x=\"{}\" y=\"{y}\" {BASLIK_FONT} font-size=\"{size}\" fill=\"{BEYAZ}\">{}</text>",
            left - 4.0,
            kacir(satir)
        ));
        y += size * 1.02;
    }

    // Kırmızı ayraç.
    s.push_str(&format!("<rect x=\"{left}\" y=\"{}\" width=\"80\" height=\"8\" fill=\"{KIRMIZI}\"/>", y - size * 0.55));

    // Alt yazı: açık gri.
    y += 20.0;
    for satir in sar(m.alt_yazi, YAZI_FONT, 29.0, max).iter().take(3) {
        s.push_str(&format!("<text x=\"{left}\" y=\"{y}\" {YAZI_FONT} font-size=\"29\" fill=\"{ACIK_GRI}\">{}</text>", kacir(satir)));
        y += 42.0;
    }
    s.push_str("</svg>");

    let tree = usvg::Tree::from_str(&s, &SECENEK)?;
    let mut pixmap = tiny_skia::Pixmap::new(W as u32, H as u32).ok_or_else(|| anyhow::anyhow!("pixmap"))?;
    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    Ok(pixmap.encode_png()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_cizilir() {
        let logo = std::env::var("BANNER_LOGO").ok().and_then(|y| std::fs::read(y).ok());
        let png = ciz(
            logo.as_deref(),
            &BannerMetni {
                ust: "BARBEQUE",
                baslik: "DESTEK",
                vurgu: "MERKEZİ",
                alt_yazi: "Sorun, soru ya da şikayet? Sana özel kanalda yetkililer yardımcı olsun.",
            },
        )
        .unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        assert!(genislik("DESTEK", BASLIK_FONT, 104.0) > 300.0, "font yüklenmedi");
        if let Ok(yol) = std::env::var("BANNER_ORNEK") {
            std::fs::write(yol, png).unwrap();
        }
    }
}
