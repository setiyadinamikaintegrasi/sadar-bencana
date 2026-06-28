BEGIN;

-- Kepemilikan risiko: tautkan tiap risiko ke user Supabase pembuatnya.
-- Nullable; baris tanpa pemilik (auth_user_id IS NULL) dianggap data demo/dummy.
ALTER TABLE acceptance_contracts
    ADD COLUMN IF NOT EXISTS auth_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_acceptance_contracts_auth_user
    ON acceptance_contracts (auth_user_id);

-- Bersihkan data dummy: hanya baris tanpa pemilik. Aman diulang (idempotent):
-- baris milik user asli punya auth_user_id dan tak akan terhapus. Pada instalasi
-- baru, ini juga menghapus baris seed 010 sehingga register mulai kosong.
DELETE FROM acceptance_contracts WHERE auth_user_id IS NULL;

COMMIT;
