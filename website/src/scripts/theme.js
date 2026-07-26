// Theme toggle. The anti-FOUC snippet in <head> has already put the right
// class on <html> before paint; this only wires the button and keeps the
// Sun/Moon icon and localStorage in sync.
//
// The two icons are both rendered server-side and swapped with `hidden`, so the
// correct one is a single attribute flip rather than markup the browser has to
// build.

const THEME_STORAGE_KEY = 'pv-theme';

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function reflect() {
  const dark = isDark();
  for (const el of document.querySelectorAll('[data-theme-icon]')) {
    const showsFor = el.getAttribute('data-theme-icon');
    el.hidden = showsFor === 'dark' ? !dark : dark;
  }
}

function toggle() {
  const dark = !isDark();
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    /* ignore persistence failures */
  }
  reflect();
}

reflect();
for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', toggle);
}
