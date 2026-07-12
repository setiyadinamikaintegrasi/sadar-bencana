-- 039_learning_progress.sql
-- Belajar Siaga: authenticated learning progress, XP, streaks, and badges.
-- Lesson content remains static in the web app for the MVP.
BEGIN;

CREATE TABLE IF NOT EXISTS learning_user_stats (
    user_id              UUID PRIMARY KEY,
    total_xp             INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    current_streak_days  INTEGER NOT NULL DEFAULT 0 CHECK (current_streak_days >= 0),
    longest_streak_days  INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak_days >= 0),
    last_activity_date   DATE,
    level                INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_module_progress (
    user_id              UUID NOT NULL,
    module_id            TEXT NOT NULL,
    status               TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')),
    quiz_score           INTEGER NOT NULL DEFAULT 0 CHECK (quiz_score >= 0),
    quiz_max_score       INTEGER NOT NULL DEFAULT 0 CHECK (quiz_max_score >= 0),
    checklist_completed  BOOLEAN NOT NULL DEFAULT FALSE,
    xp_earned            INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, module_id),
    CHECK (quiz_score <= quiz_max_score)
);

CREATE TABLE IF NOT EXISTS learning_badges (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    criteria    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_user_badges (
    user_id     UUID NOT NULL,
    badge_id    TEXT NOT NULL REFERENCES learning_badges(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_module_progress_user
    ON learning_module_progress(user_id);

CREATE INDEX IF NOT EXISTS idx_learning_user_badges_user
    ON learning_user_badges(user_id);

INSERT INTO learning_badges (id, name, description, criteria)
VALUES
    ('first_step', 'Langkah Pertama', 'Menyelesaikan modul Belajar Siaga pertama.', 'complete_any_module'),
    ('home_ready', 'Siaga Rumah', 'Menyelesaikan modul Rencana Evakuasi Rumah.', 'complete_home_evacuation_plan'),
    ('three_contexts_ready', 'Tiga Konteks Siaga', 'Menyelesaikan tiga konteks evakuasi awal.', 'complete_initial_three_modules'),
    ('streak_3', 'Streak 3 Hari', 'Belajar dalam tiga hari aktif berturut-turut.', 'reach_3_day_streak')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    criteria = EXCLUDED.criteria;

ALTER TABLE learning_user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_module_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_user_badges ENABLE ROW LEVEL SECURITY;

COMMIT;
