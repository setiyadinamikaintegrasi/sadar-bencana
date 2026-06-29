# Official Alert Lifecycle

SadarBencana stores authoritative warnings separately from generated risk
alerts. The lifecycle is designed for BMKG CAP, InaTEWS, PVMBG/MAGMA, and other
official connectors added in later branches.

## Migration

Apply migrations in numeric order, including:

```bash
psql "$DATABASE_URL" -f db/schema/019_official_alert_lifecycle.sql
```

## Lifecycle rules

- A unique upstream alert is identified by `source + source_alert_id`.
- Every changed raw payload creates a new immutable revision.
- Replaying an identical payload checksum returns the existing revision.
- A newer revision marks the previous current revision as `updated`.
- A cancellation creates a current `cancelled` revision.
- Active alerts become `expired` after `expires_at`.
- Out-of-order payloads are retained for audit but cannot replace a newer
  current revision.
- `raw_payload` and `payload_checksum` preserve source provenance.

Current lifecycle statuses:

- `active`
- `updated`
- `expired`
- `cancelled`

Message types:

- `alert`
- `update`
- `cancel`

## Read-only API

```http
GET /api/v1/official-alerts
GET /api/v1/official-alerts?source=bmkg&status=active
GET /api/v1/official-alerts?include_history=true&limit=200
```

The default response contains only current revisions. `include_history=true`
returns superseded revisions as well. `limit` must be between 1 and 200.

## Worker maintenance

The worker runs an expiry check every 60 seconds. Failures are logged and do not
stop other worker schedulers. Connector branches must call
`upsert_official_alert` with timezone-aware timestamps and the complete raw
source payload.

No connector may infer a cancellation or extend an expiry unless the upstream
source explicitly supplies that state.
