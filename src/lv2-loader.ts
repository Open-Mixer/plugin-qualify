// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The LV2 implementation of the one discovery seam (`loader.ts`, spec §7). A target that names an
 * existing directory is a bundle: every subject its `manifest.ttl` declares `a lv2:Plugin` is a
 * plugin, with its `lv2:binary` basename. Anything with a scheme (`scheme:rest`, other than `file:`) is one
 * plugin, looked up by URI; a bare or `file:` argument is a path. A path that does not exist is not this loader's — the CLI refuses it by name.
 *
 * The manifest is read as plugin-hostd reads it to pin a plugin: statements of IRIs and prefixed names, with blank
 * nodes and collections stepped over, not a whole Turtle parser. A plugin is a subject typed `lv2:Plugin`; its files
 * are the ones the manifest names for it with `lv2:binary` or `rdfs:seeAlso`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { PluginLoader, PluginTarget } from "./loader.js";

const URI_SHAPE = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const LV2_PLUGIN = "http://lv2plug.in/ns/lv2core#Plugin";
const LV2_BINARY = "http://lv2plug.in/ns/lv2core#binary";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";

type Token = { readonly kind: "iri" | "name" | "punct" | "literal"; readonly text: string };

/** The words of a Turtle text: IRIs, prefixed names, literals (with their tag or type) and punctuation; comments dropped. */
function turtleTokens(ttl: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < ttl.length) {
    const c = ttl[i]!;
    if (/\s/.test(c)) i++;
    else if (c === "#") while (i < ttl.length && ttl[i] !== "\n") i++;
    else if (c === "<") {
      const end = ttl.indexOf(">", i);
      if (end < 0) break;
      out.push({ kind: "iri", text: ttl.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const quote = ttl.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < ttl.length && !ttl.startsWith(quote, j)) j += ttl[j] === "\\" ? 2 : 1;
      i = j + quote.length;
      // a language tag or a datatype belongs to the literal
      if (ttl[i] === "@") while (i < ttl.length && /[A-Za-z0-9-@]/.test(ttl[i]!)) i++;
      else if (ttl.startsWith("^^", i)) {
        i += 2;
        if (ttl[i] === "<") i = ttl.indexOf(">", i) + 1;
        else while (i < ttl.length && /[^\s;,.\])]/.test(ttl[i]!)) i++;
      }
      out.push({ kind: "literal", text: "" });
    } else if (".;,[]()".includes(c)) {
      out.push({ kind: "punct", text: c });
      i++;
    } else {
      let j = i;
      while (j < ttl.length && /[^\s<>"';,\[\]()]/.test(ttl[j]!) && !(ttl[j] === "." && (j + 1 >= ttl.length || /\s/.test(ttl[j + 1]!)))) j++;
      out.push({ kind: "name", text: ttl.slice(i, j) });
      i = Math.max(j, i + 1);
    }
  }
  return out;
}

/**
 * The path a file IRI names, as lilv and serd read it: a `file:` URI loses its scheme and authority, and the percent
 * escapes of its path are decoded (`libSurge%20XT.so` is `libSurge XT.so` on the disk). A relative IRI is decoded the
 * same way. A malformed escape leaves the text as written: the name is then looked up as it stands and not found, which
 * is its own, named failure.
 */
