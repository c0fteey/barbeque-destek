//! Guard süzgeçleri: mesajda link ya da küfür var mı. Saf fonksiyonlar; Micup'a dokunmaz.
//!
//! Küfür listesi (ayarlar/kufur.txt): satır başına bir kelime. Sonu * ise kelime başı olarak eşleşir
//! ("orospu*" → "orospuçocuğu"), değilse yalnızca kelimenin tamamı ("göt" eşleşir, "götür" eşleşmez).
//! "/.../" satırı kelimenin içinde aranan regex, "cumle /.../" satırı bütün mesajda aranan regex.
//!
//! Kandırma yolları da yakalanır: büyük/küçük harf, tekrar eden harf ("amkkk"), araya konan işaret ("s.i.k"),
//! tek tek boşluklu harf ("s i k"), rakamla yazma ("5ik"), Türkçe karakter olmadan yazma ("amcik" ↔ "amcık"),
//! sansür işaretiyle yazma ("s*kim"), alt alta ya da art arda bölünmüş yazım ("Oros", "Pu").

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Kelime listesi.
pub struct Kelimeler {
    pub tam: HashSet<String>,
    pub kokler: Vec<String>,
    pub desenler: Vec<Regex>,
    pub cumleler: Vec<Regex>,
}

/// Türkçe küçük harf: I → ı, İ → i, gerisi Unicode küçük harf.
fn kucuk(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            'I' => out.push('ı'),
            'İ' => out.push('i'),
            _ => out.extend(c.to_lowercase()),
        }
    }
    out
}

/// Art arda aynı harf teke iner ("amkkk" → "amk"). Yalnızca harfler.
fn tekle(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev: Option<char> = None;
    for c in text.chars() {
        if c.is_alphabetic() && prev == Some(c) {
            continue;
        }
        out.push(c);
        prev = Some(c);
    }
    out
}

fn leet(c: char) -> char {
    match c {
        '0' => 'o',
        '1' => 'i',
        '3' => 'e',
        '4' => 'a',
        '5' => 's',
        '7' => 't',
        '8' => 'b',
        '@' => 'a',
        '$' => 's',
        '€' => 'e',
        '!' => 'i',
        _ => c,
    }
}

/// Küçük harf, rakam/işaret yerine harf, tekrar eden harfler teke. Türkçe harfler korunur.
pub fn sadelestir(text: &str) -> String {
    let nfc: String = text.nfc().collect();
    let lower: String = kucuk(&nfc).chars().map(leet).collect();
    tekle(&lower)
}

/// Türkçe karakterler olmadan ("amcık" → "amcik").
pub fn ascii(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            'â' => 'a',
            'î' => 'i',
            'û' => 'u',
            _ => c,
        })
        .collect()
}

fn harfler(text: &str) -> String {
    text.chars().filter(|c| c.is_alphabetic()).collect()
}

fn uzunluk(text: &str) -> usize {
    text.chars().count()
}

/// Harf olmayan karakterlerden böler, boş parçaları atar.
fn harf_parcalari(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !c.is_alphabetic()).filter(|p| !p.is_empty())
}

