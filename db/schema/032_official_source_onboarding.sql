BEGIN;

ALTER TABLE official_source_settings
    ADD COLUMN IF NOT EXISTS adapter_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    ADD COLUMN IF NOT EXISTS field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS run_mode VARCHAR(16) NOT NULL DEFAULT 'disabled'
        CHECK (run_mode IN ('disabled','dry_run','active')),
    ADD COLUMN IF NOT EXISTS config_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_dry_run_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_dry_run_valid BOOLEAN,
    ADD COLUMN IF NOT EXISTS last_dry_run_config_version INT;

UPDATE official_source_settings
SET run_mode = CASE WHEN enabled THEN 'active' ELSE 'disabled' END
WHERE run_mode = 'disabled' AND enabled = TRUE;

CREATE TABLE IF NOT EXISTS official_source_setting_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name VARCHAR(64) NOT NULL
        REFERENCES official_source_settings(source_name) ON DELETE CASCADE,
    version INT NOT NULL,
    configuration JSONB NOT NULL,
    api_token_encrypted BYTEA,
    changed_by TEXT NOT NULL,
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_name, version)
);

CREATE TABLE IF NOT EXISTS official_source_setting_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name VARCHAR(64) NOT NULL
        REFERENCES official_source_settings(source_name) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL
        CHECK (action IN ('update','preview','dry_run','activate','rollback')),
    actor_email TEXT NOT NULL,
    config_version INT,
    success BOOLEAN NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_official_source_versions_source
    ON official_source_setting_versions (source_name, version DESC);
CREATE INDEX IF NOT EXISTS idx_official_source_audit_source
    ON official_source_setting_audit (source_name, created_at DESC);

INSERT INTO official_source_setting_versions
    (source_name, version, configuration, api_token_encrypted, changed_by, change_reason)
SELECT source_name, config_version,
       jsonb_build_object(
           'enabled', enabled,
           'mode', mode,
           'custom_api_url', custom_api_url,
           'poll_interval_seconds', poll_interval_seconds,
           'adapter_version', adapter_version,
           'field_mapping', field_mapping,
           'run_mode', run_mode
       ),
       api_token_encrypted,
       COALESCE(updated_by, 'migration'),
       'Initial version captured by migration 032'
FROM official_source_settings
ON CONFLICT (source_name, version) DO NOTHING;

COMMIT;
