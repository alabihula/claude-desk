//! A conversation owns the CLI transport; a turn owns only its event receiver.
//! Keeping stdin open at a result boundary also keeps stdio MCP children alive.
use crate::{mcp_control::McpControl, platform};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{mpsc, Mutex},
    time::{sleep_until, timeout, Duration, Instant},
};
use uuid::Uuid;

pub type Input = Arc<Mutex<Option<ChildStdin>>>;
pub enum Event {
    Stdout(String),
    Stderr(String),
    Complete,
    Exit {
        success: bool,
        code: Option<i32>,
        error: Option<String>,
    },
}
enum Request {
    Turn {
        prompt: String,
        events: mpsc::Sender<Event>,
    },
    Interrupt,
    Close,
}
pub struct Session {
    pub pid: u32,
    pub input: Input,
    pub control: Arc<McpControl>,
    alive: Arc<AtomicBool>,
    requests: mpsc::Sender<Request>,
}

pub async fn write(input: &Input, message: &Value) -> Result<(), String> {
    let mut guard = input.lock().await;
    let stdin = guard
        .as_mut()
        .ok_or("Claude is no longer accepting input")?;
    let mut line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    line.push(b'\n');
    timeout(Duration::from_secs(10), async {
        stdin.write_all(&line).await?;
        stdin.flush().await
    })
    .await
    .map_err(|_| "Claude input timed out".to_string())?
    .map_err(|e| e.to_string())
}

