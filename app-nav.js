// Shared app chrome for every authenticated page (dashboard, library,
// forest, analytics, profile, settings — everything except the marketing
// landing page and the distraction-free reading workspace itself).
//
// Two jobs: gate the page on sign-in (bounce straight back to the marketing
// site if nobody's signed in — the app is not something a visitor gets to
// see), and render the same nav bar + account widget everywhere so moving
// between sections never feels like a different product.
import * as auth from './auth.js';

const NAV_ITEMS = [
  { id: 'dashboard', href: 'dashboard.html', icon: '🏠', label: 'Dashboard' },
  { id: 'library', href: 'library.html', icon: '📚', label: 'Library' },
  { id: 'read', href: 'library.html#resume', icon: '📖', label: 'Read' },
  { id: 'forest', href: 'forest.html', icon: '🌲', label: 'Mind Forest' },
  { id: 'analytics', href: 'analytics.html', icon: '📊', label: 'Analytics' },
  { id: 'profile', href: 'profile.html', icon: '👤', label: 'Profile' },
  { id: 'settings', href: 'settings.html', icon: '⚙', label: 'Settings' },
];

// Awaits the initial session check and redirects to the marketing site if
// nobody's signed in. Every gated page should call this before rendering
// anything — resolves with the signed-in user once it's safe to proceed.
export async function requireAuth() {
  await auth.whenReady();
  if (!auth.isSignedIn()) {
    window.location.href = 'index.html';
    return null;
  }
  return auth.getUser();
}

// Builds the nav bar + account widget into `mountEl`, marking `activeId` as
// current. Call after requireAuth() resolves.
export function mountAppNav(mountEl, activeId) {
  mountEl.innerHTML = `
    <div class="app-nav-inner">
      <a href="dashboard.html" class="app-nav-logo">ZINE</a>
      <nav class="app-nav-links">
        ${NAV_ITEMS.map((item) => `
          <a href="${item.href}" class="app-nav-link ${item.id === activeId ? 'active' : ''}" data-nav-id="${item.id}">
            <span class="app-nav-icon">${item.icon}</span><span class="app-nav-label">${item.label}</span>
          </a>
        `).join('')}
      </nav>
      <div class="app-nav-account">
        <img id="appNavAvatar" class="account-avatar" alt="">
        <span id="appNavName" class="account-name"></span>
        <button id="appNavSignOut" class="account-signout-btn" title="Sign out">sign out</button>
      </div>
    </div>
  `;

  auth.onAuthChange((session) => {
    if (!session) return; // requireAuth() already redirects; nothing to render for a signed-out flash
    const meta = session.user.user_metadata || {};
    const name = meta.full_name || meta.name || session.user.email || 'reader';
    const avatarUrl = meta.avatar_url || '';
    mountEl.querySelector('#appNavName').textContent = name;
    const img = mountEl.querySelector('#appNavAvatar');
    if (avatarUrl) { img.src = avatarUrl; img.style.visibility = 'visible'; }
    else { img.style.visibility = 'hidden'; }
  });

  mountEl.querySelector('#appNavSignOut').addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = 'index.html';
  });
}
