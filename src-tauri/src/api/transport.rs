//! Native HTTPS foundation. No IPC command exposes transport. The future
//! preview controller must reserve the exact approved payload before sending.
use super::budget::BudgetOwner;
use crate::credentials::Secret;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Client, Request, Response,
};
use sha2::{Digest, Sha256};
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;
const MAX_REQUEST: usize = 256 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;

pub struct ApiTransport {
    client: Client,
}
/// Raw provider data stays native and is validated by the adapter before IPC.
pub struct ApiResponse {
    pub status: u16,
    pub request_id: Option<String>,
    pub bytes: Vec<u8>,
}

impl ApiTransport {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .referer(false)
            .user_agent("ClearPractice/0.1.0")
            .build()
            .map_err(|_| "Cannot initialize the secure API connection.")?;
        Ok(Self { client })
    }

    fn json_request(&self, key: &Secret, body: Vec<u8>) -> Result<Request> {
        if body.len() > MAX_REQUEST {
            return Err("The approved text request is too large. Reduce the selected text.".into());
        }
        let mut authorization = Vec::with_capacity(key.as_bytes().len() + 7);
        authorization.extend_from_slice(b"Bearer ");
        authorization.extend_from_slice(key.as_bytes());
        let header = HeaderValue::from_bytes(&authorization);
        for byte in &mut authorization {
            unsafe {
                std::ptr::write_volatile(byte, 0);
            }
        }
        let mut header =
            header.map_err(|_| "The stored API key is invalid. Replace it in Settings.")?;
        header.set_sensitive(true);
        self.client
            .post("https://api.openai.com/v1/responses")
            .header(AUTHORIZATION, header)
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .build()
            .map_err(|_| "Cannot prepare the approved API request.".into())
    }

    /// This low-level function is not UI approval. Only a native controller
    /// owning a user-approved preview may call it; matching a budget hash alone
    /// must never be exposed as frontend permission to send arbitrary text.
    pub async fn send_reserved_coaching(
        &self,
        owner: &BudgetOwner,
        id: &str,
        approved_sha256: &str,
        key: &Secret,
        payload: &serde_json::Value,
    ) -> Result<ApiResponse> {
        let body =
            serde_json::to_vec(payload).map_err(|_| "Cannot encode the approved text request.")?;
        if format!("{:x}", Sha256::digest(&body)) != approved_sha256 {
            return Err("The request changed after approval. Preview it again.".into());
        }
        let request = self.json_request(key, body)?;
        // No outbound I/O until the reservation's dispatch state is durable.
        owner.mark_dispatched(id, approved_sha256)?;
        let response = match self.client.execute(request).await {
            Ok(response) => response,
            Err(_) => {
                owner.settle(id, None, None, None)?;
                return Err("The API request did not finish. Its charge is uncertain; no automatic retry will occur.".into());
            }
        };
        let request_id = request_id(&response);
        let status = response.status().as_u16();
        if !(200..=299).contains(&status) {
            owner.settle(id, None, None, request_id)?;
            return Err(match status {
                401 | 403 => "The provider rejected the credentials or model access. Check Settings.",
                429 => "The provider rate or account limit was reached. Retry only after a new preview.",
                300..=399 => "The provider attempted a redirect. The request was stopped.",
                _ => "The provider could not complete the request. Check Settings and retry deliberately.",
            }.into());
        }
        match bounded_response(response).await {
            Ok(bytes) => Ok(ApiResponse {
                status,
                request_id,
                bytes,
            }),
            Err(error) => {
                owner.settle(id, None, None, request_id)?;
                Err(error)
            }
        }
    }
}

/// Responses for audio transcription carry word lists; still bounded.
const MAX_AUDIO_RESPONSE: usize = 8 * 1024 * 1024;
/// Prepared 16 kHz mono audio for up to 15 minutes fits well inside this.
pub const MAX_AUDIO_UPLOAD: usize = 32 * 1024 * 1024;

impl ApiTransport {
    /// Builds one request to a fixed, adapter-chosen HTTPS endpoint. `scheme`
    /// prefixes the key ("Token " for Deepgram, "" for AssemblyAI).
    pub fn audio_request(
        &self,
        method: reqwest::Method,
        url: &str,
        scheme: &str,
        key: &Secret,
        content_type: &str,
        body: Option<Vec<u8>>,
    ) -> Result<Request> {
        if !url.starts_with("https://api.deepgram.com/") && !url.starts_with("https://api.assemblyai.com/") {
            return Err("This transcription endpoint is not allowed.".into());
        }
        if body.as_ref().is_some_and(|b| b.len() > MAX_AUDIO_UPLOAD) {
            return Err("The prepared audio is too large to upload.".into());
        }
        let mut authorization = Vec::with_capacity(key.as_bytes().len() + scheme.len());
        authorization.extend_from_slice(scheme.as_bytes());
        authorization.extend_from_slice(key.as_bytes());
        let header = HeaderValue::from_bytes(&authorization);
        for byte in &mut authorization {
            unsafe {
                std::ptr::write_volatile(byte, 0);
            }
        }
        let mut header = header.map_err(|_| "The stored API key is invalid. Replace it in Settings.")?;
        header.set_sensitive(true);
        let mut builder = self
            .client
            .request(method, url)
            .header(AUTHORIZATION, header)
            .timeout(Duration::from_secs(180));
        if let Some(body) = body {
            builder = builder.header(CONTENT_TYPE, content_type).body(body);
        }
        builder
            .build()
            .map_err(|_| "Cannot prepare the approved API request.".into())
    }

