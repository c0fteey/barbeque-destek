import {readFileSync} from 'node:fs';

/**
 * Guard süzgeçleri: mesajda link ya da küfür var mı. Saf fonksiyonlar; Micup'a dokunmaz.
 *
 * Küfür listesi (kufur.txt): satır başına bir kelime. Sonu * ise kelime başı olarak eşleşir ("orospu*" →
 * "orospuçocuğu"), değilse yalnızca kelimenin tamamı ("göt" eşleşir, "götür" eşleşmez). Masum kelimelere
 * (şikayet, sikke, götür, ama, ananas) takılmasın diye kısa kökler yıldızsız yazılır.
 *
 * Kandırma yolları da yakalanır: büyük/küçük harf, tekrar eden harf ("amkkk"), araya konan işaret ("s.i.k"),
 * tek tek boşluklu harf ("s i k"), rakamla yazma ("5ik", "0rospu"), Türkçe karakter olmadan yazma ("amcik" ↔ "amcık";
 * 3 harften kısa kelimelerde değil: "pic", "got" masum).
 */

export const WORDS_FILE = new URL('./kufur.txt', import.meta.url);

const LEET = {0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '€': 'e', '!': 'i'};
const ASCII = {ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u'};

/** Küçük harf, rakam/işaret yerine harf, tekrar eden harfler teke. Türkçe harfler korunur. */
export function normalize(text) {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .replace(/[01345789@$€!]/g, (c) => LEET[c] ?? c)
    .replace(/(\p{L})\1+/gu, '$1');
}

/** Türkçe karakterler olmadan ("amcık" → "amcik"). */
export const ascii = (text) => text.replace(/[çğıöşüâîû]/g, (c) => ASCII[c]);

/** Metin dosyasından {exact: Set, prefixes: []}. Her kelime hem Türkçe hem Türkçe karaktersiz haliyle eklenir. */
export function parseWords(text) {
  const exact = new Set();
  const prefixes = new Set();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;
    const prefix = raw.endsWith('*');
    const word = normalize(prefix ? raw.slice(0, -1) : raw);
    // Kısa kelimelerin Türkçe karaktersiz hali eklenmez: "piç" → "pic" (İngilizce resim), "göt" → "got" masum.
    const forms = word.length > 3 ? [word, ascii(word)] : [word];
    for (const form of new Set(forms)) (prefix ? prefixes : exact).add(form);
  }
  return {exact, prefixes: [...prefixes]};
}

export function loadWords(file = WORDS_FILE) {
  return parseWords(readFileSync(file, 'utf8'));
}

/** Mesajın aday kelimeleri: kelimeler, işaretleri atılmış kelimeler ve tek harflerin birleşimi ("s i k" → "sik"). */
function candidates(content) {
  const tokens = content.split(/\s+/).filter(Boolean);
  const out = new Set();
  let letters = '';
  const flush = () => {
    if (letters.length >= 2) out.add(normalize(letters));
    letters = '';
  };
  for (const token of tokens) {
    const n = normalize(token);
    for (const part of n.split(/[^\p{L}]+/u)) if (part) out.add(part);
    const joined = n.replace(/[^\p{L}]+/gu, '');
    if (joined) out.add(joined.replace(/(\p{L})\1+/gu, '$1'));
    // Tek harfli parçalar ("s", "i", "k") birleştirilir.
    if (joined.length === 1) letters += joined;
    else flush();
  }
  flush();
  return out;
}

/** Küfürlü kelime varsa onu döndürür, yoksa null. */
export function findProfanity(content, words) {
  if (!content) return null;
  // Kişi Türkçe karakterle yazdıysa kelime olduğu gibi karşılaştırılır: "sıkıştım" Türkçe karaktersiz "sikistim" olup
  // "sikiş" köküne takılmasın. Türkçe karaktersiz yazılanlar listedeki karaktersiz hallerle zaten eşleşir.
  for (const candidate of candidates(content)) {
    if (words.exact.has(candidate)) return candidate;
    if (words.prefixes.some((prefix) => candidate.startsWith(prefix))) return candidate;
  }
  return null;
}

// ---------- linkler ----------

const TLDS = [
  'com', 'net', 'org', 'gg', 'io', 'xyz', 'me', 'tv', 'co', 'ru', 'tk', 'ml', 'ga', 'cf', 'gq', 'link', 'site', 'online', 'shop',
  'store', 'app', 'dev', 'tr', 'info', 'biz', 'club', 'live', 'top', 'fun', 'ly', 'to', 'cc', 'ws', 'su', 'pw', 'icu', 'click',
  'win', 'vip', 'pro', 'one', 'lol', 'gift', 'gifts', 'us', 'uk', 'de', 'eu',
];
const URL_RE = /\bhttps?:\/\/[^\s<>]+/gi;
const WWW_RE = /\bwww\.[^\s<>]+/gi;
// Çıplak alan adı: "site.com", "discord.gg/abc", "sub.domain.com.tr/yol". Nokta etrafındaki boşlukla kandırma: "site . com".
const BARE_RE = new RegExp(`\\b((?:[a-z0-9-]+\\s?\\.\\s?)+(?:${TLDS.join('|')}))\\b(\\/[^\\s<>]*)?`, 'gi');
const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite|micup\.gg\/invite|dsc\.gg|invite\.gg)\//i;

const hostOf = (link) => {
  const cleaned = link.replace(/\s+/g, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return cleaned.split(/[/?#:]/)[0].toLowerCase();
};

/**
 * Mesajdaki yasak link (yoksa null). allowed: izinli alan adları ("micup.gg" → micup.gg ve alt alanları).
 * Davet linkleri izinli alan adında olsa bile yasaktır (micup.gg/invite/...).
 */
export function findLink(content, allowed = []) {
  if (!content) return null;
  const found = [...(content.match(URL_RE) ?? []), ...(content.match(WWW_RE) ?? []), ...(content.match(BARE_RE) ?? [])];
  for (const link of found) {
    if (INVITE_RE.test(link.replace(/\s+/g, ''))) return link;
    const host = hostOf(link);
    if (!host || !host.includes('.')) continue;
    if (allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue;
    return link;
  }
  return null;
}
