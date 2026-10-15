/** Validate maintained documentation language pairs without fetching remote URLs. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const fences = text =>
  [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)].map(match => [
    match[1],
    match[2].trimEnd(),
  ]);
const prose = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
const identifiers = text =>
  [...prose(text).matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map(match => match[1]).sort();
const headings = text => [...prose(text).matchAll(/^(#{1,6})\s+(.+)$/gm)];
const targets = text =>
  [...prose(text).matchAll(/\]\(([^)]+)\)|(?:src|href)=["']([^"']+)["']/g)].map(match =>
    (match[1] ?? match[2]).replace(/^<|>$/g, '')
  );
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function slug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}
function anchors(text) {
  const seen = new Map();
  return new Set(
    headings(text).map(([, , title]) => {
      const base = slug(title);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    })
  );
}
function localTarget(root, file, target) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
  const [path, fragment] = target.split('#');
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const registry = JSON.parse(readFileSync(resolve(root, 'docs/translations.json'), 'utf8'));
  const errors = checkTranslations(root, registry);
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
