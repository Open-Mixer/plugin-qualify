// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Ruling D25: a CI matrix follows the release set, never a hand list. bookworm is a full cell, built and served its
 * floors only by the wave-end full release; while the organisation variable OMX_RELEASE_MATRIX is quick it cannot
 * meet a floor released quick-only, so a hand-written bookworm cell turns a tag or a pull request red. A workflow
 * line that names bookworm outside a comment chooses it through OMX_RELEASE_MATRIX on that same line. release.yml's
 * tag-time cells (the install-and-qualify matrix) are workflows too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../.github/workflows/', import.meta.url);

/** Every line of a workflow that names bookworm outside a comment without choosing it through OMX_RELEASE_MATRIX. */
function handBookworm(name: string, text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line) && /bookworm/.test(line) && !/OMX_RELEASE_MATRIX/.test(line))
    .map(({ line, n }) => `${name}:${n}: ${line.trim()}`);
}

describe('CI matrices follow the release set (D25)', () => {
  it('no workflow names bookworm outside the OMX_RELEASE_MATRIX switch', () => {
    const bad = readdirSync(DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => handBookworm(f, readFileSync(new URL(f, DIR), 'utf8')));
    expect(bad, 'a hand-written bookworm cell: CI follows the release set (vars.OMX_RELEASE_MATRIX)').toEqual([]);
  });

  it('is red on a hand bookworm cell, green on the switch and on a comment', () => {
    expect(handBookworm('x', '      matrix:\n        suite: [bookworm, trixie]\n')).toHaveLength(1);
    expect(handBookworm('x', "          - { image: 'debian:bookworm', artifact: plugin-qualify-debs-bookworm-amd64 }\n")).toHaveLength(1);
    expect(handBookworm('x', '        # bookworm is a full cell\n')).toHaveLength(0);
    expect(
      handBookworm('x', `        suite: \${{ fromJSON(vars.OMX_RELEASE_MATRIX == 'full' && '["bookworm", "trixie"]' || '["trixie"]') }}\n`),
    ).toHaveLength(0);
  });
});
