// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A wave is built one step above its base wave (OMX_DEVEL_BASE beside OMX_DEVEL_CHANNEL, devel-chain.sh
 * DC_BASE_CHANNEL), and the base serves what the wave does not rebuild. A job that reads the wave's channel and not its
 * base reads staging beneath it, an older layer: ci.yml run 46099457363 (wave devel-wave-2026-11-27-n3 above
 * devel-wave-2026-11-27-bc2) installed plugin-hostd-contract 0.22.1 from staging, domain 0.1.0 without
 * unmeasuredReason, while bc2 served 0.22.2 with domain 0.1.1. So every add-openmixer call that names a devel-channel
 * names the wave's base too, under the same condition (Open-Mixer/.github add-openmixer devel-base, .github#337).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");

interface Call {
  readonly at: string;
  readonly channel: string;
  readonly base: string | undefined;
}

/** Each `devel-channel:` line of a workflow text, with the `devel-base:` line of the same `with:` block. */
export function develCalls(file: string, text: string): Call[] {
  const lines = text.split("\n");
  const calls: Call[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)devel-channel: (.*)$/.exec(line);
    if (!m) return;
    const indent = m[1]!.length;
    let base: string | undefined;
    // the block's other keys sit at the same indent, before and after, up to the first line indented less
    for (const dir of [-1, 1]) {
      for (let j = i + dir; j >= 0 && j < lines.length; j += dir) {
        const l = lines[j]!;
        if (l.trim() === "" || /^\s*#/.test(l)) continue;
        if (l.length - l.trimStart().length < indent) break;
        const b = /^\s*devel-base: (.*)$/.exec(l);
        if (b) base = b[1];
      }
    }
    calls.push({ at: `${file}:${String(i + 1)}`, channel: m[2]!, base });
  });
  return calls;
}

const calls = readdirSync(WORKFLOWS)
  .filter((f) => f.endsWith(".yml"))
  .flatMap((f) => develCalls(f, readFileSync(join(WORKFLOWS, f), "utf8")));

describe("a job that reads a wave's devel channel reads its base wave too", () => {
  it("there are devel-channel calls to judge (ci.yml, publish.yml, release.yml)", () => {
    expect(new Set(calls.map((c) => c.at.split(":")[0]))).toEqual(new Set(["ci.yml", "publish.yml", "release.yml"]));
  });
  it("every devel-channel call names devel-base under the same condition, from OMX_DEVEL_BASE", () => {
    for (const c of calls) {
      expect(c.channel, c.at).toContain("vars.OMX_DEVEL_CHANNEL");
      expect(c.base, `${c.at} names no devel-base`).toBe(c.channel.replace("vars.OMX_DEVEL_CHANNEL", "vars.OMX_DEVEL_BASE"));
    }
  });
  it("sabotage: a call without devel-base, or with another condition, is caught", () => {
    const ok = "      with:\n        devel-channel: ${{ x && vars.OMX_DEVEL_CHANNEL || '' }}\n        devel-base: ${{ x && vars.OMX_DEVEL_BASE || '' }}\n";
    expect(develCalls("w.yml", ok)).toEqual([{ at: "w.yml:2", channel: "${{ x && vars.OMX_DEVEL_CHANNEL || '' }}", base: "${{ x && vars.OMX_DEVEL_BASE || '' }}" }]);
    const none = "      with:\n        devel-channel: ${{ x && vars.OMX_DEVEL_CHANNEL || '' }}\n      - run: true\n        devel-base: y\n";
    expect(develCalls("w.yml", none)[0]!.base).toBeUndefined();
  });
});
