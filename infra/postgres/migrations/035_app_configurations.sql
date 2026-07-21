-- Application-wide feature toggles (hot-reloadable, no restart required)

CREATE TABLE IF NOT EXISTS app_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voice_calls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    video_calls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_configurations (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM app_configurations);
