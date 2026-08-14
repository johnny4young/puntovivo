/**
 * Time-bounded, owner-attributed dispositions for dependency advisories.
 *
 * The dependency audit is fail-closed: every advisory at or above the low
 * severity level fails CI. That is correct for anything that ships, but it
 * also turns main red with no repository change when an advisory lands on a
 * build-only toolchain, and it leaves no legitimate exit when upstream has
 * published no patched release at all.
 *
 * A disposition is that exit, and it is deliberately narrow:
 *
 * - The machine decides reachability, the human only argues. A disposition
 *   applies ONLY to an advisory the audit's own classifier independently
 *   labelled not-runtime-reachable. A runtime-reachable or unknown advisory
 *   refuses its disposition and keeps failing, so the file can never assert
 *   its way past the production graph.
 * - Closure is bidirectional. A disposition for an advisory the report no
 *   longer contains is stale and fails, so an acceptance cannot be inherited
 *   after upstream ships the fix.
 * - Acceptance expires. Every entry carries a short, category-bounded review
 *   deadline; past it the gate fails with the date.
 *
 * Known limit, stated here because the docs state it too: the verification is
 * over the pnpm production manifest graph, not the built web bundle or the
 * packaged desktop asar. The bundle/artifact argument is recorded as human
 * prose in reachabilityArgument and is held accountable by the expiry, not by
 * a machine proof. The audit runs before any build, so it has no artifact to
 * inspect.
 *
 * @module scripts/lib/audit-disposition-policy
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The id space the audit itself emits. extractAuditAdvisories derives an id
 * from github_advisory_id, else the first CVE, else the raw numeric id, so the
 * validator must accept all three: rejecting a CVE-only advisory would make
 * the disposition path unreachable for it while the gate keeps printing that
 * exact id as the thing to act on. `unknown` is deliberately excluded — an
 * unidentified advisory cannot be disposed.
 */
const ADVISORY_ID = /^(?:GHSA-[0-9a-z]{4,}(?:-[0-9a-z]{4,}){2}|CVE-\d{4}-\d{4,}|\d+)$/u;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Maximum days a disposition category may run between review dates.
 *
 * Both windows are deliberately shorter than the exact-override cadences:
 * accepting a live advisory is a heavier promise than pinning a version.
 * `awaiting-upstream-fix` is the shorter of the two because a patched release
 * is expected imminently, so the acceptance should be revisited sooner.
 */
export const MAX_DISPOSITION_DAYS = Object.freeze({
  'tooling-unreachable': 30,
  'awaiting-upstream-fix': 14,
});

/** Minimum prose lengths, mirroring the exact-override policy's floors. */
const MIN_REASON = 20;
const MIN_REMOVAL_CRITERIA = 20;
const MIN_REACHABILITY_ARGUMENT = 40;

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

/**
 * Validate the checked-in disposition file in isolation, without consulting an
 * audit report. Throws on the first violation; returns the flattened index the
 * audit decision consumes.
 *
 * An empty `dispositions` array is valid and is the correct steady state: the
 * repository should normally carry no accepted advisories at all.
 *
 * @param {{policy: unknown, now?: Date}} args
 * @returns {{owner: string, dispositionCount: number, nextReviewBy: string | null,
 *   byAdvisoryId: Map<string, {advisoryId: string, packageName: string, category: string,
 *   reviewBy: string, reason: string, removalCriteria: string, reachabilityArgument: string}>}}
 */
