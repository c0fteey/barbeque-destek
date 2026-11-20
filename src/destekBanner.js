import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';

/**
 * Destek panelinin 16:9 banner'ı (1280×720), Barbeque teması: siyah, kırmızı, beyaz, açık ve koyu gri.
 * Solda kırmızı halkalı logo (botun profil fotoğrafı), sağda üst etiket, iki satır başlık ve alt yazı.
 * Metinler mesajlar.json > destek > bannerUst / bannerBaslik / bannerVurgu / bannerAltYazi.
 */
const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
GlobalFonts.registerFromPath(font('ArchivoBlack-Regular.ttf'), 'Banner Display');
GlobalFonts.registerFromPath(font('Poppins-Medium.ttf'), 'Banner Text');
GlobalFonts.registerFromPath(font('Poppins-SemiBold.ttf'), 'Banner Text SemiBold');

const W = 1280;
const H = 720;
const COLORS = {
  black: '#0b0b0c',
  darkGray: '#1c1c1f',
  gray: '#2a2a2e',
  lightGray: '#b9b9c0',
  white: '#ffffff',
  red: '#e0201e',
};

/** Logoyu indirir; alınamazsa null (banner logosuz çizilir). */
async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(4_000)});
    if (!response.ok) return null;
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

function background(ctx) {
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, 0, W, H);

  // Solda koyu gri çapraz panel; logo bunun üstünde durur.
  ctx.fillStyle = COLORS.darkGray;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(600, 0);
  ctx.lineTo(480, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Panelin kenarında ince kırmızı şerit.
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.moveTo(600, 0);
  ctx.lineTo(616, 0);
  ctx.lineTo(496, H);
  ctx.lineTo(480, H);
  ctx.closePath();
  ctx.fill();

  // Sağ altta gri nokta deseni.
  ctx.fillStyle = COLORS.gray;
  for (let y = 470; y < H - 30; y += 28) {
    for (let x = 980; x < W - 30; x += 28) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

async function logoBadge(ctx, logoUrl, cx, cy, radius) {
  const logo = await fetchAvatar(logoUrl);
  ctx.save();
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  if (logo) ctx.drawImage(logo, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Satırı genişliğe sığacak şekilde böler. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** İki başlık satırı da aynı boyda ve genişliğe sığacak en büyük boyda yazılır. */
function titleSize(ctx, lines, maxWidth, size = 104, min = 48) {
  const fits = () => lines.every((line) => ctx.measureText(line).width <= maxWidth);
  ctx.font = `${size}px "Banner Display"`;
  while (!fits() && size > min) {
    size -= 4;
    ctx.font = `${size}px "Banner Display"`;
  }
  return size;
}

function texts(ctx, {top, title, accent, subtitle}) {
  const left = 680;
  const maxWidth = W - left - 70;

  // Üst etiket: kırmızı zemin, beyaz yazı.
  ctx.font = '22px "Banner Text SemiBold"';
  const tagW = ctx.measureText(top).width + 40;
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.roundRect(left, 158, tagW, 44, 8);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = 'middle';
  ctx.fillText(top, left + 20, 182);
  ctx.textBaseline = 'alphabetic';

  // Başlık: iki satır, ikisi de beyaz ve aynı boyda.
  const lines = [title, accent].filter(Boolean);
  const size = titleSize(ctx, lines, maxWidth);
  ctx.fillStyle = COLORS.white;
  let y = 210 + size;
  for (const line of lines) {
    ctx.fillText(line, left - 4, y);
    y += size * 1.02;
  }

  // Kırmızı ayraç.
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(left, y - size * 0.55, 80, 8);

  // Alt yazı: açık gri.
  ctx.fillStyle = COLORS.lightGray;
  ctx.font = '29px "Banner Text"';
  y += 20;
  for (const line of wrap(ctx, subtitle, maxWidth).slice(0, 3)) {
    ctx.fillText(line, left, y);
    y += 42;
  }
}

export async function renderBanner({logoUrl, top = 'BARBEQUE', title = 'DESTEK', accent = 'MERKEZİ', subtitle = ''}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  background(ctx);
  await logoBadge(ctx, logoUrl, 290, 360, 180);
  texts(ctx, {top, title, accent, subtitle});
  return canvas.encode('png');
}
