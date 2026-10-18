-- Conversation partner (M13, D-33). A conversation belongs to one session of
-- exercise type 'conversation': your spoken turns are takes in it (audio safety,
-- transcripts, Trash as usual) and typed turns are text. The scenario as it was
-- played is kept with the conversation, so a past one always reads the same.
-- Partner lines and the text that was sent are stored with the provider's raw
-- response, like coaching_runs (data rule 7). Deleted with the session; a take
-- deleted for good leaves its sent text behind and its turn reads "(take deleted)".
CREATE TABLE conversations (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
 scenario_id TEXT NOT NULL,
 persona_id TEXT NOT NULL,
 pressure INTEGER NOT NULL CHECK(pressure BETWEEN 0 AND 3),
 mode TEXT NOT NULL CHECK(mode IN ('api','local','scripted')),
 model_id TEXT,
 auto_send_local INTEGER NOT NULL DEFAULT 0 CHECK(auto_send_local IN (0,1)),
 max_cost_micro_usd INTEGER CHECK(max_cost_micro_usd BETWEEN 0 AND 5000000),
 status TEXT NOT NULL CHECK(status IN ('active','ended')),
 scenario_snapshot TEXT NOT NULL,
 source_attempt_id TEXT REFERENCES attempts(id),
 started_at_ms INTEGER NOT NULL,
 ended_at_ms INTEGER
) STRICT;
CREATE TABLE conversation_turns (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 ordinal INTEGER NOT NULL CHECK(ordinal > 0),
 role TEXT NOT NULL CHECK(role IN ('partner','learner')),
 text TEXT NOT NULL CHECK(length(text) <= 4000),
 move TEXT CHECK(move IN ('opening','follow_up','challenge','clarify','interrupt','wrap_up')),
 ends_conversation INTEGER NOT NULL DEFAULT 0 CHECK(ends_conversation IN (0,1)),
 typed INTEGER NOT NULL DEFAULT 0 CHECK(typed IN (0,1)),
 out_of_time INTEGER NOT NULL DEFAULT 0 CHECK(out_of_time IN (0,1)),
 attempt_id TEXT REFERENCES attempts(id),
 revision_id TEXT,
 payload_sha256 TEXT CHECK(payload_sha256 IS NULL OR length(payload_sha256)=64),
 provider_request_id TEXT,
 raw_response TEXT,
 input_tokens INTEGER CHECK(input_tokens >= 0),
 output_tokens INTEGER CHECK(output_tokens >= 0),
 estimated_cost_micro_usd INTEGER CHECK(estimated_cost_micro_usd >= 0),
 reserved_micro_usd INTEGER CHECK(reserved_micro_usd >= 0),
 created_at_ms INTEGER NOT NULL,
 UNIQUE(conversation_id, ordinal)
) STRICT;
CREATE INDEX conversation_turns_conversation ON conversation_turns(conversation_id, ordinal);
CREATE INDEX conversation_turns_attempt ON conversation_turns(attempt_id);
-- Upgrade loop (13.10): a clearer version of one take's answer, with the text
-- that was sent and the raw response. Kept apart from take feedback and purged
-- with the take; the shadow and retell takes live in a session of type 'upgrade'.
CREATE TABLE upgrade_runs (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 revision_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 sent_text TEXT NOT NULL,
 transcript_text TEXT NOT NULL,
 provider_request_id TEXT,
 raw_response TEXT NOT NULL,
 result TEXT NOT NULL,
 input_tokens INTEGER CHECK(input_tokens >= 0),
 output_tokens INTEGER CHECK(output_tokens >= 0),
 estimated_cost_micro_usd INTEGER CHECK(estimated_cost_micro_usd >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX upgrade_runs_attempt ON upgrade_runs(attempt_id, created_at_ms);
-- AI feedback on a whole conversation (13.11): your turns and the partner's
-- lines as context. Deleted with the conversation, never with one take.
CREATE TABLE conversation_feedback (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 provider TEXT NOT NULL,
 model_id TEXT NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 sent_text TEXT NOT NULL,
 learner_text TEXT NOT NULL,
 provider_request_id TEXT,
 raw_response TEXT NOT NULL,
 result TEXT NOT NULL,
 input_tokens INTEGER CHECK(input_tokens >= 0),
 output_tokens INTEGER CHECK(output_tokens >= 0),
 estimated_cost_micro_usd INTEGER CHECK(estimated_cost_micro_usd >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX conversation_feedback_conversation ON conversation_feedback(conversation_id, created_at_ms);
PRAGMA user_version=22;
