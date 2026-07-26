// Migration source picker: choosing a system highlights it and names it in the
// summary line underneath. Every option is already in the markup, so this only
// moves the `on` class and swaps one text node.

for (const picker of document.querySelectorAll('[data-source-picker]')) {
  const label = picker.querySelector('[data-source-selected]');
  const buttons = picker.querySelectorAll('[data-source-id]');

  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) other.classList.toggle('on', other === button);
      if (label) label.textContent = button.getAttribute('data-source-label') || '';
    });
  }
}
