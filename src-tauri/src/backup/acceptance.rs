//! A-38: exercise the public storage writers and the real ZIP/restore pipeline.
use super::*;
use crate::storage::database::{confidence, conversations, drills, engagement, events, game, listener, phrases, social};
use crate::storage::recording::{self, tests::TestRoot};
use serde_json::{json, Value};

const EXPORTED: &[&str] = &[
    "exercise_definitions", "practice_events", "phrase_uses", "self_checks", "audio_measures",
    "comparisons", "personal_records", "take_events", "activity_results", "self_predictions",
    "catch_runs", "segment_marks", "conversations", "conversation_turns", "upgrade_runs",
    "conversation_feedback", "rehearsals", "listener_packs", "listener_feedback",
];

struct Profile {
    // Close SQLite before TestRoot removes the profile on Windows.
    db: DatabaseOwner,
    root: TestRoot,
    // Different exercise types require separate sessions in the app.
    sessions: Vec<(String, String)>,
}

fn seed() -> Profile {
    let root = TestRoot::new();
    let db = DatabaseOwner::open(&root.0).unwrap();
    db.add_phrase(&phrases::PhraseText { original: "indexes work", expression: "indexes help", explanation: "", examples: &[] }, None, chrono::Local::now().date_naive()).unwrap();
    let mut drill = engagement::tests::context("a38-drill", "familiar", ["Point", "Reason", "Example"]);
    drill.exercise_id = "ex-jam".into();
    drill.exercise_type = "jam".into();
    drill.content_id = Some("pack-prompt".into());
    drill.prompt = "Captured pack prompt".into();
    drill.activity = Some(serde_json::from_value(json!({"version":1,"seed":"a38-seed","params":{"topicId":"pack-topic"}})).unwrap());
    drill.step = Some(crate::activity::ActivityStep { index: 0, key: "round-0".into(), prompt_id: None });
    db.reserve("a38-jam", "op-a38-jam", "A drill", Some(&drill)).unwrap();
    db.commit_recording(&engagement::tests::audio(&root.0, "a38-jam", 12)).unwrap();
    db.add_take_events("a38-jam", &[drills::TakeEventInput { at_ms: 250, kind: "self_flag".into(), data: Default::default() }]).unwrap();

    let talk = db.save_talk(&serde_json::from_value(json!({"title":"Private talk outline", "sections":[{"title":"Original opening", "keywords":["indexes"], "notes":"Private talk notes", "targetSeconds":30}]})).unwrap()).unwrap();
    db.reserve("a38-rehearsal", "op-a38-rehearsal", "Rehearsal", Some(&events::tests::rehearsal_context("a38-rehearsal-session", &talk.talk.id))).unwrap();
    db.commit_recording(&engagement::tests::audio(&root.0, "a38-rehearsal", 12)).unwrap();
    db.add_take_events("a38-rehearsal", &[drills::TakeEventInput { at_ms: 300, kind: "section_mark".into(), data: [("sectionId".into(), talk.sections[0].id.clone().into())].into_iter().collect() }]).unwrap();
    db.record_rehearsal(&talk.talk.id, "a38-rehearsal").unwrap();

    let conversation = db.create_conversation(&conversations::tests::new_conversation("scripted"), None).unwrap();
    conversations::tests::spoken(&db, &root, &conversation, "a38-turn", "Indexes help explain the result.");
    db.add_learner_turn(&conversation.conversation.id, Some("a38-turn"), None, false).unwrap();
    db.next_scripted_turn(&conversation.conversation.id).unwrap();
    db.add_learner_turn(&conversation.conversation.id, None, Some("A typed answer survives too."), false).unwrap();
    let sha = "d".repeat(64);
    let run = conversations::NewAnswerRun { id: "a38-feedback", provider: "local", model: "test", payload_sha256: &sha, sent_text: "Sent context", provider_request_id: None, raw_response: "{}", input_tokens: None, output_tokens: None, estimated_cost_micro_usd: None };
    db.insert_conversation_feedback(&conversation.conversation.id, &run, "Indexes help", &json!({"summary":"Feedback survives"})).unwrap();

    let sessions: Vec<(String, String)> = vec![
        ("a38-drill".into(), "a38-jam".into()),
        ("a38-rehearsal-session".into(), "a38-rehearsal".into()),
        (conversation.conversation.session_id, "a38-turn".into()),
    ];
    for (_, take) in &sessions {
        let revision = if take == "a38-turn" { format!("{take}--1") } else { engagement::tests::transcribe(&db, take, "Indexes help explain the result.") };
        db.set_prediction(take, "pace", "usual").unwrap();
        db.set_self_check(take, "point_first", Some(true), 123).unwrap();
        db.audio_measures(take).unwrap();
        db.save_catch_run(take, &[250, 750], 1, 2).unwrap();
        db.set_segment_mark(&revision, 0, true).unwrap();
        let pack_id = format!("pack-{take}");
        db.save_listener_pack(&listener::NewPack { id: &pack_id, attempt_id: take, questions: &["What was my point?".into()], from: "Alex", include_transcript: true, created_at_ms: 123 }).unwrap();
        let imported = db.import_listener_answers(&crate::listener_pack::Answers { pack_id, name: "Sam".into(), answers: vec![format!("Answer for {take}")], answered_at: None }, &hex(Sha256::new_with_prefix(take))).unwrap();
        db.set_listener_judgement(&imported.feedback.id, Some(true)).unwrap();
    }
    db.activity_result("a38-jam").unwrap();
    db.save_comparison("a38-jam", "a38-rehearsal", "same", true, 123).unwrap();
    let upgrade = crate::conversation::Upgrade { upgraded: "A clearer answer".into(), changes: vec![] };
    db.insert_upgrade_run(&conversations::NewAnswerRun { id: "a38-upgrade", ..run }, "a38-jam", "a38-jam--1", "Indexes help explain the result.", &upgrade).unwrap();
    db.record_unlocks(&game::UnlockInput {
        levels: vec![game::NewLevel { area: "fluency".into(), level: 1, definition_version: 1, evidence: json!({"takes":["a38-jam"]}) }],
        achievements: vec![game::NewAchievement { id: "first-take".into(), definition_version: 1, evidence: json!({}) }],
        records: vec![game::NewRecord { record: "longest_take".into(), value: 12.0, unit: "s".into(), attempt_id: Some("a38-jam".into()), session_id: Some("a38-drill".into()), definition_version: 1 }],
        quests_done: vec![], weekly_goal: None, local_date: "2026-10-19".into(),
    }).unwrap();
    db.set_weekly_quests("2026-10-19", &[game::QuestInput { slot: 1, quest: "practice-twice".into(), params: json!({}) }]).unwrap();
    let programme = db.start_programme("fillers-4w").unwrap();
    db.complete_programme_step(&programme.id, "listen", Some("a38-jam")).unwrap();
    let step = db.save_exposure_steps(&[confidence::StepInput { id: None, title: "Private exposure step".into(), template_id: None }]).unwrap().remove(0);
    let attempt = db.add_exposure_attempt(&confidence::AttemptInput { step_id: step.id, local_date: "2026-10-19".into(), before_rating: Some(7), after_rating: Some(3), outcome: "yes".into(), note: "Private exposure note".into() }).unwrap();
    db.delete_exposure_attempt(&attempt.id).unwrap();
    let event = db.save_event(&serde_json::from_value(json!({"title":"Private upcoming event", "kind":"talk", "localDate":"2026-10-25"})).unwrap()).unwrap();
    db.link_event_talk(&event.id, &talk.talk.id).unwrap();
    db.save_event_plan(&event.id, &[events::PlanItemInput { local_date: "2026-10-20".into(), kind: "outline".into(), title: "Private event plan".into() }]).unwrap();
    let routine = db.save_routine_run(&confidence::RoutineInput { steps: vec!["unload".into()], kept_note: Some("Private routine worry".into()), event_id: Some(event.id.clone()) }).unwrap();
    db.delete_routine_run(&routine.id).unwrap();
    db.pick_mission("2026-10-19", Some("ask-in-meeting")).unwrap();
    db.capsule_offer("2026-10-19").unwrap();
    db.dismiss_capsule("2026-10").unwrap();
    db.add_transfer_review(&serde_json::from_value(json!({
        "localDate":"2026-10-19", "situation":"Private reflection", "preparation":"", "listenerText":"", "clarification":"", "success":"", "selfReport":"", "nextFocus":"", "flow":"mixed", "tags":["meeting"],
        "kind":"aar", "extra":{"planned":"Private plan", "happened":"Spoke", "eventId":event.id}, "missionId":"ask-in-meeting"
    })).unwrap()).unwrap();
    let club = social::tests::meeting(&db);
    db.save_club_speech(&club.meeting.id, &club.speeches[0].id, &social::ClubSpeechResult { seconds: 330, counts: [("um".into(), 2)].into(), word_used: Some(true), notes: "Private club note".into() }).unwrap();
    db.delete_club_meeting(&club.meeting.id).unwrap();
    db.import_content_pack(r#"{"format":"clearpractice-content-pack","version":1,"id":"a38-pack","title":"Private entire content pack","prompts":[],"drillTopics":{},"scenarios":[],"missions":[]}"#).unwrap();
    db.remove_content_pack("a38-pack").unwrap();
    // An unrelated session must not leak through any table or readable entry.
    db.reserve("a38-other", "op-a38-other", "Private unrelated session", None).unwrap();
    db.commit_recording(&engagement::tests::audio(&root.0, "a38-other", 1)).unwrap();
    db.set_prediction("a38-other", "pace", "faster").unwrap();
    Profile { root, db, sessions }
}

fn table_rows(root: &Path, table: &str) -> Vec<Value> {
    let conn = Connection::open_with_flags(root.join(DATABASE), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).unwrap();
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |r| {
        let mut row = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match r.get::<_, rusqlite::types::Value>(i)? {
                rusqlite::types::Value::Null => Value::Null,
                rusqlite::types::Value::Integer(v) => json!(v),
                rusqlite::types::Value::Real(v) => json!(v),
                rusqlite::types::Value::Text(v) => json!(v),
                rusqlite::types::Value::Blob(_) => panic!("unexpected blob in {table}.{name}"),
            };
            row.insert(name.clone(), value);
        }
        Ok(Value::Object(row))
    }).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    rows
}

