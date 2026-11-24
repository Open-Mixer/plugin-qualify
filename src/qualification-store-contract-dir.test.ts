// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The store's commands check a record's words against a contract directory. plugin-qualification-db-write takes it from
 * OMX_CONTRACT_PATH, else from the contractdir of libomx-domain.pc, which only libomx-domain-devel ships; an installed
 * plugin-qualify pulls no -devel package, so on a clean install the writer had no directory and refused every put
 * ("refused: contract.dir.absent: None: no such contract directory"), and the sync stored nothing (v0.21.0's
 * packaging/check-installed.sh in a clean fedora:45). The spawned store hands the commands the installed contract
 * directory, the one place a production program reads (INSTALLED_CONTRACT_DIR), unless OMX_CONTRACT_PATH names one.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";
import { SPAWNED_STORE, STORE_READ_ENV, STORE_WRITE_ENV } from "./qualification-store.js";

const dir = mkdtempSync(join(tmpdir(), "store-contract-dir-"));
const echo = join(dir, "echo-contract-path");
writeFileSync(echo, '#!/bin/sh\nprintf %s "${OMX_CONTRACT_PATH-unset}"\n');
chmodSync(echo, 0o755);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const base = { PATH: process.env["PATH"], [STORE_WRITE_ENV]: echo, [STORE_READ_ENV]: echo };

describe("the spawned store names the contract directory to its commands", () => {
  for (const tool of ["write", "read"] as const) {
    it(`${tool}: the installed contract directory when nothing names one`, () => {
      const r = SPAWNED_STORE(tool, [], undefined, base);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(INSTALLED_CONTRACT_DIR);
    });

    it(`${tool}: OMX_CONTRACT_PATH as it was set`, () => {
      const r = SPAWNED_STORE(tool, [], undefined, { ...base, OMX_CONTRACT_PATH: "/somewhere/contract.d" });
      expect(r.stdout).toBe("/somewhere/contract.d");
    });
  }
});
