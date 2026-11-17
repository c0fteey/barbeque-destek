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
  violet: '#b9a2f5',
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
  // Çizici kendi içinde büyük çizip küçültür (kenarlar yumuşak); burada panel boyutunda alınır.
  ctx.drawImage(renderSkin(skin, {width: w, height: h, slim}), x, y);
  ctx.restore();
  roundRect(ctx, x, y, w, h, 20);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.cardEdge;
  ctx.stroke();
}

/** Sekizgen yol (düz kenarları üstte ve altta). */
function octagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    ctx[k ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

/** 5×7 piksel rakamlar (seviye numarası). */
const DIGITS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

/** Sayıyı ortalanmış piksel rakamlarla, koyu dış çizgi ve gölgeyle çizer. */
function pixelNumber(ctx, text, cx, cy, maxWidth, maxCell) {
  const chars = [...String(text)].filter((ch) => DIGITS[ch]);
  const cols = chars.length * 6 - 1;
  const cell = Math.max(4, Math.min(maxCell, Math.floor(maxWidth / cols)));
  const x0 = Math.round(cx - (cols * cell) / 2);
  const y0 = Math.round(cy - (7 * cell) / 2);
  const each = (fn) =>
    chars.forEach((ch, i) =>
      DIGITS[ch].forEach((row, r) => [...row].forEach((bit, c) => bit === '1' && fn(x0 + (i * 6 + c) * cell, y0 + r * cell))),
    );
  const o = Math.max(3, Math.round(cell * 0.3));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  each((x, y) => ctx.fillRect(x - o, y + o, cell + o * 2, cell + o * 2));
  ctx.fillStyle = '#0b0f17';
  each((x, y) => ctx.fillRect(x - o, y - o, cell + o * 2, cell + o * 2));
  ctx.fillStyle = '#ffffff';
  each((x, y) => ctx.fillRect(x, y, cell, cell));
}

/** Sağdaki sekizgen seviye rozeti: açık yeşil kenar, koyu yeşil iç, "SEVİYE" ve piksel numara. */
function levelBadge(ctx, cx, cy, level) {
  octagon(ctx, cx, cy, 140);
  ctx.fillStyle = '#0b0f17';
  ctx.fill();
  const rim = ctx.createLinearGradient(cx, cy - 132, cx, cy + 132);
  rim.addColorStop(0, '#9af2bf');
  rim.addColorStop(1, '#2fae63');
  octagon(ctx, cx, cy, 132);
  ctx.fillStyle = rim;
  ctx.fill();
  octagon(ctx, cx, cy, 116);
  ctx.fillStyle = '#0b0f17';
  ctx.fill();
  octagon(ctx, cx, cy, 111);
  ctx.fillStyle = '#2a8a52';
  ctx.fill();
  const inside = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, 110);
  inside.addColorStop(0, '#1f6b40');
  inside.addColorStop(1, '#123d26');
  octagon(ctx, cx, cy, 104);
  ctx.fillStyle = inside;
  ctx.fill();
  // İçte merkezden dışa doğru sönen nokta deseni
  ctx.save();
  octagon(ctx, cx, cy, 104);
  ctx.clip();
  for (let y = cy - 104; y < cy + 104; y += 10)
    for (let x = cx - 104; x < cx + 104; x += 10) {
      const d = Math.hypot(x + 5 - cx, y + 5 - cy) / 104;
      const alpha = 0.22 - d * 0.18;
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(150,240,190,${alpha})`;
      ctx.beginPath();
      ctx.arc(x + 5, y + 5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#b9f5d2';
  ctx.font = '19px "Kart Text SemiBold"';
  ctx.fillText('SEVİYE', cx, cy - 52);
  ctx.textAlign = 'left';
  pixelNumber(ctx, level, cx, cy + 14, 150, 12);
}

/** Türkçe yönelme eki: 7'ye, 6'ya, 10'a, 9'a, 100'e. */
function toSuffix(n) {
  if (n === 0) return 'a';
  if (n % 1000 === 0) return 'e';
  if (n % 100 === 0) return 'e';
  if (n % 10 === 0) return {1: 'a', 2: 'ye', 3: 'a', 4: 'a', 5: 'ye', 6: 'a', 7: 'e', 8: 'e', 9: 'a'}[(n % 100) / 10];
  return {1: 'e', 2: 'ye', 3: 'e', 4: 'e', 5: 'e', 6: 'ya', 7: 'ye', 8: 'e', 9: 'a'}[n % 10];
}

/** XP barı: üstte "1.038 / 2.400 XP" ve "Seviye 7'ye %43", altta bölmeli dolum. */
function xpBar(ctx, x, y, w, {level, current, needed, percent}) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = '22px "Kart Text SemiBold"';
  ctx.fillText(`${NUMBER.format(current)} / ${NUMBER.format(needed)} XP`, x, y + 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.accent;
  ctx.font = '26px "Kart Text SemiBold"';
  const pct = `%${percent}`;
  ctx.fillText(pct, x + w, y + 4);
  const pw = ctx.measureText(pct).width;
  ctx.fillStyle = C.muted;
  ctx.font = '18px "Kart Text SemiBold"';
  ctx.fillText(`Seviye ${level + 1}'${toSuffix(level + 1)}`, x + w - pw - 10, y + 2);
  ctx.textAlign = 'left';

  const top = y + 16;
  const h = 42;
  roundRect(ctx, x, top, w, h, 12);
  ctx.fillStyle = '#0e131c';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.cardEdge;
  ctx.stroke();
  const SEGMENTS = 16;
  const gap = 3;
  const pad = 6;
  const segW = (w - pad * 2 - gap * (SEGMENTS - 1)) / SEGMENTS;
  const filled = (current / needed) * SEGMENTS;
  const green = ctx.createLinearGradient(x, 0, x + w, 0);
  green.addColorStop(0, '#3fbf74');
  green.addColorStop(1, '#a6f0c5');
  for (let i = 0; i < SEGMENTS; i++) {
    const sx = x + pad + i * (segW + gap);
    const sy = top + pad;
    const sh = h - pad * 2;
    roundRect(ctx, sx, sy, segW, sh, 4);
    ctx.fillStyle = '#1a2130';
    ctx.fill();
    const part = Math.max(0, Math.min(1, filled - i));
    if (!part) continue;
    ctx.save();
    roundRect(ctx, sx, sy, segW * part, sh, 4);
    ctx.clip();
    ctx.fillStyle = green;
    ctx.fillRect(sx, sy, segW, sh);
    // Üst yarıda parlama ve çapraz çizgiler
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(sx, sy, segW, sh / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 4;
    for (let k = -sh; k < segW; k += 12) {
      ctx.beginPath();
      ctx.moveTo(sx + k, sy + sh);
      ctx.lineTo(sx + k + sh, sy);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const NUMBER = new Intl.NumberFormat('tr-TR');
const DATE = new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long', year: 'numeric'});

/**
 * Kartı PNG olarak döner.
 * name: Micup'taki görünen ad; username: kullanıcı adı; avatar: yüklenmiş resim ya da null;
 * account: {nick, uuid, savedAt}; stats: seviye.js get() sonucu; skin: readSkin() sonucu; slim: ince kollu model mi.
 */
export async function renderCard({name, username, avatar, account, stats, skin, slim}) {
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
  const by = 182;
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

  // Kutucuklar: Minecraft adı ve model, altında mesaj sayısı
  let x = 330;
  x += chip(ctx, x, 182, account.nick, 'Minecraft', C.accent) + 14;
  chip(ctx, x, 182, slim ? 'İnce' : 'Klasik', 'Model', C.amber);
  chip(ctx, 330, 240, NUMBER.format(stats.messages), 'Mesaj', C.violet);

  // Hesap kutusu
  roundRect(ctx, 330, 292, 520, 54, 14);
  ctx.fillStyle = C.chip;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.chipEdge;
  ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = '19px "Kart Text SemiBold"';
  ctx.fillText('Minecraft hesabı bağlı', 348, 315);
  ctx.fillStyle = C.muted;
  ctx.font = '15px "Kart Text"';
  ctx.fillText(`${DATE.format(new Date(account.savedAt ?? Date.now()))} tarihinde /account ile bağlandı`, 348, 336);

  // XP barı
  xpBar(ctx, 330, 384, 818, stats);

  // Sağ: sekizgen seviye rozeti
  levelBadge(ctx, bx, by, stats.level);

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
