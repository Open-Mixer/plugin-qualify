// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The two store commands as processes, for the tests that run the sync's own entry point (the commands themselves are the
 * store repository's, exercised by `qualification-store.contract.test.ts`). `node store-stand-in.support.mjs write|read
 * <args>` keeps its layers in the JSON file named by STAND_IN_STORE and follows the documented interface: `put`, `delete`,
 * `query --json [--records] [--rate N --quantum N] [--layer ..]` and `counts --layer .. --json`. A base record claims the
 * cells its `claims` names, else every cell of its grid (the store's claim is the test's to give, never decided here); a
 * cell result is the claimant's, a record line names its `set`, and `--records --rate --quantum` prints the record that
 * claims that cell. It checks nothing of a record: `store-fake.support.ts` is the stand-in that enforces section 3.7.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [tool, verb, ...args] = process.argv.slice(2);
const file = process.env.STAND_IN_STORE;
const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { user: [], base: [] };
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const key = (r) => [r.sha256, r.format, r.uri, r.offer, r.host_class].join("\0");
const matches = (r) => ["sha256", "format", "uri", "offer"].every((k) => flag(`--${k}`) === undefined || r[k] === flag(`--${k}`)) && (flag("--host-class") === undefined || r.host_class === flag("--host-class")) && (flag("--binary-path") === undefined || r.record.binary.path === flag("--binary-path"));
const save = () => writeFileSync(file, JSON.stringify(state));
const merged = (layer) => (layer === "user" ? state.user : layer === "base" ? state.base : [...state.user, ...state.base.filter((b) => !state.user.some((u) => key(u) === key(b)))]);
let out = "";
if (tool === "write" && verb === "put") {
  const record = JSON.parse(readFileSync(0, "utf8"));
  const r = { layer: "user", sha256: record.binary.sha256, format: record.plugin.format, uri: record.plugin.id, offer: flag("--offer"), host_class: flag("--host-class"), record };
  state.user = [...state.user.filter((u) => key(u) !== key(r)), r];
  save();
} else if (tool === "write" && verb === "delete") {
  state.user = state.user.filter((u) => !matches(u));
  save();
} else if (verb === "counts") {
  const per = {};
  for (const r of merged(flag("--layer"))) {
    per[r.format] ??= new Map();
    per[r.format].set(r.uri, (per[r.format].get(r.uri) ?? false) || r.record.tiers.offeredOn.length > 0);
  }
  for (const f of Object.keys(per).sort()) out += `${JSON.stringify({ format: f, plugins: per[f].size, offered: [...per[f].values()].filter(Boolean).length, not_offered: [...per[f].values()].filter((o) => !o).length })}\n`;
} else if (verb === "query") {
  const found = merged(flag("--layer")).filter(matches);
  const at = (c) => (flag("--rate") === undefined || c.rate === Number(flag("--rate"))) && (flag("--quantum") === undefined || c.quantum === Number(flag("--quantum")));
  const claims = (r) => (r.layer === "user" ? r.record.measurements.grid : (r.claims ?? r.record.measurements.grid)).filter(at);
  const setOf = (r) => (r.layer === "user" ? null : (r.set ?? null));
  if (args.includes("--records"))
    out = found
      .filter((r) => claims(r).length > 0)
      .map((r) => `${JSON.stringify({ layer: r.layer, sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, host_class: r.host_class, set: setOf(r), record: r.record })}\n`)
      .join("");
  else
    out = found
      .flatMap((r) => r.record.measurements.grid.filter((c) => claims(r).some((k) => k.rate === c.rate && k.quantum === c.quantum)).map((c) => ({ layer: r.layer, sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, host_class: r.host_class, set: setOf(r), binary_path: r.record.binary.path, layout_scheme: r.record.binary.layout?.scheme ?? null, layout_sha256: r.record.binary.layout?.sha256 ?? null, tested_version: r.record.testedVersion ?? null, unpinnable: r.record.binary.unpinnable === undefined ? 0 : 1, files: r.record.binary.files, rate: c.rate, quantum: c.quantum, outcome: c.outcome, verdicts: r.record.verdicts.map((v) => ({ host: v.host, rating: v.rating, deciding: v.deciding ?? null, measured: v.measured ? 1 : 0, qualified: v.qualified ? 1 : 0 })) })))
      .map((l) => `${JSON.stringify(l)}\n`)
      .join("");
} else {
  process.stderr.write(`usage: unknown verb ${String(verb)}\n`);
  process.exit(2);
}
process.stdout.write(out);
