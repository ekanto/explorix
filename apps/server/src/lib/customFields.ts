import type { CustomFieldEntity, PrismaClient } from '@prisma/client';
import type { Tx } from '../db.js';
import { AppError } from './errors.js';

type Db = Tx | PrismaClient;

/**
 * Validates and normalizes custom field values against the project's field
 * definitions. Unknown keys are rejected; empty values remove the key.
 */
export async function validateCustomFields(
  db: Db,
  projectId: string,
  entity: CustomFieldEntity,
  input: unknown,
  existing: unknown = {},
): Promise<Record<string, unknown>> {
  const defs = await db.customFieldDefinition.findMany({ where: { projectId, entity, archivedAt: null } });
  const values: Record<string, unknown> = { ...((existing as Record<string, unknown>) ?? {}) };
  const errors: { path: string; message: string }[] = [];
  if (input !== undefined && input !== null) {
    if (typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'validation_error', 'customFields must be an object');
    for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
      const def = defs.find((d) => d.key === key);
      if (!def) {
        errors.push({ path: `customFields.${key}`, message: 'Unknown custom field' });
        continue;
      }
      if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
        delete values[key];
        continue;
      }
      const fail = (m: string) => errors.push({ path: `customFields.${key}`, message: `${def.label}: ${m}` });
      switch (def.type) {
        case 'TEXT':
        case 'TEXTAREA':
          if (typeof raw !== 'string' || raw.length > (def.type === 'TEXT' ? 500 : 10_000)) fail('must be text');
          else values[key] = raw;
          break;
        case 'NUMBER': {
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) fail('must be a number');
          else values[key] = n;
          break;
        }
        case 'CHECKBOX':
          if (typeof raw !== 'boolean') fail('must be true or false');
          else values[key] = raw;
          break;
        case 'DATE':
          if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) fail('must be a date');
          else values[key] = raw.slice(0, 10);
          break;
        case 'URL':
          try {
            const u = new URL(String(raw));
            if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
            values[key] = u.toString();
          } catch {
            fail('must be an http(s) URL');
          }
          break;
        case 'SELECT':
          if (typeof raw !== 'string' || !def.options.includes(raw)) fail(`must be one of: ${def.options.join(', ')}`);
          else values[key] = raw;
          break;
        case 'MULTI_SELECT':
          if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !def.options.includes(x))) {
            fail(`values must be from: ${def.options.join(', ')}`);
          } else values[key] = Array.from(new Set(raw));
          break;
      }
    }
  }
  for (const def of defs) {
    if (def.required && (values[def.key] === undefined || values[def.key] === null)) {
      errors.push({ path: `customFields.${def.key}`, message: `${def.label} is required` });
    }
  }
  if (errors.length) throw new AppError(400, 'validation_error', 'Invalid custom field values', { fields: errors });
  return values;
}
