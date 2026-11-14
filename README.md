# Barbeque Destek

Barbeque'nin Micup destek sunucusu botu. Şimdilik **guard**: link ve küfür engeli.

- Yasak mesaj silinir, yazan **1 dakika susturulur** (zaman aşımı), kanalda 6 sn görünen bir uyarı gider, log kanalı ayarlıysa kayıt düşülür.
- Yetkililere (Mesajları Yönet / Yönetici) ve botlara dokunulmaz. Düzenlenen mesajlar da denetlenir.
- Link: http(s), www., çıplak alan adı (site.com), davetler (micup.gg/invite, discord.gg...). İzinli alan adları ayarlanabilir (vars. micup.gg); davetler her zaman yasak.
- Küfür: `src/kufur.txt`. `kelime*` kelime başı olarak eşleşir, yıldızsız kelime yalnızca tamamı. Harf tekrarı (amkkk), araya işaret (s.i.k), boşluklu harf (s i k), rakamla yazma (5ik) ve Türkçe karaktersiz yazım yakalanır.

Botun sunucuda **Mesajları Yönet** ve **Üyelere zaman aşımı uygula** izni olmalı, rolü üyelerin rollerinden üstte olmalı; Micup'ta bot uygulamasında Message Content yetkisi açık olmalı.

## Çalıştırma

VDS'te bbq-deploy ajanı yönetir: panelde **Destek** sayfasından token'ı gir; ajan repoyu `C:\Barbeque\destek` klasörüne çeker, kurar, başlatır, push'ta günceller, çökerse yeniden açar. Çıktıyı izlemek için `C:\Barbeque\destek-izle.cmd`.

Elle: `.env.example` → `.env`, `npm ci`, `npm run start:env`.
