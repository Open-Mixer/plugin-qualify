// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Stand-ins for `plugin-hostd --search-path` in tests: the lines it prints for the lists a fixture names, as a run the
 * settings take, and as a shell clause for a fixture's plugin-hostd script.
 */
import type { SearchPathRun, SearchPathSource } from "./hostd-search-path.js";

type Sources = Readonly<Record<"lv2_path" | "lv2_extra" | "clap_path", SearchPathSource>>;

/** Every list from the settings file: what a daemon whose file names both lists prints. */
export const FROM_FILE: Sources = { lv2_path: "file", lv2_extra: "file", clap_path: "file" };

/** The lines plugin-hostd --search-path prints for these lists (lv2_extra empty: the LV2 list is lv2_path). */
export function searchPathText(lv2: readonly string[], clap: readonly string[], sources: Sources = FROM_FILE): string {
  return [
    `lv2_path\t${sources.lv2_path}\t${lv2.join(":")}`,
    `lv2_extra\t${sources.lv2_extra}\t`,
    `clap_path\t${sources.clap_path}\t${clap.join(":")}`,
    `lv2\teffective\t${lv2.join(":")}`,
    `clap\teffective\t${clap.join(":")}`,
    "",
  ].join("\n");
}

/** A run that answers these lists, whatever settings file it is asked about. */
export const searchPathOf = (lv2: readonly string[], clap: readonly string[], sources: Sources = FROM_FILE): SearchPathRun => () => ({
  status: 0,
  stdout: searchPathText(lv2, clap, sources),
  stderr: "",
});

/** A shell clause for a fixture's plugin-hostd script: `--search-path`, wherever it is among the arguments, prints these lists. */
export function searchPathClause(lv2: readonly string[], clap: readonly string[]): string {
  return `for a in "$@"; do [ "$a" = --search-path ] && { printf ${JSON.stringify(searchPathText(lv2, clap))}; exit 0; }; done`;
}

const PATH_FLAGS = { "--lv2-path": "lv2", "--lv2-extra": "lv2", "--clap-path": "clap", "--clap-extra": "clap" } as const;

/**
 * A fixture's sync flags with the search path flags of before plugin-qualify#9 taken out, and the search path they
 * named as a plugin-hostd --search-path stand-in: the LV2 list is --lv2-path then --lv2-extra, the CLAP one --clap-path
 * then --clap-extra.
 */
export function splitPathFlags(argv: readonly string[]): { argv: string[]; run: SearchPathRun; lv2: string[]; clap: string[] } {
  const out: string[] = [];
  const lists = { lv2: [] as string[], clap: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a in PATH_FLAGS) lists[PATH_FLAGS[a as keyof typeof PATH_FLAGS]].push(...(argv[++i] ?? "").split(":").filter((d) => d !== ""));
    else out.push(a);
  }
  return { argv: out, run: searchPathOf(lists.lv2, lists.clap), lv2: lists.lv2, clap: lists.clap };
}
