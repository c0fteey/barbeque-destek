import {createCanvas, loadImage} from '@napi-rs/canvas';

/**
 * Minecraft skinini 3D olarak çizer (GPU ya da tarayıcı gerekmez).
 * Model ölçüleri ve eklem noktaları skinview3d 3.1 ile aynıdır; poz da skin editöründeki değerlerle (derece) verilir,
 * böylece editörde ayarlanan taslak kartta birebir aynı görünür.
 * Her skin pikseli ayrı bir dörtgen olarak izdüşürülür ve uzaktan yakına sırayla boyanır.
 */

/** Editördeki "Taslak 1". Değiştirmek için editörde "Pozu kopyala" ile alınan metni buraya yapıştır. */
export const POSE = {
  head: {x: -21, y: -30, z: -15},
  body: {x: 0, y: -15, z: 0},
  rightArm: {x: -24, y: -29, z: -22},
  leftArm: {x: 10, y: 0, z: 44},
  rightLeg: {x: 6, y: 0, z: -6},
  leftLeg: {x: -12, y: 0, z: 5},
  player: {x: 0, y: -6, z: 0, s: 77, px: -1, py: 0},
  camera: {el: 10, fov: 80, zoom: 92},
};
/** Editördeki kamera hedefi. */
const TARGET = [0.8, 0, 0];

const RAD = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(...a));

/** three.js 'XYZ' sırası: R = Rx · Ry · Rz (derece). */
function rotation({x = 0, y = 0, z = 0}) {
  const [a, b, c] = [x * RAD, y * RAD, z * RAD];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}
const apply = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** Düğüm: {pos, rot (matris), scale}; noktayı yaprağından köke doğru dönüştürür. */
const node = (pos, rot = {}, scale = 1) => ({pos, rot: rotation(rot), scale});
function toWorld(chain, p) {
  for (const n of chain) p = add(n.pos, apply(n.rot, mul(p, n.scale)));
  return p;
}
function dirToWorld(chain, d) {
  for (const n of chain) d = apply(n.rot, d);
  return d;
}

/**
 * Kutunun yüzleri: doku dikdörtgeni (u, v, genişlik, yükseklik) ve 3D'de başlangıç köşesi + sütun/satır adımı.
 * Doku ölçüsü (w, h, d) ile kutu ölçüsü (bw, bh, bd) dış katmanda farklıdır (kutu biraz şişkin).
 */
function faces([u, v], [w, h, d], [bw, bh, bd]) {
  const X = bw / 2;
  const Y = bh / 2;
  const Z = bd / 2;
  const [cx, cy, cz] = [bw / w, bh / h, bd / d];
  return [
    {rect: [u + d, v + d, w, h], o: [-X, Y, Z], a: [cx, 0, 0], b: [0, -cy, 0], n: [0, 0, 1]},
    {rect: [u + 2 * d + w, v + d, w, h], o: [X, Y, -Z], a: [-cx, 0, 0], b: [0, -cy, 0], n: [0, 0, -1]},
    {rect: [u, v + d, d, h], o: [-X, Y, -Z], a: [0, 0, cz], b: [0, -cy, 0], n: [-1, 0, 0]},
    {rect: [u + d + w, v + d, d, h], o: [X, Y, Z], a: [0, 0, -cz], b: [0, -cy, 0], n: [1, 0, 0]},
    {rect: [u + d, v, w, d], o: [-X, Y, -Z], a: [cx, 0, 0], b: [0, 0, cz], n: [0, 1, 0]},
    // Alt yüz: dokunun üst satırı arkaya, alt satırı öne denk gelir (three.js BoxGeometry + skinview3d UV'leri).
    {rect: [u + d + w, v, w, d], o: [-X, -Y, -Z], a: [cx, 0, 0], b: [0, 0, cz], n: [0, -1, 0]},
  ];
}

