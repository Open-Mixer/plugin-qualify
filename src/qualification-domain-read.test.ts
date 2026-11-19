// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The package reads the qualification domain (contract.d/qualification/) at run time: the words it uses are the JSON's, a
 * word changed there is the word the consumer reads, and a document the package cannot use is refused by name.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { buildVocabulary } from "./measurement/vocabulary.js";
import { openInstalledQualificationDomain, openQualificationDomainAt } from "./qualification-domain-node.js";
import { TEST_CONTRACT_DIR } from "./test-contract-dir.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_DIR = TEST_CONTRACT_DIR;

describe("the package reads its words from the installed JSON", () => {
  const fixture = (edit: (d: { components: { schemas: Record<string, { oneOf: object[] }> } }) => void): string => {
    const dir = mkdtempSync(join(tmpdir(), "qualification-domain-"));
    cpSync(CONTRACT_DIR, dir, { recursive: true });
    const file = join(dir, "qualification", "qualification.json");
    const d = JSON.parse(readFileSync(file, "utf8"));
    edit(d);
    writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
    return dir;
  };
  it("a word changed in the JSON is the word the consumer reads", () => {
    const dir = fixture((d) => {
      d.components.schemas.QUALIFICATION_MEASUREMENT_VOICE_BASES!.oneOf.push({ const: "fixture-word", title: "fixtureWord", "x-code": 2, "x-text": "A word only this test adds." });
    });
    try {
      const changed = buildVocabulary(openQualificationDomainAt(dir));
      const installed = buildVocabulary(openQualificationDomainAt(CONTRACT_DIR));
      expect(changed.VOICE_BASES).toContain("fixture-word");
      expect(installed.VOICE_BASES).not.toContain("fixture-word");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a word the code describes and the JSON lacks is refused by name", () => {
    const dir = fixture((d) => {
      const item = d.components.schemas.QUALIFICATION_MEASUREMENT_LATENCY_SCALING!;
      item.oneOf = item.oneOf.slice(1);
    });
    try {
      expect(() => buildVocabulary(openQualificationDomainAt(dir))).toThrow(/QUALIFICATION_MEASUREMENT_LATENCY_SCALING/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a document without $schema, below the floor or absent is refused by name", () => {
    const noSchema = fixture((d) => void delete (d as { $schema?: string }).$schema);
    const tooOld = fixture((d) => void ((d as unknown as { info: { version: string } }).info.version = "0.0.1"));
    try {
      expect(() => openQualificationDomainAt(noSchema)).toThrow(/qualification.*\$schema/s);
      expect(() => openQualificationDomainAt(tooOld)).toThrow(/qualification.*version/s);
      expect(() => openQualificationDomainAt(join(tmpdir(), "no-such-contract-dir"))).toThrow(/qualification.*(absent|not found|no-such)/s);
    } finally {
      rmSync(noSchema, { recursive: true, force: true });
      rmSync(tooOld, { recursive: true, force: true });
    }
  });
});

const withWord = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "qualification-domain-"));
  cpSync(CONTRACT_DIR, dir, { recursive: true });
  const file = join(dir, "qualification", "qualification.json");
  const d = JSON.parse(readFileSync(file, "utf8")) as { components: { schemas: Record<string, { oneOf: object[] }> } };
  d.components.schemas.QUALIFICATION_MEASUREMENT_VOICE_BASES!.oneOf.push({ const: "fixture-word", title: "fixtureWord", "x-code": 2, "x-text": "A word only this test adds." });
  writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
  return dir;
};

