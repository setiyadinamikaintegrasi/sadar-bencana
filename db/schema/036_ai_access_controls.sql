BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID NOT NULL,
    feature         TEXT NOT NULL CHECK (feature IN ('executive_briefing', 'copilot')),
    status          TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
    response_status INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_feature_created
    ON ai_usage_events (auth_user_id, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created
    ON ai_usage_events (feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_active
    ON ai_usage_events (auth_user_id, feature, created_at DESC)
    WHERE status = 'started';

CREATE TABLE IF NOT EXISTS ai_executive_briefing_cache (
    cache_key       TEXT PRIMARY KEY,
    content         TEXT NOT NULL,
    note            TEXT NOT NULL DEFAULT '',
    generated_by    UUID NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_executive_briefing_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON ai_usage_events
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ai_executive_briefing_cache
    FROM PUBLIC, anon, authenticated;

COMMIT;
