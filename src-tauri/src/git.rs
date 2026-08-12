use crate::platform;
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEnvironment {
    pub is_repository: bool,
    pub branch: String,
    pub upstream: String,
    pub ahead: u32,
    pub behind: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit: String,
    pub pushed: bool,
}

fn run_git(project_path: &str, args: &[&str]) -> Result<std::process::Output, String> {
    platform::background_command("git")
        .arg("-C")
        .arg(project_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

fn git_output(project_path: &str, args: &[&str]) -> Result<String, String> {
    let output = run_git(project_path, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_numstat(value: &str) -> (u32, u32) {
    value.lines().fold((0, 0), |(additions, deletions), line| {
        let mut fields = line.split('\t');
        let added = fields
            .next()
            .and_then(|item| item.parse::<u32>().ok())
            .unwrap_or(0);
        let deleted = fields
            .next()
            .and_then(|item| item.parse::<u32>().ok())
            .unwrap_or(0);
        (
            additions.saturating_add(added),
            deletions.saturating_add(deleted),
        )
    })
}

fn commit_subject(project_path: &str) -> Result<String, String> {
    git_output(project_path, &["log", "-1", "--format=%h %s"])
}

fn untracked_file_diff(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let Ok(content) = String::from_utf8(bytes) else {
        return Ok(String::new());
    };
    Ok(content
        .lines()
        .map(|line| format!("+{line}"))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn untracked_line_count(path: &Path) -> u32 {
    fs::read(path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|content| content.lines().count() as u32)
        .unwrap_or(0)
}

#[tauri::command]
pub fn git_status(project_path: String) -> Result<Vec<ChangedFile>, String> {
    let output = run_git(
        &project_path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let entries = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < entries.len() {
        let entry = String::from_utf8_lossy(entries[index]);
        if entry.len() < 4 {
            index += 1;
            continue;
        }
        let status = entry[..2].trim().to_string();
        let mut path = entry[3..].to_string();
        if entry.starts_with('R') || entry.starts_with('C') {
            if let Some(next) = entries.get(index + 1) {
                path = String::from_utf8_lossy(next).to_string();
                index += 1;
            }
        }
        changes.push(ChangedFile {
            status: if status.is_empty() {
                "M".into()
            } else {
                status
            },
            path,
        });
        index += 1;
    }
    Ok(changes)
}

#[tauri::command]
pub fn git_environment(project_path: String) -> Result<GitEnvironment, String> {
    if git_output(&project_path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(GitEnvironment {
            is_repository: false,
            branch: String::new(),
            upstream: String::new(),
            ahead: 0,
            behind: 0,
            additions: 0,
            deletions: 0,
        });
    }

    let branch = git_output(
        &project_path,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )
    .unwrap_or_else(|_| "HEAD detached".into());
    let upstream = git_output(
        &project_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .unwrap_or_default();
    let (behind, ahead) = if upstream.is_empty() {
        (0, 0)
    } else {
        let counts = git_output(
            &project_path,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{upstream}...HEAD"),
            ],
        )?;
        let mut values = counts
            .split_whitespace()
            .filter_map(|item| item.parse::<u32>().ok());
        (values.next().unwrap_or(0), values.next().unwrap_or(0))
    };
    let numstat = git_output(&project_path, &["diff", "--numstat", "HEAD", "--"])
        .or_else(|_| git_output(&project_path, &["diff", "--numstat", "--"]))
        .unwrap_or_default();
    let (mut additions, deletions) = parse_numstat(&numstat);
    for file in git_status(project_path.clone())?
        .into_iter()
        .filter(|file| file.status == "??")
    {
        additions = additions.saturating_add(untracked_line_count(
            &Path::new(&project_path).join(file.path),
        ));
    }

    Ok(GitEnvironment {
        is_repository: true,
        branch,
        upstream,
        ahead,
        behind,
        additions,
        deletions,
    })
}

#[tauri::command]
pub fn git_commit(
    project_path: String,
    message: String,
    push: bool,
) -> Result<GitCommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty.".into());
    }
    if git_output(&project_path, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Err("This project is not a Git repository.".into());
    }
    git_output(&project_path, &["add", "-A"])?;
    git_output(&project_path, &["commit", "-m", message])?;
    if push {
        git_output(&project_path, &["push"])?;
    }
    Ok(GitCommitResult {
        commit: commit_subject(&project_path)?,
        pushed: push,
    })
}

#[tauri::command]
pub fn git_diff(project_path: String, path: String) -> Result<String, String> {
    let status = git_status(project_path.clone())?
        .into_iter()
        .find(|item| item.path == path)
        .map(|item| item.status)
        .unwrap_or_default();
    if status == "??" {
        return untracked_file_diff(&Path::new(&project_path).join(&path));
    }
    let mut output = run_git(
        &project_path,
        &["diff", "--no-ext-diff", "HEAD", "--", &path],
    )?;
    // Repositories without an initial commit have no HEAD; fall back to the working-tree diff.
    if !output.status.success() {
        output = run_git(&project_path, &["diff", "--no-ext-diff", "--", &path])?;
    }
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        git_commit, git_environment, parse_numstat, untracked_file_diff, untracked_line_count,
    };
    use std::{fs, path::Path, process::Command, time::SystemTime};

    fn temp_file(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("claude-desk-{suffix}-{name}"))
    }

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn renders_untracked_text_and_tolerates_binary_files() {
        let text = temp_file("sample.txt");
        let binary = temp_file("sample.png");
        fs::write(&text, "first\nsecond\n").unwrap();
        fs::write(&binary, [0, 159, 146, 150]).unwrap();

        assert_eq!(untracked_file_diff(&text).unwrap(), "+first\n+second");
        assert_eq!(untracked_file_diff(&binary).unwrap(), "");
        assert_eq!(untracked_line_count(&text), 2);
        assert_eq!(untracked_line_count(&binary), 0);

        fs::remove_file(text).unwrap();
        fs::remove_file(binary).unwrap();
    }

    #[test]
    fn sums_text_numstat_and_ignores_binary_counts() {
        assert_eq!(parse_numstat("4\t2\tsrc/main.rs\n-\t-\tlogo.png"), (4, 2));
    }

    #[test]
    fn reports_and_commits_project_changes_without_pushing() {
        let repository = temp_file("git-environment");
        fs::create_dir_all(&repository).unwrap();
        git(&repository, &["init"]);
        git(
            &repository,
            &["config", "user.email", "claude-desk@example.test"],
        );
        git(&repository, &["config", "user.name", "Claude Desk Test"]);
        fs::write(repository.join("tracked.txt"), "before\n").unwrap();
        git(&repository, &["add", "tracked.txt"]);
        git(&repository, &["commit", "-m", "initial"]);
        fs::write(repository.join("tracked.txt"), "after\nagain\n").unwrap();
        fs::write(repository.join("new.txt"), "one\ntwo\n").unwrap();

        let path = repository.to_string_lossy().to_string();
        let environment = git_environment(path.clone()).unwrap();
        assert!(environment.is_repository);
        assert!(environment.additions >= 4);
        assert!(environment.deletions >= 1);

        let result = git_commit(path, "test: save changes".into(), false).unwrap();
        assert!(result.commit.contains("test: save changes"));
        assert!(!result.pushed);
        fs::remove_dir_all(repository).unwrap();
    }
}
