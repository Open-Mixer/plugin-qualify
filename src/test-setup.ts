// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The tests read the qualification domain where a program reads it, in the installed contract directory: the domain is
 * plugin-hostd's (its contract.d/qualification/, shipped by plugin-hostd-contract), this tree holds no copy. A
 * checkout of plugin-hostd stands in for the package where the package is not installed: OMX_CONTRACT_PATH, a ':' list,
 * names the directories that stand where the contract directory stands, and the first that holds the domain is the one
 * the tests read (the module of the installed place is replaced with it here; the CLIs a test spawns read the same
 * variable). Unset, or holding no domain, the tests read the installed place itself, and a program that finds none is
 * refused by name (qualification-domain-node.ts).
 */
import { vi } from "vitest";
import "./qualification-domain-node.js";

const HOLDER = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  return (process.env.OMX_CONTRACT_PATH ?? "")
    .split(":")
    .filter((d) => d !== "")
    .find((d) => fs.existsSync(`${d}/qualification/qualification.json`));
});

vi.mock("./qualification-installed-dir.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./qualification-installed-dir.js")>();
  return { INSTALLED_CONTRACT_DIR: HOLDER ?? real.INSTALLED_CONTRACT_DIR };
});
