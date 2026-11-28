// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A wave's merge into devel is a push whose build the shared workflows make against that wave's devel channel
 * (OMX_DEVEL_CHANNEL), so the package needs what only that channel serves. release.yml's own install-and-qualify jobs
 * read the same channel on that push, or they install against staging alone and refuse a package the shared install
 * check just installed: 0.22.0's devel release run (46091404282) failed both cells on omx-clap 0.36.0, served by the
 * wave's channel only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const lines = text.split('\n').filter((l) => /^\s*devel-channel: /.test(l));

describe('release.yml install jobs read the wave channel on a push to devel', () => {
  it('there are devel-channel lines to judge', () => {
    expect(lines.length).toBeGreaterThan(0);
  });
  it('every devel-channel line has the push-to-devel arm', () => {
    for (const l of lines) expect(l).toContain("(github.event_name == 'push' && github.ref == 'refs/heads/devel')");
  });
});
