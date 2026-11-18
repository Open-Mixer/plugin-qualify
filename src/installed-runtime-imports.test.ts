// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Every package the built program imports at run time reaches the installed tree: the one dependency copied beside
 * the package (@openmixer/omx-contract) and the ones packaging/build.sh copies into the package's own node_modules.
 * A bare import in the shipped code (a type-only import is erased) that neither names would fail at start-up on an
 * installed machine, as ajv did for the qualification domain's reader.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = readdirSync(join(PKG, "src")).filter((f) => f.endsWith(".ts") && !/\.(test|support)\./.test(f) && f !== "test-setup.ts" &&!f.endsWith(".d.ts"));

/** The package names of the runtime (not `import type`) bare imports of a source file. */
function runtimeImports(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/^(?:import|export)\s(?!type\s)[^;]*?from\s+"([^".][^"]*)"/gms)) {
    const spec = m[1] ?? "";
    if (spec.startsWith("node:")) continue;
    names.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0] ?? spec);
  }
  return [...names];
}

describe("the installed package carries what it imports", () => {
  it("the shipped code's bare imports are all dependencies that build.sh puts in the installed tree", () => {
    const build = readFileSync(join(PKG, "packaging/build.sh"), "utf8");
    const deps = Object.keys((JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies);
    const wanted = new Set<string>();
    for (const f of SHIPPED) for (const n of runtimeImports(readFileSync(join(PKG, "src", f), "utf8"))) wanted.add(n);
    expect([...wanted].length).toBeGreaterThan(0);
    for (const n of wanted) {
      expect(deps, `${n} is imported at run time, so it is a dependency`).toContain(n);
      expect(build, `packaging/build.sh copies ${n} into the installed tree`).toContain(n === "@openmixer/omx-contract" ? n : `node_modules/${n}`);
    }
  });
});

describe("the bundled dependency trees carry only what the packages publish", () => {
  it("build.sh's pruning step removes dotfiles, spec and test directories from every bundled package", () => {
    const build = readFileSync(join(PKG, "packaging/build.sh"), "utf8");
    const step = /^# bundled-prune begin\n([\s\S]*?)^# bundled-prune end$/m.exec(build)?.[1];
    expect(step, "build.sh marks its pruning step (bundled-prune begin/end)").toBeDefined();
    const mods = mkdtempSync(join(tmpdir(), "bundled-"));
    try {
      for (const f of ["lib/index.js", "package.json", ".eslintrc.yml", ".gitattributes", ".github/ci.yml", "spec/.eslintrc.yml", "spec/a.spec.js", "test/a.js"]) {
        mkdirSync(dirname(join(mods, "pkg", f)), { recursive: true });
        writeFileSync(join(mods, "pkg", f), "x\n");
      }
      execFileSync("bash", ["-c", `set -euo pipefail\nmods=${JSON.stringify(mods)}\n${step}`]);
      const left = execFileSync("find", [mods, "-type", "f"], { encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.slice(mods.length + 1)).sort();
      expect(left).toEqual(["pkg/lib/index.js", "pkg/package.json"]);
    } finally {
      rmSync(mods, { recursive: true, force: true });
    }
  });
});
