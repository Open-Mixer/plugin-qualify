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
    expect(text).toMatch(/matrix: \$\{\{ fromJSON\(needs\.matrix\.outputs\.install\) \}\}/);
    expect(text).toMatch(/suite-matrix: \$\{\{ needs\.matrix\.outputs\.deb-suites \}\}/);
    expect(text).toMatch(/fedora-versions: \$\{\{ needs\.matrix\.outputs\.rpm-fedora \}\}/);
    expect(text).toMatch(/arch-matrix: \$\{\{ needs\.matrix\.outputs\.deb-arches \}\}/);
    expect(text).toMatch(/arch-matrix: \$\{\{ needs\.matrix\.outputs\.rpm-arches \}\}/);
  });

  it('every install cell has a build cell', () => {
    for (const arm of [true, false]) {
      const m = deriveMatrix(DECL, { arm });
      const built = builtArtifacts(m);
      expect(m.install.length).toBeGreaterThan(0);
      for (const cell of m.install) expect(built, `install cell ${cell.artifact} has no build cell`).toContain(cell.artifact);
    }
  });

  it('fixture: a target dropped from the declaration is gone from the install cells', () => {
    const before = deriveMatrix({ ...DECL, deb: { ...DECL.deb, suites: ['trixie', 'bookworm'] } }, { arm: true });
    expect(before.install.map((c) => c.image)).toContain('debian:bookworm');
    const after = deriveMatrix(DECL, { arm: true });
    expect(after.install.map((c) => c.image)).not.toContain('debian:bookworm');
    expect(after.install.map((c) => c.artifact)).toEqual(['plugin-qualify-rpms-fc45-x86_64', 'plugin-qualify-debs-trixie-amd64']);
  });

  it('a pull request without arm builds the first architecture alone, and the install still has its cell', () => {
    const m = deriveMatrix(DECL, { arm: false });
    expect(m.debArches).toEqual(['amd64']);
    expect(m.rpmArches).toEqual(['x86_64']);
    expect(m.install).toHaveLength(2);
  });
});
