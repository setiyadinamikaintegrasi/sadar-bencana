# Source Evidence Model

The source-evidence model separates raw upstream information from normalized
events and derived risk decisions.

## Entities

- `source_records` — immutable raw payload revisions with checksum, timestamps,
  source URL, attribution, and source authority.
- `event_evidence` — links a source revision to an event as `supports`,
  `contradicts`, or `updates`, including confidence and freshness.
- `impact_reports` — append-only impact observations such as casualties,
  displacement, building damage, and estimated loss.
- `risk_context` — versioned hazard, exposure, vulnerability, or capacity
  context, including data vintage and administrative code.

## Source authority

Supported source types:

- `official`
- `sensor`
- `institutional`
- `media`
- `citizen`

Source authority and alert severity are independent. A severe claim from a media
article remains a media claim until corroborated or confirmed by an official
source.

## Idempotency and audit

`source_name + source_record_id + payload_checksum` identifies one immutable
source revision. Replaying the same payload returns the existing record. A
changed payload produces another source revision without overwriting the first.

Impact reports use `source_record_id + impact_key` to avoid duplicates while
allowing one report to describe several locations.

## Read-only provenance API

```http
GET /api/v1/events/{event_uuid}/evidence
```

The endpoint returns source metadata, relationship, confidence, and freshness.
Raw payloads are intentionally not returned from the public API.

Migration 022 adds `origin_source_name` for explicit upstream lineage. Media
records that quote BMKG, BNPB, or another source must set this field so copied
reports are not counted as independent corroboration. See
[Evidence Correlation](evidence-correlation.md).

## Connector contract

New connector branches should:

1. Save the complete raw upstream payload with `create_source_record`.
2. Normalize the event or official alert.
3. Link the record to the event with `link_event_evidence`.
4. Store impacts or risk context only when the upstream payload explicitly
   provides those values.
5. Preserve source attribution, observed time, published time, and data vintage.
