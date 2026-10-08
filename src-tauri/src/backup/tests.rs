use super::*;
use crate::storage::recording::{
    self,
    finalize, hash_file,
    tests::{manifest as capture_manifest, TestRoot},
    ChunkWriter,
};

fn record(root: &Path, id: &str) {
    let mut writer = ChunkWriter::create(root, &capture_manifest(id)).unwrap();
    for n in 0..48_000 {
        writer.push((n % 2000) as i16).unwrap();
    }
    writer.flush().unwrap();
    drop(writer);
    finalize(root, id, false).unwrap();
}

fn profile_with_two_takes() -> (TestRoot, DatabaseOwner) {
    let root = TestRoot::new();
    record(&root.0, "take-a");
    record(&root.0, "take-b");
    let owner = DatabaseOwner::open(&root.0).unwrap();
    owner.update_session("take-a", "Explaining indexes", "My note", &[], true).unwrap();
    owner.move_to_trash("take-b", recording::now_ms()).unwrap();
    (root, owner)
}

/// Rebuilds an archive entry by entry, letting a test tamper with it.
fn rewrite(
    source: &Path,
    target: &Path,
    entry: impl Fn(&str, Vec<u8>) -> Option<Vec<u8>>,
    edit_manifest: impl Fn(&mut Manifest),
) {
    let mut input = ZipArchive::new(BufReader::new(File::open(source).unwrap())).unwrap();
    let mut output = ZipWriter::new(File::create(target).unwrap());
    for index in 0..input.len() {
        let mut file = input.by_index(index).unwrap();
        let name = file.name().to_string();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        if name == MANIFEST {
            let mut manifest: Manifest = serde_json::from_slice(&bytes).unwrap();
            edit_manifest(&mut manifest);
            bytes = serde_json::to_vec(&manifest).unwrap();
        } else if let Some(changed) = entry(&name, bytes) {
            bytes = changed;
        } else {
            continue;
        }
        output.start_file(name, SimpleFileOptions::default()).unwrap();
        output.write_all(&bytes).unwrap();
    }
    output.finish().unwrap();
}

fn staging_is_empty(root: &Path) -> bool {
    fs::read_dir(root.join("cache/restore")).map_or(true, |mut d| d.next().is_none())
}

#[test]
fn backup_round_trips_sessions_trash_and_verified_audio() {
    let (root, owner) = profile_with_two_takes();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let summary = create(&owner, &folder, recording::now_ms()).unwrap();
    assert_eq!(summary.recordings, 2);
    let archive = folder.join(&summary.file_name);
    assert!(archive.is_file());
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 1, "no .partial file remains");
    assert!(!root.0.join("cache/backup").join(&summary.id).exists());
    assert_eq!(owner.backups().unwrap()[0]["status"], "verified");

    let preview = inspect(&root.0, &archive, "stage-ok").unwrap();
    assert_eq!((preview.sessions, preview.trashed_sessions, preview.recordings), (1, 1, 2));
    assert_eq!(preview.schema_version, SCHEMA_VERSION);
    let staged = root.0.join("cache/restore/stage-ok");
    for id in ["take-a", "take-b"] {
        assert_eq!(
            hash_file(&staged.join(format!("recordings/{id}/audio.wav"))).unwrap(),
            hash_file(&root.0.join(format!("recordings/{id}/audio.wav"))).unwrap()
        );
    }
    let restored = Connection::open(staged.join(DATABASE)).unwrap();
    let title: String = restored
        .query_row("SELECT title FROM sessions WHERE id='take-a'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Explaining indexes");
}

#[test]
fn changed_audio_fails_the_backup_and_keeps_earlier_ones() {
    let (root, owner) = profile_with_two_takes();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let first = create(&owner, &folder, recording::now_ms()).unwrap();

    let audio = root.0.join("recordings/take-a/audio.wav");
    let mut bytes = fs::read(&audio).unwrap();
    bytes[100] ^= 1;
    fs::write(&audio, bytes).unwrap();
    let error = create(&owner, &folder, recording::now_ms() + 2_000).unwrap_err();
    assert!(error.contains("take-a"), "{error}");

    let files: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(files, vec![first.file_name.clone()]);
    assert_eq!(owner.backups().unwrap()[0]["status"], "failed");

    assert!(create(&owner, &root.0.join("missing-drive"), recording::now_ms()).is_err());
}

