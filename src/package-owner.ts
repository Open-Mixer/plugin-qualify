// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The installed package a plugin binary came from (#123), as the package manager that owns `binary.path` states it:
 * `dpkg-query -S` then `-W` on a Debian system, `rpm -qf` on an RPM one. Null when no package owns the binary or no
 * package manager is there; a field the manager does not state is null, never guessed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

/** The `package` object of a qualification record. */
export interface PackageOwner {
  readonly format: "deb" | "rpm";
  readonly name: string;
  readonly version: string;
  readonly release: string | null;
  readonly distro: string | null;
  readonly arch: string;
}

const OS_RELEASE = "/etc/os-release";

function run(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): string | null {
  const r = spawnSync(cmd, [...args], { encoding: "utf8", timeout: 30000, env: { ...env } });
  if (r.error !== undefined || r.status !== 0) return null;
  return r.stdout;
}

const field = (s: string | undefined): string | null => (s === undefined || s === "" || s === "(none)" ? null : s);

/** The candidates of one path: as written, then with its symlinks resolved (a merged /usr names the other one). */
function candidates(path: string): string[] {
  try {
    const real = realpathSync(path);
    return real === path ? [path] : [path, real];
  } catch {
    return [path];
  }
}

function debOwner(path: string, env: NodeJS.ProcessEnv, osRelease: string): PackageOwner | null {
  for (const p of candidates(path)) {
    const owner = run("dpkg-query", ["-S", p], env);
    const name = owner?.split("\n")[0]?.split(": ")[0]?.split(":")[0];
    if (name === undefined || name === "") continue;
    const w = run("dpkg-query", ["-W", "-f=${Package}\t${Version}\t${Architecture}\n", name], env);
    const [pkg, ver, arch] = (w?.split("\n")[0] ?? "").split("\t");
    if (pkg === undefined || ver === undefined || arch === undefined || ver === "" || arch === "") continue;
    const dash = ver.lastIndexOf("-");
    let codename: string | null = null;
    try {
      const m = /^VERSION_CODENAME="?([^"\n]*)"?$/m.exec(readFileSync(osRelease, "utf8"));
      codename = field(m?.[1]);
    } catch {
      codename = null;
    }
    return {
      format: "deb",
      name: pkg,
      version: dash < 0 ? ver : ver.slice(0, dash),
      release: dash < 0 ? null : field(ver.slice(dash + 1)),
      distro: codename,
      arch,
    };
  }
  return null;
}

function rpmOwner(path: string, env: NodeJS.ProcessEnv): PackageOwner | null {
  for (const p of candidates(path)) {
    const out = run("rpm", ["-qf", "--qf", "%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n", p], env);
    const [name, version, release, arch] = (out?.split("\n")[0] ?? "").split("\t");
    if (name === undefined || version === undefined || arch === undefined || name === "" || version === "" || arch === "") continue;
    const tag = /\.((?:fc|el)\d+)(?:\.|$)/.exec(release ?? "");
    return { format: "rpm", name, version, release: field(release), distro: tag?.[1] ?? null, arch };
  }
  return null;
}

/** The package that owns `binaryPath`, or null. `env` carries the PATH the managers are found on. */
export function packageOwnerOf(binaryPath: string, env: NodeJS.ProcessEnv = process.env, osRelease: string = OS_RELEASE): PackageOwner | null {
  return debOwner(binaryPath, env, osRelease) ?? rpmOwner(binaryPath, env);
}