impl Session {
    pub async fn spawn(mut command: Command) -> Result<Arc<Self>, String> {
        command.kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Claude couldn't start: {e}"))?;
        let pid = child.id().ok_or("Claude process id unavailable")?;
        let input = Arc::new(Mutex::new(child.stdin.take()));
        let stdout = child.stdout.take().ok_or("Claude stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("Claude stderr unavailable")?;
        let (requests, mut receiver) = mpsc::channel(8);
        let session = Arc::new(Self {
            pid,
            input,
            requests,
            control: Arc::default(),
            alive: Arc::new(AtomicBool::new(true)),
        });
        write(
            &session.input,
            &json!({"type":"control_request", "request_id":Uuid::new_v4().to_string(),
            "request":{"subtype":"initialize","hooks":{},"sdkMcpServers":[]}}),
        )
        .await?;
        let input = session.input.clone();
        let control = session.control.clone();
        let alive = session.alive.clone();
        tauri::async_runtime::spawn(async move {
            let mut stdout = BufReader::new(stdout).lines();
            let mut stderr = BufReader::new(stderr).lines();
            let mut stdout_done = false;
            let mut stderr_done = false;
            let mut active: Option<mpsc::Sender<Event>> = None;
            let mut init: Option<String> = None;
            let mut deadline = None;
            let mut closing = false;
            let mut failure = None;
            let status = loop {
                tokio::select! {
                    biased;
                    _ = sleep_until(deadline.unwrap_or_else(|| Instant::now() + Duration::from_secs(86400))), if deadline.is_some() => {
                        // An unresponsive interrupt/EOF must not strand the conversation or its children.
                        let _ = platform::kill_process_tree(pid);
                        break child.wait().await;
                    }
                    request = receiver.recv(), if !closing => match request {
                        Some(Request::Turn { prompt, events }) if active.is_none() => {
                            active = Some(events);
                            if let (Some(events), Some(init)) = (&active, &init) {
                                let _ = events.send(Event::Stdout(init.clone())).await;
                            }
                            if let Err(error) = write(&input, &json!({"type":"user", "message":{"role":"user","content":prompt},
                                "parent_tool_use_id":null,"uuid":Uuid::new_v4().to_string()})).await {
                                failure = Some(error);
                                closing = true;
                                deadline = Some(Instant::now());
                            }
                        }
                        Some(Request::Turn { events, .. }) => {
                            let _ = events.send(Event::Exit { success:false, code:None, error:Some("Claude is already working in this conversation".into()) }).await;
                        }
                        Some(Request::Interrupt) if active.is_some() => {
                            // Interrupt the turn through the protocol, retaining the MCP transport.
                            if let Err(error) = write(&input, &json!({"type":"control_request","request_id":Uuid::new_v4().to_string(),"request":{"subtype":"interrupt"}})).await {
                                failure = Some(error);
                            }
                            deadline.get_or_insert(Instant::now() + Duration::from_secs(10));
                        }
                        Some(Request::Interrupt) => {}
                        Some(Request::Close) | None => {
                            closing = true;
                            input.lock().await.take();
                            deadline = Some(Instant::now() + Duration::from_secs(3));
                        }
                    },
                    line = stdout.next_line(), if !stdout_done => match line {
                        Ok(Some(line)) => {
                            let payload = serde_json::from_str::<Value>(&line).unwrap_or(Value::Null);
                            control.receive(&payload);
                            if payload["type"] == "system" && payload["subtype"] == "init" { init = Some(line.clone()); }
                            let result = payload["type"] == "result";
                            if let Some(events) = &active { let _ = events.send(Event::Stdout(line)).await; }
                            if result {
                                if !closing { deadline = None; }
                                if let Some(events) = active.take() { let _ = events.send(Event::Complete).await; }
                            }
                        }
                        Ok(None) => stdout_done = true,
                        Err(error) => { stdout_done = true; failure = Some(error.to_string()); closing = true; deadline = Some(Instant::now()); }
                    },
                    line = stderr.next_line(), if !stderr_done => match line {
                        Ok(Some(line)) => { if let Some(events) = &active { let _ = events.send(Event::Stderr(line)).await; } }
                        Ok(None) => stderr_done = true,
                        Err(error) => { stderr_done = true; failure = Some(error.to_string()); }
                    },
                    status = child.wait() => break status,
                }
            };
            alive.store(false, Ordering::Release);
            control.close();
            input.lock().await.take();
            if let Some(events) = active {
                let (success, code, error) = match status {
                    Ok(status) => (status.success(), status.code(), failure),
                    Err(error) => (false, None, Some(error.to_string())),
                };
                let _ = events
                    .send(Event::Exit {
                        success,
                        code,
                        error,
                    })
                    .await;
            }
        });
        Ok(session)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
    pub fn begin(&self, prompt: String) -> Result<mpsc::Receiver<Event>, String> {
        if !self.is_alive() {
            return Err("Claude session has exited; send the message again".into());
        }
        let (events, receiver) = mpsc::channel(256);
        self.requests
            .try_send(Request::Turn { prompt, events })
            .map_err(|_| "Claude session is unavailable".to_string())?;
        Ok(receiver)
    }
    pub fn interrupt(&self) -> Result<(), String> {
        self.requests
            .try_send(Request::Interrupt)
            .map_err(|_| "Claude session is unavailable".into())
    }
    pub fn request_close(&self) {
        if self.requests.try_send(Request::Close).is_err() {
            self.terminate();
        }
    }
    pub async fn close(&self) {
        let _ = self.requests.send(Request::Close).await;
        // No polling while idle. Shutdown alone waits for bounded process cleanup.
        let _ = timeout(Duration::from_secs(5), async {
            while self.is_alive() {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;
        if self.is_alive() {
            self.terminate();
        }
    }
    pub fn terminate(&self) {
        if self.is_alive() {
            let _ = platform::kill_process_tree(self.pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, path::Path};

    async fn fixture(args: &[&str]) -> Arc<Session> {
        let environment: HashMap<String, String> = std::env::vars().collect();
        let resolved = platform::resolve_command("node", &environment)
            .expect("Node.js is required for lifecycle tests");
        let mut command = resolved.command();
        command
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/claude-session.mjs"))
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(unix)]
        command.process_group(0);
        Session::spawn(command).await.unwrap()
    }
    async fn collect(mut events: mpsc::Receiver<Event>) -> (String, bool) {
        timeout(Duration::from_secs(60), async {
            let mut result = String::new();
            while let Some(event) = events.recv().await {
                match event {
                    Event::Stdout(line) => {
                        let value: Value = serde_json::from_str(&line).unwrap();
                        if value["type"] == "result" {
                            assert_ne!(value["is_error"], true, "{value}");
                            result = value["result"].as_str().unwrap_or_default().into();
                        }
                    }
                    Event::Complete => return (result, true),
                    Event::Exit { .. } => return (result, false),
                    Event::Stderr(line) => eprintln!("fixture stderr: {line}"),
                }
            }
            (result, false)
        })
        .await
        .expect("turn must finish within timeout")
    }
    #[tokio::test]
    async fn reuses_one_process_across_turns_interrupts_and_repeated_submissions() {
        let session = fixture(&[]).await;
        for number in 1..=20 {
            let (result, completed) = collect(session.begin("hello".into()).unwrap()).await;
            assert!(completed);
            assert_eq!(result, format!("{number}:{}:hello", session.pid));
            assert!(session.is_alive());
        }
        let first = session.begin("hang".into()).unwrap();
        let duplicate = session.begin("duplicate".into()).unwrap();
        assert!(!collect(duplicate).await.1);
        session.interrupt().unwrap();
        assert!(collect(first).await.1);
        assert!(collect(session.begin("again".into()).unwrap())
            .await
            .0
            .starts_with("21:"));
        session.close().await;
        assert!(!session.is_alive());
        assert!(session.begin("stale".into()).is_err());
    }
    #[tokio::test]
    async fn reports_unexpected_exit_and_bounds_unresponsive_interrupts() {
        let session = fixture(&[]).await;
        assert!(!collect(session.begin("crash".into()).unwrap()).await.1);
        assert!(!session.is_alive());
        let session = fixture(&["--ignore-interrupt"]).await;
        let events = session.begin("hang".into()).unwrap();
        session.interrupt().unwrap();
        assert!(!collect(events).await.1);
        assert!(!session.is_alive());
    }
    #[tokio::test]
    #[ignore = "uses the locally configured Claude provider and real Playwright"]
    async fn real_claude_and_playwright_retain_browser_between_turns() {
        let environment = platform::login_environment().await;
        let claude =
            platform::resolve_command("claude", &environment).expect("Claude Code installed");
        let node = platform::resolve_command("node", &environment).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let config = json!({"mcpServers":{"playwright":{"command":node.path(), "args":[
            root.join("node_modules/@playwright/mcp/cli.js"), std::path::PathBuf::from("--headless"),
            "--isolated", "--browser", std::env::var("CLAUDE_DESK_TEST_BROWSER").unwrap_or("chromium".into())
        ]}}});
        let mut command = claude.command();
        command
            .envs(environment)
            .current_dir(std::env::temp_dir())
            .args([
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--replay-user-messages",
                "--permission-prompt-tool",
                "stdio",
                "--permission-mode",
                "bypassPermissions",
                "--strict-mcp-config",
                "--mcp-config",
                &config.to_string(),
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(unix)]
        command.process_group(0);
        let session = Session::spawn(command).await.unwrap();
        let first = collect(session.begin("Use Playwright MCP browser_navigate to open about:blank, then browser_evaluate to set window.claudeDeskNonce='same-live-page'. Do not close the browser. Reply READY. Use no other tools.".into()).unwrap()).await;
        assert!(
            first.1 && first.0.contains("READY"),
            "first browser turn failed: {}",
            first.0
        );
        let second = collect(session.begin("Use Playwright MCP browser_evaluate to read window.claudeDeskNonce from the existing page, without navigation. Reply only with its value. Do not close the browser.".into()).unwrap()).await;
        assert!(
            second.1 && second.0.contains("same-live-page"),
            "live page was lost: {}",
            second.0
        );
        assert!(session.is_alive());
        session.close().await;
        assert!(!session.is_alive());
    }

    #[tokio::test]
    #[ignore = "requires installed Playwright Chromium; run explicitly in desktop CI"]
    async fn real_playwright_preserves_page_state_tabs_and_conversation_isolation() {
        let first = fixture(&["--playwright"]).await;
        let second = fixture(&["--playwright"]).await;
        assert!(collect(first.begin("open".into()).unwrap())
            .await
            .0
            .contains("same-live-page"));
        assert!(collect(first.begin("check".into()).unwrap())
            .await
            .0
            .contains("same-live-page"));
        // A different conversation has a separate browser, without first's in-memory variable.
        assert!(!collect(second.begin("check".into()).unwrap())
            .await
            .0
            .contains("same-live-page"));
        let interrupted = first.begin("hang".into()).unwrap();
        first.interrupt().unwrap();
        assert!(collect(interrupted).await.1);
        assert!(collect(first.begin("check".into()).unwrap())
            .await
            .0
            .contains("same-live-page"));
        collect(first.begin("new-tab".into()).unwrap()).await;
        let tabs = collect(first.begin("tabs".into()).unwrap()).await.0;
        assert!(tabs.contains("1:"), "expected two preserved tabs: {tabs}");
        first.close().await;
        second.close().await;
        assert!(!first.is_alive() && !second.is_alive());
    }
}
