//! The conversation partner (roadmap M13, D-33). Every request is previewed
//! first and sent only by its own Send, with the preview's ID and fingerprint,
//! bound to the conversation or take it was built from (A-33). A local model's
//! turns go without asking only when the conversation has auto-send ticked and
//! the server is on this computer. Scripted conversations make no requests.
use crate::api::coaching::{self, Binding, CoachingModel, PartnerAnswer, PartnerKind, PartnerRequest, Preview, PreviewOwner};
use crate::api::local_llm::{validate_endpoint, LocalTarget};
use crate::audio::capture::CaptureService;
use crate::conversation::{self, Move, TurnText, QA_PANEL};
use crate::storage::database::conversations::{
    self as store, Conversation, ConversationSummary, ConversationView, FeedbackRun, NewAnswerRun, NewConversation, PartnerTurnRecord, TurnContext, UpgradeRun,
};
use crate::storage::database::DatabaseOwner;
use crate::{preferences, take_coaching, with_storage, ApiAccounting, InflightApi, SessionStorage};
use std::sync::Arc;
use tauri::State;

/// A partner turn's preview and what the conversation has spent (13.1).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartnerPreview {
    #[serde(flatten)]
    pub preview: Preview,
    pub conversation_spent_micro_usd: u64,
    pub cap_micro_usd: Option<u64>,
}

/// A take's request (the panel or an upgrade) and the transcript revision it was built from.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakePartnerPreview {
    pub preview: Preview,
    pub revision_id: String,
}

/// The in-flight key a local conversation's automatic turn is stopped with.
pub fn auto_key(conversation_id: &str) -> String {
    format!("partner-auto-{conversation_id}")
}

fn model_of(id: Option<&str>) -> Result<CoachingModel, String> {
    match id {
        None => Ok(CoachingModel::default()),
        Some(id) => CoachingModel::all().into_iter().find(|m| m.id() == id).ok_or_else(|| "This conversation's model is no longer offered. Start a new conversation.".into()),
    }
}

/// Where a conversation's turns go: its OpenAI model, or the local model on
/// this computer (never a silent switch between them).
fn conversation_target(db: &DatabaseOwner, c: &Conversation) -> Result<(CoachingModel, Option<LocalTarget>), String> {
    match c.mode.as_str() {
        "api" => Ok((model_of(c.model_id.as_deref())?, None)),
        "local" => {
            let base = validate_endpoint(&preferences::load(db)?.local_endpoint)?;
            let model = c.model_id.clone().filter(|m| m != "local").unwrap_or_default();
            Ok((CoachingModel::default(), Some(LocalTarget { base, model })))
        }
        _ => Err("Scripted conversations make no requests.".into()),
    }
}

/// Where a take's or a finished conversation's request goes: as Settings → Coaching says.
fn coaching_target(db: &DatabaseOwner, model: Option<CoachingModel>) -> Result<(CoachingModel, Option<LocalTarget>), String> {
    let prefs = preferences::load(db)?;
    match prefs.coaching_mode.as_str() {
        "off" => Err("AI suggestions are turned off in Settings → Coaching.".into()),
        "local" => Ok((CoachingModel::default(), Some(LocalTarget { base: validate_endpoint(&prefs.local_endpoint)?, model: prefs.local_model.clone() }))),
        _ => Ok((model.unwrap_or(prefs.coaching_model), None)),
    }
}

