import {readFileSync} from 'node:fs';
import {Client, Events, GatewayIntentBits, Options, PermissionFlagsBits} from 'discord.js';
import {findLink, findProfanity, loadWords} from './filters.js';

// Botun yazdığı bütün metinler ve susturma süresi src/mesajlar.json'da; düzenlemek için yalnızca o dosya.
let TEXT;
try {
  TEXT = JSON.parse(readFileSync(new URL('./mesajlar.json', import.meta.url), 'utf8'));
} catch (error) {
  console.error(`src/mesajlar.json okunamadı (virgül ya da tırnak eksik olabilir): ${error.message}`);
  process.exit(1);
}
/** "{kisi} ..." gibi yerleri doldurur. */
const fill = (template, values) => String(template ?? '').replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all));

/**
 * Barbeque destek sunucusu botu (guard): link ve küfür engeli.
 * Yasak mesaj silinir, yazan susturulur (zaman aşımı), kanalda birkaç saniye görünen bir uyarı gider,
 * LOG_CHANNEL_ID varsa kayıt düşülür.
 * Mesajı yönetme ya da yönetici yetkisi olanlara (yetkililer) ve botlara dokunulmaz. Düzenlenen mesaj da denetlenir.
 *
 * Ayarlar (bbq-deploy panelinden ajan verir; elle çalıştırırken .env):
 *   MICUP_TOKEN       destek botunun token'ı
 *   LOG_CHANNEL_ID    silinen mesajların yazılacağı kanal (isteğe bağlı)
 *   ALLOWED_DOMAINS   izinli alan adları, virgülle (vars. micup.gg); davet linkleri her zaman yasak
 */

const TOKEN = process.env.MICUP_TOKEN;
if (!TOKEN) {
  console.error('MICUP_TOKEN yok. Panelde destek botunun token\'ını gir (ya da .env dosyasına yaz).');
  process.exit(1);
}
const LOG_CHANNEL_ID = (process.env.LOG_CHANNEL_ID || '').trim() || null;
const ALLOWED = (process.env.ALLOWED_DOMAINS ?? 'micup.gg')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  .filter(Boolean);
const WARNING_MS = (Number(TEXT.uyariSilinmeSaniye) || 6) * 1000;
const WARN_EVERY_MS = 10_000;

const words = loadWords();
console.log(`Küfür listesi: ${words.exact.size} kelime, ${words.prefixes.length} kök. İzinli alan adları: ${ALLOWED.join(', ') || 'yok'}.`);

// Micup adresleri ayarlanmazsa discord.js token'ı discord.com'a gönderir.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  rest: {api: 'https://micup.gg/api', cdn: 'https://media.micup.gg', mediaProxy: 'https://media.micup.gg'},
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 20,
    PresenceManager: 0,
    GuildEmojiManager: 0,
    ThreadMemberManager: 0,
  }),
});

// Link ya da küfür yazan susturulur (zaman aşımı, süre mesajlar.json'da). Botun "Üyelere zaman aşımı uygula" izni olmalı
// ve rolü kişinin en yüksek rolünden üstte olmalı; olmazsa yalnızca mesaj silinir. 0 yazılırsa kimse susturulmaz.
const TIMEOUT_SECONDS = Math.max(0, Number(TEXT.susturmaSaniye ?? 60) || 0);
const TIMEOUT_MS = TIMEOUT_SECONDS * 1000;
/** Süre metni: 60 → "1 dakika", 90 → "90 saniye", 3600 → "1 saat". */
const DURATION =
  TIMEOUT_SECONDS % 3600 === 0 && TIMEOUT_SECONDS >= 3600
    ? `${TIMEOUT_SECONDS / 3600} saat`
    : TIMEOUT_SECONDS % 60 === 0 && TIMEOUT_SECONDS >= 60
      ? `${TIMEOUT_SECONDS / 60} dakika`
      : `${TIMEOUT_SECONDS} saniye`;

/** Kişiye zaman aşımı verir; verildiyse (ya da zaten susturulmuşsa) true. */
async function mute(message, kind) {
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!TIMEOUT_MS || !member) return false;
  if (member.isCommunicationDisabled?.()) return true;
  return member.timeout(TIMEOUT_MS, fill(TEXT.zamanAsimiSebebi?.[kind], {})).then(
    () => true,
    (error) => {
      console.warn(`Zaman aşımı verilemedi (${message.author.id}): ${error.message} — botun "Üyelere zaman aşımı uygula" izni olmalı ve rolü kişininkinden yüksek olmalı.`);
      return false;
    },
  );
}