    /// First outbound request of an approved audio job: the reservation is
    /// marked dispatched durably before any network I/O.
    pub async fn send_reserved_audio(
        &self,
        owner: &BudgetOwner,
        id: &str,
        approved_sha256: &str,
        request: Request,
    ) -> Result<ApiResponse> {
        owner.mark_dispatched(id, approved_sha256)?;
        self.send_dispatched(owner, id, request).await
    }

    /// Follow-up request of an already dispatched job (submit, poll). Any
    /// failure leaves the charge Uncertain; nothing is retried automatically.
    pub async fn send_dispatched(&self, owner: &BudgetOwner, id: &str, request: Request) -> Result<ApiResponse> {
        let response = match self.client.execute(request).await {
            Ok(response) => response,
            Err(_) => {
                owner.settle(id, None, None, None)?;
                return Err("The API request did not finish. Its charge is uncertain; no automatic retry will occur.".into());
            }
        };
        let request_id = request_id(&response).or_else(|| header_id(&response, "dg-request-id"));
        let status = response.status().as_u16();
        if !(200..=299).contains(&status) {
            owner.settle(id, None, None, request_id)?;
            return Err(match status {
                401 | 403 => "The provider rejected the credentials or model access. Check Settings.",
                413 => "The provider refused the audio size.",
                429 => "The provider rate or account limit was reached. Retry only after a new preview.",
                300..=399 => "The provider attempted a redirect. The request was stopped.",
                _ => "The provider could not complete the request. The recording is unchanged; retry deliberately.",
            }
            .into());
        }
        match bounded(response, MAX_AUDIO_RESPONSE).await {
            Ok(bytes) => Ok(ApiResponse { status, request_id, bytes }),
            Err(error) => {
                owner.settle(id, None, None, request_id)?;
                Err(error)
            }
        }
    }
}

fn header_id(response: &Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)?
        .to_str()
        .ok()
        .filter(|id| !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)))
        .map(String::from)
}

