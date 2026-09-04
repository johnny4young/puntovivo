const MAX_PATHS_PER_PACKAGE = 20;
const MAX_GRAPH_DEPTH = 80;

function nodeIdentity(node, fallback) {
  return node?.path || `${fallback}@${node?.version ?? 'unknown'}`;
}

function dependencyEntries(node) {
  return [
    ...Object.entries(node?.dependencies ?? {}),
    ...Object.entries(node?.optionalDependencies ?? {}),
  ];
}

function nodeRichness(node) {
  return dependencyEntries(node).length;
}

function buildCanonicalNodeIndex(roots) {
  const canonical = new Map();

  function collect(node, fallback, ancestors) {
    if (!node || typeof node !== 'object') return;
    const identity = nodeIdentity(node, fallback);
    const current = canonical.get(identity);
    if (!current || nodeRichness(node) > nodeRichness(current)) canonical.set(identity, node);
    if (ancestors.has(identity)) return;
    const nextAncestors = new Set(ancestors).add(identity);
    for (const [name, child] of dependencyEntries(node)) collect(child, name, nextAncestors);
  }

  for (const root of roots) collect(root, root.name ?? 'workspace', new Set());
  return canonical;
}

function validateContract(contract) {
  if (contract?.schemaVersion !== 1) throw new Error('Reachability schemaVersion must be 1');
  if (!Array.isArray(contract.artifacts) || contract.artifacts.length === 0) {
    throw new Error('Reachability contract requires deployable artifacts');
  }
  const ids = new Set();
  const roots = new Set();
  for (const artifact of contract.artifacts) {
    if (!/^[a-z][a-z0-9-]+$/u.test(artifact.id ?? '')) {
      throw new Error('Reachability artifact id must be a stable label');
    }
    if (ids.has(artifact.id)) throw new Error(`Duplicate reachability artifact ${artifact.id}`);
    if (roots.has(artifact.root)) throw new Error(`Duplicate deployable root ${artifact.root}`);
    if (typeof artifact.root !== 'string' || typeof artifact.delivery !== 'string') {
      throw new Error(`Reachability artifact ${artifact.id} is incomplete`);
    }
    ids.add(artifact.id);
    roots.add(artifact.root);
  }
  return ids;
}

export function createRuntimeReachabilityIndex({ roots, contract }) {
  const artifactIds = validateContract(contract);
  const rootsByName = new Map(roots.map(root => [root.name, root]));
  const canonical = buildCanonicalNodeIndex(roots);
  const packages = new Map();
  const artifactPackageCounts = new Map();

  function retain(packageName, path) {
    if (!packageName) return;
    const retained = packages.get(packageName) ?? [];
    const signature = path.map(step => `${step.name}@${step.version}`).join('>');
    const artifact = path[0].artifact;
    if (
      retained.filter(candidate => candidate.artifact === artifact).length <
        MAX_PATHS_PER_PACKAGE &&
      !retained.some(candidate => candidate.signature === signature)
    ) {
      retained.push({ artifact, path, signature });
      packages.set(packageName, retained);
    }
  }

  function walk(node, dependencyName, artifact, path, ancestors) {
    const identity = nodeIdentity(node, dependencyName);
    if (ancestors.has(identity) || path.length >= MAX_GRAPH_DEPTH) return;
    const canonicalNode = canonical.get(identity) ?? node;
    const step = {
      artifact: artifact.id,
      name: dependencyName,
      resolvedName: canonicalNode.from ?? dependencyName,
      version: canonicalNode.version ?? null,
    };
    const nextPath = [...path, step];
    retain(step.name, nextPath);
    if (step.resolvedName !== step.name) retain(step.resolvedName, nextPath);
    const nextAncestors = new Set(ancestors).add(identity);
    for (const [name, child] of dependencyEntries(canonicalNode)) {
      walk(child, name, artifact, nextPath, nextAncestors);
    }
  }

  for (const artifact of contract.artifacts) {
    const root = rootsByName.get(artifact.root);
    if (!root)
      throw new Error(`Deployable root ${artifact.root} is absent from pnpm production graph`);
    walk(root, artifact.root, artifact, [], new Set());
    const count = [...packages.values()].filter(paths =>
      paths.some(candidate => candidate.artifact === artifact.id)
    ).length;
    artifactPackageCounts.set(artifact.id, count);
  }

  for (const required of contract.requiredPaths ?? []) {
    if (!artifactIds.has(required.artifact)) {
      throw new Error(`Required path references unknown artifact ${required.artifact}`);
    }
    if (!Array.isArray(required.chain) || required.chain.length < 2) {
      throw new Error('Required reachability path must contain at least two packages');
    }
    if (typeof required.reason !== 'string' || required.reason.trim().length < 20) {
      throw new Error('Required reachability path needs a concrete reason');
    }
    const terminal = required.chain.at(-1);
    const found = (packages.get(terminal) ?? []).some(
      candidate =>
        candidate.artifact === required.artifact &&
        candidate.path.map(step => step.name).join('>') === required.chain.join('>')
    );
    if (!found) {
      throw new Error(
        `Required runtime path is absent: ${required.artifact}: ${required.chain.join(' > ')}`
      );
    }
  }

  for (const forbidden of contract.forbiddenProductionPackages ?? []) {
    if (!artifactIds.has(forbidden.artifact)) {
      throw new Error(`Forbidden package references unknown artifact ${forbidden.artifact}`);
    }
    if (typeof forbidden.reason !== 'string' || forbidden.reason.trim().length < 20) {
      throw new Error('Forbidden production package needs a concrete reason');
    }
    const found = (packages.get(forbidden.package) ?? []).some(
      candidate => candidate.artifact === forbidden.artifact
    );
    if (found) {
      throw new Error(
        `Development package ${forbidden.package} is production-reachable from ${forbidden.artifact}`
      );
    }
  }

  return { packages, artifactPackageCounts };
}

