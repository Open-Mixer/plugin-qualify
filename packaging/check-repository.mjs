#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
//
// Check package.json's repository.url against the repository a workflow runs in. npm's provenance
// check refuses a publish when they differ (E422: "repository.url" expected to match the repository
// named by provenance) — this catches the mismatch on a pull request, before a tag ever reaches npm
// (openmixer/plugin-qualify#34: v0.20.2 named OpenMixer and npm refused it).
//
//   GITHUB_REPOSITORY=<owner>/<repo> node packaging/check-repository.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** null when `pkg.repository.url` (git+ prefix aside) names `githubRepository`; the failure message otherwise. */
export function checkRepository(pkg, githubRepository) {
  const url = pkg.repository?.url ?? "";
  const want = `https://github.com/${githubRepository}.git`;
  const got = url.replace(/^git\+/, "");
  if (got === want) return null;
  return `package.json: "repository.url" is "${url}", expected to match "${want}" (GITHUB_REPOSITORY=${githubRepository})`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error("check-repository: GITHUB_REPOSITORY is not set");
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const failure = checkRepository(pkg, repo);
  if (failure) {
    console.error(`check-repository: ${failure}`);
    process.exit(1);
  }
  console.log(`check-repository: repository.url names ${repo}`);
}
