import {readFileSync} from 'node:fs';
import {Client, Events, GatewayIntentBits, Options, PermissionFlagsBits} from 'discord.js';
import {findJoined, findLink, findProfanity, loadWords} from './filters.js';
import {createStrikes} from './ihlaller.js';

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

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback);
const strikes = createStrikes({
  kickAfter: num(TEXT.ceza?.atmaIcinIhlal, 3),
  windowHours: num(TEXT.ceza?.ihlalSuresiSaat, 24) || 24,
  banAfter: num(TEXT.ceza?.banIcinIhlal, 2),
  rememberKickDays: num(TEXT.ceza?.atilmaHatirlamaGun, 30) || 30,
});

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
  return member.timeout(TIMEOUT_MS, fill(TEXT.sebep?.susturma?.[kind], {})).then(
    () => true,
    (error) => {
      console.warn(`Zaman aşımı verilemedi (${message.author.id}): ${error.message} — botun "Üyelere zaman aşımı uygula" izni olmalı ve rolü kişininkinden yüksek olmalı.`);
      return false;
    },
  );
}

const valuesOf = (message) => ({
  kisi: `<@${message.author.id}>`,
  ad: message.author.globalName ?? message.author.username,
  id: message.author.id,
  kanal: `<#${message.channelId}>`,
  sunucu: message.guild?.name ?? '',
  sure: DURATION,
});

/** Atmadan/banlamadan önce kişiye özelden haber; özel mesajı kapalıysa sessizce geçer. */
const notify = (user, template, values) => user.send({content: fill(template, values), allowedMentions: {parse: []}}).catch(() => {});

/** Üst üste ihlal: sunucudan atar. Atılabildiyse true. */
async function kick(message) {
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return false;
  await notify(message.author, TEXT.ozelMesaj?.atildi, valuesOf(message));
  return member.kick(fill(TEXT.sebep?.atma, {})).then(
    () => true,
    (error) => {
      console.warn(`Sunucudan atılamadı (${message.author.id}): ${error.message} — botun "Üyeleri At" izni olmalı ve rolü kişininkinden yüksek olmalı.`);
      return false;
    },
  );
}

/** Atıldıktan sonra da devam: banlar. Banlanabildiyse true. */
async function ban(message) {
  await notify(message.author, TEXT.ozelMesaj?.banlandi, valuesOf(message));
  return message.guild.members.ban(message.author.id, {reason: fill(TEXT.sebep?.ban, {})}).then(
    () => true,
    (error) => {
      console.warn(`Banlanamadı (${message.author.id}): ${error.message} — botun "Üyeleri Yasakla" izni olmalı ve rolü kişininkinden yüksek olmalı.`);
      return false;
    },
  );
}

/** Kanalda birkaç saniye görünen duyuru. */
async function announce(message, text) {
  const sent = await message.channel.send({content: text, allowedMentions: {parse: []}}).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), WARNING_MS).unref();
}

/** Log kanalına yazar (LOG_CHANNEL_ID yoksa hiçbir şey yapmaz). */
async function sendLog(client, content) {
  if (!LOG_CHANNEL_ID) return;
  const channel = client.channels.cache.get(LOG_CHANNEL_ID) ?? (await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null));
  if (channel?.send) await channel.send({content, allowedMentions: {parse: []}}).catch(() => {});
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

// Art arda kısa mesajlarla bölünmüş yazım ("Oros", "Pu", "Ço", "Cı"): kişinin aynı kanalda son FRAGMENT_MS içindeki
// kısa mesajları birleştirilip denetlenir; küfür çıkarsa parçaların hepsi silinir.
const FRAGMENT_MAX_CHARS = 15;
const FRAGMENT_MS = 15_000;
const FRAGMENT_COUNT = 10;
const fragments = new Map();

