// node test/thumbnail.js — renders thumbnail.png (1200×630) straight from the engines:
// a 1D space-time diagram (past below, future above t = 0) and the 2D Loschmidt echo
// (smiley at t = 0, scrambled at t = T, rewound to t = 0 after one flip, damage in colour).
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const RCA = require('../js/rules.js');
global.RCA = RCA;
const History = require('../js/history.js');

const Wd = 1200, Hd = 630;
const px = new Uint8Array(Wd * Hd * 4);
const BG = [10, 13, 19], OFF = [17, 21, 30], ON = [236, 229, 210], EXTRA = [255, 122, 89], MISSING = [76, 201, 240], NOW = [255, 207, 112];
function fill(x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || y < 0 || x >= Wd || y >= Hd) continue;
    const o = (y * Wd + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
}
fill(0, 0, Wd, Hd, BG);

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

// ---- 1D space-time diagram
{
  const P = RCA.PRESETS.find((p) => p.id === (process.argv[2] || 'rca54'));
  const F = RCA.FAMILIES[P.family], W = 180, n = W;
  const S = RCA.newState(n, F.order);
  for (let i = 75; i < 105; i++) S.cur[i] = rnd() < 0.5 ? 1 : 0;
  const h = new History(F.make(P.params, W, 1), n, F.order).reset(0, S);
  const rows = 190, cell = 3, t0 = -95, out = new Uint8Array(rows * W);
  h.rows(t0, t0 + rows - 1, out);
  const X0 = 40, Y0 = 30;
  for (let k = 0; k < rows; k++) {
    const r = rows - 1 - k, t = t0 + k;
    for (let i = 0; i < W; i++) fill(X0 + i * cell, Y0 + r * cell, cell, cell, out[k * W + i] ? ON : t === 0 ? [40, 47, 66] : OFF);
  }
  const yNow = Y0 + (rows - 1 - (0 - t0)) * cell + 1;
  fill(X0 - 12, yNow - 3, 8, 7, NOW); fill(X0 + W * cell + 4, yNow - 3, 8, 7, NOW);
}

// ---- 2D echo: smiley, scrambled, rewound with damage
{
  const P = RCA.PRESETS.find((p) => p.id === (process.argv[3] || 'critters'));
  const F = RCA.FAMILIES[P.family], W = 80, n = W * W;
  const S = RCA.newState(n, F.order);
  const cx = W / 2, cy = W / 2, R = W * 0.32, lw = R / 8.5;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    let on = Math.abs(d - R) < lw / 2;
    for (const s of [-1, 1]) if (((dx - s * R * 0.36) / (R * 0.11)) ** 2 + ((dy + R * 0.28) / (R * 0.16)) ** 2 < 1) on = true;
    const ang = Math.atan2(dy - R * 0.02, dx);
    if (Math.abs(Math.hypot(dx, dy - R * 0.02) - R * 0.56) < lw / 2 && ang > Math.PI * 0.18 && ang < Math.PI * 0.82) on = true;
    S.cur[y * W + x] = on ? 1 : 0;
  }
  const eng = F.make(P.params, W, W);
  const alt = RCA.analyse(P.family, P.params).alternating;
  const cell = 2, size = W * cell, gap = 30, X0 = 645;
  const panel = (c, r, t, x0, y0) => {
    const fv = alt && t % 2 ? 1 : 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = c[i] ^ fv;
      let col = v ? ON : OFF;
      if (r && c[i] !== r[i]) col = v ? EXTRA : MISSING;
      fill(x0 + x * cell, y0 + y * cell, cell, cell, col);
    }
  };
  // one row per scramble time: encoded -> scrambled -> flipped one cell and rewound
  [[14, 125], [260, 125 + size + 60]].forEach(([T, y0]) => {
    const h = new History(eng, n, F.order).reset(0, S);
    const orig = h.at(0).cur.slice(), scr = h.at(T).cur.slice();
    h.edit(T, [(W >> 1) * W + (W >> 1) + 7], null);
    const back = h.at(0).cur.slice();
    [[orig, null, 0], [scr, null, T], [back, orig, 0]].forEach(([c, r, t], j) => panel(c, r, t, X0 + j * (size + gap), y0));
    for (let j = 0; j < 2; j++) {
      const ax = X0 + (j + 1) * size + j * gap + 8, ay = y0 + size / 2;
      fill(ax, ay, gap - 16, 2, NOW);
      fill(ax + gap - 20, ay - 3, 3, 8, NOW);
    }
  });
}

// ---- PNG encode
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const raw = Buffer.alloc((Wd * 4 + 1) * Hd);
for (let y = 0; y < Hd; y++) { raw[y * (Wd * 4 + 1)] = 0; Buffer.from(px.buffer, y * Wd * 4, Wd * 4).copy(raw, y * (Wd * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(Wd, 0); ihdr.writeUInt32BE(Hd, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, '..', 'thumbnail.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
