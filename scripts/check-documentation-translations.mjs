/** Validate maintained documentation language pairs without fetching remote URLs. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

function splitFences(text) {
  const blocks = [];
  const outside = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      outside.push(lines[i]);
      continue;
    }
    const marker = opening[1][0];
    const closing = new RegExp(`^ {0,3}${marker}{${opening[1].length},}\\s*$`);
    const body = [];
    while (++i < lines.length && !closing.test(lines[i])) body.push(lines[i]);
    blocks.push([opening[2].trim(), body.join('\n').trimEnd()]);
    outside.push('');
  }
  return { blocks, outside: outside.join('\n') };
}
const fences = text => splitFences(text).blocks;
const prose = text => splitFences(text).outside;
const identifiers = text =>
  [...prose(text).matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map(match => match[1]).sort();
const headings = text => [...prose(text).matchAll(/^(#{1,6})\s+(.+)$/gm)];
function targets(text) {
  const content = prose(text);
  // An inline destination may carry a quoted title after whitespace.
  const destination = raw => {
    const value = raw.trim();
    return value.startsWith('<') ? value.slice(1, value.indexOf('>')) : value.split(/\s+/)[0];
  };
  const result = [...content.matchAll(/\]\(([^)]+)\)|(?:src|href)=["']([^"']+)["']/g)].map(match =>
    destination(match[1] ?? match[2])
  );
  const normalize = label => label.trim().replace(/\s+/g, ' ').toLowerCase();
  const references = new Map(
    [...content.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)].map(
      ([, label, bracketed, bare]) => [normalize(label), bracketed ?? bare]
    )
  );
  for (const match of content.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const next = content[match.index + match[0].length];
    if (next === '(' || next === ':') continue;
    const destination = references.get(normalize(match[2] || match[1]));
    if (destination) result.push(destination);
  }
  return result;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function slug(text) {
  return text
    .toLowerCase()
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}
function anchors(text) {
  const seen = new Map();
  return new Set([
    ...headings(text).map(([, , title]) => {
      const base = slug(title.replace(/\s+#+\s*$/, ''));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    }),
    ...[...prose(text).matchAll(/<[a-z][^>]*\s(?:id|name)=["']([^"']+)["'][^>]*>/gi)].map(
      match => match[1]
    ),
  ]);
}
function localTarget(root, file, target) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
  const [beforeFragment, fragment] = target.split('#');
  const path = beforeFragment.split('?')[0];
  return {
    path: path
      ? resolve(
          path.startsWith('/') ? root : dirname(resolve(root, file)),
          decodeURIComponent(path.replace(/^\//, ''))
        )
      : resolve(root, file),
    fragment: fragment ? decodeURIComponent(fragment) : null,
  };
}

/** Return actionable parity/link failures for the configured source and translation files. */
export function checkTranslations(root, registry) {
  const errors = [];
  const files = new Set(registry.bilingual ?? []);
  for (const { en, es } of registry.pairs) {
    files.add(en);
    files.add(es);
    if (![en, es].every(file => existsSync(resolve(root, file)))) {
      errors.push(`Missing language counterpart: ${en} / ${es}`);
      continue;
    }
    const a = readFileSync(resolve(root, en), 'utf8');
    const b = readFileSync(resolve(root, es), 'utf8');
    if (!equal(fences(a), fences(b))) errors.push(`Code block drift: ${en} / ${es}`);
    if (!equal(identifiers(a), identifiers(b))) errors.push(`Identifier drift: ${en} / ${es}`);
    if (
      !equal(
        headings(a).map(match => match[1]),
        headings(b).map(match => match[1])
      )
    )
      errors.push(`Heading structure drift: ${en} / ${es}`);
    for (const [file, text, other] of [
      [en, a, es],
      [es, b, en],
    ]) {
      if (
        !targets(text).some(
          target => localTarget(root, file, target)?.path === resolve(root, other)
        )
      )
        errors.push(`Missing reciprocal language link: ${file} -> ${other}`);
    }
  }
  for (const file of files) {
    if (!existsSync(resolve(root, file))) {
      errors.push(`Missing document: ${file}`);
      continue;
    }
    for (const target of targets(readFileSync(resolve(root, file), 'utf8'))) {
      const local = localTarget(root, file, target);
      if (!local) continue;
      if (relative(root, local.path).startsWith('..')) {
        errors.push(`Link outside repository: ${file} -> ${target}`);
        continue;
      }
      if (!existsSync(local.path)) {
        errors.push(`Broken local link: ${file} -> ${target}`);
        continue;
      }
      if (
        local.fragment &&
        local.path.endsWith('.md') &&
        !anchors(readFileSync(local.path, 'utf8')).has(local.fragment)
      )
        errors.push(`Broken heading link: ${file} -> ${target}`);
    }
  }
  return errors;
}

/** Inventory Git-tracked project Markdown; dependency/output files are not authored guides. */
export function inventory(root, registry) {
  const files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(
      file => !/(^|\/)(node_modules|vendor|dist|output|\.vite|\.playwright-browsers)\//.test(file)
    );
  const translations = new Set(registry.pairs.map(pair => pair.es));
  const covered = new Set([...registry.pairs.map(pair => pair.en), ...(registry.bilingual ?? [])]);
  const historical = file =>
    registry.historical.some(pattern =>
      new RegExp(
        `^${pattern
          .split('*')
          .map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`
      ).test(file)
    );
  return {
    total: files.length,
    historical: files.filter(historical),
    maintainedSources: files.filter(file => !historical(file) && !translations.has(file)),
    translatedPairs: registry.pairs,
    uncovered: files.filter(
      file => !historical(file) && !translations.has(file) && !covered.has(file)
    ),
  };
}

/** A newly tracked current guide must be registered, alongside pair/link validation. */
export function checkDocumentation(root, registry) {
  return [
    ...checkTranslations(root, registry),
    ...inventory(root, registry).uncovered.map(file => `Untranslated current document: ${file}`),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const registry = JSON.parse(readFileSync(resolve(root, 'docs/translations.json'), 'utf8'));
  const errors = checkDocumentation(root, registry);
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else
    console.log(
      `Documentation translations PASS: ${registry.pairs.length} pairs; code blocks, identifiers, headings, reciprocal selectors and local links.`
    );
  if (process.argv.includes('--inventory'))
    console.log(JSON.stringify(inventory(root, registry), null, 2));
}
