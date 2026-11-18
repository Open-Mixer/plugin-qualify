// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualification domain (contract.d/qualification/, omx-contract#81) is installed into omx-contract's contract
 * directory, <datadir>/omx-contract/contract.d/qualification/, by the rpm and the deb alike, with its catalogs: a
 * reader of the directory (plugin-hostd's build) finds it there and nowhere else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");
const DIR = "omx-contract/contract.d/qualification";

describe("the qualification domain's installation", () => {
  it("the rpm installs the document and its catalogs, and owns them", () => {
    const spec = read("packaging/plugin-qualify.spec");
    expect(spec).toContain(`%{_datadir}/${DIR}/qualification.json`);
    expect(spec).toMatch(/install .*contract\.d\/qualification\/qualification\.json/);
    expect(spec).toMatch(/install .*contract\.d\/qualification\/catalogs\/\*\.json/);
    expect(spec).toContain(`%{_datadir}/${DIR}/catalogs/`);
  });
  it("the deb installs them into the package", () => {
    const rules = read("debian/rules");
    expect(rules).toMatch(/install .*contract\.d\/qualification\/qualification\.json .*usr\/share\/omx-contract\/contract\.d\/qualification\//);
    expect(rules).toMatch(/install .*contract\.d\/qualification\/catalogs\/\*\.json .*usr\/share\/omx-contract\/contract\.d\/qualification\/catalogs\//);
  });
});
