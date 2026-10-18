//! Conversations with the practice partner (roadmap 13.1, 13.4, 13.8, 13.9,
//! 13.11) and upgrade runs (13.10). A conversation owns one session of type
//! `conversation`: your spoken turns are takes in it and typed turns are
//! text. Partner lines are kept with what was sent and the raw response, so a
//! past conversation always reads as it was played. Nothing here sends
//! anything; requests are made by `commands/partner.rs` after Send.
use super::engagement::{award, local_date};
use super::insights::CURRENT_REVISION;
use super::{db_error, iso, DatabaseOwner, Result};
use crate::conversation::{Move, PanelQuestion, ScenarioText, ScriptLine, Upgrade, MAX_ANSWER_CHARS, MAX_TYPED_CHARS, QA_PANEL};
use crate::engagement::{EventKind, NewEvent};
use crate::storage::recording;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The exercise of every conversation session.
pub const CONVERSATION_EXERCISE: &str = "ex-conversation";
/// The exercise of an upgrade loop's shadow and retell takes (13.10).
pub const UPGRADE_EXERCISE: &str = "ex-upgrade";
/// A conversation earns `conversation` XP from this many of your answers (appendix B).
pub const MIN_COUNTED_TURNS: u32 = 3;

/// A conversation as you start it (13.3). The interface sends the scenario
/// from its content; the command fills in the model.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewConversation {
    pub scenario_id: String,
    pub persona_id: String,
    pub pressure: u8,
    pub mode: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub auto_send_local: bool,
    #[serde(default)]
    pub max_cost_micro_usd: Option<u64>,
    pub scenario: ScenarioText,
    /// The take a Q&A panel asks about (13.9).
    #[serde(default)]
    pub source_attempt_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub session_id: String,
    pub scenario_id: String,
    pub persona_id: String,
    pub pressure: u8,
    pub mode: String,
    pub model_id: Option<String>,
    pub auto_send_local: bool,
    pub max_cost_micro_usd: Option<u64>,
    pub status: String,
    pub scenario: ScenarioText,
    /// Every take of the conversation is recorded with exactly this prompt.
    pub session_prompt: String,
    pub source_attempt_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub ordinal: u32,
    /// "partner" or "learner".
    pub role: String,
    /// A partner line, or your answer as it was sent (your transcript or what you typed).
    pub text: String,
    #[serde(rename = "move")]
    pub kind: Option<String>,
    pub ends_conversation: bool,
    pub typed: bool,
    pub out_of_time: bool,
    pub attempt_id: Option<String>,
    pub revision_id: Option<String>,
    /// The take can be played (it exists and is not in Trash).
    pub take_available: bool,
    /// A spoken turn whose take was deleted for good; its text stays.
    pub take_deleted: bool,
    pub duration_ms: Option<u64>,
    pub estimated_cost_micro_usd: Option<u64>,
    pub created_at: String,
}

/// AI feedback on a whole conversation (13.11).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRun {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub sent_text: String,
    pub feedback: Value,
    pub estimated_cost_micro_usd: Option<u64>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub conversation: Conversation,
    pub turns: Vec<Turn>,
    pub learner_turns: u32,
    /// Settled estimates of the partner's turns; a turn without usage counts its preview's maximum.
    pub spent_micro_usd: u64,
    /// "learner" (your turn), "partner" (waiting for the partner), "closing" (over; End shows the summary) or "ended".
    pub next: String,
    pub feedback: Vec<FeedbackRun>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub session_id: String,
    pub scenario_id: String,
    pub title: String,
    pub persona_id: String,
    pub persona_title: String,
    pub pressure: u8,
    pub mode: String,
    pub status: String,
    pub learner_turns: u32,
    pub speaking_ms: u64,
    pub local_date: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

/// A partner line to store, with what was sent when a model wrote it.
#[derive(Clone, Debug, Default)]
pub struct PartnerTurnRecord {
    pub text: String,
    pub kind: Option<Move>,
    pub ends_conversation: bool,
    pub payload_sha256: Option<String>,
    pub provider_request_id: Option<String>,
    pub raw_response: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub estimated_cost_micro_usd: Option<u64>,
    pub reserved_micro_usd: Option<u64>,
}

/// What a partner request is built from (13.1).
pub struct TurnContext {
    pub conversation: Conversation,
    /// (partner, text) in order.
    pub history: Vec<(bool, String)>,
    pub out_of_time: bool,
    pub turns_left: u32,
    pub binding: Vec<String>,
    pub spent_micro_usd: u64,
}

/// A clearer version of one take's answer (13.10).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeRun {
    pub id: String,
    pub attempt_id: String,
    pub session_id: String,
    pub take_ordinal: u32,
    pub revision_id: String,
    pub provider: String,
    pub model: String,
    pub sent_text: String,
    pub transcript_text: String,
    pub upgraded: String,
    pub changes: Vec<crate::conversation::UpgradeChange>,
    pub estimated_cost_micro_usd: Option<u64>,
    /// The session the shadow and retell takes are recorded in.
    pub loop_session_id: String,
    pub created_at: String,
}

/// A finished request's answer, as stored with a conversation or a take.
pub struct NewAnswerRun<'a> {
    pub id: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub payload_sha256: &'a str,
    pub sent_text: &'a str,
    pub provider_request_id: Option<&'a str>,
    pub raw_response: &'a str,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub estimated_cost_micro_usd: Option<u64>,
}

const MODES: [&str; 3] = ["api", "local", "scripted"];

fn key_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn opt_u64(value: Option<i64>) -> Option<u64> {
    value.and_then(|v| u64::try_from(v).ok())
}

fn opt_i64(value: Option<u64>) -> Option<i64> {
    value.and_then(|v| i64::try_from(v).ok())
}

