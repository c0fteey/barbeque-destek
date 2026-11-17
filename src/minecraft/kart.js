import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';
import {renderSkin} from './render3d.js';

/**
 * /profil kartı (1200×500): solda gece sahnesinde 3D skin, sağda kişi ve Minecraft hesabı, en sağda skinin yüzü.
 */
const font = (file) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
GlobalFonts.registerFromPath(font('ArchivoBlack-Regular.ttf'), 'Kart Display');
GlobalFonts.registerFromPath(font('Poppins-Medium.ttf'), 'Kart Text');
GlobalFonts.registerFromPath(font('Poppins-SemiBold.ttf'), 'Kart Text SemiBold');

export const WIDTH = 1200;
export const HEIGHT = 500;
const C = {
  frame: '#3f63e6',
  frameDots: 'rgba(255,255,255,0.10)',
  card: '#151b27',
  cardEdge: '#0b0f17',
  glow: 'rgba(84,214,140,0.16)',
  text: '#f2f5fb',
  muted: '#8f9ab0',
  chip: '#232b3b',
  chipEdge: '#0b0f17',
  accent: '#5fd68f',
  amber: '#f4b25f',
  night: '#1c2740',
  nightDeep: '#121a2d',
  moon: '#f6e3a1',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Yarım ton nokta deseni. */
function dots(ctx, x, y, w, h, step, radius, color) {
  ctx.fillStyle = color;
  for (let py = y + step / 2; py < y + h; py += step)
    for (let px = x + step / 2; px < x + w; px += step) {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
}

/** Dört köşeli parıltı. */
function sparkle(ctx, x, y, s, color = '#ffffff') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

/** Metni genişliğe sığana kadar küçültür, gerekirse sonunu keser. */
function fitText(ctx, text, maxWidth, size, family) {
  let s = size;
  ctx.font = `${s}px "${family}"`;
  while (ctx.measureText(text).width > maxWidth && s > size * 0.6) {
    s -= 2;
    ctx.font = `${s}px "${family}"`;
  }
  let t = text;
  while (ctx.measureText(t).width > maxWidth && t.length > 1) t = t.slice(0, -1);
  return t === text ? t : `${t.slice(0, -1)}…`;
}

/** Etiketli kutucuk: solda renkli değer, sağda açıklama. Genişliği döner. */
function chip(ctx, x, y, value, label, color) {
  ctx.font = '22px "Kart Text SemiBold"';
  const vw = ctx.measureText(value).width + 28;
  ctx.font = '20px "Kart Text SemiBold"';
  const lw = label ? ctx.measureText(label).width + 26 : 0;
  const h = 46;
  roundRect(ctx, x, y, vw + lw, h, 12);
  ctx.fillStyle = C.chip;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.chipEdge;
  ctx.stroke();
  roundRect(ctx, x + 3, y + 3, vw - 3, h - 6, 10);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#10151f';
  ctx.font = '22px "Kart Text SemiBold"';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x + 14, y + h / 2 + 1);
  if (label) {
    ctx.fillStyle = C.text;
    ctx.font = '20px "Kart Text SemiBold"';
    ctx.fillText(label, x + vw + 12, y + h / 2 + 1);
  }
  return vw + lw;
}

/** Sol panel: gece gökyüzü, ay, yaylar, parıltılar, gölge ve 3D skin. */
function skinPanel(ctx, x, y, w, h, skin, slim) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 20);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, C.night);
  sky.addColorStop(1, C.nightDeep);
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  dots(ctx, x, y, w, h, 13, 2.2, 'rgba(120,140,190,0.16)');
  // Ay ve hâlesi
  const mx = x + w * 0.66;
  const my = y + h * 0.27;
  for (const [r, a] of [
    [w * 0.48, 0.05],
    [w * 0.4, 0.07],
    [w * 0.32, 0.09],
  ]) {
    ctx.fillStyle = `rgba(246,227,161,${a})`;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.moon;
  ctx.beginPath();
  ctx.arc(mx, my, w * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(214,190,120,0.35)';
  ctx.beginPath();
  ctx.arc(mx + w * 0.07, my + w * 0.04, w * 0.035, 0, Math.PI * 2);
  ctx.fill();
  // Kafanın üstündeki yaylar
  ctx.strokeStyle = 'rgba(170,178,196,0.55)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const r of [0.2, 0.26, 0.32]) {
    ctx.beginPath();
    ctx.arc(x + w * 0.52, y + h * 0.2, w * r, Math.PI * 1.22, Math.PI * 1.78);
    ctx.stroke();
  }
  for (const [sx, sy, s] of [
    [0.13, 0.17, 8],
    [0.12, 0.62, 7],
    [0.86, 0.8, 7],
    [0.9, 0.1, 5],
  ])
    sparkle(ctx, x + w * sx, y + h * sy, s, '#fff6dc');
  // Ayak gölgesi
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  shadow.addColorStop(0, 'rgba(0,0,0,0.6)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  // Taslak 1 pozunda ayaklar panelin yaklaşık %80'inde.
  ctx.translate(x + w * 0.47, y + h * 0.82);
  ctx.scale(w * 0.32, h * 0.03);
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Skin 2 kat çözünürlükte çizilip küçültülür (kenarlar yumuşak olsun).
  const render = renderSkin(skin, {width: w * 2, height: h * 2, slim});
  ctx.drawImage(render, x, y, w, h);
  ctx.restore();
  roundRect(ctx, x, y, w, h, 20);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.cardEdge;
  ctx.stroke();
}

/** Skinin yüzü (iç + dış katman), piksel piksel büyütülmüş. */
function face(ctx, pixels, x, y, size) {
  const cell = size / 8;
  for (const [u, v] of [
    [8, 8],
    [40, 8],
  ])
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const i = ((v + r) * 64 + u + c) * 4;
        if (pixels[i + 3] < 16) continue;
        ctx.fillStyle = `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`;
        ctx.fillRect(Math.floor(x + c * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
      }
}

/** Sekizgen çerçeve (sağdaki yüz rozeti). */
function octagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    ctx[k ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

const DATE = new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long', year: 'numeric'});
const dashedUuid = (id) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/**
 * Kartı PNG olarak döner.
 * name: Micup'taki görünen ad; username: kullanıcı adı; avatar: yüklenmiş resim ya da null;
 * account: {nick, uuid, savedAt}; skin: readSkin() sonucu; slim: ince kollu model mi.
 */
export async function renderCard({name, username, avatar, account, skin, slim}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Dış çerçeve
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 44);
  ctx.fillStyle = C.frame;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 44);
  ctx.clip();
  dots(ctx, 0, 0, WIDTH, HEIGHT, 16, 3, C.frameDots);
  ctx.restore();

  // İç kart
  const cx = 32;
  const cy = 32;
  const cw = WIDTH - 64;
  const ch = HEIGHT - 64;
  roundRect(ctx, cx, cy, cw, ch, 30);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 30);
  ctx.clip();
  // Sağdaki rozetin arkasında yeşil ışık hüzmeleri
  const bx = 1010;
  const by = 190;
  ctx.fillStyle = C.glow;
  for (let k = 0; k < 18; k++) {
    const a = (k * Math.PI * 2) / 18;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.arc(bx, by, 900, a, a + Math.PI / 36);
    ctx.closePath();
    ctx.fill();
  }
  const fade = ctx.createLinearGradient(cx, 0, cx + 700, 0);
  fade.addColorStop(0, C.card);
  fade.addColorStop(1, 'rgba(21,27,39,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(cx, cy, 700, ch);
  ctx.restore();
  roundRect(ctx, cx, cy, cw, ch, 30);
  ctx.lineWidth = 5;
  ctx.strokeStyle = C.cardEdge;
  ctx.stroke();

  // Sol: 3D skin (editördeki sahneyle aynı en-boy oranı)
  skinPanel(ctx, 56, 56, 240, 388, skin, slim);

  // Avatar
  const ax = 330;
  const ay = 64;
  const as = 104;
  roundRect(ctx, ax, ay, as, as, 22);
  ctx.fillStyle = C.chip;
  ctx.fill();
  if (avatar) {
    ctx.save();
    roundRect(ctx, ax, ay, as, as, 22);
    ctx.clip();
    ctx.drawImage(avatar, ax, ay, as, as);
    ctx.restore();
  }
  roundRect(ctx, ax, ay, as, as, 22);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.cardEdge;
  ctx.stroke();

  // Ad ve kullanıcı adı
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  const shownName = fitText(ctx, name, 420, 48, 'Kart Display');
  ctx.fillText(shownName, 458, 122);
  ctx.fillStyle = C.muted;
  ctx.font = '24px "Kart Text"';
  ctx.fillText(fitText(ctx, `@${username}`, 420, 24, 'Kart Text'), 460, 158);

  // Kutucuklar: Minecraft adı ve model
  let x = 330;
  x += chip(ctx, x, 200, account.nick, 'Minecraft', C.accent) + 14;
  chip(ctx, x, 200, slim ? 'İnce' : 'Klasik', 'Model', C.amber);

  // Hesap kutusu
  roundRect(ctx, 330, 270, 560, 74, 16);
  ctx.fillStyle = C.chip;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.chipEdge;
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.font = '22px "Kart Text SemiBold"';
  ctx.fillText('Minecraft hesabı bağlı', 352, 301);
  ctx.fillStyle = C.muted;
  ctx.font = '17px "Kart Text"';
  ctx.fillText(`UUID ${dashedUuid(account.uuid)}`, 352, 328);

  // Alt satır: bağlanma tarihi
  ctx.fillStyle = C.text;
  ctx.font = '24px "Kart Text SemiBold"';
  ctx.fillText(DATE.format(new Date(account.savedAt ?? Date.now())), 332, 400);
  ctx.fillStyle = C.muted;
  ctx.font = '18px "Kart Text"';
  ctx.fillText('tarihinde /account ile bağlandı', 332, 428);

  // Sağ: skinin yüzü, sekizgen rozet içinde
  octagon(ctx, bx, by, 132);
  ctx.fillStyle = '#0b0f17';
  ctx.fill();
  octagon(ctx, bx, by, 122);
  ctx.fillStyle = C.accent;
  ctx.fill();
  octagon(ctx, bx, by, 104);
  ctx.fillStyle = '#123524';
  ctx.fill();
  face(ctx, skin.pixels, bx - 64, by - 64, 128);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.accent;
  ctx.font = '22px "Kart Text SemiBold"';
  ctx.fillText('MINECRAFT', bx, by + 166);
  ctx.fillStyle = C.text;
  ctx.font = `${account.nick.length > 12 ? 26 : 32}px "Kart Display"`;
  ctx.fillText(account.nick, bx, by + 206);
  ctx.textAlign = 'left';

  return canvas.encode('png');
}

/** Avatar resmini indirir; olmazsa null (kart avatarsız çizilir). */
export async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(4_000)});
    if (!response.ok) return null;
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    return null;
  }
}
