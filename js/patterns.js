/* Loschmidt · patterns.js — initial conditions (low-entropy and typical) */
(function (root) {
  'use strict';

  function raster(W, H, draw) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    draw(g, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = d[4 * i] > 127 ? 1 : 0;
    return out;
  }

  const rand = (n, p) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() < p ? 1 : 0; return a; };

  const P2 = {
    smiley: { name: 'Smiley', low: true, make(W, H) {
      return raster(W, H, (g) => {
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.32, lw = Math.max(1.6, R / 9);
        g.lineWidth = lw; g.lineCap = 'round';
        g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.stroke();
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * R * 0.36, cy - R * 0.28, R * 0.11, R * 0.16, 0, 0, 2 * Math.PI); g.fill(); }
        g.beginPath(); g.arc(cx, cy + R * 0.02, R * 0.56, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
      });
    } },
    text: { name: 'Text', low: true, usesText: true, make(W, H, o) {
      const txt = (o.text || 'hi').slice(0, 40);
      return raster(W, H, (g) => {
        let fs = H * 0.5;
        g.font = `700 ${fs}px Inter, Helvetica, Arial, sans-serif`;
        const w = g.measureText(txt).width;
        if (w > W * 0.86) fs *= (W * 0.86) / w;
        g.font = `700 ${fs}px Inter, Helvetica, Arial, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, W / 2, H / 2 + fs * 0.04);
      });
    } },
    disk: { name: 'Filled disk', low: true, make(W, H) {
      return raster(W, H, (g) => { g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.2, 0, 2 * Math.PI); g.fill(); });
    } },
    square: { name: 'Filled square', low: true, make(W, H) {
      const a = new Uint8Array(W * H), s = Math.round(Math.min(W, H) / 4), x0 = (W - s) >> 1, y0 = (H - s) >> 1;
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) a[y * W + x] = 1;
      return a;
    } },
    box: { name: 'Gas in a small box', low: true, usesDensity: true, make(W, H, o) {
      const a = new Uint8Array(W * H), s = Math.round(Math.min(W, H) / 4), x0 = (W - s) >> 1, y0 = (H - s) >> 1;
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) a[y * W + x] = Math.random() < o.density ? 1 : 0;
      return a;
    } },
    half: { name: 'Gas in the left half', low: true, usesDensity: true, make(W, H, o) {
      const a = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) a[y * W + x] = Math.random() < o.density ? 1 : 0;
      return a;
    } },
    single: { name: 'Single cell', low: true, make(W, H) {
      const a = new Uint8Array(W * H); a[(H >> 1) * W + (W >> 1)] = 1; return a;
    } },
    random: { name: 'Random (iid)', low: false, usesDensity: true, make(W, H, o) { return rand(W * H, o.density); } },
    blank: { name: 'Empty (draw your own)', low: true, make(W, H) { return new Uint8Array(W * H); } },
  };

  const P1 = {
    single: { name: 'Single cell', low: true, make(W) { const a = new Uint8Array(W); a[W >> 1] = 1; return a; } },
    pair: { name: 'Two cells', low: true, make(W) { const a = new Uint8Array(W); a[(W >> 1) - 1] = 1; a[(W >> 1) + 1] = 1; return a; } },
    block: { name: 'Central block', low: true, make(W) {
      const a = new Uint8Array(W), s = Math.max(2, Math.round(W / 10)), x0 = (W - s) >> 1;
      for (let i = x0; i < x0 + s; i++) a[i] = 1; return a;
    } },
    segment: { name: 'Random segment', low: true, usesDensity: true, make(W, H, o) {
      const a = new Uint8Array(W), s = Math.max(4, Math.round(W / 6)), x0 = (W - s) >> 1;
      for (let i = x0; i < x0 + s; i++) a[i] = Math.random() < o.density ? 1 : 0; return a;
    } },
    hardcore: { name: 'Random segment, no adjacent 1s', low: true, usesDensity: true, make(W, H, o) {
      const a = new Uint8Array(W), s = Math.max(4, Math.round(W / 6)), x0 = (W - s) >> 1;
      for (let i = x0; i < x0 + s; i++) a[i] = !a[i - 1] && Math.random() < o.density ? 1 : 0; return a;
    } },
    half: { name: 'Gas in the left half', low: true, usesDensity: true, make(W, H, o) {
      const a = new Uint8Array(W); for (let i = 0; i < W / 2; i++) a[i] = Math.random() < o.density ? 1 : 0; return a;
    } },
    message: { name: 'Message (ASCII bits)', low: true, usesText: true, make(W, H, o) {
      const a = new Uint8Array(W), bits = [];
      for (const ch of (o.text || 'hi')) { const c = ch.charCodeAt(0) & 255; for (let k = 7; k >= 0; k--) bits.push((c >> k) & 1); }
      const L = Math.min(bits.length, W), x0 = (W - L) >> 1;
      for (let i = 0; i < L; i++) a[x0 + i] = bits[i];
      return a;
    } },
    random: { name: 'Random (iid)', low: false, usesDensity: true, make(W, H, o) { return rand(W, o.density); } },
    blank: { name: 'Empty', low: true, make(W) { return new Uint8Array(W); } },
  };

  /** Fill state S (cur, and prev for second-order rules) from the initial-condition options o. */
  function fill(S, dim, W, H, o) {
    const lib = dim === 1 ? P1 : P2;
    const pat = lib[o.pattern] || lib.blank;
    S.cur.set(pat.make(W, H, o));
    if (S.prev) {
      if (o.past === 'same') S.prev.set(S.cur);
      else if (o.past === 'random') S.prev.set(rand(W * H, o.density));
      else S.prev.fill(0);
    }
  }

  root.Patterns = { P1, P2, fill };
})(typeof window !== 'undefined' ? window : globalThis);
