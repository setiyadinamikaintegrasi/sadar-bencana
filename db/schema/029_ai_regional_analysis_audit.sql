BEGIN;
CREATE TABLE IF NOT EXISTS ai_regional_analysis_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    administrative_code VARCHAR(32) NOT NULL,
    model_name VARCHAR(128) NOT NULL,
    prompt_version VARCHAR(32) NOT NULL,
    question TEXT NOT NULL,
    input_snapshot JSONB NOT NULL,
    output JSONB NOT NULL,
    refused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_regional_analysis_region
    ON ai_regional_analysis_audit (administrative_code, created_at DESC);
COMMIT;