/// The request for the partner's next turn, built from the stored conversation.
pub(crate) fn turn_request(db: &DatabaseOwner, context: &TurnContext) -> Result<(PartnerRequest, CoachingModel, Option<LocalTarget>), String> {
    let c = &context.conversation;
    if c.mode == "scripted" || c.scenario_id == QA_PANEL {
        return Err("This partner's lines are prepared, so no request is needed.".into());
    }
    let history: Vec<TurnText> = context.history.iter().map(|(partner, text)| TurnText { partner: *partner, text }).collect();
    let request = PartnerRequest {
        kind: PartnerKind::Turn,
        instructions: conversation::partner_instructions(c.pressure),
        input: conversation::build_turn_input(&c.scenario, &history, c.pressure, context.out_of_time, context.turns_left),
        schema_name: "clearpractice_partner_turn_v1",
        schema: conversation::partner_schema(&conversation::allowed_moves(c.pressure, context.out_of_time)),
        prompt: format!("The partner's next turn in \"{}\" (a practice conversation)", conversation::one_line(&c.scenario.title)),
        focus: "One spoken reply of at most 60 words".into(),
        binding: Binding { owner: c.id.clone(), revisions: context.binding.clone() },
    };
    let (model, local) = conversation_target(db, c)?;
    Ok((request, model, local))
}

/// Sends an approved request in a task that Stop waiting can abort (as for
/// take feedback, 3.18): before dispatch nothing is billed; after it the
/// charge stays uncertain and nothing is saved.
#[allow(clippy::too_many_arguments)]
async fn send(
    owner: Arc<PreviewOwner>,
    accounting: Arc<ApiAccounting>,
    inflight: Arc<InflightApi>,
    key: String,
    request_id: String,
    payload_sha256: String,
    kind: PartnerKind,
    binding: Binding,
    local: bool,
) -> Result<PartnerAnswer, String> {
    if !local {
        accounting.0.as_ref().map_err(Clone::clone)?;
    }
    let task = {
        let (accounting, request_id) = (accounting.clone(), request_id.clone());
        tauri::async_runtime::spawn(async move {
            if local {
                return owner.send_partner_local(&request_id, &payload_sha256, kind, &binding).await;
            }
            let budget = accounting.0.as_ref().map_err(Clone::clone)?;
            owner.send_partner(budget, &accounting.1, &request_id, &payload_sha256, kind, &binding).await
        })
    };
    let abort = task.inner().abort_handle();
    if let Ok(mut map) = inflight.0.lock() {
        map.insert(key.clone(), Box::new(move || abort.abort()));
    }
    let outcome = task.await;
    if let Ok(mut map) = inflight.0.lock() {
        map.remove(&key);
    }
    match outcome {
        Ok(result) => result,
        Err(_) if local => Err("Stopped waiting for the local model. Nothing left this computer.".into()),
        Err(_) => Err(crate::api::audio::stopped(accounting.0.as_ref().map_err(Clone::clone)?, &request_id)),
    }
}

fn answer_run<'a>(id: &'a str, answer: &'a PartnerAnswer, raw: &'a str) -> NewAnswerRun<'a> {
    NewAnswerRun {
        id,
        provider: &answer.provider,
        model: &answer.model,
        payload_sha256: &answer.payload_sha256,
        sent_text: &answer.sent_text,
        provider_request_id: answer.provider_request_id.as_deref(),
        raw_response: raw,
        input_tokens: answer.input_tokens,
        output_tokens: answer.output_tokens,
        estimated_cost_micro_usd: answer.estimated_cost_micro_usd,
    }
}

