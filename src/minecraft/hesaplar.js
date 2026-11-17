import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/**
 * /account ile kaydedilen Minecraft hesapları: Micup kullanıcı ID'si → {nick, uuid, savedAt}.
 * veri/minecraft.json'da durur (dosya .gitignore'da, güncellemede silinmez).
 */
const DIR = fileURLToPath(new URL('../../veri/', import.meta.url));
const FILE = fileURLToPath(new URL('../../veri/minecraft.json', import.meta.url));

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function createAccounts() {
  const data = load();

  function save() {
    try {
      mkdirSync(DIR, {recursive: true});
      // Önce geçici dosyaya yazılır; yazarken kapanırsa eski dosya bozulmaz.
      writeFileSync(`${FILE}.tmp`, JSON.stringify(data, null, 2));
      renameSync(`${FILE}.tmp`, FILE);
    } catch (error) {
      console.error(`veri/minecraft.json yazılamadı: ${error.message}`);
    }
  }

  return {
    get: (userId) => data[userId] ?? null,
    set(userId, {nick, uuid}) {
      data[userId] = {nick, uuid, savedAt: Date.now()};
      save();
      return data[userId];
    },
  };
}