/// A fresh ID that is free in every table listed.
fn fresh_id(conn: &Connection, prefix: &str, now: i64, tables: &[&str]) -> Result<String> {
    for n in 0..1000u32 {
        let candidate = if n == 0 { format!("{prefix}-{now}") } else { format!("{prefix}-{now}-{n}") };
        let mut taken = false;
        for table in tables {
            taken |= conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [&candidate], |r| r.get::<_, bool>(0)).map_err(db_error)?;
        }
        if !taken {
            return Ok(candidate);
        }
    }
    Err("Could not create an ID.".into())
}

impl NewConversation {
    fn validate(&self) -> Result<()> {
        if !key_id(&self.scenario_id) || !key_id(&self.persona_id) || self.pressure > 3 || !MODES.contains(&self.mode.as_str()) {
            return Err("Choose a scenario, a partner, a pressure level and a mode from the lists.".into());
        }
        self.scenario.validate()?;
        if self.model_id.as_deref().is_some_and(|m| m.trim().is_empty() || m.chars().count() > 120 || m.chars().any(char::is_control)) {
            return Err("The model name is invalid.".into());
        }
        if self.max_cost_micro_usd.is_some_and(|m| m > 5_000_000) {
            return Err("Choose a cost limit of at most USD 5.00.".into());
        }
        // The scripted partner (13.8) needs a line after each of your answers but the last.
        if self.mode == "scripted" && (self.scenario.script.len() as u32) + 1 < self.scenario.max_turns {
            return Err("The scripted partner needs a line for each of your answers.".into());
        }
        if let Some(take) = &self.source_attempt_id {
            recording::validate_id(take)?;
        }
        Ok(())
    }
}

const CONVERSATION_COLUMNS: &str = "c.id,c.session_id,c.scenario_id,c.persona_id,c.pressure,c.mode,c.model_id,c.auto_send_local,c.max_cost_micro_usd,c.status,c.scenario_snapshot,c.source_attempt_id,c.started_at_ms,c.ended_at_ms,s.prompt_snapshot";

fn conversation_row(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    let snapshot: String = r.get(10)?;
    let scenario: ScenarioText = serde_json::from_str(&snapshot).map_err(|e| rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(Conversation {
        id: r.get(0)?,
        session_id: r.get(1)?,
        scenario_id: r.get(2)?,
        persona_id: r.get(3)?,
        pressure: r.get(4)?,
        mode: r.get(5)?,
        model_id: r.get(6)?,
        auto_send_local: r.get::<_, i64>(7)? == 1,
        max_cost_micro_usd: opt_u64(r.get(8)?),
        status: r.get(9)?,
        scenario,
        source_attempt_id: r.get(11)?,
        started_at: iso(r.get(12)?),
        ended_at: r.get::<_, Option<i64>>(13)?.map(iso),
        session_prompt: r.get::<_, Option<String>>(14)?.unwrap_or_default(),
    })
}

/// A conversation whose session is not in Trash.
fn load(conn: &Connection, id: &str) -> Result<Conversation> {
    recording::validate_id(id)?;
    conn.query_row(
        &format!("SELECT {CONVERSATION_COLUMNS} FROM conversations c JOIN sessions s ON s.id=c.session_id WHERE c.id=?1 AND s.deleted_at_ms IS NULL"),
        [id],
        conversation_row,
    )
    .optional()
    .map_err(db_error)?
    .ok_or_else(|| "This conversation is unavailable. It may be in Trash.".into())
}

const TURN_COLUMNS: &str = "t.id,t.ordinal,t.role,t.text,t.move,t.ends_conversation,t.typed,t.out_of_time,t.attempt_id,t.revision_id,t.estimated_cost_micro_usd,t.created_at_ms,a.id IS NOT NULL,aa.duration_ms";

fn turns(conn: &Connection, id: &str) -> Result<Vec<Turn>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TURN_COLUMNS} FROM conversation_turns t LEFT JOIN attempts a ON a.id=t.attempt_id AND a.deleted_at_ms IS NULL \
             LEFT JOIN audio_assets aa ON aa.id=a.asset_id WHERE t.conversation_id=?1 ORDER BY t.ordinal"
        ))
        .map_err(db_error)?;
    let rows = stmt
        .query_map([id], |r| {
            let role: String = r.get(2)?;
            let typed = r.get::<_, i64>(6)? == 1;
            let attempt_id: Option<String> = r.get(8)?;
            Ok(Turn {
                id: r.get(0)?,
                ordinal: r.get(1)?,
                take_deleted: role == "learner" && !typed && attempt_id.is_none(),
                role,
                text: r.get(3)?,
                kind: r.get(4)?,
                ends_conversation: r.get::<_, i64>(5)? == 1,
                typed,
                out_of_time: r.get::<_, i64>(7)? == 1,
                attempt_id,
                revision_id: r.get(9)?,
                estimated_cost_micro_usd: opt_u64(r.get(10)?),
                created_at: iso(r.get(11)?),
                take_available: r.get(12)?,
                duration_ms: opt_u64(r.get(13)?),
            })
        })
        .map_err(db_error)?;
    rows.collect::<rusqlite::Result<_>>().map_err(db_error)
}

fn learner_count(turns: &[Turn]) -> u32 {
    turns.iter().filter(|t| t.role == "learner").count() as u32
}

/// Whose turn it is (13.4): yours after a partner line, the partner's after
/// your answer, and over once the partner closed it or you used every answer.
fn next_step(conversation: &Conversation, turns: &[Turn]) -> &'static str {
    if conversation.status == "ended" {
        return "ended";
    }
    let used_all = learner_count(turns) >= conversation.scenario.max_turns;
    match turns.last() {
        Some(t) if t.role == "partner" && !t.ends_conversation && !used_all => "learner",
        Some(t) if t.role == "learner" && !used_all => "partner",
        _ => "closing",
    }
}

/// What an approval is bound to: each of your turns and the text it holds, and the number of turns.
fn binding(turns: &[Turn]) -> Vec<String> {
    let mut out: Vec<String> = turns
        .iter()
        .filter(|t| t.role == "learner")
        .map(|t| format!("{}:{}", t.id, t.revision_id.as_deref().unwrap_or("typed")))
        .collect();
    out.push(format!("turns:{}", turns.len()));
    out
}