/// Checks the partner's reply and stores it, only if the conversation is
/// still as it was previewed.
async fn store_turn(storage: &State<'_, Arc<SessionStorage>>, id: &str, context: &TurnContext, answer: PartnerAnswer) -> Result<ConversationView, String> {
    let turn = conversation::parse_partner_turn(&answer.text, context.conversation.pressure, context.out_of_time)?;
    let record = PartnerTurnRecord {
        text: turn.reply,
        kind: Some(turn.kind),
        ends_conversation: turn.ends_conversation,
        payload_sha256: Some(answer.payload_sha256),
        provider_request_id: answer.provider_request_id,
        raw_response: Some(answer.raw.to_string()),
        input_tokens: answer.input_tokens,
        output_tokens: answer.output_tokens,
        estimated_cost_micro_usd: answer.estimated_cost_micro_usd,
        reserved_micro_usd: Some(answer.reserved_micro_usd),
    };
    let (id, expected) = (id.to_string(), context.binding.clone());
    with_storage(storage, move |db| db.add_partner_turn(&id, &record, &expected))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Starts a conversation (13.3). An OpenAI conversation gets its model and
/// cost limit; a local one needs a server on this computer.
#[tauri::command]
pub async fn start_conversation(storage: State<'_, Arc<SessionStorage>>, input: NewConversation) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| {
        let prefs = preferences::load(db)?;
        let mut input = input;
        match input.mode.as_str() {
            "api" => {
                input.model_id = Some(input.model_id.as_deref().map(|m| model_of(Some(m))).transpose()?.unwrap_or(prefs.coaching_model).id().into());
                input.max_cost_micro_usd = Some(input.max_cost_micro_usd.unwrap_or(prefs.partner_max_cost_micro_usd));
                input.auto_send_local = false;
            }
            "local" => {
                validate_endpoint(&prefs.local_endpoint)?;
                input.model_id = Some(if prefs.local_model.is_empty() { "local".into() } else { prefs.local_model.clone() });
                input.max_cost_micro_usd = None;
            }
            _ => {
                input.model_id = None;
                input.max_cost_micro_usd = None;
                input.auto_send_local = false;
            }
        }
        if input.scenario_id == QA_PANEL && input.mode != "scripted" {
            return Err("A panel's questions come from its own preview and Send.".into());
        }
        db.create_conversation(&input, None)
    })
    .await
    .map_err(|_| "Starting the conversation failed.".to_string())?
}

#[tauri::command]
pub async fn get_conversation(storage: State<'_, Arc<SessionStorage>>, conversation_id: String) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| db.conversation(&conversation_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_conversations(storage: State<'_, Arc<SessionStorage>>) -> Result<Vec<ConversationSummary>, String> {
    with_storage(&storage, |db| db.list_conversations()).await.map_err(|_| "Session storage failed.".to_string())?
}

/// Your answer: a transcribed take of the conversation, or typed text (13.4).
#[tauri::command]
pub async fn add_learner_turn(
    storage: State<'_, Arc<SessionStorage>>,
    conversation_id: String,
    attempt_id: Option<String>,
    typed_text: Option<String>,
    out_of_time: bool,
) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| db.add_learner_turn(&conversation_id, attempt_id.as_deref(), typed_text.as_deref(), out_of_time))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

/// Previews the partner's next turn (13.1). Refused when it would take the
/// conversation over its cost limit. Nothing is sent here.
#[tauri::command]
pub async fn preview_partner_turn(storage: State<'_, Arc<SessionStorage>>, owner: State<'_, Arc<PreviewOwner>>, conversation_id: String) -> Result<PartnerPreview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let context = db.partner_turn_context(&conversation_id)?;
        let (request, model, local) = turn_request(db, &context)?;
        let preview = owner.preview_partner(request, model, local)?;
        let c = &context.conversation;
        let cap = c.max_cost_micro_usd.filter(|_| c.mode == "api");
        if let Some(refusal) = conversation::cost_cap_refusal(context.spent_micro_usd, preview.estimated_maximum_cost_micro_usd, cap) {
            let _ = owner.cancel(&preview.request_id);
            return Err(refusal);
        }
        Ok(PartnerPreview { preview, conversation_spent_micro_usd: context.spent_micro_usd, cap_micro_usd: cap })
    })
    .await
    .map_err(|_| "Preparing the partner's turn failed.".to_string())?
}

/// Sends an approved partner turn: single-use, bound to the payload and your
/// answers as they were previewed (A-33).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn request_partner_turn(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    conversation_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<ConversationView, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let context = {
        let id = conversation_id.clone();
        with_storage(&storage, move |db| db.partner_turn_context(&id)).await.map_err(|_| "Session storage failed.".to_string())??
    };
    let binding = Binding { owner: conversation_id.clone(), revisions: context.binding.clone() };
    owner.ensure_binding(&request_id, &binding)?;
    let local = owner.is_local(&request_id);
    let answer = send(owner, accounting.inner().clone(), inflight.inner().clone(), request_id.clone(), request_id, payload_sha256, PartnerKind::Turn, binding, local).await?;
    store_turn(&storage, &conversation_id, &context, answer).await
}

