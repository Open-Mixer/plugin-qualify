// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The commands under bin/ are plain JavaScript that no compiler checks: a class they construct and never import is a
 * ReferenceError at run time, after the work is done. v0.21.0's plugin-qualify-sync constructed QualificationStore to
 * count the stored plugins without importing it, and every sweep that reached the count stopped with "the run stopped:
 * QualificationStore is not defined" (the release's install check, packaging/check-installed.sh). Every `new X(` in a
 * command names a class the file imports or declares.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const binDir = new URL('../bin/', import.meta.url);
const commands = readdirSync(binDir).filter((f) => f.endsWith('.mjs'));

/** The names a module binds at its top: imports (`{ a, b as c }`, default, namespace) and class, function and const declarations. */
function boundNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s/g)) {
    if (m[1]) names.add(m[1]);
    if (m[2]) names.add(m[2]);
    for (const part of (m[3] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const m of text.matchAll(/\b(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
  return names;
}

/** The globals a command may construct without an import. */
const GLOBALS = new Set(['Error', 'TypeError', 'RangeError', 'Map', 'Set', 'Date', 'URL', 'RegExp', 'Promise', 'Array', 'Uint8Array', 'TextDecoder', 'TextEncoder', 'AbortController']);

describe('the commands construct only what they import', () => {
  it('finds the commands', () => {
    expect(commands).toContain('plugin-qualify-sync.mjs');
  });

  for (const file of commands) {
    it(`bin/${file}: every new X( is imported or declared`, () => {
      const text = readFileSync(new URL(file, binDir), 'utf8');
      const bound = boundNames(text);
      const unbound = [...text.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!).filter((n) => !bound.has(n) && !GLOBALS.has(n));
      expect([...new Set(unbound)]).toEqual([]);
    });
  }
});
