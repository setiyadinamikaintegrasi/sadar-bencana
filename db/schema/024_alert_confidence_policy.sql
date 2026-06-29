BEGIN;

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS confidence_class VARCHAR(32) NOT NULL DEFAULT 'unverified_signal',
    ADD COLUMN IF NOT EXISTS policy_version VARCHAR(32) NOT NULL DEFAULT 'legacy-v0',
    ADD COLUMN IF NOT EXISTS policy_decision JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS manual_override_by TEXT,
    ADD COLUMN IF NOT EXISTS manual_override_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_alerts_confidence_class'
    ) THEN
        ALTER TABLE alerts ADD CONSTRAINT chk_alerts_confidence_class
        CHECK (confidence_class IN (
            'official_warning', 'confirmed_event',
            'corroborated_signal', 'unverified_signal'
        ));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_alerts_confidence_policy
    ON alerts (confidence_class, policy_version, created_at DESC);

COMMIT;
