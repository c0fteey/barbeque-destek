//! bbq-deploy ajanıyla iletişim. Ajan Node IPC kullanır; baslat.js bu kanalı bota stdin/stdout üzerinden aktarır:
//!   ajan → bot: stdin'den satır başına bir JSON ("shutdown", {type: "settings"|"whitelist"|"guild-event", ...})
//!   bot → ajan: stdout'a "@@ipc {json}" satırı ({type: "ready"})
//! Bot elle (baslat.js olmadan) çalıştırılırsa stdin kapalıdır, bu kanal sessizce kapanır.

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

pub const ONEK: &str = "@@ipc ";

/// stdin'i okuyup gelen mesajları kanala aktarır.
pub fn dinle() -> mpsc::UnboundedReceiver<Value> {
    let (tx, rx) = mpsc::unbounded_channel();
    if std::env::var("BBQ_IPC").as_deref() != Ok("1") {
        return rx;
    }
    tokio::spawn(async move {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
        // Başlatıcı kapandı: ajan da kapanmış demektir, bot da kapanır.
        let _ = tx.send(Value::String("shutdown".into()));
    });
    rx
}

pub fn gonder(mesaj: &Value) {
    if std::env::var("BBQ_IPC").as_deref() == Ok("1") {
        println!("{ONEK}{mesaj}");
    }
}
