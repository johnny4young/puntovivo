// Minimal, safe inline-markup renderer for i18n strings.
//
// The locale copy uses a tiny vocabulary of tags — <b>, <em> and <pill> — to
// mark emphasis and the AI-answer "pills". Everything is escaped first and only
// those three tags are re-introduced afterwards, so a translation string can
// never inject markup even though the result is inserted as HTML.
//
// Unknown tags survive as literal text. Nesting is not supported; the copy
// never nests these tags.

const TAG_RE = /&lt;(b|em|pill)&gt;([\s\S]*?)&lt;\/\1&gt;/g;

const OPEN = {
  b: '<b>',
  // The design renders <em> upright — it marks emphasis, not italics.
  em: '<em style="font-style:normal">',
  pill: '<span class="pill">',
};

const CLOSE = { b: '</b>', em: '</em>', pill: '</span>' };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Escaped HTML for one copy string, with the three known tags restored. */
export function renderRichText(text) {
  if (typeof text !== 'string') return '';
  return escapeHtml(text).replace(
    TAG_RE,
    (whole, tag, content) => `${OPEN[tag]}${content}${CLOSE[tag]}`
  );
}
