//! Botun yazdığı metinler: ayarlar/mesajlar.json. "{kisi}" gibi yerler doldurulur.

use serde_json::Value;

pub struct Metinler(Value);

impl Metinler {
    pub fn oku(yol: &str) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(yol)?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("{yol} okunamadı (virgül ya da tırnak eksik olabilir): {e}"))?;
        Ok(Self(value))
    }

    /// "uyari.link" gibi noktalı yol; yoksa boş metin.
    pub fn al(&self, yol: &str) -> String {
        self.deger(yol).and_then(Value::as_str).unwrap_or("").to_string()
    }

    /// Yoksa varsayılan.
    pub fn al_ya_da(&self, yol: &str, varsayilan: &str) -> String {
        match self.deger(yol).and_then(Value::as_str) {
            Some(s) => s.to_string(),
            None => varsayilan.to_string(),
        }
    }

    pub fn sayi(&self, yol: &str, varsayilan: f64) -> f64 {
        self.deger(yol).and_then(Value::as_f64).filter(|n| n.is_finite()).unwrap_or(varsayilan)
    }

    fn deger(&self, yol: &str) -> Option<&Value> {
        yol.split('.').try_fold(&self.0, |v, k| v.get(k))
    }
}

/// "{kisi} ..." gibi yerleri doldurur; bilinmeyen yer olduğu gibi kalır.
pub fn doldur(sablon: &str, degerler: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(sablon.len());
    let mut rest = sablon;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if after[..end].chars().all(|c| c.is_alphanumeric() || c == '_') && end > 0 => {
                let key = &after[..end];
                match degerler.iter().find(|(k, _)| *k == key) {
                    Some((_, v)) => out.push_str(v),
                    None => {
                        out.push('{');
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::doldur;

    #[test]
    fn doldurma() {
        assert_eq!(doldur("{kisi} selam {yok} {}", &[("kisi", "<@1>")]), "<@1> selam {yok} {}");
    }
}
