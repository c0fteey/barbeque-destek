//! Slash komutu ve buton etkileşimleri: seçenekleri okuma ve cevap verme.

use anyhow::Result;
use reqwest::Method;
use serde_json::{json, Value};

use crate::api::{Api, Dosya};
use crate::onbellek::{izin, uye_izni, uye_rolleri, Onbellek};

pub const GIZLI: u64 = 64;

pub struct Etkilesim {
    pub ham: Value,
    pub id: String,
    pub token: String,
    pub uygulama: String,
    pub sunucu: String,
    pub kanal: String,
    pub kullanici: Value,
    pub kullanici_id: String,
    pub roller: Vec<String>,
    pub izinler: u64,
}

impl Etkilesim {
    /// Sunucu dışındaki etkileşimler (özel mesaj) None.
    pub fn oku(ham: Value, onbellek: &Onbellek) -> Option<Self> {
        let sunucu = ham["guild_id"].as_str()?.to_string();
        let member = &ham["member"];
        let kullanici = member["user"].clone();
        let kullanici_id = kullanici["id"].as_str()?.to_string();
        let roller = uye_rolleri(member);
        let mut izinler = uye_izni(member).unwrap_or_else(|| onbellek.izinler(&sunucu, &kullanici_id, &roller));
        // Yönetici her izne sahiptir (Micup'ın gönderdiği izin alanında yalnızca o bit olabilir).
        if izinler & izin::ADMINISTRATOR != 0 {
            izinler = u64::MAX;
        }
        let kanal = ham["channel_id"].as_str().or(ham["channel"]["id"].as_str()).unwrap_or("").to_string();
        let uygulama = ham["application_id"].as_str().unwrap_or("").to_string();
        Some(Self {
            id: ham["id"].as_str()?.to_string(),
            token: ham["token"].as_str()?.to_string(),
            uygulama,
            sunucu,
            kanal,
            kullanici,
            kullanici_id,
            roller,
            izinler,
            ham,
        })
    }

    pub fn buton_mu(&self) -> bool {
        self.ham["type"].as_u64() == Some(3)
    }

    pub fn komut(&self) -> &str {
        self.ham["data"]["name"].as_str().unwrap_or("")
    }

    pub fn buton(&self) -> &str {
        self.ham["data"]["custom_id"].as_str().unwrap_or("")
    }

    /// Alt komut adı.
    pub fn alt_komut(&self) -> &str {
        self.ham["data"]["options"][0]["name"].as_str().unwrap_or("")
    }

    /// Alt komutun seçeneği.
    pub fn secenek(&self, ad: &str) -> Option<&Value> {
        self.ham["data"]["options"][0]["options"].as_array()?.iter().find(|o| o["name"].as_str() == Some(ad)).map(|o| &o["value"])
    }

    pub fn metin(&self, ad: &str) -> Option<String> {
        self.secenek(ad).and_then(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }

    pub fn sayi(&self, ad: &str) -> Option<i64> {
        self.secenek(ad).and_then(Value::as_i64)
    }

    /// Kullanıcı, rol ya da kanal seçeneğinin ID'si.
    pub fn id(&self, ad: &str) -> Option<String> {
        self.secenek(ad).and_then(|v| v.as_str().map(String::from).or_else(|| v.as_u64().map(|n| n.to_string())))
    }

    /// Seçenekte seçilen kullanıcının nesnesi (data.resolved.users).
    pub fn secilen_kullanici(&self, id: &str) -> Value {
        self.ham["data"]["resolved"]["users"][id].clone()
    }

    pub fn secilen_kanal_adi(&self, id: &str) -> String {
        self.ham["data"]["resolved"]["channels"][id]["name"].as_str().unwrap_or(id).to_string()
    }

    pub fn izin_var(&self, izin: u64) -> bool {
        self.izinler & izin != 0
    }

    // ---------- cevaplar ----------

    async fn geri(&self, api: &Api, tur: u64, data: Option<Value>) -> Result<()> {
        let mut body = json!({"type": tur});
        if let Some(d) = data {
            body["data"] = d;
        }
        api.post(&format!("/interactions/{}/{}/callback", self.id, self.token), &body).await.map(|_| ())
    }

    /// Kanala görünen cevap.
    pub async fn cevap(&self, api: &Api, mut data: Value) -> Result<()> {
        if data.get("allowed_mentions").is_none() {
            data["allowed_mentions"] = json!({"parse": []});
        }
        self.geri(api, 4, Some(data)).await
    }

    /// Yalnızca kişinin göreceği cevap.
    pub async fn fisilda(&self, api: &Api, icerik: &str) -> Result<()> {
        self.geri(api, 4, Some(json!({"content": icerik, "flags": GIZLI, "allowed_mentions": {"parse": []}}))).await
    }

    pub async fn gizli_cevap(&self, api: &Api, mut data: Value) -> Result<()> {
        data["flags"] = json!(GIZLI);
        if data.get("allowed_mentions").is_none() {
            data["allowed_mentions"] = json!({"parse": []});
        }
        self.geri(api, 4, Some(data)).await
    }

    /// "Düşünüyor..." (gizli). Sonra duzenle ile doldurulur.
    pub async fn ertele(&self, api: &Api) -> Result<()> {
        self.geri(api, 5, Some(json!({"flags": GIZLI}))).await
    }

    /// Butonun bulunduğu mesajı günceller.
    pub async fn guncelle(&self, api: &Api, data: Value) -> Result<()> {
        self.geri(api, 7, Some(data)).await
    }

    /// Ertelenen cevabı doldurur.
    pub async fn duzenle(&self, api: &Api, icerik: &str) -> Result<()> {
        api.patch(
            &format!("/webhooks/{}/{}/messages/@original", self.uygulama, self.token),
            &json!({"content": icerik, "allowed_mentions": {"parse": []}}),
        )
        .await
        .map(|_| ())
    }

    /// Hata olunca: cevap verildiyse düzenler, verilmediyse gizli cevap.
    pub async fn hata(&self, api: &Api, icerik: &str) {
        if self.fisilda(api, icerik).await.is_err() {
            let _ = self.duzenle(api, icerik).await;
        }
    }
}

/// Dosyalı mesaj gönderir.
pub async fn dosyali_mesaj(api: &Api, kanal: &str, body: &Value, dosyalar: &[Dosya]) -> Result<Value> {
    api.dosyali(Method::POST, &format!("/channels/{kanal}/messages"), body, dosyalar).await
}