/** Yetkililer (mesaj yönetme ya da yönetici) ve botlar denetlenmez. */
function exempt(message) {
  if (message.author?.bot || !message.guild) return true;
  const perms = message.member?.permissions;
  return Boolean(perms?.has(PermissionFlagsBits.ManageMessages) || perms?.has(PermissionFlagsBits.Administrator));
}

function check(content) {
  const link = findLink(content, ALLOWED);
  if (link) return {kind: 'link', match: link};
  const word = findProfanity(content, words);
  if (word) return {kind: 'kufur', match: word};
  return null;
}

const lastWarned = new Map();
async function warn(message, kind, muted) {
  const key = `${message.channelId}:${message.author.id}`;
  if (Date.now() - (lastWarned.get(key) ?? 0) < WARN_EVERY_MS) return;
  lastWarned.set(key, Date.now());
  if (lastWarned.size > 5_000) lastWarned.clear();
  const values = {kisi: `<@${message.author.id}>`, id: message.author.id, kanal: `<#${message.channelId}>`, sure: DURATION};
  const text = fill(TEXT.uyari?.[kind], values) + (muted ? fill(TEXT.susturuldu, values) : '');
  const sent = await message.channel.send({content: text, allowedMentions: {users: [message.author.id]}}).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), WARNING_MS).unref();
}

async function logRemoval(message, verdict, muted) {
  if (!LOG_CHANNEL_ID) return;
  const channel = message.client.channels.cache.get(LOG_CHANNEL_ID) ?? (await message.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null));
  if (!channel?.send) return;
  const content = (message.content ?? '').replace(/`/g, 'ˋ').slice(0, 1500);
  await channel
    .send({
      content: `${fill(TEXT.log?.satir, {
        tur: TEXT.log?.tur?.[verdict.kind] ?? verdict.kind,
        susturma: muted ? fill(TEXT.log?.susturma, {sure: DURATION}) : '',
        kisi: `<@${message.author.id}>`,
        id: message.author.id,
        kanal: `<#${message.channelId}>`,
      })}\n\`\`\`\n${content}\n\`\`\``,
      allowedMentions: {parse: []},
    })
    .catch(() => {});
}

async function inspect(message) {
  try {
    if (exempt(message)) return;
    const verdict = check(message.content ?? '');
    if (!verdict) return;
    const deleted = await message.delete().then(
      () => true,
      (error) => {
        console.warn(`Mesaj silinemedi (#${message.channelId}): ${error.message} — botun "Mesajları Yönet" izni olmalı.`);
        return false;
      },
    );
    if (!deleted) return;
    const muted = await mute(message, verdict.kind);
    console.log(`${verdict.kind === 'link' ? 'Link' : 'Küfür'} silindi${muted ? `, ${DURATION} zaman aşımı` : ''}: ${message.author.username} (${message.author.id}) #${message.channelId} — ${String(verdict.match).slice(0, 60)}`);
    await Promise.all([warn(message, verdict.kind, muted), logRemoval(message, verdict, muted)]);
  } catch (error) {
    console.error('Mesaj denetlenemedi:', error);
  }
}

client.on(Events.MessageCreate, inspect);
client.on(Events.MessageUpdate, async (_old, message) => {
  if (message.partial) message = await message.fetch().catch(() => null);
  if (message) await inspect(message);
});
client.once(Events.ClientReady, (ready) => console.log(`Barbeque Destek hazır: ${ready.user.username} (${ready.guilds.cache.size} sunucu).`));

process.on('unhandledRejection', (error) => console.error('Yakalanmamış hata:', error));

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await client.destroy();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
// bbq-deploy ajanı Windows'ta botu IPC "shutdown" mesajıyla kapatır; ajan kapanırsa bağlantı kopar ve bot da kapanır.
if (process.send) {
  process.on('message', (message) => message === 'shutdown' && shutdown());
  process.once('disconnect', shutdown);
}

// Giriş hataları anlaşılır yazılsın: ajan botu yeniden dener, ne yapılması gerektiği çıktıda görünsün.
const HINTS = {
  'Used disallowed intents':
    'Micup bu botta mesaj içeriği yetkisine izin vermiyor. Micup > Ayarlar > Uygulamalar > destek botu > Bot bölümünde "Message Content Intent" anahtarını aç.',
  'An invalid token was provided.': "Token geçersiz. Panelde Destek sayfasına destek botunun token'ını yeniden yapıştır.",
};
try {
  await client.login(TOKEN);
} catch (error) {
  console.error(`Micup'a bağlanılamadı: ${HINTS[error.message] ?? error.message}`);
  process.exit(1);
}
client.on(Events.Error, (error) => console.error('Bağlantı hatası:', HINTS[error.message] ?? error.message));
