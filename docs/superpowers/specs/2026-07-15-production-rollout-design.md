# SadarBencana BMKG Production Rollout Design

## Objective

Deploy the BMKG dashboard and EWS branch to `sadarbencana.id` without replacing
the existing Supabase database, removing existing earthquake/wildfire data, or
enabling notification delivery before the new official sources pass their
activation gates.

## Production Architecture

- The Mac Mini remains the application host.
- Root `docker-compose.yml` builds and runs Redis, Go API, Python worker, and
  the web application.
- The existing Supabase project remains the system of record through the same
  production `DATABASE_URL`.
- The existing TLS reverse proxy continues to expose only the web application.
  API traffic is proxied through the web service; Worker and Mastra endpoints
  remain private.
- Production secrets remain in the host environment and are never copied into
  the repository or Docker images.

## Release Strategy

The feature branch is published as a draft pull request targeting
`origin/main`. Production deployment happens only after review and merge of
that pull request. The deploy operator records both the previous production
commit and the new release commit so application rollback is deterministic.

No synthetic seed data is part of the branch or production rollout. A
successful initial deployment may legitimately show no active BMKG weather
warning and no air-quality observations.

## Data Preservation

Before migration, the operator must create a full logical backup in PostgreSQL
custom format and a separate schema-only backup. The full backup is required
because a schema-only dump cannot restore events, alerts, evidence, EWS state,
or portfolio records.

The operator also records row counts for these production tables before and
after deployment:

- `events`
- `alerts`
- `risk_scores`
- `news_items`
- `official_alerts`
- `acceptance_contracts`
- `ews_subscribers`
- `ews_watch_zones`
- `ews_notification_log`

The rollout must not run the complete historical migration directory against
an existing production database. The repository has no migration ledger, and
older migrations contain data transformations that are unsafe to repeat
without individual review. The release applies only
`db/schema/040_bmkg_warning_and_air_quality.sql` after confirming migrations
through `039` are already represented in production.

Migration `040` runs with `ON_ERROR_STOP=1` and `--single-transaction`. It is
additive: it adds BMKG metadata, creates the air-quality table, adds safety
guidance, and creates disabled source settings. PostGIS availability is a
preflight requirement.

## Safe Initial Configuration

The first production build uses:

```dotenv
API_ENV=hosted
DEPLOYMENT_MODE=hosted
EWS_DELIVERY_ENABLED=false
EWS_LIFECYCLE_DELIVERY_ENABLED=false
CORS_ALLOWED_ORIGINS=https://sadarbencana.id,https://www.sadarbencana.id
EWS_PUBLIC_BASE_URL=https://sadarbencana.id
```

Existing `DATABASE_URL`, Supabase credentials, internal service tokens,
frontend Supabase values, SMTP settings, and connector settings are preserved.
The deployment must not use the local test database or any `seed-id:*` rows.

`bmkg_cap` and `bmkg_air_quality` remain disabled unless production already has
an explicitly approved configuration. Air quality remains disabled until an
approved machine-readable BMKG endpoint, terms, field mapping, and polling
cadence are available.

## Deployment Sequence

1. Confirm Git branch, production commit, Compose health, disk capacity, and
   current production API health.
2. Back up the full Supabase database and schema, then capture critical table
   counts.
3. Confirm PostGIS and the expected migration `039` schema markers.
4. Apply migration `040` as one transaction.
5. Verify migration objects and confirm existing table counts did not decrease.
6. Pull the merged release and rebuild `api`, `worker`, and `web`; Redis is not
   recreated.
7. Verify Compose health, API health, dashboard proxying, existing event data,
   map overlays, connector health, and new BMKG endpoints.
8. Keep both EWS delivery flags disabled during the observation window.
9. Test BMKG CAP through preview, dry-run, and activation gates before enabling
   the source. Activate air quality separately only after its endpoint is
   approved.
10. Enable notification delivery only after channel test sends succeed and the
    active-warning results have been reviewed.

## Verification Contract

The rollout is accepted only when:

- `api`, `worker`, `web`, and `redis` are healthy;
- `/health` and `/api/v1/meta` succeed through their intended routes;
- existing earthquake and wildfire event counts remain available;
- the dashboard still renders event markers and existing risk overlays;
- `/api/v1/official-alerts?source=bmkg_cap&status=active&limit=20` returns a
  valid response, including an empty list when no warning is active;
- `/api/v1/air-quality/observations?source=bmkg&latest=true&limit=50` reports
  `source_active=false` until approved activation;
- no synthetic demo rows exist in production;
- pending, failed, and dead-letter delivery counts do not increase while
  delivery flags are disabled.

## Rollback

Application rollback uses the recorded previous production commit followed by
a rebuild of `api`, `worker`, and `web`. Migration `040` is left in place
because the previous application ignores its additive objects. Before rolling
back application code, both new sources and both EWS delivery flags are
disabled.

Database restore is reserved for confirmed data corruption or destructive
count changes. It requires stopping API and Worker writes, restoring the full
custom-format backup to a controlled database, validating counts and integrity,
and only then switching production traffic. Dropping migration `040` objects is
not part of routine rollback.

## Operational Ownership

- Release operator: backup, migration, Compose rollout, smoke tests, and
  rollback decision.
- Application administrator: official-source preview, dry-run, approval, and
  activation.
- Notification administrator: Telegram/email test sends and delivery enablement.
- Database owner: backup validation and emergency restore.
