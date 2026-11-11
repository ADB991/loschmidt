// node test/reversibility.js — checks that every preset is exactly invertible, that every conserved quantity a
// rule declares is conserved, and that History is consistent under random access and editing.
'use strict';
const RCA = require('../js/rules.js');
global.RCA = RCA;
const History = require('../js/history.js');

let fail = 0;
const rnd = (n, p) => Uint8Array.from({ length: n }, () => (Math.random() < p ? 1 : 0));
function check(name, cond, msg) {
  if (!cond) { fail++; console.log(`  ✗ ${name}: ${msg}`); }
}

for (const P of RCA.PRESETS) {
  const fam = RCA.FAMILIES[P.family];
  const W = P.dim === 1 ? 96 : 32, H = P.dim === 1 ? 1 : 32, n = W * H;
  const eng = fam.make(P.params, W, H);
  const info = RCA.analyse(P.family, P.params);
  let ok = true;
  for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const t0 of [-4, -3, 0, 1, 5]) {
      const S = RCA.newState(n, fam.order);
      S.cur.set(rnd(n, p));
      if (S.prev) S.prev.set(rnd(n, p));
      const S0 = RCA.cloneState(S);
      let t = t0;
      for (let k = 0; k < 17; k++) eng.step(S, t++);
      for (let k = 0; k < 17; k++) eng.unstep(S, t--);
      if (!RCA.sameState(S, S0)) { ok = false; check(P.id, false, `step/unstep mismatch at p=${p}, t0=${t0}`); break; }
      for (let k = 0; k < 9; k++) eng.unstep(S, t--);
      for (let k = 0; k < 9; k++) eng.step(S, t++);
      if (!RCA.sameState(S, S0)) { ok = false; check(P.id, false, `unstep/step mismatch at p=${p}, t0=${t0}`); break; }

      // declared conserved quantities, forwards and backwards (density < 1/2 for the box-ball system)
      if (P.family === 'bbs' && p >= 0.5) continue;
      for (const id of info.conserved) {
        const C = RCA.CONSERVED[id], q0 = String(C.fn(S, t, W, H, P.params));
        const T = RCA.cloneState(S);
        let tt = t, good = true;
        for (let k = 0; k < 30 && good; k++) { eng.step(T, tt++); if (String(C.fn(T, tt, W, H, P.params)) !== q0) good = false; }
        for (let k = 0; k < 60 && good; k++) { eng.unstep(T, tt--); if (String(C.fn(T, tt, W, H, P.params)) !== q0) good = false; }
        check(P.id, good, `${C.name} not conserved (p=${p}, t0=${t0})`);
        if (!good) ok = false;
      }
    }
    if (!ok) break;
  }
  // light cone soundness: every cell that actually changes after a flip lies inside the causal cone
  {
    const cone = RCA.coneEngine(P.family, P.params, W, H);
    let sound = true, inside = 0, total = 0;
    for (let trial = 0; trial < 6 && sound; trial++) {
      const A = RCA.newState(n, fam.order); A.cur.set(rnd(n, 0.4)); if (A.prev) A.prev.set(rnd(n, 0.4));
      const B = RCA.cloneState(A), i0 = Math.floor(Math.random() * n), t0 = trial - 3;
      B.cur[i0] ^= 1;
      for (const dir of [1, -1]) {
        const a = RCA.cloneState(A), b = RCA.cloneState(B), I = RCA.newState(n, fam.order);
        I.cur[i0] = 1;
        let t = t0;
        for (let k = 0; k < 25 && sound; k++) {
          if (dir > 0) { eng.step(a, t); eng.step(b, t); cone.step(I, t); t++; }
          else { eng.unstep(a, t); eng.unstep(b, t); cone.unstep(I, t); t--; }
          for (let i = 0; i < n; i++) {
            if (I.cur[i]) inside++;
            total++;
            if (a.cur[i] !== b.cur[i] && !I.cur[i]) { sound = false; break; }
          }
        }
      }
    }
    check(P.id, sound, 'a changed cell lies outside the light cone');
    if (!sound) ok = false;
  }
  console.log(`${ok ? '✓' : '✗'} ${P.id.padEnd(10)} ${P.name.padEnd(28)} conserving=${String(info.conserving).padEnd(5)} linear=${String(info.linear).padEnd(5)} conserved=[${info.conserved.join(', ')}]`);
}

// History: random access consistency
{
  const P = RCA.PRESETS.find((p) => p.id === 'critters');
  const W = 32, H = 32, n = W * H;
  const eng = RCA.FAMILIES.margolus.make(P.params, W, H);
  const S = RCA.newState(n, 1); S.cur.set(rnd(n, 0.5));
  const h = new History(eng, n, 1).reset(0, S);
  const a = RCA.cloneState(h.at(100));
  h.at(-77); h.at(3);
  check('history', RCA.sameState(a, h.at(100)), 'random access mismatch');
  const before = RCA.cloneState(h.at(-40));
  h.edit(50, [5], null);
  h.edit(50, [5], null);
  check('history', RCA.sameState(before, h.at(-40)), 'double toggle did not restore the past');
  console.log('✓ history random access + toggle/untoggle');
}

console.log(fail ? `\n${fail} failure(s)` : '\nall good');
process.exit(fail ? 1 : 0);