describe("a page hands the document", () => {
  it("refuses by name before init, and reads the handed document after it", async () => {
    vi.resetModules();
    const { HOST_ISOLATIONS } = await import("./measurement/vocabulary.js");
    const { init } = await import("./qualification-domain.js");
    expect(() => HOST_ISOLATIONS.length).toThrow("qualification domain not handed: call init(doc) first");
    const doc = JSON.parse(readFileSync(join(CONTRACT_DIR, "qualification", "qualification.json"), "utf8"));
    init(doc);
    expect([...HOST_ISOLATIONS].length).toBeGreaterThan(0);
  });
  it("validates what is handed as the installed file is", async () => {
    vi.resetModules();
    const { init } = await import("./qualification-domain.js");
    const doc = JSON.parse(readFileSync(join(CONTRACT_DIR, "qualification", "qualification.json"), "utf8"));
    expect(() => init({ ...doc, $schema: undefined })).toThrow(/\$schema/);
    expect(() => init({ ...doc, info: { ...doc.info, version: "0.0.1" } })).toThrow(/floor/);
  });
  it("refuses a document without info.x-stability, or with a value outside experimental|stable, by name", async () => {
    vi.resetModules();
    const { init } = await import("./qualification-domain.js");
    const doc = JSON.parse(readFileSync(join(CONTRACT_DIR, "qualification", "qualification.json"), "utf8"));
    const { "x-stability": _dropped, ...info } = doc.info;
    expect(() => init({ ...doc, info })).toThrow(/x-stability/);
    expect(() => init({ ...doc, info: { ...info, "x-stability": "beta" } })).toThrow(/x-stability/);
    expect(() => init({ ...doc, info: { ...info, "x-stability": "stable" } })).not.toThrow();
  });
  it("the node reader refuses the same", () => {
    const bad = withWord();
    try {
      const file = join(bad, "qualification", "qualification.json");
      const d = JSON.parse(readFileSync(file, "utf8"));
      d.info["x-stability"] = "beta";
      writeFileSync(file, JSON.stringify(d));
      expect(() => openQualificationDomainAt(bad)).toThrow(/x-stability/);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
  it("no browser-reachable module imports the Node reader", () => {
    for (const f of ["qualification-domain.ts", "measurement/vocabulary.ts", "qualification-record.ts"]) {
      expect(readFileSync(join(ROOT, "src", f), "utf8"), f).not.toContain("qualification-domain-node");
    }
  });
});

describe("OMX_CONTRACT_PATH belongs to the CLI entry, never to the library", () => {
  it("the library's default entry ignores it", () => {
    const dir = withWord();
    const before = process.env.OMX_CONTRACT_PATH;
    process.env.OMX_CONTRACT_PATH = dir;
    try {
      expect(openInstalledQualificationDomain().words("QUALIFICATION_MEASUREMENT_VOICE_BASES")).not.toContain("fixture-word");
    } finally {
      process.env.OMX_CONTRACT_PATH = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("the CLI start-up reads it", async () => {
    const dir = withWord();
    try {
      vi.resetModules();
      const node = await import("./qualification-domain-node.js");
      const { qualificationDomain } = await import("./qualification-domain.js");
      node.initFromEnv({ OMX_CONTRACT_PATH: dir });
      expect(qualificationDomain().words("QUALIFICATION_MEASUREMENT_VOICE_BASES")).toContain("fixture-word");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("every CLI entry names it in --help and starts by reading it", () => {
    const root = ROOT;
    for (const bin of ["plugin-qualify", "plugin-qualify-sync", "plugin-qualify-records-package"]) {
      const out = spawnSync(process.execPath, [join(root, "bin", `${bin}.mjs`), "--help"], { encoding: "utf8" });
      expect(`${out.stdout}${out.stderr}`, bin).toContain("OMX_CONTRACT_PATH");
      expect(readFileSync(join(root, "bin", `${bin}.mjs`), "utf8"), bin).toContain('import "../dist/qualification-cli-start.js";');
    }
  });
});

describe("OMX_CONTRACT_PATH is a ':' list, the first directory holding the domain wins", () => {
  const start = async (list: string) => {
    vi.resetModules();
    const node = await import("./qualification-domain-node.js");
    const { qualificationDomain } = await import("./qualification-domain.js");
    node.initFromEnv({ OMX_CONTRACT_PATH: list });
    return qualificationDomain().words("QUALIFICATION_MEASUREMENT_VOICE_BASES");
  };
  it("reads the second entry when the first lacks the domain, ignoring empty entries", async () => {
    const empty = mkdtempSync(join(tmpdir(), "qualification-empty-"));
    try {
      expect(await start(`${empty}::${CONTRACT_DIR}:`)).not.toContain("fixture-word");
      const other = withWord();
      try {
        expect(await start(`${empty}:${other}`)).toContain("fixture-word");
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
  it("the first of two entries that both hold it wins", async () => {
    const other = withWord();
    try {
      expect(await start(`${other}:${CONTRACT_DIR}`)).toContain("fixture-word");
      expect(await start(`${CONTRACT_DIR}:${other}`)).not.toContain("fixture-word");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
  it("no entry holding it is refused by name, listing the directories tried", async () => {
    const a = mkdtempSync(join(tmpdir(), "qualification-empty-"));
    const b = mkdtempSync(join(tmpdir(), "qualification-empty-"));
    try {
      await expect(start(`${a}:${b}`)).rejects.toThrow(new RegExp(`qualification[^]*${a}[^]*${b}`));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("$id must be exactly the domain's", () => {
  const doc = () => JSON.parse(readFileSync(join(CONTRACT_DIR, "qualification", "qualification.json"), "utf8"));
  const dirWith = (edit: (d: Record<string, unknown>) => void): string => {
    const dir = mkdtempSync(join(tmpdir(), "qualification-id-"));
    cpSync(CONTRACT_DIR, dir, { recursive: true });
    const d = doc();
    edit(d);
    writeFileSync(join(dir, "qualification", "qualification.json"), JSON.stringify(d));
    return dir;
  };
  it("init(doc) refuses a wrong and a missing $id by name", async () => {
    vi.resetModules();
    const { init } = await import("./qualification-domain.js");
    expect(() => init({ ...doc(), $id: "https://openmixer.org/contract/panel" })).toThrow(/\$id/);
    const { $id: _gone, ...without } = doc();
    expect(() => init(without)).toThrow(/\$id/);
  });
  it("the node reader refuses a wrong and a missing $id by name", () => {
    const wrong = dirWith((d) => void (d.$id = "https://openmixer.org/contract/panel"));
    const missing = dirWith((d) => void delete d.$id);
    try {
      expect(() => openQualificationDomainAt(wrong)).toThrow(/\$id/);
      expect(() => openQualificationDomainAt(missing)).toThrow(/\$id/);
    } finally {
      rmSync(wrong, { recursive: true, force: true });
      rmSync(missing, { recursive: true, force: true });
    }
  });
});