/** skinview3d'deki gövde parçaları: eklem zinciri, kutunun eklemdeki yeri, doku yeri, iç ve dış kutu ölçüsü. */
function parts(slim) {
  const aw = slim ? 3 : 4;
  return [
    {name: 'head', joint: [0, 0, 0], offset: [0, 4, 0], tex: [8, 8, 8], inner: [0, 0], outer: [32, 0], size: [8, 8, 8], pad: 1},
    {name: 'body', joint: [0, -6, 0], offset: [0, 0, 0], tex: [8, 12, 4], inner: [16, 16], outer: [16, 32], size: [8, 12, 4], pad: 0.5},
    {name: 'rightArm', joint: [-5, -2, 0], offset: [slim ? -0.5 : -1, -4, 0], tex: [aw, 12, 4], inner: [40, 16], outer: [40, 32], size: [aw, 12, 4], pad: 0.5},
    {name: 'leftArm', joint: [5, -2, 0], offset: [slim ? 0.5 : 1, -4, 0], tex: [aw, 12, 4], inner: [32, 48], outer: [48, 48], size: [aw, 12, 4], pad: 0.5},
    {name: 'rightLeg', joint: [-1.9, -12, -0.1], offset: [0, -6, 0], tex: [4, 12, 4], inner: [0, 16], outer: [0, 32], size: [4, 12, 4], pad: 0.5},
    {name: 'leftLeg', joint: [1.9, -12, -0.1], offset: [0, -6, 0], tex: [4, 12, 4], inner: [16, 48], outer: [0, 48], size: [4, 12, 4], pad: 0.5},
  ];
}

/** Eski 64×32 skinlerde sol kol ve bacak yoktur; Minecraft gibi sağdakilerin aynası kullanılır. */
function upgradeLegacy(src) {
  const out = new Uint8ClampedArray(64 * 64 * 4);
  out.set(src.subarray(0, 64 * 32 * 4));
  const px = (x, y) => (y * 64 + x) * 4;
  const copyFlipped = (sx, sy, w, h, dx, dy) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = px(sx + w - 1 - x, sy + y);
        out.set(src.subarray(s, s + 4), px(dx + x, dy + y));
      }
  };
  for (const [su, sv, du, dv] of [
    [0, 16, 16, 48],
    [40, 16, 32, 48],
  ]) {
    copyFlipped(su + 4, sv, 4, 4, du + 4, dv);
    copyFlipped(su + 8, sv, 4, 4, du + 8, dv);
    copyFlipped(su + 8, sv + 4, 4, 12, du, dv + 4);
    copyFlipped(su, sv + 4, 4, 12, du + 8, dv + 4);
    copyFlipped(su + 4, sv + 4, 4, 12, du + 4, dv + 4);
    copyFlipped(su + 12, sv + 4, 4, 12, du + 12, dv + 4);
  }
  return out;
}

/** Skin PNG'sini 64×64 RGBA piksel dizisine çevirir. */
export async function readSkin(png) {
  const image = await loadImage(png);
  if (image.width !== 64 || (image.height !== 64 && image.height !== 32)) throw new Error(`Skin boyutu beklenmedik: ${image.width}×${image.height}`);
  const canvas = createCanvas(64, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, 64, image.height).data;
  return {pixels: image.height === 32 ? upgradeLegacy(data) : data, legacy: image.height === 32};
}

/**
 * Skini verilen boyutta saydam bir tuvale çizer.
 * skin: readSkin() sonucu; slim: ince kollu model; pose: editör biçiminde poz.
 */