/// A local model's turn without asking (D-33): only when the conversation has
/// auto-send ticked and the server is on this computer. Stop waiting uses
/// `auto_key`. Nothing leaves the computer.
#[tauri::command]
pub async fn send_partner_turn_auto(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    conversation_id: String,
) -> Result<ConversationView, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let (context, preview, binding) = {
        let (id, owner) = (conversation_id.clone(), owner.clone());
        with_storage(&storage, move |db| {
            let context = db.partner_turn_context(&id)?;
            let c = &context.conversation;
            conversation::auto_send_target(&c.mode, c.auto_send_local, &preferences::load(db)?.local_endpoint)?;
            let (request, model, local) = turn_request(db, &context)?;
            if local.is_none() {
                return Err("Only a local model's turns can be sent without asking. Press Send.".into());
            }
            let binding = request.binding.clone();
            let preview = owner.preview_partner(request, model, local)?;
            Ok((context, preview, binding))
        })
        .await
        .map_err(|_| "Session storage failed.".to_string())??
    };
    let answer = send(owner, accounting.inner().clone(), inflight.inner().clone(), auto_key(&conversation_id), preview.request_id, preview.payload_sha256, PartnerKind::Turn, binding, true).await?;
    store_turn(&storage, &conversation_id, &context, answer).await
}

/// The scripted partner's next line, or the panel's next question (13.8, 13.9).
#[tauri::command]
pub async fn next_scripted_turn(storage: State<'_, Arc<SessionStorage>>, conversation_id: String) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| db.next_scripted_turn(&conversation_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn end_conversation(storage: State<'_, Arc<SessionStorage>>, conversation_id: String) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| db.end_conversation(&conversation_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn set_conversation_limit(storage: State<'_, Arc<SessionStorage>>, conversation_id: String, max_cost_micro_usd: u64) -> Result<ConversationView, String> {
    with_storage(&storage, move |db| db.set_conversation_limit(&conversation_id, max_cost_micro_usd))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
}

fn panel_binding(attempt_id: &str, revision_id: &str, personas: &[String]) -> Binding {
    Binding { owner: attempt_id.into(), revisions: vec![revision_id.into(), personas.join(",")] }
}

/// Previews the Q&A panel on a transcribed take (13.9): the task and your
/// transcript, one question per chosen listener. Nothing is sent here.
#[tauri::command]
pub async fn preview_qa_panel(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    attempt_id: String,
    personas: Vec<String>,
    model: Option<CoachingModel>,
) -> Result<TakePartnerPreview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let personas = conversation::panel_personas(&personas)?;
        let input = db.take_coaching_input(&attempt_id)?;
        let text = take_coaching::follow_up_text(&input)?;
        let (model, local) = coaching_target(db, model)?;
        let request = PartnerRequest {
            kind: PartnerKind::QaPanel,
            instructions: conversation::QA_INSTRUCTIONS.into(),
            input: conversation::qa_input(&text.text, &personas),
            schema_name: "clearpractice_qa_panel_v1",
            schema: conversation::qa_schema(&personas),
            prompt: "Questions from a panel of listeners (a simulation)".into(),
            focus: format!("One question each from: {}", personas.join(", ")),
            binding: panel_binding(&attempt_id, &input.revision_id, &personas),
        };
        let preview = owner.preview_partner(request, model, local)?;
        Ok(TakePartnerPreview { preview, revision_id: input.revision_id })
    })
    .await
    .map_err(|_| "Preparing the panel failed.".to_string())?
}

