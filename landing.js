// The marketing landing page: scroll-reveal, nav/CTA smooth-scrolling, the
// tiny growth-stage and ambience-preview demos. Deliberately independent of
// app.js — it only touches the new marketing sections (plus sound.js
// directly, for the "tap to hear it" ambience cards), so none of the reader
// logic needs to know this page exists.
import { SOUND_GROUPS, soundEngine } from './sound.js';

(() => {
  'use strict';

  const dropzone = document.getElementById('dropzone');
  if (!dropzone) return;

  // ---------- smooth-scroll for in-page nav links ----------
  document.querySelectorAll('.landing-nav-links a, .hero-scroll-cue').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ---------- scroll-reveal ----------
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in-view'));
  }

  // ---------- hero parallax (art layer drifts slower than the page scrolls) ----------
  const heroArt = document.querySelector('.hero-art');
  const heroDecor = document.querySelector('.hero-decor');
  const hero = document.getElementById('hero');
  if (heroArt && hero) {
    let ticking = false;
    dropzone.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        // only while the hero is at least partly on screen — no cost once scrolled past
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          const past = -rect.top;
          heroArt.style.transform = `translateY(${past * 0.12}px)`;
          if (heroDecor) heroDecor.style.transform = `translateY(${past * 0.22}px)`;
        }
        ticking = false;
      });
    }, { passive: true });
  }

  // ---------- Mind Forest growth demo: cycles through its stages on a loop ----------
  const growthItems = document.querySelectorAll('.growth-demo-item');
  const growthCaption = document.getElementById('growthDemoCaption');
  const GROWTH_CAPTIONS = ['seed planted', 'sapling takes root', 'young tree', 'wildlife arrives', 'mature grove'];
  if (growthItems.length) {
    let stage = 0;
    setInterval(() => {
      stage = (stage + 1) % growthItems.length;
      growthItems.forEach((el, i) => el.classList.toggle('active', i === stage));
      if (growthCaption) growthCaption.textContent = GROWTH_CAPTIONS[stage] || '';
    }, 1900);
  }

  // ---------- Ambience preview grid: real, playable previews of sound.js ----------
  const grid = document.getElementById('ambiencePreviewGrid');
  if (grid) {
    const ambienceGroup = SOUND_GROUPS.find((g) => g.id === 'ambience');
    const sounds = ambienceGroup ? ambienceGroup.sounds : [];
    sounds.forEach((sound) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ambience-preview-card';
      card.innerHTML = `
        <span class="ambience-preview-icon">${sound.icon}</span>
        <span class="ambience-preview-label">${sound.label}</span>
        <span class="ambience-preview-eq"><i></i><i></i><i></i></span>
      `;
      card.addEventListener('click', () => {
        const wasPlaying = card.classList.contains('playing');
        grid.querySelectorAll('.ambience-preview-card.playing').forEach((c) => c.classList.remove('playing'));
        if (wasPlaying) {
          soundEngine.stop();
        } else {
          soundEngine.setVolume(0.35);
          soundEngine.play(sound.id);
          card.classList.add('playing');
        }
      });
      grid.appendChild(card);
    });

    // stop the preview the moment a real file gets opened or the reader
    // takes over sound duty — a marketing preview shouldn't keep playing
    // once someone's actually reading
    const fileInput = document.getElementById('fileInput');
    const dropTarget = document.getElementById('dropTarget');
    const stopPreview = () => {
      grid.querySelectorAll('.ambience-preview-card.playing').forEach((c) => c.classList.remove('playing'));
    };
    if (fileInput) fileInput.addEventListener('change', () => { soundEngine.stop(); stopPreview(); });
    if (dropTarget) dropTarget.addEventListener('drop', () => { soundEngine.stop(); stopPreview(); });
  }
})();
