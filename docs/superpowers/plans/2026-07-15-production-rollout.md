# SadarBencana BMKG Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the BMKG dashboard and EWS branch through a reviewed pull request and provide an executable production runbook for Docker Compose on the Mac Mini with the existing Supabase database.

**Architecture:** Add one production runbook that treats Supabase as the persistent system of record and Docker Compose as the application rollout unit. The migration is forward-only and limited to `040`; application rollback keeps the additive schema in place and returns the containers to the previously recorded Git commit.

**Tech Stack:** Markdown, Git, GitHub CLI, Docker Compose, PostgreSQL/Supabase, Go API, Python worker, React/Vite web.

## Global Constraints

- Production continues to use the existing Supabase project and production `DATABASE_URL`.
- Production continues to run Redis, API, Worker, and Web through root `docker-compose.yml` on the Mac Mini.
- Never run all historical migrations against the existing production database; apply only migration `040` for this release after confirming migrations through `039` are present.
- Create a full custom-format database backup and schema-only backup before migration.
- Preserve existing earthquake, wildfire, flood, volcano, news, risk, portfolio, EWS, and audit data.
- Do not deploy any `seed-id:*` event, `(simulasi)` station, or `SIMULASI DEMO` warning.
- Keep `EWS_DELIVERY_ENABLED=false` and `EWS_LIFECYCLE_DELIVERY_ENABLED=false` through initial rollout and smoke testing.
- Keep `bmkg_air_quality` disabled until its official machine-readable endpoint, terms, mapping, and cadence are approved.
- Keep Worker and Mastra private; only the web application is publicly reverse proxied.
- Never write production credentials, tokens, connection strings, or dump files into the repository.

---

### Task 1: Production Deployment Runbook

**Files:**
- Create: `docs/bmkg-production-rollout.md`
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-07-15-production-rollout-design.md`
- Reference: `docs/production-security-deployment.md`
- Reference: `docker-compose.yml`
- Reference: `db/schema/040_bmkg_warning_and_air_quality.sql`

**Interfaces:**
- Consumes: approved Docker Compose + Supabase production architecture.
- Produces: one operator-facing sequence with copyable preflight, backup, migration, deploy, verification, activation, and rollback commands.

- [ ] **Step 1: Create the runbook introduction and safety boundary**

State that the runbook targets `sadarbencana.id`, root Docker Compose on the Mac Mini, and the existing Supabase database. Explicitly prohibit copying the local test database or demo fixtures to production.

- [ ] **Step 2: Add environment and access preflight**

Include commands that verify the checkout, Compose configuration, required command-line tools, environment presence without printing secret values, service health, disk space, current commit, and production URL. Require the operator to set `PREVIOUS_COMMIT`, `RELEASE_COMMIT`, and a timestamped backup directory.

- [ ] **Step 3: Add full backup and count capture**

Use `pg_dump --format=custom --no-owner --no-privileges`, a separate schema-only dump, and `pg_restore --list` to verify readability. Include one `psql` query that records counts for `events`, `alerts`, `risk_scores`, `news_items`, `official_alerts`, `acceptance_contracts`, `ews_subscribers`, `ews_watch_zones`, and `ews_notification_log`.

- [ ] **Step 4: Add migration preflight and execution**

Verify PostGIS and required pre-`040` tables/columns. Apply only:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f db/schema/040_bmkg_warning_and_air_quality.sql
```

Verify the new table, columns, safety guidance, source settings, and disabled baseline. Re-run the count query and require investigation before continuing if an existing table count decreases.

- [ ] **Step 5: Add Compose build and rollout**

Build `api`, `worker`, and `web` before switching containers. Keep Redis intact and use `docker compose up -d --build api worker web`. Require `docker compose ps` and bounded recent logs for each changed service.

- [ ] **Step 6: Add production smoke tests**