async fn bounded(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("The API response exceeded the safe size limit. The request may still be billed.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The API response was interrupted. Its charge is uncertain.")?
    {
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err("The API response exceeded the safe size limit. The request may still be billed.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn request_id(response: &Response) -> Option<String> {
    response
        .headers()
        .get("x-request-id")?
        .to_str()
        .ok()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
        .map(String::from)
}

fn append(body: &mut Vec<u8>, chunk: &[u8]) -> Result<()> {
    if chunk.len() > MAX_RESPONSE.saturating_sub(body.len()) {
        return Err(
            "The API response exceeded the safe size limit. The request may still be billed."
                .into(),
        );
    }
    body.extend_from_slice(chunk);
    Ok(())
}
async fn bounded_response(mut response: Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE as u64)
    {
        return Err(
            "The API response exceeded the safe size limit. The request may still be billed."
                .into(),
        );
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The API response was interrupted. Its charge is uncertain.")?
    {
        append(&mut body, &chunk)?;
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_is_endpoint_bound_and_authentication_debug_is_redacted() {
        let transport = ApiTransport::new().unwrap();
        let key = Secret::new("fake-test-key".into()).unwrap();
        let request = transport.json_request(&key, b"{}".to_vec()).unwrap();
        assert_eq!(
            request.url().as_str(),
            "https://api.openai.com/v1/responses"
        );
        assert!(request.headers()[AUTHORIZATION].is_sensitive());
        assert!(!format!("{:?}", request.headers()).contains("fake-test-key"));
        assert!(transport
            .json_request(&key, vec![0; MAX_REQUEST + 1])
            .is_err());
    }

    #[test]
    fn response_chunks_are_bounded_without_trusting_a_content_length() {
        let mut body = vec![];
        append(&mut body, &[1, 2, 3]).unwrap();
        assert_eq!(body, vec![1, 2, 3]);
        append(&mut body, &vec![0; MAX_RESPONSE - 3]).unwrap();
        assert!(append(&mut body, &[4]).is_err());
        assert_eq!(body.len(), MAX_RESPONSE);
    }

    /// One-shot local HTTP server: answers every connection with `reply` and
    /// counts connections, so a test can prove nothing was retried.
    fn serve(reply: impl Fn(&mut std::net::TcpStream) + Send + 'static) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/listen", listener.local_addr().unwrap());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                stream.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
                let mut seen = Vec::new();
                let mut buf = [0u8; 4096];
                while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => seen.extend_from_slice(&buf[..n]),
                    }
                }
                reply(&mut stream);
            }
        });
        (url, hits)
    }

    fn status(code: &'static str) -> impl Fn(&mut std::net::TcpStream) + Send + 'static {
        move |s| {
            use std::io::Write;
            let _ = write!(s, "HTTP/1.1 {code}\r\nContent-Length: 2\r\nLocation: https://elsewhere.invalid/\r\nConnection: close\r\n\r\n{{}}");
        }
    }

    /// 3.18: every way an audio request can fail after dispatch gives a plain
    /// message, keeps the possible charge as Uncertain in the shared ledger, and
    /// reaches the server exactly once (no automatic retry or redirect).
    #[test]
    fn audio_failures_keep_the_charge_uncertain_and_never_retry() {
        use super::super::budget::{PriceQuote, Purpose};
        use std::io::Write;
        let root = crate::storage::recording::tests::TestRoot::new();
        let budget = BudgetOwner::open(&root.0).unwrap();
        let client = Client::builder().redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never()).build().unwrap();
        let transport = ApiTransport { client };
        let quote = || PriceQuote { currency: "USD".into(), source: "https://deepgram.com/pricing".into(), effective_date: "2026-10-08".into(),
            model: "nova-3".into(), billing_unit: "started audio minute".into(), rate_micro_usd: 4_300, maximum_cost_micro_usd: 4_300 };
        let refused = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}/v1/listen", listener.local_addr().unwrap())
        }; // listener dropped: nothing accepts there (offline)
        type Reply = Box<dyn Fn(&mut std::net::TcpStream) + Send>;
        let cases: Vec<(&str, Option<Reply>, &str)> = vec![
            ("rejected-key", Some(Box::new(status("401 Unauthorized"))), "rejected the credentials"),
            ("rate-limit", Some(Box::new(status("429 Too Many Requests"))), "rate or account limit"),
            ("server-error", Some(Box::new(status("500 Internal Server Error"))), "could not complete"),
            ("too-large", Some(Box::new(status("413 Payload Too Large"))), "refused the audio size"),
            ("redirect", Some(Box::new(status("302 Found"))), "attempted a redirect"),
            ("dropped", Some(Box::new(|s: &mut std::net::TcpStream| { let _ = s.shutdown(std::net::Shutdown::Both); })), "did not finish"),
            ("truncated", Some(Box::new(|s: &mut std::net::TcpStream| { let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"res"); })), "interrupted"),
            ("oversized", Some(Box::new(|s: &mut std::net::TcpStream| { let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", MAX_AUDIO_RESPONSE + 1).as_bytes()); })), "safe size limit"),
            ("offline", None, "did not finish"),
        ];
        let total = cases.len() as u64;
        for (id, reply, expected) in cases {
            let hash = format!("{:x}", Sha256::digest(id.as_bytes()));
            budget.reserve(id, Purpose::Transcription, &hash, Some(quote())).unwrap();
            let (url, hits) = match reply {
                Some(reply) => { let (u, h) = serve(reply); (u, Some(h)) }
                None => (refused.clone(), None),
            };
            let request = transport.client.post(&url).timeout(Duration::from_secs(5)).body(vec![0u8; 64]).build().unwrap();
            let error = tauri::async_runtime::block_on(transport.send_reserved_audio(&budget, id, &hash, request)).err().unwrap_or_else(|| panic!("{id}: should fail"));
            assert!(error.contains(expected), "{id}: {error}");
            if let Some(hits) = hits {
                assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1, "{id}: sent exactly once");
            }
            // A dispatched request can never be released as unsent or sent again.
            assert!(budget.release_unsent(id).is_err(), "{id}");
            assert!(budget.mark_dispatched(id, &hash).is_err(), "{id}");
        }
        let summary = budget.summary().unwrap();
        assert_eq!(summary.uncertain_micro_usd, 4_300 * total, "every failed request keeps its possible charge");

        // A timeout counts the same way.
        let (url, hits) = serve(|_| std::thread::sleep(Duration::from_secs(3)));
        let hash = "e".repeat(64);
        budget.reserve("timeout", Purpose::Transcription, &hash, Some(quote())).unwrap();
        let request = transport.client.post(&url).timeout(Duration::from_millis(300)).body(vec![0u8; 64]).build().unwrap();
        let error = tauri::async_runtime::block_on(transport.send_reserved_audio(&budget, "timeout", &hash, request)).err().unwrap();
        assert!(error.contains("charge is uncertain; no automatic retry"), "{error}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(budget.summary().unwrap().uncertain_micro_usd, 4_300 * (total + 1));
    }
}