#[test]
fn restore_rejects_traversal_newer_schema_bad_checksums_missing_audio_and_non_zips() {
    let (root, owner) = profile_with_two_takes();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let good = folder.join(create(&owner, &folder, recording::now_ms()).unwrap().file_name);
    let bad = folder.join("bad.zip");
    let expect = |stage: &str, needle: &str| {
        let error = inspect(&root.0, &bad, stage).unwrap_err();
        assert!(error.contains(needle), "{stage}: {error}");
        assert!(staging_is_empty(&root.0), "{stage} left staging behind");
    };

    // Path traversal entry alongside an otherwise valid backup.
    rewrite(&good, &bad, |_, b| Some(b), |_| {});
    {
        let mut zip = ZipWriter::new_append(fs::OpenOptions::new().read(true).write(true).open(&bad).unwrap()).unwrap();
        zip.start_file("../outside.txt", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
    }
    expect("traversal", "unexpected entry");
    assert!(!root.0.join("cache/outside.txt").exists());

    rewrite(&good, &bad, |_, b| Some(b), |m| m.schema_version = SCHEMA_VERSION + 1);
    expect("newer", "newer ClearPractice");

    rewrite(
        &good,
        &bad,
        |name, mut b| {
            if name.ends_with("take-a/audio.wav") {
                b[200] ^= 1;
            }
            Some(b)
        },
        |_| {},
    );
    expect("checksum", "failed its checksum");

    rewrite(
        &good,
        &bad,
        |name, b| (!name.starts_with("recordings/take-b/")).then_some(b),
        |m| m.entries.retain(|e| !e.path.starts_with("recordings/take-b/")),
    );
    expect("missing", "take-b");

    // A highly compressible entry whose manifest agrees with it is still refused.
    let zeros = vec![0u8; 4 * 1024 * 1024];
    let zeros_sha = hex(Sha256::new_with_prefix(&zeros));
    rewrite(
        &good,
        &bad,
        |name, b| Some(if name.ends_with("take-a/audio.wav") { zeros.clone() } else { b }),
        |m| {
            let entry = m.entries.iter_mut().find(|e| e.path.ends_with("take-a/audio.wav")).unwrap();
            entry.bytes = zeros.len() as u64;
            entry.sha256 = zeros_sha.clone();
        },
    );
    expect("bomb", "implausible size");

    fs::write(&bad, b"not a zip at all").unwrap();
    expect("garbage", "not a readable");
}

fn asset_hashes(root: &Path) -> BTreeMap<String, String> {
    ["take-a", "take-b"]
        .iter()
        .map(|id| (id.to_string(), hash_file(&root.join(format!("recordings/{id}/audio.wav"))).unwrap()))
        .collect()
}

#[test]
fn restore_into_an_empty_profile_matches_records_and_asset_checksums() {
    let (source, owner) = profile_with_two_takes();
    // An imported reference clip (4.4a) travels with the backup.
    let take = source.0.join("recordings/take-a/audio.wav");
    let staged = crate::clips::stage(&source.0, &take).unwrap();
    let details = crate::clips::ClipDetails { title: "My clip", source: "My own recording", transcript: None, description: None, feature: None };
    let clip = crate::clips::commit(&source.0, &staged.staging_id, 0, 900, &details, "user", false).err();
    assert!(clip.is_some(), "a 1 s take is too short for a 3 s clip");
    let long = source.0.join("long.wav");
    let one_second = fs::read(&take).unwrap();
    let mut data = one_second[44..].to_vec();
    for _ in 0..4 { data.extend_from_slice(&one_second[44..]); }
    let mut wav = recording::wav_header(48_000, data.len() as u32).to_vec();
    wav.extend_from_slice(&data);
    fs::write(&long, wav).unwrap();
    let staged = crate::clips::stage(&source.0, &long).unwrap();
    let clip = crate::clips::commit(&source.0, &staged.staging_id, 0, 4_000, &details, "user", false).unwrap();
    owner.insert_clip(&clip).unwrap();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let archive = folder.join(create(&owner, &folder, recording::now_ms()).unwrap().file_name);
    let clips = owner.list_clips().unwrap();
    assert_eq!(clips.len(), 1);
    // An archive that lost the clip's audio is refused before anything changes.
    let broken = folder.join("no-clip.zip");
    rewrite(&archive, &broken, |name, bytes| (!name.starts_with("clips/")).then_some(bytes), |m| m.entries.retain(|e| !e.path.starts_with("clips/")));
    assert!(inspect(&source.0, &broken, "stage-broken").unwrap_err().contains("clip"));
    fs::remove_file(&broken).unwrap();
    let sessions = owner.list_sessions(None, None, false).unwrap();
    let trash = owner.list_trash().unwrap()["items"].clone();

    let empty = TestRoot::new();
    let target = DatabaseOwner::open(&empty.0).unwrap();
    assert!(target.list_sessions(None, None, false).unwrap().is_empty());
    inspect(&empty.0, &archive, "stage-restore").unwrap();
    drop(target);

    let outcome = replace_profile(&empty.0, "stage-restore", recording::now_ms()).unwrap();
    let restored = DatabaseOwner::open(&empty.0).unwrap();
    finish_restore(&empty.0).unwrap();
    assert!(!empty.0.join(JOURNAL).exists());
    assert!(empty.0.join(&outcome.rollback_folder).join("database/app.sqlite").is_file());

    assert_eq!(restored.list_sessions(None, None, false).unwrap(), sessions);
    assert_eq!(restored.list_trash().unwrap()["items"], trash);
    assert_eq!(restored.list_clips().unwrap(), clips, "imported clips are restored");
    assert_eq!(hash_file(&restored.clip_playback_path(&clips[0].id).unwrap()).unwrap(), clips[0].sha256);
    assert_eq!(asset_hashes(&empty.0), asset_hashes(&source.0));
    for id in ["take-a", "take-b"] {
        assert!(restored.checked_recording(id).is_ok());
    }
    // A restored profile can be backed up again.
    assert!(create(&restored, &folder, recording::now_ms() + 2_000).is_ok());
}

#[test]
fn interrupted_or_failed_restore_puts_the_previous_profile_back() {
    let (source, owner) = profile_with_two_takes();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let archive = folder.join(create(&owner, &folder, recording::now_ms()).unwrap().file_name);

    // The live profile diverges from the backup after it was made.
    owner.update_session("take-a", "Changed after backup", "", &[], false).unwrap();
    inspect(&source.0, &archive, "stage-crash").unwrap();
    drop(owner);
    let before = asset_hashes(&source.0);

    // Simulate a crash after the swap but before the restored database opened.
    replace_profile(&source.0, "stage-crash", recording::now_ms()).unwrap();
    assert!(source.0.join(JOURNAL).exists());
    roll_back(&source.0).unwrap();
    assert!(!source.0.join(JOURNAL).exists());
    let reopened = DatabaseOwner::open(&source.0).unwrap();
    assert_eq!(reopened.get_session("take-a").unwrap()["title"], "Changed after backup");
    assert_eq!(asset_hashes(&source.0), before);
    drop(reopened);

    // Without a valid staging folder nothing moves at all.
    assert!(replace_profile(&source.0, "never-staged", recording::now_ms()).is_err());
    assert!(!source.0.join(JOURNAL).exists());
    assert_eq!(
        DatabaseOwner::open(&source.0).unwrap().get_session("take-a").unwrap()["title"],
        "Changed after backup"
    );
    assert!(roll_back(&source.0).is_ok(), "no journal is a no-op");
}

#[test]
fn weekly_backup_catches_up_skips_when_not_due_and_keeps_only_the_newest() {
    let (_root, owner) = profile_with_two_takes();
    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    let day = 24 * 60 * 60 * 1000;
    let start = recording::now_ms();

    // No folder chosen yet: nothing is due.
    assert!(next_due_ms(&owner).unwrap().is_none());
    owner.set_setting(DESTINATION_KEY, &folder.to_string_lossy()).unwrap();
    owner.set_setting(KEEP_KEY, "2").unwrap();
    fs::write(folder.join("holiday-photos.zip"), b"not ours").unwrap();

    // Never backed up: runs at once (the launch catch-up), then waits a week.
    assert!(run_if_due(&owner, start).unwrap().is_some());
    assert!(run_if_due(&owner, start + day).unwrap().is_none());
    assert_eq!(next_due_ms(&owner).unwrap(), Some(start + 7 * day));
    assert!(run_if_due(&owner, start + 7 * day).unwrap().is_some());
    let third = run_if_due(&owner, start + 14 * day).unwrap().unwrap();

    let mut names: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names.len(), 3, "two newest backups plus the unrelated file: {names:?}");
    assert!(names.contains(&"holiday-photos.zip".to_string()));
    assert!(names.contains(&third.file_name));

    // Turned off, or the drive is missing: nothing runs and nothing is deleted.
    owner.set_setting(AUTO_KEY, "off").unwrap();
    assert!(run_if_due(&owner, start + 30 * day).unwrap().is_none());
    owner.set_setting(AUTO_KEY, "on").unwrap();
    owner.set_setting(DESTINATION_KEY, &folder.join("unplugged").to_string_lossy()).unwrap();
    assert!(run_if_due(&owner, start + 30 * day).unwrap().is_none());
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 3);
    assert!(!is_backup_name("ClearPractice-backup-../x.zip"));
}