export function iriPath(iri: string): string {
  let path = iri;
  const scheme = /^file:(?:\/\/[^/]*)?(?=\/)/i.exec(iri);
  if (scheme !== null) path = iri.slice(scheme[0].length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** A plugin a manifest declares, with the files it names for it, each relative to the bundle, in the order named. */
export interface ManifestPlugin {
  readonly uri: string;
  readonly files: readonly string[];
  /** The basename of its `lv2:binary` as it is on the disk (the IRI's escapes decoded), when it names one. `files` keep the IRI's word, which is what a pin holds. */
  readonly binary?: string;
}

/** A statement of a Turtle text: the subject and predicate expanded, the object as written and, when it names one, expanded. */
export interface TurtleTriple {
  readonly subject: string;
  readonly predicate: string;
  /** The object's token: an `iri` is as written (a relative one stays relative), a `literal` carries no text. */
  readonly object: { readonly kind: "iri" | "name" | "literal"; readonly text: string };
  /** The object expanded: an absolute or relative IRI, or a prefixed name with a known prefix. */
  readonly objectIri?: string;
}

/**
 * The statements of a Turtle text, as plugin-hostd reads a manifest to pin a plugin: statements of IRIs and prefixed
 * names, with blank nodes and collections stepped over, not a whole Turtle parser. `lv2`, `rdfs` and `rdf` read even
 * when a file leaves them undeclared.
 */
export function turtleTriples(ttl: string): TurtleTriple[] {
  const prefixes = new Map<string, string>([
    ["lv2", "http://lv2plug.in/ns/lv2core#"],
    ["rdfs", "http://www.w3.org/2000/01/rdf-schema#"],
    ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ]);
  const expand = (t: Token): string | undefined => {
    if (t.kind === "iri") return t.text;
    if (t.kind !== "name") return undefined;
    if (t.text === "a") return RDF_TYPE;
    const colon = t.text.indexOf(":");
    const base = colon < 0 ? undefined : prefixes.get(t.text.slice(0, colon));
    return base === undefined ? undefined : base + t.text.slice(colon + 1);
  };
  const out: TurtleTriple[] = [];
  const tokens = turtleTokens(ttl);
  let state: "subject" | "predicate" | "object" | "after" = "subject";
  let depth = 0;
  let subject: string | undefined;
  let predicate: string | undefined;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.kind === "name" && /^(@prefix|PREFIX)$/i.test(t.text) && state === "subject" && depth === 0) {
      const name = tokens[k + 1]?.text ?? "";
      const iri = tokens[k + 2];
      if (iri?.kind === "iri") prefixes.set(name.replace(/:$/, ""), iri.text);
      k += t.text.startsWith("@") ? 3 : 2;
      continue;
    }
    if (t.kind === "name" && /^(@base|BASE)$/i.test(t.text) && state === "subject" && depth === 0) {
      k += t.text.startsWith("@") ? 2 : 1;
      continue;
    }
    if (t.kind === "punct" && (t.text === "[" || t.text === "(")) {
      if (depth++ === 0 && state === "subject") subject = undefined;
      continue;
    }
    if (t.kind === "punct" && (t.text === "]" || t.text === ")")) {
      if (depth > 0 && --depth === 0) state = state === "subject" ? "predicate" : "after";
      continue;
    }
    if (depth > 0) continue;
    if (t.kind === "punct") {
      if (t.text === ".") state = "subject";
      else if (t.text === ";") state = "predicate";
      else if (t.text === ",") state = "object";
      continue;
    }
    if (state === "subject") {
      subject = expand(t);
      state = "predicate";
    } else if (state === "predicate") {
      predicate = expand(t);
      state = "object";
    } else if (state === "object") {
      state = "after";
      if (subject === undefined || predicate === undefined) continue;
      const objectIri = expand(t);
      out.push({ subject, predicate, object: { kind: t.kind as "iri" | "name" | "literal", text: t.text }, ...(objectIri === undefined ? {} : { objectIri }) });
    }
  }
  return out;
}

/**
 * Every plugin a bundle manifest declares and the files it names for it with `lv2:binary` or `rdfs:seeAlso`: the
 * files plugin-hostd's pin holds besides `manifest.ttl` itself. A file named outside the bundle (an absolute IRI) is
 * not one of them.
 */
export function manifestPlugins(ttl: string): ManifestPlugin[] {
  const subjects = new Map<string, { typed: boolean; files: string[]; binary?: string }>();
  for (const { subject, predicate, object, objectIri } of turtleTriples(ttl)) {
    const entry = subjects.get(subject) ?? { typed: false, files: [] };
    subjects.set(subject, entry);
    if (predicate === RDF_TYPE && objectIri === LV2_PLUGIN) entry.typed = true;
    if ((predicate === LV2_BINARY || predicate === RDFS_SEE_ALSO) && object.kind === "iri" && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(object.text) && !object.text.startsWith("/")) {
      const file = object.text.replace(/^(\.\/)+/, "");
      if (!entry.files.includes(file)) entry.files.push(file);
      if (predicate === LV2_BINARY && entry.binary === undefined) entry.binary = basename(iriPath(file));
    }
  }
  return [...subjects.entries()]
    .filter(([, e]) => e.typed)
    .map(([uri, e]) => ({ uri, files: e.files, ...(e.binary === undefined ? {} : { binary: e.binary }) }));
}

