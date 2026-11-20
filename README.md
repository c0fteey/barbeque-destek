# Barbeque Destek

Barbeque'nin Micup destek sunucusu botu: **guard** (link ve küfür engeli) ve **destek (ticket) sistemi**.

- Yasak mesaj silinir, yazan **1 dakika susturulur** (zaman aşımı), kanalda 6 sn görünen bir uyarı gider, log kanalı ayarlıysa kayıt düşülür.
- **Ceza kademesi:** 24 saat içinde 3. ihlalde sunucudan atılır; atıldıktan sonra 30 gün içinde 2 ihlal daha yaparsa banlanır. Atılmadan/banlanmadan önce özelden haber verilir. Kayıtlar `veri/ihlaller.json`'da (git'te değil, güncellemede silinmez).
- **Metinler, süreler ve ceza sayıları `src/mesajlar.json`'da**: uyarılar, susturma eki, log satırı, susturma süresi (`susturmaSaniye`, 0 = susturma yok), uyarının kaç saniye sonra silineceği.
- Yetkililere (Mesajları Yönet / Yönetici) ve botlara dokunulmaz. Panelden link ve küfür için ayrı **beyaz liste**: kullanıcı, rol ya da kanal ID'si. Düzenlenen mesajlar da denetlenir.
- Link: http(s), www., çıplak alan adı (site.com), davetler (micup.gg/invite, discord.gg...). İzinli alan adları ayarlanabilir (vars. micup.gg); davetler her zaman yasak.
- Küfür: `src/kufur.txt`. `kelime*` kelime başı olarak eşleşir, yıldızsız kelime yalnızca tamamı. Harf tekrarı (amkkk), araya işaret (s.i.k), boşluklu harf (s i k), rakamla yazma (5ik) ve Türkçe karaktersiz yazım yakalanır.

Botun sunucuda **Mesajları Yönet**, **Üyelere zaman aşımı uygula**, **Üyeleri At** ve **Üyeleri Yasakla** izni olmalı, rolü üyelerin rollerinden üstte olmalı; Micup'ta bot uygulamasında Message Content yetkisi açık olmalı.

## Destek (ticket) sistemi

- **Kurulum** (`/destek-kur`, Sunucuyu Yönet izni gerekir): `kategori` ticket kanallarının açılacağı kategori, `yetkili-ekle` / `yetkili-cikar` ticketları görecek roller, `log` kapanan ticket dökümlerinin gideceği kanal, `limit` kişi başı aynı anda açık ticket (vars. 1), `panel` butonlu paneli bir kanala atar, `durum` ayarları gösterir. Ayarlar `veri/destek.json`'da (git'te değil).
- **Panel:** embed + 16:9 banner (solda botun profil fotoğrafı, sağda başlık; `src/destekBanner.js`) + **Destek Talebi Aç** butonu.
- **Ticket:** kategoride `destek-0001` gibi özel kanal; yalnızca açan, yetkili roller ve bot görür. Açılışta kişi ve yetkili roller etiketlenir; **Üstlen** (yalnızca yetkili) ve **Kapat** butonları var.
- **Ticket içinde:** `/destek kapat [sebep]`, `/destek ekle kullanici`, `/destek cikar kullanici`, `/destek ustlen`.
- **Yasak** (yetkili, her kanalda): `/destek yasakla kullanici [sebep] [gun]` (gün boşsa süresiz), `/destek yasak-kaldir kullanici`, `/destek yasaklilar`. Yasaklı üye butona basınca sebep ve bitiş tarihi gösterilir; yasaklanana özelden haber gider, log kanalına yazılır.
- **Kapanış:** onay sorulur; bütün mesajların `.txt` dökümü açan kişiye özelden ve log kanalına (özet embed'le) gider, kanal 5 sn sonra silinir. Kanal elle silinirse kayıt da düşer.
- Metinler `src/destek.js` içindeki `DEFAULTS`'ta; `src/mesajlar.json`'a `"destek": {...}` ekleyip aynı anahtarlarla değiştirebilirsin.
- Botun **Kanalları Yönet**, **İzinleri Yönet**, **Mesaj Geçmişini Oku** ve **Dosya Ekle** izni olmalı.

## Çalıştırma

VDS'te bbq-deploy ajanı yönetir: panelde **Destek** sayfasından token'ı gir; ajan repoyu `C:\Barbeque\destek` klasörüne çeker, kurar, başlatır, push'ta günceller, çökerse yeniden açar. Çıktıyı izlemek için `C:\Barbeque\destek-izle.cmd`.

Elle: `.env.example` → `.env`, `npm ci`, `npm run start:env`.
