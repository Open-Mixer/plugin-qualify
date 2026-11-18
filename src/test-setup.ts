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

const CONTRACT_DIR = vi.hoisted(() => `${import.meta.dirname}/../contract.d`);
process.env.OMX_CONTRACT_PATH = CONTRACT_DIR;

vi.mock("./qualification-installed-dir.js", () => ({ INSTALLED_CONTRACT_DIR: CONTRACT_DIR }));
