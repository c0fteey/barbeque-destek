//! Micup REST istemcisi. Micup, Discord API'sinin aynısını https://micup.gg/api/v10 altında sunar.
//! Cevaplar katı tiplere değil serde_json::Value'ya okunur: Micup bir alanı farklı gönderse de bot çalışmaya devam eder.

use std::time::Duration;

use anyhow::{anyhow, Result};
use reqwest::{multipart, Method, StatusCode};
use serde_json::Value;

/// MICUP_API yalnızca yerel deneme için (sahte sunucu); normalde boş bırakılır.
static API: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(|| std::env::var("MICUP_API").unwrap_or_else(|_| "https://micup.gg/api/v10".into()));

#[derive(Clone)]
pub struct Api {
    http: reqwest::Client,
    token: String,
}

/// Mesaja eklenecek dosya.
pub struct Dosya {
    pub ad: String,
    pub veri: Vec<u8>,
}

/// API hatası: durum kodu ve Micup'ın mesajı.
#[derive(Debug)]
pub struct ApiHatasi {
    pub durum: u16,
    pub mesaj: String,
}

impl std::fmt::Display for ApiHatasi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.mesaj, self.durum)
    }
}
impl std::error::Error for ApiHatasi {}

impl Api {
    pub fn new(token: &str) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("DiscordBot (https://github.com/c0fteey/barbeque-destek, 1.0) barbeque-destek")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP istemcisi kurulamadı");
        Self { http, token: token.to_string() }
    }

    /// Sıradan istek; 429'da bekleyip 3 kez dener. 204 → Value::Null.
    pub async fn istek(&self, method: Method, path: &str, body: Option<&Value>, sebep: Option<&str>) -> Result<Value> {
        for _ in 0..4 {
            let mut req = self
                .http
                .request(method.clone(), format!("{}{path}", *API))
                .header("Authorization", format!("Bot {}", self.token));
            if let Some(body) = body {
                req = req.header("Content-Type", "application/json").body(body.to_string());
            }
            if let Some(sebep) = sebep {
                req = req.header("X-Audit-Log-Reason", yuzde_kodla(sebep));
            }
            let res = req.send().await?;
            if let Some(v) = self.cevap(res).await? {
                return Ok(v);
            }
        }
        Err(anyhow!("Micup hız sınırı: istek tekrar tekrar reddedildi ({path})"))
    }

    /// Dosyalı mesaj (multipart). 429'da bekleyip dener.
    pub async fn dosyali(&self, method: Method, path: &str, payload: &Value, dosyalar: &[Dosya]) -> Result<Value> {
        for _ in 0..4 {
            let mut payload = payload.clone();
            payload["attachments"] = Value::Array(
                dosyalar
                    .iter()
                    .enumerate()
                    .map(|(i, d)| serde_json::json!({"id": i, "filename": d.ad}))
                    .collect(),
            );
            let mut form = multipart::Form::new().text("payload_json", payload.to_string());
            for (i, d) in dosyalar.iter().enumerate() {
                let part = multipart::Part::bytes(d.veri.clone()).file_name(d.ad.clone());
                form = form.part(format!("files[{i}]"), part);
            }
            let res = self
                .http
                .request(method.clone(), format!("{}{path}", *API))
                .header("Authorization", format!("Bot {}", self.token))
                .multipart(form)
                .send()
                .await?;
            if let Some(v) = self.cevap(res).await? {
                return Ok(v);
            }
        }
        Err(anyhow!("Micup hız sınırı: dosyalı istek tekrar tekrar reddedildi ({path})"))
    }

    /// None → 429, beklendi, yeniden denenmeli.
    async fn cevap(&self, res: reqwest::Response) -> Result<Option<Value>> {
        let status = res.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let body: Value = serde_json::from_str(&res.text().await.unwrap_or_default()).unwrap_or(Value::Null);
            let wait = body["retry_after"].as_f64().unwrap_or(1.0).clamp(0.1, 30.0);
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
            return Ok(None);
        }
        if status == StatusCode::NO_CONTENT {
            return Ok(Some(Value::Null));
        }
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            let mesaj = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["message"].as_str().map(String::from))
                .unwrap_or_else(|| text.chars().take(200).collect());
            return Err(ApiHatasi { durum: status.as_u16(), mesaj }.into());
        }
        Ok(Some(serde_json::from_str(&text).unwrap_or(Value::Null)))
    }

    pub async fn get(&self, path: &str) -> Result<Value> {
        self.istek(Method::GET, path, None, None).await
    }
    pub async fn post(&self, path: &str, body: &Value) -> Result<Value> {
        self.istek(Method::POST, path, Some(body), None).await
    }
    pub async fn patch(&self, path: &str, body: &Value) -> Result<Value> {
        self.istek(Method::PATCH, path, Some(body), None).await
    }
    pub async fn put(&self, path: &str, body: &Value) -> Result<Value> {
        self.istek(Method::PUT, path, Some(body), None).await
    }
    pub async fn delete(&self, path: &str) -> Result<Value> {
        self.istek(Method::DELETE, path, None, None).await
    }

    // ---------- kısayollar ----------

    pub async fn mesaj_gonder(&self, kanal: &str, body: &Value) -> Result<Value> {
        self.post(&format!("/channels/{kanal}/messages"), body).await
    }

    pub async fn mesaj_sil(&self, kanal: &str, mesaj: &str) -> Result<()> {
        self.delete(&format!("/channels/{kanal}/messages/{mesaj}")).await.map(|_| ())
    }

    /// Özel mesaj; özel mesajı kapalıysa hata döner (çağıran yok sayar).
    pub async fn ozel_mesaj(&self, kullanici: &str, body: &Value, dosyalar: &[Dosya]) -> Result<()> {
        let dm = self.post("/users/@me/channels", &serde_json::json!({"recipient_id": kullanici})).await?;
        let kanal = dm["id"].as_str().ok_or_else(|| anyhow!("özel kanal açılamadı"))?;
        if dosyalar.is_empty() {
            self.mesaj_gonder(kanal, body).await?;
        } else {
            self.dosyali(Method::POST, &format!("/channels/{kanal}/messages"), body, dosyalar).await?;
        }
        Ok(())
    }

    /// Sebep (denetim kaydı) eklenmiş istek.
    pub async fn sebepli(&self, method: Method, path: &str, body: Option<&Value>, sebep: &str) -> Result<Value> {
        self.istek(method, path, body, Some(sebep)).await
    }
}

/// X-Audit-Log-Reason başlığı ASCII olmalı; Türkçe karakterler yüzde kodlanır.
fn yuzde_kodla(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b" -_.~:".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

