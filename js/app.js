/* Loschmidt · app.js — UI, rendering, experiments */
(function () {
  'use strict';
  const { FAMILIES, PRESETS, analyse, newState, cloneState, copyState, par, ecaWolframOfStag } = window.RCA;
  const M = window.Measures, PAT = window.Patterns, History = window.History;
  const $ = (s) => document.querySelector(s);

  /* ================================================================ colour themes */
  const pk = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const hexpk = (h) => pk(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
  // ui: page surfaces and text · cell: board colours · plot: chart lines
  // cell.extra / cell.missing: on now but off in the reference / the reverse · cone, coneOn: off and on cells inside the light cone
  const THEMES = {
    paper: {
      name: 'Paper', note: 'light, ink cells',
      ui: { bg: '#f3f0e8', panel: '#faf8f3', panel2: '#f0ece2', line: '#e2dccf', line2: '#d0c8b7', text: '#22252b', muted: '#6b6458', faint: '#9a9284', accent: '#b26d12', accent2: '#2b6cb0', stage1: '#f8f5ee', stage2: '#ebe6da', chartbg: '#fffdf8', hdr1: '#fbf9f4', hdr2: '#f3f0e8', scheme: 'light' },
      cell: { off: '#f8f5ee', offNow: '#e8dfc9', offZero: '#f1e3bf', on: '#1f2228', onNow: '#5a3a08', onDim: '#aaa496', extra: '#d9472b', missing: '#1f78d1', pvOn: '#5b2fa8', pvOff: '#cbb6ef', cone: '#e6def4', coneOn: '#3a2d5c' },
      plot: { rho: '#b26d12', scg: '#c2417a', hb: '#2b6cb0', u: '#3f8f3a', d: '#d9472b', probe: '#138a5e', grid: '#e6e0d3', text: '#6b6458', preview: '#6b3fb5', cone: '#8a6fc4' },
    },
    mono: {
      name: 'Mono', note: 'black and white, muted accents',
      ui: { bg: '#000000', panel: '#0a0a0a', panel2: '#141414', line: '#222222', line2: '#333333', text: '#f2f2f2', muted: '#9a9a9a', faint: '#666666', accent: '#ffffff', accent2: '#3184d8', stage1: '#050505', stage2: '#000000', chartbg: '#050505', hdr1: '#0a0a0a', hdr2: '#000000', scheme: 'dark' },
      cell: { off: '#000000', offNow: '#2a2a2a', offZero: '#1a1a1a', on: '#ffffff', onNow: '#ffffff', onDim: '#5c5c5c', extra: '#de5951', missing: '#3184d8', pvOn: '#d8bc31', pvOff: '#665814', cone: '#25252f', coneOn: '#cecee1' },
      plot: { rho: '#ffffff', scg: '#df5772', hb: '#3184d8', u: '#4ab765', d: '#d89731', probe: '#4ab765', grid: '#1c1c1c', text: '#9a9a9a', preview: '#d8bc31', cone: '#9393ab' },
    },
  };
  let COL = {}, CSS = {}, themeId = 'paper';
  function applyTheme(id) {
    const T = THEMES[id] || THEMES.paper;
    themeId = THEMES[id] ? id : 'paper';
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(T.ui)) if (k !== 'scheme') root.setProperty('--' + k, v);
    root.setProperty('color-scheme', T.ui.scheme);
    root.setProperty('--on', T.cell.on);
    for (const k of ['extra', 'missing']) root.setProperty('--' + k, T.cell[k]);
    for (const k of ['rho', 'scg', 'hb', 'u', 'd']) root.setProperty('--c-' + k, T.plot[k]);
    root.setProperty('--probe', T.plot.probe); root.setProperty('--preview', T.plot.preview); root.setProperty('--cone', T.plot.cone);
    document.documentElement.dataset.scheme = T.ui.scheme;
    COL = Object.fromEntries(Object.entries(T.cell).map(([k, v]) => [k, hexpk(v)]));
    CSS = { ...T.plot, accent: T.ui.accent, coneHex: T.cell.cone };
    document.querySelectorAll('#themes button').forEach((b) => b.classList.toggle('active', b.dataset.theme === themeId));
    try { localStorage.setItem('loschmidt.theme.v2', themeId); } catch (e) { /* storage unavailable: the theme still applies */ }
    dirty = true;
  }
  const MAGMA = (() => {
    const stops = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(x)), f = x - k;
      const a = stops[k], b = stops[k + 1];
      lut[i] = pk(Math.round(a[0] + f * (b[0] - a[0])), Math.round(a[1] + f * (b[1] - a[1])), Math.round(a[2] + f * (b[2] - a[2])));
    }
    return lut;
  })();

  /* ================================================================ universes */
  // 1D widths are multiples of 48: even (partitions), divisible by 3 (Pozsgay layers) and by the coarse-graining block
  const SIZES = { 1: [96, 144, 192, 288, 384, 480, 576, 768, 960], 2: [64, 96, 128, 160, 192, 256, 320, 384, 512, 768, 1024] };

  function makeUniverse(dim) {
    const preset = PRESETS.find((p) => p.id === (dim === 1 ? 'rca54' : 'critters'));
    return {
      dim, size: dim === 1 ? 288 : 128,
      presetId: preset.id, family: preset.family, params: JSON.parse(JSON.stringify(preset.params)),
      init: { pattern: dim === 1 ? 'segment' : 'smiley', density: 0.5, text: dim === 1 ? 'Loschmidt' : 'hi', past: 'empty' },
      t: 0, playing: 0, lastDir: 1, speed: 30, stepAcc: 0, target: null, fastRate: 0,
      hist: null, ref: null, showDiff: true, lightcone: false, lc: null,
      tool: 'toggle', probes: [],
      ergo: { t0: 0, lo: 0, hi: -1, sum: null, note: '' },
      series: new Map(),
      rec: { origin: null, lo: 0, hi: 0, found: null, pending: false },
      echo: { stage: 0, T: dim === 1 ? 120 : 300 },
      showAvg: false, showPart: false, timeUp: true, dual: true, animate: true, reveal: null,
    };
  }
  const U1 = makeUniverse(1), U2 = makeUniverse(2);
  let U = U1;

  const W = () => U.size, H = () => (U.dim === 1 ? 1 : U.size), N = () => U.size * (U.dim === 1 ? 1 : U.size);
  const cgBlock = () => (U.dim === 1 ? (U.size >= 256 ? 16 : 8) : (U.size >= 192 ? 8 : 4));
  const fam = () => FAMILIES[U.family];
  // Rules like Critters map N -> WH - N each step; viewing odd frames complemented makes N conserved.
  const flipAt = (t) => (U.info && U.info.alternating && U.dual && par(t) === 1 ? 1 : 0);

  /* ================================================================ history management */
  function buildEngine() {
    U.engine = fam().make(U.params, W(), H());
    U.order = fam().order;
    U.info = analyse(U.family, U.params);
    U.coneEng = window.RCA.coneEngine(U.family, U.params, W(), H());
  }

  function freshState() {
    const S = newState(N(), U.order);
    PAT.fill(S, U.dim, W(), H(), U.init);
    return S;
  }

  function startHistory(S) {
    const old = U.hist;
    U.hist = new History(U.engine, N(), U.order).reset(0, S);
    startReveal(old, 0);
    U.t = 0; U.ref = null; U.lc = null; U.playing = 0; U.target = null;
    U.echo.stage = 0;
    U.ergo.t0 = 0;
    historyChanged();
  }

  /** New rule, same board: rerun the history from the current t = 0 slice. */
  function applyRule() {
    const old = U.hist ? cloneState(U.hist.at(0)) : null;
    buildEngine();
    let S;
    if (old && old.cur.length === N()) {
      S = newState(N(), U.order);
      S.cur.set(old.cur);
      if (S.prev) {
        if (old.prev) S.prev.set(old.prev);
        else if (U.init.past === 'same') S.prev.set(old.cur);
        else if (U.init.past === 'random') for (let i = 0; i < S.prev.length; i++) S.prev[i] = Math.random() < U.init.density ? 1 : 0;
      }
    } else S = freshState();
    startHistory(S);
    renderRuleUI();
  }

  function prepare() {
    if (!U.engine) buildEngine();
    startHistory(freshState());
  }

  function historyChanged() {
    U.series.clear();
    U.rec = { origin: null, lo: U.t, hi: U.t, found: null, pending: true };
    if (U.t === 0 || Math.abs(U.t) * N() * U.order < 4e7) setOrigin();
    resetErgoSums();
    if (!U.rec.pending) recCheck(); // the present itself might already be a return of the t = 0 state
    dirty = true;
  }

  function setOrigin() {
    U.rec.origin = cloneState(U.hist.at(0));
    U.rec.pending = false;
    U.hist.at(U.t);
  }

  /** With the light cone armed, freeze the pre-edit history as the reference. Returns true if it did. */
  function beginEdit() {
    if (!U.lightcone) return false;
    U.ref = U.hist.clone();
    return true;
  }
  /** Rewrite the history. Paint strokes defer the expensive bookkeeping (origin, time averages) to stroke end. */
  function editCells(t, idxs, vals, defer = false) {
    if (!U.hist.edit(t, idxs, vals)) return;
    if (defer) { U.histPending = true; U.series.clear(); dirty = true; }
    else { U.histPending = false; historyChanged(); }
  }
  function flushHistory() {
    if (U.histPending) { U.histPending = false; historyChanged(); }
  }

  /* ================================================================ time */
  function advance(dir) {
    U.t += dir;
    U.hist.at(U.t);
    syncErgo();
    recCheck();
  }
  function goTo(t) {
    if (!Number.isFinite(t)) return;
    t = Math.round(t);
    if (Math.abs(t - U.t) === 1) { advance(t - U.t); dirty = true; return; }
    if (Math.abs(t - U.t) * N() * U.order > 3e7) {
      // a long jump: run there at full speed, a frame budget at a time, so the page never freezes
      play(Math.sign(t - U.t), t);
      U.fastRate = 1e9;
      return;
    }
    U.t = t;
    U.hist.at(t);
    syncErgo();
    recCheck();
    dirty = true;
  }
  function play(dir, target = null) {
    U.playing = dir; U.lastDir = dir; U.target = target; U.stepAcc = 0;
    if (target !== null) U.fastRate = Math.max(60, Math.abs(target - U.t) / 2.2);
    dirty = true;
  }
  function pause() { U.playing = 0; U.target = null; dirty = true; }

  /* ================================================================ ergodicity */
  function resetErgoSums() {
    const E = U.ergo;
    E.sum = new Int32Array(N());
    E.lo = E.t0; E.hi = E.t0 - 1; E.note = '';
    syncErgo();
  }
  function syncErgo() {
    const E = U.ergo, n = N();
    const lo = Math.min(E.t0, U.t), hi = Math.max(E.t0, U.t);
    const cost = (Math.abs(E.lo - lo) + Math.abs(E.hi - hi)) * n;
    if (cost > 8e7) {
      E.t0 = U.t; E.lo = U.t; E.hi = U.t - 1; E.sum.fill(0);
      E.note = 'restarted at the current time: the jump was too long to replay';
      return syncErgo();
    }
    const sum = E.sum;
    const record = U.dim === 2 && n <= 65536 && (!U.playing || U.speed <= 300); // at high speed only drawn frames are charted
    const add = (t, s) => {
      const c = U.hist.at(t).cur;
      if (record && s > 0 && Math.abs(t - U.t) <= 1500 && !U.series.has(t)) recordMeasures(t, c, U.ref ? U.ref.at(t).cur : null);
      if (flipAt(t)) { for (let i = 0; i < n; i++) sum[i] += s * (1 - c[i]); }
      else for (let i = 0; i < n; i++) sum[i] += s * c[i];
    };
    let moved = false;
    while (E.hi < hi) { E.hi++; add(E.hi, 1); moved = true; }
    while (E.lo > lo) { E.lo--; add(E.lo, 1); moved = true; }
    while (E.hi > hi) { add(E.hi, -1); E.hi--; moved = true; }
    while (E.lo < lo) { add(E.lo, -1); E.lo++; moved = true; }
    if (moved) U.hist.at(U.t);
  }
  /** Largest time average over cells: the top of the colour scale for time-average maps. */
  function avgMax() {
    const E = U.ergo, T = E.hi - E.lo + 1;
    let mx = 0;
    for (let i = 0; i < E.sum.length; i++) if (E.sum[i] > mx) mx = E.sum[i];
    U.avgTop = Math.max(1e-9, mx / Math.max(1, T));
    return U.avgTop;
  }
  function ergoReset() { U.ergo.t0 = U.t; resetErgoSums(); dirty = true; }

  /* ================================================================ recurrence */
  function recCheck() {
    const R = U.rec;
    if (R.pending) { if (U.t === 0) setOrigin(); else return; }
    if (U.t === R.hi + 1) R.hi = U.t;
    else if (U.t === R.lo - 1) R.lo = U.t;
    else if (U.t > R.hi || U.t < R.lo) { R.lo = R.hi = U.t; }
    if (R.found !== null || U.t === 0) return;
    if (window.RCA.mod(U.t, fam().period) !== 0) return; // the rule itself depends on t mod period
    const S = U.hist.w, O = R.origin;
    const a = S.cur, b = O.cur;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return;
    if (O.prev) { const p = S.prev, q = O.prev; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return; }
    R.found = U.t;
  }

  /* ================================================================ canvas + geometry */
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const off = document.createElement('canvas'), octx = off.getContext('2d');
  let img = null, img32 = null;
  let G = null; // geometry of the last frame
  let dirty = true;

  function ensureOff(w, h) {
    if (off.width !== w || off.height !== h || !img) {
      off.width = w; off.height = h;
      img = octx.createImageData(w, h);
      img32 = new Uint32Array(img.data.buffer);
    }
  }

  function resize() {
    const r = $('#stage').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.round(r.width * dpr)), h = Math.max(50, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    dirty = true;
  }
  new ResizeObserver(resize).observe($('#stage'));

  /* ================================================================ light cones */
  // A Cone follows the causal future and past of cells toggled at time t0, with the rule's influence stepper.
  // Its walkers only move away from t0; to go back they restart from a snapshot (or from t0).
  class Cone {
    constructor(eng, n, order, t0, cells) {
      this.eng = eng; this.t0 = t0; this.n = n;
      this.base = newState(n, order);
      for (const i of cells) this.base.cur[i] = 1;
      this.f = cloneState(this.base); this.ft = t0;
      this.b = cloneState(this.base); this.bt = t0;
      this.snaps = new Map();
      this.every = 32;
      this.max = Math.max(8, Math.min(400, Math.floor(16e6 / (n * order))));
    }
    _snap(S, t) {
      if (t % this.every === 0 && !this.snaps.has(t) && this.snaps.size < this.max) this.snaps.set(t, { cur: S.cur.slice(), prev: S.prev ? S.prev.slice() : null });
    }
    _restart(S, t, fwd) {
      const e = this.every;
      for (let k = fwd ? Math.floor(t / e) * e : Math.ceil(t / e) * e; fwd ? k > this.t0 : k < this.t0; k += fwd ? -e : e) {
        if (this.snaps.has(k)) { copyState(S, this.snaps.get(k)); return k; }
      }
      copyState(S, this.base);
      return this.t0;
    }
    at(t) {
      if (t >= this.t0) {
        if (t < this.ft) this.ft = this._restart(this.f, t, true);
        while (this.ft < t) { this.eng.step(this.f, this.ft); this.ft++; this._snap(this.f, this.ft); }
        return this.f.cur;
      }
      if (t > this.bt) this.bt = this._restart(this.b, t, false);
      while (this.bt > t) { this.eng.unstep(this.b, this.bt); this.bt--; this._snap(this.b, this.bt); }
      return this.b.cur;
    }
    rows(t0, t1, out) {
      const n = this.n;
      for (let t = Math.max(t0, this.t0); t <= t1; t++) out.set(this.at(t), (t - t0) * n);
      for (let t = Math.min(t1, this.t0 - 1); t >= t0; t--) out.set(this.at(t), (t - t0) * n);
    }
  }
  let coneCache = { key: '', cone: null };
  /** The light cone of the last perturbation (U.lc), or null. */
  function currentCone() {
    if (!U.lc) return null;
    const key = `${U.dim}|${U.family}|${JSON.stringify(U.params)}|${W()}|${U.lc.t}|${U.lc.cells.join(',')}`;
    if (coneCache.key !== key) coneCache = { key, cone: new Cone(U.coneEng, N(), U.order, U.lc.t, U.lc.cells) };
    return coneCache.cone;
  }
  /** Record a perturbation at time t on the given cells (for cone, damage speed and the status line). */
  function setLC(t, cells) {
    const i = cells[0];
    U.lc = { t, cells: cells.slice(), i, x: i % W(), y: (i / W()) | 0, dim: U.dim };
  }

  /* ================================================================ 1D rendering */
  const win = { key: '', rows: null, m: null, refKey: '', refRows: null, dRef: null, pvKey: '', pvRows: null, dPv: null, coneKey: '', coneRows: null, pvConeRows: null };
  let hover = null; // {t, i} in 1D, {x, y, i} in 2D
  let pvHist = null, revealId = 0;

  /** In 1D, show an edit spreading out from row tc instead of all at once. old: the history before the edit. */
  function startReveal(old, tc) {
    if (U.dim === 1 && U.animate && old && old.n === N()) U.reveal = { old, t: tc, r: 0, id: ++revealId };
    else U.reveal = null;
  }

  function geom1D() {
    const dpr = window.devicePixelRatio || 1, CW = cv.width, CH = cv.height, w = W();
    const axisW = Math.round(58 * dpr), stripW = CW > 760 * dpr ? Math.round(150 * dpr) : 0;
    const gap = Math.round(12 * dpr), topPad = Math.round(14 * dpr), bottomH = Math.round(40 * dpr);
    const availW = CW - axisW - stripW - 2 * gap - Math.round(8 * dpr), availH = CH - topPad - bottomH;
    // whole device pixels per cell when cells are big; below that, fill the width (so a wider board never draws smaller)
    let cell = availW / w;
    if (cell >= 4) cell = Math.floor(cell);
    cell = Math.min(cell, Math.round(16 * dpr));
    const nRows = Math.max(8, Math.min(1400, Math.floor(availH / cell)));
    const dw = Math.round(w * cell), dh = Math.round(nRows * cell);
    const x0 = axisW + Math.max(0, Math.floor((availW - dw) / 2)), y0 = topPad + Math.floor((availH - dh) / 2);
    return { dpr, cell, nRows, dw, dh, x0, y0, sx: x0 + dw + gap, stripW, by: y0 + dh + Math.round(10 * dpr), bh: Math.round(14 * dpr) };
  }

  /** Speeds of a front around (lc.t, lc.i): `marked(idx)` says whether a cell belongs to the region. The speed is
   *  read off the farthest row whose region has not yet wrapped round the ring, separately for future and past. */
  function frontSpeeds(nRows, w, t0, lc, marked) {
    if (!lc) return null;
    const best = { f: null, p: null };
    for (let k = 0; k < nRows; k++) {
      const dt = t0 + k - lc.t;
      if (dt === 0) continue;
      let lo = Infinity, hi = -Infinity;
      const o = k * w;
      for (let i = 0; i < w; i++) {
        if (marked(o + i)) {
          let d = i - lc.i;
          if (d > w / 2) d -= w; else if (d <= -w / 2) d += w;
          if (d < lo) lo = d; if (d > hi) hi = d;
        }
      }
      if (lo === Infinity || hi - lo > w * 0.45) continue;
      const key = dt > 0 ? 'f' : 'p', a = Math.abs(dt);
      if (!best[key] || a > best[key].a) best[key] = { a, l: -lo / a, r: hi / a };
    }
    return best;
  }

  function compute1D(g) {
    const w = W(), nRows = g.nRows;
    const below = Math.floor(nRows / 2);
    const t0 = U.t - below, t1 = t0 + nRows - 1;
    const rv = U.reveal;
    const key = `${t0}|${t1}|${w}|${U.hist.version}|${U.presetId}|${U.family}|${U.dual}|${rv ? rv.id + ':' + Math.floor(rv.r) : ''}`;
    if (!win.rows || win.allocRows !== nRows || win.allocW !== w) {
      win.allocRows = nRows; win.allocW = w;
      const sz = nRows * w;
      win.rows = new Uint8Array(sz); win.refRows = new Uint8Array(sz); win.pvRows = new Uint8Array(sz); win.oldRows = new Uint8Array(sz);
      win.coneRows = new Uint8Array(sz); win.pvConeRows = new Uint8Array(sz); win.hidden = new Uint8Array(nRows);
      win.m = { rho: new Float32Array(nRows), scg: new Float32Array(nRows), scgTyp: new Float32Array(nRows), hb: new Float32Array(nRows), hbTyp: new Float32Array(nRows), u: new Float32Array(nRows), uTyp: new Float32Array(nRows) };
      win.dRef = new Float32Array(nRows); win.dPv = new Float32Array(nRows);
      win.key = win.refKey = win.pvKey = win.coneKey = '';
    }
    win.t0 = t0; win.t1 = t1; win.nRows = nRows;
    if (win.key !== key) {
      U.hist.rows(t0, t1, win.rows);
      // while an edit is unfolding, rows beyond its front still show the history from before the edit
      win.hidden.fill(0);
      if (rv) {
        rv.old.rows(t0, t1, win.oldRows);
        for (let k = 0; k < nRows; k++) {
          if (Math.abs(t0 + k - rv.t) > rv.r) { win.hidden[k] = 1; win.rows.set(win.oldRows.subarray(k * w, (k + 1) * w), k * w); }
        }
      }
      const b = cgBlock(), o = {}, m = win.m;
      for (let k = 0; k < nRows; k++) {
        M.row1D(win.rows, k * w, w, b, o);
        m.rho[k] = flipAt(t0 + k) ? 1 - o.rho : o.rho; m.scg[k] = o.scg; m.scgTyp[k] = o.scgTyp; m.hb[k] = o.hb; m.hbTyp[k] = o.hbTyp; m.u[k] = o.u; m.uTyp[k] = o.uTyp;
      }
      U.hist.at(U.t);
      win.key = key;
      win.refKey = ''; win.pvKey = '';
    }
    // reference
    win.hasRef = !!U.ref; // differences are measured whenever there is a reference; showDiff only colours them
    if (win.hasRef) {
      const rk = `${key}|${U.ref.version}|${U.lc ? U.lc.t + ':' + U.lc.cells.join(',') : ''}`;
      if (win.refKey !== rk) {
        U.ref.rows(t0, t1, win.refRows);
        for (let k = 0; k < nRows; k++) win.dRef[k] = M.hamming(win.rows, k * w, win.refRows, k * w, w) / w;
        const a = win.rows, r = win.refRows;
        win.dmgSp = frontSpeeds(nRows, w, t0, U.lc, (j) => a[j] !== r[j]);
        win.refKey = rk;
      }
    }
    // causal light cone of the last perturbation
    win.hasCone = !!(U.lightcone && U.lc);
    if (win.hasCone) {
      const ck = `${t0}|${t1}|${coneCache.key}|${U.lc.t}|${U.lc.cells.join(',')}|${U.family}|${JSON.stringify(U.params)}`;
      if (win.coneKey !== ck) {
        currentCone().rows(t0, t1, win.coneRows);
        const c = win.coneRows;
        win.coneSp = frontSpeeds(nRows, w, t0, U.lc, (j) => c[j] === 1);
        win.coneKey = ck;
      }
    }
    // preview of the next toggle under the mouse: its light cone and the cells it would change
    win.hasPv = !!(U.lightcone && hover && !stroke && !rv && hover.t >= t0 && hover.t <= t1);
    if (win.hasPv) {
      const pk2 = `${key}|${hover.t}|${hover.i}`;
      if (win.pvKey !== pk2) {
        const S = cloneState(U.hist.at(hover.t));
        S.cur[hover.i] ^= 1;
        if (!pvHist || pvHist.engine !== U.engine || pvHist.n !== w) pvHist = new History(U.engine, w, U.order);
        pvHist.reset(hover.t, S);
        pvHist.rows(t0, t1, win.pvRows);
        for (let k = 0; k < nRows; k++) win.dPv[k] = M.hamming(win.rows, k * w, win.pvRows, k * w, w) / w;
        const a = win.rows, p = win.pvRows;
        win.pvDmgSp = frontSpeeds(nRows, w, t0, hover, (j) => a[j] !== p[j]);
        new Cone(U.coneEng, w, U.order, hover.t, [hover.i]).rows(t0, t1, win.pvConeRows);
        const c = win.pvConeRows;
        win.pvConeSp = frontSpeeds(nRows, w, t0, hover, (j) => c[j] === 1);
        U.hist.at(U.t);
        win.pvKey = pk2;
      }
    }
  }

  function render1D() {
    const g = (G = geom1D());
    compute1D(g);
    const w = W(), nRows = g.nRows, rows = win.rows, up = U.timeUp;
    ensureOff(w, nRows);
    const ref = win.hasRef && U.showDiff ? win.refRows : null, pv = win.hasPv && U.showDiff ? win.pvRows : null;
    const cone = win.hasPv ? win.pvConeRows : win.hasCone ? win.coneRows : null;
    const dimAgree = !!(ref && U.lc) || !!pv || !!cone;
    for (let k = 0; k < nRows; k++) {
      const t = win.t0 + k, r = up ? nRows - 1 - k : k, o = k * w, po = r * w;
      const isNow = t === U.t, isZero = t === 0, hidden = win.hidden[k];
      const cOn = isNow ? COL.onNow : (dimAgree && !hidden ? COL.onDim : COL.on);
      const cOff = isNow ? COL.offNow : isZero ? COL.offZero : COL.off;
      const fv = flipAt(t);
      for (let i = 0; i < w; i++) {
        const raw = rows[o + i], v = raw ^ fv;
        let c = v ? cOn : cOff;
        if (!hidden) {
          if (pv && pv[o + i] !== raw) c = v ? COL.pvOn : COL.pvOff;
          else if (ref && ref[o + i] !== raw) c = v ? COL.extra : COL.missing;
          else if (cone && cone[o + i]) c = v ? COL.coneOn : COL.cone;
        }
        img32[po + i] = c;
      }
    }
    octx.putImageData(img, 0, 0);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, nRows, g.x0, g.y0, g.dw, g.dh);

    const dpr = g.dpr, cell = g.cell;
    const rowY = (t) => { const k = t - win.t0; const r = up ? nRows - 1 - k : k; return g.y0 + r * cell; };

    // time axis
    ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 1e5, 2e5, 5e5, 1e6];
    const tick = steps.find((s) => s * cell >= 34 * dpr) || 1e6;
    for (let t = Math.ceil(win.t0 / tick) * tick; t <= win.t1; t += tick) {
      if (Math.abs(t - U.t) * cell < 14 * dpr) continue;
      const y = rowY(t) + cell / 2;
      ctx.fillStyle = t === 0 ? CSS.accent : CSS.text;
      ctx.fillText(String(t), g.x0 - 10 * dpr, y);
      ctx.fillStyle = t === 0 ? CSS.accent : CSS.grid;
      ctx.fillRect(g.x0 - 6 * dpr, Math.round(y), 4 * dpr, Math.max(1, dpr));
    }
    // present marker
    {
      const y = rowY(U.t) + cell / 2;
      ctx.fillStyle = CSS.accent;
      ctx.fillText(String(U.t), g.x0 - 14 * dpr, y);
      ctx.beginPath(); ctx.moveTo(g.x0 - 2 * dpr, y); ctx.lineTo(g.x0 - 9 * dpr, y - 5 * dpr); ctx.lineTo(g.x0 - 9 * dpr, y + 5 * dpr); ctx.fill();
      const xr = g.x0 + g.dw;
      ctx.beginPath(); ctx.moveTo(xr + 2 * dpr, y); ctx.lineTo(xr + 9 * dpr, y - 5 * dpr); ctx.lineTo(xr + 9 * dpr, y + 5 * dpr); ctx.fill();
    }
    // arrow of time label
    ctx.save();
    ctx.translate(12 * dpr, g.y0 + g.dh / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = CSS.text; ctx.font = `${10.5 * dpr}px Inter, sans-serif`;
    ctx.fillText(up ? 'past  ·  time  →  future' : 'future  ←  time  ·  past', 0, 0);
    ctx.restore();

    // hover outline
    if (hover && hover.t >= win.t0 && hover.t <= win.t1 && cell >= 3 * dpr) {
      ctx.strokeStyle = CSS.text; ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeRect(g.x0 + hover.i * cell + 0.5, rowY(hover.t) + 0.5, cell - 1, cell - 1);
    }
    // toggle origin of the light cone
    if (U.lc && (ref || cone) && U.lc.t >= win.t0 && U.lc.t <= win.t1) {
      const cx = g.x0 + (U.lc.i + 0.5) * cell, cy = rowY(U.lc.t) + cell / 2, rr = Math.max(5 * dpr, cell * 1.5);
      ctx.strokeStyle = CSS.accent; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 2 * Math.PI); ctx.stroke();
    }
    // probes: column ticks
    for (const i of U.probes) {
      const x = g.x0 + (i + 0.5) * cell;
      ctx.fillStyle = CSS.probe;
      ctx.beginPath(); ctx.moveTo(x, g.y0 - 2 * dpr); ctx.lineTo(x - 4 * dpr, g.y0 - 9 * dpr); ctx.lineTo(x + 4 * dpr, g.y0 - 9 * dpr); ctx.fill();
    }

    // bottom strip: time average per column
    {
      const E = U.ergo, T = E.hi - E.lo + 1;
      if (T > 0) {
        const strip = new ImageData(w, 1), s32 = new Uint32Array(strip.data.buffer), sc = 255 / (T * avgMax());
        for (let i = 0; i < w; i++) s32[i] = MAGMA[Math.min(255, Math.round(E.sum[i] * sc))];
        stripCv.width = w; stripCv.height = 1; stripCv.getContext('2d').putImageData(strip, 0, 0);
        ctx.drawImage(stripCv, 0, 0, w, 1, g.x0, g.by, g.dw, g.bh);
        for (const i of U.probes) { ctx.fillStyle = CSS.probe; ctx.fillRect(g.x0 + (i + 0.5) * cell - dpr, g.by + g.bh, 2 * dpr, 5 * dpr); }
        ctx.fillStyle = CSS.text; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = `${10 * dpr}px Inter, sans-serif`;
        ctx.fillText('time avg', g.x0 - 8 * dpr, g.by + g.bh / 2);
      }
    }

    // measures strip, aligned with the rows
    if (g.stripW > 0) drawStrip(g, rowY);
  }
  const stripCv = document.createElement('canvas');

  function drawStrip(g, rowY) {
    const dpr = g.dpr, x0 = g.sx, sw = g.stripW, y0 = g.y0, h = g.dh, nRows = g.nRows, cell = g.cell;
    ctx.fillStyle = THEMES[themeId].ui.chartbg; ctx.fillRect(x0, y0, sw, h);
    ctx.strokeStyle = CSS.grid; ctx.lineWidth = 1;
    for (const v of [0, 0.5, 1]) { const x = Math.round(x0 + 4 * dpr + v * (sw - 8 * dpr)) + 0.5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke(); }
    const X = (v) => x0 + 4 * dpr + Math.max(0, Math.min(1, v)) * (sw - 8 * dpr);
    const Y = (k) => rowY(win.t0 + k) + cell / 2;
    const line = (arr, color, dash, alpha = 1, lw = 1.4) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw * dpr; ctx.setLineDash(dash ? [3 * dpr, 3 * dpr] : []);
      ctx.beginPath();
      for (let k = 0; k < nRows; k++) { const x = X(arr[k]), y = Y(k); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.restore();
    };
    const m = win.m;
    line(m.scgTyp, CSS.scg, true, 0.55, 1);
    line(m.hbTyp, CSS.hb, true, 0.4, 1);
    line(m.u, CSS.u, false, 0.9);
    line(m.hb, CSS.hb, false, 0.9);
    line(m.scg, CSS.scg, false, 1);
    line(m.rho, CSS.rho, false, 1);
    if (win.hasRef) line(win.dRef.map(dlog), CSS.d, false, 1, 1.6);
    if (win.hasPv) line(win.dPv.map(dlog), CSS.preview, false, 1, 1.6);
    // present line
    const yN = rowY(U.t) + cell / 2;
    ctx.strokeStyle = CSS.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = dpr; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, yN); ctx.lineTo(x0 + sw, yN); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = CSS.text; ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText('0', X(0) - 2 * dpr, y0 + g.dh + 4 * dpr);
    ctx.textAlign = 'center'; ctx.fillText('½', X(0.5), y0 + g.dh + 4 * dpr);
    ctx.textAlign = 'right'; ctx.fillText('1', X(1) + 2 * dpr, y0 + g.dh + 4 * dpr);
  }

  /* ================================================================ 2D rendering */
  const meas = {};
  function geom2D() {
    const dpr = window.devicePixelRatio || 1, CW = cv.width, CH = cv.height, w = W();
    const pad = Math.round(16 * dpr);
    const side = Math.min(CW, CH) - 2 * pad;
    let cell = side / w;
    if (cell >= 4) cell = Math.floor(cell); // whole pixels when cells are big; otherwise fill the stage
    const d = Math.round(w * cell);
    return { dpr, cell, d, x0: Math.floor((CW - d) / 2), y0: Math.floor((CH - d) / 2) };
  }

  function render2D() {
    const g = (G = geom2D());
    const w = W(), n = N();
    const S = U.hist.at(U.t), c = S.cur;
    const Rall = U.ref ? U.ref.at(U.t).cur : null, R = U.showDiff ? Rall : null;
    const K = U.lightcone && U.lc && U.lc.dim === 2 ? currentCone().at(U.t) : null;
    ensureOff(w, w);
    if (U.showAvg) {
      const E = U.ergo, T = E.hi - E.lo + 1, sum = E.sum, sc = 255 / (T * avgMax());
      for (let i = 0; i < n; i++) img32[i] = MAGMA[Math.min(255, Math.round(sum[i] * sc))];
    } else if (R || K) {
      let anyDiff = !!K;
      if (R) for (let i = 0; i < n && !anyDiff; i++) if (c[i] !== R[i]) anyDiff = true;
      const onC = anyDiff ? COL.onDim : COL.on, fv = flipAt(U.t);
      for (let i = 0; i < n; i++) {
        const v = c[i] ^ fv;
        img32[i] = R && c[i] !== R[i] ? (v ? COL.extra : COL.missing) : K && K[i] ? (v ? COL.coneOn : COL.cone) : v ? onC : COL.off;
      }
    } else {
      const fv = flipAt(U.t);
      for (let i = 0; i < n; i++) img32[i] = c[i] ^ fv ? COL.on : COL.off;
    }
    octx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, w, g.x0, g.y0, g.d, g.d);
    const dpr = g.dpr, cell = g.cell;
    // board frame
    ctx.strokeStyle = CSS.grid; ctx.lineWidth = dpr;
    ctx.strokeRect(g.x0 - 0.5 * dpr, g.y0 - 0.5 * dpr, g.d + dpr, g.d + dpr);

    // partition overlay
    if (U.showPart && cell >= 4 * dpr && (U.family === 'margolus' || U.family === 'checker')) {
      ctx.strokeStyle = CSS.grid; ctx.lineWidth = 1;
      if (U.family === 'margolus') {
        const o = par(U.t);
        ctx.beginPath();
        for (let k = o; k <= w; k += 2) {
          const x = Math.round(g.x0 + k * cell) + 0.5, y = Math.round(g.y0 + k * cell) + 0.5;
          ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y0 + g.d);
          ctx.moveTo(g.x0, y); ctx.lineTo(g.x0 + g.d, y);
        }
        ctx.stroke();
      } else {
        // mark the sublattice updated by the next step
        ctx.fillStyle = CSS.grid;
        const p = par(U.t);
        for (let y = 0; y < w; y++) for (let x = (y + p) & 1; x < w; x += 2) ctx.fillRect(g.x0 + x * cell, g.y0 + y * cell, cell, cell);
      }
    }
    // toggle origin
    if ((R || K) && U.lc && U.lc.dim === 2) {
      const cx = g.x0 + (U.lc.x + 0.5) * cell, cy = g.y0 + (U.lc.y + 0.5) * cell, rr = Math.max(6 * dpr, cell * 2);
      ctx.strokeStyle = CSS.accent; ctx.globalAlpha = U.lc.t === U.t ? 1 : 0.4; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // probes
    for (const i of U.probes) {
      const x = i % w, y = (i / w) | 0;
      const cx = g.x0 + (x + 0.5) * cell, cy = g.y0 + (y + 0.5) * cell;
      ctx.strokeStyle = CSS.probe; ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4 * dpr, cell * 0.9), 0, 2 * Math.PI); ctx.stroke();
    }
    // hover
    if (hover && cell >= 3 * dpr) {
      ctx.strokeStyle = CSS.text; ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeRect(g.x0 + hover.x * cell + 0.5, g.y0 + hover.y * cell + 0.5, cell - 1, cell - 1);
    }

    // record measures for the chart
    recordMeasures(U.t, c, Rall);

    // radii of the damage and of the light cone around the toggled cell (periodic Chebyshev distance)
    U.cone2 = null;
    if (Rall && U.lc && U.lc.dim === 2 && U.t !== U.lc.t) {
      let r = -1, rc = -1;
      const half = w / 2;
      for (let y = 0; y < w; y++) {
        let dy = Math.abs(y - U.lc.y); if (dy > half) dy = w - dy;
        const o = y * w;
        for (let x = 0; x < w; x++) {
          const dmg = c[o + x] !== Rall[o + x], inC = K && K[o + x];
          if (dmg || inC) {
            let dx = Math.abs(x - U.lc.x); if (dx > half) dx = w - dx;
            const d = dx > dy ? dx : dy;
            if (dmg && d > r) r = d;
            if (inC && d > rc) rc = d;
          }
        }
      }
      U.cone2 = { r, rc, dt: Math.abs(U.t - U.lc.t), half };
    }
  }

  function recordMeasures(t, c, R) {
    const w = W(), n = N();
    M.board2D(c, w, w, cgBlock(), meas);
    if (flipAt(t)) meas.rho = 1 - meas.rho; // the other measures are invariant under complement
    const entry = { rho: meas.rho, scg: meas.scg, scgTyp: meas.scgTyp, hb: meas.hb, hbTyp: meas.hbTyp, u: meas.u, uTyp: meas.uTyp, d: null };
    if (R) entry.d = M.hamming(c, 0, R, 0, n) / n;
    U.series.delete(t);
    U.series.set(t, entry);
    if (U.series.size > 30000) U.series.delete(U.series.keys().next().value);
  }

  /* ================================================================ HUD + side panels */
  let lastPanel = 0;
  function currentMeasures() {
    if (U.dim === 2) return U.series.get(U.t);
    const k = U.t - win.t0, m = win.m;
    if (!m || k < 0 || k >= win.nRows) return null;
    return { rho: m.rho[k], scg: m.scg[k], scgTyp: m.scgTyp[k], hb: m.hb[k], hbTyp: m.hbTyp[k], u: m.u[k], uTyp: m.uTyp[k], d: win.hasRef ? win.dRef[k] : null };
  }

  // damage spans orders of magnitude: plot log(1 + cells) / log(1 + N), so 1 cell sits low and N cells at the top
  const dlog = (d) => Math.log1p(d * N()) / Math.log1p(N());
  const fmt = (v, d = 3) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));

  function updatePanels(force) {
    const now = performance.now();
    if (!force && now - lastPanel < 110) return;
    lastPanel = now;
    const n = N();

    // transport
    const ti = $('#tInput');
    if (document.activeElement !== ti) ti.value = String(U.t);
    $('#tFwd').classList.toggle('active', U.playing === 1);
    $('#tRun0').textContent = U.t < 0 ? '0 ⏩' : '⏪ 0';
    $('#tRun0').disabled = U.t === 0;
    $('#tBack').classList.toggle('active', U.playing === -1);
    $('#tPause').classList.toggle('active', U.playing === 0);
    $('#speedVal').textContent = Number.isFinite(U.speed) ? '' : U.playing ? `≈ ${Math.round(measuredRate).toLocaleString('en')}/s` : '';
    document.querySelectorAll('#speedBtns button').forEach((b) => b.classList.toggle('active', +b.dataset.s === U.speed || (b.dataset.s === 'max' && !Number.isFinite(U.speed))));

    // HUD
    const pName = U.presetId ? PRESETS.find((p) => p.id === U.presetId).name : `custom ${fam().label.toLowerCase()}`;
    $('#hud').textContent = `${pName} · ${U.dim === 1 ? U.size + ' cells' : U.size + '×' + U.size} · torus`;

    // measures
    const m = currentMeasures();
    $('#measT').textContent = `at t = ${U.t}`;
    const rows = [];
    const sw = (c) => `<td class="sw"><i style="background:${c}"></i></td>`;
    const lineKV = (c, k, v, typ, title) => `<tr title="${title || ''}">${sw(c)}<td class="k">${k}</td><td class="v">${v}${typ != null ? ` <span class="typ">/ ${typ}</span>` : ''}</td></tr>`;
    if (m) {
      const nOn = Math.round(m.rho * n);
      rows.push(lineKV(CSS.rho, 'density ρ', `${fmt(m.rho)}`, null, `${nOn} of ${n} cells on`));
      rows.push(lineKV(CSS.scg, 'coarse-grained entropy', fmt(m.scg), fmt(m.scgTyp), `Boltzmann entropy of the block occupation numbers, blocks of ${U.dim === 1 ? cgBlock() : cgBlock() + '×' + cgBlock()} cells, bits per cell / typical iid value at this density`));
      rows.push(lineKV(CSS.hb, 'block entropy', fmt(m.hb), fmt(m.hbTyp), `Shannon entropy of ${U.dim === 1 ? '3-cell' : '2×2'} patterns, bits per cell / h(ρ)`));
      rows.push(lineKV(CSS.u, 'unlike bonds', fmt(m.u), fmt(m.uTyp), 'fraction of nearest-neighbour pairs that differ (domain-wall density, Ising energy) / iid value 2ρ(1−ρ)'));
      if (m.d != null) rows.push(lineKV(CSS.d, 'diff. from reference', `${Math.round(m.d * n)} cells`, null, 'Hamming distance to the reference history at this time. Plotted on a log scale: one cell at the bottom, the whole board at the top.'));
      const extra = [];
      const S = U.hist.at(U.t);
      for (const id of U.info.conserved) {
        const C = window.RCA.CONSERVED[id];
        if (id === 'Nalt' && U.dual) { extra.push(['particles N (dual view)', `${nOn} <span class="typ">conserved</span>`, 'Odd frames are shown complemented, so N is conserved every step.']); continue; }
        extra.push([C.name, `${C.fn(S, U.t, W(), H(), U.params)} <span class="typ">conserved</span>`, C.tip || '']);
      }
      if (U.dim === 1) {
        // light-cone speed (what could change) against damage speed (what did change), in cells per row
        const pv = win.hasPv, lsp = pv ? win.pvConeSp : win.hasCone ? win.coneSp : null, dsp = pv ? win.pvDmgSp : win.hasRef ? win.dmgSp : null;
        const v = (c) => (c ? `←${c.l.toFixed(2)} →${c.r.toFixed(2)}` : '–');
        const tipL = 'Edge speeds of the causal light cone, in cells per row: the fastest any influence can travel under this rule.';
        const tipD = 'Edge speeds of the region that actually changed (the butterfly speed). At most the light-cone speed.';
        for (const [dir, lab] of [['f', 'future'], ['p', 'past']]) {
          if (lsp && lsp[dir]) extra.push([`light cone, ${lab}`, v(lsp[dir]), tipL]);
          if (dsp && dsp[dir]) extra.push([`damage front, ${lab}`, v(dsp[dir]), tipD]);
        }
      }
      if (U.dim === 2 && U.cone2 && U.lc) {
        const c2 = U.cone2, lab = U.t > U.lc.t ? 'future' : 'past';
        const show = (r) => (r < 0 ? '–' : r >= c2.half - 1 ? 'whole board' : `${r} <span class="typ">→ ${(r / c2.dt).toFixed(2)} cells/step</span>`);
        if (c2.rc >= 0) extra.push([`light-cone radius, ${lab}`, show(c2.rc), 'Chebyshev radius of the causal light cone around the toggled cell.']);
        extra.push([`damage radius, ${lab}`, show(c2.r), 'Chebyshev radius of the cells that actually changed (the butterfly front).']);
      }
      extra.forEach(([k, v, tip], j) => rows.push(`<tr class="${j === 0 ? 'sep' : ''}" title="${tip || ''}"><td class="sw"></td><td class="k">${k}</td><td class="v">${v}</td></tr>`));
    }
    $('#measTable').innerHTML = rows.join('');
    $('#chart').style.display = U.dim === 2 ? 'block' : 'none';
    const extraLaws = U.info.conserved.some((id) => id !== 'N' && id !== 'Nalt') || U.info.linear || !!(U.presetId && /integrable|free/.test(PRESETS.find((p) => p.id === U.presetId).tags.join(' ')));
    $('#measHint').textContent = (U.dim === 1
      ? 'Values after the slash are typical for iid cells at the same density. The strip beside the diagram plots each row; dashed lines are the typical values.'
      : 'Values after the slash are typical for iid cells at the same density. The chart records every frame you visit; dashed lines are the typical values.')
      + (extraLaws ? ' This rule has more conservation laws than density, so its equilibrium is typical of the ensemble at those fixed values, and the iid values need not be reached.' : '');
    if (U.dim === 2) drawChart();

    // ergodicity
    drawErgo();

    // reference status + legend
    let rs = 'No reference history. Pin one, or arm ◎ light cone to compare against the history before your next toggle.';
    if (U.ref) {
      const k = U.lc ? U.lc.cells.length : 0;
      const where = !U.lc ? '' : k > 1 ? `${k} cells at t = ${U.lc.t}` : U.dim === 1 ? `the toggle at (t = ${U.lc.t}, i = ${U.lc.i})` : `the toggle at t = ${U.lc.t}, (${U.lc.x}, ${U.lc.y})`;
      rs = `Reference pinned.${where ? ' Showing the light cone of ' + where + '.' : ''}`;
    }
    $('#refStatus').textContent = rs;
    const leg = [];
    const lsw = (c) => `<i style="background:${c}"></i>`;
    if (U.lightcone && U.showDiff && U.dim === 1) leg.push(`<span>${lsw(CSS.preview)}damage the next toggle would do</span>`);
    if (U.lightcone && U.lc) leg.push(`<span>${lsw(CSS.cone)}light cone</span>`);
    if (U.ref && U.showDiff) leg.push(`<span>${lsw('var(--extra)')}on, off in reference</span>`, `<span>${lsw('var(--missing)')}off, on in reference</span>`);
    if (U.probes.length) leg.push(`<span><i style="background:${CSS.probe}"></i>probe</span>`);
    if ((U.dim === 2 && U.showAvg) || U.dim === 1) leg.push(`<span><i style="width:56px;background:linear-gradient(90deg,#000004,#65156e,#d44842,#fac127,#fcffa4)"></i>time average 0 → ${fmt(U.avgTop, 3)}</span>`);
    $('#legend').innerHTML = leg.join('');
    document.querySelectorAll('.lcb').forEach((b) => b.classList.toggle('on', U.lightcone));
    document.querySelectorAll('.dmb').forEach((b) => b.classList.toggle('on', U.showDiff));
    $('#clrBtn').disabled = !U.ref;
    $('#e5').disabled = !U.ref;

    // echo
    updateEcho(m);

    // recurrence
    const R = U.rec;
    let rt;
    const logOmega = U.info.conserving ? log2Binom(n, Math.round((m ? m.rho : 0) * n)) : n * U.order;
    const omega = `|Ω| = 2^${Math.round(logOmega)}`;
    if (R.pending) rt = 'Visit t = 0 to start watching for a return of the t = 0 microstate.';
    else if (R.found !== null) rt = `<b style="color:#8ff0bf">The board returned to its exact t = 0 microstate at t = ${R.found}.</b> Every orbit of a finite reversible system is a cycle. Here the cycle length is at most ${omega}.`;
    else rt = `No return to the t = 0 microstate for t ∈ [${R.lo}, ${R.hi}]. The orbit is a cycle of length at most ${omega}${U.info.conserving ? ' (fixed N)' : ''}.`;
    $('#recOut').innerHTML = rt;
  }

  function log2Binom(n, k) {
    // log2 C(n, k) via Stirling-safe log-gamma sum
    let s = 0;
    k = Math.min(k, n - k);
    for (let j = 1; j <= k; j++) s += Math.log2((n - k + j) / j);
    return s;
  }

  function drawChart() {
    const c = $('#chart'), dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (r.width < 10) return;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const keys = [...U.series.keys()].sort((a, b) => a - b);
    if (!keys.length) return;
    let tmin = Math.min(keys[0], U.t - 40), tmax = Math.max(keys[keys.length - 1], U.t + 40);
    const pl = 8 * dpr, pr = 8 * dpr, pt = 8 * dpr, pb = 16 * dpr;
    const X = (t) => pl + ((t - tmin) / (tmax - tmin)) * (w - pl - pr);
    const Y = (v) => pt + (1 - Math.max(0, Math.min(1, v))) * (h - pt - pb);
    g.strokeStyle = CSS.grid; g.lineWidth = 1;
    for (const v of [0, 0.5, 1]) { g.beginPath(); g.moveTo(pl, Math.round(Y(v)) + 0.5); g.lineTo(w - pr, Math.round(Y(v)) + 0.5); g.stroke(); }
    if (tmin <= 0 && tmax >= 0) { g.strokeStyle = CSS.accent; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(Math.round(X(0)) + 0.5, pt); g.lineTo(Math.round(X(0)) + 0.5, h - pb); g.stroke(); g.globalAlpha = 1; }
    const gapMax = Math.max(64, (tmax - tmin) / 60);
    const line = (f, color, dash, alpha = 1, lw = 1.4) => {
      g.save(); g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = lw * dpr; g.setLineDash(dash ? [3 * dpr, 3 * dpr] : []);
      g.beginPath();
      let prevT = null;
      for (const t of keys) {
        const e = U.series.get(t), v = f(e);
        if (v == null) continue; // a frame recorded without a reference: skip it, the gap test still breaks real gaps
        if (prevT === null || t - prevT > gapMax) g.moveTo(X(t), Y(v)); else g.lineTo(X(t), Y(v));
        prevT = t;
      }
      g.stroke(); g.restore();
    };
    line((e) => e.scgTyp, CSS.scg, true, 0.55, 1);
    line((e) => e.hbTyp, CSS.hb, true, 0.4, 1);
    line((e) => e.u, CSS.u, false, 0.9);
    line((e) => e.hb, CSS.hb, false, 0.9);
    line((e) => e.scg, CSS.scg, false);
    line((e) => e.rho, CSS.rho, false);
    line((e) => (e.d == null ? null : dlog(e.d)), CSS.d, false, 1, 1.6);
    g.strokeStyle = CSS.accent; g.globalAlpha = 0.8; g.lineWidth = dpr;
    g.beginPath(); g.moveTo(Math.round(X(U.t)) + 0.5, pt); g.lineTo(Math.round(X(U.t)) + 0.5, h - pb); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = CSS.text; g.font = `${9.5 * dpr}px "JetBrains Mono", monospace`; g.textBaseline = 'bottom';
    const xNow = Math.max(pl + 30 * dpr, Math.min(w - pr - 30 * dpr, X(U.t)));
    if (xNow - pl > 70 * dpr) { g.textAlign = 'left'; g.fillText(String(tmin), pl, h - 2 * dpr); }
    if (w - pr - xNow > 70 * dpr) { g.textAlign = 'right'; g.fillText(String(tmax), w - pr, h - 2 * dpr); }
    g.textAlign = 'center'; g.fillStyle = CSS.accent; g.fillText(`t = ${U.t}`, xNow, h - 2 * dpr);
  }

  function drawErgo() {
    const E = U.ergo, n = N(), T = E.hi - E.lo + 1;
    $('#ergoWin').textContent = `t ∈ [${E.lo}, ${E.hi}]`;
    const m = currentMeasures();
    let mean = 0, sq = 0;
    for (let i = 0; i < n; i++) { const a = E.sum[i] / T; mean += a; sq += a * a; }
    mean /= n; const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    const iid = Math.sqrt((mean * (1 - mean)) / T);
    const rows = [
      ['steps averaged T', `${T}`],
      ['space average now ρ(t)', m ? fmt(m.rho) : '–'],
      ['mean time average', fmt(mean)],
      ['spread of time averages σ', `${fmt(sd)} <span class="typ">/ ${fmt(iid)}</span>`],
    ];
    $('#ergoTable').innerHTML = rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`).join('') +
      `<tr><td colspan="2" class="k" style="font-size:11px;padding-top:4px">σ after the slash: the spread if each step were an independent coin flip, √(ρ̄(1−ρ̄)/T).${E.note ? ' Averaging ' + E.note + '.' : ''}</td></tr>`;

    // histogram
    const c = $('#hist'), dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    if (r.width > 10) {
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext('2d');
      g.clearRect(0, 0, w, h);
      const B = 40, cnt = new Float64Array(B);
      for (let i = 0; i < n; i++) cnt[Math.min(B - 1, Math.floor((E.sum[i] / T) * B))]++;
      const mx = Math.max(...cnt);
      const pl = 6 * dpr, pr = 6 * dpr, pb = 14 * dpr, pt = 6 * dpr, bw = (w - pl - pr) / B;
      const X = (v) => pl + v * (w - pl - pr);
      // iid band
      g.fillStyle = CSS.probe; g.globalAlpha = 0.12;
      g.fillRect(X(Math.max(0, mean - 2 * iid)), pt, Math.max(dpr, X(Math.min(1, mean + 2 * iid)) - X(Math.max(0, mean - 2 * iid))), h - pt - pb); g.globalAlpha = 1;
      for (let b = 0; b < B; b++) {
        const bh = mx ? (cnt[b] / mx) * (h - pt - pb) : 0;
        g.fillStyle = CSS.text; g.globalAlpha = 0.75;
        g.fillRect(pl + b * bw + dpr * 0.5, h - pb - bh, Math.max(1, bw - dpr), bh);
      }
      g.globalAlpha = 1;
      if (m) { g.fillStyle = CSS.accent; g.fillRect(Math.round(X(m.rho)) - dpr, pt, 2 * dpr, h - pt - pb); }
      g.fillStyle = CSS.text; g.font = `${9.5 * dpr}px "JetBrains Mono", monospace`; g.textBaseline = 'bottom';
      g.textAlign = 'left'; g.fillText('0', pl, h - dpr); g.textAlign = 'right'; g.fillText('1', w - pr, h - dpr);
      g.textAlign = 'center'; g.fillStyle = CSS.accent; if (m) g.fillText('ρ(t)', Math.max(pl + 14 * dpr, Math.min(w - pr - 14 * dpr, X(m.rho))), h - dpr);
    }

    // probes
    const S = U.hist.at(U.t);
    $('#probeList').innerHTML = U.probes.length
      ? U.probes.map((i, j) => {
        const lab = U.dim === 1 ? `i = ${i}` : `(${i % U.size}, ${(i / U.size) | 0})`;
        const a = E.sum[i] / T;
        return `<div class="pr" data-j="${j}" title="click to remove"><span><b>⌖</b> ${lab} ${S.cur[i] ^ flipAt(U.t) ? '●' : '○'}</span><span>on ${(a * 100).toFixed(1)}% of ${T} · ρ(t) = ${m ? fmt(m.rho, 2) : '–'}</span></div>`;
      }).join('')
      : '<div class="hint">Place probes with the ⌖ tool (or ⌥/Alt-click) to follow single cells.</div>';
  }

  function updateEcho(m) {
    const st = U.echo.stage;
    const lis = document.querySelectorAll('ol.echo li');
    lis.forEach((li, j) => { li.classList.toggle('done', j < st); li.classList.toggle('next', j === st); });
    const out = $('#echoOut');
    if (!U.ref || !m || m.d == null) {
      out.innerHTML = st === 0 ? '<span class="hint">Pick a low-entropy pattern on the left, then go through the four steps. Without step 3, step 4 brings the pattern back exactly.</span>' : '';
      return;
    }
    const n = N(), bad = Math.round(m.d * n);
    if (U.t === 0) {
      const F = 1 - m.d;
      out.innerHTML = `<div>at t = 0, compared with the encoded pattern:</div><div class="big ${bad === 0 ? 'good' : 'badv'}">${bad === 0 ? 'recovered exactly' : `${bad} cell${bad === 1 ? '' : 's'} wrong`}</div><div class="muted">agreement ${(100 * F).toFixed(2)}%${bad ? ' · coloured cells show the damage' : ''}</div>`;
    } else {
      out.innerHTML = `<div class="muted">at t = ${U.t}: ${bad} cell${bad === 1 ? '' : 's'} differ from the reference (${(100 * m.d).toFixed(2)}%)</div>`;
    }
  }

  /* ================================================================ rule panel */
  function groupedPresets(dim) {
    const out = new Map();
    for (const P of PRESETS) if (P.dim === dim) {
      if (!out.has(P.family)) out.set(P.family, []);
      out.get(P.family).push(P);
    }
    for (const [k, F] of Object.entries(FAMILIES)) if (F.dim === dim && !out.has(k)) out.set(k, []);
    return out;
  }

  function renderRuleSelect() {
    const sel = $('#ruleSel');
    const groups = groupedPresets(U.dim);
    let html = '';
    for (const [famId, list] of groups) {
      html += `<optgroup label="${FAMILIES[famId].label}">`;
      for (const P of list) html += `<option value="p:${P.id}">${P.name}</option>`;
      html += `<option value="c:${famId}">✎ custom…</option>`;
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    sel.value = U.presetId ? `p:${U.presetId}` : `c:${U.family}`;
  }

  function badgeHTML() {
    const b = [], info = U.info, P = U.presetId ? PRESETS.find((p) => p.id === U.presetId) : null;
    if (info.conserving) b.push(['particle-conserving', 'cons']);
    else if (info.alternating) b.push(['N ↔ WH−N alternates', 'cons']);
    else b.push(['not particle-conserving', '']);
    const label = { walls: U.dim === 2 ? 'conserves Ising energy' : 'conserves domain walls', K: 'conserves kink energy', Kr: 'conserves kink energy', KR: 'conserves K_R and K_L', B37: 'conserves frozen blocks', sol54: 'conserves soliton numbers' };
    for (const id of info.conserved) if (label[id]) b.push([label[id], 'cons']);
    if (info.linear) b.push(['linear / affine over 𝔽₂', 'lin']);
    if (P) for (const t of P.tags) b.push([t, t === 'free' || t === 'integrable' ? 'free' : 'int']);
    if (fam().order === 2) b.push(['second order: state = (x^{t−1}, x^t)', '']);
    return `<div class="badges">${b.map(([t, c]) => `<span class="badge ${c}">${t}</span>`).join('')}</div>`;
  }

  function renderRuleUI() {
    const P = U.presetId ? PRESETS.find((p) => p.id === U.presetId) : null;
    const F = fam();
    const card = $('#ruleCard');
    let desc = P ? P.desc : 'A custom rule from this family. Edit it under Parameters.';
    let cite = P ? P.cite.map((c) => `<a href="${c.url}" target="_blank" rel="noopener">${c.t}</a>`).join('<br>') : '';
    let sugg = '';
    if (P && P.suggest) {
      const lib = U.dim === 1 ? PAT.P1 : PAT.P2;
      if (lib[P.suggest.pattern] && P.suggest.pattern !== U.init.pattern) sugg = `<div class="cite">Suggested start: <a href="#" id="suggLink">${lib[P.suggest.pattern].name.toLowerCase()}</a></div>`;
    }
    card.innerHTML = `<div class="fam">${F.label}</div><div class="name">${P ? P.name : 'Custom rule'}</div>${badgeHTML()}<div class="tex">$$${F.tex(U.params)}$$</div>${F.note ? `<div class="fnote">${F.note}</div>` : ''}<div class="desc">${desc}</div>${cite ? `<div class="cite">${cite}</div>` : ''}${sugg}`;
    const sl = $('#suggLink');
    if (sl) sl.onclick = (e) => {
      e.preventDefault();
      U.init.pattern = P.suggest.pattern;
      if (P.suggest.density) U.init.density = P.suggest.density;
      syncInitUI(); prepare(); renderRuleUI();
    };
    $('#dualRow').style.display = U.info.alternating ? '' : 'none';
    renderParams();
    typeset(card);
    renderRuleSelect();
  }

  function typeset(el) {
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
      } catch (e) { /* leave the TeX source visible */ }
    }
  }

  const glyph = (bits, cls) => `<span class="glyph ${cls}">${bits.map((b) => `<i class="${b === 2 ? 'q' : b ? 'on' : ''}"></i>`).join('')}</span>`;

  function customise(mutator) {
    mutator(U.params);
    U.presetId = null;
    applyRule();
  }

  function renderParams() {
    const body = $('#paramBody'), p = U.params;
    let html = '';
    $('#paramHint').textContent = '';
    if (U.family === 'eca2') {
      html += `<div class="pinline"><span class="muted">Wolfram number N</span><input type="number" id="pN" min="0" max="255" value="${p.N}"></div>`;
      html += '<div class="ptable">';
      for (let k = 7; k >= 0; k--) {
        const nb = [(k >> 2) & 1, (k >> 1) & 1, k & 1], o = (p.N >> k) & 1;
        html += `<div class="pcell" data-k="${k}" title="click to flip">${glyph(nb, 'g3')}<span class="arrow">↓</span>${glyph([o], 'g1')}</div>`;
      }
      html += '</div><p class="pnote">f_N on (x<sub>i−1</sub>, x<sub>i</sub>, x<sub>i+1</sub>). Any N gives a reversible rule; the inverse is the same rule with the time slices swapped.</p>';
      $('#paramHint').textContent = `N = ${p.N}`;
    } else if (U.family === 'stag1') {
      html += '<div class="ptable">';
      for (const k of [3, 2, 1, 0]) {
        const l = k >> 1, r = k & 1;
        html += `<div class="pcell ${p.f[k] ? 'changed' : ''}" data-k="${k}" title="click to toggle">${glyph([l, 2, r], 'g3')}<span class="arrow">${p.f[k] ? 'flip' : 'keep'}</span></div>`;
      }
      html += `</div><p class="pnote">Whether the middle cell flips, given its neighbours. As a 3-cell rule this is ECA ${ecaWolframOfStag(p.f)}, and the dynamics is two decoupled copies of the second-order rule ${window.RCA.secondOrderTwinOfStag(p.f)}R, one on each space-time sublattice. Every choice of f is reversible.</p>`;
      $('#paramHint').textContent = `RCA${ecaWolframOfStag(p.f)}`;
    } else if (U.family === 'tot1') {
      html += `<div class="pinline"><span class="muted">radius r</span><select id="pR" style="width:auto">${[1, 2, 3].map((r) => `<option value="${r}" ${p.r === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
      html += '<div class="pinline"><span class="muted">flip if live neighbours =</span></div><div class="pinline">';
      for (let k = 0; k <= 2 * p.r; k++) html += `<label class="chk"><input type="checkbox" data-s="${k}" ${p.S.includes(k) ? 'checked' : ''}> ${k}</label>`;
      html += `</div><p class="pnote">Neighbours are the ${2 * p.r} cells within distance r, centre excluded. r = 1 with {1} is 90R; r = 2 with {2} is SCARVES.</p>`;
      $('#paramHint').textContent = `r = ${p.r}, S = {${p.S.join(',')}}`;
    } else if (U.family === 'block1') {
      for (let ph = 0; ph < 2; ph++) {
        html += `<div class="pnote">${ph === 0 ? 'even t' : 'odd t'}</div><div class="ptable">`;
        for (let v = 0; v < 4; v++) { const u = p.tabs[ph][v]; html += `<div class="pcell ${u !== v ? 'changed' : ''}">${glyph([v & 1, v >> 1], 'g2')}<span class="arrow">↓</span>${glyph([u & 1, u >> 1], 'g2')}</div>`; }
        html += '</div>';
      }
      html += `<div class="pinline"><span class="muted">π (even; odd)</span><input type="text" class="wide" id="pPerm" value="${p.tabs[0].join(',')}; ${p.tabs[1].join(',')}"></div><p class="pnote">Block value = left + 2·right. π must be a permutation of 0–3.</p>`;
    } else if (U.family === 'margolus') {
      const same = p.tabs[0].every((v, i) => v === p.tabs[1][i]);
      for (let ph = 0; ph < (same ? 1 : 2); ph++) {
        if (!same) html += `<div class="pnote">${ph === 0 ? 'even t' : 'odd t'}</div>`;
        html += '<div class="ptable">';
        for (let v = 0; v < 16; v++) {
          const u = p.tabs[ph][v];
          html += `<div class="pcell ${u !== v ? 'changed' : ''}" title="${v} → ${u}">${glyph([v & 1, (v >> 1) & 1, (v >> 2) & 1, v >> 3], 'g4')}<span class="arrow">↓</span>${glyph([u & 1, (u >> 1) & 1, (u >> 2) & 1, u >> 3], 'g4')}</div>`;
        }
        html += '</div>';
      }
      html += `<div class="pinline"><span class="muted">table (even; odd)</span><input type="text" class="wide" id="pTab" value="${p.tabs[0].join(',')}${same ? '' : '; ' + p.tabs[1].join(',')}"></div><p class="pnote">Block value = UL + 2·UR + 4·LL + 8·LR. Edit the 16 outputs; the map must be a permutation. Give a second list after “;” for a rule that alternates with the parity of t.</p>`;
    } else if (U.family === 'checker') {
      html += '<div class="pinline"><span class="muted">flip if live neighbours =</span></div><div class="pinline">';
      for (let k = 0; k <= 4; k++) html += `<label class="chk"><input type="checkbox" data-k="${k}" ${p.flip[k] ? 'checked' : ''}> ${k}</label>`;
      html += '</div><p class="pnote">Q2R flips on exactly 2. Any choice is reversible: the neighbours sit on the other sublattice.</p>';
    } else if (U.family === 'second2') {
      html += `<div class="pinline"><span class="muted">B</span><input type="text" id="pB" value="${p.B.join('')}"><span class="muted">S</span><input type="text" id="pS" value="${p.S.join('')}"></div>`;
      html += `<div class="pinline"><span class="muted">neighbours</span><select id="pNb" style="width:auto"><option value="1" ${p.moore ? 'selected' : ''}>Moore (8)</option><option value="0" ${p.moore ? '' : 'selected'}>von Neumann (4)</option></select></div>`;
      html += '<p class="pnote">F = Life-like rule B/S on x<sup>t</sup>; then x<sup>t+1</sup> = F ⊕ x<sup>t−1</sup>. Any B/S becomes reversible this way.</p>';
      $('#paramHint').textContent = `B${p.B.join('')}/S${p.S.join('')}`;
    } else {
      html = '<p class="pnote">No parameters.</p>';
    }
    body.innerHTML = html;

    // wire
    const pN = $('#pN');
    if (pN) pN.onchange = () => { const v = Math.max(0, Math.min(255, parseInt(pN.value, 10) || 0)); customise((q) => { q.N = v; }); };
    body.querySelectorAll('.pcell[data-k]').forEach((el) => el.onclick = () => {
      const k = +el.dataset.k;
      if (U.family === 'eca2') customise((q) => { q.N ^= 1 << k; });
      else if (U.family === 'stag1') customise((q) => { q.f = q.f.slice(); q.f[k] ^= 1; });
    });
    body.querySelectorAll('input[type=checkbox][data-k]').forEach((el) => el.onchange = () => customise((q) => { q.flip = q.flip.slice(); q.flip[+el.dataset.k] = el.checked ? 1 : 0; }));
    const pPerm = $('#pPerm');
    if (pPerm) pPerm.onchange = () => {
      const parts = pPerm.value.split(';').map((s) => s.split(',').map((x) => parseInt(x, 10)));
      const t0 = parts[0], t1 = parts[1] && parts[1].length === 4 ? parts[1] : t0;
      if ([t0, t1].every((T) => T.length === 4 && T.every((x) => x >= 0 && x < 4) && window.RCA.invertPerm(T))) customise((q) => { q.tabs = [t0, t1]; });
      else pPerm.classList.add('bad');
    };
    const pTab = $('#pTab');
    if (pTab) pTab.onchange = () => {
      const parts = pTab.value.split(';').map((s) => s.split(',').map((x) => parseInt(x, 10)));
      const t0 = parts[0], t1 = parts[1] && parts[1].length === 16 ? parts[1] : t0;
      if ([t0, t1].every((T) => T.length === 16 && T.every((x) => x >= 0 && x < 16) && window.RCA.invertPerm(T))) customise((q) => { q.tabs = [t0, t1]; });
      else pTab.classList.add('bad');
    };
    const digits = (s) => [...new Set(s.replace(/[^0-8]/g, '').split('').map(Number))].sort();
    const pB = $('#pB'), pS = $('#pS'), pNb = $('#pNb');
    if (pB) pB.onchange = () => customise((q) => { q.B = digits(pB.value); });
    if (pS) pS.onchange = () => customise((q) => { q.S = digits(pS.value); });
    if (pNb) pNb.onchange = () => customise((q) => { q.moore = pNb.value === '1'; });
    const pR = $('#pR');
    if (pR) pR.onchange = () => customise((q) => { q.r = +pR.value; q.S = q.S.filter((k) => k <= 2 * q.r); });
    body.querySelectorAll('input[type=checkbox][data-s]').forEach((el) => el.onchange = () => customise((q) => {
      const k = +el.dataset.s;
      q.S = el.checked ? [...new Set([...q.S, k])].sort((a, b) => a - b) : q.S.filter((x) => x !== k);
    }));
  }

  /* ================================================================ init panel */
  function syncInitUI() {
    const lib = U.dim === 1 ? PAT.P1 : PAT.P2;
    $('#patSel').innerHTML = Object.entries(lib).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    $('#patSel').value = U.init.pattern;
    const pat = lib[U.init.pattern];
    $('#dens').value = U.init.density; $('#densVal').textContent = U.init.density.toFixed(2);
    $('#densRow').style.display = pat && pat.usesDensity ? '' : 'none';
    $('#textRow').style.display = pat && pat.usesText ? '' : 'none';
    $('#txt').value = U.init.text;
    $('#pastRow').style.display = fam().order === 2 ? '' : 'none';
    $('#pastSel').value = U.init.past;
    $('#sizeLbl').textContent = U.dim === 1 ? 'Width' : 'Side';
    $('#sizeSel').innerHTML = SIZES[U.dim].map((s) => `<option value="${s}">${U.dim === 1 ? s + ' cells' : s + ' × ' + s}</option>`).join('');
    $('#sizeSel').value = U.size;
    $('#initHint').textContent = pat && !pat.low ? 'A typical configuration: already at equilibrium, so nothing macroscopic happens.' : U.dim === 1 ? 'Low entropy. Rows above t = 0 are its future, rows below its past.' : 'Low entropy. Play forwards or backwards: it scrambles both ways.';
  }

  /* ================================================================ dimension switch */
  function setDim(d) {
    if (U) { U.playing = 0; stroke = null; flushHistory(); }
    U = d === 1 ? U1 : U2;
    document.querySelectorAll('.dimtabs button').forEach((b) => b.classList.toggle('active', +b.dataset.dim === d));
    if (!U.hist) { buildEngine(); prepare(); }
    $('#viewRow2d').style.display = d === 2 ? '' : 'none';
    $('#viewRow1d').style.display = d === 1 ? '' : 'none';
    $('#eT').value = U.echo.T;
    $('#partChk').checked = U.showPart; $('#avgChk').checked = U.showAvg; $('#upChk').checked = U.timeUp; $('#dualChk').checked = U.dual;
    $('#animChk').checked = U.animate;
    document.querySelectorAll('#toolSeg button').forEach((b) => b.classList.toggle('active', b.dataset.tool === U.tool));
    hover = null;
    $('#hover').style.display = 'none';
    syncInitUI();
    renderRuleUI();
    resize();
    updatePanels(true);
  }

  /* ================================================================ pointer */
  let stroke = null;
  function hitTest(e) {
    if (!G) return null;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    if (U.dim === 1) {
      const i = Math.floor((mx - G.x0) / G.cell), rr = Math.floor((my - G.y0) / G.cell);
      if (i < 0 || i >= W() || rr < 0 || rr >= G.nRows) return null;
      const k = U.timeUp ? G.nRows - 1 - rr : rr;
      return { i, t: win.t0 + k, mx, my };
    }
    const x = Math.floor((mx - G.x0) / G.cell), y = Math.floor((my - G.y0) / G.cell);
    if (x < 0 || y < 0 || x >= W() || y >= W()) return null;
    return { x, y, i: y * W() + x, t: U.t, mx, my };
  }

  function toggleProbe(i) {
    const j = U.probes.indexOf(i);
    if (j >= 0) U.probes.splice(j, 1); else U.probes.push(i);
    if (U.probes.length > 8) U.probes.shift();
    dirty = true; updatePanels(true);
  }

  cv.addEventListener('pointerdown', (e) => {
    const h = hitTest(e);
    if (!h || e.button !== 0) return;
    if (U.tool === 'probe' || e.altKey) { toggleProbe(h.i); return; }
    cv.setPointerCapture(e.pointerId);
    const S = U.hist.at(h.t);
    const v = S.cur[h.i] ^ 1;
    const before = U.dim === 1 && U.animate ? U.hist.clone() : null;
    // Loschmidt echo: after the scramble, the user's own clicks are the perturbation (step 3)
    const echoFirst = U.echo.stage === 2;
    const echoMore = U.echo.stage === 3 && U.ref && U.lc && U.lc.t === h.t;
    if (echoFirst) {
      U.ref = U.hist.clone();
      setLC(h.t, [h.i]);
      U.echo.stage = 3;
    } else if (echoMore) {
      setLC(h.t, [...U.lc.cells, h.i]);
    } else if (beginEdit()) {
      // the light-cone readouts describe this toggle only if the reference was frozen just before it
      setLC(h.t, [h.i]);
    } else if (!U.ref) U.lc = null;
    stroke = { t: h.t, v, last: h, dim: U.dim, grow: echoFirst || echoMore || U.lightcone };
    editCells(h.t, [h.i], [v], true);
    startReveal(before, h.t);
    dirty = true;
  });

  cv.addEventListener('pointermove', (e) => {
    const h = hitTest(e);
    if (stroke && (!(e.buttons & 1) || stroke.dim !== U.dim)) endStroke(); // a missed pointerup, or the view changed
    if (stroke) {
      if (!h) return;
      const idxs = [];
      if (U.dim === 1) {
        const a = stroke.last.i, b = h.i, s = Math.sign(b - a);
        for (let i = a + s; s && i !== b + s; i += s) idxs.push(i);
      } else {
        // Bresenham from the previous cell
        let x0 = stroke.last.x, y0 = stroke.last.y; const x1 = h.x, y1 = h.y;
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        while (!(x0 === x1 && y0 === y1)) {
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
          idxs.push(y0 * W() + x0);
        }
      }
      if (idxs.length) {
        const te = U.dim === 1 ? stroke.t : U.t;
        editCells(te, idxs, idxs.map(() => stroke.v), true);
        // a painted stroke is one perturbation: its light cone grows with it
        if (stroke.grow && U.lc && U.lc.t === te && U.lc.cells.length < 4096) setLC(te, [...new Set([...U.lc.cells, ...idxs])]);
        stroke.last = U.dim === 1 ? { ...h, t: stroke.t } : h;
      }
      dirty = true;
    }
    const prev = hover;
    hover = h ? (U.dim === 1 ? { t: h.t, i: h.i } : { x: h.x, y: h.y, i: h.i }) : null;
    if (JSON.stringify(prev) !== JSON.stringify(hover)) dirty = true;
    const hb = $('#hover');
    if (h) {
      const v = U.hist.at(h.t).cur[h.i] ^ flipAt(h.t);
      hb.style.display = 'block';
      hb.textContent = U.dim === 1 ? `t = ${h.t}   i = ${h.i}   ${v ? '●' : '○'}` : `(${h.x}, ${h.y})   ${v ? '●' : '○'}`;
      const r = cv.getBoundingClientRect();
      const lx = e.clientX - r.left + 14, ly = e.clientY - r.top + 14;
      hb.style.left = Math.min(lx, r.width - 150) + 'px'; hb.style.top = Math.min(ly, r.height - 30) + 'px';
      U.hist.at(U.t);
    } else hb.style.display = 'none';
  });
  function endStroke() { stroke = null; flushHistory(); dirty = true; }
  cv.addEventListener('pointerup', endStroke);
  cv.addEventListener('pointercancel', endStroke);
  cv.addEventListener('lostpointercapture', () => { if (stroke) endStroke(); });
  cv.addEventListener('pointerleave', () => { if (!stroke) { hover = null; $('#hover').style.display = 'none'; dirty = true; } });

  let wheelAcc = 0;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (U.playing) pause();
    wheelAcc += e.deltaY;
    const unit = 30;
    while (Math.abs(wheelAcc) >= unit) {
      const s = -Math.sign(wheelAcc) * (e.shiftKey ? 10 : 1) * (U.dim === 1 ? 2 : 1);
      wheelAcc -= Math.sign(wheelAcc) * unit;
      goTo(U.t + (U.dim === 1 && !U.timeUp ? -s : s));
    }
  }, { passive: false });

  /* ================================================================ controls */
  document.querySelectorAll('.dimtabs button').forEach((b) => b.onclick = () => setDim(+b.dataset.dim));
  $('#ruleSel').onchange = (e) => {
    const v = e.target.value;
    if (v.startsWith('p:')) {
      const P = PRESETS.find((p) => p.id === v.slice(2));
      U.presetId = P.id; U.family = P.family; U.params = JSON.parse(JSON.stringify(P.params));
    } else {
      const famId = v.slice(2);
      if (famId !== U.family) {
        const P = PRESETS.find((p) => p.family === famId);
        U.family = famId; U.params = P ? JSON.parse(JSON.stringify(P.params)) : {};
      }
      U.presetId = null;
      $('#paramBox').open = true;
    }
    applyRule();
    syncInitUI();
  };
  $('#sizeSel').onchange = (e) => { U.size = +e.target.value; U.probes = []; buildEngine(); prepare(); };
  $('#patSel').onchange = (e) => { U.init.pattern = e.target.value; syncInitUI(); prepare(); renderRuleUI(); };
  $('#dens').oninput = (e) => { U.init.density = +e.target.value; $('#densVal').textContent = U.init.density.toFixed(2); };
  $('#dens').onchange = () => prepare();
  $('#txt').onchange = (e) => { U.init.text = e.target.value; prepare(); };
  $('#pastSel').onchange = (e) => { U.init.past = e.target.value; prepare(); };
  $('#prepBtn').onclick = () => prepare();

  $('#tZero').onclick = () => { pause(); goTo(0); };
  $('#tBack').onclick = () => play(-1);
  $('#tFwd').onclick = () => play(1);
  $('#tPause').onclick = () => pause();
  $('#tStepB').onclick = () => { pause(); goTo(U.t - 1); };
  $('#tStepF').onclick = () => { pause(); goTo(U.t + 1); };
  $('#tInput').onkeydown = (e) => { if (e.key === 'Enter') { pause(); goTo(parseInt(e.target.value, 10)); e.target.blur(); } };

  document.querySelectorAll('#toolSeg button').forEach((b) => b.onclick = () => {
    U.tool = b.dataset.tool;
    document.querySelectorAll('#toolSeg button').forEach((x) => x.classList.toggle('active', x === b));
  });
  // ◎ light cone: shade the area of effect and arm the reference; ◐ damage: colour what actually changed
  document.querySelectorAll('.lcb').forEach((b) => b.onclick = () => { U.lightcone = !U.lightcone; dirty = true; updatePanels(true); });
  document.querySelectorAll('.dmb').forEach((b) => b.onclick = () => { U.showDiff = !U.showDiff; dirty = true; updatePanels(true); });
  $('#pinBtn').onclick = () => { U.ref = U.hist.clone(); U.lc = null; U.cone2 = null; dirty = true; updatePanels(true); };
  $('#clrBtn').onclick = () => { U.ref = null; U.lc = null; U.cone2 = null; U.series.forEach((e) => { e.d = null; }); dirty = true; updatePanels(true); };
  $('#animChk').onchange = (e) => { U.animate = e.target.checked; if (!U.animate) U.reveal = null; dirty = true; };
  $('#partChk').onchange = (e) => { U.showPart = e.target.checked; dirty = true; };
  $('#avgChk').onchange = (e) => { U.showAvg = e.target.checked; dirty = true; };
  $('#upChk').onchange = (e) => { U.timeUp = e.target.checked; dirty = true; };
  $('#dualChk').onchange = (e) => { U.dual = e.target.checked; U.series.clear(); resetErgoSums(); dirty = true; };
  $('#ergoReset').onclick = () => ergoReset();
  $('#probeClr').onclick = () => { U.probes = []; dirty = true; updatePanels(true); };
  $('#probeList').onclick = (e) => { const el = e.target.closest('.pr'); if (el) { U.probes.splice(+el.dataset.j, 1); dirty = true; updatePanels(true); } };

  // Loschmidt echo
  $('#e1').onclick = () => { prepare(); U.echo.stage = 1; updatePanels(true); };
  $('#e2').onclick = () => {
    const T = Math.max(1, parseInt($('#eT').value, 10) || 100);
    U.echo.T = T;
    U.ref = null; U.lc = null;
    U.echo.stage = 1;
    play(Math.sign(T - U.t) || 1, T);
    U.echo.onArrive = () => { U.echo.stage = 2; };
  };
  $('#e3').onclick = () => {
    pause();
    const k = Math.max(1, Math.min(N(), parseInt($('#eK').value, 10) || 1));
    U.ref = U.hist.clone();
    const c = U.hist.at(U.t).cur, n = N(), w = W();
    let arr;
    if ($('#eMode').value === 'nudge') {
      // move k particles by one cell each into an empty neighbour: N and the sector stay the same
      const nbrs = (i) => (U.dim === 1 ? [(i + 1) % w, (i + w - 1) % w]
        : [((i / w) | 0) * w + (i % w + 1) % w, ((i / w) | 0) * w + (i % w + w - 1) % w, (i + w) % n, (i + n - w) % n]);
      const used = new Set();
      arr = [];
      for (let tries = 0; arr.length < 2 * k && tries < 20 * n; tries++) {
        const i = Math.floor(Math.random() * n);
        if (!c[i] || used.has(i)) continue;
        const free = nbrs(i).filter((j) => !c[j] && !used.has(j));
        if (!free.length) continue;
        const j = free[Math.floor(Math.random() * free.length)];
        used.add(i); used.add(j); arr.push(i, j);
      }
      if (!arr.length) { $('#echoOut').innerHTML = '<span class="hint">No particle with an empty neighbour to move.</span>'; U.ref = null; return; }
    } else {
      const idxs = new Set();
      while (idxs.size < k) idxs.add(Math.floor(Math.random() * n));
      arr = [...idxs];
    }
    setLC(U.t, arr);
    const before = U.dim === 1 && U.animate ? U.hist.clone() : null;
    editCells(U.t, arr, null);
    startReveal(before, U.t);
    U.echo.stage = 3;
    updatePanels(true);
  };
  $('#e4').onclick = () => {
    if (U.t === 0) return;
    play(U.t > 0 ? -1 : 1, 0);
    U.echo.onArrive = () => { U.echo.stage = 4; };
  };
  $('#e5').onclick = () => {
    if (!U.ref) return;
    const before = U.hist;
    U.hist = U.ref.clone(); historyChanged(); U.hist.at(U.t);
    startReveal(before, U.lc ? U.lc.t : U.t);
    updatePanels(true);
  };
  function runToZero() {
    if (U.t === 0) return;
    play(U.t > 0 ? -1 : 1, 0);
    U.fastRate = Math.max(80, Math.abs(U.t) / 2.5);
  }
  $('#tRun0').onclick = runToZero;
  const SPEEDS = [3, 10, 30, 100, 300, 1000, Infinity];
  function setSpeed(v) { U.speed = v; measuredRate = 0; updatePanels(true); }
  $('#speedBtns').innerHTML = SPEEDS.map((v) => `<button data-s="${Number.isFinite(v) ? v : 'max'}" title="${Number.isFinite(v) ? v + ' steps per second' : 'As many steps as fit in each frame'}">${v === 1000 ? '1k' : Number.isFinite(v) ? v : 'max'}</button>`).join('');
  document.querySelectorAll('#speedBtns button').forEach((b) => b.onclick = () => setSpeed(b.dataset.s === 'max' ? Infinity : +b.dataset.s));
  function nudgeSpeed(d) { const j = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(U.speed) + d)); setSpeed(SPEEDS[j]); }

  $('#helpBtn').onclick = () => { $('#help').hidden = false; };
  $('#helpClose').onclick = () => { $('#help').hidden = true; };
  $('#help').onclick = (e) => { if (e.target.id === 'help') $('#help').hidden = true; };

  // keep keyboard shortcuts live: a focused button would also fire on Space, a focused select would eat the arrows
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
  document.querySelectorAll('select, input[type=checkbox], input[type=range]').forEach((el) => el.addEventListener('change', () => el.blur()));

  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (U.playing) pause(); else play(e.shiftKey ? -1 : U.lastDir || 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); pause(); goTo(U.t + (e.shiftKey ? 10 : 1)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); pause(); goTo(U.t - (e.shiftKey ? 10 : 1)); }
    else if (k === 'ArrowUp' && U.dim === 1) { e.preventDefault(); pause(); goTo(U.t + (U.timeUp ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
    else if (k === 'ArrowDown' && U.dim === 1) { e.preventDefault(); pause(); goTo(U.t - (U.timeUp ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
    else if (k === 'Home' || k === '0') { pause(); goTo(0); }
    else if (k === 'z' || k === 'Z') runToZero();
    else if (k === ']' || k === '=' || k === '+') nudgeSpeed(1);
    else if (k === '[' || k === '-') nudgeSpeed(-1);
    else if (k === 'r' || k === 'R') { play(-(U.playing || U.lastDir || 1)); }
    else if (k === 'l' || k === 'L') $('#lcBtn').click();
    else if (k === 'p' || k === 'P') $('#pinBtn').click();
    else if (k === 'x' || k === 'X') $('#clrBtn').click();
    else if (k === 'd' || k === 'D') $('#dmgBtn').click();
    else if ((k === 'a' || k === 'A') && U.dim === 2) { $('#avgChk').click(); }
    else if (k === '1') setDim(1);
    else if (k === '2') setDim(2);
    else if (k === '?') $('#help').hidden = !$('#help').hidden;
    else if (k === 'Escape') $('#help').hidden = true;
  });

  /* ================================================================ main loop */
  let last = performance.now(), measuredRate = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!stroke) flushHistory();
    if (U.playing) {
      const rate = U.target !== null ? Math.max(U.speed, U.fastRate) : U.speed;
      let k;
      if (Number.isFinite(rate)) { U.stepAcc += rate * dt; k = Math.floor(U.stepAcc); U.stepAcc -= k; }
      else { k = 1e9; U.stepAcc = 0; } // max speed: as many steps as fit in the frame budget
      const tBefore = U.t;
      const t0 = performance.now();
      while (k-- > 0) {
        if (U.target !== null && U.t === U.target) break;
        advance(U.playing);
        if (performance.now() - t0 > 12) { U.stepAcc = 0; break; }
      }
      if (dt > 0) measuredRate = 0.9 * measuredRate + 0.1 * (Math.abs(U.t - tBefore) / dt);
      // arrived, or somehow carried past the target: either way the run is over
      if (U.target !== null && (U.t === U.target || Math.sign(U.target - U.t) !== U.playing)) {
        U.playing = 0; U.target = null;
        if (U.echo.onArrive) { U.echo.onArrive(); U.echo.onArrive = null; }
        updatePanels(true);
      }
      dirty = true;
    }
    // an edit unfolding through the 1D diagram: its front moves at the play speed, one row per step
    if (U.reveal) {
      const rv = U.reveal;
      rv.r += (Number.isFinite(U.speed) ? Math.max(60, 4 * U.speed) : 2000) * dt;
      const reach = Math.max(Math.abs(win.t0 - rv.t), Math.abs(win.t1 - rv.t));
      if (U.dim !== 1 || rv.r > reach + 1) U.reveal = null;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      if (U.dim === 1) render1D(); else render2D();
      updatePanels(!U.playing);
    }
    requestAnimationFrame(frame);
  }

  /* ================================================================ boot */
  function boot() {
    const box = $('#themes');
    for (const [id, T] of Object.entries(THEMES)) {
      const b = document.createElement('button');
      b.dataset.theme = id;
      b.title = `${T.name}: ${T.note}`;
      b.innerHTML = `<i style="background:${T.cell.off}"></i><i style="background:${T.cell.on}"></i>`;
      b.onclick = () => { applyTheme(id); updatePanels(true); };
      box.appendChild(b);
    }
    let saved = 'paper';
    try { saved = localStorage.getItem('loschmidt.theme.v2') || 'paper'; } catch (e) { /* no storage: default theme */ }
    applyTheme(saved);
    setDim(1);
    requestAnimationFrame(frame);
  }
  boot();
})();
