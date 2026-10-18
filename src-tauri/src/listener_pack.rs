//! The listener pack (roadmap 14.4, D-35): a file you give a friend, colleague
//! or teacher. They open `listen.html` in any browser, listen, answer three
//! questions and save an answer file to send back. There is no server, upload
//! or account: the page loads nothing from anywhere (a strict content security
//! policy, everything inline) and answer files are checked strictly on import.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufWriter, Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

type Result<T> = std::result::Result<T, String>;

pub const PACK_FORMAT: &str = "clearpractice-listener-pack";
pub const ANSWERS_FORMAT: &str = "clearpractice-listener-answers";
pub const MAX_QUESTIONS: usize = 5;
pub const MAX_QUESTION_CHARS: usize = 160;
pub const MAX_ANSWER_CHARS: usize = 2000;
pub const MAX_NAME_CHARS: usize = 60;
/// An answer file is at most this big.
pub const MAX_ANSWER_FILE_BYTES: usize = 64 * 1024;
/// The page, with `{{PACK}}` where the pack's data goes.
const TEMPLATE: &str = include_str!("listener_pack/listen.html");

/// `pack.json`: what the pack holds, without the audio.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    pub format: &'static str,
    pub version: u32,
    pub pack_id: String,
    pub questions: Vec<String>,
    pub from: String,
    pub created_at: String,
}

/// A listener's answers, as checked.
#[derive(Clone, Debug, PartialEq)]
pub struct Answers {
    pub pack_id: String,
    pub name: String,
    pub answers: Vec<String>,
    pub answered_at: Option<String>,
}

/// Control characters removed (newlines kept where allowed), outer whitespace trimmed.
fn strip_controls(text: &str, keep_newlines: bool) -> String {
    text.chars().filter(|c| !c.is_control() || (keep_newlines && *c == '\n')).collect::<String>().trim().to_string()
}

/// One to five questions, each one line of 1 to 160 characters.
pub fn clean_questions(questions: &[String]) -> Result<Vec<String>> {
    let cleaned: Vec<String> = questions.iter().map(|q| strip_controls(q, false)).collect();
    if cleaned.is_empty() || cleaned.len() > MAX_QUESTIONS || cleaned.iter().any(|q| q.is_empty() || q.chars().count() > MAX_QUESTION_CHARS) {
        return Err("Ask one to five questions of up to 160 characters each.".into());
    }
    Ok(cleaned)
}

/// Your first name for the listener: optional, one line, at most 60 characters.
pub fn clean_name(name: &str) -> Result<String> {
    let name = strip_controls(name, false);
    if name.chars().count() > MAX_NAME_CHARS {
        return Err("Keep your name under 60 characters.".into());
    }
    Ok(name)
}

/// JSON safe to place inside a `<script>` element: `<`, `>` and `&` are escaped,
/// so no value can close the element or start markup.
fn script_json(value: &Value) -> String {
    value.to_string().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026")
}

/// The listener's page: the questions, your name, the length in minutes and,
/// only when you chose it, the transcript, as inert JSON the page reads.
pub fn listen_html(pack_id: &str, questions: &[String], from: &str, minutes: u32, transcript: Option<&str>) -> String {
    let data = json!({"packId": pack_id, "questions": questions, "from": from, "minutes": minutes, "transcript": transcript});
    TEMPLATE.replace("{{PACK}}", &script_json(&data))
}

/// `README.txt`: what to do with the pack, in plain words.
pub fn readme(from: &str) -> String {
    let who = if from.is_empty() { "the person who sent it" } else { from };
    format!(
        "A recording for you to listen to\r\n\r\n\
         1. Unzip this folder.\r\n\
         2. Open listen.html in your browser (Edge, Chrome, Firefox or Safari). It works without the internet.\r\n\
         3. Listen to the recording and answer the questions.\r\n\
         4. Press \"Save my answers\". Send the file answers.cpanswer.json back to {who}, by email or any way you like.\r\n\r\n\
         Nothing is sent anywhere by the page itself.\r\n"
    )
}

/// A file name for the pack, from the session's title.
pub fn suggested_file_name(session_title: &str) -> String {
    let title: String = session_title.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { ' ' } else { c }).collect();
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let title: String = title.chars().take(80).collect::<String>().trim_end_matches(['.', ' ']).to_string();
    format!("{} - for a listener.zip", if title.is_empty() { "Recording" } else { &title })
}

fn add<W: Write + std::io::Seek>(zip: &mut ZipWriter<W>, name: &str, bytes: &[u8], method: CompressionMethod) -> Result<()> {
    zip.start_file(name, SimpleFileOptions::default().compression_method(method)).map_err(|e| e.to_string())?;
    zip.write_all(bytes).map_err(|_| "The pack could not be written.".to_string())
}

