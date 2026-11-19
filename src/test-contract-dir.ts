// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The contract directory the tests read the qualification domain from: the installed plugin-hostd-contract's. A run points
 * at another with OMX_CONTRACT_PATH (a ':' list; the first directory holding the domain wins), the same variable the CLIs
 * read; unset, it is the installed place. plugin-qualify holds no copy of the domain.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const INSTALLED = "/usr/share/omx-contract/contract.d";

function pick(): string {
  const list = (process.env.OMX_CONTRACT_PATH ?? "").split(":").filter((d) => d !== "");
  return list.find((d) => existsSync(join(d, "qualification", "qualification.json"))) ?? INSTALLED;
}

export const TEST_CONTRACT_DIR = pick();