const PATCH_WRITABLE = "http://lv2plug.in/ns/ext/patch#writable";
const RDFS_RANGE = "http://www.w3.org/2000/01/rdf-schema#range";
const ATOM_PATH = "http://lv2plug.in/ns/ext/atom#Path";

/**
 * The content an LV2 plugin declares it plays from: the parameters it lists as `patch:writable` whose `rdfs:range` is
 * `atom:Path` (a sampler's sample, a drum machine's kit), sorted. Read from the bundle on the search path whose
 * manifest declares `uri`, in the manifest and every file it names for the plugin. Empty when the plugin declares none
 * or no bundle on the path holds it (#318).
 */
export function lv2ContentParams(uri: string, env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string[] {
  for (const bundle of lv2BundlesOnPath(env, home)) {
    let manifest: string;
    try {
      manifest = readFileSync(join(bundle, "manifest.ttl"), "utf8");
    } catch {
      continue;
    }
    const plugin = manifestPlugins(manifest).find((p) => p.uri === uri);
    if (plugin === undefined) continue;
    const triples = [manifest, ...plugin.files.filter((f) => f.endsWith(".ttl")).map((f) => {
      try {
        return readFileSync(join(bundle, f), "utf8");
      } catch {
        return "";
      }
    })].flatMap(turtleTriples);
    const paths = new Set(triples.filter((t) => t.predicate === RDFS_RANGE && t.objectIri === ATOM_PATH).map((t) => t.subject));
    return [...new Set(triples.filter((t) => t.subject === uri && t.predicate === PATCH_WRITABLE && t.objectIri !== undefined && paths.has(t.objectIri)).map((t) => t.objectIri!))].sort();
  }
  return [];
}

/** The plugins a bundle manifest declares, each with its `lv2:binary` basename. */
export function pluginsInManifest(ttl: string): { uri: string; binary?: string }[] {
  return manifestPlugins(ttl).map((p) => (p.binary === undefined ? { uri: p.uri } : { uri: p.uri, binary: p.binary }));
}

export const lv2Loader: PluginLoader = {
  format: "lv2",
  resolve(target: string): readonly PluginTarget[] | undefined {
    if (existsSync(target) && statSync(target).isDirectory()) {
      const manifest = join(target, "manifest.ttl");
      if (!existsSync(manifest)) return [];
      return pluginsInManifest(readFileSync(manifest, "utf8")).map((p) => ({
        format: "lv2",
        uri: p.uri,
        bundle: target,
        ...(p.binary === undefined ? {} : { binary: p.binary }),
      }));
    }
    // A scheme (http, https, urn, ...) makes the argument a URI; a bare or `file:` argument is a path, and one that is not there is not this loader's.
    if (!/^file:/i.test(target) && URI_SHAPE.test(target) && !/^[A-Za-z]:[\\/]/.test(target)) return [{ format: "lv2", uri: target }];
    return undefined;
  },
};

/** lilv's default LV2 search path, used when `LV2_PATH` is unset. */
const LV2_DEFAULT_DIRS = [".lv2", "/usr/lib/lv2", "/usr/lib64/lv2", "/usr/local/lib/lv2", "/usr/local/lib64/lv2"];

/**
 * Every `.lv2` bundle directly under the LV2 search path (`LV2_PATH`, else lilv's defaults). An
 * absent directory holds none; any other fs error propagates for the caller to name. A bundle is
 * a directory holding `manifest.ttl`: a dangling `.lv2` symlink or a plain `.lv2` file is not one.
 */
export function lv2BundlesOnPath(env: Readonly<Record<string, string | undefined>>, home: string = homedir()): string[] {
  const named = (env["LV2_PATH"] ?? "").split(":").filter((d) => d !== "");
  const dirs = named.length > 0 ? named : LV2_DEFAULT_DIRS.map((d) => (d.startsWith("/") ? d : join(home, d)));
  const bundles: string[] = [];
  for (const dir of new Set(dirs.map((d) => resolve(d)))) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw e;
    }
    for (const n of names.sort()) {
      if (!n.endsWith(".lv2")) continue;
      const path = join(dir, n);
      let isBundle: boolean;
      try {
        isBundle = statSync(path).isDirectory() && existsSync(join(path, "manifest.ttl"));
      } catch {
        isBundle = false; // a dangling symlink
      }
      if (isBundle) bundles.push(path);
    }
  }
  return bundles;
}
