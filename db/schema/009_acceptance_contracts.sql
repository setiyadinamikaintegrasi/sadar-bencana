-- =============================================================================
-- 009_acceptance_contracts.sql — granular acceptance-contract risk objects
-- Project : Sadar Bencana (Risk Monitor)
-- Engine  : PostgreSQL 16
-- Notes   : Idempotent. 1 row = 1 acceptance contract = 1 geo-located risk object.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS acceptance_contracts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_no     TEXT NOT NULL,
    cedant_name     TEXT NOT NULL DEFAULT '',
    object_name     TEXT NOT NULL DEFAULT '',
    object_address  TEXT NOT NULL DEFAULT '',
    peril           TEXT NOT NULL DEFAULT 'other'
                      CHECK (peril IN ('earthquake','flood','volcano','fire','windstorm','other')),
    treaty_type     TEXT NOT NULL DEFAULT 'facultative'
                      CHECK (treaty_type IN ('facultative','treaty')),
    occupancy       TEXT NOT NULL DEFAULT '',
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'IDR',
    sum_insured     NUMERIC(18,2) NOT NULL DEFAULT 0,
    share_pct       NUMERIC(7,4)  NOT NULL DEFAULT 0,
    share_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    premium         NUMERIC(18,2) NOT NULL DEFAULT 0,
    claim_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    inception_date  DATE,
    expiry_date     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_acceptance_contracts_contract_no UNIQUE (contract_no)
);

CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_geo
    ON acceptance_contracts (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_peril
    ON acceptance_contracts (peril);
CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_period
    ON acceptance_contracts (inception_date, expiry_date);

COMMIT;

SELECT 'acceptance_contracts' AS table_name, count(*) AS rows FROM acceptance_contracts;
