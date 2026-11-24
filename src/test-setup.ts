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
import "./probe-domain-node.js";
import "./history-domain-node.js";

/**
 * The place the tests read: a copy of the installed contract directory, whole, as the programs a test spawns read it
 * (plugin-hostd-probe reads the machine domain, omx-clap-scan the scan domain, the real plugin-db its own, #162: each as
 * one directory with no fallback); the domains this package reads (the qualification and history domains, plugin-hostd's;
 * the probe domain, plugin-hostd-protocol's; the plugin-db domain) come from the first directory of OMX_CONTRACT_PATH that
 * holds them, over the installed ones. A domain found nowhere is not linked, and the first read of it refuses by name. The
 * CLIs a test spawns read the same variable, which names this directory.
 */
const CONTRACT_DIR = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const installed = "/usr/share/omx-contract/contract.d";
  const named = (process.env.OMX_CONTRACT_PATH ?? "").split(":").filter((d) => d !== "" && d !== installed);
  const dir = fs.mkdtempSync(`${os.tmpdir()}/qualify-contract-dir-`);
  if (fs.existsSync(installed)) fs.cpSync(installed, dir, { recursive: true });
  for (const domain of ["qualification", "probe", "plugin-hostd/history", "plugin-db"]) {
    const holder = named.find((d) => fs.existsSync(`${d}/${domain}/${domain.split("/").pop()}.json`));
    if (holder === undefined) continue;
    fs.rmSync(`${dir}/${domain}`, { recursive: true, force: true });
    fs.cpSync(`${holder}/${domain}`, `${dir}/${domain}`, { recursive: true });
  }
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.OMX_CONTRACT_PATH = dir;
  return dir;
});

vi.mock("./qualification-installed-dir.js", () => ({ INSTALLED_CONTRACT_DIR: CONTRACT_DIR }));
