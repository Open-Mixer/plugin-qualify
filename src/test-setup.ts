// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The tests read the domain of this checkout, contract.d/qualification/, where a program reads the installed one
 * (`INSTALLED_CONTRACT_DIR`): the source tree is the owner's document, and the install copies it byte for byte
 * (packaging/plugin-qualify.spec, debian/rules). Only a test sets the place: the module of the installed place is
 * replaced here, and OMX_CONTRACT_PATH, which only a CLI entry point reads, is set for the CLIs a test spawns.
 */
import { vi } from "vitest";
import "./qualification-domain-node.js";
import "./probe-domain-node.js";

/**
 * The place the tests read: this checkout's qualification domain and plugin-hostd's probe domain (the words of a probe's
 * outcomes and signals, shipped by plugin-hostd-protocol-contract) in one directory, as the installed contract directory holds them.
 * The probe domain is the installed one, or the contract.d of a plugin-hostd-protocol checkout that PLUGIN_HOSTD_PROTOCOL_CONTRACT_DIR names.
 * Where there is none, the directory has no probe domain and the first judgment refuses by name.
 */
const CONTRACT_DIR = await vi.hoisted(async () => {
  const { existsSync, mkdtempSync, rmSync, symlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/plugin-qualify-contract-`);
  symlinkSync(`${import.meta.dirname}/../contract.d/qualification`, `${dir}/qualification`);
  const probe = `${process.env.PLUGIN_HOSTD_PROTOCOL_CONTRACT_DIR ?? "/usr/share/omx-contract/contract.d"}/probe`;
  if (existsSync(probe)) symlinkSync(probe, `${dir}/probe`);
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
});
process.env.OMX_CONTRACT_PATH = CONTRACT_DIR;

vi.mock("./qualification-installed-dir.js", () => ({ INSTALLED_CONTRACT_DIR: CONTRACT_DIR }));