fn new_tables() -> BTreeSet<String> {
    let mut tables = BTreeSet::new();
    for version in 16..=25 {
        let schema = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("src/storage/schema-v{version}.sql"))).unwrap();
        for line in schema.lines() {
            if let Some(name) = line.strip_prefix("CREATE TABLE ").and_then(|s| s.split_whitespace().next()) {
                tables.insert(name.trim_end_matches("_v16").to_string());
            }
        }
    }
    tables
}

#[test]
fn a38_every_v16_to_v25_table_survives_backup_and_restore() {
    let profile = seed();
    let mut tables = new_tables();
    // Also verify the columns added to existing tables in these migrations.
    tables.extend(["sessions".into(), "transfer_reviews".into()]);
    let expected: BTreeMap<_, _> = tables.iter().map(|table| {
        let rows = table_rows(&profile.root.0, table);
        assert!(!rows.is_empty(), "{table} must actually be seeded");
        (table.clone(), rows)
    }).collect();
    let out = TestRoot::new();
    let archive = out.0.join(create(&profile.db, &out.0, recording::now_ms()).unwrap().file_name);
    let fresh = TestRoot::new();
    let empty = DatabaseOwner::open(&fresh.0).unwrap();
    assert!(empty.list_sessions(None, None, false).unwrap().is_empty());
    inspect(&fresh.0, &archive, "a38-restore").unwrap();
    drop(empty);
    replace_profile(&fresh.0, "a38-restore", recording::now_ms()).unwrap();
    let restored = DatabaseOwner::open(&fresh.0).unwrap();
    finish_restore(&fresh.0).unwrap();
    for (table, rows) in expected {
        assert_eq!(table_rows(&fresh.0, &table), rows, "all columns of {table}, including nulls and soft deletions");
    }
    for (session, take) in &profile.sessions {
        assert_eq!(restored.get_session(session).unwrap(), profile.db.get_session(session).unwrap());
        assert!(restored.checked_recording(take).is_ok());
    }
}

