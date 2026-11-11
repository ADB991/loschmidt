/* Loschmidt · rules.js
 * Reversible binary cellular automata on a periodic board: steppers, rule families, catalogue.
 *
 * A state is { cur, prev, tmp }: Uint8Arrays of length W*H (H = 1 in 1D). `prev` is used only by
 * second-order rules, whose microstate is the pair (x^{t-1}, x^t). Every engine exposes
 *   step(S, t)   : state at time t   -> state at time t+1   (in place)
 *   unstep(S, t) : state at time t   -> state at time t-1   (in place)
 * Engines whose update depends on t (staggered, block-partitioned and layered rules) read it from t.
 */
(function (root) {
  'use strict';

  const mod = (t, p) => ((t % p) + p) % p;
  const par = (t) => mod(t, 2);

  /* ------------------------------------------------------------------ state helpers */

  function newState(n, order) {
    return { cur: new Uint8Array(n), prev: order === 2 ? new Uint8Array(n) : null, tmp: new Uint8Array(n) };
  }
  function cloneState(S) {
    return { cur: S.cur.slice(), prev: S.prev ? S.prev.slice() : null, tmp: new Uint8Array(S.cur.length) };
  }
  function copyState(D, S) {
    D.cur.set(S.cur);
    if (S.prev) D.prev.set(S.prev);
  }
  function sameState(A, B) {
    const a = A.cur, b = B.cur;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    if (A.prev) {
      const p = A.prev, q = B.prev;
      for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
    }
    return true;
  }
  function invertPerm(T) {
    const inv = new Uint8Array(T.length).fill(255);
    for (let v = 0; v < T.length; v++) {
      if (inv[T[v]] !== 255) return null; // not a bijection
      inv[T[v]] = v;
    }
    return inv;
  }

  /* ------------------------------------------------------------------ 1D engines */

  // Second-order (Fredkin) elementary rule NR:  x_i^{t+1} = f_N(x_{i-1}^t, x_i^t, x_{i+1}^t) XOR x_i^{t-1}
  function eca2Engine(N, W) {
    const tab = new Uint8Array(8);
    for (let k = 0; k < 8; k++) tab[k] = (N >> k) & 1;
    function F(src, add, dst) {
      const n = W;
      dst[0] = tab[(src[n - 1] << 2) | (src[0] << 1) | src[1]] ^ add[0];
      for (let i = 1; i < n - 1; i++) dst[i] = tab[(src[i - 1] << 2) | (src[i] << 1) | src[i + 1]] ^ add[i];
      dst[n - 1] = tab[(src[n - 2] << 2) | (src[n - 1] << 1) | src[0]] ^ add[n - 1];
    }
    return {
      step(S) { F(S.cur, S.prev, S.tmp); const o = S.prev; S.prev = S.cur; S.cur = S.tmp; S.tmp = o; },
      unstep(S) { F(S.prev, S.cur, S.tmp); const o = S.cur; S.cur = S.prev; S.prev = S.tmp; S.tmp = o; },
    };
  }

  // Second-order totalistic rule of radius r (Bennett's SCARVES is r = 2, S = {2}):
  //   x_i^{t+1} = x_i^{t-1} XOR [ Σ_{0<|d|<=r} x_{i+d}^t ∈ S ]
  function tot1Engine(r, Sset, W) {
    const flag = new Uint8Array(2 * r + 1);
    for (const k of Sset) if (k >= 0 && k <= 2 * r) flag[k] = 1;
    function F(src, add, dst) {
      let s = 0; // running window sum over i-r..i+r, minus the centre
      for (let d = -r; d <= r; d++) s += src[mod(d, W)];
      for (let i = 0; i < W; i++) {
        dst[i] = flag[s - src[i]] ^ add[i];
        s += src[(i + r + 1) % W] - src[mod(i - r, W)];
      }
    }
    return {
      step(S) { F(S.cur, S.prev, S.tmp); const o = S.prev; S.prev = S.cur; S.cur = S.tmp; S.tmp = o; },
      unstep(S) { F(S.prev, S.cur, S.tmp); const o = S.cur; S.cur = S.prev; S.prev = S.tmp; S.tmp = o; },
    };
  }

  // Staggered (Bobenko / Floquet) rule: on the sublattice i ≡ t (mod 2),  s_i <- s_i XOR f(s_{i-1}, s_{i+1}).
  // f is indexed by (l << 1) | r. Each half-step is an involution, so the inverse replays the previous parity.
  function stag1Engine(f, W) {
    function half(c, p) {
      for (let i = p; i < W; i += 2) {
        const l = c[i === 0 ? W - 1 : i - 1], r = c[i === W - 1 ? 0 : i + 1];
        c[i] ^= f[(l << 1) | r];
      }
    }
    return { step(S, t) { half(S.cur, par(t)); }, unstep(S, t) { half(S.cur, par(t - 1)); } };
  }

  // 1D block-partitioned rule: pairs (2b+o, 2b+o+1) with offset o = t mod 2; block value = left | right<<1.
  function block1Engine(tabs, W) {
    const inv = tabs.map(invertPerm);
    function apply(c, o, T) {
      for (let b = o; b < W + o; b += 2) {
        const i = b % W, j = (b + 1) % W;
        const u = T[c[i] | (c[j] << 1)];
        c[i] = u & 1; c[j] = u >> 1;
      }
    }
    return {
      step(S, t) { const p = par(t); apply(S.cur, p, tabs[p]); },
      unstep(S, t) { const p = par(t - 1); apply(S.cur, p, inv[p]); },
    };
  }

  // Pozsgay's folded-XXZ automaton: the gate on sites j..j+3 swaps s_{j+1}, s_{j+2} iff s_j = s_{j+3}.
  // Layer m = t mod 3 applies the gates at j ≡ m (mod 3); their targets are disjoint and their controls
  // are untouched, so each layer is an involution. Needs W divisible by 3.
  function fxxzEngine(W) {
    function layer(c, m) {
      for (let j = m; j < W + m; j += 3) {
        const a = j % W, b = (j + 1) % W, d = (j + 2) % W, e = (j + 3) % W;
        if (c[a] === c[e] && c[b] !== c[d]) { c[b] ^= 1; c[d] ^= 1; }
      }
    }
    return { step(S, t) { layer(S.cur, mod(t, 3)); }, unstep(S, t) { layer(S.cur, mod(t - 1, 3)); } };
  }

  // Box-ball system (Takahashi–Satsuma) on a ring. Each ball is matched to an empty box on its right by
  // bracket matching (ball = '(', empty = ')'), then all matched pairs swap. The inverse is the mirror image.
  function bbsEngine(W) {
    const stack = new Int32Array(W), mate = new Int32Array(W);
    function move(c, dir) {
      mate.fill(-1);
      let sp = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < W; k++) {
          const i = dir > 0 ? k : W - 1 - k;
          if (c[i]) { if (pass === 0) stack[sp++] = i; }
          else if (mate[i] < 0 && sp > 0) { const j = stack[--sp]; mate[i] = j; mate[j] = i; }
        }
      }
      for (let i = 0; i < W; i++) if (mate[i] >= 0) c[i] ^= 1;
    }
    return { step(S) { move(S.cur, 1); }, unstep(S) { move(S.cur, -1); } };
  }

  /* ------------------------------------------------------------------ 2D engines */

  function wrapIdx(W) {
    const xm = new Int32Array(W), xp = new Int32Array(W);
    for (let x = 0; x < W; x++) { xm[x] = (x + W - 1) % W; xp[x] = (x + 1) % W; }
    return [xm, xp];
  }

  // Margolus neighbourhood: 2x2 blocks, partition offset (o, o) with o = t mod 2.
  // Block value bits: UL = 1, UR = 2, LL = 4, LR = 8  (y grows downwards on screen; Golly/MCell convention).
  function margolusEngine(tabs, W, H) {
    const inv = tabs.map(invertPerm);
    function apply(c, o, T) {
      for (let by = o; by < H + o; by += 2) {
        const r0 = (by % H) * W, r1 = ((by + 1) % H) * W;
        for (let bx = o; bx < W + o; bx += 2) {
          const x0 = bx % W, x1 = (bx + 1) % W;
          const a = r0 + x0, b = r0 + x1, d = r1 + x0, e = r1 + x1;
          const v = c[a] | (c[b] << 1) | (c[d] << 2) | (c[e] << 3);
          const u = T[v];
          if (u !== v) { c[a] = u & 1; c[b] = (u >> 1) & 1; c[d] = (u >> 2) & 1; c[e] = u >> 3; }
        }
      }
    }
    return {
      step(S, t) { const p = par(t); apply(S.cur, p, tabs[p]); },
      unstep(S, t) { const p = par(t - 1); apply(S.cur, p, inv[p]); },
    };
  }

  // Checkerboard-staggered rule (Q2R family): on the sublattice x+y ≡ t (mod 2), flip a cell iff the number
  // of live von Neumann neighbours n has flip[n] = 1. Neighbours lie on the other sublattice, so each
  // half-step is an involution.
  function checkerEngine(flip, W, H) {
    const [xm, xp] = wrapIdx(W);
    function half(c, p) {
      for (let y = 0; y < H; y++) {
        const r = y * W, ru = ((y + H - 1) % H) * W, rd = ((y + 1) % H) * W;
        for (let x = (y + p) & 1; x < W; x += 2) {
          const n = c[r + xm[x]] + c[r + xp[x]] + c[ru + x] + c[rd + x];
          if (flip[n]) c[r + x] ^= 1;
        }
      }
    }
    return { step(S, t) { half(S.cur, par(t)); }, unstep(S, t) { half(S.cur, par(t - 1)); } };
  }

  // Second-order outer-totalistic rule (Fredkin):  x^{t+1} = F_{B/S}(x^t) XOR x^{t-1}
  function second2Engine(B, Sv, moore, W, H) {
    const tab = new Uint8Array(18);
    for (let n = 0; n <= 8; n++) { tab[n] = B.includes(n) ? 1 : 0; tab[9 + n] = Sv.includes(n) ? 1 : 0; }
    const [xm, xp] = wrapIdx(W);
    function F(src, add, dst) {
      for (let y = 0; y < H; y++) {
        const r = y * W, ru = ((y + H - 1) % H) * W, rd = ((y + 1) % H) * W;
        for (let x = 0; x < W; x++) {
          const a = xm[x], b = xp[x];
          let n = src[r + a] + src[r + b] + src[ru + x] + src[rd + x];
          if (moore) n += src[ru + a] + src[ru + b] + src[rd + a] + src[rd + b];
          const i = r + x;
          dst[i] = tab[src[i] * 9 + n] ^ add[i];
        }
      }
    }
    return {
      step(S) { F(S.cur, S.prev, S.tmp); const o = S.prev; S.prev = S.cur; S.cur = S.tmp; S.tmp = o; },
      unstep(S) { F(S.prev, S.cur, S.tmp); const o = S.cur; S.cur = S.prev; S.prev = S.tmp; S.tmp = o; },
    };
  }

  /* ------------------------------------------------------------------ causal light cones */
  // Influence steppers have the same shape as the engines but act on masks: after a step, a cell is marked iff
  // its new value can depend on a marked cell, given the rule's update structure (its neighbourhood, blocks,
  // sublattices, layers), whatever the cell values. Stepping forwards from a marked slice gives the future
  // light cone, stepping backwards the past one. The cells that actually change are always a subset.

  function secondOrderCone(dilate, n) {
    // x^{t+1} depends on x^t through the neighbourhood and on x^{t-1} at the same cell
    const F = (src, add, dst) => { dilate(src, dst); for (let i = 0; i < n; i++) dst[i] |= add[i]; };
    return {
      step(S) { F(S.cur, S.prev, S.tmp); const o = S.prev; S.prev = S.cur; S.cur = S.tmp; S.tmp = o; },
      unstep(S) { F(S.prev, S.cur, S.tmp); const o = S.cur; S.cur = S.prev; S.prev = S.tmp; S.tmp = o; },
    };
  }
  function dilate1(r, centre, W) {
    return (src, dst) => {
      for (let i = 0; i < W; i++) {
        let v = centre ? src[i] : 0;
        for (let d = 1; d <= r && !v; d++) v = src[(i + d) % W] | src[mod(i - d, W)];
        dst[i] = v;
      }
    };
  }
  function dilate2(moore, W, H) {
    return (src, dst) => {
      for (let y = 0; y < H; y++) {
        const r = y * W, ru = ((y + H - 1) % H) * W, rd = ((y + 1) % H) * W;
        for (let x = 0; x < W; x++) {
          const a = (x + W - 1) % W, b = (x + 1) % W;
          let v = src[r + x] | src[r + a] | src[r + b] | src[ru + x] | src[rd + x];
          if (moore) v |= src[ru + a] | src[ru + b] | src[rd + a] | src[rd + b];
          dst[r + x] = v;
        }
      }
    };
  }
  // block rules: a block touched by the cone joins it whole
  const byPartition = (run) => ({ step(S, t) { run(S.cur, par(t)); }, unstep(S, t) { run(S.cur, par(t - 1)); } });

  function coneEngine(family, p, W, H) {
    if (family === 'eca2') return secondOrderCone(dilate1(1, true, W), W);
    if (family === 'tot1') return secondOrderCone(dilate1(p.r, false, W), W);
    if (family === 'second2') return secondOrderCone(dilate2(p.moore, W, H), W * H);
    if (family === 'stag1') {
      const half = (c, q) => { for (let i = q; i < W; i += 2) c[i] |= c[mod(i - 1, W)] | c[(i + 1) % W]; };
      return { step(S, t) { half(S.cur, par(t)); }, unstep(S, t) { half(S.cur, par(t - 1)); } };
    }
    if (family === 'checker') {
      const half = (c, q) => {
        for (let y = 0; y < H; y++) {
          const r = y * W, ru = ((y + H - 1) % H) * W, rd = ((y + 1) % H) * W;
          for (let x = (y + q) & 1; x < W; x += 2) c[r + x] |= c[r + (x + W - 1) % W] | c[r + (x + 1) % W] | c[ru + x] | c[rd + x];
        }
      };
      return { step(S, t) { half(S.cur, par(t)); }, unstep(S, t) { half(S.cur, par(t - 1)); } };
    }
    if (family === 'block1') {
      return byPartition((c, o) => {
        for (let b = o; b < W + o; b += 2) { const i = b % W, j = (b + 1) % W; if (c[i] | c[j]) c[i] = c[j] = 1; }
      });
    }
    if (family === 'margolus') {
      return byPartition((c, o) => {
        for (let by = o; by < H + o; by += 2) {
          const r0 = (by % H) * W, r1 = ((by + 1) % H) * W;
          for (let bx = o; bx < W + o; bx += 2) {
            const x0 = bx % W, x1 = (bx + 1) % W, a = r0 + x0, b = r0 + x1, d = r1 + x0, e = r1 + x1;
            if (c[a] | c[b] | c[d] | c[e]) c[a] = c[b] = c[d] = c[e] = 1;
          }
        }
      });
    }
    if (family === 'fxxz') {
      const layer = (c, m) => {
        for (let j = m; j < W + m; j += 3) {
          const a = j % W, b = (j + 1) % W, d = (j + 2) % W, e = (j + 3) % W;
          if (c[a] | c[b] | c[d] | c[e]) { c[b] = 1; c[d] = 1; }
        }
      };
      return { step(S, t) { layer(S.cur, mod(t, 3)); }, unstep(S, t) { layer(S.cur, mod(t - 1, 3)); } };
    }
    // box-ball system: the bracket matching is global, so one step can reach anywhere
    const all = (c) => { let v = 0; for (let i = 0; i < c.length; i++) v |= c[i]; if (v) c.fill(1); };
    return { step(S) { all(S.cur); }, unstep(S) { all(S.cur); } };
  }

  /* ------------------------------------------------------------------ block-map helpers */

  const UL = 1, UR = 2, LL = 4, LR = 8;
  const pop4 = (v) => (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
  const rot180 = (v) => ((v & UL) ? LR : 0) | ((v & UR) ? LL : 0) | ((v & LL) ? UR : 0) | ((v & LR) ? UL : 0);
  const rotCW = (v) => ((v & UL) ? UR : 0) | ((v & UR) ? LR : 0) | ((v & LR) ? LL : 0) | ((v & LL) ? UL : 0);
  const rotCCW = (v) => ((v & UL) ? LL : 0) | ((v & LL) ? LR : 0) | ((v & LR) ? UR : 0) | ((v & UR) ? UL : 0);
  const isDiag = (v) => v === (UL | LR) || v === (UR | LL);
  const table16 = (fn) => Array.from({ length: 16 }, (_, v) => fn(v));
  const table4 = (fn) => Array.from({ length: 4 }, (_, v) => fn(v));

  /* ------------------------------------------------------------------ conserved quantities */
  // Each takes (S, t, W, H, p) and returns a number that the rules declaring it keep constant.

  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const CONSERVED = {
    N: { name: 'particles N', fn: (S) => sum(S.cur) },
    Nalt: { name: 'N at even t', tip: 'Particle number at even times; it alternates N ↔ WH − N.', fn: (S, t) => (par(t) ? S.cur.length - sum(S.cur) : sum(S.cur)) },
    walls: {
      name: 'domain walls', tip: 'Number of unlike neighbouring pairs: the Ising energy.',
      fn: (S, t, W, H) => {
        const c = S.cur; let k = 0;
        if (H === 1) { for (let i = 0; i < W; i++) k += c[i] ^ c[(i + 1) % W]; return k; }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = c[y * W + x]; k += (v ^ c[y * W + (x + 1) % W]) + (v ^ c[((y + 1) % H) * W + x]); }
        return k;
      },
    },
    K: {
      name: 'kink energy K', tip: 'K = Σ_i [x_i^{t−1} ≠ x_{i+1}^t] + [x_{i+1}^{t−1} ≠ x_i^t], the mixed-time bond energy (Takesue).',
      fn: (S, t, W) => { const p = S.prev, q = S.cur; let k = 0; for (let i = 0; i < W; i++) { const j = (i + 1) % W; k += (p[i] ^ q[j]) + (p[j] ^ q[i]); } return k; },
    },
    KR: { name: 'right kinks K_R', tip: 'K_R = Σ_i [x_i^{t−1} ≠ x_{i+1}^t]', fn: (S, t, W) => { const p = S.prev, q = S.cur; let k = 0; for (let i = 0; i < W; i++) k += p[i] ^ q[(i + 1) % W]; return k; } },
    KL: { name: 'left kinks K_L', tip: 'K_L = Σ_i [x_{i+1}^{t−1} ≠ x_i^t]', fn: (S, t, W) => { const p = S.prev, q = S.cur; let k = 0; for (let i = 0; i < W; i++) k += p[(i + 1) % W] ^ q[i]; return k; } },
    Kr: {
      name: 'kink energy K_r', tip: 'K_r = Σ_i Σ_{d=1}^{r} [x_i^{t−1} ≠ x_{i+d}^t] + [x_{i+d}^{t−1} ≠ x_i^t]',
      fn: (S, t, W, H, p) => { const a = S.prev, q = S.cur; let k = 0; for (let i = 0; i < W; i++) for (let d = 1; d <= p.r; d++) { const j = (i + d) % W; k += (a[i] ^ q[j]) + (a[j] ^ q[i]); } return k; },
    },
    B37: { name: 'frozen 2×2 blocks B', tip: 'B = Σ_i x_i^{t−1} x_{i+1}^{t−1} x_i^t x_{i+1}^t', fn: (S, t, W) => { const p = S.prev, q = S.cur; let k = 0; for (let i = 0; i < W; i++) { const j = (i + 1) % W; k += p[i] & p[j] & q[i] & q[j]; } return k; } },
    sol54: {
      name: 'solitons N₊ / N₋', tip: 'N_tot = Σ (2s_i − 3 s_i s_{i+1} + 2 s_i s_{i+1} s_{i+2}) and N_net = (−1)^t Σ (−1)^i s_i s_{i+1}; N± = (N_tot ± N_net)/2.',
      fn: (S, t, W) => {
        const s = S.cur; let tot = 0, net = 0;
        for (let i = 0; i < W; i++) {
          const a = s[i], b = s[(i + 1) % W], c = s[(i + 2) % W];
          tot += 2 * a - 3 * a * b + 2 * a * b * c;
          net += (i & 1 ? -1 : 1) * a * b;
        }
        if (par(t)) net = -net;
        return `${(tot + net) / 2} / ${(tot - net) / 2}`;
      },
    },
  };

  /* ------------------------------------------------------------------ analysis */

  function isAffine(T, bitsIn) {
    // T: lookup over GF(2)^bitsIn -> GF(2)^k. Affine iff T(a^b) ^ T(0) == T(a) ^ T(b) for all a, b.
    const N = 1 << bitsIn;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if ((T[a ^ b] ^ T[0]) !== (T[a] ^ T[b])) return false;
    return true;
  }

  function ecaWolframOfStag(f) {
    let N = 0;
    for (let l = 0; l < 2; l++) for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++)
      N |= (c ^ f[(l << 1) | r]) << ((l << 2) | (c << 1) | r);
    return N;
  }
  // The staggered rule with f(l, r) is two decoupled copies of the second-order rule with f(a, b, c) = f(a, c).
  function secondOrderTwinOfStag(f) {
    let N = 0;
    for (let k = 0; k < 8; k++) N |= f[(((k >> 2) & 1) << 1) | (k & 1)] << k;
    return N;
  }

  // Properties computed from the parameters, so custom rules get honest badges too.
  function analyse(family, p) {
    const out = { conserving: false, alternating: false, linear: false, conserved: [] };
    if (family === 'block1' || family === 'margolus') {
      const popf = family === 'block1' ? ((v) => (v & 1) + (v >> 1)) : pop4;
      const size = family === 'block1' ? 2 : 4;
      out.conserving = p.tabs.every((T) => T.every((u, v) => popf(u) === popf(v)));
      out.alternating = !out.conserving && p.tabs.every((T) => T.every((u, v) => popf(u) === size - popf(v)));
      out.linear = p.tabs.every((T) => isAffine(T, size));
    } else if (family === 'eca2') {
      const tab = Array.from({ length: 8 }, (_, k) => (p.N >> k) & 1);
      out.linear = isAffine(tab, 3);
      // flips only when the outer neighbours differ: f(0,b,0) = f(1,b,1) = 0, i.e. bits 0, 2, 5, 7 clear
      if (!(p.N & 0b10100101)) out.conserved.push(p.N === 90 ? 'KR' : 'K');
      if (p.N === 90) out.conserved.push('KL');
      if (p.N === 37) out.conserved.push('B37');
    } else if (family === 'tot1') {
      out.linear = p.S.length === p.r && p.S.every((k, j) => k === 2 * j + 1);
      if (p.S.length === 1 && p.S[0] === p.r) out.conserved.push('Kr');
    } else if (family === 'stag1') {
      out.linear = isAffine(p.f, 2);
      const f = p.f.join('');
      if (f === '0110') out.conserved.push('walls');
      if (f === '0111') out.conserved.push('sol54');
    } else if (family === 'checker') {
      const f = p.flip;
      out.linear = [[0, 1, 0, 1, 0], [1, 0, 1, 0, 1], [0, 0, 0, 0, 0], [1, 1, 1, 1, 1]].some((g) => g.every((v, n) => v === f[n]));
      if (f[0] === 0 && f[1] === 0 && f[3] === 0 && f[4] === 0) out.conserved.push('walls');
    } else if (family === 'second2') {
      // linear iff F(c, n) = a*c XOR b*(n mod 2) XOR k for constants
      let lin = false;
      const nmax = p.moore ? 8 : 4;
      for (let a = 0; a < 2 && !lin; a++) for (let b = 0; b < 2 && !lin; b++) for (let k = 0; k < 2 && !lin; k++) {
        let ok = true;
        for (let c = 0; c < 2 && ok; c++) for (let n = 0; n <= nmax && ok; n++) {
          const F = c ? p.S.includes(n) : p.B.includes(n);
          if ((F ? 1 : 0) !== ((a & c) ^ (b & n & 1) ^ k)) ok = false;
        }
        lin = ok;
      }
      out.linear = lin;
    } else if (family === 'bbs' || family === 'fxxz') {
      out.conserving = true;
    }
    if (out.conserving) out.conserved.unshift('N');
    if (out.alternating) out.conserved.unshift('Nalt');
    return out;
  }

  /* ------------------------------------------------------------------ families */

  const FAMILIES = {
    stag1: {
      dim: 1, order: 1, period: 2, label: 'Staggered elementary (Bobenko)',
      make: (p, W) => stag1Engine(Uint8Array.from(p.f), W),
      tex: () => 's_i \\leftarrow s_i \\oplus f(s_{i-1}, s_{i+1})',
      note: 'Only sites with i ≡ t (mod 2) update at step t; each row of the diagram is one half-step.',
    },
    eca2: {
      dim: 1, order: 2, period: 1, label: 'Second-order elementary (Fredkin)',
      make: (p, W) => eca2Engine(p.N, W),
      tex: () => 'x_i^{t+1} = f_N\\big(x_{i-1}^t,\\, x_i^t,\\, x_{i+1}^t\\big) \\oplus x_i^{t-1}',
      note: 'Any f gives a reversible rule: x^{t−1} = f(x^t) ⊕ x^{t+1}. The microstate is the pair of slices (x^{t−1}, x^t).',
    },
    tot1: {
      dim: 1, order: 2, period: 1, label: 'Second-order totalistic, radius r',
      make: (p, W) => tot1Engine(p.r, p.S, W),
      tex: () => 'x_i^{t+1} = x_i^{t-1} \\oplus \\Big[\\textstyle\\sum_{0 < |d| \\le r} x_{i+d}^t \\in S\\Big]',
      note: 'A 1D cousin of Q2R. With S = {r} a cell flips only when half its neighbours are on, which conserves a kink energy.',
    },
    block1: {
      dim: 1, order: 1, period: 2, label: 'Block-partitioned (2-cell Margolus)',
      make: (p, W) => block1Engine(p.tabs.map((T) => Uint8Array.from(T)), W),
      tex: () => '(s_{2b+o}, s_{2b+o+1}) \\mapsto \\pi(s_{2b+o}, s_{2b+o+1})',
      note: 'Pairs of cells; the partition offset is o = t mod 2. All 24 two-cell permutations are affine, so none of these rules interacts.',
    },
    fxxz: {
      dim: 1, order: 1, period: 3, mult: 3, label: 'Controlled swaps (Pozsgay)',
      make: (p, W) => fxxzEngine(W),
      tex: () => 's_{j+1} \\leftrightarrow s_{j+2} \\quad\\text{iff}\\quad s_j = s_{j+3}',
      note: 'Gates at j ≡ t (mod 3); three layers make one period. Needs a width divisible by 3.',
    },
    bbs: {
      dim: 1, order: 1, period: 1, label: 'Box-ball system',
      make: (p, W) => bbsEngine(W),
      tex: () => '\\texttt{1} = (\\qquad \\texttt{0} = )',
      note: 'Each ball jumps to the empty box its bracket closes on; matched pairs swap.',
    },
    margolus: {
      dim: 2, order: 1, period: 2, label: 'Margolus block rules',
      make: (p, W, H) => margolusEngine(p.tabs.map((T) => Uint8Array.from(T)), W, H),
      tex: () => '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix} \\mapsto \\pi_{t \\bmod 2}\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
      note: '2×2 blocks; the partition shifts by (1, 1) every step.',
    },
    checker: {
      dim: 2, order: 1, period: 2, label: 'Checkerboard-staggered (Q2R family)',
      make: (p, W, H) => checkerEngine(Uint8Array.from(p.flip), W, H),
      tex: () => 's_{x} \\leftarrow s_{x} \\oplus \\phi\\Big(\\textstyle\\sum_{y \\sim x} s_y\\Big)',
      note: 'Only the checkerboard sublattice x₁ + x₂ ≡ t (mod 2) updates at step t; its four neighbours are frozen meanwhile.',
    },
    second2: {
      dim: 2, order: 2, period: 1, label: 'Second-order outer-totalistic (Fredkin)',
      make: (p, W, H) => second2Engine(p.B, p.S, p.moore, W, H),
      tex: () => 'x^{t+1} = F_{B/S}\\big(x^t\\big) \\oplus x^{t-1}',
      note: 'Any Life-like rule F becomes reversible this way.',
    },
  };

  /* ------------------------------------------------------------------ catalogue */

  const OR = [0, 1, 1, 1], XOR = [0, 1, 1, 0], NOR = [1, 0, 0, 0], XNOR = [1, 0, 0, 1];
  const both = (T) => [T, T];
  const TM87 = { t: 'Toffoli & Margolus, Cellular Automata Machines, MIT Press (1987)', url: 'https://mitpress.mit.edu/9780262526319/cellular-automata-machines/' };
  const TM90 = { t: 'Toffoli & Margolus, Physica D 45, 229 (1990), Invertible cellular automata: a review', url: 'https://people.csail.mit.edu/nhm/ica.pdf' };
  const MARG99 = { t: 'Margolus, Crystalline computation (1999)', url: 'https://arxiv.org/abs/comp-gas/9811002' };
  const NKS = { t: 'Wolfram, A New Kind of Science, pp. 437–454 (2002)', url: 'https://www.wolframscience.com/nks/p437--reversibility-and-irreversibility/' };
  const INOUE = { t: 'Inoue & Takesue, J. Phys. A 51, 425001 (2018)', url: 'https://arxiv.org/abs/1806.07099' };

  const PRESETS = [
    /* ---------------- 1D · staggered ---------------- */
    {
      id: 'rca54', dim: 1, family: 'stag1', name: 'RCA54', params: { f: OR },
      tags: ['interacting', 'integrable', 'solitons'],
      desc: 'Flip a cell iff at least one neighbour is on. The simplest interacting integrable cellular automaton: solitons move at ±1 per half-step and pass through each other with a one-step delay. The numbers of left- and right-movers are conserved separately, so a soliton gas never reaches the iid state. Equivalent to two copies of the second-order rule 250R.',
      cite: [{ t: 'Bobenko, Bordemann, Gunn, Pinkall, Commun. Math. Phys. 158, 127 (1993)', url: 'https://doi.org/10.1007/BF02097234' },
        { t: 'Buča, Klobas, Prosen, J. Stat. Mech. 074001 (2021), review', url: 'https://arxiv.org/abs/2103.16543' }],
      suggest: { pattern: 'segment', density: 0.5 },
    },
    {
      id: 'rca201', dim: 1, family: 'stag1', name: 'RCA201 · Floquet PXP', params: { f: NOR },
      tags: ['interacting', 'integrable', 'constrained'],
      desc: 'Flip a cell iff both neighbours are off: the deterministic Floquet version of the PXP (Rydberg blockade) constraint. Adjacent pairs 11 freeze, so the state space fragments; in the sector without adjacent 1s three vacua cycle (000… → 0101… → 1010…), and their domain walls are quasiparticles of speed ±2/3 that attract. Integrable.',
      cite: [{ t: 'Wilkinson, Klobas, Prosen, Garrahan, Phys. Rev. E 102, 062107 (2020)', url: 'https://arxiv.org/abs/2006.06556' }],
      suggest: { pattern: 'hardcore', density: 0.5 },
    },
    {
      id: 'rca150', dim: 1, family: 'stag1', name: 'RCA150 · 1D Q2R', params: { f: XOR },
      tags: ['free'],
      desc: 'Flip a cell iff its two neighbours differ: the flip costs no Ising energy, so domain walls are conserved, and they move freely. This is the staggered form of 1D Q2R (two copies of 90R), a deterministic XOR Fredrickson–Andersen model. Linear: the light cone of a toggle is the same whatever the background.',
      cite: [INOUE, { t: 'Prosen, arXiv:2106.01292 (2021)', url: 'https://arxiv.org/abs/2106.01292' }],
      suggest: { pattern: 'block', density: 0.5 },
    },
    {
      id: 'rca105', dim: 1, family: 'stag1', name: 'RCA105', params: { f: XNOR },
      tags: ['free'],
      desc: 'Flip a cell iff its two neighbours agree. The complement of RCA150: affine, so perturbations still superpose.',
      cite: [{ t: 'Bobenko et al., Commun. Math. Phys. 158, 127 (1993)', url: 'https://doi.org/10.1007/BF02097234' }],
      suggest: { pattern: 'block', density: 0.5 },
    },
    /* ---------------- 1D · second order ---------------- */
    {
      id: 'eca2-26', dim: 1, family: 'eca2', name: 'Rule 26R · Takesue', params: { N: 26 },
      tags: ['interacting', 'thermalises'],
      desc: 'Takesue\'s thermodynamic rule. Its only local conserved quantity is the kink energy $K$, which diffuses: Fourier\'s law and the Green–Kubo formula hold. Its equilibrium is the ensemble at fixed $K$, so the measures settle near, but not at, their iid values. Compare 214R, which has no conserved quantity and lands on them.',
      cite: [{ t: 'Takesue, Phys. Rev. Lett. 64, 252 (1990)', url: 'https://doi.org/10.1103/PhysRevLett.64.252' },
        { t: 'Takesue, J. Stat. Phys. 56, 371 (1989)', url: 'https://doi.org/10.1007/BF01044442' }],
      suggest: { pattern: 'segment', density: 0.5 },
    },
    {
      id: 'eca2-214', dim: 1, family: 'eca2', name: 'Rule 214R', params: { N: 214 },
      tags: ['interacting', 'chaotic', 'thermalises'],
      desc: 'No local conserved quantities and no localised states: a chaotic front invades the vacuum at the speed of light and leaves an equilibrium gas behind. The generic case.',
      cite: [{ t: 'Shiraishi, Phys. Rev. E 97, 062144 (2018)', url: 'https://arxiv.org/abs/1709.06315' }],
      suggest: { pattern: 'block', density: 0.5 },
    },
    {
      id: 'eca2-90', dim: 1, family: 'eca2', name: 'Rule 90R', params: { N: 90 },
      tags: ['free'],
      desc: 'Second-order rule 90, $x_i^{t+1} = x_{i-1}^t \\oplus x_{i+1}^t \\oplus x_i^{t-1}$: 1D Q2R in second-order form. A free gas of chiral kinks; right- and left-moving kink numbers are conserved separately and energy moves ballistically. Linear.',
      cite: [{ t: 'Takesue, J. Stat. Phys. 56, 371 (1989)', url: 'https://doi.org/10.1007/BF01044442' },
        { t: 'Lindgren & Olbrich, J. Stat. Phys. 168, 919 (2017)', url: 'https://arxiv.org/abs/1703.10527' }],
      suggest: { pattern: 'segment', density: 0.5 },
    },
    {
      id: 'eca2-150', dim: 1, family: 'eca2', name: 'Rule 150R', params: { N: 150 },
      tags: ['looks random'],
      desc: 'Second-order rule 150, $x_i^{t+1} = x_{i-1}^t \\oplus x_i^t \\oplus x_{i+1}^t \\oplus x_i^{t-1}$. It looks random but it is linear: the damage from one toggle is a fixed fractal whatever the background, and recurrences on small rings are short. Try a 96-cell ring.',
      cite: [NKS],
      suggest: { pattern: 'single', density: 0.5 },
    },
    {
      id: 'eca2-37', dim: 1, family: 'eca2', name: 'Rule 37R', params: { N: 37 },
      tags: ['interacting', 'structures'],
      desc: 'Wolfram\'s example of a rule that "does not in any meaningful way obey the Second Law": it fluctuates between order and disorder. It conserves the number $B$ of frozen 2×2 all-ones blocks. The seed 101 with an empty past makes a structure of period 666.',
      cite: [NKS],
      suggest: { pattern: 'pair', density: 0.5 },
    },
    {
      id: 'scarves', dim: 1, family: 'tot1', name: 'SCARVES (Bennett)', params: { r: 2, S: [2] },
      tags: ['interacting', 'particles'],
      desc: 'Flip a cell (relative to its past) iff exactly two of its four neighbours within distance 2 are on: a 1D Q2R with a longer reach. It conserves the kink energy $K_2$ and carries many interacting "particles" of different sizes and speeds.',
      cite: [TM90, MARG99],
      suggest: { pattern: 'segment', density: 0.5 },
    },
    /* ---------------- 1D · particle-conserving ---------------- */
    {
      id: 'fxxz', dim: 1, family: 'fxxz', name: 'Folded XXZ (Pozsgay)', params: {},
      tags: ['interacting', 'integrable', 'local'],
      desc: 'Swap the middle pair of four sites iff the outer two agree. Local, particle-conserving, interacting and Yang–Baxter integrable. Three species: right-movers (speed 1), left-movers (average speed 1/2), and frozen blocks of two or more 1s; scattering is elastic with shifts.',
      cite: [{ t: 'Pozsgay, J. Phys. A 54, 384001 (2021)', url: 'https://arxiv.org/abs/2106.00696' }],
      suggest: { pattern: 'segment', density: 0.5 },
    },
    {
      id: 'swap1', dim: 1, family: 'block1', name: 'Ballistic gas (swap)', params: { tabs: both([0, 2, 1, 3]) },
      tags: ['free'],
      desc: 'Swap the two cells of every block, with the partition shifting by one each step. Every particle moves at speed 1 left or right forever, passing through the others. Left- and right-movers are conserved separately and the board recurs exactly after $W$ steps.',
      cite: [TM87],
      suggest: { pattern: 'half', density: 0.5 },
    },
    {
      id: 'bbs', dim: 1, family: 'bbs', name: 'Box-ball system', params: {},
      tags: ['integrable', 'solitons', 'nonlocal'],
      desc: 'Each ball jumps to the first free box to its right, all at once, with balls matched to boxes like brackets. Blocks of $k$ balls are solitons of speed $k$ that scatter elastically; there are infinitely many conserved quantities. Nonlocal. Defined for density $< 1/2$; above that, unmatched balls stay put.',
      cite: [{ t: 'Takahashi & Satsuma, J. Phys. Soc. Jpn. 59, 3514 (1990)', url: 'https://doi.org/10.1143/JPSJ.59.3514' },
        { t: 'Yura & Tokihiro, J. Phys. A 35, 3787 (2002), periodic BBS', url: 'https://arxiv.org/abs/nlin/0112041' }],
      suggest: { pattern: 'segment', density: 0.3 },
    },

    /* ---------------- 2D · Margolus ---------------- */
    {
      id: 'critters', dim: 2, family: 'margolus', name: 'Critters',
      params: { tabs: both([15, 14, 13, 3, 11, 5, 6, 1, 7, 9, 10, 2, 12, 4, 8, 0]) },
      tags: ['interacting', 'gliders', 'thermalises', 'universal'],
      desc: 'Blocks with exactly two particles stay put; every other block is complemented, and blocks that held three are also rotated by 180°. Gliders emerge, collide and scatter, and a gas of them thermalises. The particle number alternates $N \\leftrightarrow WH-N$: the dual view complements odd frames.',
      cite: [TM87, MARG99],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
    {
      id: 'bbm', dim: 2, family: 'margolus', name: 'Billiard Ball Model',
      params: { tabs: both(table16((v) => (pop4(v) === 1 ? rot180(v) : isDiag(v) ? rotCW(v) : v))) },
      tags: ['interacting', 'universal'],
      desc: 'A lone particle crosses its block diagonally; two particles meeting head-on on a diagonal leave on the other diagonal; every other block stays put. Pairs of particles behave as billiard balls, and the rule is computation-universal.',
      cite: [{ t: 'Margolus, Physica D 10, 81 (1984)', url: 'https://doi.org/10.1016/0167-2789(84)90252-5' }, MARG99],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'hpp', dim: 2, family: 'margolus', name: 'HPP gas',
      params: { tabs: both(table16((v) => (isDiag(v) ? rotCW(v) : rot180(v)))) },
      tags: ['interacting', 'momentum'],
      desc: 'Every particle crosses its block diagonally, except head-on pairs, which leave on the other diagonal. Conserves particle number and momentum, and also the momentum along each lattice line: spurious invariants that keep it from full equilibrium. A solid square in a random background sends out a round pressure wave.',
      cite: [TM87, { t: 'Hardy, de Pazzis, Pomeau, Phys. Rev. A 13, 1949 (1976)', url: 'https://doi.org/10.1103/PhysRevA.13.1949' }],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'tmgas', dim: 2, family: 'margolus', name: 'TM gas',
      params: { tabs: [table16((v) => (isDiag(v) ? v : rotCW(v))), table16((v) => (isDiag(v) ? v : rotCCW(v)))] },
      tags: ['interacting', 'momentum'],
      desc: 'Rotate each block clockwise on even steps and anticlockwise on odd steps, except diagonal pairs, which stay. Lone particles move horizontally and vertically; head-on collisions scatter by 90°. Mixes momentum better than HPP.',
      cite: [TM87, MARG99],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'schaeffer', dim: 2, family: 'margolus', name: 'Schaeffer',
      params: { tabs: both(table16((v) => (pop4(v) === 3 ? v : rot180(v)))) },
      tags: ['interacting', 'physically universal'],
      desc: 'Swap opposite corners of every block unless it holds exactly three particles. The first physically universal cellular automaton: any transformation of a finite region can be implemented by preparing its surroundings. Every particle in a bounded region eventually escapes.',
      cite: [{ t: 'Schaeffer, ITCS 2015, A physically universal cellular automaton', url: 'https://eccc.weizmann.ac.il/report/2014/084/' }],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'bounce', dim: 2, family: 'margolus', name: 'Bounce gas',
      params: { tabs: both(table16((v) => (pop4(v) === 1 || pop4(v) === 3 ? rot180(v) : isDiag(v) ? rotCW(v) : v))) },
      tags: ['interacting'],
      desc: 'BBM, except that blocks with three particles also rotate by 180°: particles bounce off each other instead of forming walls.',
      cite: [{ t: 'Tyler, via MCell and js-revca', url: 'https://dmishin.github.io/js-revca/help.html' }],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'srot', dim: 2, family: 'margolus', name: 'Single Rotation',
      params: { tabs: both(table16((v) => (pop4(v) === 1 ? rotCW(v) : v))) },
      tags: ['interacting', 'spaceships'],
      desc: 'Rotate a block by 90° clockwise iff it holds exactly one particle; every other block stays put. Chiral and minimal; a lone cell is a period-4 oscillator, and hundreds of spaceships are known.',
      cite: [{ t: 'Shintyakov, js-revca (2013)', url: 'https://dmishin.github.io/js-revca/' }],
      suggest: { pattern: 'box', density: 0.5 },
    },
    {
      id: 'tron', dim: 2, family: 'margolus', name: 'Tron',
      params: { tabs: both(table16((v) => (v === 0 || v === 15 ? v ^ 15 : v))) },
      tags: ['fronts'],
      desc: 'Complement uniform blocks (all on or all off); leave every other block alone. Edges of any shape fire off expanding square fronts.',
      cite: [TM87],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
    {
      id: 'diaggas', dim: 2, family: 'margolus', name: 'Free diagonal gas',
      params: { tabs: both(table16(rot180)) },
      tags: ['free'],
      desc: 'Every block is rotated by 180°: each particle flies diagonally at constant velocity and never interacts. The four velocity populations are conserved separately, so no thermalisation.',
      cite: [TM87],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
    /* ---------------- 2D · checkerboard ---------------- */
    {
      id: 'q2r', dim: 2, family: 'checker', name: 'Q2R · Ising',
      params: { flip: [0, 0, 1, 0, 0] },
      tags: ['interacting', 'thermalises'],
      desc: 'Flip a spin iff exactly two of its four neighbours are up, so the flip costs no energy: a deterministic, microcanonical Ising model that conserves $E = \\sum_{\\langle xy \\rangle} [s_x \\neq s_y]$. It thermalises to the Ising state at that energy, which is magnetised when the unlike-bond fraction is below the critical value $(2-\\sqrt{2})/4 \\approx 0.146$. Try a random start at density 0.95 (stays magnetised) against 0.9 (demagnetises).',
      cite: [{ t: 'Vichniac, Physica D 10, 96 (1984)', url: 'https://doi.org/10.1016/0167-2789(84)90253-7' },
        { t: 'Pomeau, J. Phys. A 17, L415 (1984)', url: 'https://doi.org/10.1088/0305-4470/17/8/004' }],
      suggest: { pattern: 'random', density: 0.92 },
    },
    {
      id: 'checkpar', dim: 2, family: 'checker', name: 'Checkerboard parity',
      params: { flip: [0, 1, 0, 1, 0] },
      tags: [],
      desc: 'Flip a cell iff an odd number of its four neighbours are on. Linear: perturbations superpose.',
      cite: [TM87],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
    /* ---------------- 2D · second order ---------------- */
    {
      id: 'lifeR', dim: 2, family: 'second2', name: 'Life R (second-order Life)',
      params: { B: [3], S: [2, 3], moore: true },
      tags: ['interacting', 'chaotic'],
      desc: 'Conway\'s rule made reversible by Fredkin\'s trick: $x^{t+1} = F_{\\mathrm{B3/S23}}(x^t) \\oplus x^{t-1}$. Nothing of Life survives. From a small seed it fills the torus with a chaotic gas of density near 0.64, yet from uniformly random slices it stays at 1/2, as the uniform measure on slice pairs is invariant under any bijection. So the seed\'s orbit lives where "typical" means something else.',
      cite: [TM87],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
    {
      id: 'parityR', dim: 2, family: 'second2', name: 'Parity R (Fredkin)',
      params: { B: [1, 3], S: [1, 3], moore: false },
      tags: [],
      desc: 'Second-order XOR of the four von Neumann neighbours. Linear, so patterns replicate and the board nearly recurs at times $2^k$.',
      cite: [TM87],
      suggest: { pattern: 'smiley', density: 0.5 },
    },
  ];

  /* ------------------------------------------------------------------ export */

  const RCA = {
    mod, par, newState, cloneState, copyState, sameState, invertPerm,
    FAMILIES, PRESETS, CONSERVED, analyse, ecaWolframOfStag, secondOrderTwinOfStag, coneEngine,
    blockHelpers: { UL, UR, LL, LR, pop4, rot180, rotCW, rotCCW, isDiag, table16, table4 },
  };
  root.RCA = RCA;
  if (typeof module !== 'undefined' && module.exports) module.exports = RCA;
})(typeof window !== 'undefined' ? window : globalThis);
