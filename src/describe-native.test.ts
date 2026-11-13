// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * describe, taken in from plugin-hostd (`native/describe.c`), run as built (`make -C native`): its oracle maps the format tables' field dump fixtures onto the
 * exact descriptors they must equal. On CI a missing build is a failure; elsewhere the test skips, saying how to build.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "native");
const ORACLE = join(NATIVE, "build", "describe_test");

describe("describe, live — the format table fixtures", () => {
  it("the oracle passes", (ctx) => {
    if (!existsSync(ORACLE)) {
      if (process.env["CI"]) throw new Error("native/build is missing: CI builds it with make -C native deps all");
      ctx.skip("native/build is missing: make -C native deps all");
      return;
    }
    const r = spawnSync(ORACLE, [], { cwd: NATIVE, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
