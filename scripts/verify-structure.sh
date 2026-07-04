#!/usr/bin/env bash
set -euo pipefail

required=(
  "README.md"
  "LICENSE"
  "NOTICE"
  "SECURITY.md"
  "CONTRIBUTING.md"
  "CODE_OF_CONDUCT.md"
  "SUPPORT.md"
  "MAINTAINERS.md"
  "CHANGELOG.md"
  ".env.example"
  ".gitleaks.toml"
  ".github/CODEOWNERS"
  ".github/dependabot.yml"
  ".github/workflows/ci.yml"
  ".github/workflows/security.yml"
  ".github/PUBLICATION_CHECKLIST.md"
  "docker-compose.yml"
  "docs/architecture/2026-06-21-technical-architecture.md"
  "docs/ews-setup.md"
  "docs/security/dependency-risk-register.md"
  "apps/web/README.md"
  "apps/api/README.md"
  "apps/worker/README.md"
  "apps/worker/requirements-dev.txt"
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
