# Claude Desk Development Guide

## Product boundary

Claude Desk is a desktop AI coding product comparable to Codex or the Claude Code editor experience. It must not become an embedded terminal, a visual shell around the interactive Claude CLI, or a page that exposes raw process output as the product UI.

- Present conversations, tool activity, permissions, file changes, attachments, downloads, and settings as native product interactions.
- Claude Code and its stream protocol are backend capabilities; users should not need to understand CLI flags or terminal state.
- Prefer focused, reversible product behavior over framework-heavy abstractions.

## Architecture

- `src/views`: page composition and page-level state wiring only.
- `src/components`: focused presentation and interaction components.
- `src/stores/workspace.js`: conversation, run, queue, and workspace orchestration.
- `src/services`: pure parsing, mapping, keyboard, queue, and UI utility logic. Add tests beside non-trivial services.
- `src-tauri/src`: filesystem, Git, persistence, configuration, and Claude process boundaries.

Do not combine rendering, filesystem access, data conversion, and process control in one Vue component. Keep OS and security validation in Rust even when the interaction starts in the frontend.

## Runtime contracts

- Claude runs through structured `stream-json` input/output. Preserve partial-message streaming and structured interrupt requests.
- Supplemental messages are queued per conversation. Normal completion dispatches FIFO; “立即调整” interrupts the current turn and resumes the same Claude session with the selected message first.
- Stop and steer are different actions. Stop must not silently dispatch queued messages.
- A Claude `result` frame marks a protocol result, not necessarily a user-visible answer and not the child-process exit. Keep the UI in a finishing state until the backend emits `exit`. A successful chat exit with no response text is a product error: pause queued follow-ups, persist a diagnostic event, and never label it completed.
- Claude run diagnostics are privacy-bounded product telemetry under Application Support. Record structural counters and exit metadata instead of raw stdout or chat/code content; bound stderr, redact common credentials and home paths, retain only the most recent runs, and resolve exports from backend-validated conversation/run identifiers.
- Local download cards may only resolve existing files inside the active project after canonical path validation in Rust. Never trust a model-produced path in the webview alone.
- Attachments are app-owned copies under Application Support and are linked to messages in SQLite.
- Requests to start development services must use a platform-native detached process (`launchd` on macOS, detached PowerShell `Start-Process` on Windows) and verify the target port before reporting success; ordinary Claude Code background tasks do not provide persistence across session cleanup.
- Settings apply to the next Claude process; avoid requiring an app restart unless a platform-level setting truly needs it.

## Desktop process lifecycle

Treat every external process as a product lifecycle boundary, especially on Windows. Do not fix console-window bugs by merely hiding the last observed executable; audit every trigger from application startup through project selection, polling, conversation work, file actions, stop, and exit.

- `src-tauri/src/platform.rs::background_command` is the single entry point for non-interactive `std::process::Command` work. Git, `taskkill`, editor launch, file reveal, and future backend utilities must use it instead of calling `StdCommand::new` directly.
- Claude's async `ResolvedCommand` must keep `CREATE_NO_WINDOW` on Windows for both native `claude.exe` and npm's `claude.cmd`/`.bat` through `cmd.exe /D /C`. Preserve piped stdin/stdout/stderr for the structured protocol.
- `open_terminal` is the only intentional visible-terminal boundary. A terminal window must appear only after an explicit user action; background health checks, Git refreshes, file actions, and Claude work must never surface one.
- Keep the single-instance plugin registered before other Tauri plugins. A second application launch must focus the existing main window and exit, not create another webview.
- Reject a Claude command that resolves to the current executable or any `Claude Desk.exe` / `claude-desk.exe`, including a stale path from an older installation. A bad command must produce a bounded health error, never recursively launch the App.
- Keep the Claude version check bounded by a timeout. Do not let a malformed executable or wrapper block application initialization indefinitely.
- Project selection immediately triggers Git status/environment reads. The Changes UI also refreshes on a 3-second interval, browser/window focus, and visibility changes. Coalesce overlapping refreshes per project and discard stale results after switching projects.
- Starting a development service is separate from an ordinary background command. Continue using the platform-native detached-service contract described above; hiding a child console does not make a process persistent.

