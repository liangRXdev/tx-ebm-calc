/* 產生 PWA 圖示（無外部依賴，使用 Node 內建 zlib 自編 PNG）。
 * 設計：teal 圓角底 + 白色 4×4 點陣，左下 3 點金色 → 呼應百人效益圖 (Cates plot)。
 * 執行：node tools/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEAL = [61, 122, 138];
const WHITE = [238, 245, 244];
const GOLD = [217, 142, 4];

// CRC32（PNG 用）
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 單一子樣本的顏色與覆蓋（u,v ∈ 0..1）
function sample(u, v, maskable) {
  // 底：圓角矩形（maskable 則全幅不透明）
  let inBg;
  if (maskable) {
    inBg = true;
  } else {
    const r = 0.205; // 圓角半徑（相對）
    const dx = Math.max(r - u, u - (1 - r), 0);
    const dy = Math.max(r - v, v - (1 - r), 0);
    inBg = dx * dx + dy * dy <= r * r;
  }
  if (!inBg) return [0, 0, 0, 0];

  // 點陣（maskable 收進安全區）
  const lo = maskable ? 0.30 : 0.18;
  const hi = maskable ? 0.70 : 0.82;
  const n = 4;
  const span = hi - lo;
  const step = span / (n - 1);
  const dotR = step * 0.34;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = lo + j * step, cy = lo + i * step;
      const dx = u - cx, dy = v - cy;
      if (dx * dx + dy * dy <= dotR * dotR) {
        const gold = i === n - 1 && j <= 2; // 左下 3 點金色
        const c = gold ? GOLD : WHITE;
        return [c[0], c[1], c[2], 255];
      }
    }
  }
  return [TEAL[0], TEAL[1], TEAL[2], 255];
}

function makeIcon(size, maskable) {
  const SS = 3; // 3×3 超取樣抗鋸齒
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const s = sample(u, v, maskable);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const idx = (y * size + x) * 4;
      const aa = a / (SS * SS);
      rgba[idx] = a ? Math.round(r / a) : 0;
      rgba[idx + 1] = a ? Math.round(g / a) : 0;
      rgba[idx + 2] = a ? Math.round(b / a) : 0;
      rgba[idx + 3] = Math.round(aa);
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];
jobs.forEach(([name, size, maskable]) => {
  const buf = makeIcon(size, maskable);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote icons/${name} (${size}px${maskable ? ', maskable' : ''}) ${buf.length} bytes`);
});
