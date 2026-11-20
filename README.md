# Barbeque Destek

Barbeque'nin Micup destek sunucusu botu (Lucia), **Rust** ile yazıldı: **guard** (link ve küfür engeli), **destek (ticket) sistemi**, Barbeque'nin sunucuya eklendi/çıkarıldı bildirimleri.

## Guard

- Yasak mesaj silinir, yazan **1 dakika susturulur** (zaman aşımı), kanalda 6 sn görünen bir uyarı gider, log kanalı ayarlıysa kayıt düşülür.
- **Ceza kademesi:** 24 saat içinde 3. ihlalde sunucudan atılır; atıldıktan sonra 30 gün içinde 2 ihlal daha yaparsa banlanır. Atılmadan/banlanmadan önce özelden haber verilir.
- **Metinler, süreler ve ceza sayıları `ayarlar/mesajlar.json`'da** (`susturmaSaniye`: 0 = susturma yok; `ceza`: 0 = o ceza kapalı).
- Yetkililere (Mesajları Yönet / Yönetici) ve botlara dokunulmaz. Panelden link ve küfür için ayrı **beyaz liste**: kullanıcı, rol ya da kanal ID'si. Düzenlenen mesajlar da denetlenir.
- Link: http(s), www., çıplak alan adı (site.com), davetler (micup.gg/invite, discord.gg...). İzinli alan adları panelden (vars. micup.gg); davetler her zaman yasak.
- Küfür: `ayarlar/kufur.txt`. `kelime*` kelime başı olarak eşleşir, yıldızsız kelime yalnızca tamamı. Harf tekrarı (amkkk), araya işaret (s.i.k), boşluklu harf (s i k), rakamla yazma (5ik), sansür işareti (s*kim), Türkçe karaktersiz yazım ve art arda kısa mesajlarla bölünmüş yazım ("Oros", "Pu") yakalanır.

## Destek (ticket) sistemi

- **Kurulum** (`/destek-kur`, Sunucuyu Yönet izni): `kategori`, `yetkili-ekle` / `yetkili-cikar` (açık ticketların izinleri de güncellenir), `log` (ticket açılış/kapanış kayıtları ve dökümler), `limit` (kişi başı açık ticket, vars. 1), `panel` (butonlu panel; yeniden atılınca eskisi silinir), `durum`.
- **Panel:** embed + 16:9 banner (botun profil fotoğrafı + "BARBEQUE / DESTEK MERKEZİ"; yazılar `ayarlar/mesajlar.json > destek > banner...`) + **Destek Talebi Aç** butonu.
- **Ticket:** kategoride `destek-0001` gibi özel kanal; yalnızca açan, yetkili roller ve bot görür. **Üstlen** (yalnızca yetkili, bir kez) ve **Kapat** (onaylı) butonları.
- **Ticket içinde:** `/destek kapat [sebep]`, `/destek ekle kullanici`, `/destek cikar kullanici`, `/destek ustlen`.
- **Yasak** (yetkili, her kanalda): `/destek yasakla kullanici [sebep] [gun]` (gün boşsa süresiz), `/destek yasak-kaldir`, `/destek yasaklilar`.
- **Kapanış:** bütün mesajların `.txt` dökümü açan kişiye özelden ve log kanalına (özet embed'le) gider, kanal 5 sn sonra silinir. Kanal elle silinirse kayıt da düşer.
- Botun **Kanalları Yönet**, **İzinleri Yönet**, **Mesaj Geçmişini Oku**, **Dosya Ekle**, **Mesajları Yönet**, **Üyelere zaman aşımı uygula**, **Üyeleri At** ve **Üyeleri Yasakla** izni olmalı, rolü üyelerin rollerinden üstte olmalı; Micup'ta bot uygulamasında Message Content yetkisi açık olmalı.

## Veri

`veri/destek.db` (SQLite; git'te değil, güncellemede silinmez): destek ayarları, açık ticketlar, yasaklar, guard ihlalleri, mesaj sayısı/XP. Eski JS sürümünün `veri/ihlaller.json` ve `veri/seviye.json` dosyaları ilk açılışta bir kez içeri alınır (`.aktarildi` uzantısıyla saklanır).

## Yapı

| Dosya | Ne |
| --- | --- |
| `src/main.rs` | Micup bağlantısı (gateway), olayların dağıtımı, ajan mesajları, komut kaydı |
| `src/guard.rs`, `src/filtre.rs` | Guard ve link/küfür süzgeci |
| `src/destek.rs`, `src/banner.rs` | Ticket sistemi ve panel banner'ı |
| `src/bildirim.rs` | Sunucuya eklendi/çıkarıldı bildirimi |
| `src/api.rs`, `src/etkilesim.rs`, `src/onbellek.rs` | Micup REST istemcisi, slash/buton etkileşimleri, rol/kanal önbelleği |
| `src/veri.rs` | SQLite |
| `baslat.js` | Ajanla exe arasındaki köprü (ajan Node IPC konuşur) |
| `ayarlar/` | Metinler ve küfür listesi (düzenleyip push etmen yeterli) |

Micup, Discord API'sinin aynısını `https://micup.gg/api/v10` altında sunar. Gateway bağlantısı için [twilight-gateway](https://github.com/twilight-rs/twilight) kullanılır; olaylar ve REST cevapları katı tiplere değil JSON'a okunur, Micup bir alanı farklı gönderse de bot çalışmaya devam eder.

## Çalıştırma

**VDS:** Her push'ta GitHub Actions exe'yi derler, testleri çalıştırır ve çalıştırmaya hazır dosyaları **`yayin`** dalına koyar. bbq-deploy panelinde Destek sayfasında branch **`yayin`** olmalı; ajan oradan çeker, `npm ci` (bağımlılık yok) yapar ve `node baslat.js` ile başlatır, çökerse yeniden açar. VDS'e Rust kurmak gerekmez. Çıktıyı izlemek için `C:\Barbeque\destek-izle.cmd`.

**Elle:** `.env.example` → `.env`, `cargo run --release` (ya da `cargo build --release` sonra `npm start`).

**Test:** `cargo test`. `tests/filtre_ornekleri.json` eski JS süzgecinin örnek mesajlara verdiği cevaplar; Rust süzgeci hepsinde aynı sonucu vermeli (`tests/js_beklenen.mjs` ile yeniden üretilir).
