BEGIN;

CREATE TABLE IF NOT EXISTS exposure_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region_name TEXT NOT NULL UNIQUE,
    region_keywords TEXT[] NOT NULL DEFAULT '{}',
    total_exposure BIGINT NOT NULL DEFAULT 0,
    treaty_category TEXT NOT NULL DEFAULT 'property',
    risk_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exposure_rules_is_active
    ON exposure_rules (is_active);

INSERT INTO exposure_rules (
    region_name,
    region_keywords,
    total_exposure,
    treaty_category,
    risk_multiplier,
    is_active
) VALUES
    (
        'Indonesia',
        ARRAY['indonesia', 'jakarta', 'java', 'sumatra', 'sulawesi', 'bali', 'lombok', 'papua', 'aceh', 'bandung', 'surabaya', 'yogyakarta'],
        3500000000000,
        'property',
        1.25,
        TRUE
    ),
    (
        'Japan',
        ARRAY['japan', 'tokyo', 'osaka', 'honshu', 'hokkaido', 'kyushu', 'sendai', 'tohoku'],
        2800000000000,
        'property',
        1.35,
        TRUE
    ),
    (
        'Turkey',
        ARRAY['turkey', 'türkiye', 'istanbul', 'ankara', 'izmir', 'gaziantep', 'kahramanmaras'],
        1900000000000,
        'property',
        1.30,
        TRUE
    ),
    (
        'California',
        ARRAY['california', 'los angeles', 'san francisco', 'san diego', 'sacramento', 'bay area'],
        2400000000000,
        'property',
        1.40,
        TRUE
    ),
    (
        'Chile',
        ARRAY['chile', 'santiago', 'valparaiso', 'concepcion', 'atacama'],
        1500000000000,
        'property',
        1.28,
        TRUE
    ),
    (
        'New Zealand',
        ARRAY['new zealand', 'auckland', 'wellington', 'christchurch', 'canterbury'],
        1200000000000,
        'property',
        1.22,
        TRUE
    ),
    (
        'Italy',
        ARRAY['italy', 'rome', 'sicily', 'naples', 'milan', 'l''aquila'],
        1100000000000,
        'property',
        1.15,
        TRUE
    ),
    (
        'Mexico',
        ARRAY['mexico', 'mexico city', 'oaxaca', 'guerrero', 'chiapas', 'baja california'],
        1600000000000,
        'property',
        1.24,
        TRUE
    ),
    (
        'Philippines',
        ARRAY['philippines', 'manila', 'luzon', 'mindanao', 'cebu', 'davao'],
        1400000000000,
        'property',
        1.20,
        TRUE
    ),
    (
        'Nepal',
        ARRAY['nepal', 'kathmandu', 'pokhara', 'everest', 'himalaya'],
        900000000000,
        'property',
        1.18,
        TRUE
    )
ON CONFLICT (region_name) DO UPDATE SET
    region_keywords = EXCLUDED.region_keywords,
    total_exposure = EXCLUDED.total_exposure,
    treaty_category = EXCLUDED.treaty_category,
    risk_multiplier = EXCLUDED.risk_multiplier,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

COMMIT;
