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
- A Claude `result` frame means the model has answered, not that its child process has exited. Keep the UI in a finishing state until the backend emits `exit`.
- Local download cards may only resolve existing files inside the active project after canonical path validation in Rust. Never trust a model-produced path in the webview alone.
- Attachments are app-owned copies under Application Support and are linked to messages in SQLite.
- Requests to start development services must use a macOS launchd user job and verify the target port before reporting success; ordinary Claude Code background tasks do not provide persistence across session cleanup.
- Settings apply to the next Claude process; avoid requiring an app restart unless a platform-level setting truly needs it.

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
/Users/xing.min/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
/Users/xing.min/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
/Users/xing.min/.cargo/bin/cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
```

For interaction changes, also exercise the packaged App rather than relying only on Vite or unit tests. Verify success, cancellation, missing/stale data, repeated actions, and one adversarial boundary. Report what was executed separately from static inference.

## Versioning and release

Keep the version synchronized in:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Build the macOS installer with:

```bash
PATH=/Users/xing.min/.cargo/bin:$PATH pnpm tauri build
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`. Verify its bundle version and signature structure before handoff. Current local builds are ad-hoc signed and not Apple-notarized, so do not claim otherwise.

The GitHub repository remains private until the owner explicitly opens it. Scan for secrets before commits, keep `main` deployable, and confirm the remote commit SHA after pushing. If GitHub HTTPS negotiation stalls in this environment, use `git -c http.version=HTTP/1.1 push origin main`.
