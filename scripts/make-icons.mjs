/**
 * Draws the app icon and writes real PNGs — no browser, no font rendering, no
 * SVG rasteriser, nothing that can go wrong in transit.
 *
 * Colour type 2 (opaque RGB, no alpha channel), because an icon with alpha is
 * something iOS gets to composite, and composited-onto-black is exactly the
 * failure we are trying to kill.
 *
 *   npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "public");

const CREAM = [0xfc, 0xf7, 0xef];
const ROSE = [0xa8, 0x45, 0x3b];
const RULE = [0xd9, 0xcb, 0xb8];

/* ---------- geometry, in a 0..1 square ---------- */

// Heart: two discs and a triangle. Simple shapes, exactly rasterisable.
const HEART = {
  r: 0.17,
  cy: 0.35,
  lx: 0.33,
  rx: 0.67,
  apexY: 0.82,
  leftX: 0.16,
  rightX: 0.84,
};

function inHeart(x, y) {
  const dl = (x - HEART.lx) ** 2 + (y - HEART.cy) ** 2;
  if (dl <= HEART.r ** 2) return true;
  const dr = (x - HEART.rx) ** 2 + (y - HEART.cy) ** 2;
  if (dr <= HEART.r ** 2) return true;
  if (y < HEART.cy) return false;
  // Triangle (leftX,cy) (rightX,cy) (0.5,apexY)
  const t = (y - HEART.cy) / (HEART.apexY - HEART.cy);
  if (t > 1) return false;
  const halfAt = (0.5 - HEART.leftX) * (1 - t);
  return Math.abs(x - 0.5) <= halfAt;
}

// Letters as stroked segments — no font involved.
function buildStrokes() {
  const s = [];
  const top = 0.275;
  const bot = 0.435;
  const mid = (top + bot) / 2;
  const w = 0.030;

  // H
  const hx = 0.355;
  const hw = 0.052;
  s.push({ a: [hx - hw, top], b: [hx - hw, bot], w });
  s.push({ a: [hx + hw, top], b: [hx + hw, bot], w });
  s.push({ a: [hx - hw, mid], b: [hx + hw, mid], w });

  // M
  const mx = 0.645;
  const mw = 0.060;
  s.push({ a: [mx - mw, bot], b: [mx - mw, top], w });
  s.push({ a: [mx + mw, bot], b: [mx + mw, top], w });
  s.push({ a: [mx - mw, top], b: [mx, mid + 0.012], w });
  s.push({ a: [mx, mid + 0.012], b: [mx + mw, top], w });

  // plus
  const px = 0.5;
  const py = mid - 0.005;
  const pr = 0.032;
  const pw = 0.019;
  s.push({ a: [px - pr, py], b: [px + pr, py], w: pw });
  s.push({ a: [px, py - pr], b: [px, py + pr], w: pw });

  return s;
}
const STROKES = buildStrokes();

function nearStroke(x, y) {
  for (const s of STROKES) {
    const [ax, ay] = s.a;
    const [bx, by] = s.b;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    if ((x - px) ** 2 + (y - py) ** 2 <= (s.w / 2) ** 2) return true;
  }
  return false;
}

function onRule(x, y) {
  const rings = [
    { inset: 0.052, w: 0.0075 },
    { inset: 0.081, w: 0.0055 },
  ];
  for (const r of rings) {
    const lo = r.inset;
    const hi = 1 - r.inset;
    const inOuter = x >= lo - r.w / 2 && x <= hi + r.w / 2 && y >= lo - r.w / 2 && y <= hi + r.w / 2;
    const inInner = x >= lo + r.w / 2 && x <= hi - r.w / 2 && y >= lo + r.w / 2 && y <= hi - r.w / 2;
    if (inOuter && !inInner) return true;
  }
  return false;
}

/** maskable: full bleed, artwork inside the middle 80% so a circle crop is safe */
function sample(x, y, maskable) {
  if (maskable) {
    // pull the artwork toward the centre, and no border rules
    x = (x - 0.5) / 0.78 + 0.5;
    y = (y - 0.5) / 0.78 + 0.5;
    if (inHeart(x, y)) return nearStroke(x, y) ? CREAM : ROSE;
    return CREAM;
  }
  if (inHeart(x, y)) return nearStroke(x, y) ? CREAM : ROSE;
  if (onRule(x, y)) return RULE;
  return CREAM;
}

function render(size, maskable) {
  const SS = 4; // supersampling for clean edges
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = sample(x, y, maskable);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 3;
      rgb[o] = Math.round(r / n);
      rgb[o + 1] = Math.round(g / n);
      rgb[o + 2] = Math.round(b / n);
    }
  }
  return rgb;
}

