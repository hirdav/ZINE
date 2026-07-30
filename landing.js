// The marketing landing page: scroll-reveal, nav/CTA smooth-scrolling, the
// tiny growth-stage and ambience-preview demos, and the sign-in buttons.
// Deliberately independent of app.js and every other app module except
// auth.js (to redirect an already-signed-in visitor away) and sound.js (for
// the "tap to hear it" ambience cards) — a visitor who isn't signed in
// should never load forest-state.js, cloud-sync.js, or anything else that
// assumes there's an account behind it.
import { SOUND_GROUPS, soundEngine } from './sound.js';
import * as auth from './auth.js';

// Signed-in visitors belong on the dashboard, not here — checked before
// anything below renders. html.auth-checking (set by default in the markup)
// keeps the page invisible until this resolves, so there's no marketing
// flash before the redirect fires.
auth.whenReady().then(() => {
  if (auth.isSignedIn()) {
    window.location.href = 'dashboard.html';
  } else {
    document.documentElement.classList.remove('auth-checking');
  }
});

function handleSignIn() {
  auth.signInWithGoogle().catch((err) => {
    console.warn('[landing] sign-in failed', err);
  });
}
['navSignInBtn', 'heroSignInBtn', 'ctaSignInBtn'].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', handleSignIn);
});

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
  }
})();