#[test]
fn session_export_is_readable_and_explains_unavailable_audio() {
    let root = TestRoot::new();
    record(&root.0, "take-a");
    record(&root.0, "take-b");
    let owner = DatabaseOwner::open(&root.0).unwrap();
    owner.update_session("take-a", "Indexes, \"fast\" reads", "Said it twice.", &["db".into()], false).unwrap();
    drop(owner);
    // A missing file is reported, never silently left out.
    fs::remove_file(root.0.join("recordings/take-b/audio.wav")).unwrap();
    let owner = DatabaseOwner::open(&root.0).unwrap();

    let out = TestRoot::new();
    let target = out.0.join(export::suggested_name("Indexes, \"fast\" reads", "2026-10-08"));
    assert_eq!(target.file_name().unwrap(), "Indexes fast reads 2026-10-08.zip");
    let summary = export::export_session(&owner, "take-a", &target, 0).unwrap();
    assert_eq!((summary.recordings, summary.unavailable_recordings), (1, 0));

    let mut zip = ZipArchive::new(File::open(&target).unwrap()).unwrap();
    let read = |zip: &mut ZipArchive<File>, name: &str| {
        let mut s = String::new();
        zip.by_name(name).unwrap().read_to_string(&mut s).unwrap();
        s
    };
    let md = read(&mut zip, "session.md");
    assert!(md.contains("# Indexes, \"fast\" reads") && md.contains("Said it twice.") && md.contains("take-1.wav"));
    let csv = read(&mut zip, "measures.csv");
    assert!(csv.starts_with("take,created_at,duration_ms,duration_source"));
    assert!(csv.contains(",1000,Measured,true,"));
    let mut wav = Vec::new();
    zip.by_name("take-1.wav").unwrap().read_to_end(&mut wav).unwrap();
    assert_eq!(hex(Sha256::new_with_prefix(&wav)), hash_file(&root.0.join("recordings/take-a/audio.wav")).unwrap());
    assert!(read(&mut zip, "manifest.json").contains("clearpractice-session-export"));
    assert!(!out.0.join(format!("{}.partial", summary.file_name)).exists());

    let missing = export::export_session(&owner, "take-b", &out.0.join("b.zip"), 0).unwrap();
    assert_eq!((missing.recordings, missing.unavailable_recordings), (0, 1));
    let mut zip = ZipArchive::new(File::open(out.0.join("b.zip")).unwrap()).unwrap();
    assert!(read(&mut zip, "session.md").contains("Unavailable:"));
    assert!(zip.by_name("take-1.wav").is_err());
}

