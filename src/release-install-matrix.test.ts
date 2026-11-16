// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * release.yml's `installed` matrix downloads the artifacts the `deb` and `rpm` builds upload. A cell for a target
 * the build no longer makes finds no artifact and the dry run fails "Artifact not found" (debian:bookworm, 0.20.5).
 * The build's suites are declared once, as the deb job's `suite-matrix`; every Debian install cell must name one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

/** The Debian suites the deb job builds: its `suite-matrix:` JSON array. */
function builtSuites(workflow: string): string[] {
  const m = /^\s*suite-matrix:\s*'(\[[^\]]*\])'/m.exec(workflow);
  expect(m, 'the deb job declares suite-matrix explicitly').not.toBeNull();
  return JSON.parse(m![1]!) as string[];
}

/** The `artifact:` names of the install matrix cells. */
function installArtifacts(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*- \{ image: [^,]+, artifact: (\S+) \}/gm)].map((m) => m[1]!);
}

describe('release.yml install matrix is covered by the build matrix', () => {
  it('every Debian install cell names a suite the deb job builds', () => {
    const suites = builtSuites(text);
    const debs = installArtifacts(text).filter((a) => a.includes('-debs-'));
    expect(debs.length).toBeGreaterThan(0);
    for (const artifact of debs) {
      const suite = /-debs-([a-z]+)-/.exec(artifact)![1]!;
      expect(suites, `install cell ${artifact} has no build cell`).toContain(suite);
    }
  });
});