Verify public meta, event, risk-score, connector-health, map-overlay, official-alert, and air-quality endpoints. Verify existing earthquake/wildfire data, no demo identifiers, valid empty warning behavior, `source_active=false` for air quality, and private Worker/Mastra routes.

- [ ] **Step 7: Add staged source and delivery activation**

Document the administrator sequence: test, preview, dry-run, review evidence, activate BMKG CAP, observe, test notification channels, then enable delivery flags. Keep air quality disabled pending explicit endpoint approval.

- [ ] **Step 8: Add application rollback and emergency database restore**

Application rollback must disable the new sources and delivery flags, checkout `PREVIOUS_COMMIT`, rebuild `api`, `worker`, and `web`, and leave migration `040` in place. Emergency restore must stop writes and restore to a controlled database or use Supabase PITR before switching production; it must not destructively restore over the live database without validation.

- [ ] **Step 9: Link the runbook from README**

Add the BMKG production rollout runbook near existing production security documentation so deploy operators can find it from the repository entry point.

- [ ] **Step 10: Validate documentation**

Run:

```bash
rg -n "TB[D]|TO[D]O|replace-me|seed-id:|SIMULASI DEMO|localhost:55432" \
  docs/bmkg-production-rollout.md
git diff --check
```

Expected: no placeholder or demo-data matches except explicit prohibition text; `git diff --check` exits `0`.

- [ ] **Step 11: Commit**

```bash
git add README.md docs/bmkg-production-rollout.md
git commit -m "docs: add BMKG production rollout runbook"
```

### Task 2: Independent Runbook Review

**Files:**
- Review: `docs/bmkg-production-rollout.md`
- Review: `README.md`
- Reference: `docker-compose.yml`
- Reference: `.env.example`
- Reference: `db/schema/040_bmkg_warning_and_air_quality.sql`

**Interfaces:**
- Consumes: Task 1 runbook.
- Produces: approved commands and safety controls, or a complete Critical/Important findings list for one fix pass.

- [ ] **Step 1: Generate a task review package**

Use the Task 1 base commit and resulting head commit so the reviewer sees the full documentation diff.

- [ ] **Step 2: Review production safety**

Check command correctness, Compose service names, required environment variables, backup restorability, migration scope, existing-data count coverage, absence of secrets, no demo-data deployment, source activation gates, and rollback feasibility.

- [ ] **Step 3: Fix all Critical and Important findings**

Use one fix pass, rerun the focused documentation checks, and obtain reviewer approval. Record Minor findings for the final whole-branch review.

### Task 3: Release Verification and Draft Pull Request

**Files:**
- Verify: complete feature branch against `origin/main`
- Publish: `feat/bmkg-dashboard-ews`

**Interfaces:**
- Consumes: approved runbook and completed BMKG feature branch.
- Produces: pushed branch and draft pull request targeting `main`.

- [ ] **Step 1: Fetch and inspect remote target**

Run `git fetch origin`, inspect `origin/main..HEAD`, confirm no unrelated working-tree changes, and confirm the PR target is `main`.

- [ ] **Step 2: Run full verification**

Run the complete Go API suite, Worker pytest suite, Web test suite, Web production build, repository verification command, migration idempotency test against the isolated local PostGIS database, and `git diff --check`.

- [ ] **Step 3: Perform final whole-branch review**

Review the complete `origin/main..HEAD` diff, including the production runbook. Fix all Critical and Important findings and rerun covering tests.

- [ ] **Step 4: Push the feature branch**

```bash
git push -u origin feat/bmkg-dashboard-ews
```

- [ ] **Step 5: Create a draft PR targeting main**

The PR body must summarize BMKG CAP lifecycle support, air-quality onboarding, dashboard/EWS UI, safety gates, migration `040`, production deployment sequence, validation results, source activation defaults, and rollback guidance.

- [ ] **Step 6: Report deployment handoff**

Return the PR URL, release branch and commit, validation evidence, migration command, and the first production preflight actions. Do not deploy production automatically; guide the operator through the reviewed runbook after PR merge.