pub fn kelimeleri_oku(text: &str) -> Kelimeler {
    let mut tam = HashSet::new();
    let mut kokler: Vec<String> = Vec::new();
    let mut desenler = Vec::new();
    let mut cumleler = Vec::new();
    for line in text.lines() {
        let raw = line.trim();
        if raw.is_empty() || raw.starts_with('#') {
            continue;
        }
        if let Some(rest) = raw.strip_prefix("cumle") {
            let rest = rest.trim_start();
            if rest.len() > 2 && rest.starts_with('/') && rest.ends_with('/') && rest.len() != raw.len() {
                match Regex::new(&rest[1..rest.len() - 1]) {
                    Ok(re) => cumleler.push(re),
                    Err(error) => eprintln!("kufur.txt: geçersiz cümle deseni {raw}: {error}"),
                }
                continue;
            }
        }
        if raw.len() > 2 && raw.starts_with('/') && raw.ends_with('/') {
            match Regex::new(&raw[1..raw.len() - 1]) {
                Ok(re) => desenler.push(re),
                Err(error) => eprintln!("kufur.txt: geçersiz desen {raw}: {error}"),
            }
            continue;
        }
        let (kelime, kok) = match raw.strip_suffix('*') {
            Some(k) => (sadelestir(k), true),
            None => (sadelestir(raw), false),
        };
        // Kısa kelimelerin Türkçe karaktersiz hali eklenmez: "piç" → "pic", "göt" → "got" masum.
        let mut bicimler = vec![kelime.clone()];
        if uzunluk(&kelime) > 3 {
            let a = ascii(&kelime);
            if a != kelime {
                bicimler.push(a);
            }
        }
        for b in bicimler {
            if kok {
                if !kokler.contains(&b) {
                    kokler.push(b);
                }
            } else {
                tam.insert(b);
            }
        }
    }
    Kelimeler { tam, kokler, desenler, cumleler }
}

/// Sıralı, tekrarsız aday listesi.
struct Adaylar(Vec<String>);
impl Adaylar {
    fn ekle(&mut self, s: String) {
        if !self.0.contains(&s) {
            self.0.push(s);
        }
    }
}

/// Mesajın aday kelimeleri: kelimeler, işaretleri atılmış kelimeler ve tek harflerin birleşimi ("s i k" → "sik").
fn adaylar(content: &str) -> Vec<String> {
    let mut out = Adaylar(Vec::new());
    let mut letters = String::new();
    let flush = |letters: &mut String, out: &mut Adaylar| {
        if uzunluk(letters) >= 2 {
            out.ekle(sadelestir(letters));
        }
        letters.clear();
    };
    for token in content.split_whitespace() {
        let n = sadelestir(token);
        for part in harf_parcalari(&n) {
            out.ekle(part.to_string());
        }
        // Büyük harfle yazılmış İngilizce kelime ("OPPAI" → "oppaı"): Türkçe harf içermiyorsa "I" → "i" olarak da denenir.
        if token.contains('I') && !token.chars().any(|c| "çğöşüÇĞÖŞÜİı".contains(c)) {
            let alt = sadelestir(&token.replace('I', "i"));
            for part in harf_parcalari(&alt) {
                out.ekle(part.to_string());
            }
        }
        let joined = harfler(&n);
        if !joined.is_empty() {
            out.ekle(tekle(&joined));
        }
        if uzunluk(&joined) == 1 {
            letters.push_str(&joined);
        } else {
            flush(&mut letters, &mut out);
        }
    }
    flush(&mut letters, &mut out);
    out.0
}

