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
}
