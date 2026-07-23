#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  OPERATIONAL_READINESS_SERVICES,
  OPERATIONAL_SERVICE_IDS,
} from '../packages/shared/src/operational-readiness.ts';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function hasExactTestDeclaration(source, title) {
  const sourceFile = ts.createSourceFile(
    'operational-drill.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let found = false;
  const visit = node => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDirectDeclaration =
        ts.isIdentifier(callee) && (callee.text === 'test' || callee.text === 'it');
      const isVariantDeclaration =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        (callee.expression.text === 'test' || callee.expression.text === 'it') &&
        ['skip', 'only', 'fixme', 'fail'].includes(callee.name.text);
      const titleArgument = node.arguments[0];
      if (
        (isDirectDeclaration || isVariantDeclaration) &&
        titleArgument &&
        (ts.isStringLiteral(titleArgument) || ts.isNoSubstitutionTemplateLiteral(titleArgument)) &&
        titleArgument.text === title
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export async function checkOperationalReadiness(root = repositoryRoot) {
  const errors = [];
  const actualIds = OPERATIONAL_READINESS_SERVICES.map(service => service.id);

  if (JSON.stringify(actualIds) !== JSON.stringify(OPERATIONAL_SERVICE_IDS)) {
    errors.push('operational services must preserve the canonical six-service order');
  }

  const runbookPath = resolve(root, 'docs/OPERATIONS-RUNBOOKS.md');
  let runbook = '';
  try {
    runbook = await readFile(runbookPath, 'utf8');
  } catch {
    errors.push('docs/OPERATIONS-RUNBOOKS.md is missing');
  }

  for (const service of OPERATIONAL_READINESS_SERVICES) {
    if (!Number.isInteger(service.responseTargetMinutes) || service.responseTargetMinutes <= 0) {
      errors.push(`${service.id}: response target must be a positive whole minute`);
    }
    if (!service.actionTarget.startsWith('/')) {
      errors.push(`${service.id}: recovery action must be an application route`);
    }
    if (!runbook.includes(`<a id="${service.runbookId}"></a>`)) {
      errors.push(`${service.id}: runbook anchor ${service.runbookId} is missing`);
    }

    for (const drill of service.drills) {
      const evidencePath = resolve(root, drill.file);
      let evidence = '';
      try {
        evidence = await readFile(evidencePath, 'utf8');
      } catch {
        errors.push(`${service.id}: drill file is missing: ${drill.file}`);
        continue;
      }
      if (!hasExactTestDeclaration(evidence, drill.testTitle)) {
        errors.push(`${service.id}: drill title is missing from ${drill.file}: ${drill.testTitle}`);
      }
    }
  }

  return { errors, serviceCount: actualIds.length };
}

async function main() {
  const result = await checkOperationalReadiness();
  if (result.errors.length > 0) {
    console.error('Operational readiness contract failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Operational readiness contract passed: ${result.serviceCount} services have owners, thresholds, runbooks, and executable drill evidence.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