function fragmentVerdict(message) {
  const text = (message.content ?? '').trim();
  const key = `${message.channelId}:${message.author.id}`;
  const now = Date.now();
  if (!text || text.length > FRAGMENT_MAX_CHARS) {
    fragments.delete(key);
    return null;
  }
  const list = (fragments.get(key) ?? []).filter((item) => now - item.at < FRAGMENT_MS);
  list.push({message, at: now});
  while (list.length > FRAGMENT_COUNT) list.shift();
  if (fragments.size > 5_000) fragments.clear();
  fragments.set(key, list);
  // Son 2, son 3 ... parça: küfür hangi parçadan başlarsa başlasın yakalanır.
  for (let k = 2; k <= list.length; k++) {
    const parts = list.slice(-k);
    const match = findJoined(
      parts.map((item) => item.message.content),
      words,
    );
    if (match) {
      fragments.delete(key);
      return {kind: 'kufur', match, messages: parts.map((item) => item.message)};
    }
  }
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
  const original = verdict.messages ? verdict.messages.map((m) => m.content).join('\n') : message.content;
  const content = (original ?? '').replace(/`/g, 'ˋ').slice(0, 1500);
  const line = fill(TEXT.log?.satir, {
    ...valuesOf(message),
    tur: TEXT.log?.tur?.[verdict.kind] ?? verdict.kind,
    susturma: muted ? fill(TEXT.log?.susturma, {sure: DURATION}) : '',
  });
  await sendLog(message.client, `${line}\n\`\`\`\n${content}\n\`\`\``);
}

async function inspect(message, {edited = false} = {}) {
  try {
    if (exempt(message)) return;
    // Düzenlenen mesaj parça birleştirmeye girmez (aynı mesaj iki kez sayılmasın).
    const verdict = check(message.content ?? '') ?? (edited ? null : fragmentVerdict(message));
    if (!verdict) return;
    // Parçalara bölünmüş küfürde öbür parçalar da silinir.
    const others = (verdict.messages ?? []).filter((m) => m.id !== message.id);
    await Promise.all(others.map((m) => m.delete().catch(() => {})));
    const deleted = await message.delete().then(
      () => true,
      (error) => {
        console.warn(`Mesaj silinemedi (#${message.channelId}): ${error.message} — botun "Mesajları Yönet" izni olmalı.`);
        return false;
      },
    );
    if (!deleted) return;
    // Ceza kademesi: üst üste ihlalde atma, atıldıktan sonra devamında ban. Yapılamazsa (izin yok) susturmaya düşer.
    const action = strikes.record(message.guild.id, message.author.id);
    if (action === 'ban' && (await ban(message))) {
      strikes.banned(message.guild.id, message.author.id);
      console.log(`Banlandı: ${message.author.username} (${message.author.id})`);
      await Promise.all([announce(message, fill(TEXT.banlandi, valuesOf(message))), logRemoval(message, verdict, false), sendLog(message.client, fill(TEXT.log?.banlandi, valuesOf(message)))]);
      return;
    }
    if (action === 'kick' && (await kick(message))) {
      strikes.kicked(message.guild.id, message.author.id);
      console.log(`Sunucudan atıldı: ${message.author.username} (${message.author.id})`);
      await Promise.all([announce(message, fill(TEXT.atildi, valuesOf(message))), logRemoval(message, verdict, false), sendLog(message.client, fill(TEXT.log?.atildi, valuesOf(message)))]);
      return;
    }
    const muted = await mute(message, verdict.kind);
    console.log(`${verdict.kind === 'link' ? 'Link' : 'Küfür'} silindi${muted ? `, ${DURATION} zaman aşımı` : ''}: ${message.author.username} (${message.author.id}) #${message.channelId} — ${String(verdict.match).slice(0, 60)}`);
    await Promise.all([warn(message, verdict.kind, muted), logRemoval(message, verdict, muted)]);
  } catch (error) {
    console.error('Mesaj denetlenemedi:', error);
  }
}

client.on(Events.MessageCreate, (message) => inspect(message));
client.on(Events.MessageUpdate, async (_old, message) => {
  if (message.partial) message = await message.fetch().catch(() => null);
  if (message) await inspect(message, {edited: true});
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
