// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A script started through a symlink (a node_modules/.bin link, a linked checkout) must answer as it does by its own
// path: a refusal exits non-zero, never 0 with nothing done.
const scratch = mkdtempSync(join(tmpdir(), "plugin-qualify-entry-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const env = { ...process.env };
delete env["GITHUB_REPOSITORY"];
const run = (path: string) => spawnSync(process.execPath, [path], { cwd: ROOT, encoding: "utf8", env, timeout: 60_000 });

describe("an entry point run through a symlink", () => {
  // the scripts that refuse a run with no argument after loading: a load failure would refuse either way
  for (const script of [
    "packaging/check-repository.mjs",
    "tools/gen-hosting-codes.mjs",
    "tools/gen-text-codes.mjs",
    "tools/release-matrix.mjs",
  ]) {
    it(`${script} refuses as it does by its own path`, () => {
      const link = join(scratch, script.replaceAll("/", "-"));
      symlinkSync(join(ROOT, script), link);
      const direct = run(join(ROOT, script));
      expect(direct.status, `${script} with no argument is expected to refuse`).not.toBe(0);
      const linked = run(link);
      expect(linked.status).toBe(direct.status);
      expect(linked.stderr).toBe(direct.stderr);
    });
  }
});

// Every entry point decides that it was run, not imported, with omx-contract's isMain (real paths on both sides):
// comparing process.argv[1] with import.meta.url by hand misses a symlinked path.
it("no entry point compares process.argv[1] with import.meta.url by hand", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|mts|ts)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ["bin", "packaging", "tools", "src"]) walk(join(ROOT, d));
  const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const hand = files
    .filter((f) => code(f).some((l) => /process\.argv\[1\].*import\.meta\.url|import\.meta\.url.*process\.argv\[1\]/.test(l)))
    .map((f) => relative(ROOT, f));
  expect(hand).toEqual([]);
});
