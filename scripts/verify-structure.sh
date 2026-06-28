#!/usr/bin/env bash
set -euo pipefail

required=(
  "README.md"
  ".env.example"
  "docs/blueprint/2026-06-21-product-blueprint.md"
  "docs/architecture/2026-06-21-technical-architecture.md"
  "docs/superpowers/plans/2026-06-21-mvp-implementation-plan.md"
  "docs/adr/ADR-001-greenfield-not-fork-worldmonitor.md"
  "apps/web/README.md"
  "apps/api/README.md"
  "apps/worker/README.md"
  "packages/domain/README.md"
  "packages/design-system/README.md"
  "db/schema/README.md"
  "infra/local/README.md"
)

missing=0
for path in "${required[@]}"; do
  if [ -e "$path" ]; then
    echo "OK   $path"
  else
    echo "MISS $path"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Structure verification FAILED"
  exit 1
fi

echo "Structure verification PASSED"
