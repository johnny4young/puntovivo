// Co-pilot scenario rotation.
//
// All three scenarios are rendered into the HTML; this only moves which one is
// visible. Same timings as the React version: auto-advance every 9 s, and a
// manual pick pauses the rotation for 14 s before it resumes.
//
// With JavaScript off the first scenario stays on screen — the section still
// reads as a complete example rather than an empty shell.

const AUTO_MS = 9000;
const PAUSE_MS = 14000;

const root = document.querySelector('[data-ai-carousel]');

if (root) {
  const panels = [...root.querySelectorAll('[data-scenario-index]')];
  const dots = [...root.querySelectorAll('[data-scenario-dot]')];
  let active = 0;
  let autoTimer = null;
  let resumeTimer = null;

  function show(index) {
    active = index;
    for (const panel of panels) {
      panel.hidden = Number(panel.getAttribute('data-scenario-index')) !== index;
    }
    dots.forEach((dot, i) => {
      dot.classList.toggle('on', i === index);
      dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(() => show((active + 1) % panels.length), AUTO_MS);
  }

  function stopAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
  }

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      show(index);
      // Pause, then hand control back to the rotation.
      stopAuto();
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, PAUSE_MS);
    });
  });

  // Respect a reduced-motion preference: the panels stay reachable through the
  // dots, but nothing moves on its own.
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  show(0);
  if (!reduced?.matches) startAuto();
}
