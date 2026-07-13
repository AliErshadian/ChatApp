CREATE TABLE call_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    caller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    end_reason TEXT NOT NULL,
    ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER
);

CREATE INDEX idx_call_records_caller_ended ON call_records (caller_id, ended_at DESC);
CREATE INDEX idx_call_records_callee_ended ON call_records (callee_id, ended_at DESC);
CREATE INDEX idx_call_records_conversation ON call_records (conversation_id);

GRANT ALL PRIVILEGES ON TABLE call_records TO chatapp;
