BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT NOT NULL,
    entitlement_jti   TEXT UNIQUE,
    entitlement_state TEXT NOT NULL DEFAULT 'active'
                      CHECK (entitlement_state IN ('active','disabled','expired')),
    entitlement_expires_at TIMESTAMPTZ,
    max_users         INTEGER NOT NULL DEFAULT 1 CHECK (max_users > 0),
    max_company_risks INTEGER NOT NULL DEFAULT 1 CHECK (max_company_risks > 0),
    created_by        UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    auth_user_id    UUID NOT NULL,
    email           TEXT,
    role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner','admin','member')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, auth_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_members_user
    ON organization_members(auth_user_id);

CREATE TABLE IF NOT EXISTS entitlement_activations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entitlement_jti TEXT NOT NULL,
    token_hash      TEXT NOT NULL,
    claims          JSONB NOT NULL,
    activated_by   UUID NOT NULL,
    activated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin','member')),
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    invited_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE risk_entries
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE risk_entries DROP CONSTRAINT IF EXISTS uq_risk_entries_contract_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_entries_org_contract_no
    ON risk_entries(organization_id, contract_no) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_entries_user_contract_no
    ON risk_entries(auth_user_id, contract_no) WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS personal_assets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID NOT NULL,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'other'
                    CHECK (category IN ('home','building','vehicle','business','land','other')),
    address         TEXT NOT NULL DEFAULT '',
    latitude        DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude       DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    estimated_value NUMERIC(18,2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
    currency        TEXT NOT NULL DEFAULT 'IDR',
    notes           TEXT NOT NULL DEFAULT '',
    peril_types     TEXT[] NOT NULL DEFAULT '{}',
    alert_radius_km NUMERIC(8,2) NOT NULL DEFAULT 25
                    CHECK (alert_radius_km > 0 AND alert_radius_km <= 5000),
    thresholds      JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_assets_owner
    ON personal_assets(auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_assets_geo
    ON personal_assets(latitude, longitude);

ALTER TABLE ews_watch_zones
    ADD COLUMN IF NOT EXISTS personal_asset_id UUID UNIQUE
        REFERENCES personal_assets(id) ON DELETE CASCADE;

COMMIT;
