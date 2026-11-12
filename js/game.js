// Game board: rendering, drag-to-draw, validation
(function (root) {
  const S = root.Shikaku = root.Shikaku || {};
  const PALETTE = 8;

  class Game {
    constructor(boardEl, puzzle, { onChange, onWin } = {}) {
      this.el = boardEl;
      this.p = puzzle;
      this.onChange = onChange || (() => {});
      this.onWin = onWin || (() => {});
      this.rects = [];          // {r1,c1,r2,c2,el,valid,color}
      this.won = false;
      this.drag = null;
      this.clueAt = new Map();
      puzzle.clues.forEach((cl, i) => this.clueAt.set(cl.r * puzzle.w + cl.c, i));
      this.render();
      this.bind();
    }

    // ---------- rendering ----------
    render() {
      const { w, h, clues } = this.p;
      this.el.classList.remove('won');
      this.el.style.setProperty('--w', w);
      this.el.style.setProperty('--h', h);
      this.el.innerHTML = '';
      const inner = document.createElement('div');
      inner.className = 'board-inner';

      const cells = document.createElement('div');
      cells.className = 'cells';
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const d = document.createElement('div');
        d.className = 'cell' + (c === w - 1 ? ' re' : '') + (r === h - 1 ? ' be' : '') +
          (this.clueAt.has(r * w + c) ? ' has-clue' : '');
        cells.appendChild(d);
      }

      this.rectLayer = document.createElement('div');
      this.rectLayer.className = 'rects';

      const clueLayer = document.createElement('div');
      clueLayer.className = 'clues';
      this.clueEls = clues.map((cl, i) => {
        const d = document.createElement('div');
        d.className = 'clue';
        d.textContent = cl.n;
        this.place(d, cl.r, cl.c, cl.r, cl.c);
        const dist = Math.hypot(cl.r - h / 2, cl.c - w / 2);
        d.style.setProperty('--d', (dist * 0.035 + i * 0.004).toFixed(3) + 's');
        clueLayer.appendChild(d);
        return d;
      });

      inner.append(cells, this.rectLayer, clueLayer);
      this.el.appendChild(inner);
      this.inner = inner;

      // font size follows cell size
      if (this.ro) this.ro.disconnect();
      this.ro = new ResizeObserver(() => {
        const cw = inner.clientWidth / w;
        this.el.style.setProperty('--fs', Math.max(11, Math.round(cw * 0.46)) + 'px');
      });
      this.ro.observe(inner);
    }

    place(el, r1, c1, r2, c2) {
      const { w, h } = this.p;
      el.style.left = (c1 / w * 100) + '%';
      el.style.top = (r1 / h * 100) + '%';
      el.style.width = ((c2 - c1 + 1) / w * 100) + '%';
      el.style.height = ((r2 - r1 + 1) / h * 100) + '%';
    }

    // ---------- input ----------
    bind() {
      const el = this.el;
      this.handlers = {
        down: e => this.pointerDown(e),
        move: e => this.pointerMove(e),
        up: e => this.pointerUp(e),
        cancel: () => this.cancelDrag(),
      };
      el.addEventListener('pointerdown', this.handlers.down);
      el.addEventListener('pointermove', this.handlers.move);
      el.addEventListener('pointerup', this.handlers.up);
      el.addEventListener('pointercancel', this.handlers.cancel);
    }

    destroy() {
      const el = this.el;
      el.removeEventListener('pointerdown', this.handlers.down);
      el.removeEventListener('pointermove', this.handlers.move);
      el.removeEventListener('pointerup', this.handlers.up);
      el.removeEventListener('pointercancel', this.handlers.cancel);
      if (this.ro) this.ro.disconnect();
    }

    cellFromEvent(e, clamp) {
      const b = this.inner.getBoundingClientRect();
      const { w, h } = this.p;
      let c = Math.floor((e.clientX - b.left) / b.width * w);
      let r = Math.floor((e.clientY - b.top) / b.height * h);
      if (!clamp && (r < 0 || c < 0 || r >= h || c >= w)) return null;
      r = Math.max(0, Math.min(h - 1, r));
      c = Math.max(0, Math.min(w - 1, c));
      return { r, c };
    }

    pointerDown(e) {
      if (this.won || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const cell = this.cellFromEvent(e, false);
      if (!cell) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      const pv = document.createElement('div');
      pv.className = 'rect preview';
      pv.innerHTML = '<i></i><span class="preview-size"></span>';
      this.rectLayer.appendChild(pv);
      this.drag = { start: cell, end: cell, moved: false, el: pv, id: e.pointerId };
      this.updatePreview();
    }

    pointerMove(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const cell = this.cellFromEvent(e, true);
      if (cell.r !== this.drag.end.r || cell.c !== this.drag.end.c) {
        this.drag.end = cell;
        this.drag.moved = true;
        this.updatePreview();
      }
    }

    pointerUp(e) {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const d = this.drag;
      this.drag = null;
      d.el.remove();
      const box = norm(d.start, d.end);
      if (!d.moved) {
        const hit = this.rects.find(rc => inside(rc, d.start.r, d.start.c));
        if (hit) { this.removeRect(hit); this.afterChange(); return; }
      }
      this.addRect(box);
      this.afterChange();
    }

    cancelDrag() {
      if (this.drag) { this.drag.el.remove(); this.drag = null; }
    }

    updatePreview() {
      const d = this.drag;
      const box = norm(d.start, d.end);
      this.place(d.el, box.r1, box.c1, box.r2, box.c2);
      const v = this.evaluate(box);
      d.el.classList.toggle('good', v.valid);
      d.el.classList.toggle('nope', v.clues > 1 || (v.clues === 1 && v.area > v.n));
      d.el.querySelector('.preview-size').textContent = v.area > 1 ? v.area : '';
    }

    // ---------- model ----------
    evaluate(box) {
      const { w } = this.p;
      let clues = 0, n = 0, idx = -1;
      for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) {
        const k = this.clueAt.get(r * w + c);
        if (k !== undefined) { clues++; n = this.p.clues[k].n; idx = k; }
      }
      const area = (box.r2 - box.r1 + 1) * (box.c2 - box.c1 + 1);
      return { clues, n, area, idx, valid: clues === 1 && n === area };
    }

    addRect(box) {
      for (const rc of this.rects.slice()) if (overlap(rc, box)) this.removeRect(rc);
      const v = this.evaluate(box);
      const el = document.createElement('div');
      el.className = 'rect' + (v.valid ? '' : ' bad');
      el.innerHTML = '<i></i>';
      const rect = { ...box, el, valid: v.valid, clue: v.idx, color: 0 };
      rect.color = this.pickColor(rect);
      el.style.setProperty('--c', `var(--p${rect.color + 1})`);
      this.place(el, box.r1, box.c1, box.r2, box.c2);
      this.rectLayer.appendChild(el);
      this.rects.push(rect);
    }

    pickColor(rect) {
      const used = new Set();
      for (const o of this.rects) if (touches(o, rect)) used.add(o.color);
      const free = [];
      for (let i = 0; i < PALETTE; i++) if (!used.has(i)) free.push(i);
      const pool = free.length ? free : [...Array(PALETTE).keys()];
      // deterministic-ish per clue for calm visuals
      const seed = rect.clue >= 0 ? rect.clue : rect.r1 * 31 + rect.c1;
      return pool[seed % pool.length];
    }

    removeRect(rc) {
      this.rects.splice(this.rects.indexOf(rc), 1);
      rc.el.classList.add('leaving');
      rc.el.addEventListener('animationend', () => rc.el.remove(), { once: true });
      setTimeout(() => rc.el.remove(), 400);
    }

    clear() {
      for (const rc of this.rects.slice()) this.removeRect(rc);
      this.afterChange();
    }

    afterChange() {
      const { w, h } = this.p;
      const doneClues = new Set();
      let covered = 0, allValid = true;
      for (const rc of this.rects) {
        covered += (rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1);
        if (rc.valid) doneClues.add(rc.clue); else allValid = false;
      }
      this.clueEls.forEach((el, i) => el.classList.toggle('done', doneClues.has(i)));
      this.onChange({ done: doneClues.size, total: this.p.clues.length });
      if (covered === w * h && allValid && !this.won) {
        this.won = true;
        this.celebrate();
        this.onWin();
      }
    }

    celebrate() {
      const { w, h } = this.p;
      for (const rc of this.rects) {
        const cr = (rc.r1 + rc.r2) / 2, cc = (rc.c1 + rc.c2) / 2;
        rc.el.style.setProperty('--wd', ((cr + cc) / (w + h) * 0.8).toFixed(3) + 's');
      }
      this.el.classList.add('won');
    }
  }

  function norm(a, b) {
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }
  function inside(rc, r, c) { return r >= rc.r1 && r <= rc.r2 && c >= rc.c1 && c <= rc.c2; }
  function overlap(a, b) { return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2; }
  function touches(a, b) { return a.r1 <= b.r2 + 1 && b.r1 <= a.r2 + 1 && a.c1 <= b.c2 + 1 && b.c1 <= a.c2 + 1; }

  S.Game = Game;
})(window);
