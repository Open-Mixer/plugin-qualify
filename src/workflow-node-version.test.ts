// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * NODE 26 EVERYWHERE (#158). Every job that runs Node runs Node 26: an `actions/setup-node` step asks for
 * `node-version: 26`, and a Fedora container installs `nodejs26` (Fedora 45's plain `nodejs` is Node 22). The
 * Containerfile is held to the same, since it installs Node the way the container jobs do.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const NODE_MAJOR = '26';
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const FILES = [
  ...readdirSync(new URL('../.github/workflows/', import.meta.url))
    .filter((f) => f.endsWith('.yml'))
    .map((f) => `.github/workflows/${f}`),
  'Containerfile',
];

/** The Node each file asks for, one finding a line: the node-version of a setup-node step, a Fedora node package. */
export function nodeFindings(text: string): { line: number; asks: string }[] {
  const found: { line: number; asks: string }[] = [];
  text.split('\n').forEach((line, i) => {
    const version = /^\s*node-version:\s*['"]?([^'"\s#]+)/.exec(line);
    if (version) found.push({ line: i + 1, asks: `node-version ${version[1]}` });
    if (/\bdnf\b.*\binstall\b|^\s+[a-z0-9-]+( [a-z0-9-]+)*\s*\\$/.test(line)) {
      for (const pkg of line.matchAll(/(?<![\w-])(nodejs\d*)(?![\w-])/g)) found.push({ line: i + 1, asks: `package ${pkg[1]}` });
    }
  });
  return found;
}

const wanted = (asks: string): boolean => asks === `node-version ${NODE_MAJOR}` || asks === `package nodejs${NODE_MAJOR}`;

describe('Node 26 everywhere (#158)', () => {
  it('the workflows and the Containerfile ask for Node at all — positive control', () => {
    const all = FILES.flatMap((f) => nodeFindings(read(f)));
    expect(all.filter((a) => a.asks.startsWith('node-version')).length).toBeGreaterThanOrEqual(5);
    expect(all.filter((a) => a.asks.startsWith('package')).length).toBeGreaterThanOrEqual(3);
  });

  it('SABOTAGE: a setup-node at 22 and a bare nodejs in a dnf install are both found', () => {
    const planted = nodeFindings(
      ['      - uses: actions/setup-node@v4', '        with:', '          node-version: 22', '      - run: dnf install -y git nodejs npm'].join('\n'),
    );
    expect(planted.map((a) => a.asks)).toEqual(['node-version 22', 'package nodejs']);
    expect(planted.filter((a) => !wanted(a.asks))).toHaveLength(2);
  });

  it('every one asks for Node 26', () => {
    const off = FILES.flatMap((f) => nodeFindings(read(f)).filter((a) => !wanted(a.asks)).map((a) => `${f}:${a.line}: ${a.asks}`));
    expect(off).toEqual([]);
  });
});
