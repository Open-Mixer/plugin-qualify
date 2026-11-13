// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A FILE OF THIS REPOSITORY A SOURCE CITES EXISTS (#55). `src/record-figures.ts` cited `tools/record_figures.py`
 * as the Python reader of a record's figures and `record-figures-python-conformance.test.ts` as what held the two
 * equal; neither was ever on main, so a reader of the source was sent to code that does not exist.
 *
 * Judged: this repository's own Python tools (`tools/<name>.py`) and its own tests (`<name>.test.ts`, under src/),
 * as the non-test sources under src/ cite them. A path into another repository (plugin-hostd's `src/history.c`,
 * omx-clap-core's `src/clap_host.c`) is that repository's to keep and is not judged here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(PKG, 'src');

/** Every `tools/<name>.py` and `<name>.test.ts` a text cites, as repository paths. */
export function citedFiles(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`(tools\/[A-Za-z0-9_-]+\.py)`/g)) found.add(m[1]!);
  for (const m of text.matchAll(/`(?:src\/)?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9-]+)*\.test\.ts)`/g)) found.add(`src/${m[1]!}`);
  return [...found];
}

function sources(): { file: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: `src/${f}`, text: readFileSync(join(SRC, f), 'utf8') }));
}

function dangling(): string[] {
  return sources().flatMap(({ file, text }) =>
    citedFiles(text)
      .filter((p) => !existsSync(join(PKG, p)))
      .map((p) => `${file} cites ${p}, which does not exist`),
  );
}

describe('a file of this repository a source cites exists', () => {
  it('the sources cite tools and tests at all — positive control', () => {
    const cited = sources().flatMap(({ text }) => citedFiles(text));
    expect(cited).toContain('tools/_declarations.py');
    expect(cited.some((p) => p.endsWith('.test.ts'))).toBe(true);
  });

  it('SABOTAGE: a planted citation of a missing Python reader and a missing test are both found', () => {
    const planted = citedFiles('see `tools/no_such_reader.py`, held equal by `no-such-conformance.test.ts`');
    expect(planted).toEqual(['tools/no_such_reader.py', 'src/no-such-conformance.test.ts']);
    expect(planted.filter((p) => !existsSync(join(PKG, p)))).toEqual(planted);
  });

  it('no non-test source under src/ cites a tools/*.py or a *.test.ts this repository does not have', () => {
    expect(dangling()).toEqual([]);
  });
});
