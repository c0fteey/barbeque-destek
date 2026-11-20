import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';

/**
 * Destek panelinin 16:9 banner'ı (1280×720): Barbeque teması, alttan yükselen alevler ve kıvılcımlar,
 * solda ışık hüzmeleri önünde parlayan logo (botun profil fotoğrafı), sağda başlık, alt yazı ve "butona bas" etiketi.
 * Metinler mesajlar.json > destek > bannerUst / bannerBaslik / bannerVurgu / bannerAltYazi / bannerEtiket.
 */
const font = (file) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
GlobalFonts.registerFromPath(font('ArchivoBlack-Regular.ttf'), 'Banner Display');
GlobalFonts.registerFromPath(font('Poppins-Medium.ttf'), 'Banner Text');
GlobalFonts.registerFromPath(font('Poppins-SemiBold.ttf'), 'Banner Text SemiBold');

const W = 1280;
const H = 720;

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

/** Her çizimde aynı görünsün diye sabit tohumlu rastgele sayı. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function background(ctx) {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a0405');
  bg.addColorStop(0.55, '#0e0709');
  bg.addColorStop(1, '#050506');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Çapraz ızgara çizgileri (ızgara teması).
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 120, 60, 0.05)';
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  ctx.restore();
}

/** Logonun arkasında dönen ışık hüzmeleri ve kırmızı parlama. */
function rays(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  const count = 18;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * 700, Math.sin(a) * 700);
    grad.addColorStop(0, 'rgba(255, 90, 40, 0.30)');
    grad.addColorStop(1, 'rgba(255, 90, 40, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 700, a - 0.07, a + 0.07);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(cx, cy, 60, cx, cy, 420);
  glow.addColorStop(0, 'rgba(255, 60, 40, 0.55)');
  glow.addColorStop(0.5, 'rgba(200, 20, 20, 0.18)');
  glow.addColorStop(1, 'rgba(200, 20, 20, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

/** Alttan yükselen üç katmanlı alev. */
function flames(ctx) {
  const layers = [
    {base: H - 40, height: 230, colors: ['rgba(140, 10, 10, 0.85)', 'rgba(140, 10, 10, 0)'], seed: 3, step: 70},
    {base: H - 10, height: 170, colors: ['rgba(235, 60, 20, 0.9)', 'rgba(235, 60, 20, 0)'], seed: 7, step: 55},
    {base: H + 10, height: 110, colors: ['rgba(255, 190, 60, 0.95)', 'rgba(255, 150, 40, 0)'], seed: 11, step: 42},
  ];
  for (const layer of layers) {
    const rand = seeded(layer.seed);
    const grad = ctx.createLinearGradient(0, H, 0, H - layer.height - 60);
    grad.addColorStop(0, layer.colors[0]);
    grad.addColorStop(1, layer.colors[1]);
    ctx.save();
    ctx.shadowColor = 'rgba(255, 90, 30, 0.8)';
    ctx.shadowBlur = 40;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-20, H);
    for (let x = -20; x <= W + layer.step; x += layer.step) {
      // Sağa doğru alevler alçalır, metin rahat okunsun.
      const fade = 1 - Math.min(1, Math.max(0, (x - 520) / 900)) * 0.65;
      const h = layer.height * (0.45 + rand() * 0.55) * fade;
      const tipY = layer.base - h;
      // Alev dili: göbeği şişkin, ucu bir yana kıvrılmış.
      const sway = (rand() - 0.5) * layer.step * 0.9;
      const tipX = x + layer.step / 2 + sway;
      const end = x + layer.step;
      ctx.bezierCurveTo(x - layer.step * 0.15, layer.base - h * 0.45, tipX - sway * 0.2 - layer.step * 0.1, tipY + h * 0.35, tipX, tipY);
      ctx.bezierCurveTo(tipX + layer.step * 0.12, tipY + h * 0.4, end + layer.step * 0.15, layer.base - h * 0.35, end, layer.base - 6);
    }
    ctx.lineTo(W + 40, H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Yukarı uçuşan kıvılcımlar. */
function embers(ctx) {
  const rand = seeded(42);
  ctx.save();
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = H - Math.pow(rand(), 0.7) * H * 0.95;
    const r = 1.2 + rand() * 3.2;
    const alpha = 0.35 + (y / H) * 0.6;
    ctx.shadowColor = 'rgba(255, 140, 40, 1)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = rand() > 0.35 ? `rgba(255, 170, 60, ${alpha})` : `rgba(255, 235, 150, ${alpha})`;
    ctx.beginPath();
    // Hafif uzamış, yukarı uçan kıvılcım.
    ctx.ellipse(x, y, r * 0.8, r * 1.8, (rand() - 0.5) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

async function logoBadge(ctx, logoUrl, cx, cy, radius) {
  const logo = await fetchAvatar(logoUrl);
  ctx.save();
  // Dış parlayan halka: kırmızıdan turuncuya.
  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, '#ff2d2d');
  ring.addColorStop(0.5, '#ff7a1a');
  ring.addColorStop(1, '#ffc23d');
  ctx.shadowColor = 'rgba(255, 70, 30, 0.9)';
  ctx.shadowBlur = 60;
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
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

/** Yazı tek satıra sığana kadar küçültülür. */
function fitFont(ctx, text, family, size, maxWidth, min = 40) {
  ctx.font = `${size}px "${family}"`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 4;
    ctx.font = `${size}px "${family}"`;
  }
  return size;
}

function pill(ctx, x, y, text, {fill, color, size = 24, family = 'Banner Text SemiBold', padX = 22, h = 48}) {
  ctx.font = `${size}px "${family}"`;
  const w = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 2);
  ctx.textBaseline = 'alphabetic';
  return w;
}

function texts(ctx, {top, title, accent, subtitle, tag}) {
  const left = 610;
  const maxWidth = W - left - 60;

  // Üst etiket.
  pill(ctx, left, 150, top, {fill: 'rgba(255, 60, 40, 0.16)', color: '#ff8a5c', size: 22});

  // Başlık: beyaz, gölgeli.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowOffsetY = 6;
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  const titleSize = fitFont(ctx, title, 'Banner Display', 92, maxWidth);
  ctx.fillText(title, left - 4, 300);

  // Vurgu: alev renginde degrade, parlayan.
  const accentSize = fitFont(ctx, accent, 'Banner Display', 112, maxWidth);
  const accentY = 300 + Math.max(titleSize, accentSize) * 1.02;
  const grad = ctx.createLinearGradient(left, accentY - accentSize, left, accentY);
  grad.addColorStop(0, '#ffd45c');
  grad.addColorStop(0.55, '#ff8a1f');
  grad.addColorStop(1, '#ff3b2f');
  ctx.shadowColor = 'rgba(255, 90, 30, 0.75)';
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 36;
  ctx.fillStyle = grad;
  ctx.fillText(accent, left - 4, accentY);
  ctx.restore();

  // Alt yazı.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = '30px "Banner Text"';
  let y = accentY + 62;
  for (const line of wrap(ctx, subtitle, maxWidth).slice(0, 2)) {
    ctx.fillText(line, left, y);
    y += 42;
  }

  // "Butona bas" etiketi: parlak, beyaz zemin.
  ctx.save();
  ctx.shadowColor = 'rgba(255, 80, 30, 0.6)';
  ctx.shadowBlur = 24;
  const top2 = y + 8;
  pill(ctx, left, top2, `      ${tag}`, {fill: '#ffffff', color: '#d81f1f', size: 26, h: 58, padX: 28});
  ctx.restore();
  // Oynat üçgeni (fontta ▶ yok, elle çizilir).
  ctx.fillStyle = '#d81f1f';
  ctx.beginPath();
  ctx.moveTo(left + 30, top2 + 18);
  ctx.lineTo(left + 50, top2 + 29);
  ctx.lineTo(left + 30, top2 + 40);
  ctx.closePath();
  ctx.fill();
}

export async function renderBanner({logoUrl, top = 'BARBEQUE', title = 'DESTEK', accent = 'MERKEZİ', subtitle = '', tag = 'Talep aç'}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cx = 320;
  const cy = 330;
  background(ctx);
  rays(ctx, cx, cy);
  flames(ctx);
  embers(ctx);
  await logoBadge(ctx, logoUrl, cx, cy, 190);
  texts(ctx, {top, title, accent, subtitle, tag});
  // Kenarlarda karartma (vinyet).
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.75);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  return canvas.encode('png');
}
