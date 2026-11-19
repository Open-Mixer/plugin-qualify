// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The tests read the qualification domain of the installed plugin-hostd-contract (plugin-qualify holds no copy): the
 * directory of `OMX_CONTRACT_PATH` when a run names one, else the installed place (`test-contract-dir.ts`). Only a test
 * sets the place: the module of the installed place is replaced here, and OMX_CONTRACT_PATH, which only a CLI entry point
 * reads, is set for the CLIs a test spawns.
 */
import { vi } from "vitest";
import "./qualification-domain-node.js";
import { TEST_CONTRACT_DIR } from "./test-contract-dir.js";

process.env.OMX_CONTRACT_PATH = TEST_CONTRACT_DIR;

vi.mock("./qualification-installed-dir.js", async () => ({
  INSTALLED_CONTRACT_DIR: (await import("./test-contract-dir.js")).TEST_CONTRACT_DIR,
}));
