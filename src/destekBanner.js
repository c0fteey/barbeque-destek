import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';

/**
 * Destek panelinin 16:9 banner'ı (1280×720): solda Barbeque logosu (botun profil fotoğrafı), sağda başlık ve alt yazı.
 * Metinler mesajlar.json > destek > bannerBaslik / bannerAltYazi.
 */
const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
GlobalFonts.registerFromPath(font('ArchivoBlack-Regular.ttf'), 'Banner Display');
GlobalFonts.registerFromPath(font('Poppins-Medium.ttf'), 'Banner Text');

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

const W = 1280;
const H = 720;

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

export async function renderBanner({logoUrl, title, subtitle}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Arka plan: koyu kırmızıdan siyaha, sağ üstte sıcak bir ışık.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2a0708');
  bg.addColorStop(1, '#0d0d10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(360, 360, 40, 360, 360, 520);
  glow.addColorStop(0, 'rgba(230, 40, 40, 0.45)');
  glow.addColorStop(1, 'rgba(230, 40, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Yarım ton noktalar (sağ alt).
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let y = 380; y < H; y += 26) {
    for (let x = 760; x < W; x += 26) {
      const r = Math.max(0, ((x - 760) / (W - 760) + (y - 380) / (H - 380)) * 3.2);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Logo daire içinde.
  const logo = await fetchAvatar(logoUrl);
  const cx = 330;
  const cy = 360;
  const radius = 210;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  if (logo) ctx.drawImage(logo, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  // Metin.
  const left = 620;
  const maxWidth = W - left - 70;
  ctx.fillStyle = '#e8312f';
  ctx.fillRect(left, 238, 90, 10);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  let size = 84;
  ctx.font = `${size}px "Banner Display"`;
  let titleLines = wrap(ctx, title, maxWidth);
  while (titleLines.length > 2 && size > 48) {
    size -= 6;
    ctx.font = `${size}px "Banner Display"`;
    titleLines = wrap(ctx, title, maxWidth);
  }
  let y = 340;
  for (const line of titleLines.slice(0, 2)) {
    ctx.fillText(line, left, y);
    y += size * 1.05;
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = '34px "Banner Text"';
  y += 10;
  for (const line of wrap(ctx, subtitle, maxWidth).slice(0, 3)) {
    ctx.fillText(line, left, y);
    y += 46;
  }

  return canvas.encode('png');
}
