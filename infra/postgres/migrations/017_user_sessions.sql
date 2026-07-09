CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_label VARCHAR(128) NOT NULL,
    app_name VARCHAR(64),
    client_type VARCHAR(32),
    platform VARCHAR(64),
    user_agent TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;

INSERT INTO user_sessions (
    id,
    user_id,
    device_label,
    client_type,
    platform,
    user_agent,
    ip_address,
    created_at,
    last_active_at
)
SELECT DISTINCT ON (rt.session_family_id)
    rt.session_family_id,
    rt.user_id,
    COALESCE(NULLIF(TRIM(rt.device_label), ''), 'Unknown device'),
    rt.client_type,
    rt.platform,
    rt.user_agent,
    rt.ip_address,
    rt.created_at,
    COALESCE(rt.last_used_at, rt.created_at)
FROM refresh_tokens rt
WHERE rt.session_family_id IS NOT NULL
ORDER BY rt.session_family_id, rt.created_at DESC
ON CONFLICT (id) DO NOTHING;
