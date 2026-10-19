/**
 * Generates the Zonify "ring-and-dot" logo PNGs at 16/32/48/128 px.
 * Pure Node (no dependencies): draws a stroked circle with a filled center
 * dot on a 24-unit grid, supersampled for antialiasing, then encodes RGBA PNG.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'assets', 'icons');

// --- Mark geometry (24-unit grid) -------------------------------------
const GRID = 24;
const RING_RADIUS = 9.4; // circle outline radius
const RING_STROKE = 2.5; // stroke width
const DOT_RADIUS = 3.4; // filled center dot radius
const ACCENT = [94, 234, 212]; // #5EEAD4

// --- Coverage sampling -------------------------------------------------
function sampleCoverage(gx, gy) {
  const d = Math.hypot(gx - GRID / 2, gy - GRID / 2);
  const ringInner = RING_RADIUS - RING_STROKE / 2;
  const ringOuter = RING_RADIUS + RING_STROKE / 2;
  return d <= DOT_RADIUS || (d >= ringInner && d <= ringOuter);
}

function renderIcon(size) {
  const ss = size <= 16 ? 12 : size <= 32 ? 8 : size <= 48 ? 6 : 4; // supersampling
  const pixels = Buffer.alloc(size * size * 4); // RGBA
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const gx = ((px + (sx + 0.5) / ss) / size) * GRID;
          const gy = ((py + (sy + 0.5) / ss) / size) * GRID;
          if (sampleCoverage(gx, gy)) hits++;
        }
      }
      const alpha = Math.round((hits / (ss * ss)) * 255);
      const o = (py * size + px) * 4;
      pixels[o] = ACCENT[0];
      pixels[o + 1] = ACCENT[1];
      pixels[o + 2] = ACCENT[2];
      pixels[o + 3] = alpha;
    }
  }
  return pixels;
}

// --- Minimal PNG encoder (8-bit RGBA) ----------------------------------
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression / filter / interlace = 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Go ---------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, renderIcon(size)));
  console.log(`wrote ${file}`);
}
