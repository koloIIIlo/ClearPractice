//! Counts every HTTP client the app builds (release check A-11). Each place
//! that builds a `reqwest::Client` calls `client_built` first, so a test can
//! run the recording, local transcription and prosody paths in a process of
//! their own and prove that no client was built at all. Nothing is logged.
use std::sync::atomic::{AtomicUsize, Ordering};

static CLIENTS: AtomicUsize = AtomicUsize::new(0);

/// Call right before building any HTTP client.
pub(crate) fn client_built() {
    CLIENTS.fetch_add(1, Ordering::SeqCst);
}

/// HTTP clients built by this process so far.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn clients_built() -> usize {
    CLIENTS.load(Ordering::SeqCst)
}
