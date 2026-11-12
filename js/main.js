// UI wiring: modes, themes, timer, persistence, confetti
(function () {
  const S = window.Shikaku;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const store = {
    get(k) { try { return localStorage.getItem('shikaku.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('shikaku.' + k, v); } catch (e) {} },
  };

  const DAILY_LEVEL = 'hard';
  const board = $('#board');
  let game = null;
  let mode = store.get('mode') || 'easy';
  let lastLevel = store.get('level') || 'easy';
  if (mode !== 'daily' && !S.LEVELS[mode]) mode = 'easy';
  if (!S.LEVELS[lastLevel]) lastLevel = 'easy';

  // ---------- theme ----------
  function setTheme(t, save) {
    document.documentElement.setAttribute('data-skin', t);
    $$('.swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.skinPick === t)));
    if (save) store.set('theme', t);
  }
  $$('.swatch').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.skinPick, true)));
  setTheme(document.documentElement.getAttribute('data-skin') || 'pastel', false);
  if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!store.get('theme')) setTheme(e.matches ? 'night' : 'pastel', false);
    });
  }

  // ---------- timer ----------
  let t0 = 0, elapsed = 0, ticking = false, raf = 0;
  const fmt = ms => {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  function tick() {
    if (!ticking) return;
    $('#timer').textContent = fmt(elapsed + performance.now() - t0);
    raf = setTimeout(tick, 250);
  }
  function startTimer() { elapsed = 0; t0 = performance.now(); ticking = true; clearTimeout(raf); tick(); }
  function stopTimer() {
    if (ticking) elapsed += performance.now() - t0;
    ticking = false; clearTimeout(raf);
    $('#timer').textContent = fmt(elapsed);
    return elapsed;
  }
  document.addEventListener('visibilitychange', () => {
    if (!game || game.won) return;
    if (document.hidden && ticking) { elapsed += performance.now() - t0; ticking = false; clearTimeout(raf); }
    else if (!document.hidden && !ticking) { t0 = performance.now(); ticking = true; tick(); }
  });

  // ---------- puzzles ----------
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load(newMode) {
    mode = newMode;
    store.set('mode', mode);
    if (mode !== 'daily') { lastLevel = mode; store.set('level', mode); }

    let lv, seed, label;
    if (mode === 'daily') {
      lv = S.LEVELS[DAILY_LEVEL];
      seed = S.hashString('shikaku-daily-' + todayKey());
      label = 'Пазл дня · ' + new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
    } else {
      lv = S.LEVELS[mode];
      seed = (Math.random() * 2 ** 32) >>> 0;
      label = lv.label + ' · ' + lv.w + '×' + lv.h;
    }
    const puzzle = S.generate(lv.w, lv.h, lv.maxArea, S.mulberry32(seed));

    if (game) game.destroy();
    game = new S.Game(board, puzzle, {
      onChange: ({ done, total }) => { $('#progress').textContent = done + ' / ' + total; },
      onWin: win,
    });
    S.current = game;
    $('#mode-label').textContent = label;
    $('#progress').textContent = '0 / ' + puzzle.clues.length;
    $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    refreshDailyChip();
    hide('#win');
    startTimer();
  }

  function refreshDailyChip() {
    $('.chip[data-mode="daily"]').classList.toggle('solved', !!store.get('daily.' + todayKey()));
  }

  function win() {
    const ms = stopTimer();
    let sub = '';
    if (mode === 'daily') {
      const key = 'daily.' + todayKey();
      if (!store.get(key)) store.set(key, String(Math.round(ms)));
      refreshDailyChip();
      sub = 'Новий пазл дня — завтра';
    } else {
      const key = 'best.' + mode;
      const prev = Number(store.get(key)) || 0;
      if (!prev || ms < prev) { store.set(key, String(Math.round(ms))); sub = prev ? 'Новий рекорд!' : 'Перший результат на цьому рівні'; }
      else sub = 'Рекорд: ' + fmt(prev);
    }
    $('#win-time').textContent = fmt(ms);
    $('#win-sub').textContent = sub;
    $('#win-next').textContent = mode === 'daily' ? 'Грати ще' : 'Наступний';
    confetti();
    setTimeout(() => show('#win'), 900);
  }

  // ---------- modals ----------
  function show(s) { $(s).hidden = false; }
  function hide(s) { $(s).hidden = true; }
  $('#win-close').addEventListener('click', () => hide('#win'));
  $('#win-next').addEventListener('click', () => load(mode === 'daily' ? lastLevel : mode));
  $('#btn-help').addEventListener('click', () => show('#help'));
  $('#help-close').addEventListener('click', () => { hide('#help'); store.set('helpSeen', '1'); });
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.hidden = true; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal').forEach(m => (m.hidden = true)); });

  // ---------- controls ----------
  $$('.chip').forEach(c => c.addEventListener('click', () => load(c.dataset.mode)));
  $('#btn-new').addEventListener('click', () => load(mode === 'daily' ? lastLevel : mode));
  $('#btn-clear').addEventListener('click', () => { if (game && !game.won) game.clear(); });

  // ---------- confetti ----------
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = $('#confetti');
    host.innerHTML = '';
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.setProperty('--c', `var(--p${1 + (i % 8)})`);
      p.style.setProperty('--x', ((Math.random() - 0.5) * 30) + 'vw');
      p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--t', (1.8 + Math.random() * 1.6) + 's');
      p.style.setProperty('--d', (Math.random() * 0.5) + 's');
      const sz = 6 + Math.random() * 8;
      p.style.width = sz + 'px'; p.style.height = sz * (0.6 + Math.random() * 0.8) + 'px';
      host.appendChild(p);
    }
    setTimeout(() => { host.innerHTML = ''; }, 4200);
  }

  load(mode);
  if (!store.get('helpSeen')) show('#help');
})();
