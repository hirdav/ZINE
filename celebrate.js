// Celebration moments and the first-run onboarding story.
//
// No Remotion here (this app has no build step, so no React/video-render
// pipeline) — instead these are hand-rolled CSS/WAAPI sequences built to the
// same brief: short, purposeful, a little delightful, then out of the way.
// Every animation exists to mark a real event (an unlock, a streak, a
// finished focus session) — nothing plays just to play.

import { onForestEvent, hasSeenOnboarding, markOnboardingSeen, KIND_ICONS } from './forest-state.js';
import { onPomodoroEvent } from './pomodoro.js';

let toastContainer = null;
let onboardingOverlay = null;

function ensureRefs() {
  if (!toastContainer) toastContainer = document.getElementById('toastContainer');
  if (!onboardingOverlay) onboardingOverlay = document.getElementById('onboardingOverlay');
}

// ---------- toasts ----------
function spawnParticles(host, colors) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'toast-particle';
    const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 28 + Math.random() * 24;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 90}ms`;
    host.appendChild(p);
  }
}

export function showToast({ icon, title, subtitle, tone = 'default', burst = false }) {
  ensureRefs();
  if (!toastContainer) return;
  const card = document.createElement('div');
  card.className = `toast-card toast-${tone}`;

  const iconWrap = document.createElement('div');
  iconWrap.className = 'toast-icon';
  iconWrap.textContent = icon || '🌱';

  const body = document.createElement('div');
  body.className = 'toast-body';
  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;
  body.appendChild(titleEl);
  if (subtitle) {
    const subEl = document.createElement('div');
    subEl.className = 'toast-subtitle';
    subEl.textContent = subtitle;
    body.appendChild(subEl);
  }

  card.appendChild(iconWrap);
  card.appendChild(body);

  if (burst) {
    const burstHost = document.createElement('div');
    burstHost.className = 'toast-burst';
    spawnParticles(burstHost, ['#ff3b30', '#ffcc00', '#6fae4f', '#f2ede3']);
    card.appendChild(burstHost);
  }

  toastContainer.appendChild(card);
  requestAnimationFrame(() => card.classList.add('in'));

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => card.remove(), 420);
  };
  const timer = setTimeout(dismiss, 4600);
  card.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

const STREAK_MILESTONES = new Set([3, 7, 14, 30, 60, 100, 200, 365]);

let initialized = false;
export function initCelebrations() {
  if (initialized) return;
  initialized = true;
  ensureRefs();

  onForestEvent((event) => {
    if (event.type === 'unlock') {
      showToast({
        icon: KIND_ICONS[event.item.kind] || '🌱',
        title: `${event.item.label} unlocked`,
        subtitle: 'your Mind Forest grew a little',
        tone: 'unlock',
        burst: true,
      });
    } else if (event.type === 'milestone') {
      showToast({
        icon: '📖',
        title: `${event.pct}% through`,
        subtitle: 'nice pace — keep going',
        tone: 'milestone',
      });
    } else if (event.type === 'streak' && event.streak > 1) {
      const big = STREAK_MILESTONES.has(event.streak);
      showToast({
        icon: '🔥',
        title: `${event.streak}-day streak`,
        subtitle: big ? "that's real consistency" : 'back again — good',
        tone: 'streak',
        burst: big,
      });
    }
  });

  onPomodoroEvent((event) => {
    if (event.type === 'phase-complete' && event.from === 'focus') {
      showToast({ icon: '⏱', title: 'focus session complete', subtitle: 'time for a short break', tone: 'focus' });
    } else if (event.type === 'phase-complete' && event.from !== 'focus') {
      showToast({ icon: '🌤', title: "break's over", subtitle: 'ready for another focus session', tone: 'default' });
    }
  });
}

// ---------- onboarding ----------
const SLIDES = [
  {
    icon: '🌲',
    title: 'welcome to your Mind Forest',
    body: 'Every time you read, your forest grows a little. Sessions, streaks, and finished chapters each leave something behind — a sprout, a sapling, eventually a whole grove.',
  },
  {
    icon: '🔥',
    title: 'consistency, not speed',
    body: 'Reading once a day builds a streak, and streaks are worth more than any single long session. Growth Points only ever go up — there is nothing here to lose.',
  },
  {
    icon: '⏱',
    title: 'a focus timer that belongs here',
    body: 'Start a Pomodoro session right from the reader. Finish it, and it feeds straight into your forest — one habit, not two.',
  },
];

export function maybeShowOnboarding() {
  ensureRefs();
  if (!onboardingOverlay || hasSeenOnboarding()) return;
  renderOnboarding();
}

function renderOnboarding() {
  let step = 0;
  onboardingOverlay.innerHTML = '';
  onboardingOverlay.classList.remove('hidden', 'closing');

  const card = document.createElement('div');
  card.className = 'onboarding-card';
  onboardingOverlay.appendChild(card);

  const dots = document.createElement('div');
  dots.className = 'onboarding-dots';
  SLIDES.forEach(() => dots.appendChild(document.createElement('span')));
  Array.from(dots.children).forEach((d) => (d.className = 'onboarding-dot'));

  function finish() {
    markOnboardingSeen();
    onboardingOverlay.classList.add('closing');
    setTimeout(() => {
      onboardingOverlay.classList.add('hidden');
      onboardingOverlay.classList.remove('closing');
      onboardingOverlay.innerHTML = '';
    }, 320);
  }

  function renderStep() {
    const slide = SLIDES[step];
    card.innerHTML = '';

    const iconEl = document.createElement('div');
    iconEl.className = 'onboarding-icon';
    iconEl.textContent = slide.icon;

    const titleEl = document.createElement('h2');
    titleEl.className = 'onboarding-title';
    titleEl.textContent = slide.title;

    const bodyEl = document.createElement('p');
    bodyEl.className = 'onboarding-body';
    bodyEl.textContent = slide.body;

    const actions = document.createElement('div');
    actions.className = 'onboarding-actions';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'onboarding-skip';
    skipBtn.textContent = 'skip';
    skipBtn.addEventListener('click', finish);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn-primary onboarding-next';
    nextBtn.textContent = step === SLIDES.length - 1 ? 'start reading' : 'next';
    nextBtn.addEventListener('click', () => {
      if (step === SLIDES.length - 1) finish();
      else { step++; renderStep(); }
    });

    actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    card.appendChild(iconEl);
    card.appendChild(titleEl);
    card.appendChild(bodyEl);
    card.appendChild(dots);
    card.appendChild(actions);

    Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === step));

    card.classList.remove('slide-in');
    void card.offsetWidth; // restart the entrance animation on each slide
    card.classList.add('slide-in');
  }

  renderStep();
}
