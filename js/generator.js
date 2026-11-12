// Shikaku puzzle generator + uniqueness solver
(function (root) {
  const S = root.Shikaku = root.Shikaku || {};

  // ---------- random partition ----------
  function partition(w, h, rng, maxArea) {
    const owner = new Int16Array(w * h).fill(-1);
    const rects = [];
    for (let idx = 0; idx < w * h; idx++) {
      if (owner[idx] !== -1) continue;
      const r = Math.floor(idx / w), c = idx % w;
      // collect candidate rectangles with top-left at (r,c)
      const cands = [];
      let maxW = 0;
      while (c + maxW < w && owner[r * w + c + maxW] === -1) maxW++;
      for (let rh = 1; r + rh - 1 < h; rh++) {
        // check row r+rh-1 is free for the current width limit
        let rowW = 0;
        while (rowW < maxW && owner[(r + rh - 1) * w + c + rowW] === -1) rowW++;
        maxW = rowW;
        if (maxW === 0) break;
        for (let rw = 1; rw <= maxW; rw++) {
          const area = rw * rh;
          if (area > maxArea) break;
          let weight;
          if (area === 1) weight = 0.08;
          else if (area === 2) weight = 0.5;
          else weight = 1 + Math.min(area, 8) * 0.15;
          // discourage very thin long strips
          const ratio = Math.max(rw, rh) / Math.min(rw, rh);
          if (ratio > 4) weight *= 0.3;
          cands.push({ rw, rh, weight });
        }
      }
      let total = 0;
      for (const k of cands) total += k.weight;
      let pick = rng() * total, chosen = cands[0];
      for (const k of cands) { pick -= k.weight; if (pick <= 0) { chosen = k; break; } }
      const id = rects.length;
      rects.push({ r1: r, c1: c, r2: r + chosen.rh - 1, c2: c + chosen.rw - 1 });
      for (let y = r; y < r + chosen.rh; y++)
        for (let x = c; x < c + chosen.rw; x++) owner[y * w + x] = id;
    }
    return rects;
  }

  // ---------- solver (counts solutions up to `limit`) ----------
  // clues: [{r,c,n}]
  function candidatesFor(w, h, clues, clueAt, k) {
    const { r, c, n } = clues[k];
    const out = [];
    for (let rh = 1; rh <= n; rh++) {
      if (n % rh) continue;
      const rw = n / rh;
      if (rh > h || rw > w) continue;
      for (let r1 = Math.max(0, r - rh + 1); r1 <= Math.min(r, h - rh); r1++) {
        for (let c1 = Math.max(0, c - rw + 1); c1 <= Math.min(c, w - rw); c1++) {
          let ok = true;
          const cells = [];
          for (let y = r1; y < r1 + rh && ok; y++)
            for (let x = c1; x < c1 + rw; x++) {
              const ci = clueAt[y * w + x];
              if (ci !== -1 && ci !== k) { ok = false; break; }
              cells.push(y * w + x);
            }
          if (ok) out.push({ r1, c1, r2: r1 + rh - 1, c2: c1 + rw - 1, cells });
        }
      }
    }
    return out;
  }

  function solve(w, h, clues, limit = 2) {
    const N = w * h;
    const clueAt = new Int16Array(N).fill(-1);
    clues.forEach((cl, i) => { clueAt[cl.r * w + cl.c] = i; });
    const cands = clues.map((_, k) => candidatesFor(w, h, clues, clueAt, k));
    // per-cell list of [clue, candIdx]
    const cellOpts = Array.from({ length: N }, () => []);
    cands.forEach((list, k) => list.forEach((cd, j) => cd.cells.forEach(ci => cellOpts[ci].push(k, j))));

    const covered = new Uint8Array(N);
    const placed = new Uint8Array(clues.length);
    const choice = new Int32Array(clues.length).fill(-1);
    const solutions = [];
    let nodes = 0;
    const NODE_LIMIT = 200000;

    function fits(cd) {
      const cs = cd.cells;
      for (let i = 0; i < cs.length; i++) if (covered[cs[i]]) return false;
      return true;
    }

    function rec() {
      if (solutions.length >= limit || nodes++ > NODE_LIMIT) return;
      // pick uncovered cell with fewest options
      let best = -1, bestCount = Infinity;
      for (let ci = 0; ci < N; ci++) {
        if (covered[ci]) continue;
        const opts = cellOpts[ci];
        let cnt = 0;
        for (let i = 0; i < opts.length; i += 2) {
          const k = opts[i];
          if (!placed[k] && fits(cands[k][opts[i + 1]])) { cnt++; if (cnt >= bestCount) break; }
        }
        if (cnt < bestCount) { bestCount = cnt; best = ci; if (cnt === 0) return; if (cnt === 1) break; }
      }
      if (best === -1) {
        solutions.push(Array.from(choice).map((j, k) => cands[k][j]));
        return;
      }
      const opts = cellOpts[best];
      for (let i = 0; i < opts.length; i += 2) {
        const k = opts[i], j = opts[i + 1];
        if (placed[k]) continue;
        const cd = cands[k][j];
        if (!fits(cd)) continue;
        placed[k] = 1; choice[k] = j;
        for (const ci of cd.cells) covered[ci] = 1;
        rec();
        for (const ci of cd.cells) covered[ci] = 0;
        placed[k] = 0; choice[k] = -1;
        if (solutions.length >= limit) return;
      }
    }
    rec();
    return { count: solutions.length, solutions, aborted: nodes > NODE_LIMIT };
  }

  // ---------- public generate ----------
  S.LEVELS = {
    easy:   { w: 5,  h: 5,  maxArea: 6,  label: 'Легко' },
    medium: { w: 7,  h: 7,  maxArea: 9,  label: 'Середньо' },
    hard:   { w: 10, h: 10, maxArea: 12, label: 'Складно' },
    expert: { w: 12, h: 12, maxArea: 14, label: 'Експерт' },
    master: { w: 15, h: 15, maxArea: 16, label: 'Майстер' },
  };

  S.generate = function (w, h, maxArea, rng) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const rects = partition(w, h, rng, maxArea);
      // a few tries of clue placement per partition
      for (let t = 0; t < 6; t++) {
        const clues = rects.map(rc => {
          const r = rc.r1 + Math.floor(rng() * (rc.r2 - rc.r1 + 1));
          const c = rc.c1 + Math.floor(rng() * (rc.c2 - rc.c1 + 1));
          return { r, c, n: (rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1) };
        });
        const res = solve(w, h, clues, 2);
        if (res.count === 1 && !res.aborted) {
          return { w, h, clues, solution: res.solutions[0].map(({ r1, c1, r2, c2 }) => ({ r1, c1, r2, c2 })), attempts: attempt + 1 };
        }
      }
    }
    throw new Error('Не вдалося згенерувати пазл');
  };

  S.solve = solve;
})(typeof window !== 'undefined' ? window : globalThis);
