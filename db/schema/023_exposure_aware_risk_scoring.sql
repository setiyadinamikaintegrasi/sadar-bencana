BEGIN;

ALTER TABLE risk_scores
    ADD COLUMN IF NOT EXISTS formula_version VARCHAR(32) NOT NULL DEFAULT 'legacy-v0';

CREATE INDEX IF NOT EXISTS idx_risk_scores_formula_version
    ON risk_scores (formula_version, calculated_at DESC);

COMMIT;