/// Plan 2.6: a junction planted inside app storage must never make backup read,
/// or permanent delete remove, anything outside the app data folder.
#[cfg(windows)]
#[test]
fn junctions_in_storage_are_refused_by_backup_and_permanent_delete() {
    let (root, owner) = profile_with_two_takes();
    let outside = TestRoot::new();
    let victim = outside.0.join("victim");
    fs::create_dir(&victim).unwrap();
    fs::write(victim.join("keep.txt"), b"must survive").unwrap();

    // Replace take-a's recording folder with a junction to the outside folder.
    let take = root.0.join("recordings").join("take-a");
    fs::rename(&take, root.0.join("take-a-moved")).unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&take)
        .arg(&victim)
        .output()
        .unwrap();
    assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));

    let destination = TestRoot::new();
    let folder = destination.0.join("backups");
    fs::create_dir(&folder).unwrap();
    assert!(create(&owner, &folder, recording::now_ms()).is_err(), "backup must not follow the junction");
    assert_eq!(fs::read_dir(&folder).unwrap().count(), 0, "no partial file kept");

    // Trash then permanent delete: the junction target must survive.
    owner.move_to_trash("take-a", recording::now_ms()).unwrap();
    let pending = owner.delete_permanently(&["take-a".into()]).unwrap();
    assert!(pending, "removal through a junction is refused and left pending");
    assert_eq!(fs::read(victim.join("keep.txt")).unwrap(), b"must survive");
    let _ = fs::remove_dir(&take); // remove the junction itself, not its target
}
