import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * Ceza kademesi: her ihlal sayılır; kısa sürede çok ihlal eden sunucudan atılır, atıldıktan sonra geri gelip devam
 * eden banlanır. Kayıtlar veri/ihlaller.json'da durur (bot yeniden başlayınca atılma bilgisi kaybolmasın; dosya
 * .gitignore'da, güncellemede silinmez).
 *
 * record(sunucu, kişi) → 'mute' | 'kick' | 'ban'. Ceza uygulanınca kicked() ya da banned() çağrılır.
 */
const FILE = fileURLToPath(new URL('../veri/ihlaller.json', import.meta.url));
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function createStrikes({kickAfter = 3, windowHours = 24, banAfter = 2, rememberKickDays = 30, now = Date.now} = {}) {
  const data = load();
  const windowMs = windowHours * HOUR;
  const rememberMs = rememberKickDays * DAY;
  let timer = null;

  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const t = now();
      // Süresi geçmiş kayıtlar atılır, dosya büyümesin.
      for (const [key, entry] of Object.entries(data)) {
        if (entry.kickedAt && t - entry.kickedAt > rememberMs) entry.kickedAt = null;
        entry.times = entry.times.filter((x) => t - x < Math.max(windowMs, entry.kickedAt ? rememberMs : 0));
        if (!entry.times.length && !entry.kickedAt) delete data[key];
      }
      try {
        mkdirSync(fileURLToPath(new URL('../veri/', import.meta.url)), {recursive: true});
        writeFileSync(FILE + '.tmp', JSON.stringify(data));
        renameSync(FILE + '.tmp', FILE);
      } catch (error) {
        console.warn('İhlal kayıtları yazılamadı:', error.message);
      }
    }, 2_000);
    timer.unref?.();
  }

  return {
    record(guildId, userId) {
      const key = `${guildId}:${userId}`;
      const t = now();
      const entry = (data[key] ??= {times: [], kickedAt: null});
      if (entry.kickedAt && t - entry.kickedAt > rememberMs) entry.kickedAt = null;
      entry.times.push(t);
      save();
      if (entry.kickedAt) {
        const since = entry.times.filter((x) => x > entry.kickedAt).length;
        return banAfter > 0 && since >= banAfter ? 'ban' : 'mute';
      }
      const recent = entry.times.filter((x) => t - x < windowMs).length;
      return kickAfter > 0 && recent >= kickAfter ? 'kick' : 'mute';
    },
    kicked(guildId, userId) {
      data[`${guildId}:${userId}`] = {times: [], kickedAt: now()};
      save();
    },
    banned(guildId, userId) {
      delete data[`${guildId}:${userId}`];
      save();
    },
  };
}
