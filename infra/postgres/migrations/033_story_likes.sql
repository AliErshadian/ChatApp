-- Story likes (visible to the story author in the viewers list).

CREATE TABLE IF NOT EXISTS story_likes (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_likes_user
    ON story_likes (user_id, liked_at DESC);
