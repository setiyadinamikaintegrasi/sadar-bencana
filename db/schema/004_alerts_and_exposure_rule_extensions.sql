BEGIN;

ALTER TABLE exposure_rules
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IDR',
    ADD COLUMN IF NOT EXISTS portfolio_name TEXT NOT NULL DEFAULT 'property',
    ADD COLUMN IF NOT EXISTS risk_multiplier NUMERIC(12,2) NOT NULL DEFAULT 1.00;

UPDATE exposure_rules
SET portfolio_name = COALESCE(NULLIF(portfolio_name, ''), treaty_category, 'property')
WHERE portfolio_name IS NULL
   OR portfolio_name = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_event_id_alert_type
    ON alerts (event_id, alert_type);

CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged_created_at
    ON alerts (acknowledged, created_at DESC);

COMMIT;
