import { createHash } from 'node:crypto';

export class Refusal extends Error {
  constructor(code: string) { super(code); this.name = 'Refusal'; }
}
export function requireThat(value: unknown, code: string): asserts value {
  if (!value) throw new Refusal(code);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'shape');
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(Reflect.ownKeys(value).length === keys.length, 'fields');
  for (const key of keys) requireThat(Object.hasOwn(descriptors, key) && 'value' in descriptors[key]!, 'fields');
  return value as Record<string, unknown>;
}
export function text(value: unknown, pattern: RegExp, max = 128): string {
  requireThat(typeof value === 'string' && value.length <= max && pattern.test(value), 'text');
  requireThat(value === value.normalize('NFKC') && !/[^\x20-\x7e]/.test(value), 'unicode');
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  requireThat(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'integer');
  return value;
}
export function literal<T extends string | boolean | number>(value: unknown, allowed: readonly T[]): T {
  requireThat(allowed.includes(value as T), 'unsupported'); return value as T;
}
function plainArray(value: unknown): asserts value is unknown[] {
  requireThat(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'array');
  requireThat(Reflect.ownKeys(value).length === value.length + 1, 'array');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    requireThat(descriptor && 'value' in descriptor, 'array');
  }
}
export function list<T>(value: unknown, min: number, max: number, parse: (v: unknown) => T): T[] {
  plainArray(value);
  requireThat(value.length >= min && value.length <= max, 'array');
  return value.map(parse);
}
export const id = (v: unknown) => text(v, /^fixture-[a-z0-9-]{1,64}$/);
export const company = (v: unknown) => text(v, /^fixture-company-[a-z0-9-]{1,40}$/);
export const hex = (v: unknown) => text(v, /^[a-f0-9]{64}$/);
export function utc(v: unknown): string {
  const result = text(v, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  requireThat(Number.isFinite(Date.parse(result)) && new Date(result).toISOString() === result, 'time');
  return result;
}

// A single serialization version: closed plain JSON, sorted keys, ordered arrays, ASCII strings.
// ASCII tokens intentionally exclude Unicode confusables; this is not a free-prose PII detector.
export function canonical(value: unknown, maxBytes = 2 * 1024 * 1024): string {
  let budget = maxBytes;
  function walk(v: unknown, depth: number): string {
    requireThat(depth <= 24, 'depth');
    requireThat(--budget >= 0, 'json-cap');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') { integer(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); return JSON.stringify(v); }
    if (typeof v === 'string') {
      requireThat(v.length <= budget, 'json-cap'); budget -= v.length;
      text(v, /^[\x20-\x7e]*$/, maxBytes); return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      requireThat(v.length <= Math.min(3300, budget), 'array-cap');
      plainArray(v);
      return '[' + v.map(x => walk(x, depth + 1)).join(',') + ']';
    }
    requireThat(v !== null && typeof v === 'object', 'json');
    const keys = Object.keys(v).sort(); requireThat(keys.length <= 256, 'object-cap'); object(v, keys);
    return '{' + keys.map(k => {
      requireThat(!['__proto__', 'prototype', 'constructor'].includes(k), 'prototype');
      return walk(k, depth + 1) + ':' + walk((v as Record<string, unknown>)[k], depth + 1);
    }).join(',') + '}';
  }
  const result = walk(value, 0);
  requireThat(Buffer.byteLength(result) <= maxBytes, 'json-cap'); return result;
}
export function digest(value: unknown): string { return sha256(Buffer.from(canonical(value))); }
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
