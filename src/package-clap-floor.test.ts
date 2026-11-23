// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The RPM spec and `debian/control` each declare a CLAP floor independently; nothing
 * ties them together, and they drifted (the spec stayed at 1.2.7 after `debian/control` moved to
 * 1.2.10, #30). This holds them to the same floor.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkClapFloor } from "../packaging/check-clap-floor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "packaging/plugin-qualify.spec"), "utf8");
const CONTROL = readFileSync(join(ROOT, "debian/control"), "utf8");

describe("the spec and debian/control agree on the CLAP floor (#30)", () => {
  it("passes for this tree", () => {
    expect(checkClapFloor(SPEC, CONTROL)).toBeNull();
  });

  it("neither file states a ceiling for CLAP", () => {
    expect(SPEC).not.toMatch(/pkgconfig\(clap\)\s*</);
    expect(CONTROL).not.toMatch(/clap-headers \(<</);
  });

  it("sabotage: the spec's old 1.2.7 floor against debian/control's 1.2.10 fails", () => {
    const sabotaged = SPEC.replace("pkgconfig(clap) >= 1.2.10", "pkgconfig(clap) >= 1.2.7");
    expect(sabotaged).not.toBe(SPEC);
    expect(checkClapFloor(sabotaged, CONTROL)).toBe(
      "the CLAP floor differs: packaging/plugin-qualify.spec has >= 1.2.7; debian/control has >= 1.2.10",
    );
  });

  it("a missing pkgconfig(clap) constraint in the spec fails rather than throwing", () => {
    expect(checkClapFloor("", CONTROL)).toBe("packaging/plugin-qualify.spec: no pkgconfig(clap) constraint found");
  });

  it("a missing clap-headers constraint in debian/control fails rather than throwing", () => {
    expect(checkClapFloor(SPEC, "")).toBe("debian/control: no clap-headers constraint found");
  });
});

/**
 * The script's run guard once compared `import.meta.url` with `file://` + argv[1]: through a symlink, a relative path
 * or a path file URLs encode, the body never ran and the job passed having checked nothing (exit 0, no output).
 */
describe("the script runs, and fails, however it is invoked", () => {
  const scratch = mkdtempSync(join(tmpdir(), "clap-floor-"));
  const tree = (name: string, specFloor: string) => {
    const root = join(scratch, name);
    mkdirSync(join(root, "packaging"), { recursive: true });
    mkdirSync(join(root, "debian"), { recursive: true });
    copyFileSync(join(ROOT, "packaging/check-clap-floor.mjs"), join(root, "packaging/check-clap-floor.mjs"));
    writeFileSync(join(root, "packaging/plugin-qualify.spec"), `BuildRequires: pkgconfig(clap) >= ${specFloor}\n`);
    writeFileSync(join(root, "debian/control"), "Build-Depends: clap-headers (>= 1.2.10~),\n");
    // the script imports isMain from @openmixer/omx-contract: the copy resolves it through this tree's node_modules
    symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"));
    return root;
  };
  const run = (arg: string, cwd: string) => spawnSync(process.execPath, [arg], { cwd, encoding: "utf8" });
  const differs = "the CLAP floor differs: packaging/plugin-qualify.spec has >= 1.2.7; debian/control has >= 1.2.10";

  const bad = tree("bad", "1.2.7");
  const good = tree("good", "1.2.10");
  const badLink = join(scratch, "bad-link.mjs");
  const goodLink = join(scratch, "good-link.mjs");
  symlinkSync(join(bad, "packaging/check-clap-floor.mjs"), badLink);
  symlinkSync(join(good, "packaging/check-clap-floor.mjs"), goodLink);
  const spaced = join(scratch, "a b#c");
  mkdirSync(spaced);
  const odd = tree("a b#c/tree", "1.2.7");

  it("a differing tree through a symlink exits 1 naming the difference", () => {
    const r = run(badLink, scratch);
    expect(r.stderr).toContain(differs);
    expect(r.status).toBe(1);
  });

  it("a differing tree through a relative path exits 1", () => {
    const r = run(relative(bad, join(bad, "packaging/check-clap-floor.mjs")), bad);
    expect(r.stderr).toContain(differs);
    expect(r.status).toBe(1);
  });

  it("a differing tree under a path file URLs encode exits 1", () => {
    const r = run(join(odd, "packaging/check-clap-floor.mjs"), scratch);
    expect(r.stderr).toContain(differs);
    expect(r.status).toBe(1);
  });

  it("an agreeing tree through a symlink exits 0 and says so", () => {
    const r = run(goodLink, scratch);
    expect(r.stdout).toContain("agree on the CLAP floor");
    expect(r.status).toBe(0);
  });

  it("cleanup", () => {
    rmSync(scratch, { recursive: true, force: true });
  });
});
