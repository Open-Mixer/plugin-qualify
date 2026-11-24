// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Every file the package ships that starts with `#!` is executable in git. packaging/build.sh installs the files
 * `npm pack` picks, and npm pack keeps each file's mode, so a script tracked as 0644 lands in the DEB as a
 * non-executable script; lintian names it `script-not-executable`, and the shared build-deb runs lintian with
 * `--fail-on warning`. v0.21.0's arm64 DEB failed exactly so on tools/gen-dsp-rates.mjs and was never served.
 * The shipped set is package.json's `files`, read the way npm reads it for the directories this package lists.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { files: string[] };

/** A `files` pattern as a regular expression over a repo-relative path: `**`, `*` and a bare directory prefix. */
function patternOf(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^(?:.*/)?${body}(?:/.*)?$`);
}

const include = pkg.files.filter((f) => !f.startsWith('!')).map((f) => new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|$)`));
const exclude = pkg.files.filter((f) => f.startsWith('!')).map((f) => patternOf(f.slice(1)));

/** `git ls-files -s`: mode and path of every tracked file. */
const tracked = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t') as [string, string];
    return { mode: meta.split(' ')[0]!, path };
  });

const shipped = tracked.filter(({ path }) => include.some((re) => re.test(path)) && !exclude.some((re) => re.test(path)));

describe('the scripts the package ships are executable', () => {
  it('reads a shipped set that holds the tools', () => {
    expect(shipped.map((f) => f.path)).toContain('tools/gen-hosting-codes.mjs');
    expect(shipped.map((f) => f.path)).not.toContain('tools/test_scan.py');
  });

  it('every shipped file that starts with #! is tracked 100755', () => {
    const notExecutable = shipped
      .filter(({ mode }) => mode === '100644')
      .filter(({ path }) => readFileSync(new URL(path, root)).subarray(0, 2).toString('latin1') === '#!')
      .map(({ path }) => path);
    expect(notExecutable).toEqual([]);
  });
});