When adding any process call, classify it before implementation:

1. Structured Claude process: async, piped, interruptible, no console.
2. Product background capability: bounded or awaited, no console, routed through `background_command`.
3. User-requested terminal: visible and launched only from `open_terminal`.
4. Persistent development service: platform-native detached launch plus port/health verification.

After process-related changes, scan production Rust sources for raw `Command::new` / `StdCommand::new`. Any exception must be intentional, documented, and belong to one of the explicit boundaries above.

## Implementation rules

- Preserve and understand existing uncommitted changes before editing. Never discard unrelated user work.
- Follow current naming and directory conventions; avoid unrelated refactors.
- Pages assemble components. Put reusable business logic in services, store actions, or focused backend modules.
- Keep components single-purpose and document only non-obvious lifecycle, compatibility, or security decisions.
- Treat async ordering, repeated submission, cancellation, stale events, and recovery as part of the feature.
- Keep Chinese IME composition handling intact whenever composer keyboard behavior changes.

## Verification

Run checks proportional to the change. Product-source changes normally require all of the following:

```bash
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
```

For interaction changes, also exercise the packaged App rather than relying only on Vite or unit tests. Verify success, cancellation, missing/stale data, repeated actions, and one adversarial boundary. Report what was executed separately from static inference.

Windows process or packaging changes require the Windows workflow in addition to local checks. Do not declare them fixed from macOS compilation or code inspection alone. The Windows evidence must include:

- the Windows-only background-process test proving the child sees `GetConsoleWindow() == null`;
- frontend and Rust tests, including Git status/environment behavior and refresh coalescing;
- PE subsystem value `2` (`IMAGE_SUBSYSTEM_WINDOWS_GUI`);
- silent installer execution and installed-App launch survival;
- a second launch exiting while the original instance remains alive;
- packaged-App lifecycle acceptance: initial launch, add/select/switch project, remain on a project for multiple Git polling intervals, switch conversation, send/stop/send-again, open/reveal a file, and exit;
- explicit confirmation that only the user-invoked Open Terminal action produces a terminal window.

If a console or duplicate window appears, first correlate it with the trigger and refresh cadence. Inspect every external process launched by that lifecycle rather than assuming the window title identifies the child executable. A window titled “Claude Desk” can still be a console inherited by `git.exe` or another child. Never ship a “silent” workaround without identifying the process owner and adding a regression check for the actual trigger.

## Versioning and release

Keep the version synchronized in:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Build the macOS installer with:

```bash
pnpm tauri build
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`. Verify its bundle version and signature structure before handoff. Current local builds are ad-hoc signed and not Apple-notarized, so do not claim otherwise.

The Windows x64 installer is built by `.github/workflows/windows-build.yml` on a Windows runner and uploaded as a workflow artifact. It is unsigned, so report the expected Windows “Unknown publisher” warning rather than claiming production signing.

Windows release safety baseline:

- Do not distribute `0.1.20`: it hid consoles but allowed recursive App launches in a misresolved Claude configuration.
- Do not distribute `0.1.21`: it added self-resolution and single-instance protection but did not cover Git and other non-Claude background processes; selecting a project could repeatedly surface consoles during Git polling.
- `0.1.22` is the first colleague-accepted baseline covering the complete background-process boundary. Future Windows releases must preserve its lifecycle tests and pass the workflow above before handoff.
- Replacing an installer is not sufficient evidence. Record the workflow run, artifact SHA-256, commit SHA, and the specific packaged lifecycle paths exercised.

The GitHub repository is public. Scan for secrets before commits, keep `main` deployable, and confirm the remote commit SHA after pushing. If GitHub HTTPS negotiation stalls in this environment, use `git -c http.version=HTTP/1.1 push origin main`.
