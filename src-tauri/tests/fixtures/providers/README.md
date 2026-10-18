# Provider contract fixtures

Recorded-shape examples reconstructed offline from the adapters and the documented response formats, not captured live responses. Text is invented public test text; all response, message, request and job IDs and upload URLs are replaced. No keys or personal recordings are included.

Format references: https://platform.openai.com/docs/api-reference/responses/object ; https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded ; https://www.assemblyai.com/docs/api-reference/transcripts/get . OpenAI task JSON follows the strict schemas in `api/coaching.rs` and `conversation.rs`. Deepgram times are seconds; AssemblyAI word times are milliseconds and audio duration is seconds. The shared HTTP error fixtures exercise transport status mapping for each adapter; provider-specific error bodies are deliberately ignored by transport.

Run `cargo test --lib providers::fixtures_parse`. The ignored live check is documented beside its test; do not run it without the user's explicit OK.
