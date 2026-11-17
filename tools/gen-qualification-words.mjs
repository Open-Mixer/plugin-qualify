#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * gen-qualification-words.mjs: `src/qualification-vocabulary.generated.ts` and `native/qualification_vocabulary.h`, the TypeScript and C renders of this package's
 * `qualification` domain (contract.d/qualification/qualification.json, owner plugin-qualify), as `as const` data: the
 * words of a measurement (how a figure was taken, why it is absent, what a verdict says) and the resource words a
 * profile names. omx-contract owns the renderer, never the words (omx-contract#81).
 *
 * Usage:
 *   node tools/gen-qualification-words.mjs --check   # exit 1 if the committed file is stale
 *   node tools/gen-qualification-words.mjs --write   # (re)write it
 * The omx-contract command is $OMX_CONTRACT_BIN (a path to bin/omx-contract.mjs, run by node), else `omx-contract`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(PKG, 'src/qualification-vocabulary.generated.ts');
/** The C render the LV2 measurer includes (native/lv2-measure.c): the same words, as macros. */
export const OUT_C = join(PKG, 'native/qualification_vocabulary.h');

/** The C header's text: the render of the domain, unchanged. */
export function qualificationHeaderFile() {
  const bin = process.env.OMX_CONTRACT_BIN;
  const [cmd, ...pre] = bin ? [process.execPath, bin] : ['omx-contract'];
  const dir = mkdtempSync(join(tmpdir(), 'qualification-words-'));
  try {
    execFileSync(cmd, [...pre, 'render', '--target', 'c', '--package', 'qualification', '--contract-dir', join(PKG, 'contract.d'), '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    return readFileSync(join(dir, 'qualification_vocabulary.h'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The module's text: the render of the domain, every top-level literal `as const`. */
export function qualificationWordsFile() {
  const bin = process.env.OMX_CONTRACT_BIN;
  const [cmd, ...pre] = bin ? [process.execPath, bin] : ['omx-contract'];
  const dir = mkdtempSync(join(tmpdir(), 'qualification-words-'));
  try {
    execFileSync(cmd, [...pre, 'render', '--target', 'ts', '--package', 'qualification', '--contract-dir', join(PKG, 'contract.d'), '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    const js = readFileSync(join(dir, 'qualification-vocabulary.js'), 'utf8');
    const ts = js.replace(/^\};$/gm, '} as const;').replace(/^\];$/gm, '] as const;');
    return `${ts.trimEnd()}\n`.replace('do not edit.', 'do not edit (tools/gen-qualification-words.mjs).');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') { console.error('usage: gen-qualification-words.mjs --check | --write'); process.exit(2); }
  for (const [out, text] of [[OUT, qualificationWordsFile()], [OUT_C, qualificationHeaderFile()]]) {
    if (mode === '--write') writeFileSync(out, text);
    else if (readFileSync(out, 'utf8') !== text) { console.error(`${out} is stale: run node tools/gen-qualification-words.mjs --write`); process.exit(1); }
  }
}