fn spent(conn: &Connection, id: &str) -> Result<u64> {
    conn.query_row(
        "SELECT COALESCE(SUM(COALESCE(estimated_cost_micro_usd,reserved_micro_usd,0)),0) FROM conversation_turns WHERE conversation_id=?1 AND role='partner'",
        [id],
        |r| r.get::<_, i64>(0),
    )
    .map(|v| u64::try_from(v).unwrap_or(0))
    .map_err(db_error)
}

/// A spoken answer still waiting for the partner follows its take's current
/// transcript (your correction, or a newer transcript). Answered turns keep
/// the text the partner reacted to.
fn sync_waiting(conn: &Connection, id: &str) -> Result<()> {
    let last: Option<(String, String, Option<String>, Option<String>)> = conn
        .query_row("SELECT id,role,attempt_id,revision_id FROM conversation_turns WHERE conversation_id=?1 ORDER BY ordinal DESC LIMIT 1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()
        .map_err(db_error)?;
    let Some((turn, role, Some(attempt), revision)) = last else { return Ok(()) };
    if role != "learner" {
        return Ok(());
    }
    let current: Option<(String, String)> = conn
        .query_row(&format!("SELECT r.id,r.text FROM attempts a JOIN transcript_revisions r ON r.id={CURRENT_REVISION} WHERE a.id=?1"), [&attempt], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(db_error)?;
    if let Some((rev, text)) = current {
        let text = text.trim();
        if Some(&rev) != revision.as_ref() && !text.is_empty() && text.chars().count() <= MAX_ANSWER_CHARS {
            conn.execute("UPDATE conversation_turns SET revision_id=?2,text=?3 WHERE id=?1", params![turn, rev, text]).map_err(db_error)?;
        }
    }
    Ok(())
}

fn insert_partner(conn: &Connection, conversation: &str, ordinal: u32, turn: &PartnerTurnRecord, now: i64) -> Result<()> {
    let text = turn.text.trim();
    if text.is_empty() || text.chars().count() > MAX_ANSWER_CHARS {
        return Err("The partner's line is empty or too long.".into());
    }
    let id = fresh_id(conn, "turn", now, &["conversation_turns"])?;
    conn.execute(
        "INSERT INTO conversation_turns(id,conversation_id,ordinal,role,text,move,ends_conversation,payload_sha256,provider_request_id,raw_response,input_tokens,output_tokens,estimated_cost_micro_usd,reserved_micro_usd,created_at_ms) \
         VALUES (?1,?2,?3,'partner',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            id, conversation, ordinal, text, turn.kind.map(Move::as_str), turn.ends_conversation, turn.payload_sha256, turn.provider_request_id, turn.raw_response,
            opt_i64(turn.input_tokens), opt_i64(turn.output_tokens), opt_i64(turn.estimated_cost_micro_usd), opt_i64(turn.reserved_micro_usd), now
        ],
    )
    .map_err(db_error)?;
    Ok(())
}

impl DatabaseOwner {
    /// Starts a conversation (13.3): its session (exercise type `conversation`,
    /// one prompt for every take), the conversation and the partner's opening.
    /// `opening` replaces the scenario's opening line when a model wrote it
    /// (the panel's first question, 13.9).
    pub fn create_conversation(&self, input: &NewConversation, opening: Option<&PartnerTurnRecord>) -> Result<ConversationView> {
        input.validate()?;
        let id = {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            if let Some(take) = &input.source_attempt_id {
                let saved: bool = tx
                    .query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND capture_state='saved' AND deleted_at_ms IS NULL)", [take], |r| r.get(0))
                    .map_err(db_error)?;
                if !saved {
                    return Err("This take is unavailable.".into());
                }
            }
            let now = recording::now_ms() as i64;
            let id = fresh_id(&tx, "conversation", now, &["conversations", "sessions"])?;
            let local = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now).ok_or("Invalid date.")?.with_timezone(&chrono::Local);
            let snapshot = serde_json::to_string(&input.scenario).map_err(|_| "The scenario could not be saved.")?;
            // The run's settings (7.3): a past conversation reads as it was played.
            let activity = json!({"version": 1, "seed": id, "params": {"scenarioId": input.scenario_id, "personaId": input.persona_id, "pressure": input.pressure, "mode": input.mode}});
            tx.execute(
                "INSERT INTO sessions(id,profile_id,title,local_date,timezone_offset_seconds,started_at_ms,status,prompt_snapshot,outline_snapshot,activity_snapshot) VALUES (?1,'local',?2,?3,?4,?5,'in_progress',?6,?7,?8)",
                params![
                    id, format!("Partner: {}", input.scenario.title.trim()), local.format("%Y-%m-%d").to_string(), local.offset().local_minus_utc(), now,
                    input.scenario.session_prompt(), json!({"point": "", "reason": "", "example": ""}).to_string(), activity.to_string()
                ],
            )
            .map_err(db_error)?;
            tx.execute("INSERT OR IGNORE INTO exercise_definitions(id,version,type) VALUES (?1,1,'conversation')", [CONVERSATION_EXERCISE]).map_err(db_error)?;
            tx.execute(
                "INSERT INTO session_steps(id,session_id,exercise_id,exercise_version,position,status) VALUES (?1,?2,?3,1,1,'in_progress')",
                params![format!("step-{id}"), id, CONVERSATION_EXERCISE],
            )
            .map_err(db_error)?;
            let api = input.mode == "api";
            tx.execute(
                "INSERT INTO conversations(id,session_id,scenario_id,persona_id,pressure,mode,model_id,auto_send_local,max_cost_micro_usd,status,scenario_snapshot,source_attempt_id,started_at_ms) \
                 VALUES (?1,?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?10,?11)",
                params![
                    id, input.scenario_id, input.persona_id, input.pressure, input.mode, input.model_id.as_deref().filter(|_| input.mode != "scripted"),
                    input.auto_send_local && input.mode == "local", if api { opt_i64(input.max_cost_micro_usd.or(Some(50_000))) } else { None },
                    snapshot, input.source_attempt_id, now
                ],
            )
            .map_err(db_error)?;
            let first = match opening {
                Some(record) => record.clone(),
                None => PartnerTurnRecord { text: input.scenario.opening.clone(), kind: Some(Move::Opening), ..Default::default() },
            };
            insert_partner(&tx, &id, 1, &first, now)?;
            tx.commit().map_err(db_error)?;
            id
        };
        self.conversation(&id)
    }

    /// The conversation with its turns, what it spent and whose turn it is.
    pub fn conversation(&self, id: &str) -> Result<ConversationView> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let conversation = load(&conn, id)?;
        let turns = turns(&conn, id)?;
        let mut stmt = conn
            .prepare("SELECT id,provider,model_id,sent_text,result,estimated_cost_micro_usd,created_at_ms FROM conversation_feedback WHERE conversation_id=?1 ORDER BY created_at_ms DESC,id DESC")
            .map_err(db_error)?;
        let feedback = stmt
            .query_map([id], |r| {
                Ok(FeedbackRun {
                    id: r.get(0)?,
                    provider: r.get(1)?,
                    model: r.get(2)?,
                    sent_text: r.get(3)?,
                    feedback: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(Value::Null),
                    estimated_cost_micro_usd: opt_u64(r.get(5)?),
                    created_at: iso(r.get(6)?),
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(ConversationView {
            learner_turns: learner_count(&turns),
            spent_micro_usd: spent(&conn, id)?,
            next: next_step(&conversation, &turns).into(),
            conversation,
            turns,
            feedback,
        })
    }

    /// Your conversations, newest first (not in Trash).
    pub fn list_conversations(&self) -> Result<Vec<ConversationSummary>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(
                "SELECT c.id,c.session_id,c.scenario_id,c.persona_id,c.pressure,c.mode,c.status,c.scenario_snapshot,s.local_date,c.started_at_ms,c.ended_at_ms,\
                 (SELECT count(*) FROM conversation_turns t WHERE t.conversation_id=c.id AND t.role='learner'),\
                 (SELECT COALESCE(SUM(aa.duration_ms),0) FROM conversation_turns t JOIN attempts a ON a.id=t.attempt_id AND a.deleted_at_ms IS NULL JOIN audio_assets aa ON aa.id=a.asset_id WHERE t.conversation_id=c.id) \
                 FROM conversations c JOIN sessions s ON s.id=c.session_id WHERE s.deleted_at_ms IS NULL ORDER BY c.started_at_ms DESC,c.id DESC LIMIT 200",
            )
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                let scenario: Option<ScenarioText> = serde_json::from_str(&r.get::<_, String>(7)?).ok();
                Ok(ConversationSummary {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    scenario_id: r.get(2)?,
                    persona_id: r.get(3)?,
                    pressure: r.get(4)?,
                    mode: r.get(5)?,
                    status: r.get(6)?,
                    title: scenario.as_ref().map_or_else(String::new, |s| s.title.clone()),
                    persona_title: scenario.as_ref().map_or_else(String::new, |s| s.persona_title.clone()),
                    local_date: r.get(8)?,
                    started_at: iso(r.get(9)?),
                    ended_at: r.get::<_, Option<i64>>(10)?.map(iso),
                    learner_turns: r.get(11)?,
                    speaking_ms: opt_u64(r.get(12)?).unwrap_or(0),
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    /// Your answer (13.4): a saved take of this conversation's session (its
    /// current transcript is the text) or typed text. An answer still waiting
    /// for the partner is replaced; a take answers one turn only.
    pub fn add_learner_turn(&self, id: &str, attempt_id: Option<&str>, typed_text: Option<&str>, out_of_time: bool) -> Result<ConversationView> {
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let conversation = load(&tx, id)?;
            if conversation.status != "active" {
                return Err("This conversation has ended.".into());
            }
            let all = turns(&tx, id)?;
            let learner = learner_count(&all);
            let (ordinal, replacing, before) = match all.last() {
                Some(t) if t.role == "learner" => (t.ordinal, Some(t.id.clone()), learner - 1),
                Some(t) if t.ends_conversation => return Err("The partner closed this conversation. End it to see the summary.".into()),
                Some(t) => (t.ordinal + 1, None, learner),
                None => return Err("This conversation has no opening.".into()),
            };
            if before >= conversation.scenario.max_turns {
                return Err("You've used every answer in this conversation. End it to see the summary.".into());
            }
            let (text, revision, typed) = match (attempt_id, typed_text) {
                (Some(take), None) => {
                    recording::validate_id(take)?;
                    let ours: bool = tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM attempts a JOIN session_steps st ON st.id=a.step_id WHERE a.id=?1 AND st.session_id=?2 AND a.capture_state='saved' AND a.deleted_at_ms IS NULL)",
                            params![take, conversation.session_id],
                            |r| r.get(0),
                        )
                        .map_err(db_error)?;
                    if !ours {
                        return Err("This take isn't part of this conversation.".into());
                    }
                    let used: bool = tx
                        .query_row("SELECT EXISTS(SELECT 1 FROM conversation_turns WHERE attempt_id=?1 AND id IS NOT ?2)", params![take, replacing], |r| r.get(0))
                        .map_err(db_error)?;
                    if used {
                        return Err("This take already answers another turn.".into());
                    }
                    let (rev, text): (String, String) = tx
                        .query_row(&format!("SELECT r.id,r.text FROM attempts a JOIN transcript_revisions r ON r.id={CURRENT_REVISION} WHERE a.id=?1"), [take], |r| Ok((r.get(0)?, r.get(1)?)))
                        .optional()
                        .map_err(db_error)?
                        .ok_or("Transcribe this take first: the partner reads your answer's transcript.")?;
                    let text = text.trim().to_string();
                    if text.is_empty() {
                        return Err("This take's transcript is empty. Record it again or type your answer.".into());
                    }
                    if text.chars().count() > MAX_ANSWER_CHARS {
                        return Err("This answer is too long for one turn. Record a shorter one.".into());
                    }
                    (text, Some(rev), false)
                }
                (None, Some(typed)) => {
                    let text = typed.trim().to_string();
                    if text.is_empty() || text.chars().count() > MAX_TYPED_CHARS || text.contains('\0') {
                        return Err("Type an answer of up to 2,000 characters.".into());
                    }
                    (text, None, true)
                }
                _ => return Err("Answer with a take or with typed text.".into()),
            };
            if let Some(old) = &replacing {
                tx.execute("DELETE FROM conversation_turns WHERE id=?1", [old]).map_err(db_error)?;
            }
            let now = recording::now_ms() as i64;
            let turn = fresh_id(&tx, "turn", now, &["conversation_turns"])?;
            tx.execute(
                "INSERT INTO conversation_turns(id,conversation_id,ordinal,role,text,typed,out_of_time,attempt_id,revision_id,created_at_ms) VALUES (?1,?2,?3,'learner',?4,?5,?6,?7,?8,?9)",
                params![turn, id, ordinal, text, typed, out_of_time && !typed, attempt_id, revision, now],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)?;
        }
        self.conversation(id)
    }

    /// What the partner's next turn is built from (13.1). Your answer waiting
    /// for the partner first follows its take's current transcript.
    pub fn partner_turn_context(&self, id: &str) -> Result<TurnContext> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let tx = conn.unchecked_transaction().map_err(db_error)?;
        let conversation = load(&tx, id)?;
        sync_waiting(&tx, id)?;
        let all = turns(&tx, id)?;
        match next_step(&conversation, &all) {
            "partner" => {}
            "learner" => return Err("It's your turn: answer before the partner speaks again.".into()),
            _ => return Err("This conversation is over. End it to see the summary.".into()),
        }
        let spent_micro_usd = spent(&tx, id)?;
        tx.commit().map_err(db_error)?;
        let learner = learner_count(&all);
        Ok(TurnContext {
            out_of_time: all.last().is_some_and(|t| t.out_of_time),
            turns_left: conversation.scenario.max_turns.saturating_sub(learner),
            binding: binding(&all),
            history: all.iter().map(|t| (t.role == "partner", t.text.clone())).collect(),
            spent_micro_usd,
            conversation,
        })
    }

    /// Stores a model's partner turn (13.1), only while the conversation is
    /// exactly as it was previewed (`binding`).
    pub fn add_partner_turn(&self, id: &str, turn: &PartnerTurnRecord, expected: &[String]) -> Result<ConversationView> {
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let conversation = load(&tx, id)?;
            let all = turns(&tx, id)?;
            if next_step(&conversation, &all) != "partner" || binding(&all) != expected {
                return Err("Your answer changed while the partner was answering, so nothing was added. Preview again.".into());
            }
            let ordinal = all.last().map_or(1, |t| t.ordinal + 1);
            insert_partner(&tx, id, ordinal, turn, recording::now_ms() as i64)?;
            tx.commit().map_err(db_error)?;
        }
        self.conversation(id)
    }

    /// The next prepared line (13.8, 13.9): a scripted partner's next line, or
    /// the panel's next question. No request is made.
    pub fn next_scripted_turn(&self, id: &str) -> Result<ConversationView> {
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let conversation = load(&tx, id)?;
            if conversation.mode != "scripted" && conversation.scenario_id != QA_PANEL {
                return Err("This partner answers through a preview and Send.".into());
            }
            let all = turns(&tx, id)?;
            if next_step(&conversation, &all) != "partner" {
                return Err("It's not the partner's turn.".into());
            }
            let answered = learner_count(&all) as usize;
            let line: &ScriptLine = conversation.scenario.script.get(answered - 1).ok_or("The partner has no more prepared lines. End the conversation to see the summary.")?;
            let record = PartnerTurnRecord { text: line.text.clone(), kind: Some(line.kind), ends_conversation: line.kind == Move::WrapUp, ..Default::default() };
            let ordinal = all.last().map_or(1, |t| t.ordinal + 1);
            insert_partner(&tx, id, ordinal, &record, recording::now_ms() as i64)?;
            tx.commit().map_err(db_error)?;
        }
        self.conversation(id)
    }

    /// Ends the conversation (13.11): its session is complete, and three or more
    /// of your answers earn `conversation` once. Ending twice changes nothing.
    pub fn end_conversation(&self, id: &str) -> Result<ConversationView> {
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let conversation = load(&tx, id)?;
            if conversation.status != "ended" {
                let now = recording::now_ms() as i64;
                tx.execute("UPDATE conversations SET status='ended',ended_at_ms=?2 WHERE id=?1", params![id, now]).map_err(db_error)?;
                tx.execute("UPDATE sessions SET status='completed' WHERE id=?1", [&conversation.session_id]).map_err(db_error)?;
                tx.execute("UPDATE session_steps SET status='completed' WHERE session_id=?1", [&conversation.session_id]).map_err(db_error)?;
                if learner_count(&turns(&tx, id)?) >= MIN_COUNTED_TURNS {
                    let date = local_date(now);
                    award(&tx, &NewEvent { kind: EventKind::Conversation, ref_id: id, local_date: &date, session_id: Some(&conversation.session_id), attempt_id: None, created_at_ms: now, backfilled: false })?;
                }
            }
            tx.commit().map_err(db_error)?;
        }
        self.conversation(id)
    }

    /// Raises (or lowers) a conversation's own cost limit (13.1).
    pub fn set_conversation_limit(&self, id: &str, max_cost_micro_usd: u64) -> Result<ConversationView> {
        if !(10_000..=5_000_000).contains(&max_cost_micro_usd) {
            return Err("Choose a limit between USD 0.01 and USD 5.00.".into());
        }
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            let conversation = load(&conn, id)?;
            if conversation.mode != "api" {
                return Err("Only conversations with OpenAI have a cost limit.".into());
            }
            conn.execute("UPDATE conversations SET max_cost_micro_usd=?2 WHERE id=?1", params![id, max_cost_micro_usd as i64]).map_err(db_error)?;
        }
        self.conversation(id)
    }

    /// The whole conversation for AI feedback (13.11): (partner, text) turns and the binding.
    pub fn feedback_context(&self, id: &str) -> Result<(Conversation, Vec<(bool, String)>, Vec<String>)> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let conversation = load(&conn, id)?;
        let all = turns(&conn, id)?;
        if learner_count(&all) == 0 {
            return Err("Answer at least once before asking for feedback on the conversation.".into());
        }
        Ok((conversation, all.iter().map(|t| (t.role == "partner", t.text.clone())).collect(), binding(&all)))
    }

    /// The binding of a conversation as it is now (for feedback approvals).
    pub fn conversation_binding(&self, id: &str) -> Result<Vec<String>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        load(&conn, id)?;
        Ok(binding(&turns(&conn, id)?))
    }

    pub fn insert_conversation_feedback(&self, conversation_id: &str, run: &NewAnswerRun, learner_text: &str, feedback: &Value) -> Result<FeedbackRun> {
        recording::validate_id(run.id)?;
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            load(&conn, conversation_id)?;
            conn.execute(
                "INSERT INTO conversation_feedback(id,conversation_id,provider,model_id,payload_sha256,sent_text,learner_text,provider_request_id,raw_response,result,input_tokens,output_tokens,estimated_cost_micro_usd,created_at_ms) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    run.id, conversation_id, run.provider, run.model, run.payload_sha256, run.sent_text, learner_text, run.provider_request_id, run.raw_response,
                    feedback.to_string(), opt_i64(run.input_tokens), opt_i64(run.output_tokens), opt_i64(run.estimated_cost_micro_usd), recording::now_ms() as i64
                ],
            )
            .map_err(db_error)?;
        }
        self.conversation(conversation_id)?.feedback.into_iter().find(|f| f.id == run.id).ok_or_else(|| "The feedback could not be read back.".into())
    }

    /// Stores an upgrade (13.10) with the take it upgrades.
    pub fn insert_upgrade_run(&self, run: &NewAnswerRun, attempt_id: &str, revision_id: &str, transcript: &str, upgrade: &Upgrade) -> Result<UpgradeRun> {
        recording::validate_id(run.id)?;
        recording::validate_id(attempt_id)?;
        {
            let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
            conn.execute(
                "INSERT INTO upgrade_runs(id,attempt_id,revision_id,provider,model_id,payload_sha256,sent_text,transcript_text,provider_request_id,raw_response,result,input_tokens,output_tokens,estimated_cost_micro_usd,created_at_ms) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    run.id, attempt_id, revision_id, run.provider, run.model, run.payload_sha256, run.sent_text, transcript, run.provider_request_id, run.raw_response,
                    serde_json::to_string(upgrade).map_err(|_| "The upgrade could not be saved.")?, opt_i64(run.input_tokens), opt_i64(run.output_tokens),
                    opt_i64(run.estimated_cost_micro_usd), recording::now_ms() as i64
                ],
            )
            .map_err(db_error)?;
        }
        self.upgrade_run(run.id)
    }

    /// A take's upgrades, newest first.
    pub fn list_upgrade_runs(&self, attempt_id: &str) -> Result<Vec<UpgradeRun>> {
        recording::validate_id(attempt_id)?;
        self.upgrade_runs("u.attempt_id=?1", attempt_id)
    }

    pub fn upgrade_run(&self, id: &str) -> Result<UpgradeRun> {
        recording::validate_id(id)?;
        self.upgrade_runs("u.id=?1", id)?.into_iter().next().ok_or_else(|| "This upgrade is unavailable. It goes with its take when the take is deleted.".into())
    }

    fn upgrade_runs(&self, filter: &str, value: &str) -> Result<Vec<UpgradeRun>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT u.id,u.attempt_id,st.session_id,a.ordinal,u.revision_id,u.provider,u.model_id,u.sent_text,u.transcript_text,u.result,u.estimated_cost_micro_usd,u.created_at_ms \
                 FROM upgrade_runs u JOIN attempts a ON a.id=u.attempt_id JOIN session_steps st ON st.id=a.step_id WHERE {filter} ORDER BY u.created_at_ms DESC,u.id DESC"
            ))
            .map_err(db_error)?;
        let rows = stmt
            .query_map([value], |r| {
                let id: String = r.get(0)?;
                let upgrade: Upgrade = serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or(Upgrade { upgraded: String::new(), changes: Vec::new() });
                Ok(UpgradeRun {
                    loop_session_id: format!("{id}-loop"),
                    id,
                    attempt_id: r.get(1)?,
                    session_id: r.get(2)?,
                    take_ordinal: r.get(3)?,
                    revision_id: r.get(4)?,
                    provider: r.get(5)?,
                    model: r.get(6)?,
                    sent_text: r.get(7)?,
                    transcript_text: r.get(8)?,
                    upgraded: upgrade.upgraded,
                    changes: upgrade.changes,
                    estimated_cost_micro_usd: opt_u64(r.get(10)?),
                    created_at: iso(r.get(11)?),
                })
            })
            .map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }
}

