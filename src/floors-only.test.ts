// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * No version on the organisation's own packages: the spec's (Build)Requires, debian/control's Build-Depends and Depends,
 * the workflows' and the actions' install lines and package.json name them and no version (the devel wave 2026-11-24). A
 * third party's floor stays (CLAP, Node), with no ceiling; a breaking release declares its own Breaks/Conflicts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("no version ceiling on a dependency", () => {
  it("the spec's Requires and BuildRequires state floors only", () => {
    const lines = read("packaging/plugin-qualify.spec").split("\n").filter((l) => /^(Build)?Requires:/.test(l));
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l, l).not.toMatch(/ with |<=? ?[0-9]|=< /);
  });
  it("debian/control's Build-Depends and Depends state floors only", () => {
    // a field runs to the next line that starts a field; Breaks and Replaces name what a release dropped, below it
    const fields = read("debian/control").split(/\n(?=[A-Z][\w-]*:)/).filter((f) => /^(Build-)?Depends:/.test(f));
    expect(fields.length).toBeGreaterThan(1);
    for (const f of fields) expect(f).not.toMatch(/\(<<|\(<=|\(< /);
  });
  it("the records package generator writes a floor-only Depends (a source check: its deb arm needs the full dependency tree)", () => {
    const src = read("src/records-package.ts");
    expect(src).toContain("Depends: plugin-qualify (>= ");
    expect(src).not.toMatch(/\(<<|\(<=|\(< /);
  });
  it("the workflows' install lines state floors only", () => {
    for (const w of ["ci.yml", "publish.yml", "release.yml"]) {
      const lines = read(`.github/workflows/${w}`).split("\n").filter((l) => /(dnf|apt-get) install/.test(l));
      for (const l of lines) expect(l, `${w}: ${l}`).not.toMatch(/'[a-z0-9-]+ <=? ?[0-9]/);
    }
  });
});

/** A typed version beside one of the organisation's own packages, as each file writes one. */
const OWN = String.raw`(?:lib)?(?:omx|plugin-(?:db|hostd|qualification-db)|openmixer)[a-z0-9-]*`;
const TYPED = [
  new RegExp(String.raw`^(?:Build)?Requires:\s*(?:pkgconfig\()?${OWN}\)?\s*[<>=]+ ?[0-9]`),
  new RegExp(String.raw`(?<![\w-])${OWN} \([<>=]+ ?[0-9]`),
  new RegExp(String.raw`'${OWN} [<>=]+ ?[0-9]`),
  /"@openmixer\/[a-z-]+": "(?!\*")/,
];
const typed = (text: string): string[] =>
  text.split("\n").filter((l) => !/^\s*#/.test(l) && !/^(Breaks|Replaces):/.test(l) && TYPED.some((r) => r.test(l))).map((l) => l.trim());

describe("no typed version on the organisation's own packages", () => {
  for (const f of ["packaging/plugin-qualify.spec", "debian/control", "package.json", ".github/actions/install-plugin-hostd/action.yml",
    ".github/workflows/ci.yml", ".github/workflows/publish.yml", ".github/workflows/release.yml"]) {
    it(f, () => {
      const text = read(f).split("%changelog")[0]!;
      expect(typed(text)).toEqual([]);
    });
  }
  it("positive control: each form is seen, and a third party's floor is not", () => {
    const seen = ["BuildRequires: pkgconfig(omxdsp) >= 0.34.0", "Requires: plugin-hostd >= 0.21.0", "Depends: libomx-clap1 (>= 0.34.0~)",
      "dnf install -y 'omx-contract >= 3.20.2'", '    "@openmixer/omx-contract": ">=3.20.2",'];
    for (const l of seen) expect(typed(l), l).toEqual([l.trim()]);
    for (const l of ["BuildRequires: pkgconfig(clap) >= 1.2.10", "Depends: nodejs (>= 18)", "Requires: omx-clap-host", "Breaks: plugin-qualify-contract (<< 0.21.0~)"]) {
      expect(typed(l), l).toEqual([]);
    }
  });
});
