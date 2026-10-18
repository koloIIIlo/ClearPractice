# Developing ClearPractice

Windows desktop app: Tauri 2, React 19, TypeScript, Vite, Tailwind 4 and shadcn/Radix. Dependencies use exact versions.

## Setup and commands

Install Node.js and the Windows Tauri prerequisites: Rust with the MSVC toolchain, Visual Studio C++ build tools and the Windows SDK. Run `npm ci` in the repository root.

- `npm run dev`: browser preview with sample data; no native recording.
- `npm run tauri dev`: desktop app.
- `npm run tauri build`: desktop installers under `src-tauri/target/release/bundle`. Signing is not configured yet.
- `npx tsc --noEmit -p .`: TypeScript check.
- `npm run build`, then `npm run check:bundle`: production frontend and bundle budgets. Start-up JavaScript must stay at or below 320 kB gzip. Do not raise the budget to fit a feature.
- `npm test -- --pool=threads --maxWorkers=1 --isolate=false <test files>`: scoped frontend checks on this laptop. Run checks one at a time. If a worker stalls at startup, wait and retry once.
- In PowerShell, prepend `$env:USERPROFILE\.cargo\bin` to PATH if needed. Run scoped Rust checks from `src-tauri`, for example `cargo test --lib -j 2 preferences`. Avoid Git Bash's GNU `link` when building Rust on Windows.

Read [CLAUDE.md](../CLAUDE.md), the [blueprint](../ClearPractice-App-Blueprint.md), and the relevant roadmap work package before changes. [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) contains current status, decisions and manual acceptance recipes.

## Boundaries

UI calls go through `src/lib/ipc`: `IpcClient`, native and mock implementations, and Zod response schemas. Rust owns audio, paths, SQLite and inference. Feature code lives in `src/features`; shared shadcn controls live in `src/components/ui`. Use 40 px controls and the `--cp-*` design tokens.

Observations retain their provenance: Measured, Estimated, Your note or AI suggestion. Missing values are null with a reason. Cloud requests keep their preview and explicit Send. No automatic provider switch is allowed.

## Release notes and a fresh profile

`src/content/whats-new.ts` holds three to six linked highlights for each release. Add a version entry when updating `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; keep the old entries. Update [CHANGELOG.md](../CHANGELOG.md) too.

A fresh profile is detected in Rust by the absence of a stored `ui_preferences` value. `Preferences::default()` sets `lastSeenVersion` to the current Cargo package version, so a fresh install does not show release notes. An existing JSON profile without that field gets null through the field's serde default; it sees the current highlights once. Damaged preferences use fresh defaults as part of the existing recovery policy. The mock client also starts with the current version.

The tiny start-up host waits for saved preferences and loads the dialog and content dynamically only when needed. The version is marked seen after the dialog has loaded and appeared. Help can always reopen it. The automatic check is deferred until after first-launch setup.

Surprise prompts store the last delivered/dismissed local date in `cp-surprise-on` in WebView localStorage, following the daily reminder. A failed history check does not deliver a prompt. The time uses a deterministic date seed inside a same-day, half-hour-step window; there is no background service. Notification permission is requested only by the explicit checkbox. Notification calls stay behind `IpcClient` and a lazy desktop plugin-command facade.

First-language tips are drafts. Each language needs a knowledgeable speaker's review before release; record that in [CONTENT_REVIEW.md](CONTENT_REVIEW.md).
