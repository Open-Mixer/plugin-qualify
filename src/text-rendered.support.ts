// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Tests only: a value with every code of plugin-qualify's own in it (a `{ code, args }` whose code schema/codes.json
 * declares) rendered as its English source sentence, so a test can hold a result to the words a person reads.
 */
import { declaredCodes, textOf } from "./text-catalog.js";
import type { TextRef } from "./text-codes.js";

const isOwnRef = (v: unknown): v is TextRef =>
  typeof v === "object" && v !== null && typeof (v as { code?: unknown }).code === "string" && declaredCodes().has((v as TextRef).code);

export function rendered<T>(value: T): T {
  if (isOwnRef(value)) return textOf(value) as T;
  if (Array.isArray(value)) return value.map((v) => rendered(v)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rendered(v)])) as T;
  }
  return value;
}
