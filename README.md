# Barbeque Destek

Barbeque'nin Micup destek sunucusu botu. Şimdilik **guard**: link ve küfür engeli.

- Yasak mesaj silinir, yazan **1 dakika susturulur** (zaman aşımı), kanalda 6 sn görünen bir uyarı gider, log kanalı ayarlıysa kayıt düşülür.
- **Ceza kademesi:** 24 saat içinde 3. ihlalde sunucudan atılır; atıldıktan sonra 30 gün içinde 2 ihlal daha yaparsa banlanır. Atılmadan/banlanmadan önce özelden haber verilir. Kayıtlar `veri/ihlaller.json`'da (git'te değil, güncellemede silinmez).
- **Metinler, süreler ve ceza sayıları `src/mesajlar.json`'da**: uyarılar, susturma eki, log satırı, susturma süresi (`susturmaSaniye`, 0 = susturma yok), uyarının kaç saniye sonra silineceği.
- Yetkililere (Mesajları Yönet / Yönetici) ve botlara dokunulmaz. Panelden link ve küfür için ayrı **beyaz liste**: kullanıcı, rol ya da kanal ID'si. Düzenlenen mesajlar da denetlenir.
- Link: http(s), www., çıplak alan adı (site.com), davetler (micup.gg/invite, discord.gg...). İzinli alan adları ayarlanabilir (vars. micup.gg); davetler her zaman yasak.
- Küfür: `src/kufur.txt`. `kelime*` kelime başı olarak eşleşir, yıldızsız kelime yalnızca tamamı. Harf tekrarı (amkkk), araya işaret (s.i.k), boşluklu harf (s i k), rakamla yazma (5ik) ve Türkçe karaktersiz yazım yakalanır.

Botun sunucuda **Mesajları Yönet**, **Üyelere zaman aşımı uygula**, **Üyeleri At** ve **Üyeleri Yasakla** izni olmalı, rolü üyelerin rollerinden üstte olmalı; Micup'ta bot uygulamasında Message Content yetkisi açık olmalı.

## Çalıştırma

VDS'te bbq-deploy ajanı yönetir: panelde **Destek** sayfasından token'ı gir; ajan repoyu `C:\Barbeque\destek` klasörüne çeker, kurar, başlatır, push'ta günceller, çökerse yeniden açar. Çıktıyı izlemek için `C:\Barbeque\destek-izle.cmd`.

Elle: `.env.example` → `.env`, `npm ci`, `npm run start:env`.
