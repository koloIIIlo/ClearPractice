//! Local LLM adapter (plan 5.4): a llama.cpp-compatible server that you run on
//! this computer. Only loopback addresses count as "on this computer"; a LAN
//! or remote server is refused (it belongs to API mode). No key, no proxy, no
//! redirects, no retries, bounded responses. Nothing is billed.
use reqwest::{Client, Url};
use serde_json::{json, Value};
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;
const MAX_RESPONSE: usize = 1024 * 1024;

/// A validated local server and the model name to ask for (may be empty).
#[derive(Clone, Debug, PartialEq)]
pub struct LocalTarget {
    pub base: String,
    pub model: String,
}

/// Accepts `http(s)://127.0.0.1:PORT`, `localhost` or `[::1]`, with an optional
/// trailing `/` or `/v1`; returns the base without a path.
pub fn validate_endpoint(endpoint: &str) -> Result<String> {
    let url = Url::parse(endpoint.trim()).map_err(|_| "Write the server address like http://127.0.0.1:8080.")?;
    let host = url.host_str().unwrap_or("").to_string();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.trim_start_matches('[').trim_end_matches(']').parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if !loopback {
        return Err("Only a server on this computer (127.0.0.1, localhost or [::1]) can be used as a local model. A server elsewhere belongs to API mode.".into());
    }
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || !matches!(url.path(), "" | "/" | "/v1" | "/v1/")
    {
        return Err("Write the server address like http://127.0.0.1:8080, without a path or password.".into());
    }
    let port = url.port_or_known_default().ok_or("The address needs a port.")?;
    Ok(format!("{}://{host}:{port}", url.scheme()))
}

fn client(timeout: Duration) -> Result<Client> {
    crate::net_guard::client_built();
    Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .referer(false)
        .user_agent("ClearPractice/0.1.0")
        .build()
        .map_err(|_| "Cannot prepare the local connection.".into())
}

async fn bounded(mut response: reqwest::Response) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The local model stopped answering midway.")? {
        if chunk.len() > MAX_RESPONSE.saturating_sub(body.len()) {
            return Err("The local model's answer was too long.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// The OpenAI-compatible chat request sent to the local server.
pub fn chat_body(model: &str, instructions: &str, input: &str, name: &str, schema: Value, max_tokens: u64) -> Value {
    json!({"model": if model.is_empty() { "local" } else { model }, "stream": false, "temperature": 0.3, "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": input}],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": true, "schema": schema}}})
}

/// Sends one chat request; returns the raw response and the answer text.
pub async fn chat(target: &LocalTarget, body: &Value) -> Result<(Value, String)> {
    let base = validate_endpoint(&target.base)?;
    let response = client(Duration::from_secs(300))?
        .post(format!("{base}/v1/chat/completions"))
        .json(body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "The local model took longer than 5 minutes. Try a smaller model." } else { "The local model server is not reachable. Start it and try again." })?;
    let status = response.status();
    if status.is_redirection() {
        return Err("The local server tried to redirect the request; it was not followed.".into());
    }
    if !status.is_success() {
        return Err(format!("The local model server answered with an error (HTTP {}).", status.as_u16()));
    }
    let raw: Value = serde_json::from_slice(&bounded(response).await?).map_err(|_| "The local model server did not answer in the expected format.")?;
    let choice = &raw["choices"][0];
    if choice["finish_reason"] == "length" {
        return Err("The local model ran out of room before finishing. Try again or use a larger context.".into());
    }
    let text = choice["message"]["content"].as_str().filter(|t| !t.trim().is_empty()).ok_or("The local model returned no answer.")?.to_string();
    Ok((raw, text))
}

/// Test connection: the models the server offers (5.10).
pub async fn models(endpoint: &str) -> Result<Vec<String>> {
    let base = validate_endpoint(endpoint)?;
    let response = client(Duration::from_secs(10))?
        .get(format!("{base}/v1/models"))
        .send()
        .await
        .map_err(|_| "Nothing answered at that address. Start the server and try again.")?;
    if !response.status().is_success() {
        return Err(format!("The server answered with an error (HTTP {}).", response.status().as_u16()));
    }
    let raw: Value = serde_json::from_slice(&bounded(response).await?).map_err(|_| "This does not look like a llama.cpp-compatible server.")?;
    Ok(raw["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).take(50).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn serve(reply: &'static str) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                stream.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
                let mut buf = [0u8; 65536];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        (base, hits)
    }

    fn ok(body: &str) -> &'static str {
        Box::leak(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).into_boxed_str())
    }

    #[test]
    fn only_loopback_servers_count_as_local() {
        assert_eq!(validate_endpoint("http://127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(validate_endpoint(" http://localhost:8080/v1 ").unwrap(), "http://localhost:8080");
        assert_eq!(validate_endpoint("http://[::1]:9000/").unwrap(), "http://[::1]:9000");
        for refused in ["http://192.168.1.5:8080", "http://example.com:8080", "http://127.0.0.1.example.com", "ftp://127.0.0.1:21", "http://user:pw@127.0.0.1:8080", "http://127.0.0.1:8080/api?x=1", "not a url"] {
            assert!(validate_endpoint(refused).is_err(), "{refused}");
        }
    }

    /// The same contract as the hosted adapter: a valid answer comes back
    /// once; every failure gives a plain message and is never retried.
    #[test]
    fn the_local_adapter_returns_answers_and_fails_safely_without_retrying() {
        let body = chat_body("", "Be brief.", "Hello", "t", json!({"type": "object"}), 64);
        assert_eq!(body["model"], "local");
        assert_eq!(body["response_format"]["json_schema"]["strict"], true);
        let target = |base: String| LocalTarget { base, model: String::new() };

        let (base, hits) = serve(ok(r#"{"choices":[{"finish_reason":"stop","message":{"content":"{\"summary\":\"s\"}"}}],"usage":{"prompt_tokens":5}}"#));
        let (raw, text) = tauri::async_runtime::block_on(chat(&target(base), &body)).unwrap();
        assert_eq!(text, r#"{"summary":"s"}"#);
        assert_eq!(raw["usage"]["prompt_tokens"], 5);
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);

        let cases = [
            ("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", "HTTP 500"),
            ("HTTP/1.1 302 Found\r\nLocation: https://elsewhere.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", "redirect"),
            (ok("not json"), "expected format"),
            (ok(r#"{"choices":[]}"#), "no answer"),
            (ok(r#"{"choices":[{"finish_reason":"length","message":{"content":"{\"summ"}}]}"#), "ran out of room"),
            ("", "not reachable"), // closed without an answer
        ];
        for (reply, expected) in cases {
            let (base, hits) = serve(reply);
            let error = tauri::async_runtime::block_on(chat(&target(base), &body)).unwrap_err();
            assert!(error.contains(expected), "{expected}: {error}");
            assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1, "{expected}: never retried");
        }
        let closed = { let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); format!("http://{}", l.local_addr().unwrap()) };
        assert!(tauri::async_runtime::block_on(chat(&target(closed), &body)).unwrap_err().contains("not reachable"));
        assert!(tauri::async_runtime::block_on(chat(&target("http://10.0.0.2:8080".into()), &body)).unwrap_err().contains("Only a server on this computer"));
    }

    #[test]
    fn test_connection_lists_the_server_models() {
        let (base, _) = serve(ok(r#"{"data":[{"id":"qwen3-8b"},{"id":"llama-4"}]}"#));
        assert_eq!(tauri::async_runtime::block_on(models(&base)).unwrap(), ["qwen3-8b", "llama-4"]);
    }
}
