import * as pdfjsLib from './vendor/pdf.min.mjs';

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
  };

  const CHARS_PER_PAGE = 1500;
  const TEXT_BASE_W = 480;
  const TEXT_BASE_H = 640;

  let pageCache = new Map();      // key -> Promise<HTMLElement>
  let flipBusy = false;
  let dragAbort = new AbortController();
  // Hover-to-flip is disarmed for a short window right after a turn completes. A single
  // continuous swipe gesture that finishes a turn often carries on past the spine into the
  // next slot's own edge zone (same physical motion) — a position-based rearm would treat
  // that as a fresh gesture and immediately flip back. A time-based cooldown doesn't: it only
  // re-arms once the gesture has actually paused, so a *deliberate* later hover still works.
  let hoverCooldownUntil = 0;
  const HOVER_COOLDOWN_MS = 550;

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
      const loadingTask = pdfjsLib.getDocument({ data: buf });
      const pdf = await loadingTask.promise;
      state.mode = 'pdf';
      state.pdfDoc = pdf;
      state.numPages = pdf.numPages;
      state.textPages = [];
      state.current = 1;
      state.zoom = 1.0;
      state.thumbsRendered = false;
      clearPageCache();
      docTitle.textContent = file.name;
      openReader();
      await flatRender();
      buildThumbRailPlaceholders();
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
      const pages = paginateText(text, CHARS_PER_PAGE);
      state.mode = 'text';
      state.pdfDoc = null;
      state.textPages = pages;
      state.numPages = pages.length;
      state.current = 1;
      state.zoom = 1.0;
      state.thumbsRendered = false;
      clearPageCache();
      docTitle.textContent = file.name;
      openReader();
      await flatRender();
      buildThumbRailPlaceholders();
      hideLoading();
    } catch (err) {
      hideLoading();
      showError('could not read text file: ' + (err && err.message ? err.message : err));
    }
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
  }
  function closeReader() {
    dragAbort.abort();
    readerEl.classList.add('hidden');
    dropzone.classList.remove('hidden');
    book.innerHTML = '';
    thumbList.innerHTML = '';
    state.pdfDoc = null;
    state.mode = null;
    clearPageCache();
    fileInput.value = '';
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
    attachDragHandlers();
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

    const preload = (async () => {
      const underEl = await getPageEl(target.pages[flipIdx]);
      underLayer.innerHTML = '';
      underLayer.appendChild(underEl);
      let otherNewEl = null;
      if (otherIdx !== -1) otherNewEl = await getPageEl(target.pages[otherIdx]);
      ready = { underEl, otherNewEl };
      return ready;
    })();

    function applyFrame(t) {
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
      await preload;
      const from = currentT;
      const dist = Math.abs(toT - from);
      const duration = 120 + dist * 380;
      await animateProgress(duration, (t) => {
        const eased = easeOutCubic(t);
        applyFrame(from + (toT - from) * eased);
      });
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
        hoverCooldownUntil = performance.now() + HOVER_COOLDOWN_MS;
      }
      attachDragHandlers();
    }

    return {
      simpleParityChange: false,
      applyFrame,
      getT: () => currentT,
      commit: () => finish(1),
      cancel: () => finish(0),
    };
  }

  async function runProgrammaticFlip(dir) {
    if (flipBusy) return;
    const flip = beginFlip(dir);
    if (!flip) return;
    flipBusy = true;
    try {
      if (flip.simpleParityChange) await flip.apply();
      else await flip.commit();
    } finally {
      flipBusy = false;
    }
  }

  function goNext() { runProgrammaticFlip('next'); }
  function goPrev() { runProgrammaticFlip('prev'); }

  async function goToPage(n) {
    if (flipBusy) return;
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

    // ---- shared engage/settle helpers ----
    let liveFlip = null;
    let liveDir = null;
    let settling = false;

    function engage(dir) {
      if (flipBusy || settling || liveFlip) return null;
      const flip = beginFlip(dir);
      if (!flip || flip.simpleParityChange) return null;
      flipBusy = true;
      liveFlip = flip;
      liveDir = dir;
      slot.classList.add('dragging');
      return flip;
    }

    function settle(commit) {
      if (!liveFlip) return;
      const flip = liveFlip;
      liveFlip = null;
      liveDir = null;
      settling = true;
      slot.classList.remove('dragging');
      const p = commit ? flip.commit() : flip.cancel();
      p.finally(() => { flipBusy = false; settling = false; });
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
      if (settling) return;
      const rect = slot.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      let want = null, t = 0, zone = rect.width;

      if (allowedDirs.length === 2) {
        const half = rect.width / 2;
        if (relX >= half) { want = 'next'; t = clamp((rect.width - relX) / half, 0, 1); zone = half; }
        else { want = 'prev'; t = clamp(relX / half, 0, 1); zone = half; }
      } else if (allowedDirs.includes('next')) {
        want = 'next'; t = clamp((rect.width - relX) / rect.width, 0, 1);
      } else if (allowedDirs.includes('prev')) {
        want = 'prev'; t = clamp(relX / rect.width, 0, 1);
      }
      if (!want) return;
      const nearEdge = t <= HOVER_EDGE_FRACTION;

      if (liveFlip && liveDir !== want) settle(false);

      if (!liveFlip) {
        if (performance.now() < hoverCooldownUntil) return; // just turned a page — ignore the tail of that gesture
        if (!nearEdge) return; // too far from the edge to engage
        if (!engage(want)) return;
      }
      liveFlip.applyFrame(t);
      if (t >= HOVER_COMMIT_T) settle(true);
    }, { signal });

    async function endTouch(e) {
      if (e.pointerType !== 'touch') return;
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      if (liveFlip) settle(liveFlip.getT() > 0.35);
    }
    slot.addEventListener('pointerup', endTouch, { signal });
    slot.addEventListener('pointercancel', endTouch, { signal });
    slot.addEventListener('lostpointercapture', endTouch, { signal });

    slot.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      if (liveFlip) settle(false);
    }, { signal });
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
    if (flipBusy) return;
    state.spread = !state.spread;
    spreadToggle.classList.toggle('active', state.spread);
    flatRender();
  });

  zoomInBtn.addEventListener('click', () => {
    if (flipBusy) return;
    state.zoom = Math.min(2.5, +(state.zoom + 0.1).toFixed(2));
    updateZoomLabel();
    flatRender();
  });
  zoomOutBtn.addEventListener('click', () => {
    if (flipBusy) return;
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
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        goNext(); e.preventDefault(); break;
      case 'ArrowLeft':
      case 'PageUp':
        goPrev(); e.preventDefault(); break;
      case 'Escape':
        if (document.fullscreenElement) document.exitFullscreen();
        else closeReader();
        break;
      case 't': case 'T':
        thumbsToggle.click(); break;
      case 'f': case 'F':
        fullscreenBtn.click(); break;
      case '+': case '=':
        zoomInBtn.click(); break;
      case '-': case '_':
        zoomOutBtn.click(); break;
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (readerEl.classList.contains('hidden')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { clearPageCache(); flatRender(); }, 150);
  });

})();
