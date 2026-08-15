import { readFile } from 'node:fs/promises';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const EXACT_NPM_ALIAS =
  /^npm:(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_REVIEW_DAYS = Object.freeze({
  compatibility: 90,
  'security-floor': 30,
  'deprecation-floor': 30,
  'regression-ceiling': 14,
});

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse only the top-level pnpm overrides mapping without adding a YAML runtime dependency. */
export function parseWorkspaceOverrides(source) {
  const overrides = new Map();
  let insideOverrides = false;

  for (const line of source.split(/\r?\n/u)) {
    if (!insideOverrides) {
      insideOverrides = line === 'overrides:';
      continue;
    }

    if (/^[A-Za-z][\w-]*:/u.test(line)) break;
    if (/^\s*(?:#.*)?$/u.test(line)) continue;

    const match = line.match(/^\s{2}((?:'[^']+'|"[^"]+"|[^:#][^:]*?)):\s+(.+?)\s*$/u);
    if (!match) {
      throw new Error(`Unsupported overrides syntax: ${line.trim()}`);
    }

    const selector = unquoteYamlScalar(match[1]);
    const target = unquoteYamlScalar(match[2].replace(/\s+#.*$/u, ''));
    if (overrides.has(selector)) throw new Error(`Duplicate override selector ${selector}`);
    overrides.set(selector, target);
  }

  if (!insideOverrides) throw new Error('pnpm-workspace.yaml has no overrides mapping');
  return overrides;
}

export function isExactRegistryOverride(target) {
  return EXACT_VERSION.test(target) || EXACT_NPM_ALIAS.test(target);
}

function parsePolicyDate(value, label, endOfDay = false) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error(`${label} must be an ISO calendar date`);
  }
  const instant = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid`);
  }
  return instant;
}

export function validateExactOverridePolicy({ overrides, policy, now = new Date() }) {
  if (policy?.schemaVersion !== 1) throw new Error('Exact override policy schemaVersion must be 1');
  if (!/^[a-z][a-z0-9-]+$/u.test(policy.owner ?? '')) {
    throw new Error('Exact override policy owner must be a stable role label');
  }
  if (!Array.isArray(policy.reviews) || policy.reviews.length === 0) {
    throw new Error('Exact override policy requires review groups');
  }

  const expected = new Set(
    [...overrides]
      .filter(([, target]) => isExactRegistryOverride(target))
      .map(([selector]) => selector)
  );
  const registered = new Set();
  let nextReviewAt = Number.POSITIVE_INFINITY;

  for (const [index, review] of policy.reviews.entries()) {
    const prefix = `Exact override review ${index + 1}`;
    // Own-property lookup only: a plain index would resolve inherited keys
    // such as constructor or __proto__ to a truthy non-number, passing this
    // guard and then making every later cadence comparison NaN-false, which
    // silently removes the review-window bound entirely.
    if (!Object.hasOwn(MAX_REVIEW_DAYS, review.category)) {
      throw new Error(`${prefix} has unsupported category ${review.category}`);
    }
    const maxDays = MAX_REVIEW_DAYS[review.category];
    if (typeof review.reason !== 'string' || review.reason.trim().length < 20) {
      throw new Error(`${prefix} requires a concrete reason`);
    }
    if (typeof review.removalCriteria !== 'string' || review.removalCriteria.trim().length < 20) {
      throw new Error(`${prefix} requires removal criteria`);
    }
    if (
      !review.pins ||
      typeof review.pins !== 'object' ||
      Array.isArray(review.pins) ||
      Object.keys(review.pins).length === 0
    ) {
      throw new Error(`${prefix} requires pins`);
    }

    const reviewedAt = parsePolicyDate(review.reviewedOn, `${prefix} reviewedOn`);
    const reviewBy = parsePolicyDate(review.reviewBy, `${prefix} reviewBy`, true);
    const maxReviewAt = reviewedAt + maxDays * 24 * 60 * 60 * 1000;
    if (reviewedAt > now.getTime()) {
      throw new Error(`${prefix} reviewedOn is in the future`);
    }
    if (reviewBy < reviewedAt) throw new Error(`${prefix} reviewBy predates reviewedOn`);
    if (reviewBy > maxReviewAt + 24 * 60 * 60 * 1000 - 1) {
      throw new Error(`${prefix} exceeds the ${maxDays}-day ${review.category} cadence`);
    }
    if (now.getTime() > reviewBy) {
      throw new Error(`${prefix} expired on ${review.reviewBy}; review or remove its overrides`);
    }
    nextReviewAt = Math.min(nextReviewAt, reviewBy);

    for (const [selector, reviewedTarget] of Object.entries(review.pins)) {
      if (registered.has(selector))
        throw new Error(`Exact override ${selector} is registered twice`);
      if (!expected.has(selector)) {
        throw new Error(
          `Exact override policy contains stale or non-registry selector ${selector}`
        );
      }
      const actualTarget = overrides.get(selector);
      if (reviewedTarget !== actualTarget) {
        throw new Error(
          `Exact override ${selector} changed from reviewed target ${reviewedTarget} to ${actualTarget}`
        );
      }
      registered.add(selector);
    }
  }

  const missing = [...expected].filter(selector => !registered.has(selector)).sort();
  if (missing.length > 0) {
    throw new Error(`Exact registry overrides lack review metadata: ${missing.join(', ')}`);
  }

  return {
    exactOverrideCount: expected.size,
    nextReviewBy: new Date(nextReviewAt).toISOString().slice(0, 10),
    owner: policy.owner,
  };
}

export async function loadAndValidateExactOverridePolicy({
  workspacePath,
  policyPath,
  now = new Date(),
}) {
  const [workspaceSource, policySource] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(policyPath, 'utf8'),
  ]);
  return validateExactOverridePolicy({
    overrides: parseWorkspaceOverrides(workspaceSource),
    policy: JSON.parse(policySource),
    now,
  });
}
