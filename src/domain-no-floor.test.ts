// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The probe and history domains are judged by their words, never by a version: a document at any `info.version`
 * opens, and a word it lacks is refused by name where it is asked for.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initHistoryDomain, historyKeys } from "./history-domain.js";
import { openHistoryDomainAt } from "./history-domain-node.js";
import { initProbeDomain, probeOutcome } from "./probe-domain.js";
import { openProbeDomainAt } from "./probe-domain-node.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

const made: string[] = [];
/** A scratch contract directory holding the installed domain with `info.version` set. */
function at(file: string, version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "domain-no-floor-"));
  made.push(dir);
  const doc = JSON.parse(readFileSync(join(INSTALLED_CONTRACT_DIR, file), "utf8")) as { info: { version: string } };
  doc.info.version = version;
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify(doc));
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  initProbeDomain(undefined);
  initHistoryDomain(undefined);
});

describe("a domain is judged by its words, never by a version", () => {
  for (const version of ["0.0.1", "99.0.0"]) {
    it(`the probe domain at info.version ${version} opens`, () => {
      initProbeDomain(openProbeDomainAt(at("probe/probe.json", version)));
      expect(probeOutcome("probeOk")).not.toBe("");
      expect(() => probeOutcome("noSuchWord")).toThrow(/noSuchWord/);
    });
    it(`the history domain at info.version ${version} opens`, () => {
      initHistoryDomain(openHistoryDomainAt(at("plugin-hostd/history/history.json", version)));
      expect(historyKeys().length).toBeGreaterThan(0);
    });
  }
});
