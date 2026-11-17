import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * Mesajla XP: kişi dakikada en fazla bir kez 15-25 XP kazanır (art arda yazmak XP'yi şişirmez); mesaj sayısı her mesajda artar.
 * Seviye L'den L+1'e geçmek için L × 400 XP gerekir (seviye 6 → 7: 2.400 XP).
 * Kayıtlar veri/seviye.json'da (git'te değil, güncellemede silinmez).
 */
const DIR = fileURLToPath(new URL('../veri/', import.meta.url));
const FILE = fileURLToPath(new URL('../veri/seviye.json', import.meta.url));
const COOLDOWN_MS = 60_000;
const XP_MIN = 15;
const XP_MAX = 25;
export const XP_PER_LEVEL = 400;

/** Toplam XP'den seviye bilgisi: {level, current (bu seviyede toplanan), needed (sonraki seviyeye gereken), percent}. */
export function levelInfo(xp) {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= level * XP_PER_LEVEL) {
    rest -= level * XP_PER_LEVEL;
    level++;
  }
  const needed = level * XP_PER_LEVEL;
  return {level, current: rest, needed, percent: Math.floor((rest / needed) * 100)};
}

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function createLevels({now = Date.now, random = Math.random} = {}) {
  const data = load();
  let timer = null;

  function save() {
    clearTimeout(timer);
    // Her mesajda diske yazılmaz; birkaç saniyede bir toplu yazılır.
    timer = setTimeout(() => {
      try {
        mkdirSync(DIR, {recursive: true});
        writeFileSync(`${FILE}.tmp`, JSON.stringify(data));
        renameSync(`${FILE}.tmp`, FILE);
      } catch (error) {
        console.error(`veri/seviye.json yazılamadı: ${error.message}`);
      }
    }, 5_000);
    timer.unref?.();
  }

  return {
    /** Sunucuda bot olmayan birinin mesajı. */
    onMessage(message) {
      if (message.author?.bot || !message.guild) return;
      const id = message.author.id;
      const entry = (data[id] ??= {xp: 0, messages: 0, last: 0});
      entry.messages++;
      const t = now();
      if (t - entry.last >= COOLDOWN_MS) {
        entry.xp += XP_MIN + Math.floor(random() * (XP_MAX - XP_MIN + 1));
        entry.last = t;
      }
      save();
    },
    get(userId) {
      const entry = data[userId] ?? {xp: 0, messages: 0};
      return {xp: entry.xp, messages: entry.messages, ...levelInfo(entry.xp)};
    },
  };
}