/* ---------- PNG encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour, NO alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- verify what we just wrote ---------- */

function verify(file, size) {
  const b = fs.readFileSync(file);
  const problems = [];
  if (b.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") problems.push("bad signature");
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w !== size || h !== size) problems.push(`dimensions ${w}x${h}`);
  if (b[25] !== 2) problems.push(`colour type ${b[25]} (want 2, no alpha)`);

  let off = 8;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString("latin1");
    if (crc32(b.slice(off + 4, off + 8 + len)) !== b.readUInt32BE(off + 8 + len)) {
      problems.push(`bad CRC on ${type}`);
    }
    if (type === "IDAT") idat.push(b.slice(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === "IEND") break;
  }

  let raw = null;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    problems.push("inflate failed: " + e.message);
  }
  const expected = size * (size * 3 + 1);
  if (raw && raw.length !== expected) problems.push(`pixels ${raw.length}/${expected}`);

  // Decode and check the bottom third is real artwork, not black or noise.
  let dark = 0;
  if (raw && raw.length === expected) {
    for (let y = Math.floor(size * 0.62); y < size; y += 1) {
      const rowStart = y * (size * 3 + 1) + 1;
      for (let x = 0; x < size; x += 1) {
        const o = rowStart + x * 3;
        if (raw[o] < 60 && raw[o + 1] < 60 && raw[o + 2] < 60) dark += 1;
      }
    }
  }
  if (dark > 0) problems.push(`${dark} near-black pixels in the lower third`);

  return { file: path.basename(file), size, bytes: b.length, problems };
}

/* ---------- go ---------- */

const targets = [
  { name: "heart-180.png", size: 180, maskable: false },
  { name: "heart-192.png", size: 192, maskable: false },
  { name: "heart-512.png", size: 512, maskable: false },
  { name: "heart-maskable-512.png", size: 512, maskable: true },
];

let bad = 0;
for (const t of targets) {
  const file = path.join(OUT, t.name);
  fs.writeFileSync(file, encodePNG(t.size, render(t.size, t.maskable)));
  const v = verify(file, t.size);
  const ok = v.problems.length === 0;
  if (!ok) bad += 1;
  console.log(
    (ok ? "  OK  " : " FAIL ") +
      v.file.padEnd(24) +
      String(v.size).padEnd(5) +
      String(v.bytes).padEnd(8) +
      (ok ? "opaque RGB, CRC clean, lower third clean" : v.problems.join("; "))
  );
}

// Matching SVG, same geometry, for the favicon.
const svg = (maskable) => {
  const k = maskable ? 0.78 : 1;
  const T = (v) => (512 * (0.5 + (v - 0.5) * k)).toFixed(1);
  const R = (512 * HEART.r * k).toFixed(1);
  const strokes = STROKES.map(
    (s) =>
      `<line x1="${T(s.a[0])}" y1="${T(s.a[1])}" x2="${T(s.b[0])}" y2="${T(s.b[1])}" stroke="#FCF7EF" stroke-width="${(512 * s.w * k).toFixed(1)}" stroke-linecap="butt"/>`
  ).join("\n    ");
  const rules = maskable
    ? ""
    : `<rect x="26.6" y="26.6" width="458.8" height="458.8" fill="none" stroke="#D9CBB8" stroke-width="3.8"/>
    <rect x="41.5" y="41.5" width="429" height="429" fill="none" stroke="#D9CBB8" stroke-width="2.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="H and M inside a heart">
    <rect width="512" height="512" fill="#FCF7EF"/>
    ${rules}
    <circle cx="${T(HEART.lx)}" cy="${T(HEART.cy)}" r="${R}" fill="#A8453B"/>
    <circle cx="${T(HEART.rx)}" cy="${T(HEART.cy)}" r="${R}" fill="#A8453B"/>
    <polygon points="${T(HEART.leftX)},${T(HEART.cy)} ${T(HEART.rightX)},${T(HEART.cy)} ${T(0.5)},${T(HEART.apexY)}" fill="#A8453B"/>
    ${strokes}
  </svg>
`;
};
fs.writeFileSync(path.join(OUT, "heart.svg"), svg(false));
fs.writeFileSync(path.join(OUT, "heart-maskable.svg"), svg(true));
console.log("  OK  heart.svg + heart-maskable.svg (same geometry)");

if (bad) {
  console.error("\n" + bad + " icon(s) failed verification");
  process.exit(1);
}
console.log("\nall icons generated and verified");
