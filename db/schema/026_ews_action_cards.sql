BEGIN;

CREATE TABLE IF NOT EXISTS ews_safety_guidance (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    peril_type      VARCHAR(64) NOT NULL,
    language_code   VARCHAR(8) NOT NULL DEFAULT 'id',
    content_version VARCHAR(32) NOT NULL,
    content         JSONB NOT NULL,
    curated_by      TEXT NOT NULL,
    source_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ews_guidance_version
        UNIQUE (peril_type, language_code, content_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ews_guidance_active
    ON ews_safety_guidance (peril_type, language_code)
    WHERE is_active = TRUE;

INSERT INTO ews_safety_guidance (
    peril_type, language_code, content_version, content, curated_by, source_url
)
VALUES
('earthquake', 'id', 'id-v1',
 '{"before":["Kenali jalur keluar dan titik kumpul bangunan.","Amankan benda berat yang mudah jatuh."],"during":["Lindungi kepala dan tubuh dari benda jatuh.","Jauhi kaca, lemari, dan struktur yang rusak."],"after":["Periksa kondisi sekitar sebelum berpindah.","Ikuti informasi dan arahan resmi BMKG/BPBD."]}',
 'SadarBencana safety editorial', 'https://www.bmkg.go.id/gempabumi/antisipasi-gempabumi'),
('flood', 'id', 'id-v1',
 '{"before":["Pantau informasi resmi cuaca dan kondisi sungai.","Siapkan dokumen serta kebutuhan penting di tempat aman."],"during":["Jangan berjalan atau berkendara melintasi arus banjir.","Matikan listrik hanya jika aman dan sesuai arahan petugas."],"after":["Hindari air yang mungkin tercemar atau beraliran listrik.","Kembali hanya setelah ada informasi aman dari petugas."]}',
 'SadarBencana safety editorial', 'https://www.bnpb.go.id/'),
('volcano', 'id', 'id-v1',
 '{"before":["Ketahui radius dan sektor bahaya resmi PVMBG.","Siapkan pelindung pernapasan dan kacamata."],"during":["Jangan memasuki zona rekomendasi bahaya.","Ikuti arahan PVMBG dan petugas setempat."],"after":["Waspadai abu vulkanik dan lahar hujan.","Jangan kembali ke zona bahaya sebelum status resmi berubah."]}',
 'SadarBencana safety editorial', 'https://magma.esdm.go.id/'),
('wildfire', 'id', 'id-v1',
 '{"before":["Pantau kualitas udara dan informasi kebakaran resmi.","Siapkan masker yang sesuai untuk paparan asap."],"during":["Kurangi aktivitas luar ruang saat asap pekat.","Jauhi area kebakaran dan akses kendaraan pemadam."],"after":["Tetap pantau kualitas udara dan titik api susulan.","Ikuti arahan kesehatan dan pemerintah setempat."]}',
 'SadarBencana safety editorial', 'https://www.bnpb.go.id/')
ON CONFLICT (peril_type, language_code, content_version) DO NOTHING;

COMMIT;