export function renderSkin(skin, {width, height, slim = false, pose = POSE} = {}) {
  const {pixels, legacy} = skin;
  const pl = pose.player;
  const playerChain = [node([0, 8, 0]), node([pl.px ?? 0, pl.py ?? 0, 0], pl, (pl.s ?? 100) / 100)];

  // Kamera: skinview3d'deki gibi uzaklık FOV ve yakınlıktan hesaplanır, yükseklik açısıyla yerleştirilir.
  const {el, fov, zoom} = pose.camera;
  const half = (fov * RAD) / 2;
  const distance = Math.min(256, Math.max(10, 4.5 + 16.5 / Math.tan(half) / (zoom / 100)));
  const eye = [0, Math.sin(el * RAD) * distance, Math.cos(el * RAD) * distance];
  const forward = norm(sub(TARGET, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = height / 2 / Math.tan(half);
  const project = (p) => {
    const d = sub(p, eye);
    const z = dot(d, forward);
    return [width / 2 + (dot(d, right) / z) * focal, height / 2 - (dot(d, up) / z) * focal, z];
  };
  // Yukarıdan ve hafif soldan gelen ışık; yüzler Minecraft'taki gibi yönlerine göre gölgelenir.
  const light = norm([-0.35, 0.8, 0.5]);

  const quads = [];
  for (const part of parts(slim)) {
    const chain = [node(part.offset), node(part.joint, pose[part.name] ?? {}), ...playerChain];
    for (const layer of ['inner', 'outer']) {
      // Eski skinlerde yalnızca kafanın dış katmanı vardır.
      if (layer === 'outer' && legacy && part.name !== 'head') continue;
      const box = layer === 'inner' ? part.size : part.size.map((s) => s + part.pad);
      for (const face of faces(part[layer], part.tex, box)) {
        const normal = dirToWorld(chain, face.n);
        const center = toWorld(chain, add(face.o, add(mul(face.a, face.rect[2] / 2), mul(face.b, face.rect[3] / 2))));
        const facing = dot(normal, sub(eye, center)) > 0;
        // İç katman yalnızca dışa bakan yüzleriyle, dış katman iki yüzüyle çizilir (skinview3d'deki gibi).
        if (!facing && layer === 'inner') continue;
        // Editördeki gibi neredeyse düz ışık; yönler hafifçe ayrışsın diye küçük bir yönlü pay.
        const shade = Math.min(1, 0.84 + 0.16 * Math.max(0, dot(facing ? normal : mul(normal, -1), light)));
        const [tu, tv, cols, rows] = face.rect;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const i = ((tv + r) * 64 + tu + c) * 4;
            if (pixels[i + 3] < 16) continue;
            const corner = (dc, dr) => project(toWorld(chain, add(face.o, add(mul(face.a, c + dc), mul(face.b, r + dr)))));
            const pts = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
            const color = [pixels[i] * shade, pixels[i + 1] * shade, pixels[i + 2] * shade];
            quads.push({pts, color});
          }
      }
    }
  }

  // Derinlik tamponlu çizim (WebGL'deki gibi): her ekran pikselinde kameraya en yakın yüzey kalır.
  // SS kat büyük çizilip küçültülür, kenarlar yumuşar.
  const SS = 3;
  const W = width * SS;
  const H = height * SS;
  const depth = new Float32Array(W * H);
  const color = new Float32Array(W * H * 3);
  const filled = new Uint8Array(W * H);
  const scale = (p) => [p[0] * SS, p[1] * SS, 1 / p[2]];
  for (const q of quads) {
    const [a, b, c, d] = q.pts.map(scale);
    if (a[2] <= 0 || b[2] <= 0 || c[2] <= 0 || d[2] <= 0) continue;
    triangle(a, b, c, q.color);
    triangle(a, c, d, q.color);
  }

  function triangle(p0, p1, p2, rgb) {
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.abs(area) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const inv = 1 / area;
    // Ortak kenardaki pikseller iki üçgene de girer (aynı yüzün parçaları), böylece aralarında boşluk kalmaz.
    const eps = -1e-6;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((p2[0] - p1[0]) * (py - p1[1]) - (p2[1] - p1[1]) * (px - p1[0])) * inv;
        const w1 = ((p0[0] - p2[0]) * (py - p2[1]) - (p0[1] - p2[1]) * (px - p2[0])) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        // 1/z ekranda doğrusal değişir; büyük olan daha yakındır.
        const iz = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const k = y * W + x;
        if (iz <= depth[k]) continue;
        depth[k] = iz;
        filled[k] = 1;
        color[k * 3] = rgb[0];
        color[k * 3 + 1] = rgb[1];
        color[k * 3 + 2] = rgb[2];
      }
    }
  }

  // Küçültme: her çıktı pikseli SS×SS alt pikselin ortalaması (boş alt pikseller saydam sayılır).
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  const n = SS * SS;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let count = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const k = (y * SS + sy) * W + x * SS + sx;
          if (!filled[k]) continue;
          r += color[k * 3];
          g += color[k * 3 + 1];
          bl += color[k * 3 + 2];
          count++;
        }
      if (!count) continue;
      const o = (y * width + x) * 4;
      out.data[o] = r / count;
      out.data[o + 1] = g / count;
      out.data[o + 2] = bl / count;
      out.data[o + 3] = (255 * count) / n;
    }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
