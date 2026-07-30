import * as pdfjsLib from './vendor/pdf.min.mjs';
import { SOUND_GROUPS, soundEngine } from './sound.js';
import { scanLibrary } from './library.js';
import * as forestState from './forest-state.js';
import { MindForestScene } from './forest-scene.js';
import * as pomodoro from './pomodoro.js';
import { initCelebrations, maybeShowOnboarding } from './celebrate.js';
import * as auth from './auth.js';
import * as cloudSync from './cloud-sync.js';

(() => {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

  // ---------- DOM ----------
  const dropzone = document.getElementById('dropzone');
  const dropTarget = document.getElementById('dropTarget');
  const fileBtn = document.getElementById('fileBtn');
  const fileInput = document.getElementById('fileInput');

  const readerEl = document.getElementById('reader');
  const backBtn = document.getElementById('backBtn');
  const docTitle = document.getElementById('docTitle');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const edgePrev = document.getElementById('edgePrev');
  const edgeNext = document.getElementById('edgeNext');
  const pageIndicator = document.getElementById('pageIndicator');
  const spreadToggle = document.getElementById('spreadToggle');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomLevel = document.getElementById('zoomLevel');
  const thumbsToggle = document.getElementById('thumbsToggle');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const thumbRail = document.getElementById('thumbRail');
  const thumbList = document.getElementById('thumbList');
  const book = document.getElementById('book');
  const progressFill = document.getElementById('progressFill');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  const soundToggle = document.getElementById('soundToggle');
  const soundPanel = document.getElementById('soundPanel');
  const soundOffBtn = document.getElementById('soundOffBtn');
  const soundVolume = document.getElementById('soundVolume');
  const soundGridNoise = document.getElementById('soundGridNoise');
  const soundGridNature = document.getElementById('soundGridNature');

  const librarySection = document.getElementById('librarySection');
  const libraryGrid = document.getElementById('libraryGrid');
  const libraryEmpty = document.getElementById('libraryEmpty');
  const libraryRefresh = document.getElementById('libraryRefresh');

  const streakCount = document.getElementById('streakCount');
  const streakCountLanding = document.getElementById('streakCountLanding');
  const streakLabelLanding = document.getElementById('streakLabelLanding');
  const forestTeaserCanvasSlot = document.getElementById('forestTeaserCanvasSlot');
  const forestNextLabelLanding = document.getElementById('forestNextLabelLanding');
  const forestNextFillLanding = document.getElementById('forestNextFillLanding');

  const forestToggle = document.getElementById('forestToggle');
  const forestPanel = document.getElementById('forestPanel');
  const forestPanelCanvasSlot = document.getElementById('forestPanelCanvasSlot');
  const forestGpLabel = document.getElementById('forestGpLabel');
  const forestPanelNextLabel = document.getElementById('forestPanelNextLabel');
  const forestPanelNextFill = document.getElementById('forestPanelNextFill');
  const statStreak = document.getElementById('statStreak');
  const statSessions = document.getElementById('statSessions');
  const statFocusMin = document.getElementById('statFocusMin');
  const statUnlocked = document.getElementById('statUnlocked');
  const forestExploreBtn = document.getElementById('forestExploreBtn');
  const forestExploreBtnLanding = document.getElementById('forestExploreBtnLanding');
  const forestExploreOverlay = document.getElementById('forestExploreOverlay');
  const forestExploreCanvasSlot = document.getElementById('forestExploreCanvasSlot');
  const forestExploreClose = document.getElementById('forestExploreClose');

  const pomodoroToggle = document.getElementById('pomodoroToggle');
  const pomodoroPanel = document.getElementById('pomodoroPanel');
  const pomodoroModeLabel = document.getElementById('pomodoroModeLabel');
  const pomodoroCycleLabel = document.getElementById('pomodoroCycleLabel');
  const pomodoroTime = document.getElementById('pomodoroTime');
  const pomodoroRingFill = document.getElementById('pomodoroRingFill');
  const pomodoroStartPause = document.getElementById('pomodoroStartPause');
  const pomodoroReset = document.getElementById('pomodoroReset');
  const pomodoroSkip = document.getElementById('pomodoroSkip');

  const accountToggle = document.getElementById('accountToggle');
  const accountPanel = document.getElementById('accountPanel');
  const accountSignedOutPanel = document.getElementById('accountSignedOutPanel');
  const accountSignedInPanel = document.getElementById('accountSignedInPanel');
  const accountAvatar = document.getElementById('accountAvatar');
  const accountName = document.getElementById('accountName');
  const accountEmail = document.getElementById('accountEmail');
  const googleSignInBtn = document.getElementById('googleSignInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const googleSignInBtnLanding = document.getElementById('googleSignInBtnLanding');
  const accountSignedInLanding = document.getElementById('accountSignedInLanding');
  const accountAvatarLanding = document.getElementById('accountAvatarLanding');
  const accountNameLanding = document.getElementById('accountNameLanding');
  const signOutBtnLanding = document.getElementById('signOutBtnLanding');

  // ---------- State ----------
  const state = {
    mode: null,          // 'pdf' | 'text'
    pdfDoc: null,
    numPages: 0,
    textPages: [],        // array of strings, mode='text'
    current: 1,            // left-most page index shown (1-based)
    spread: true,
    zoom: 1.0,
    thumbsRendered: false,
    forestBookKey: null,
  };

  const CHARS_PER_PAGE = 1500;
  const TEXT_BASE_W = 480;
  const TEXT_BASE_H = 640;

  let pageCache = new Map();      // key -> Promise<HTMLElement>
  let flipBusy = false;
  // Bumped every time a new flip attempt (hover-engage or programmatic) takes
  // ownership of flipBusy. A flip's own async cleanup only clears flipBusy if
  // it's still the current generation — otherwise a preempted flip's cleanup,
  // resolving late, could stomp a newer flip that has since taken over.
  let flipGeneration = 0;
  // While a hover-drag is merely "live" (engaged but not yet past the commit
  // threshold) or gracefully cancelling back to flat, it's still fully
  // abortable. Registering that abort here lets programmatic navigation
  // (keyboard, nav buttons, thumbnails, zoom) instantly preempt it instead of
  // silently doing nothing just because the mouse happens to be resting near
  // the page edge — a purely passive mouse position, not a deliberate hover
  // gesture, shouldn't be able to block every other control.
  let liveHoverAbort = null;
  function preemptFlipBusy() {
    if (!flipBusy) return true;
    if (!liveHoverAbort) return false; // a real commit is mid-flight — let it finish
    const abort = liveHoverAbort;
    liveHoverAbort = null;
    abort();
    return true;
  }
  let dragAbort = new AbortController();
  // After a hover-driven commit, the direction just committed is disarmed until the pointer
  // is observed away from that edge at least once. A single continuous swipe gesture that
  // finishes a turn often carries on past the spine into the new page's own edge zone (same
  // physical motion) — without this, that reads as a fresh gesture and immediately flips back.
  // It's position-based rather than a blanket timer so it only ever blocks that one specific
  // scenario — any other hover (a different direction, or the same direction after genuinely
  // moving away) keeps working immediately instead of going dead for a few hundred ms.
  let releaseNeededDir = null;

  // ---------- Helpers ----------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function showLoading(msg) {
    loadingText.textContent = msg || 'loading…';
    loadingOverlay.classList.remove('hidden');
  }
  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }
  function showError(msg) {
    let el = document.querySelector('.error-note');
    if (!el) {
      el = document.createElement('p');
      el.className = 'error-note';
      dropTarget.parentElement.appendChild(el);
    }
    el.textContent = msg;
  }
  function clearError() {
    const el = document.querySelector('.error-note');
    if (el) el.remove();
  }
  function clearPageCache() {
    pageCache = new Map();
  }

  // ---------- File loading ----------
  function handleFile(file) {
    if (!file) return;
    clearError();
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      loadPdf(file);
    } else if (name.endsWith('.txt') || name.endsWith('.md')) {
      loadText(file);
    } else {
      showError('unsupported file type — use .pdf, .txt or .md');
    }
  }

  async function loadPdf(file) {
    showLoading('reading pdf…');
    try {
      const buf = await file.arrayBuffer();
      await loadPdfData(file.name, buf);
      hideLoading();
    } catch (err) {
      hideLoading();
      showError('could not read pdf: ' + (err && err.message ? err.message : err));
    }
  }

  async function loadText(file) {
    showLoading('reading text…');
    try {
      const text = await file.text();
      loadTextData(file.name, text);
      hideLoading();
    } catch (err) {
      hideLoading();
      showError('could not read text file: ' + (err && err.message ? err.message : err));
    }
  }

  // core loaders — used both by direct file-picker/drop and by opening a
  // library item fetched from the library/ folder
  async function loadPdfData(name, arrayBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    state.mode = 'pdf';
    state.pdfDoc = pdf;
    state.numPages = pdf.numPages;
    state.textPages = [];
    state.current = 1;
    state.zoom = 1.0;
    state.thumbsRendered = false;
    state.forestBookKey = forestState.bookKeyFor(name, state.numPages);
    forestState.recordSessionStart(state.forestBookKey, name, 'pdf', state.numPages);
    clearPageCache();
    docTitle.textContent = name;
    openReader();
    await flatRender();
    buildThumbRailPlaceholders();
  }

  function loadTextData(name, text) {
    const pages = paginateText(text, CHARS_PER_PAGE);
    state.mode = 'text';
    state.pdfDoc = null;
    state.textPages = pages;
    state.numPages = pages.length;
    state.current = 1;
    state.zoom = 1.0;
    state.thumbsRendered = false;
    state.forestBookKey = forestState.bookKeyFor(name, state.numPages);
    forestState.recordSessionStart(state.forestBookKey, name, 'text', state.numPages);
    clearPageCache();
    docTitle.textContent = name;
    openReader();
    flatRender();
    buildThumbRailPlaceholders();
  }

  function paginateText(text, perPage) {
    const paragraphs = text.split(/\n{2,}/);
    const pages = [];
    let cur = '';
    for (const para of paragraphs) {
      if ((cur + '\n\n' + para).length > perPage && cur.length > 0) {
        pages.push(cur.trim());
        cur = para;
      } else {
        cur = cur ? cur + '\n\n' + para : para;
      }
      while (cur.length > perPage) {
        pages.push(cur.slice(0, perPage).trim());
        cur = cur.slice(perPage);
      }
    }
    if (cur.trim()) pages.push(cur.trim());
    return pages.length ? pages : [''];
  }

  // ---------- Reader open/close ----------
  function openReader() {
    dropzone.classList.add('hidden');
    readerEl.classList.remove('hidden');
    updateZoomLabel();
    if (forestScene) forestScene.stop(); // landing teaser is hidden now
  }
  function closeReader() {
    forestState.recordSessionEnd();
    dragAbort.abort();
    readerEl.classList.add('hidden');
    dropzone.classList.remove('hidden');
    book.innerHTML = '';
    thumbList.innerHTML = '';
    state.pdfDoc = null;
    state.mode = null;
    state.forestBookKey = null;
    clearPageCache();
    fileInput.value = '';
    forestHomeSlot = forestTeaserCanvasSlot;
    if (forestScene) {
      moveForestCanvasTo(forestTeaserCanvasSlot);
      forestScene.start();
    }
  }

  // ---------- Page content (cached) ----------
  function pageKey(pageNum) {
    return `${state.mode}:${pageNum}:${state.zoom}:${window.innerHeight}`;
  }

  function getPageEl(pageNum) {
    const key = pageKey(pageNum);
    if (pageCache.has(key)) return pageCache.get(key);
    const p = state.mode === 'pdf' ? renderPdfPage(pageNum) : Promise.resolve(renderTextPage(pageNum));
    pageCache.set(key, p);
    return p;
  }

  async function renderPdfPage(pageNum) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewportBase = page.getViewport({ scale: 1 });
    const targetHeight = window.innerHeight * 0.8;
    const fitScale = targetHeight / viewportBase.height;
    const scale = fitScale * state.zoom;
    const viewport = page.getViewport({ scale });

    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const ctx = canvas.getContext('2d', { alpha: false });
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
    await page.render({ canvasContext: ctx, viewport, transform }).promise;
    return canvas;
  }

  function renderTextPage(pageNum) {
    const div = document.createElement('div');
    div.className = 'text-page';
    const w = Math.round(TEXT_BASE_W * state.zoom);
    const h = Math.round(TEXT_BASE_H * state.zoom);
    div.style.width = w + 'px';
    div.style.height = h + 'px';
    div.style.fontSize = (15 * state.zoom).toFixed(1) + 'px';
    div.style.padding = `${Math.round(42 * state.zoom)}px ${Math.round(38 * state.zoom)}px`;
    div.textContent = state.textPages[pageNum - 1] || '';
    div.setAttribute('data-pagenum', pageNum + ' / ' + state.numPages);
    return div;
  }

  // ---------- Pagination logic ----------
  function pagesToShow() {
    const n = state.numPages;
    if (!state.spread) return [clamp(state.current, 1, n)];
    let c = clamp(state.current, 1, n);
    if (c === 1) return [1];
    if (c % 2 === 1) c -= 1;
    const left = c;
    const right = c + 1 <= n ? c + 1 : null;
    return right ? [left, right] : [left];
  }

  function computeTargetPages(dir) {
    const n = state.numPages;
    let simCurrent;
    if (dir === 'next') {
      if (state.spread) {
        const pages = pagesToShow();
        const last = pages[pages.length - 1];
        if (last >= n) return null;
        simCurrent = last + 1;
      } else {
        if (state.current >= n) return null;
        simCurrent = state.current + 1;
      }
    } else {
      if (state.spread) {
        const pages = pagesToShow();
        const first = pages[0];
        if (first <= 1) return null;
        simCurrent = first === 2 ? 1 : first - 2;
      } else {
        if (state.current <= 1) return null;
        simCurrent = state.current - 1;
      }
    }
    const saved = state.current;
    state.current = simCurrent;
    const pages = pagesToShow();
    state.current = saved;
    return { current: simCurrent, pages };
  }

  // ---------- Flat (non-animated) render ----------
  async function flatRender() {
    flipBusy = false;
    const pages = pagesToShow();
    book.innerHTML = '';
    const slots = pages.map((p) => {
      const slot = document.createElement('div');
      slot.className = 'page-slot';
      const under = document.createElement('div');
      under.className = 'under-layer';
      const leaf = document.createElement('div');
      leaf.className = 'leaf';
      slot.appendChild(under);
      slot.appendChild(leaf);
      book.appendChild(slot);
      return slot;
    });

    await Promise.all(pages.map(async (p, i) => {
      const el = await getPageEl(p);
      const leaf = slots[i].querySelector('.leaf');
      leaf.appendChild(el);
      slots[i].style.width = el.offsetWidth + 'px';
      slots[i].style.height = el.offsetHeight + 'px';
    }));

    updatePageIndicator();
    updateProgress();
    updateThumbActive();
    reportPageProgress();
    attachDragHandlers();
  }

  function reportPageProgress() {
    if (!state.forestBookKey) return;
    const pages = pagesToShow();
    const reached = pages[pages.length - 1];
    forestState.recordPageProgress(state.forestBookKey, reached, state.numPages);
  }

  function sizeSlotToContent(slot, el) {
    slot.style.width = el.offsetWidth + 'px';
    slot.style.height = el.offsetHeight + 'px';
  }

  function updatePageIndicator() {
    const pages = pagesToShow();
    const label = pages.length === 2 ? `${pages[0]}–${pages[1]}` : `${pages[0]}`;
    pageIndicator.textContent = `${label} / ${state.numPages}`;
  }

  function updateProgress() {
    const pages = pagesToShow();
    const p = pages[pages.length - 1];
    const pct = state.numPages <= 1 ? 100 : ((p - 1) / (state.numPages - 1)) * 100;
    progressFill.style.width = pct + '%';
  }

  function updateZoomLabel() {
    zoomLevel.textContent = Math.round(state.zoom * 100) + '%';
  }

  // ---------- Animated page-turn ----------
  function animateProgress(duration, onFrame) {
    return new Promise((resolve) => {
      if (duration <= 0) { onFrame(1); resolve(); return; }
      const start = performance.now();
      function step(now) {
        const t = clamp((now - start) / duration, 0, 1);
        onFrame(t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  function beginFlip(dir) {
    const target = computeTargetPages(dir);
    if (!target) return null;
    const curPages = pagesToShow();

    if (target.pages.length !== curPages.length) {
      return {
        simpleParityChange: true,
        apply: async () => { state.current = target.current; await flatRender(); },
      };
    }

    const slots = Array.from(book.children);
    const flipIdx = dir === 'next' ? curPages.length - 1 : 0;
    const otherIdx = curPages.length === 2 ? (flipIdx === 0 ? 1 : 0) : -1;
    const flipSlot = slots[flipIdx];
    const otherSlot = otherIdx !== -1 ? slots[otherIdx] : null;
    const leaf = flipSlot.querySelector('.leaf');
    const underLayer = flipSlot.querySelector('.under-layer');
    const origOtherEl = otherSlot ? otherSlot.querySelector('.leaf').firstElementChild : null;

    leaf.classList.add('flipping');
    leaf.style.transformOrigin = dir === 'next' ? 'left center' : 'right center';
    const sign = dir === 'next' ? -1 : 1;
    const maxDeg = 172;

    let swapped = false;
    let currentT = 0;
    let ready = null;
    let dead = false; // set by abortImmediate() when a fresher gesture instantly supersedes this one

    const preload = (async () => {
      const underEl = await getPageEl(target.pages[flipIdx]);
      if (dead) return null;
      underLayer.innerHTML = '';
      underLayer.appendChild(underEl);
      let otherNewEl = null;
      if (otherIdx !== -1) otherNewEl = await getPageEl(target.pages[otherIdx]);
      if (dead) return null;
      ready = { underEl, otherNewEl };
      return ready;
    })();

    function applyFrame(t) {
      if (dead) return;
      currentT = clamp(t, 0, 1);
      leaf.style.transform = `rotateY(${sign * maxDeg * currentT}deg)`;
      leaf.style.filter = `brightness(${(1 - Math.sin(Math.min(currentT, 1) * Math.PI) * 0.42).toFixed(3)})`;
      if (ready && otherSlot) {
        if (!swapped && currentT > 0.5 && ready.otherNewEl) {
          swapped = true;
          const otherLeaf = otherSlot.querySelector('.leaf');
          otherLeaf.innerHTML = '';
          otherLeaf.appendChild(ready.otherNewEl);
        } else if (swapped && currentT <= 0.5) {
          swapped = false;
          const otherLeaf = otherSlot.querySelector('.leaf');
          otherLeaf.innerHTML = '';
          if (origOtherEl) otherLeaf.appendChild(origOtherEl);
        }
      }
    }

    async function finish(toT) {
      if (dead) return;
      await preload;
      if (dead) return;
      const from = currentT;
      const dist = Math.abs(toT - from);
      const duration = 120 + dist * 380;
      await animateProgress(duration, (t) => {
        const eased = easeOutCubic(t);
        applyFrame(from + (toT - from) * eased);
      });
      if (dead) return;
      leaf.classList.remove('flipping');
      leaf.style.transform = '';
      leaf.style.filter = '';
      underLayer.innerHTML = '';

      if (toT >= 1) {
        state.current = target.current;
        leaf.innerHTML = '';
        leaf.appendChild(ready.underEl);
        sizeSlotToContent(flipSlot, ready.underEl);
        if (otherSlot && ready.otherNewEl) sizeSlotToContent(otherSlot, ready.otherNewEl);
        updatePageIndicator();
        updateProgress();
        updateThumbActive();
        reportPageProgress();
      }
      attachDragHandlers();
    }

    // instantly drop this flip with no animation — used when a fresh gesture
    // (a new direction, a resize, the window losing focus) needs to take over
    // right now rather than waiting out a graceful tween
    function abortImmediate() {
      if (dead) return;
      dead = true;
      leaf.classList.remove('flipping');
      leaf.style.transform = '';
      leaf.style.filter = '';
      underLayer.innerHTML = '';
    }

    return {
      simpleParityChange: false,
      applyFrame,
      getT: () => currentT,
      commit: () => finish(1),
      cancel: () => finish(0),
      abortImmediate,
    };
  }

  async function runProgrammaticFlip(dir) {
    const preempted = preemptFlipBusy();
    if (!preempted) return;
    const flip = beginFlip(dir);
    if (!flip) return;
    flipBusy = true;
    const gen = ++flipGeneration;
    try {
      if (flip.simpleParityChange) await flip.apply();
      else await flip.commit();
    } finally {
      if (flipGeneration === gen) flipBusy = false;
    }
  }

  function goNext() { runProgrammaticFlip('next'); }
  function goPrev() { runProgrammaticFlip('prev'); }

  async function goToPage(n) {
    if (!preemptFlipBusy()) return;
    state.current = clamp(n, 1, state.numPages);
    await flatRender();
  }

  // ---------- Drag-to-turn ----------
  function attachDragHandlers() {
    dragAbort.abort();
    dragAbort = new AbortController();
    const signal = dragAbort.signal;
    const slots = Array.from(book.children);
    if (!slots.length) return;

    const nt = computeTargetPages('next');
    const pt = computeTargetPages('prev');
    const curLen = pagesToShow().length;
    const nextOk = !!nt && nt.pages.length === curLen;
    const prevOk = !!pt && pt.pages.length === curLen;

    const rightSlot = slots[slots.length - 1];
    const leftSlot = slots[0];

    if (slots.length === 2) {
      if (nextOk) attachSlotDrag(rightSlot, ['next'], signal);
      if (prevOk) attachSlotDrag(leftSlot, ['prev'], signal);
    } else {
      const dirs = [];
      if (nextOk) dirs.push('next');
      if (prevOk) dirs.push('prev');
      if (dirs.length) attachSlotDrag(rightSlot, dirs, signal);
    }
  }

  const HOVER_EDGE_FRACTION = 0.35; // how close to the edge a hover must start within to engage
  const HOVER_COMMIT_T = 0.92;      // hover progress past which the turn auto-completes

  function attachSlotDrag(slot, allowedDirs, signal) {
    slot.classList.add('draggable');

    // ---- shared engage/commit/cancel helpers ----
    let liveFlip = null;
    let liveDir = null;
    let committing = false; // a hover-commit is animating to completion — let it finish untouched

    // Starts (or, for a hover already mid-drag in a different direction,
    // instantly replaces) a flip. Direction switches are synchronous — no
    // waiting on an animation — so hovering back and forth near the spine
    // always feels immediately responsive instead of occasionally "sticking."
    function engage(dir) {
      if (committing) return null;
      if (releaseNeededDir === dir) return null;
      if (liveFlip) {
        if (liveDir === dir) return liveFlip;
        liveFlip.abortImmediate();
        liveFlip = null;
        liveDir = null;
      } else if (flipBusy && !preemptFlipBusy()) {
        // flipBusy can still be true here even with no liveFlip of our own —
        // e.g. this same slot's *own* graceful cancel-back animation is still
        // easing to flat after an earlier direction switch. preemptFlipBusy
        // instantly drops that (or any other still-abortable hover state) so
        // a clearly-wanted new direction never has to wait out someone else's
        // tween; it only refuses when a genuine commit is irreversibly
        // mid-flight, which is the one case that should stay uninterrupted.
        return null;
      }
      const flip = beginFlip(dir);
      if (!flip || flip.simpleParityChange) return null;
      flipBusy = true;
      const gen = ++flipGeneration;
      liveFlip = flip;
      liveDir = dir;
      liveHoverAbort = () => cancelLive(false);
      slot.classList.add('dragging');
      liveFlip.gen = gen;
      return flip;
    }

    function commitLive() {
      if (!liveFlip) return;
      const flip = liveFlip;
      const dir = liveDir;
      const gen = flip.gen;
      committing = true;
      liveFlip = null;
      liveDir = null;
      liveHoverAbort = null; // genuinely committing now — let it finish rather than snap-cancelling mid-animation
      slot.classList.remove('dragging');
      releaseNeededDir = dir;
      flip.commit().finally(() => {
        if (flipGeneration !== gen) return; // a newer gesture has since taken over — don't stomp its state
        flipBusy = false;
        committing = false;
      });
    }

    function cancelLive(animated) {
      if (!liveFlip) return;
      const flip = liveFlip;
      const gen = flip.gen;
      liveFlip = null;
      liveDir = null;
      slot.classList.remove('dragging');
      if (!animated) {
        if (flipGeneration === gen) liveHoverAbort = null;
        flip.abortImmediate();
        if (flipGeneration === gen) flipBusy = false;
        return;
      }
      // still fully preemptable while it eases back to flat
      liveHoverAbort = () => {
        flip.abortImmediate();
        if (flipGeneration === gen) flipBusy = false;
      };
      flip.cancel().finally(() => {
        if (flipGeneration !== gen) return; // a newer gesture has since taken over — don't stomp its state
        liveHoverAbort = null;
        flipBusy = false;
      });
    }

    // ---- touch: press-and-drag (touchscreens have no hover) ----
    let pointerId = null;
    let startX = 0;
    let width = slot.offsetWidth || 400;

    slot.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (flipBusy) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      width = slot.offsetWidth || 400;
      try { slot.setPointerCapture(pointerId); } catch (err) {}
    }, { signal });

    slot.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        if (!liveFlip) {
          if (Math.abs(dx) < 6) return;
          const want = dx < 0 ? 'next' : 'prev';
          if (!allowedDirs.includes(want)) return;
          if (!engage(want)) return;
        }
        const t = clamp(Math.abs(dx) / width, 0, 1);
        liveFlip.applyFrame(t);
        e.preventDefault();
        return;
      }

      // ---- mouse / pen: hover-driven, no press required ----
      const rect = slot.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      let want = null, t = 0;

      if (allowedDirs.length === 2) {
        const half = rect.width / 2;
        if (relX >= half) { want = 'next'; t = clamp((rect.width - relX) / half, 0, 1); }
        else { want = 'prev'; t = clamp(relX / half, 0, 1); }
      } else if (allowedDirs.includes('next')) {
        want = 'next'; t = clamp((rect.width - relX) / rect.width, 0, 1);
      } else if (allowedDirs.includes('prev')) {
        want = 'prev'; t = clamp(relX / rect.width, 0, 1);
      }
      if (!want) { cancelLive(true); return; }

      const nearEdge = t <= HOVER_EDGE_FRACTION;
      if (releaseNeededDir === want && !nearEdge) releaseNeededDir = null;

      if (liveFlip && liveDir !== want) {
        if (!nearEdge || !engage(want)) { cancelLive(true); return; }
      } else if (!liveFlip) {
        if (!nearEdge) return;
        if (!engage(want)) return;
      }
      liveFlip.applyFrame(t);
      if (t >= HOVER_COMMIT_T) commitLive();
    }, { signal });

    async function endTouch(e) {
      if (e.pointerType !== 'touch') return;
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      if (!liveFlip) return;
      if (liveFlip.getT() > 0.35) commitLive(); else cancelLive(true);
    }
    slot.addEventListener('pointerup', endTouch, { signal });
    slot.addEventListener('pointercancel', endTouch, { signal });
    slot.addEventListener('lostpointercapture', endTouch, { signal });

    slot.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      // Leaving the slot entirely is at least as clear a "moved away from the
      // edge" signal as pausing mid-slot — without this, a hover that exits
      // straight off the page edge (the common case) rather than drifting
      // back toward the center first would leave the just-committed
      // direction disarmed indefinitely, since the pointermove-based release
      // check never gets another event on this slot to notice the change.
      releaseNeededDir = null;
      cancelLive(true);
    }, { signal });

    // Safety net: if the window loses focus mid-hover (alt-tab, a devtools
    // click, an OS dialog), no pointerleave will ever fire to clean up — so
    // without this, flipBusy could stay stuck true and every other control
    // (arrow keys, nav buttons, thumbnails) would silently stop responding
    // until the pointer happened to cross this slot again.
    window.addEventListener('blur', () => { if (liveFlip) cancelLive(false); }, { signal });
  }

  // ---------- Thumbnails ----------
  function buildThumbRailPlaceholders() {
    thumbList.innerHTML = '';
    for (let i = 1; i <= state.numPages; i++) {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.page = i;
      const num = document.createElement('span');
      num.className = 'thumb-num';
      num.textContent = i;
      item.appendChild(num);
      item.addEventListener('click', () => goToPage(i));
      thumbList.appendChild(item);
    }
    updateThumbActive();
  }

  async function renderThumbsIfNeeded() {
    if (state.thumbsRendered) return;
    state.thumbsRendered = true;
    const outputScale = window.devicePixelRatio || 1;
    const items = Array.from(thumbList.children);
    for (const item of items) {
      const pageNum = parseInt(item.dataset.page, 10);
      if (state.mode === 'pdf') {
        try {
          const page = await state.pdfDoc.getPage(pageNum);
          const vp = page.getViewport({ scale: 1 });
          const scale = 120 / vp.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = Math.floor(viewport.width) + 'px';
          canvas.style.height = Math.floor(viewport.height) + 'px';
          const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
          item.insertBefore(canvas, item.firstChild);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform }).promise;
        } catch (e) { /* skip broken page */ }
      } else {
        const mini = document.createElement('div');
        mini.style.background = '#f2ede3';
        mini.style.color = '#333';
        mini.style.fontSize = '5px';
        mini.style.padding = '4px';
        mini.style.height = '160px';
        mini.style.overflow = 'hidden';
        mini.style.fontFamily = 'Georgia, serif';
        mini.textContent = (state.textPages[pageNum - 1] || '').slice(0, 400);
        item.insertBefore(mini, item.firstChild);
      }
    }
  }

  function updateThumbActive() {
    const pages = pagesToShow();
    Array.from(thumbList.children).forEach(item => {
      const p = parseInt(item.dataset.page, 10);
      item.classList.toggle('active', pages.includes(p));
    });
    const activeItem = thumbList.querySelector('.thumb-item.active');
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Ambient sound ----------
  const SOUND_ID_KEY = 'zine.sound.id';
  const SOUND_VOL_KEY = 'zine.sound.volume';

  function loadSoundPrefs() {
    let vol = 0.45;
    try {
      const raw = localStorage.getItem(SOUND_VOL_KEY);
      if (raw !== null) vol = clamp(parseFloat(raw), 0, 1);
    } catch (e) { /* localStorage unavailable (private mode etc) */ }
    soundEngine.volume = vol;
    soundVolume.value = String(Math.round(vol * 100));
    let lastId = null;
    try { lastId = localStorage.getItem(SOUND_ID_KEY); } catch (e) {}
    return lastId;
  }

  function saveSoundPrefs() {
    try {
      localStorage.setItem(SOUND_VOL_KEY, String(soundEngine.volume));
      localStorage.setItem(SOUND_ID_KEY, soundEngine.currentId || '');
    } catch (e) { /* ignore */ }
  }

  function buildSoundPanel(recentId) {
    const containers = { noise: soundGridNoise, nature: soundGridNature };
    SOUND_GROUPS.forEach((group) => {
      const container = containers[group.id];
      if (!container) return;
      group.sounds.forEach((sound) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'sound-card';
        card.dataset.soundId = sound.id;
        if (sound.id === recentId) card.classList.add('recent');
        card.innerHTML = `
          <span class="sound-card-icon">${sound.icon}</span>
          <span class="sound-card-label">${sound.label}</span>
          <span class="sound-card-eq"><i></i><i></i><i></i></span>
        `;
        card.addEventListener('click', () => selectSound(sound.id));
        container.appendChild(card);
      });
    });
  }

  function updateSoundCardStates() {
    soundPanel.querySelectorAll('.sound-card').forEach((card) => {
      card.classList.toggle('playing', card.dataset.soundId === soundEngine.currentId);
    });
    soundToggle.classList.toggle('active', !!soundEngine.currentId);
  }

  function selectSound(id) {
    if (soundEngine.currentId === id) {
      soundEngine.stop();
    } else {
      soundEngine.play(id);
    }
    updateSoundCardStates();
    saveSoundPrefs();
  }

  function stopSound() {
    soundEngine.stop();
    updateSoundCardStates();
    saveSoundPrefs();
  }

  function openSoundPanel() {
    soundPanel.classList.remove('hidden');
    soundToggle.setAttribute('aria-expanded', 'true');
  }
  function closeSoundPanel() {
    soundPanel.classList.add('hidden');
    soundToggle.setAttribute('aria-expanded', 'false');
  }
  function isSoundPanelOpen() { return !soundPanel.classList.contains('hidden'); }

  soundToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isSoundPanelOpen()) closeSoundPanel(); else openSoundPanel();
  });
  soundPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (isSoundPanelOpen()) closeSoundPanel(); });

  soundOffBtn.addEventListener('click', stopSound);
  soundVolume.addEventListener('input', () => {
    soundEngine.setVolume(soundVolume.value / 100);
    saveSoundPrefs();
  });

  buildSoundPanel(loadSoundPrefs());
  updateSoundCardStates();

  // ---------- Mind Forest ----------
  let forestScene = null;
  let forestHomeSlot = forestTeaserCanvasSlot; // where the scene returns to once the explore modal closes

  function ensureForestScene() {
    if (forestScene) return forestScene;
    forestScene = new MindForestScene();
    forestTeaserCanvasSlot.appendChild(forestScene.el);
    forestScene.setUnlockedItems(forestState.getUnlockedItems());
    resizeForestScene();
    return forestScene;
  }

  function resizeForestScene() {
    if (!forestScene) return;
    const rect = forestScene.el.parentElement.getBoundingClientRect();
    forestScene.setSize(rect.width, rect.height);
  }

  function moveForestCanvasTo(slotEl) {
    if (!forestScene || forestScene.el.parentElement === slotEl) return;
    slotEl.appendChild(forestScene.el);
    requestAnimationFrame(resizeForestScene);
  }

  function updateForestUI() {
    const stats = forestState.getStats();
    const progress = forestState.getProgress();

    streakCount.textContent = String(stats.streak);
    streakCountLanding.textContent = String(stats.streak);
    document.querySelectorAll('.streak-badge').forEach((b) => b.classList.toggle('lit', stats.streak > 0));
    streakLabelLanding.textContent = stats.streak > 0 ? 'day streak' : 'start a streak today';

    forestGpLabel.textContent = `${stats.gp} gp`;
    statStreak.textContent = String(stats.streak);
    statSessions.textContent = String(stats.totalSessions);
    statFocusMin.textContent = String(stats.totalFocusMinutes);
    statUnlocked.textContent = String(stats.unlockedCount);

    const nextLabel = `${progress.nextLabel} in ${progress.remaining} gp`;
    forestNextLabelLanding.textContent = nextLabel;
    forestPanelNextLabel.textContent = nextLabel;
    const pct = `${Math.round(progress.pct * 100)}%`;
    forestNextFillLanding.style.width = pct;
    forestPanelNextFill.style.width = pct;

    if (forestScene) forestScene.setUnlockedItems(forestState.getUnlockedItems());
  }

  function isForestPanelOpen() { return !forestPanel.classList.contains('hidden'); }
  function openForestPanel() {
    ensureForestScene();
    forestPanel.classList.remove('hidden');
    forestToggle.setAttribute('aria-expanded', 'true');
    forestHomeSlot = forestPanelCanvasSlot;
    moveForestCanvasTo(forestPanelCanvasSlot);
    if (forestScene) forestScene.start();
    updateForestUI();
  }
  function closeForestPanel() {
    forestPanel.classList.add('hidden');
    forestToggle.setAttribute('aria-expanded', 'false');
    forestHomeSlot = forestTeaserCanvasSlot;
    if (!isForestExploreOpen()) moveForestCanvasTo(forestTeaserCanvasSlot);
    if (forestScene && !readerEl.classList.contains('hidden') && !isForestExploreOpen()) forestScene.stop();
  }

  forestToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isForestPanelOpen()) closeForestPanel(); else openForestPanel();
  });
  forestPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (isForestPanelOpen()) closeForestPanel(); });

  // ---------- Mind Forest: explore modal ----------
  // a bigger, dedicated space to pan around, tap trees for their story, and
  // drag things to a new spot — the small panel/teaser previews aren't a
  // comfortable place to do that precisely
  function isForestExploreOpen() { return !forestExploreOverlay.classList.contains('hidden'); }
  function openForestExplore() {
    ensureForestScene();
    forestExploreOverlay.classList.remove('hidden');
    moveForestCanvasTo(forestExploreCanvasSlot);
    forestScene.start();
    updateForestUI();
  }
  function closeForestExplore() {
    forestExploreOverlay.classList.add('hidden');
    moveForestCanvasTo(forestHomeSlot);
    const readerOpen = !readerEl.classList.contains('hidden');
    const homeVisible = forestHomeSlot === forestTeaserCanvasSlot ? !readerOpen : isForestPanelOpen();
    if (forestScene && !homeVisible) forestScene.stop();
  }
  forestExploreBtn.addEventListener('click', (e) => { e.stopPropagation(); openForestExplore(); });
  forestExploreBtnLanding.addEventListener('click', (e) => { e.stopPropagation(); openForestExplore(); });
  forestExploreClose.addEventListener('click', () => closeForestExplore());
  forestExploreOverlay.addEventListener('click', (e) => { if (e.target === forestExploreOverlay) closeForestExplore(); });
  // the explore modal can be open from the landing page too, where the
  // reader's (reader-only) keydown handler never runs — so it needs its own
  // always-on Escape handling rather than sharing the reader's Escape case
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isForestExploreOpen()) closeForestExplore();
  });

  forestState.onForestEvent((event) => {
    updateForestUI();
    if (event.type === 'streak') {
      document.querySelectorAll('.streak-badge').forEach((b) => {
        b.classList.remove('bump');
        void b.offsetWidth;
        b.classList.add('bump');
      });
    }
  });

  // the landing teaser is the forest's permanent home whenever the reader is closed
  ensureForestScene();
  updateForestUI();
  if (forestScene) forestScene.start();

  window.addEventListener('resize', () => resizeForestScene());

  // ---------- Pomodoro ----------
  const POMODORO_RING_CIRC = 2 * Math.PI * 44;

  function pomodoroDurationMs(mode) {
    const s = pomodoro.getSettings();
    if (mode === 'focus') return s.focusMin * 60000;
    if (mode === 'long-break') return s.longMin * 60000;
    return s.shortMin * 60000;
  }

  function pomodoroModeLabelText(mode) {
    if (mode === 'focus') return 'focus';
    if (mode === 'long-break') return 'long break';
    return 'short break';
  }

  function updatePomodoroUI() {
    const mode = pomodoro.getMode();
    const remaining = pomodoro.getRemainingMs();
    const total = pomodoroDurationMs(mode);
    const frac = total > 0 ? clamp(remaining / total, 0, 1) : 0;
    const running = pomodoro.isRunning();

    pomodoroTime.textContent = pomodoro.formatTime(remaining);
    pomodoroModeLabel.textContent = pomodoroModeLabelText(mode);
    pomodoroModeLabel.className = `pomodoro-mode-label mode-${mode}`;
    pomodoroRingFill.classList.toggle('mode-break', mode !== 'focus');
    pomodoroRingFill.style.strokeDashoffset = String(POMODORO_RING_CIRC * (1 - frac));
    pomodoroCycleLabel.textContent = `#${pomodoro.getCyclesCompleted() + 1}`;
    pomodoroStartPause.textContent = running ? 'pause' : 'start';
    pomodoroToggle.classList.toggle('active', running);
  }

  function isPomodoroPanelOpen() { return !pomodoroPanel.classList.contains('hidden'); }
  function openPomodoroPanel() {
    pomodoroPanel.classList.remove('hidden');
    pomodoroToggle.setAttribute('aria-expanded', 'true');
    updatePomodoroUI();
  }
  function closePomodoroPanel() {
    pomodoroPanel.classList.add('hidden');
    pomodoroToggle.setAttribute('aria-expanded', 'false');
  }

  pomodoroToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPomodoroPanelOpen()) closePomodoroPanel(); else openPomodoroPanel();
  });
  pomodoroPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (isPomodoroPanelOpen()) closePomodoroPanel(); });

  pomodoroStartPause.addEventListener('click', () => {
    if (pomodoro.isRunning()) pomodoro.pause(); else pomodoro.start();
    updatePomodoroUI();
  });
  pomodoroReset.addEventListener('click', () => { pomodoro.reset(); updatePomodoroUI(); });
  pomodoroSkip.addEventListener('click', () => { pomodoro.skip(); updatePomodoroUI(); });

  pomodoro.onPomodoroEvent(() => updatePomodoroUI());
  setInterval(updatePomodoroUI, 250);
  updatePomodoroUI();

  // ---------- Celebrations & onboarding ----------
  initCelebrations();
  maybeShowOnboarding();

  // ---------- Micro-interactions: button press ripple ----------
  function attachRipple(el) {
    el.addEventListener('pointerdown', (e) => {
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });
  }
  document.querySelectorAll('.icon-btn, .btn-primary, .pomodoro-side-btn, .sound-off-btn, .library-refresh, .forest-explore-btn')
    .forEach(attachRipple);

  // ---------- Library ----------
  const EXT_ICON = { pdf: '▤', txt: '☰', md: '☰' };
  let libraryBusy = false;

  async function initLibrary() {
    libraryGrid.innerHTML = '';
    libraryEmpty.classList.add('hidden');
    const items = await scanLibrary();
    if (items === null) {
      librarySection.classList.add('hidden');
      return;
    }
    librarySection.classList.remove('hidden');
    if (!items.length) {
      libraryEmpty.classList.remove('hidden');
      return;
    }
    items.forEach((item, i) => renderLibraryCard(item, i));
  }

  function renderLibraryCard(item, index) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'library-card';
    card.style.setProperty('--i', index);
    card.title = item.title;

    const cover = document.createElement('div');
    cover.className = 'library-cover loading';
    const badge = document.createElement('span');
    badge.className = 'library-badge';
    badge.textContent = item.ext.toUpperCase();
    cover.appendChild(badge);

    const titleEl = document.createElement('span');
    titleEl.className = 'library-card-title';
    titleEl.textContent = item.title;

    card.appendChild(cover);
    card.appendChild(titleEl);
    libraryGrid.appendChild(card);

    card.addEventListener('click', () => openLibraryItem(item, card));
    generateLibraryCover(item, cover);
  }

  async function generateLibraryCover(item, coverEl) {
    try {
      if (item.ext === 'pdf') {
        const res = await fetch(item.url, { cache: 'no-store' });
        const buf = await res.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const scale = 220 / vp.width;
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform }).promise;
        coverEl.insertBefore(canvas, coverEl.firstChild);
      } else {
        const res = await fetch(item.url, { cache: 'no-store' });
        const text = await res.text();
        const snippet = document.createElement('div');
        snippet.className = 'library-text-preview';
        snippet.textContent = text.slice(0, 260);
        coverEl.insertBefore(snippet, coverEl.firstChild);
      }
    } catch (e) {
      const fallback = document.createElement('div');
      fallback.className = 'library-cover-fallback';
      fallback.textContent = EXT_ICON[item.ext] || '▤';
      coverEl.insertBefore(fallback, coverEl.firstChild);
    }
    coverEl.classList.remove('loading');
  }

  async function openLibraryItem(item, card) {
    if (libraryBusy || flipBusy) return;
    libraryBusy = true;
    card.classList.add('opening');
    clearError();
    showLoading(`opening ${item.title}…`);
    try {
      const res = await fetch(item.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      if (item.ext === 'pdf') {
        const buf = await res.arrayBuffer();
        await loadPdfData(item.name, buf);
      } else {
        const text = await res.text();
        loadTextData(item.name, text);
      }
      hideLoading();
    } catch (err) {
      hideLoading();
      showError(`could not open "${item.title}": ` + (err && err.message ? err.message : err));
    } finally {
      libraryBusy = false;
      card.classList.remove('opening');
    }
  }

  libraryRefresh.addEventListener('click', () => initLibrary());
  initLibrary();

  // ---------- Controls ----------
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  ['dragenter', 'dragover'].forEach(evt =>
    dropTarget.addEventListener(evt, (e) => {
      e.preventDefault();
      dropTarget.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropTarget.addEventListener(evt, (e) => {
      e.preventDefault();
      dropTarget.classList.remove('drag-over');
    })
  );
  dropTarget.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!readerEl.classList.contains('hidden')) return;
    e.preventDefault();
  });

  backBtn.addEventListener('click', closeReader);
  prevBtn.addEventListener('click', goPrev);
  nextBtn.addEventListener('click', goNext);
  edgePrev.addEventListener('click', goPrev);
  edgeNext.addEventListener('click', goNext);

  spreadToggle.addEventListener('click', () => {
    if (!preemptFlipBusy()) return;
    state.spread = !state.spread;
    spreadToggle.classList.toggle('active', state.spread);
    flatRender();
  });

  zoomInBtn.addEventListener('click', () => {
    if (!preemptFlipBusy()) return;
    state.zoom = Math.min(2.5, +(state.zoom + 0.1).toFixed(2));
    updateZoomLabel();
    flatRender();
  });
  zoomOutBtn.addEventListener('click', () => {
    if (!preemptFlipBusy()) return;
    state.zoom = Math.max(0.4, +(state.zoom - 0.1).toFixed(2));
    updateZoomLabel();
    flatRender();
  });

  thumbsToggle.addEventListener('click', async () => {
    thumbRail.classList.toggle('hidden');
    thumbsToggle.classList.toggle('active');
    if (!thumbRail.classList.contains('hidden')) {
      await renderThumbsIfNeeded();
    }
  });

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  window.addEventListener('keydown', (e) => {
    if (readerEl.classList.contains('hidden')) return;
    if (isForestExploreOpen()) return; // the explore modal owns keyboard input while open
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        goNext(); e.preventDefault(); break;
      case 'ArrowLeft':
      case 'PageUp':
        goPrev(); e.preventDefault(); break;
      case 'Escape':
        if (isSoundPanelOpen()) closeSoundPanel();
        else if (isForestPanelOpen()) closeForestPanel();
        else if (isPomodoroPanelOpen()) closePomodoroPanel();
        else if (document.fullscreenElement) document.exitFullscreen();
        else closeReader();
        break;
      case 't': case 'T':
        thumbsToggle.click(); break;
      case 'f': case 'F':
        fullscreenBtn.click(); break;
      case 's': case 'S':
        soundToggle.click(); break;
      case 'g': case 'G':
        forestToggle.click(); break;
      case 'p': case 'P':
        pomodoroToggle.click(); break;
      case '+': case '=':
        zoomInBtn.click(); break;
      case '-': case '_':
        zoomOutBtn.click(); break;
    }
  });

  // ---------- Account ----------
  function isAccountPanelOpen() { return !accountPanel.classList.contains('hidden'); }
  function openAccountPanel() {
    accountPanel.classList.remove('hidden');
    accountToggle.setAttribute('aria-expanded', 'true');
  }
  function closeAccountPanel() {
    accountPanel.classList.add('hidden');
    accountToggle.setAttribute('aria-expanded', 'false');
  }
  accountToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isAccountPanelOpen()) closeAccountPanel(); else openAccountPanel();
  });
  accountPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (isAccountPanelOpen()) closeAccountPanel(); });

  function updateAccountUI(session) {
    const user = session ? session.user : null;
    const signedIn = !!user;
    accountSignedOutPanel.classList.toggle('hidden', signedIn);
    accountSignedInPanel.classList.toggle('hidden', !signedIn);
    googleSignInBtnLanding.classList.toggle('hidden', signedIn);
    accountSignedInLanding.classList.toggle('hidden', !signedIn);
    accountToggle.classList.toggle('active', signedIn);

    if (signedIn) {
      const meta = user.user_metadata || {};
      const name = meta.full_name || meta.name || user.email || 'reader';
      const avatarUrl = meta.avatar_url || '';
      accountName.textContent = name;
      accountEmail.textContent = user.email || '';
      accountNameLanding.textContent = name;
      [accountAvatar, accountAvatarLanding].forEach((img) => {
        if (avatarUrl) { img.src = avatarUrl; img.style.visibility = 'visible'; }
        else { img.removeAttribute('src'); img.style.visibility = 'hidden'; }
      });
    }
  }

  function handleSignIn() {
    auth.signInWithGoogle().catch((err) => {
      showError('sign-in failed: ' + (err && err.message ? err.message : err));
    });
  }
  googleSignInBtn.addEventListener('click', handleSignIn);
  googleSignInBtnLanding.addEventListener('click', handleSignIn);

  function handleSignOut() {
    closeAccountPanel();
    auth.signOut();
  }
  signOutBtn.addEventListener('click', handleSignOut);
  signOutBtnLanding.addEventListener('click', handleSignOut);

  // Reconcile once per transition into signed-in (covers both a fresh
  // Google sign-in and rehydrating a persisted session on page load) — never
  // on every auth-state ping, which would otherwise re-run the cloud fetch
  // on unrelated token refreshes.
  let wasSignedIn = false;
  auth.onAuthChange((session) => {
    updateAccountUI(session);
    const signedIn = !!session;
    if (signedIn && !wasSignedIn) {
      cloudSync.fetchCloudTotals().then((totals) => {
        if (totals) forestState.reconcileFromCloud(totals);
      });
    }
    wasSignedIn = signedIn;
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (readerEl.classList.contains('hidden')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function tick() {
      // a live hover-flip owns the current DOM (its leaf/under-layer elements) —
      // wiping the book out from under it here would silently strand it with
      // flipBusy stuck true, locking out every other control. Wait it out instead.
      if (flipBusy) { resizeTimer = setTimeout(tick, 120); return; }
      clearPageCache();
      flatRender();
    }, 150);
  });

})();
