/**
 * Generates TypeScript types directly from api/openapi.json (OpenAPI 3.0.3).
 * Usage:
 *   node scripts/generate_api_types.mjs
 *   node scripts/generate_api_types.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const openapiPath = path.join(rootDir, 'api', 'openapi.json');
const outPath = path.join(rootDir, 'src', 'api', 'openapi.types.ts');

const raw = fs.readFileSync(openapiPath, 'utf8');
const spec = JSON.parse(raw);

function resolveSchema(schema, indent = '') {
  if (!schema) return 'unknown';
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    return schema.nullable ? `${name} | null` : name;
  }
  if (schema.allOf) {
    const inner = schema.allOf.map((s) => resolveSchema(s, indent)).join(' & ');
    return schema.nullable ? `(${inner}) | null` : inner;
  }
  let baseType = 'unknown';
  if (schema.enum) {
    baseType = schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  } else if (schema.type === 'string') {
    baseType = 'string';
  } else if (schema.type === 'integer' || schema.type === 'number') {
    baseType = 'number';
  } else if (schema.type === 'boolean') {
    baseType = 'boolean';
  } else if (schema.type === 'array') {
    baseType = `Array<${resolveSchema(schema.items, indent)}>`;
  } else if (schema.type === 'object' || schema.properties) {
    const props = schema.properties ?? {};
    const req = new Set(schema.required ?? []);
    const nextIndent = `${indent}  `;
    const lines = Object.entries(props).map(([key, propSchema]) => {
      const optional = req.has(key) ? '' : '?';
      const tsType = resolveSchema(propSchema, nextIndent);
      const comment = propSchema.description ? `${nextIndent}/** ${propSchema.description} */\n` : '';
      return `${comment}${nextIndent}${key}${optional}: ${tsType};`;
    });
    baseType = lines.length ? `{\n${lines.join('\n')}\n${indent}}` : 'Record<string, never>';
  } else if (schema.nullable) {
    return 'null';
  }
  if (schema.nullable && baseType !== 'null') {
    return `${baseType} | null`;
  }
  return baseType;
}

const lines = [
  '/* eslint-disable */',
  '// AUTO-GENERATED FROM api/openapi.json BY scripts/generate_api_types.mjs — DO NOT EDIT MANUALLY.',
  '',
  'export interface ApiSuccessEnvelope<T> {',
  '  code: 0;',
  '  message: string;',
  '  data: T;',
  '  request_id: string;',
  '}',
  '',
  'export interface ApiErrorEnvelope<T = null> {',
  '  code: number;',
  '  message: string;',
  '  data: T;',
  '  request_id: string;',
  '}',
  '',
];

const schemas = spec.components?.schemas ?? {};
for (const [name, schema] of Object.entries(schemas)) {
  const tsBody = resolveSchema(schema, '');
  if (schema.type === 'object' && !schema.enum) {
    lines.push(`export interface ${name} ${tsBody}`);
  } else {
    lines.push(`export type ${name} = ${tsBody};`);
  }
  lines.push('');
}

// Collect all error codes declared in components.responses
const errorCodeSet = new Set([0]);
for (const resp of Object.values(spec.components?.responses ?? {})) {
  for (const c of resp['x-error-codes'] ?? []) {
    errorCodeSet.add(c);
  }
}
const sortedCodes = Array.from(errorCodeSet).sort((a, b) => a - b);
lines.push(`export type ApiCode = ${sortedCodes.join(' | ')};`);
lines.push('');

// Generate operation metadata map from paths
lines.push('export const OPENAPI_OPERATIONS = {');
for (const [routePath, methods] of Object.entries(spec.paths ?? {})) {
  for (const [httpMethod, op] of Object.entries(methods)) {
    if (!op || typeof op !== 'object' || !op.operationId) continue;
    const requiresCsrf = Array.isArray(op.security) && op.security.some((sec) => 'CSRFToken' in sec);
    const requiresAdminSession =
      Array.isArray(op.security) && op.security.some((sec) => 'AdminSession' in sec);
    lines.push(
      `  ${op.operationId}: { method: ${JSON.stringify(httpMethod.toUpperCase())}, path: ${JSON.stringify(routePath)}, requiresAdminSession: ${requiresAdminSession}, requiresCsrf: ${requiresCsrf} },`,
    );
  }
}
lines.push('} as const;');
lines.push('');
lines.push('export type OperationId = keyof typeof OPENAPI_OPERATIONS;');
lines.push('');

const output = lines.join('\n');

if (process.argv.includes('--check')) {
  if (!fs.existsSync(outPath)) {
    console.error(`Missing generated file: ${outPath}`);
    process.exit(1);
  }
  const current = fs.readFileSync(outPath, 'utf8');
  if (current !== output) {
    console.error('src/api/openapi.types.ts is out of sync with api/openapi.json');
    process.exit(1);
  }
  console.log('src/api/openapi.types.ts is in sync with api/openapi.json');
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Generated ${path.relative(rootDir, outPath)} from api/openapi.json`);