/// Sends an approved panel preview and starts its conversation (13.9).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_qa_panel(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    attempt_id: String,
    personas: Vec<String>,
    request_id: String,
    payload_sha256: String,
) -> Result<ConversationView, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let personas = conversation::panel_personas(&personas)?;
    let revision = {
        let id = attempt_id.clone();
        with_storage(&storage, move |db| db.take_coaching_input(&id).map(|i| i.revision_id)).await.map_err(|_| "Session storage failed.".to_string())??
    };
    let binding = panel_binding(&attempt_id, &revision, &personas);
    owner.ensure_binding(&request_id, &binding)?;
    let local = owner.is_local(&request_id);
    let answer = send(owner, accounting.inner().clone(), inflight.inner().clone(), request_id.clone(), request_id, payload_sha256, PartnerKind::QaPanel, binding, local).await?;
    let questions = conversation::parse_qa_panel(&answer.text, &personas)?;
    let scenario = store::panel_scenario(&questions)?;
    let opening = PartnerTurnRecord {
        text: questions[0].question.clone(),
        kind: Some(Move::Opening),
        ends_conversation: false,
        payload_sha256: Some(answer.payload_sha256.clone()),
        provider_request_id: answer.provider_request_id.clone(),
        raw_response: Some(answer.raw.to_string()),
        input_tokens: answer.input_tokens,
        output_tokens: answer.output_tokens,
        estimated_cost_micro_usd: answer.estimated_cost_micro_usd,
        reserved_micro_usd: Some(answer.reserved_micro_usd),
    };
    let input = NewConversation {
        scenario_id: QA_PANEL.into(),
        persona_id: "panel".into(),
        pressure: 0,
        mode: if local { "local" } else { "api" }.into(),
        model_id: Some(answer.model.clone()),
        auto_send_local: false,
        max_cost_micro_usd: None,
        scenario,
        source_attempt_id: Some(attempt_id),
    };
    with_storage(&storage, move |db| db.create_conversation(&input, Some(&opening)))
        .await
        .map_err(|_| "Session storage failed.".to_string())?
        .map_err(|e| format!("The questions arrived but could not be saved ({e}). Nothing will be sent again."))
}

/// Previews an upgrade of a transcribed take (13.10): the task and your
/// transcript. Nothing is sent here.
#[tauri::command]
pub async fn preview_upgrade(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    attempt_id: String,
    model: Option<CoachingModel>,
) -> Result<TakePartnerPreview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let input = db.take_coaching_input(&attempt_id)?;
        let text = take_coaching::follow_up_text(&input)?;
        let (model, local) = coaching_target(db, model)?;
        let request = PartnerRequest {
            kind: PartnerKind::Upgrade,
            instructions: conversation::UPGRADE_INSTRUCTIONS.into(),
            input: text.text,
            schema_name: "clearpractice_upgrade_v1",
            schema: conversation::upgrade_schema(),
            prompt: "A clearer version of your own answer".into(),
            focus: "Your meaning and ideas kept; only the wording changes".into(),
            binding: Binding { owner: attempt_id.clone(), revisions: vec![input.revision_id.clone()] },
        };
        let preview = owner.preview_partner(request, model, local)?;
        Ok(TakePartnerPreview { preview, revision_id: input.revision_id })
    })
    .await
    .map_err(|_| "Preparing the upgrade failed.".to_string())?
}

