#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
#
# Check an installed plugin-qualify package qualifies CLAP and LV2 plugins with nothing set: the
# prober, the measurer and the interposer are the package's own, found where it installed them, and
# the scanner is the one its omx-clap-host dependency pulled in.
#
#   packaging/check-installed.sh <rt-safe.clap> <rt-unsafe.clap> <dir holding rt-safe.lv2, rt-unsafe.lv2>
#
# Runs in the distribution's container after the package is installed, with an empty environment
# (no OMX_* setting, no LV2_PATH: the LV2 bundles go in ~/.lv2, where lilv looks). The safe CLAP
# fixture must qualify (exit 0, suitable), the unsafe one must not (exit 1, rated conditional, its pin verdict=isolated: it runs alone, it is never refused), and the
# installed prober must print the fixture's integrity pin. The installed lv2-measure.mjs must measure
# the LV2 fixtures' hosting dimensions through the installed measurer: no allocation in the safe
# one's run(), some in the unsafe one's, each with its pin. The installed LV2 host probe must run.
set -euo pipefail

usage="usage: check-installed.sh <rt-safe.clap> <rt-unsafe.clap> <lv2-fixture-dir>"
safe=$(readlink -f "${1:?$usage}")
unsafe=$(readlink -f "${2:?$usage}")
lv2=$(readlink -f "${3:?$usage}")
bare() { env -i PATH=/usr/bin:/bin HOME="$HOME" "$@"; }
fail() { echo "check-installed: $*" >&2; exit 1; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

set +e
bare plugin-qualify --out "$out" "$safe" | tee "$out/safe.txt"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 0 ] || fail "plugin-qualify $safe exited $rc, not 0"
grep -Eq '^urn:clap:\S+ +suitable ' "$out/safe.txt" || fail "$safe is not suitable"
# --out holds the qualification record and, beside it, the byte copy of the probe output it judged
records=("$out"/*.qualification.json)
[ -f "${records[0]}" ] || fail "no qualification record was written"
for r in "${records[@]}"; do
  [ -f "${r%.qualification.json}.probe.json" ] || fail "$r has no probe output beside it"
done

set +e
bare plugin-qualify --pins "$out/unsafe.pins" "$unsafe" | tee "$out/unsafe.txt"
rc=${PIPESTATUS[0]}
set -e
[ "$rc" -eq 1 ] || fail "plugin-qualify $unsafe exited $rc, not 1"
grep -Eq '^urn:clap:\S+ +conditional +hosting\.rt-safety\.violations-in-run ' "$out/unsafe.txt" || fail "$unsafe is not conditional on its RT-safety violations: $(cat "$out/unsafe.txt")"
[ "$(grep -c '^pin_set .* verdict=isolated$' "$out/unsafe.pins")" -eq 1 ] || fail "the pin of $unsafe does not say verdict=isolated: $(cat "$out/unsafe.pins")"

# the pin a console hands plugin-hostd: the installed prober prints it beside the measurement
tool=$( (dpkg -L plugin-qualify 2>/dev/null || rpm -ql plugin-qualify) | grep '/clap-qualify$' || true)
dir=$(dirname "${tool:-/nowhere/clap-qualify}")
[ -x "$dir/clap-qualify" ] || fail "the package installs no clap-qualify"
bare LD_PRELOAD="$dir/rt_interpose.so" "$dir/clap-qualify" --rates 48000 --blocks 8 "$safe" > "$out/line.json"
grep -q '"integrity"' "$out/line.json" || fail "the prober printed no integrity block"
grep -Eq '"layout":\{"scheme":"omx-layout/1","sha256":"[0-9a-f]{64}"' "$out/line.json" || fail "the prober printed no layout fingerprint"
echo "check-installed: $dir qualifies CLAP plugins with no setting"

# the LV2 fixtures, measured by the installed lv2-measure.mjs through the installed lv2_measure
[ -x "$dir/lv2_measure" ] || fail "the package installs no lv2_measure"
mkdir -p "$HOME/.lv2"
cp -r "$lv2/rt-safe.lv2" "$lv2/rt-unsafe.lv2" "$HOME/.lv2/"
measure=$( (dpkg -L plugin-qualify 2>/dev/null || rpm -ql plugin-qualify) | grep '/tools/lv2-measure\.mjs$' || true)
[ -n "$measure" ] || fail "the package installs no lv2-measure.mjs"
(cd "$out" && bare node "$measure" --rates 48000 --dimensions stability,rtSafety,features \
  --plugins urn:plugin-qualify:fixture:lv2-rt-safe,urn:plugin-qualify:fixture:lv2-rt-unsafe --out "$out/lv2.json" --run) ||
  fail "lv2-measure.mjs failed on the LV2 fixtures"
bare node packaging/check-lv2-measurement.mjs "$out/lv2.json" || fail "the LV2 measurement is not the fixtures'"
echo "check-installed: $dir measures LV2 plugins with no setting"

# the LV2 host probe a console runs on the plugin it exports: installed, and it tells a plugin lilv
# cannot find (exit 2) from one that failed a claim (exit 1)
[ -x "$dir/lv2_host_probe" ] || fail "the package installs no lv2_host_probe"
[ -x "$dir/isolated_signal" ] || fail "the package installs no isolated_signal"
set +e
bare "$dir/lv2_host_probe" "$lv2/rt-safe.lv2" urn:plugin-qualify:fixture:no-such-plugin > "$out/probe.txt" 2>&1
rc=$?
set -e
[ "$rc" -eq 2 ] || fail "lv2_host_probe on a plugin the bundle lacks exited $rc, not 2"
grep -q 'could not find urn:plugin-qualify:fixture:no-such-plugin' "$out/probe.txt" || fail "lv2_host_probe did not name the plugin it could not find"
echo "check-installed: $dir carries the LV2 host probe"

# the meter the adapter run reads an instrument with: installed, and it names the failure when it has no JACK
[ -x "$dir/jack_peak" ] || fail "the package installs no jack_peak"

# the sync's units: shipped, the timer and the path unit enabled by the install, and no sweep run inside it
for unit in plugin-qualify-sync.service plugin-qualify-sync.timer plugin-qualify-sync.path; do
  [ -f "/usr/lib/systemd/system/$unit" ] || [ -f "/lib/systemd/system/$unit" ] || fail "the package installs no $unit"
done
[ -L /etc/systemd/system/timers.target.wants/plugin-qualify-sync.timer ] || fail "the install did not enable plugin-qualify-sync.timer"
[ -L /etc/systemd/system/paths.target.wants/plugin-qualify-sync.path ] || fail "the install did not enable plugin-qualify-sync.path"
# the install's own trigger may have scanned (the package triggers on the plugin folders); on a clean image that scan
# finds nothing, so no plugin was qualified inside the package transaction
if [ -e /var/lib/omx/qualify-sync.json ]; then
  [ "$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('/var/lib/omx/qualify-sync.json','utf8')).entries).length")" = 0 ] ||
    fail "a sweep qualified plugins inside the package transaction"
fi
[ -f /etc/omx/qualify.conf ] || fail "the package installs no /etc/omx/qualify.conf"
# the installed sync over the safe fixtures, with nothing set but where it looks and writes
mkdir -p "$out/sync/clap" "$out/sync/lv2"
cp "$safe" "$out/sync/clap/"
cp -r "$lv2/rt-safe.lv2" "$out/sync/lv2/"
# an LV2 plugin is admitted under omx-clap-host, which needs a JACK server: with jackd installed the check gives the sync a dummy
# one; without it, the sync must say so by name ("no JACK server") and qualify the CLAP alone, never record resp -201 as the plugin's
jack=
if command -v jackd >/dev/null 2>&1; then
  jack="omx-check-$$"
  jackd -n "$jack" -d dummy -r 48000 -p 256 >"$out/jackd.log" 2>&1 &
  jackpid=$!
  trap 'kill "$jackpid" 2>/dev/null; rm -rf "$out"' EXIT
  for _ in $(seq 1 50); do ls /dev/shm 2>/dev/null | grep -q "jack_${jack}_" && break; sleep 0.2; done
fi
bare_jack() { if [ -n "$jack" ]; then env -i PATH=/usr/bin:/bin HOME="$HOME" JACK_DEFAULT_SERVER="$jack" JACK_NO_START_SERVER=1 "$@"; else bare "$@"; fi; }
# the directories scanned are the ones the installed plugin-hostd prints for its settings file (plugin-qualify#9)
printf 'lv2_path %s\nclap_path %s\n' "$out/sync/lv2" "$out/sync/clap" > "$out/sync/plugin-hostd.conf"
# the sync reads and writes the qualification store through the installed plugin-qualification-db and
# plugin-qualification-db-write: whatever base the installed records package gives (none yet: an absent base is an empty
# base layer), and the user layer at its production place: the store's commands name it from the account's home in the
# password database, not $HOME, so the check runs in a throwaway container whose account holds no layer before the sync.
# A missing command is a failure, never a fallback to files.
command -v plugin-qualification-db >/dev/null || fail "the package pulled no plugin-qualification-db"
command -v plugin-qualification-db-write >/dev/null || fail "the package pulled no plugin-qualification-db-write"
base=/usr/share/omx/qualification/qualification.sqlite
layer="$(getent passwd "$(id -u)" | cut -d: -f6)/.local/share/omx/qualification/qualification.sqlite"
[ ! -e "$layer" ] || fail "$layer is there before the sync: run the check in a throwaway container"
# the store keys its records by host class: a machine with no class of its own (an arm64 runner is no Raspberry Pi) is
# named the store's arm64 class
case "$(uname -m)" in
  x86_64) class=x86-64 ;;
  aarch64) class=rpi5 ;;
  *) fail "no host class of the store for $(uname -m)" ;;
esac
bare_jack plugin-qualify-sync --hostd-conf "$out/sync/plugin-hostd.conf" \
  --host-class "$class" --descriptor-dir "$out/sync/d" --state-file "$out/sync/state.json" > "$out/sync.txt" 2> "$out/sync.err" ||
  fail "plugin-qualify-sync failed: $(cat "$out/sync.err")"
cat "$out/sync.err"
# with no base file the run says once that the base layer is empty; with one, it says nothing of it
said=$(grep -c ': base-absent: ' "$out/sync.err" || true)
if [ -e "$base" ]; then
  [ "$said" -eq 0 ] || fail "the sync said the base is absent while $base is there"
else
  [ "$said" -eq 1 ] || fail "the sync said the empty base $said times, not once: $(cat "$out/sync.err")"
fi
# a release with no python3-lilv says so; one with the bindings loads the library from the runtime package alone
! grep -q 'cannot open shared object' "$out/sync.err" || fail "the sync could not load a library the package depends on"
if [ -n "$jack" ]; then
  grep -q '^qualified 2, skipped 0, refused 0, crashed 0, hung 0, unmeasured 0, ' "$out/sync.txt" || fail "plugin-qualify-sync: $(cat "$out/sync.txt")"
  [ "$(grep -o '"verdict": *"in-process"' "$out/sync/state.json" | wc -l)" -eq 2 ] || fail "the sync's state does not pin both fixtures in-process"
else
  grep -q '^qualified 1, skipped 0, refused 0, crashed 0, hung 0, unmeasured 1, ' "$out/sync.txt" || fail "plugin-qualify-sync: $(cat "$out/sync.txt")"
  grep -q 'no JACK server' "$out/sync.err" || fail "the sync did not name the missing JACK server: $(cat "$out/sync.err")"
  [ "$(grep -o '"verdict": *"in-process"' "$out/sync/state.json" | wc -l)" -eq 1 ] || fail "the sync's state does not pin the CLAP fixture in-process"
fi
# plugin-hostd reads the pins from the store: the sync writes no pin file
if find "$out/sync" -name '*.pins' | grep -q .; then
  fail "the sync wrote a pin file: $(find "$out/sync" -name '*.pins')"
fi
# the records are in the store's user layer, and no record file was written anywhere the sync used
[ -f "$layer" ] || fail "the sync wrote no user layer of the store at $layer"
bare plugin-qualification-db counts --scope user --layer user --json > "$out/counts.txt" ||
  fail "the store's user layer does not read: $(cat "$out/counts.txt")"
grep -q '"plugins":[1-9]' "$out/counts.txt" || fail "the store's user layer holds no plugin: $(cat "$out/counts.txt")"
! find "$out/sync" -name '*.qualification.json' -o -name '*.probe.json' -o -name '*.unmeasured.json' | grep -q . ||
  fail "the sync wrote a record file: $(find "$out/sync" -name '*.json')"
echo "check-installed: plugin-qualify-sync qualifies a CLAP and an LV2 plugin into the store, and its units are enabled"
