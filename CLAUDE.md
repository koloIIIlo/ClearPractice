# ClearPractice

Windows desktop speaking-practice app: Tauri 2 + React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui (Radix).

- **What to build:** `ClearPractice-App-Blueprint.md` (the spec; section refs like §9 point here).
- **Where we are:** `DEVELOPMENT_PLAN.md`. Read "Current status" first, tick boxes only when verified, and update the status and notes at the end of each session.

## Commands

- `npm run dev`: frontend only in a browser, backed by the mock IPC client (sample data)
- `npm run tauri dev`: the full desktop app (needs Rust + MSVC + Windows SDK)
- `npm test` · `npm run typecheck` · `npm run build`
- Rust: `cargo build` / `cargo test` in `src-tauri/`. In PowerShell, prepend `$env:USERPROFILE\.cargo\bin` to PATH if cargo isn't found. In Git Bash, `link` resolves to GNU coreutils, so run cargo from PowerShell.

## Conventions

- The UI talks to the native core only through `src/lib/ipc` (`IpcClient` + Zod schemas). Method names mirror the §15 Rust commands. React components never touch paths, SQLite, audio, or inference.
- Feature code lives in `src/features/<area>`. Shared controls go in `src/components` (shadcn primitives in `src/components/ui`, customised: 40px button heights, 216px sidebar, 800px compact-nav breakpoint).
- Design tokens are `--cp-*` in `src/index.css` (§4), mapped onto the shadcn variables. Don't hard-code colours.
- Evidence provenance is always labelled Measured / Estimated / Your note / AI suggestion. Missing values are `null` with a reason, never 0.
- Pin exact dependency versions (no `^`).
