import { Fragment } from 'react';

// Minimal, safe inline-markup renderer for i18n strings. The locale copy uses
// a tiny vocabulary of tags — <b>, <em>, and <pill> — to mark emphasis and the
// AI-answer "pills". We parse only those tags into React elements instead of
// using dangerouslySetInnerHTML, so the rendered output is always trusted React
// nodes (no raw HTML injection), and the markup survives i18n value changes.
//
// Unknown tags are rendered as literal text. Nesting is not supported (the copy
// never nests these tags).

const TAG_RE = /<(b|em|pill)>([\s\S]*?)<\/\1>/g;

const TAG_RENDERERS = {
  b: (key, content) => <b key={key}>{content}</b>,
  em: (key, content) => (
    <em key={key} style={{ fontStyle: 'normal' }}>
      {content}
    </em>
  ),
  pill: (key, content) => (
    <span key={key} className="pill">
      {content}
    </span>
  ),
};

export function RichText({ text, as: Tag = Fragment, ...rest }) {
  if (typeof text !== 'string') {
    return Tag === Fragment ? null : <Tag {...rest} />;
  }

  const nodes = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const [, tag, content] = match;
    nodes.push(TAG_RENDERERS[tag](key, content));
    key += 1;
    lastIndex = TAG_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  if (Tag === Fragment) {
    return <Fragment>{nodes}</Fragment>;
  }
  return <Tag {...rest}>{nodes}</Tag>;
}
