import {fetchMinecraftProfile, fetchMinecraftProfileSession} from '@magicyan/minecraft';

/**
 * Mojang'dan hesap ve skin bilgisi (@magicyan/minecraft ile).
 * Mojang sık istekte 429 verir: ad sorgusu yedek adresten tekrar denenir, skinler bir süre önbellekte tutulur.
 */
const SKIN_CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 8_000;
// Skini olmayan hesaplar için Minecraft'ın varsayılan Steve skini.
const STEVE = 'http://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';

export const NICK_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

/** Ada göre hesap: {nick, uuid}; böyle bir hesap yoksa null. Mojang'a ulaşılamazsa hata fırlatır. */
export async function findAccount(nick) {
  const result = await fetchMinecraftProfile(nick).catch(() => null);
  if (result?.success) return {nick: result.data.name, uuid: result.data.id};
  if (result && (result.code === 404 || result.code === 204)) return null;
  // Birincil adres yoğunsa (429) ya da yanıt vermezse eski Mojang adresi denenir.
  const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`, {signal: AbortSignal.timeout(TIMEOUT_MS)});
  if (response.status === 404 || response.status === 204) return null;
  if (!response.ok) throw new Error(`Mojang yanıt vermedi (${response.status})`);
  const data = await response.json();
  return {nick: data.name, uuid: data.id};
}

const skins = new Map();

/** Hesabın skini: {png, slim, nick}. Mojang'a ulaşılamazsa önbellekteki eski skin, o da yoksa hata. */
export async function fetchSkin(uuid) {
  const cached = skins.get(uuid);
  if (cached && Date.now() - cached.at < SKIN_CACHE_MS) return cached.skin;
  try {
    const session = await fetchMinecraftProfileSession(uuid);
    if (!session.success) throw new Error(`Mojang oturum sunucusu: ${session.error ?? session.code}`);
    const textures = session.data.properties.find((p) => p?.textures)?.textures ?? {};
    const url = textures.SKIN?.url ?? STEVE;
    const response = await fetch(url.replace(/^http:/, 'https:'), {signal: AbortSignal.timeout(TIMEOUT_MS)});
    if (!response.ok) throw new Error(`Skin indirilemedi (${response.status})`);
    const skin = {png: Buffer.from(await response.arrayBuffer()), slim: textures.SKIN?.metadata?.model === 'slim', nick: session.data.name};
    skins.set(uuid, {skin, at: Date.now()});
    if (skins.size > 500) skins.delete(skins.keys().next().value);
    return skin;
  } catch (error) {
    if (cached) return cached.skin;
    throw error;
  }
}