/// Sends an approved upgrade preview and stores the upgrade with its take.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn request_upgrade(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    attempt_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<UpgradeRun, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let input = {
        let id = attempt_id.clone();
        with_storage(&storage, move |db| db.take_coaching_input(&id)).await.map_err(|_| "Session storage failed.".to_string())??
    };
    let binding = Binding { owner: attempt_id.clone(), revisions: vec![input.revision_id.clone()] };
    owner.ensure_binding(&request_id, &binding)?;
    let local = owner.is_local(&request_id);
    let answer = send(owner, accounting.inner().clone(), inflight.inner().clone(), request_id.clone(), request_id.clone(), payload_sha256, PartnerKind::Upgrade, binding, local).await?;
    let upgrade = conversation::parse_upgrade(&answer.text, &input.text)?;
    with_storage(&storage, move |db| {
        let raw = answer.raw.to_string();
        db.insert_upgrade_run(&answer_run(&request_id, &answer, &raw), &attempt_id, &input.revision_id, &input.text, &upgrade)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn list_upgrade_runs(storage: State<'_, Arc<SessionStorage>>, attempt_id: String) -> Result<Vec<UpgradeRun>, String> {
    with_storage(&storage, move |db| db.list_upgrade_runs(&attempt_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

#[tauri::command]
pub async fn get_upgrade_run(storage: State<'_, Arc<SessionStorage>>, run_id: String) -> Result<UpgradeRun, String> {
    with_storage(&storage, move |db| db.upgrade_run(&run_id)).await.map_err(|_| "Session storage failed.".to_string())?
}

fn feedback_request(c: &Conversation, turns: &[(bool, String)], binding: Vec<String>) -> (PartnerRequest, String) {
    let texts: Vec<TurnText> = turns.iter().map(|(partner, text)| TurnText { partner: *partner, text }).collect();
    let (input, learner) = conversation::feedback_input(&c.scenario, &texts);
    let request = PartnerRequest {
        kind: PartnerKind::Feedback,
        instructions: conversation::FEEDBACK_INSTRUCTIONS.into(),
        input,
        schema_name: "clearpractice_conversation_feedback_v1",
        schema: coaching::take_feedback_schema(),
        prompt: format!("Feedback on your conversation \"{}\"", conversation::one_line(&c.scenario.title)),
        focus: "Your turns; the partner's lines are context".into(),
        binding: Binding { owner: c.id.clone(), revisions: binding },
    };
    (request, learner)
}

/// Previews AI feedback on a conversation (13.11): your turns, with the
/// partner's lines as context. Nothing is sent here.
#[tauri::command]
pub async fn preview_conversation_feedback(
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    conversation_id: String,
    model: Option<CoachingModel>,
) -> Result<Preview, String> {
    let owner = owner.inner().clone();
    with_storage(&storage, move |db| {
        let (c, turns, binding) = db.feedback_context(&conversation_id)?;
        let (request, _) = feedback_request(&c, &turns, binding);
        let (model, local) = coaching_target(db, model)?;
        owner.preview_partner(request, model, local)
    })
    .await
    .map_err(|_| "Preparing the feedback request failed.".to_string())?
}

/// Sends approved conversation feedback; every correction must quote your own turns.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn request_conversation_feedback(
    service: State<'_, Arc<CaptureService>>,
    storage: State<'_, Arc<SessionStorage>>,
    owner: State<'_, Arc<PreviewOwner>>,
    accounting: State<'_, Arc<ApiAccounting>>,
    inflight: State<'_, Arc<InflightApi>>,
    conversation_id: String,
    request_id: String,
    payload_sha256: String,
) -> Result<FeedbackRun, String> {
    if service.is_active() {
        return Err("Finish the recording first. Nothing was sent.".into());
    }
    let owner = owner.inner().clone();
    let (c, turns, current) = {
        let id = conversation_id.clone();
        with_storage(&storage, move |db| db.feedback_context(&id)).await.map_err(|_| "Session storage failed.".to_string())??
    };
    let (request, learner) = feedback_request(&c, &turns, current);
    owner.ensure_binding(&request_id, &request.binding)?;
    let local = owner.is_local(&request_id);
    let answer = send(owner, accounting.inner().clone(), inflight.inner().clone(), request_id.clone(), request_id.clone(), payload_sha256, PartnerKind::Feedback, request.binding, local).await?;
    let feedback = coaching::parse_feedback_text(&answer.text, &learner)?;
    with_storage(&storage, move |db| {
        let raw = answer.raw.to_string();
        db.insert_conversation_feedback(&conversation_id, &answer_run(&request_id, &answer, &raw), &learner, &feedback)
    })
    .await
    .map_err(|_| "Session storage failed.".to_string())?
}
