/**
 * stable, reviewable manifest of the public tRPC surface.
 *
 * tRPC infers most output types at compile time, so the runtime manifest
 * records each procedure path/kind, a compact JSON-Schema summary of every
 * declared input/output parser, and the word `inferred` when no output parser
 * exists. The committed snapshot makes route and parser drift visible without
 * coupling the gate to private TypeScript compiler APIs.
 */

export type TrpcProcedureKind = 'query' | 'mutation' | 'subscription';

export interface TrpcContractEntry {
  path: string;
  kind: TrpcProcedureKind;
  input: string;
  output: string;
}

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  anyOf?: unknown[];
  oneOf?: unknown[];
  allOf?: unknown[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  $ref?: string;
}

interface RuntimeSchema {
  toJSONSchema?: (options: Record<string, unknown>) => unknown;
  def?: { type?: string };
  _def?: { type?: string };
}

interface RuntimeProcedure {
  _def: {
    type: string;
    inputs: RuntimeSchema[];
    output?: RuntimeSchema;
  };
}

interface RuntimeRouter {
  _def: {
    procedures: Record<string, RuntimeProcedure>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueLabel(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function constraintLabel(schema: JsonSchemaNode): string {
  const constraints = [
    schema.format ? `format=${schema.format}` : null,
    schema.minLength !== undefined ? `minLength=${schema.minLength}` : null,
    schema.maxLength !== undefined ? `maxLength=${schema.maxLength}` : null,
    schema.minimum !== undefined ? `min=${schema.minimum}` : null,
    schema.maximum !== undefined ? `max=${schema.maximum}` : null,
    schema.exclusiveMinimum !== undefined ? `min>${schema.exclusiveMinimum}` : null,
    schema.exclusiveMaximum !== undefined ? `max<${schema.exclusiveMaximum}` : null,
    schema.minItems !== undefined ? `minItems=${schema.minItems}` : null,
    schema.maxItems !== undefined ? `maxItems=${schema.maxItems}` : null,
  ].filter((value): value is string => value !== null);

  return constraints.length > 0 ? `[${constraints.join(',')}]` : '';
}

function summarizeJsonSchema(value: unknown, depth = 0): string {
  if (!isRecord(value)) return 'unknown';
  const schema = value as JsonSchemaNode;

  if (schema.const !== undefined) return `literal(${valueLabel(schema.const)})`;
  if (schema.enum) return `enum(${schema.enum.map(valueLabel).join('|')})`;

  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const summaries = [...new Set(variants.map(variant => summarizeJsonSchema(variant, depth)))];
    return summaries.join('|');
  }

  if (schema.allOf) {
    return schema.allOf.map(part => summarizeJsonSchema(part, depth)).join('&');
  }

  if (schema.$ref) return `ref(${schema.$ref})`;

  const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
  if (type === 'object' || schema.properties) {
    if (depth >= 2) return 'object';
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    const fields = properties.map(([name, property]) => {
      const optional = required.has(name) ? '' : '?';
      return `${name}${optional}:${summarizeJsonSchema(property, depth + 1)}`;
    });
    return `object{${fields.join(',')}}`;
  }

  if (type === 'array') {
    return `array<${summarizeJsonSchema(schema.items, depth + 1)}>${constraintLabel(schema)}`;
  }

  const base = type ?? 'unknown';
  const defaultValue = schema.default !== undefined ? `=${valueLabel(schema.default)}` : '';
  return `${base}${constraintLabel(schema)}${defaultValue}`;
}

function schemaSummary(schema: RuntimeSchema | undefined, io: 'input' | 'output'): string {
  if (!schema) return io === 'input' ? 'void' : 'inferred';
  if (!schema.toJSONSchema) return schema.def?.type ?? schema._def?.type ?? 'runtime-parser';

  try {
    return summarizeJsonSchema(
      schema.toJSONSchema({ io, unrepresentable: 'any', reused: 'inline' })
    );
  } catch {
    return schema.def?.type ?? schema._def?.type ?? 'runtime-parser';
  }
}

function procedureKind(value: string, path: string): TrpcProcedureKind {
  if (value === 'query' || value === 'mutation' || value === 'subscription') return value;
  throw new Error(`Unsupported tRPC procedure kind ${value} at ${path}`);
}

export function buildTrpcContractManifest(router: unknown): TrpcContractEntry[] {
  const procedures = (router as RuntimeRouter)._def.procedures;

  return Object.entries(procedures)
    .map(([path, procedure]) => ({
      path,
      kind: procedureKind(procedure._def.type, path),
      input:
        procedure._def.inputs.length === 0
          ? 'void'
          : procedure._def.inputs.map(schema => schemaSummary(schema, 'input')).join('&'),
      output: schemaSummary(procedure._def.output, 'output'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export interface TrpcContractDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffTrpcContract(
  expected: readonly TrpcContractEntry[],
  actual: readonly TrpcContractEntry[]
): TrpcContractDiff {
  const expectedByPath = new Map(expected.map(entry => [entry.path, entry]));
  const actualByPath = new Map(actual.map(entry => [entry.path, entry]));

  const added = actual
    .filter(entry => !expectedByPath.has(entry.path))
    .map(entry => entry.path)
    .sort();
  const removed = expected
    .filter(entry => !actualByPath.has(entry.path))
    .map(entry => entry.path)
    .sort();
  const changed = actual
    .filter(entry => {
      const previous = expectedByPath.get(entry.path);
      return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(entry);
    })
    .map(entry => entry.path)
    .sort();

  return { added, removed, changed };
}

export function formatTrpcContractDiff(diff: TrpcContractDiff): string {
  const line = (label: string, paths: readonly string[]) =>
    `${label}: ${paths.length > 0 ? paths.join(', ') : 'none'}`;

  return [
    'tRPC contract snapshot mismatch.',
    line('Added', diff.added),
    line('Removed', diff.removed),
    line('Changed', diff.changed),
    'Review the contract change, then run pnpm --filter @puntovivo/server run contract:snapshot.',
  ].join('\n');
}
