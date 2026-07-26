// Shortcut cheat sheet: platform toggle, text + area filtering, and the
// keyboard highlight that lights up a combo while its row is hovered.
//
// Every shortcut row, both platform spellings and the empty state are already
// in the HTML, so this script only toggles attributes. Nothing here builds DOM,
// which is also why the page is fully readable and printable with JS disabled.

const root = document.querySelector('[data-shortcuts]');

if (root) {
  const rows = [...root.querySelectorAll('[data-shortcut-row]')];
  const groups = [...root.querySelectorAll('[data-shortcut-group]')];
  const empty = root.querySelector('[data-shortcuts-empty]');
  const search = root.querySelector('[data-shortcut-search]');
  const clear = root.querySelector('[data-shortcut-clear]');
  const areaButtons = [...root.querySelectorAll('[data-area-filter]')];
  // The platform switch and the print button live in the page header, outside
  // the shortcuts section — scope them to the document, not to `root`.
  const platformButtons = [...document.querySelectorAll('[data-platform-set]')];
  const board = document.querySelector('[data-keyboard]');

  let platform = 'mac';
  let area = '';
  let needle = '';

  function applyPlatform() {
    for (const el of document.querySelectorAll('[data-platform]')) {
      el.hidden = el.getAttribute('data-platform') !== platform;
    }
    for (const button of platformButtons) {
      button.classList.toggle('on', button.getAttribute('data-platform-set') === platform);
    }
  }

  function applyFilter() {
    let visible = 0;
    for (const row of rows) {
      const matchesArea = !area || row.getAttribute('data-area') === area;
      const matchesText = !needle || (row.getAttribute('data-search') || '').includes(needle);
      const show = matchesArea && matchesText;
      row.hidden = !show;
      if (show) visible += 1;
    }
    // A group with nothing left to show hides itself, header and count included.
    for (const group of groups) {
      const shown = [...group.querySelectorAll('[data-shortcut-row]')].filter(r => !r.hidden);
      group.hidden = shown.length === 0;
      const count = group.querySelector('[data-group-count]');
      if (count) count.textContent = String(shown.length);
    }
    if (empty) empty.hidden = visible > 0;
    if (clear) clear.hidden = needle.length === 0;
  }

  function highlight(keys) {
    if (!board) return;
    for (const key of board.querySelectorAll('.kb-key')) {
      key.classList.toggle('hl', keys.has(key.textContent.trim()));
    }
  }

  for (const row of rows) {
    row.addEventListener('mouseenter', () => {
      // Pipe-separated: key names are multi-character (Shift, Esc, F1).
      const raw = row.getAttribute(`data-keys-${platform}`) || '';
      highlight(new Set(raw.split('|').filter(Boolean)));
    });
    row.addEventListener('mouseleave', () => highlight(new Set()));
  }

  for (const button of areaButtons) {
    button.addEventListener('click', () => {
      area = button.getAttribute('data-area-filter');
      for (const other of areaButtons) other.classList.toggle('on', other === button);
      applyFilter();
    });
  }

  for (const button of platformButtons) {
    button.addEventListener('click', () => {
      platform = button.getAttribute('data-platform-set');
      applyPlatform();
    });
  }

  search?.addEventListener('input', () => {
    needle = search.value.trim().toLowerCase();
    applyFilter();
  });

  clear?.addEventListener('click', () => {
    if (search) search.value = '';
    needle = '';
    applyFilter();
    search?.focus();
  });

  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());

  applyPlatform();
  applyFilter();
}
