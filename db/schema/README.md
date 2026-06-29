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