/// The Q&A panel as a conversation (13.9): the first question opens it and the
/// others follow your answers, in the listeners' order. The panel's own text
/// matches the scripted panel in `src/content/scenarios.ts`.
pub fn panel_scenario(questions: &[PanelQuestion]) -> Result<ScenarioText> {
    let (first, rest) = questions.split_first().ok_or("The panel asked no questions.")?;
    let names: Vec<&str> = questions.iter().map(|q| match q.persona.as_str() { "newcomer" => "a newcomer", "skeptic" => "a sceptic", _ => "an expert" }).collect();
    Ok(ScenarioText {
        title: "Questions from a panel".into(),
        partner_role: format!("A panel of listeners: {}", names.join(", ")),
        learner_goal: "Answer each listener's question clearly".into(),
        opening: first.question.clone(),
        persona_title: "Panel".into(),
        persona_style: "Each listener asks one question in turn".into(),
        max_turns: questions.len() as u32,
        script: rest.iter().map(|q| ScriptLine { text: q.question.clone(), kind: if q.persona == "skeptic" { Move::Challenge } else { Move::FollowUp } }).collect(),
        guidance: None,
        boss_id: None,
        hints: questions.iter().map(|q| q.why.clone()).collect(),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::conversation::tests::scenario;
    use crate::storage::database::{Conditions, Outline, PracticeContext};
    use crate::storage::recording::tests::TestRoot;

    pub(crate) fn new_conversation(mode: &str) -> NewConversation {
        let mut scenario = scenario();
        scenario.max_turns = 4;
        scenario.script = ["What did you do next?", "Why that way?", "What would you change?"]
            .iter()
            .map(|t| ScriptLine { text: (*t).into(), kind: Move::FollowUp })
            .collect();
        NewConversation {
            scenario_id: "job-interview".into(),
            persona_id: "interviewer".into(),
            pressure: 2,
            mode: mode.into(),
            model_id: (mode == "api").then(|| "gpt-6-luna".into()),
            auto_send_local: false,
            max_cost_micro_usd: (mode == "api").then_some(50_000),
            scenario,
            source_attempt_id: None,
        }
    }

    pub(crate) fn context(view: &ConversationView, index: u32) -> PracticeContext {
        PracticeContext {
            session_id: view.conversation.session_id.clone(),
            exercise_id: CONVERSATION_EXERCISE.into(),
            exercise_version: 1,
            exercise_type: "conversation".into(),
            prompt: view.conversation.session_prompt.clone(),
            outline: Outline { point: String::new(), reason: String::new(), example: String::new() },
            conditions: Conditions { familiarity: "unfamiliar".into(), preparation_seconds: 0, target_seconds: 60, audience: None, follow_up: true },
            curriculum_version: None,
            content_id: None,
            activity: None,
            step: Some(crate::activity::ActivityStep { index, key: "turn".into(), prompt_id: None }),
        }
    }

    /// A saved, transcribed take in the conversation's session.
    pub(crate) fn spoken(db: &DatabaseOwner, root: &TestRoot, view: &ConversationView, id: &str, text: &str) {
        db.reserve(id, &format!("op-{id}"), "Turn", Some(&context(view, view.turns.len() as u32 + 1))).unwrap();
        db.commit_recording(&crate::storage::database::engagement::tests::audio(&root.0, id, 12)).unwrap();
        crate::storage::database::engagement::tests::transcribe(db, id, text);
    }

    #[test]
    fn a_conversation_owns_its_session_and_turns_alternate() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let view = db.create_conversation(&new_conversation("scripted"), None).unwrap();
        assert_eq!((view.next.as_str(), view.turns.len(), view.turns[0].kind.as_deref()), ("learner", 1, Some("opening")));
        assert_eq!(view.conversation.session_prompt, "Job interview: Show your experience with clear examples");
        assert!(db.partner_turn_context(&view.conversation.id).is_err(), "your turn first");
        // A typed answer, then the scripted partner's next line.
        let view = db.add_learner_turn(&view.conversation.id, None, Some("  I led a migration last year.  "), true).unwrap();
        assert_eq!((view.next.as_str(), view.turns[1].text.as_str(), view.turns[1].typed, view.turns[1].out_of_time), ("partner", "I led a migration last year.", true, false));
        // A second answer replaces the one still waiting.
        let view = db.add_learner_turn(&view.conversation.id, None, Some("I led a database migration."), false).unwrap();
        assert_eq!((view.turns.len(), view.turns[1].text.as_str()), (2, "I led a database migration."));
        let view = db.next_scripted_turn(&view.conversation.id).unwrap();
        assert_eq!((view.next.as_str(), view.turns[2].text.as_str()), ("learner", "What did you do next?"));
        // A spoken answer must be a transcribed take of this session.
        spoken(&db, &root, &view, "turn-take", "We moved the reports first.");
        assert!(db.add_learner_turn(&view.conversation.id, Some("other-take"), None, false).is_err());
        let view = db.add_learner_turn(&view.conversation.id, Some("turn-take"), None, true).unwrap();
        let turn = &view.turns[3];
        assert_eq!((turn.text.as_str(), turn.typed, turn.out_of_time, turn.take_available, turn.duration_ms), ("We moved the reports first.", false, true, true, Some(12_000)));
        assert!(db.add_learner_turn(&view.conversation.id, None, Some(""), false).is_err());
        // Every take of the conversation keeps the session's one prompt.
        let session = db.list_sessions(None, None, false).unwrap();
        assert!(session.iter().any(|s| s["id"] == view.conversation.session_id.as_str()), "the session is in your history");
    }

    #[test]
    fn ending_completes_the_session_and_three_answers_earn_xp_once() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let short = db.create_conversation(&new_conversation("scripted"), None).unwrap();
        db.add_learner_turn(&short.conversation.id, None, Some("One."), false).unwrap();
        let ended = db.end_conversation(&short.conversation.id).unwrap();
        assert_eq!(ended.next, "ended");
        assert!(db.add_learner_turn(&short.conversation.id, None, Some("Two."), false).is_err(), "nothing after the end");
        let id = db.create_conversation(&new_conversation("scripted"), None).unwrap().conversation.id;
        for answer in ["One.", "Two.", "Three.", "Four."] {
            let view = db.add_learner_turn(&id, None, Some(answer), false).unwrap();
            if view.next == "partner" {
                db.next_scripted_turn(&id).unwrap();
            }
        }
        let view = db.conversation(&id).unwrap();
        assert_eq!((view.learner_turns, view.next.as_str()), (4, "closing"), "four answers is the scenario's limit");
        // Your last answer can still be replaced: nothing has replied to it.
        let replaced = db.add_learner_turn(&id, None, Some("Four, said better."), false).unwrap();
        assert_eq!((replaced.learner_turns, replaced.turns.last().unwrap().text.as_str()), (4, "Four, said better."));
        db.end_conversation(&id).unwrap();
        db.end_conversation(&id).unwrap();
        let events = db.list_practice_events(None).unwrap();
        let earned: Vec<_> = events.iter().filter(|e| e.kind == "conversation").collect();
        assert_eq!(earned.len(), 1, "once, and not for the one-answer conversation");
        assert_eq!((earned[0].ref_id.as_str(), earned[0].xp), (id.as_str(), 30));
        let list = db.list_conversations().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!((list[0].title.as_str(), list[0].learner_turns, list[0].status.as_str()), ("Job interview", 4, "ended"));
    }

    #[test]
    fn the_partner_turn_context_follows_a_corrected_transcript_and_binds_to_it() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let view = db.create_conversation(&new_conversation("api"), None).unwrap();
        spoken(&db, &root, &view, "answer", "I like to test early.");
        let id = view.conversation.id.clone();
        db.add_learner_turn(&id, Some("answer"), None, false).unwrap();
        let before = db.partner_turn_context(&id).unwrap();
        assert_eq!((before.turns_left, before.out_of_time, before.history.len()), (3, false, 2));
        // A correction changes what is sent and the binding.
        let machine = db.conversation(&id).unwrap().turns[1].revision_id.clone().unwrap();
        db.save_transcript_correction("answer", &machine, "I like to test things early.", recording::now_ms()).unwrap();
        let after = db.partner_turn_context(&id).unwrap();
        assert_eq!(after.history[1].1, "I like to test things early.");
        assert_ne!(before.binding, after.binding);
        // A partner turn is stored only against the binding it was previewed with.
        let record = PartnerTurnRecord { text: "Why early?".into(), kind: Some(Move::FollowUp), estimated_cost_micro_usd: None, reserved_micro_usd: Some(4_000), ..Default::default() };
        assert!(db.add_partner_turn(&id, &record, &before.binding).is_err());
        let view = db.add_partner_turn(&id, &record, &after.binding).unwrap();
        assert_eq!((view.next.as_str(), view.spent_micro_usd), ("learner", 4_000), "a turn without usage counts its reservation");
        assert!(db.next_scripted_turn(&id).is_err(), "an API partner never uses prepared lines");
        assert!(db.set_conversation_limit(&id, 100_000).unwrap().conversation.max_cost_micro_usd == Some(100_000));
    }

    #[test]
    fn conversation_rows_are_purged_with_the_session_and_learner_takes_unlinked() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let view = db.create_conversation(&new_conversation("scripted"), None).unwrap();
        let id = view.conversation.id.clone();
        spoken(&db, &root, &view, "kept-text", "We shipped on time.");
        db.add_learner_turn(&id, Some("kept-text"), None, false).unwrap();
        // Deleting the take for good leaves its sent text and "(take deleted)".
        db.move_take_to_trash("kept-text", recording::now_ms()).unwrap();
        assert!(!db.conversation(&id).unwrap().turns[1].take_available, "a take in Trash can't be played");
        db.delete_takes_permanently(&["kept-text".into()]).unwrap();
        let turn = db.conversation(&id).unwrap().turns[1].clone();
        assert_eq!((turn.text.as_str(), turn.attempt_id, turn.take_deleted), ("We shipped on time.", None, true));
        // Deleting the session for good removes the conversation and its turns.
        db.move_to_trash(&view.conversation.session_id, recording::now_ms()).unwrap();
        assert!(db.conversation(&id).is_err() && db.list_conversations().unwrap().is_empty(), "Trash hides it");
        db.delete_permanently(&[view.conversation.session_id.clone()]).unwrap();
        let conn = db.connection.lock().unwrap();
        for table in ["conversations", "conversation_turns", "conversation_feedback"] {
            let n: i64 = conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{table}");
        }
    }

    #[test]
    fn the_panel_becomes_a_conversation_of_its_questions() {
        let questions = vec![
            PanelQuestion { persona: "newcomer".into(), question: "What is an index?".into(), why: String::new() },
            PanelQuestion { persona: "skeptic".into(), question: "How do you know it helped?".into(), why: String::new() },
        ];
        let scenario = panel_scenario(&questions).unwrap();
        assert_eq!((scenario.opening.as_str(), scenario.max_turns, scenario.script[0].kind), ("What is an index?", 2, Move::Challenge));
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let input = NewConversation { scenario_id: QA_PANEL.into(), persona_id: "panel".into(), pressure: 0, mode: "api".into(), model_id: Some("gpt-6-luna".into()),
            auto_send_local: false, max_cost_micro_usd: Some(50_000), scenario, source_attempt_id: None };
        let opening = PartnerTurnRecord { text: "What is an index?".into(), kind: Some(Move::Opening), payload_sha256: Some("a".repeat(64)), raw_response: Some("{}".into()),
            estimated_cost_micro_usd: Some(900), ..Default::default() };
        let view = db.create_conversation(&input, Some(&opening)).unwrap();
        assert_eq!(view.spent_micro_usd, 900);
        let id = view.conversation.id;
        db.add_learner_turn(&id, None, Some("A sorted lookup."), false).unwrap();
        let view = db.next_scripted_turn(&id).unwrap();
        assert_eq!((view.turns[2].text.as_str(), view.turns[2].kind.as_deref()), ("How do you know it helped?", Some("challenge")));
        db.add_learner_turn(&id, None, Some("Queries got faster."), false).unwrap();
        assert_eq!(db.conversation(&id).unwrap().next, "closing", "one answer per question");
    }
}
