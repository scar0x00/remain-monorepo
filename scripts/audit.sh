#!/usr/bin/env bash
# Fails when a package's bun.lock has an advisory of high or critical severity.
# Usage: scripts/audit.sh <package dir>...   (no arguments: every package)
#
# `bun audit` reads the GitHub advisory database, the same one Dependabot uses, and works from
# bun.lock alone, so nothing has to be installed first. Advisories listed in
# .github/audit-ignore.txt are let through until their expiry date; an expired entry fails the audit.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ignore_file="$root/.github/audit-ignore.txt"
today="${AUDIT_TODAY:-$(date -u +%F)}"   # AUDIT_TODAY lets you test the expiry
dirs=("$@")
[[ ${#dirs[@]} -gt 0 ]] || dirs=(flashcard-generator-agent main-backend frontend e2e)

trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; echo "${s%"${s##*[![:space:]]}"}"; }

failed=0
for dir in "${dirs[@]}"; do
  ignores=()
  if [[ -f "$ignore_file" ]]; then
    while IFS='|' read -r id pkg expires reason; do
      id="$(trim "${id:-}")"
      [[ -z "$id" || "$id" == \#* ]] && continue
      [[ "$(trim "${pkg:-}")" == "$dir" ]] || continue
      expires="$(trim "${expires:-}")"
      if [[ ! "$expires" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ || -z "$(trim "${reason:-}")" ]]; then
        echo "::error file=.github/audit-ignore.txt::Malformed entry for $id (needs: id | dir | YYYY-MM-DD | reason)."
        failed=1
        continue
      fi
      if [[ "$expires" < "$today" ]]; then
        echo "::error file=.github/audit-ignore.txt::The ignore for $id in $dir expired on $expires. Fix the dependency or renew it with a new date and reason."
        failed=1
        continue
      fi
      ignores+=("--ignore=$id")
    done <"$ignore_file"
  fi

  echo "::group::bun audit ($dir)"
  if (cd "$root/$dir" && bun audit --audit-level=high "${ignores[@]}"); then
    echo "$dir: no high or critical advisories (${#ignores[@]} ignored)"
  else
    echo "::error::$dir has high or critical advisories."
    failed=1
  fi
  echo "::endgroup::"
done
exit "$failed"
