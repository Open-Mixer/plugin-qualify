// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * release.yml's `installed` job downloads the artifacts the `rpm` and `deb` builds upload. It used to list its cells by
 * hand beside the build's, and a cell for a target the build no longer made (debian:bookworm, 0.20.5) found no artifact:
 * "Artifact not found" (#98). The targets are declared once, in .github/release-matrix.json; a `matrix` job derives
 * what the builds and the install read from it (tools/release-matrix.mjs), so a target dropped from the declaration is
 * dropped from the install with it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveMatrix } from '../tools/release-matrix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const DECL = JSON.parse(readFileSync(join(ROOT, '.github/release-matrix.json'), 'utf8')) as Parameters<typeof deriveMatrix>[0];

/** The artifact names the builds upload for a derived matrix (build-rpm.yml, build-deb.yml: `<pkg>-<kind>-<release>-<arch>`). */
function builtArtifacts(m: ReturnType<typeof deriveMatrix>): string[] {
  return [
    ...m.rpmFedora.flatMap((f) => m.rpmArches.map((a) => `plugin-qualify-rpms-fc${f}-${a}`)),
    ...m.debSuites.flatMap((s) => m.debArches.map((a) => `plugin-qualify-debs-${s}-${a}`)),
  ];
}

describe('release.yml reads one declaration of its targets (#98)', () => {
  it('the workflow lists no install cell of its own: build and install read the matrix job', () => {
    expect(text).not.toMatch(/^\s*- \{ image: /m);
    expect(text).toMatch(/cell: \$\{\{ fromJSON\(needs\.matrix\.outputs\.cells\) \}\}/);
    expect(text).toMatch(/suite-matrix: \$\{\{ needs\.matrix\.outputs\.deb-suites \}\}/);
    expect(text).toMatch(/fedora-versions: \$\{\{ needs\.matrix\.outputs\.rpm-fedora \}\}/);
    expect(text).toMatch(/arch-matrix: \$\{\{ needs\.matrix\.outputs\.deb-arches \}\}/);
    expect(text).toMatch(/arch-matrix: \$\{\{ needs\.matrix\.outputs\.rpm-arches \}\}/);
  });

  it('every install cell has a build cell', () => {
    for (const arm of [true, false]) {
      const m = deriveMatrix(DECL, { arm });
      const built = builtArtifacts(m);
      expect(m.installRpmArches.length).toBeGreaterThan(0);
      expect(m.installDebArches.length).toBeGreaterThan(0);
      for (const f of m.rpmFedora) for (const a of m.installRpmArches) expect(built).toContain(`plugin-qualify-rpms-fc${f}-${a}`);
      for (const s of m.debSuites) for (const a of m.installDebArches) expect(built).toContain(`plugin-qualify-debs-${s}-${a}`);
    }
  });

  it('fixture: a target dropped from the declaration is gone from the build cells the install reads', () => {
    const before = deriveMatrix({ ...DECL, deb: { ...DECL.deb, suites: ['trixie', 'bookworm'] } }, { arm: true });
    expect(before.debSuites).toContain('bookworm');
    expect(deriveMatrix(DECL, { arm: true }).debSuites).not.toContain('bookworm');
  });

  it('a pull request without arm builds the first architecture alone, and the install still has its arch', () => {
    const m = deriveMatrix(DECL, { arm: false });
    expect(m.debArches).toEqual(['arm64']);
    expect(m.rpmArches).toEqual(['x86_64']);
    expect(m.installDebArches).toEqual(['arm64']);
    expect(m.installRpmArches).toEqual(['x86_64']);
  });

  it('the install job takes its cells, and the runner of each, from check-matrix (#130)', () => {
    expect(text).toMatch(/uses: Open-Mixer\/\.github\/\.github\/actions\/check-matrix@openmixer-v1/);
    expect(text).toMatch(/runs-on: \$\{\{ matrix\.cell\.runner \}\}/);
    expect(text).toMatch(/x86-runner: \$\{\{ vars\.OMX_RUNNER \|\| 'ubuntu-latest' \}\}/);
    expect(text).not.toMatch(/amd64\.deb|plugin-qualify-debs-trixie-amd64/);
  });

  it('the declaration lists arm64 first, so the quick build and the install cell are arm64 (#130)', () => {
    expect(DECL.deb.arches[0]).toBe('arm64');
    expect(deriveMatrix(DECL, { arm: false }).installDebArches).toEqual(['arm64']);
    // fixture: amd64 first is the case the quick set never builds ("Artifact not found")
    const planted = deriveMatrix({ ...DECL, deb: { ...DECL.deb, arches: ['amd64', 'arm64'] } }, { arm: false });
    expect(planted.installDebArches).toEqual(['amd64']);
  });

  it('the install cells name the first architecture of each kind, for check-matrix to give a runner', () => {
    const m = deriveMatrix(DECL, { arm: true });
    expect(m.installRpmArches).toEqual(['x86_64']);
    expect(m.installDebArches).toEqual(['arm64']);
  });

  it('the rpm target is Fedora 45 alone, and its built artifact is fc45 (no fc44)', () => {
    const m = deriveMatrix(DECL, { arm: true });
    expect(m.rpmFedora).toEqual(['45']);
    const built = builtArtifacts(m);
    expect(built).toContain('plugin-qualify-rpms-fc45-x86_64');
    expect(built.some((a: string) => a.includes('fc44'))).toBe(false);
  });
});
