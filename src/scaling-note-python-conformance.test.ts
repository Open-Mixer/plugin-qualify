// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `benchmark.py`'s `scaling_note` writes `latency.scalingNote`; the words it may write are the
 * ones `SCALING_NOTE_TERMS` declares (lv2-measurement-interchange §5). Python cannot import the
 * vocabulary, so this file ties the function's returned notes to it: the function names each note by its title in the
 * qualification domain (plugin-hostd's, read installed), `_scaling_note_word("belowBudget")`, and a note added, renamed or
 * withdrawn on either side alone turns it red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCALING_NOTE_TERMS } from './measurement/vocabulary.js';
import { qualificationDomain } from './qualification-domain.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCHMARK_PY = join(PKG, 'tools/benchmark.py');

/** The words `def scaling_note` returns, sorted: the domain's word for each title it names — its body runs to the next top-level `def`. */
function pythonScalingNotes(source: string): string[] {
  const start = source.indexOf('\ndef scaling_note(');
  if (start < 0) return [];
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\ndef ', 1);
  const body = end < 0 ? rest : rest.slice(0, end);
  const words = new Map(qualificationDomain().entries('QUALIFICATION_MEASUREMENT_LATENCY_SCALING_NOTES').map((e) => [e.title, e.word]));
  return [...new Set([...body.matchAll(/\breturn\s+_scaling_note_word\("([^"]+)"\)/g)].map((m) => words.get(m[1]!) ?? `no-such-title:${m[1]!}`))].sort();
}

const declared = (): string[] => SCALING_NOTE_TERMS.map((t) => t.code).sort();

describe('benchmark.py writes only the declared scaling notes', () => {
  it('the reader finds the function and its notes — positive control', () => {
    expect(pythonScalingNotes(readFileSync(BENCHMARK_PY, 'utf8')).length).toBeGreaterThan(0);
  });

  it('a renamed literal is seen as a difference — sabotage control', () => {
    const moved = readFileSync(BENCHMARK_PY, 'utf8').replace('return _scaling_note_word("informationalRate")', 'return _scaling_note_word("movedNote")');
    expect(pythonScalingNotes(moved)).not.toEqual(declared());
  });

  it("scaling_note's returned words are exactly SCALING_NOTE_TERMS' codes", () => {
    expect(pythonScalingNotes(readFileSync(BENCHMARK_PY, 'utf8'))).toEqual(declared());
  });
});