/**
 * The advisory endpoint answers a transport failure with an error envelope
 * ({ error: { code, message } }) instead of a report. That is the registry
 * being unreachable, NOT a schema change, and reporting it as a malformed
 * report sends the reader hunting for a parser bug that does not exist.
 * Returns a human description, or null when the report is not an error
 * envelope.
 *
 * @param {unknown} report
 * @returns {string | null}
 */
export function readAuditTransportError(report) {
  if (!report || typeof report !== 'object') return null;
  const error = /** @type {{error?: unknown}} */ (report).error;
  if (!error || typeof error !== 'object') return null;
  const { code, message } = /** @type {{code?: unknown, message?: unknown}} */ (error);
  const shownCode = code === undefined ? 'unknown' : String(code);
  const shownMessage = typeof message === 'string' && message ? message : 'no message given';
  return `the registry answered with error ${shownCode}: ${shownMessage}`;
}

export function extractAuditAdvisories(report) {
  const transportError = readAuditTransportError(report);
  if (transportError) {
    throw new Error(`pnpm audit could not reach the advisory registry - ${transportError}`);
  }
  if (!report || typeof report !== 'object' || !report.advisories || !report.metadata) {
    throw new Error('pnpm audit returned an unsupported JSON report');
  }
  return Object.values(report.advisories).map(advisory => {
    if (typeof advisory.module_name !== 'string' || advisory.module_name.length === 0) {
      throw new Error('pnpm audit advisory has no package name');
    }
    return {
      id: advisory.github_advisory_id ?? advisory.cves?.[0] ?? String(advisory.id ?? 'unknown'),
      packageName: advisory.module_name,
      severity: advisory.severity ?? 'unknown',
      title: advisory.title ?? 'Untitled advisory',
      vulnerableVersions: new Set(
        Array.isArray(advisory.findings)
          ? advisory.findings.map(finding => finding.version).filter(Boolean)
          : []
      ),
    };
  });
}

export function classifyAuditAdvisories(advisories, reachability) {
  return advisories.map(advisory => {
    const knownPaths = reachability.packages.get(advisory.packageName) ?? [];
    const runtimePaths = knownPaths.filter(candidate => {
      if (advisory.vulnerableVersions.size === 0) return false;
      return advisory.vulnerableVersions.has(candidate.path.at(-1).version);
    });
    return {
      ...advisory,
      classification:
        advisory.vulnerableVersions.size === 0
          ? 'unknown'
          : runtimePaths.length > 0
            ? 'runtime-reachable'
            : 'not-runtime-reachable',
      runtimePaths,
    };
  });
}

export function formatRuntimePath(candidate) {
  return `${candidate.artifact}: ${candidate.path
    .map(step => `${step.name}@${step.version ?? 'workspace'}`)
    .join(' > ')}`;
}