/// Cümle desenleri için mesaj: işaretler boşluk, tek tek yazılmış harfler birleşik ("a n a n a hele" → "anana hele").
fn cumle(content: &str) -> String {
    let n = sadelestir(content);
    let cleaned: String = n
        .chars()
        .map(|c| if c.is_alphabetic() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let mut out: Vec<String> = Vec::new();
    let mut letters = String::new();
    for token in cleaned.split_whitespace() {
        if uzunluk(token) == 1 {
            letters.push_str(token);
            continue;
        }
        if !letters.is_empty() {
            out.push(std::mem::take(&mut letters));
        }
        out.push(token.to_string());
    }
    if !letters.is_empty() {
        out.push(letters);
    }
    tekle(&out.join(" "))
}

fn kok_eslesir(kelimeler: &Kelimeler, aday: &str) -> bool {
    kelimeler.kokler.iter().any(|k| aday.starts_with(k.as_str()))
}

/// Küfürlü kelime varsa onu döndürür.
pub fn kufur_bul(content: &str, kelimeler: &Kelimeler) -> Option<String> {
    if content.is_empty() {
        return None;
    }
    for aday in adaylar(content) {
        if kelimeler.tam.contains(&aday) || kok_eslesir(kelimeler, &aday) || kelimeler.desenler.iter().any(|d| d.is_match(&aday)) {
            return Some(aday);
        }
    }
    if !kelimeler.cumleler.is_empty() {
        let c = cumle(content);
        for desen in &kelimeler.cumleler {
            if let Some(m) = desen.find(&c) {
                return Some(m.as_str().to_string());
            }
        }
    }
    if let Some(s) = sansurlu_bul(content, kelimeler) {
        return Some(s);
    }
    // Alt alta bölünmüş yazım: satırlar birleşip ayrıca denetlenir.
    let satirlar: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if satirlar.len() > 1 {
        return birlesik_bul(&satirlar, kelimeler);
    }
    None
}

const SANSUR: &[char] = &['*', '@', '#', '$', '%', '_'];
static SANSUR_ARASI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}[*@#$%_]+\p{L}").unwrap());

/// Sansür işaretiyle yazım: "s@m", "s*kim". Harf arasındaki * @ # $ % _ işaretleri birkaç harf sayılır.
fn sansurlu_bul(content: &str, kelimeler: &Kelimeler) -> Option<String> {
    for token in content.split_whitespace() {
        if !token.contains(SANSUR) {
            continue;
        }
        let nfc: String = token.nfc().collect();
        let lower = kucuk(&nfc);
        let word = lower.trim_matches(|c: char| !c.is_alphabetic());
        if !SANSUR_ARASI.is_match(word) || uzunluk(&harfler(word)) < 2 {
            continue;
        }
        let parts: Vec<String> = word
            .split(SANSUR)
            .filter(|p| !p.is_empty())
            .map(|p| harfler(&sadelestir(p)))
            .collect();
        let source = parts.iter().map(|p| regex::escape(p)).collect::<Vec<_>>().join(r"\p{L}{1,4}");
        let (Ok(exact), Ok(start)) = (Regex::new(&format!("^{source}$")), Regex::new(&format!("^{source}"))) else {
            continue;
        };
        if kelimeler.tam.iter().any(|e| exact.is_match(e)) {
            return Some(token.to_string());
        }
        // Kelime başı karşılaştırması için işaretten sonra en az 2 harf gerekir ("o$pu" evet, "o*o" hayır).
        let loose = parts.last().is_some_and(|p| uzunluk(p) >= 2);
        if kelimeler.kokler.iter().any(|k| exact.is_match(k) || (loose && start.is_match(k))) {
            return Some(token.to_string());
        }
    }
    None
}

/// Parçalara bölünmüş yazım: parçalar boşluksuz birleştirilip yalnızca kelime listesiyle denetlenir.
pub fn birlesik_bul<S: AsRef<str>>(parts: &[S], kelimeler: &Kelimeler) -> Option<String> {
    // Parçaların hepsi en az 4 harfli gerçek kelimelerse birleştirilmez ("şeref" + "sizin").
    if parts.iter().all(|p| uzunluk(&harfler(&sadelestir(p.as_ref()))) >= 4) {
        return None;
    }
    let raw: String = parts
        .iter()
        .flat_map(|p| p.as_ref().chars())
        .filter(|c| c.is_alphabetic() || c.is_numeric() || "@$€!".contains(*c))
        .collect();
    let joined = sadelestir(&raw);
    if uzunluk(&joined) < 2 {
        return None;
    }
    if kelimeler.tam.contains(&joined) || kok_eslesir(kelimeler, &joined) {
        return Some(joined);
    }
    None
}

// ---------- linkler ----------

const TLDS: &[&str] = &[
    "com", "net", "org", "gg", "io", "xyz", "me", "tv", "co", "ru", "tk", "ml", "ga", "cf", "gq", "link", "site", "online", "shop",
    "store", "app", "dev", "tr", "info", "biz", "club", "live", "top", "fun", "ly", "to", "cc", "ws", "su", "pw", "icu", "click",
    "win", "vip", "pro", "one", "lol", "gift", "gifts", "us", "uk", "de", "eu",
];

static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?-u:\b)https?://[^\s<>]+").unwrap());
static WWW_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(?-u:\b)www\.[^\s<>]+").unwrap());
// Çıplak alan adı: "site.com", "discord.gg/abc", "sub.domain.com.tr/yol". Nokta etrafındaki boşluk: "site . com".
static BARE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"(?i)(?-u:\b)((?:[a-z0-9-]+\s?\.\s?)+(?:{}))(?-u:\b)(/[^\s<>]*)?", TLDS.join("|"))).unwrap()
});
static INVITE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(discord\.gg|discord(?:app)?\.com/invite|micup\.gg/invite|dsc\.gg|invite\.gg)/").unwrap());

