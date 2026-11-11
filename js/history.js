/* Loschmidt · history.js
 * A History is one full trajectory of a reversible rule, t ∈ ℤ. It is stored as a single anchor state
 * (any time slice determines the whole history) plus a cache of snapshots; a walker state moves to any
 * requested time by stepping forwards or backwards from the nearest cached slice.
 */
(function (root) {
  'use strict';
  const RCA = root.RCA || (typeof require !== 'undefined' ? require('./rules.js') : null);
  const { cloneState, copyState } = RCA;
  let VERSION = 0; // global, so caches keyed on a version never confuse two histories

  // snapshots keep only the slices, not the walker's scratch buffer
  const snapOf = (S) => ({ cur: S.cur.slice(), prev: S.prev ? S.prev.slice() : null });

  class History {
    constructor(engine, n, order) {
      this.engine = engine;
      this.n = n;
      this.order = order;
      this.version = 0;
      this.snapEvery = 32;
      // about 24 MB of snapshots per history, and never more than 4000 of them
      this.maxSnaps = Math.max(32, Math.min(4000, Math.floor(24e6 / (n * order))));
    }

    reset(t, S) {
      this.anchorT = t;
      this.anchor = snapOf(S);
      this.snaps = new Map([[t, this.anchor]]);
      this.w = cloneState(S);
      this.wt = t;
      this.version = ++VERSION;
      return this;
    }

    clone() {
      return new History(this.engine, this.n, this.order).reset(this.anchorT, this.anchor);
    }

    _snap() {
      if (this.wt % this.snapEvery === 0 && !this.snaps.has(this.wt)) {
        this.snaps.set(this.wt, snapOf(this.w));
        if (this.snaps.size > this.maxSnaps) this._trim();
      }
    }
    // drop the quarter of snapshots farthest from the walker, in one pass
    _trim() {
      const keys = [...this.snaps.keys()].filter((k) => k !== this.anchorT);
      keys.sort((a, b) => Math.abs(b - this.wt) - Math.abs(a - this.wt));
      const drop = this.snaps.size - Math.floor(this.maxSnaps * 0.75);
      for (let j = 0; j < drop && j < keys.length; j++) this.snaps.delete(keys[j]);
    }
    _fwd() { this.engine.step(this.w, this.wt); this.wt++; this._snap(); }
    _bwd() { this.engine.unstep(this.w, this.wt); this.wt--; this._snap(); }

    /** Walker state at time t. The returned object is live: copy it if you need to keep it. */
    at(t) {
      if (t === this.wt) return this.w;
      let best = this.wt, bd = Math.abs(t - this.wt);
      const se = this.snapEvery, k0 = Math.floor(t / se) * se;
      for (const k of [k0, k0 + se, this.anchorT]) {
        if (this.snaps.has(k)) {
          const d = Math.abs(t - k);
          if (d < bd) { bd = d; best = k; }
        }
      }
      if (best !== this.wt) { copyState(this.w, this.snaps.get(best)); this.wt = best; }
      while (this.wt < t) this._fwd();
      while (this.wt > t) this._bwd();
      return this.w;
    }

    /** Copy rows x^t for t = t0..t1 (inclusive, ascending) into out. */
    rows(t0, t1, out) {
      const n = this.n;
      this.at(t0);
      out.set(this.w.cur, 0);
      for (let t = t0 + 1, k = n; t <= t1; t++, k += n) { this._fwd(); out.set(this.w.cur, k); }
    }

    /** Change the cells idxs at time t to the values vals (or flip them if vals is null). Rewrites the history. */
    edit(t, idxs, vals) {
      const S = this.at(t);
      let changed = false;
      for (let j = 0; j < idxs.length; j++) {
        const i = idxs[j];
        const v = vals == null ? S.cur[i] ^ 1 : vals[j];
        if (S.cur[i] !== v) { S.cur[i] = v; changed = true; }
      }
      if (changed) this.reset(t, S);
      return changed;
    }
  }

  root.History = History;
  if (typeof module !== 'undefined' && module.exports) module.exports = History;
})(typeof window !== 'undefined' ? window : globalThis);
