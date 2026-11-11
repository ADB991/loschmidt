/* Loschmidt · measures.js
 * Typicality measures of a single configuration. All are per cell, in [0, 1]:
 *   rho  density of live cells
 *   scg  coarse-grained (Boltzmann) entropy: (1/N) Σ_blocks log2 C(b, n_block), in bits per cell
 *   hb   block (pattern) entropy H_k / k of k-cell patterns, in bits per cell
 *   u    fraction of unlike nearest-neighbour bonds (domain-wall density, the Ising energy)
 * and the value each takes, on average, for an iid Bernoulli(rho) configuration of the same size.
 */
(function (root) {
  'use strict';

  const LC = []; // LC[n][k] = log2 C(n, k), n <= 64
  for (let n = 0; n <= 64; n++) {
    LC.push(new Float64Array(n + 1));
    for (let k = 1; k <= n; k++) LC[n][k] = LC[n][k - 1] + Math.log2((n - k + 1) / k);
  }

  function h2(p) {
    if (p <= 0 || p >= 1) return 0;
    return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  }

  // E[log2 C(B, K)] / B for K ~ Binomial(B, rho): the coarse-grained entropy of a typical iid configuration.
  const typCache = new Map();
  function typicalCG(B, rho) {
    const key = B * 10007 + Math.round(rho * 4000);
    if (typCache.has(key)) return typCache.get(key);
    let s = 0;
    if (rho > 0 && rho < 1) {
      const lr = Math.log2(rho), lq = Math.log2(1 - rho);
      for (let k = 0; k <= B; k++) s += Math.pow(2, LC[B][k] + k * lr + (B - k) * lq) * LC[B][k];
    }
    const v = s / B;
    if (typCache.size > 20000) typCache.clear();
    typCache.set(key, v);
    return v;
  }

  function entropyOfCounts(counts, total) {
    let H = 0;
    for (let j = 0; j < counts.length; j++) if (counts[j]) { const p = counts[j] / total; H -= p * Math.log2(p); }
    return H;
  }

  const cnt8 = new Uint32Array(8), cnt16 = new Uint32Array(16);

  /** Measures of a 1D row stored at a[o .. o+W-1]. b = coarse-graining block length (divides W). */
  function row1D(a, o, W, b, out) {
    let on = 0, unlike = 0;
    cnt8.fill(0);
    let scg = 0, blk = 0, inBlk = 0;
    let p = (a[o + W - 2] << 1) | a[o + W - 1];
    let prev = a[o + W - 1];
    for (let i = 0; i < W; i++) {
      const v = a[o + i];
      on += v;
      unlike += v ^ prev; prev = v;
      p = ((p << 1) | v) & 7; cnt8[p]++;
      blk += v;
      if (++inBlk === b) { scg += LC[b][blk]; blk = 0; inBlk = 0; }
    }
    const rho = on / W;
    out.rho = rho;
    out.scg = scg / W;
    out.scgTyp = typicalCG(b, rho);
    out.hb = entropyOfCounts(cnt8, W) / 3;
    out.hbTyp = h2(rho);
    out.u = unlike / W;
    out.uTyp = 2 * rho * (1 - rho);
    return out;
  }

  /** Measures of a 2D board. b = coarse-graining block side (divides W and H). */
  function board2D(c, W, H, b, out) {
    let on = 0, unlike = 0;
    cnt16.fill(0);
    for (let y = 0; y < H; y++) {
      const r = y * W, rd = ((y + 1) % H) * W;
      for (let x = 0; x < W; x++) {
        const xr = x + 1 === W ? 0 : x + 1;
        const v = c[r + x], vr = c[r + xr], vd = c[rd + x], vdr = c[rd + xr];
        on += v;
        unlike += (v ^ vr) + (v ^ vd);
        cnt16[v | (vr << 1) | (vd << 2) | (vdr << 3)]++;
      }
    }
    let scg = 0;
    const B = b * b;
    for (let by = 0; by < H; by += b) {
      for (let bx = 0; bx < W; bx += b) {
        let k = 0;
        for (let y = by; y < by + b; y++) { const r = y * W; for (let x = bx; x < bx + b; x++) k += c[r + x]; }
        scg += LC[B][k];
      }
    }
    const N = W * H, rho = on / N;
    out.rho = rho;
    out.scg = scg / N;
    out.scgTyp = typicalCG(B, rho);
    out.hb = entropyOfCounts(cnt16, N) / 4;
    out.hbTyp = h2(rho);
    out.u = unlike / (2 * N);
    out.uTyp = 2 * rho * (1 - rho);
    return out;
  }

  function hamming(a, ao, b, bo, n) {
    let d = 0;
    for (let i = 0; i < n; i++) d += a[ao + i] ^ b[bo + i];
    return d;
  }

  const Measures = { h2, typicalCG, row1D, board2D, hamming, LC };
  root.Measures = Measures;
  if (typeof module !== 'undefined' && module.exports) module.exports = Measures;
})(typeof window !== 'undefined' ? window : globalThis);
