import { matchesSearch } from '../lib/manualSearch.js';

const form = document.querySelector('[data-manual-search]');
if (form instanceof HTMLFormElement) {
  const input = form.querySelector('input');
  const status = form.querySelector('[data-manual-results]');
  const empty = document.querySelector('[data-manual-empty]');
  const articles = [...document.querySelectorAll('[data-manual-task]')];
  // Capture text once. Never interpret a query as HTML or a regular expression.
  const index = articles.map(article => ({ article, text: article.textContent ?? '' }));
  function update() {
    let count = 0;
    for (const { article, text } of index) {
      article.hidden = !matchesSearch(text, input.value);
      if (!article.hidden) count += 1;
    }
    status.textContent =
      count === 1
        ? status.dataset.templateOne
        : status.dataset.template.replace('{count}', String(count));
    empty.hidden = count > 0;
  }
  function reset() {
    input.value = '';
    update();
  }
  const taskIndex = document.querySelector('[data-manual-index]');
  if (taskIndex instanceof HTMLDetailsElement && matchMedia('(max-width: 900px)').matches) {
    taskIndex.open = false;
  }
  form.hidden = false;
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', update);
  form.addEventListener('reset', () => {
    reset();
    input.focus();
  });
  // A deep link always exposes its task, including back/forward navigation.
  function revealHash() {
    const target = document.getElementById(location.hash.slice(1));
    if (target?.matches('[data-manual-task]') && target.hidden) {
      reset();
      target.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', revealHash);
  document.querySelectorAll('[data-manual-jump]').forEach(link => {
    link.addEventListener('click', () => {
      reset();
      document.getElementById(link.getAttribute('href').slice(1))?.focus({ preventScroll: true });
    });
  });
  // Stable task IDs let either language link keep the current task.
  const languageLinks = document.querySelectorAll('[data-lang-switch], [data-manual-language]');
  const languagePaths = new Map(
    [...languageLinks].map(link => [link, link.getAttribute('href').split('#')[0]])
  );
  function updateLanguageLinks() {
    const hash = articles.some(article => `#${article.id}` === location.hash) ? location.hash : '';
    for (const [link, path] of languagePaths) link.setAttribute('href', `${path}${hash}`);
  }
  window.addEventListener('hashchange', updateLanguageLinks);
  update();
  revealHash();
  updateLanguageLinks();
}
