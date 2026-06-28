-- 017_rename_risk_entries.sql
-- Rename acceptance_contracts -> risk_entries (terminologi lebih generik untuk publik)
ALTER TABLE acceptance_contracts RENAME TO risk_entries;

ALTER INDEX idx_acceptance_contracts_geo    RENAME TO idx_risk_entries_geo;
ALTER INDEX idx_acceptance_contracts_peril  RENAME TO idx_risk_entries_peril;
ALTER INDEX idx_acceptance_contracts_period RENAME TO idx_risk_entries_period;
ALTER INDEX idx_acceptance_contracts_auth_user RENAME TO idx_risk_entries_auth_user;

ALTER TABLE risk_entries
  RENAME CONSTRAINT uq_acceptance_contracts_contract_no
  TO uq_risk_entries_contract_no;

SELECT 'risk_entries' AS table_name, count(*) AS rows FROM risk_entries;
