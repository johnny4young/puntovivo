// Language preference.
//
// Each language is now a real URL, so switching works with JavaScript off — the
// toggle is an ordinary link. This script only adds the memory the React
// version had: remember the language the visitor chose, and honour that choice
// when they later land on the other one.
//
// The redirect target is the toggle's own href, never the <link rel="alternate">
// tags: those carry canonical production URLs with no deploy base, so following
// one would 404 on a sub-path deploy. The toggle href is the same link a human
// would click, base included.

const LANG_STORAGE_KEY = 'pv-lang';
const SUPPORTED = ['es', 'en'];

function readStored() {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return SUPPORTED.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

// Remember the explicit choice before the browser follows the link.
for (const link of document.querySelectorAll('[data-lang-switch]')) {
  link.addEventListener('click', () => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, link.getAttribute('data-lang-switch'));
    } catch {
      /* ignore persistence failures */
    }
  });
}

const preferred = readStored();

// Act only on a stored preference that disagrees with the page being shown.
// `replace` keeps the redirect out of the back-button history, so Back still
// leaves the site instead of bouncing between translations.
if (preferred && preferred !== document.documentElement.lang) {
  const toggle = document.querySelector(`[data-lang-switch="${preferred}"]`);
  const target = toggle?.getAttribute('href');
  if (target) {
    window.location.replace(target + window.location.hash);
  }
}