export function validateAuditDispositions({ policy, now = new Date() }) {
  if (policy?.schemaVersion !== 1) {
    throw new Error('Audit disposition policy schemaVersion must be 1');
  }
  if (!/^[a-z][a-z0-9-]+$/u.test(policy.owner ?? '')) {
    throw new Error('Audit disposition policy owner must be a stable role label');
  }
  if (!Array.isArray(policy.dispositions)) {
    throw new Error('Audit disposition policy requires a dispositions array');
  }

  const byAdvisoryId = new Map();
  let nextReviewAt = Number.POSITIVE_INFINITY;

  for (const [index, disposition] of policy.dispositions.entries()) {
    const prefix = `Audit disposition ${index + 1}`;
    // Own-property lookup only: a plain index would resolve inherited keys
    // such as constructor or __proto__ to a truthy non-number, passing this
    // guard and then making every later cadence comparison NaN-false, which
    // silently removes the review-window bound entirely.
    if (!Object.hasOwn(MAX_DISPOSITION_DAYS, disposition.category)) {
      throw new Error(`${prefix} has unsupported category ${disposition.category}`);
    }
    const maxDays = MAX_DISPOSITION_DAYS[disposition.category];
    if (typeof disposition.reason !== 'string' || disposition.reason.trim().length < MIN_REASON) {
      throw new Error(`${prefix} requires a concrete reason`);
    }
    if (
      typeof disposition.removalCriteria !== 'string' ||
      disposition.removalCriteria.trim().length < MIN_REMOVAL_CRITERIA
    ) {
      throw new Error(`${prefix} requires removal criteria`);
    }
    if (
      typeof disposition.reachabilityArgument !== 'string' ||
      disposition.reachabilityArgument.trim().length < MIN_REACHABILITY_ARGUMENT
    ) {
      throw new Error(
        `${prefix} requires a reachability argument covering the built bundle and the packaged artifact`
      );
    }
    if (
      !disposition.advisories ||
      typeof disposition.advisories !== 'object' ||
      Array.isArray(disposition.advisories) ||
      Object.keys(disposition.advisories).length === 0
    ) {
      throw new Error(`${prefix} requires advisories`);
    }

    const reviewedAt = parsePolicyDate(disposition.reviewedOn, `${prefix} reviewedOn`);
    const reviewBy = parsePolicyDate(disposition.reviewBy, `${prefix} reviewBy`, true);
    const maxReviewAt = reviewedAt + maxDays * MS_PER_DAY;
    if (reviewedAt > now.getTime()) {
      throw new Error(`${prefix} reviewedOn is in the future`);
    }
    if (reviewBy < reviewedAt) throw new Error(`${prefix} reviewBy predates reviewedOn`);
    if (reviewBy > maxReviewAt + MS_PER_DAY - 1) {
      throw new Error(`${prefix} exceeds the ${maxDays}-day ${disposition.category} cadence`);
    }
    if (now.getTime() > reviewBy) {
      throw new Error(
        `${prefix} expired on ${disposition.reviewBy}; renew the review or remove the advisory`
      );
    }
    nextReviewAt = Math.min(nextReviewAt, reviewBy);

    for (const [advisoryId, packageName] of Object.entries(disposition.advisories)) {
      if (!ADVISORY_ID.test(advisoryId)) {
        throw new Error(
          `${prefix} advisory ${advisoryId} must be an advisory id the audit reports (GHSA, CVE, or registry id)`
        );
      }
      if (typeof packageName !== 'string' || packageName.trim().length === 0) {
        throw new Error(`${prefix} advisory ${advisoryId} requires the affected package name`);
      }
      if (byAdvisoryId.has(advisoryId)) {
        throw new Error(`Audit disposition ${advisoryId} is registered twice`);
      }
      byAdvisoryId.set(advisoryId, {
        advisoryId,
        packageName,
        category: disposition.category,
        reviewBy: disposition.reviewBy,
        reason: disposition.reason,
        removalCriteria: disposition.removalCriteria,
        reachabilityArgument: disposition.reachabilityArgument,
      });
    }
  }

  return {
    owner: policy.owner,
    dispositionCount: byAdvisoryId.size,
    nextReviewBy:
      nextReviewAt === Number.POSITIVE_INFINITY
        ? null
        : new Date(nextReviewAt).toISOString().slice(0, 10),
    byAdvisoryId,
  };
}

/**
 * Match validated dispositions against the classified advisories of one audit
 * run. Pure and order-preserving; makes no exit decision of its own.
 *
 * A disposition is honoured only when the classifier independently proved the
 * advisory unreachable AND the recorded package matches the advisory's own
 * package. Anything else keeps the advisory blocking and records why, so the
 * report explains a refused disposition instead of silently ignoring it.
 *
 * @param {{classified: Array<object>, dispositions: {byAdvisoryId: Map<string, object>}}} args
 * @returns {{accepted: Array<{advisory: object, disposition: object}>,
 *   blocking: Array<{advisory: object, refusal: string | null}>,
 *   stale: Array<object>}}
 */
export function applyAuditDispositions({ classified, dispositions }) {
  const accepted = [];
  const blocking = [];
  const matched = new Set();

  for (const advisory of classified) {
    const disposition = dispositions.byAdvisoryId.get(advisory.id);
    if (!disposition) {
      blocking.push({ advisory, refusal: null });
      continue;
    }
    matched.add(advisory.id);

    if (disposition.packageName !== advisory.packageName) {
      blocking.push({
        advisory,
        refusal: `its disposition records package ${disposition.packageName}, not ${advisory.packageName}`,
      });
      continue;
    }
    if (advisory.classification !== 'not-runtime-reachable') {
      blocking.push({
        advisory,
        refusal: `a disposition cannot cover an advisory classified ${advisory.classification}; only the production graph decides reachability`,
      });
      continue;
    }
    accepted.push({ advisory, disposition });
  }

  const stale = [...dispositions.byAdvisoryId.values()].filter(
    disposition => !matched.has(disposition.advisoryId)
  );

  return { accepted, blocking, stale };
}