#[test]
fn a38_session_exports_include_owned_rows_and_exclude_profile_content() {
    let profile = seed();
    let out = TestRoot::new();
    let mut covered = BTreeSet::new();
    for (session, take) in &profile.sessions {
        let target = out.0.join(format!("{take}.zip"));
        let summary = export::export_session(&profile.db, session, &target, 123).unwrap();
        assert_eq!(summary.recordings, 1);
        let mut zip = ZipArchive::new(File::open(target).unwrap()).unwrap();
        let mut bytes = Vec::new();
        zip.by_name("session.json").unwrap().read_to_end(&mut bytes).unwrap();
        let data: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(data["format"], "clearpractice-session-data");
        assert_eq!(data["session"], profile.db.get_session(session).unwrap());
        assert_eq!(data["takes"][0]["transcript"], profile.db.attempt_transcript_with_voice(take).unwrap());
        let tables = data["tables"].as_object().unwrap();
        assert_eq!(tables.keys().map(String::as_str).collect::<BTreeSet<_>>(), EXPORTED.iter().copied().collect());
        let conversation_ids: Vec<_> = table_rows(&profile.root.0, "conversations").into_iter().filter(|r| r["session_id"] == *session).map(|r| r["id"].clone()).collect();
        let packs: Vec<_> = table_rows(&profile.root.0, "listener_packs").into_iter().filter(|r| r["attempt_id"] == *take).map(|r| r["id"].clone()).collect();
        for table in EXPORTED {
            let expected: Vec<_> = table_rows(&profile.root.0, table).into_iter().filter(|r| match *table {
                "exercise_definitions" => r["type"] == data["session"]["exerciseType"],
                "segment_marks" => r["revision_id"] == format!("{take}--1"),
                "comparisons" => r["a_attempt"] == *take || r["b_attempt"] == *take,
                "conversations" => r["session_id"] == *session,
                "conversation_turns" | "conversation_feedback" => conversation_ids.contains(&r["conversation_id"]),
                "listener_feedback" => packs.contains(&r["pack_id"]),
                "practice_events" | "personal_records" => r["session_id"] == *session || r["attempt_id"] == *take,
                _ => r["attempt_id"] == *take,
            }).collect();
            if !expected.is_empty() { covered.insert(*table); }
            assert_eq!(tables[*table], json!(expected), "{session}: every field of {table}");
        }
        for excluded in new_tables().iter().filter(|table| !EXPORTED.contains(&table.as_str())) {
            assert!(!tables.contains_key(excluded), "{excluded} is backup-only");
        }
        if session == "a38-drill" {
            assert_eq!(data["session"]["prompt"], "Captured pack prompt");
            assert_eq!(data["session"]["activitySnapshot"]["params"]["topicId"], "pack-topic");
        }
        // The new structured entry participates in the same checksum manifest.
        let mut manifest = String::new();
        zip.by_name("manifest.json").unwrap().read_to_string(&mut manifest).unwrap();
        let manifest: Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(manifest["entries"].as_array().unwrap().len(), zip.len() - 1);
        for entry in manifest["entries"].as_array().unwrap() {
            let mut body = Vec::new();
            zip.by_name(entry["path"].as_str().unwrap()).unwrap().read_to_end(&mut body).unwrap();
            assert_eq!(entry["bytes"], body.len());
            assert_eq!(entry["sha256"], hex(Sha256::new_with_prefix(&body)));
        }
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).unwrap();
            if entry.name().ends_with(".wav") { continue; }
            let mut body = String::new();
            entry.read_to_string(&mut body).unwrap();
            for private in ["Private exposure", "Private routine", "Private club", "Private entire", "Private unrelated", "Private talk", "Private upcoming", "Private event", "Private reflection"] {
                assert!(!body.contains(private), "{} leaked {private}", entry.name());
            }
        }
    }
    assert_eq!(covered, EXPORTED.iter().copied().collect(), "each exported table has a nonempty assertion");
}
