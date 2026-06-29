BEGIN;

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32)
        NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS source_names TEXT[]
        NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_alerts_verification_status'
    ) THEN
        ALTER TABLE alerts
            ADD CONSTRAINT chk_alerts_verification_status
            CHECK (verification_status IN ('unverified', 'corroborated', 'official'));
    END IF;
END
$$;

UPDATE alerts
SET source_names = ARRAY[n.source]
FROM news_items n
WHERE alerts.news_item_id = n.id
  AND cardinality(alerts.source_names) = 0;

CREATE INDEX IF NOT EXISTS idx_alerts_verification_status_created_at
    ON alerts (verification_status, created_at DESC);

COMMIT;
