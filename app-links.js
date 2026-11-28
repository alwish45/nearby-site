// App store links on every page. On Android, App Store links become Google
// Play links once near.by is live there. Until then they say "Coming soon".
//
// LAUNCH DAY: when Google Play shows the app as live, set PLAY_LIVE = true.
const PLAY_LIVE = false;
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.nearbyutah.app';

(function () {
  if (!/Android/i.test(navigator.userAgent)) return;
  document.querySelectorAll('a[href*="apps.apple.com"]').forEach(a => {
    if (PLAY_LIVE) {
      a.href = PLAY_URL;
      a.textContent = a.textContent.replace(/App Store/g, 'Google Play');
      return;
    }
    const note = document.createElement('span');
    note.className = a.className; note.style.background = '#5c564d'; note.style.cursor = 'default';
    note.textContent = 'Coming soon to Android';
    note.setAttribute('role', 'note');
    a.replaceWith(note);
  });
})();