/// Writes the pack next to `zip_path` as `.partial`, then renames it into place:
/// `listen.html`, `audio.wav`, `pack.json`, `README.txt` and, only when chosen,
/// `transcript.txt`.
pub fn write_pack(zip_path: &Path, manifest: &PackManifest, html: &str, wav: &Path, transcript: Option<&str>) -> Result<()> {
    let parent = zip_path.parent().filter(|p| p.is_dir()).ok_or("The folder for the pack is unavailable.")?;
    let name = zip_path.file_name().ok_or("Choose a file name for the pack.")?.to_string_lossy().into_owned();
    let partial = parent.join(format!("{name}.partial"));
    let result = (|| {
        let mut audio = Vec::new();
        File::open(wav).and_then(|mut f| f.read_to_end(&mut audio)).map_err(|_| "The take's audio could not be read.")?;
        let file = File::create(&partial).map_err(|_| "The pack could not be created in that folder.")?;
        let mut zip = ZipWriter::new(BufWriter::with_capacity(1 << 16, file));
        add(&mut zip, "listen.html", html.as_bytes(), CompressionMethod::Deflated)?;
        add(&mut zip, "audio.wav", &audio, CompressionMethod::Stored)?;
        add(&mut zip, "pack.json", &serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?, CompressionMethod::Deflated)?;
        if let Some(text) = transcript {
            add(&mut zip, "transcript.txt", text.as_bytes(), CompressionMethod::Deflated)?;
        }
        add(&mut zip, "README.txt", readme(&manifest.from).as_bytes(), CompressionMethod::Deflated)?;
        let file = zip.finish().map_err(|e| e.to_string())?.into_inner().map_err(|_| "The pack could not be written.")?;
        file.sync_all().map_err(|_| "The pack could not be written.")?;
        drop(file);
        if zip_path.exists() {
            fs::remove_file(zip_path).map_err(|_| "The old file could not be replaced.")?;
        }
        fs::rename(&partial, zip_path).map_err(|_| "The pack could not be saved.".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

/// Checks an answer file strictly (14.4): the format and version, a pack ID,
/// one to five answers of at most 2,000 characters (control characters
/// removed), a name of at most 60 characters, and nothing else.
pub fn parse_answers(bytes: &[u8]) -> Result<Answers> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Raw {
        format: String,
        version: u32,
        pack_id: String,
        #[serde(default)]
        name: String,
        answers: Vec<String>,
        #[serde(default)]
        answered_at: Option<String>,
    }
    if bytes.len() > MAX_ANSWER_FILE_BYTES {
        return Err("This file is too big to be a listener's answers.".into());
    }
    let raw: Raw = serde_json::from_slice(bytes).map_err(|_| "This isn't a listener's answer file (answers.cpanswer.json).")?;
    if raw.format != ANSWERS_FORMAT || raw.version != 1 {
        return Err("This answer file is from a different kind or version of pack.".into());
    }
    let id_ok = !raw.pack_id.is_empty() && raw.pack_id.len() <= 96 && raw.pack_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let answers: Vec<String> = raw.answers.iter().map(|a| strip_controls(a, true)).collect();
    let name = strip_controls(&raw.name, false);
    let answered_at = raw.answered_at.map(|a| strip_controls(&a, false)).filter(|a| !a.is_empty());
    if !id_ok
        || answers.is_empty()
        || answers.len() > MAX_QUESTIONS
        || answers.iter().any(|a| a.chars().count() > MAX_ANSWER_CHARS)
        || name.chars().count() > MAX_NAME_CHARS
        || answered_at.as_deref().is_some_and(|a| a.chars().count() > 40)
    {
        return Err("This answer file doesn't look right, so nothing was imported.".into());
    }
    Ok(Answers { pack_id: raw.pack_id, name, answers, answered_at })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_of(html: &str) -> Value {
        let start = html.find(r#"<script id="pack" type="application/json">"#).unwrap() + r#"<script id="pack" type="application/json">"#.len();
        let end = start + html[start..].find("</script>").unwrap();
        serde_json::from_str(&html[start..end]).unwrap()
    }

    #[test]
    fn listen_html_escapes_questions_and_names() {
        let questions = vec!["What was my main point? </script><script>alert(1)</script>".to_string(), "Did \"this\" & 'that' help? 🙂".to_string()];
        let html = listen_html("pack-1", &questions, "Alex <b>", 2, Some("We shipped </script> on time."));
        assert_eq!(html.matches("</script>").count(), 2, "only the page's own script elements close");
        assert!(!html.contains("<b>") && !html.contains("alert(1)</script>"));
        let data = data_of(&html);
        assert_eq!(data["questions"][0], questions[0], "the values read back exactly");
        assert_eq!(data["questions"][1], questions[1]);
        assert_eq!((data["from"].as_str(), data["minutes"].as_u64(), data["packId"].as_str()), (Some("Alex <b>"), Some(2), Some("pack-1")));
        assert_eq!(data["transcript"], "We shipped </script> on time.");
        assert!(data_of(&listen_html("pack-1", &questions, "", 1, None))["transcript"].is_null(), "no transcript unless chosen");
    }

    #[test]
    fn listen_html_has_a_strict_csp_and_no_external_urls() {
        let html = listen_html("pack-1", &["What was my main point?".into()], "Alex", 1, None);
        let csp = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self' file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">"#;
        assert_eq!(html.matches(csp).count(), 1);
        let rest = html.replace(csp, "");
        assert!(!rest.to_lowercase().contains("http"), "no web addresses");
        assert!(!rest.contains("//"), "no protocol-relative addresses or comments that could hide one");
        for word in ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "import(", "<link", "<iframe", "src=\"data:"] {
            assert!(!rest.contains(word), "{word}");
        }
        assert!(rest.contains(r#"src="audio.wav""#) && rest.contains("answers.cpanswer.json") && rest.contains(ANSWERS_FORMAT));
    }

    #[test]
    fn pack_contains_exactly_the_expected_files() {
        let dir = crate::storage::recording::tests::TestRoot::new();
        let wav = dir.0.join("audio.wav");
        fs::write(&wav, crate::storage::recording::wav_header(16_000, 4)).unwrap();
        let manifest = PackManifest { format: PACK_FORMAT, version: 1, pack_id: "pack-1".into(), questions: vec!["Q?".into()], from: "Alex".into(), created_at: "2026-10-18T10:00:00.000Z".into() };
        let names = |path: &Path| {
            let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
            let mut out: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
            out.sort();
            out
        };
        let plain = dir.0.join("Talk - for a listener.zip");
        write_pack(&plain, &manifest, &listen_html("pack-1", &manifest.questions, "Alex", 1, None), &wav, None).unwrap();
        assert_eq!(names(&plain), ["README.txt", "audio.wav", "listen.html", "pack.json"]);
        let with = dir.0.join("With transcript.zip");
        write_pack(&with, &manifest, "<html></html>", &wav, Some("Hello.")).unwrap();
        assert_eq!(names(&with), ["README.txt", "audio.wav", "listen.html", "pack.json", "transcript.txt"]);
        let mut archive = zip::ZipArchive::new(File::open(&plain).unwrap()).unwrap();
        let mut json = String::new();
        archive.by_name("pack.json").unwrap().read_to_string(&mut json).unwrap();
        let pack: Value = serde_json::from_str(&json).unwrap();
        assert_eq!((pack["format"].as_str(), pack["version"].as_u64(), pack["packId"].as_str()), (Some(PACK_FORMAT), Some(1), Some("pack-1")));
        assert!(!dir.0.join("Talk - for a listener.zip.partial").exists());
        assert!(write_pack(&dir.0.join("missing-folder").join("x.zip"), &manifest, "", &wav, None).is_err());
        assert_eq!(suggested_file_name("Interview: answer 2 / take?"), "Interview answer 2 take - for a listener.zip");
        assert_eq!(suggested_file_name("  "), "Recording - for a listener.zip");
    }

    #[test]
    fn answer_files_are_parsed_strictly() {
        let file = |v: Value| serde_json::to_vec(&v).unwrap();
        let good = json!({"format": ANSWERS_FORMAT, "version": 1, "packId": "pack-1", "name": " Sam\u{0007} ", "answers": ["You want to delay the release.\nFor the tests.", "", "The example"], "answeredAt": "2026-10-18T10:00:00.000Z"});
        let parsed = parse_answers(&file(good.clone())).unwrap();
        assert_eq!((parsed.pack_id.as_str(), parsed.name.as_str(), parsed.answers.len()), ("pack-1", "Sam", 3));
        assert_eq!(parsed.answers[0], "You want to delay the release.\nFor the tests.", "newlines stay, control characters go");
        let with = |key: &str, value: Value| {
            let mut v = good.clone();
            v[key] = value;
            file(v)
        };
        assert!(parse_answers(&with("format", json!(PACK_FORMAT))).is_err());
        assert!(parse_answers(&with("version", json!(2))).is_err());
        assert!(parse_answers(&with("packId", json!("../pack"))).is_err());
        assert!(parse_answers(&with("answers", json!([]))).is_err());
        assert!(parse_answers(&with("answers", json!(["a", "b", "c", "d", "e", "f"]))).is_err());
        assert!(parse_answers(&with("answers", json!(["x".repeat(2001)]))).is_err());
        assert!(parse_answers(&with("name", json!("x".repeat(61)))).is_err());
        assert!(parse_answers(&with("extra", json!("unknown field"))).is_err(), "unknown fields are refused");
        assert!(parse_answers(b"not json").is_err());
        assert!(parse_answers(&vec![b' '; MAX_ANSWER_FILE_BYTES + 1]).is_err());
        assert_eq!(clean_questions(&["  What was my main point?  ".into()]).unwrap(), ["What was my main point?"]);
        assert!(clean_questions(&[]).is_err() && clean_questions(&vec!["Q".into(); 6]).is_err() && clean_questions(&["x".repeat(161)]).is_err());
        assert!(clean_name(&"x".repeat(61)).is_err());
    }
}