fn host(link: &str) -> String {
    let cleaned: String = link.chars().filter(|c| !c.is_whitespace()).collect();
    let lower = cleaned.to_lowercase();
    let mut rest = cleaned.as_str();
    if lower.starts_with("https://") {
        rest = &rest[8..];
    } else if lower.starts_with("http://") {
        rest = &rest[7..];
    }
    if rest.to_lowercase().starts_with("www.") {
        rest = &rest[4..];
    }
    rest.split(['/', '?', '#', ':']).next().unwrap_or("").to_lowercase()
}

/// Mesajdaki yasak link. izinli: izinli alan adları ("micup.gg" → kendisi ve alt alanları). Davetler her zaman yasak.
pub fn link_bul(content: &str, izinli: &[String]) -> Option<String> {
    if content.is_empty() {
        return None;
    }
    let found = URL_RE
        .find_iter(content)
        .chain(WWW_RE.find_iter(content))
        .chain(BARE_RE.find_iter(content))
        .map(|m| m.as_str());
    for link in found {
        let compact: String = link.chars().filter(|c| !c.is_whitespace()).collect();
        if INVITE_RE.is_match(&compact) {
            return Some(link.to_string());
        }
        let h = host(link);
        if h.is_empty() || !h.contains('.') {
            continue;
        }
        if izinli.iter().any(|d| h == *d || h.ends_with(&format!(".{d}"))) {
            continue;
        }
        return Some(link.to_string());
    }
    None
}

/// "https://www.site.com/yol, micup.gg" → ["site.com", "micup.gg"].
pub fn alan_adlari(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|d| {
            let d = d.trim().to_lowercase();
            let d = d.trim_start_matches("https://").trim_start_matches("http://");
            let d = d.strip_prefix("www.").unwrap_or(d);
            d.split('/').next().unwrap_or("").to_string()
        })
        .filter(|d| !d.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JS sürümünün (src/filters.js) aynı örneklere verdiği cevaplar: tests/filtre_ornekleri.json.
    #[test]
    fn js_ile_ayni_sonuc() {
        let kelimeler = kelimeleri_oku(include_str!("../ayarlar/kufur.txt"));
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../tests/filtre_ornekleri.json")).unwrap();
        let izinli = vec!["micup.gg".to_string()];
        let mut hatalar = Vec::new();
        for o in &ornekler {
            let mesaj = o["mesaj"].as_str().unwrap();
            let kufur = kufur_bul(mesaj, &kelimeler);
            let link = link_bul(mesaj, &izinli);
            let beklenen_kufur = o["kufur"].as_str().map(String::from);
            let beklenen_link = o["link"].as_str().map(String::from);
            if kufur != beklenen_kufur || link != beklenen_link {
                hatalar.push(format!("{mesaj:?}: küfür {kufur:?} (JS {beklenen_kufur:?}), link {link:?} (JS {beklenen_link:?})"));
            }
        }
        assert!(hatalar.is_empty(), "{} fark:\n{}", hatalar.len(), hatalar.join("\n"));
    }

    #[test]
    fn birlesik_parcalar() {
        let kelimeler = kelimeleri_oku(include_str!("../ayarlar/kufur.txt"));
        assert!(birlesik_bul(&["Oros", "Pu"], &kelimeler).is_some());
        assert!(birlesik_bul(&["şeref", "sizin"], &kelimeler).is_none());
    }
}
