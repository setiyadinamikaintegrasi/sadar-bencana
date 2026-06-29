# Database Schema

Folder ini menampung migrasi dan catatan model data.

## Migration order

Apply SQL files in numeric order. Migrations are forward-only and written to be
safe to re-run where practical.

The alert-classification safety migration is:

- `018_alert_classification_safety.sql` — adds conservative verification status
  (`unverified`, `corroborated`, `official`) and independent source tracking.
