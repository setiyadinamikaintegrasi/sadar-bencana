# Database Schema

Folder ini menampung migrasi dan catatan model data.

## Migration order

Apply SQL files in numeric order. Migrations are forward-only and written to be
safe to re-run where practical.

The alert-classification safety migration is:

- `018_alert_classification_safety.sql` — adds conservative verification status
  (`unverified`, `corroborated`, `official`) and independent source tracking.
- `019_official_alert_lifecycle.sql` — stores immutable official alert revisions,
  update/cancel references, checksums, and current lifecycle state.
- `020_peril_specific_watch_zone_thresholds.sql` — replaces the universal
  magnitude filter with earthquake, flood, volcano, and wildfire thresholds.
- `021_source_evidence_model.sql` — stores immutable raw source records,
  event evidence, impact revisions, and versioned risk context.
- `022_evidence_correlation.sql` — stores source-independence rules,
  deterministic correlation decisions, review queue, and reversible merge/split
  audit operations.
- `023_exposure_aware_risk_scoring.sql` — versions persisted risk-score
  formulas for explainable and reproducible peril-aware scoring.
- `024_alert_confidence_policy.sql` — separates confidence from severity and
  stores versioned policy decisions plus audited manual-override metadata.
- `025_ews_alert_lifecycle_delivery.sql` — delivers official alert revisions
  with deduplication, retry, dead-letter, acknowledgement, and latency metrics.
- `026_ews_action_cards.sql` — stores curated, versioned Indonesian safety
  guidance for offline-capable alert action cards.
- `027_disaster_observability.sql` — stores structured pipeline telemetry,
  deterministic correlation IDs, delivery latency, and SLO evidence.
- `028_historical_disaster_warehouse.sql` — separates versioned historical
  events, administrative boundaries, immutable impact revisions, and resumable
  backfill jobs from real-time operational tables.
