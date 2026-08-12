use crate::context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{AppHandle, Manager};

const MAX_SKILL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSkill {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub invocation: String,
    pub path: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexConfig {
    #[serde(default)]
    plugins: BTreeMap<String, CodexPlugin>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexPlugin {
    #[serde(default)]
    enabled: bool,
}

fn frontmatter(content: &str) -> BTreeMap<String, String> {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return BTreeMap::new();
    }
    let mut values = BTreeMap::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values.insert(
            key.trim().to_ascii_lowercase(),
            value
                .trim()
                .trim_matches(['\'', '"'])
                .replace(['\n', '\r'], " "),
        );
    }
    values
}

fn skill_from_file(
    skill_file: &Path,
    name: String,
    scope: &str,
    invocation: &str,
) -> Option<ClaudeSkill> {
    if fs::metadata(skill_file).ok()?.len() > MAX_SKILL_BYTES {
        return None;
    }
    let content = fs::read_to_string(skill_file).ok()?;
    let metadata = frontmatter(&content);
    if metadata
        .get("user-invocable")
        .is_some_and(|value| value == "false")
    {
        return None;
    }
    let name = metadata
        .get("name")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or(name);
    Some(ClaudeSkill {
        name,
        description: metadata.get("description").cloned().unwrap_or_default(),
        scope: scope.into(),
        invocation: invocation.into(),
        path: (invocation == "external").then(|| skill_file.to_string_lossy().into_owned()),
    })
}

fn skills_in(
    root: &Path,
    scope: &str,
    invocation: &str,
    namespace: Option<&str>,
) -> Vec<ClaudeSkill> {
    let Ok(root) = fs::canonicalize(root) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let skill_file = fs::canonicalize(entry.path().join("SKILL.md")).ok()?;
            if !skill_file.starts_with(&root) || !skill_file.is_file() {
                return None;
            }
            let local_name = entry.file_name().to_string_lossy().trim().to_string();
            if local_name.is_empty() {
                return None;
            }
            let fallback_name = namespace
                .map(|prefix| format!("{prefix}:{local_name}"))
                .unwrap_or(local_name);
            let mut skill = skill_from_file(&skill_file, fallback_name, scope, invocation)?;
            if let Some(prefix) = namespace {
                if !skill.name.contains(':') {
                    skill.name = format!("{prefix}:{}", skill.name);
                }
            }
            Some(skill)
        })
        .collect()
}

fn merge_skill_sources(sources: impl IntoIterator<Item = Vec<ClaudeSkill>>) -> Vec<ClaudeSkill> {
    let mut merged = BTreeMap::new();
    for skills in sources {
        for skill in skills {
            merged.insert(skill.name.clone(), skill);
        }
    }
    merged.into_values().collect()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn enabled_claude_plugins(config_dir: &Path, project: &Path) -> BTreeMap<String, bool> {
    let mut enabled = BTreeMap::new();
    for path in [
        config_dir.join("settings.json"),
        project.join(".claude/settings.json"),
        project.join(".claude/settings.local.json"),
    ] {
        let Some(settings) = read_json(&path) else {
            continue;
        };
        let Some(plugins) = settings.get("enabledPlugins").and_then(Value::as_object) else {
            continue;
        };
        for (name, value) in plugins {
            if let Some(value) = value.as_bool() {
                enabled.insert(name.clone(), value);
            }
        }
    }
    enabled
}

fn installed_plugin_path(config_dir: &Path, plugin_id: &str, project: &Path) -> Option<PathBuf> {
    let installed = read_json(&config_dir.join("plugins/installed_plugins.json"))?;
    let entries = installed.get("plugins")?.get(plugin_id)?;
    let entries = entries
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(entries));
    entries
        .iter()
        .filter_map(|entry| {
            let path = entry.get("installPath")?.as_str()?;
            let scope = entry.get("scope").and_then(Value::as_str).unwrap_or("user");
            let project_matches = entry
                .get("projectPath")
                .and_then(Value::as_str)
                .is_some_and(|value| Path::new(value) == project);
            let priority = match scope {
                "local" if project_matches => 3,
                "project" if project_matches => 2,
                "user" => 1,
                _ => 0,
            };
            Some((priority, PathBuf::from(path)))
        })
        .filter(|(_, path)| path.is_dir())
        .max_by_key(|(priority, _)| *priority)
        .map(|(_, path)| path)
}

fn claude_plugin_skills(config_dir: &Path, project: &Path) -> Vec<ClaudeSkill> {
    let mut skills = Vec::new();
    for (plugin_id, enabled) in enabled_claude_plugins(config_dir, project) {
        if !enabled {
            continue;
        }
        let Some(plugin_root) = installed_plugin_path(config_dir, &plugin_id, project) else {
            continue;
        };
        let plugin_name = plugin_id.split('@').next().unwrap_or(&plugin_id);
        skills.extend(skills_in(
            &plugin_root.join("skills"),
            "claudePlugin",
            "native",
            Some(plugin_name),
        ));
        let root_skill = plugin_root.join("SKILL.md");
        if let Ok(root_skill) = fs::canonicalize(root_skill) {
            if root_skill.starts_with(&plugin_root) && root_skill.is_file() {
                if let Some(skill) =
                    skill_from_file(&root_skill, plugin_name.into(), "claudePlugin", "native")
                {
                    skills.push(skill);
                }
            }
        }
    }
    skills
}

fn codex_config_dir(home_dir: &Path) -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join(".codex"))
}

fn newest_directory(root: &Path) -> Option<PathBuf> {
    fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .max_by_key(|entry| {
            entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH)
        })
        .map(|entry| entry.path())
}

fn codex_plugin_skills(codex_dir: &Path) -> Vec<ClaudeSkill> {
    let Ok(config) = fs::read_to_string(codex_dir.join("config.toml")) else {
        return Vec::new();
    };
    let Ok(config) = toml::from_str::<CodexConfig>(&config) else {
        return Vec::new();
    };
    let mut skills = Vec::new();
    for (plugin_id, plugin) in config.plugins {
        if !plugin.enabled {
            continue;
        }
        let Some((plugin_name, marketplace)) = plugin_id.split_once('@') else {
            continue;
        };
        let version_root = codex_dir
            .join("plugins/cache")
            .join(marketplace)
            .join(plugin_name);
        let Some(plugin_root) = newest_directory(&version_root) else {
            continue;
        };
        skills.extend(skills_in(
            &plugin_root.join("skills"),
            "codexPlugin",
            "external",
            Some(plugin_name),
        ));
    }
    skills
}

fn discover_skills(home_dir: &Path, project: &Path) -> Vec<ClaudeSkill> {
    let claude_dir = context::default_config_dir(home_dir.to_path_buf());
    let codex_dir = codex_config_dir(home_dir);
    let project_root = fs::canonicalize(project.join(".claude/skills"))
        .ok()
        .filter(|path| path.starts_with(project));
    let project_codex_root = fs::canonicalize(project.join(".agents/skills"))
        .ok()
        .filter(|path| path.starts_with(project));
    merge_skill_sources([
        codex_plugin_skills(&codex_dir),
        skills_in(&home_dir.join(".agents/skills"), "shared", "external", None),
        skills_in(&codex_dir.join("skills/.system"), "codex", "external", None),
        skills_in(&codex_dir.join("skills"), "codex", "external", None),
        claude_plugin_skills(&claude_dir, project),
        project_codex_root
            .as_deref()
            .map(|path| skills_in(path, "project", "external", None))
            .unwrap_or_default(),
        project_root
            .as_deref()
            .map(|path| skills_in(path, "project", "native", None))
            .unwrap_or_default(),
        skills_in(&claude_dir.join("skills"), "personal", "native", None),
    ])
}

#[tauri::command]
pub fn list_claude_skills(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<ClaudeSkill>, String> {
    let project = fs::canonicalize(&project_path).map_err(|error| error.to_string())?;
    if !project.is_dir() {
        return Err("The selected project directory no longer exists".into());
    }
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    Ok(discover_skills(&home_dir, &project))
}

pub fn resolve_external_skill(
    app: &AppHandle,
    project_path: &Path,
    candidate: &Path,
) -> Result<PathBuf, String> {
    let project = fs::canonicalize(project_path)
        .map_err(|_| "The selected project directory no longer exists")?;
    let candidate =
        fs::canonicalize(candidate).map_err(|_| "The selected skill no longer exists")?;
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    let listed = discover_skills(&home_dir, &project);
    let allowed = listed.iter().any(|skill| {
        skill.invocation == "external"
            && skill.path.as_deref().map(Path::new) == Some(candidate.as_path())
    });
    if !allowed {
        return Err("The selected external skill is not enabled".into());
    }
    candidate
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "The selected skill directory is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::{
        codex_plugin_skills, discover_skills, frontmatter, merge_skill_sources, skills_in,
        ClaudeSkill,
    };
    use std::fs;

    fn skill(name: &str, scope: &str) -> ClaudeSkill {
        ClaudeSkill {
            name: name.into(),
            description: scope.into(),
            scope: scope.into(),
            invocation: "native".into(),
            path: None,
        }
    }

    #[test]
    fn reads_skill_frontmatter() {
        let metadata = frontmatter(
            "---\ndescription: Review changes safely\nuser-invocable: false\n---\nInstructions",
        );
        assert_eq!(
            metadata.get("description").unwrap(),
            "Review changes safely"
        );
        assert_eq!(metadata.get("user-invocable").unwrap(), "false");
    }

    #[test]
    fn later_native_sources_keep_precedence() {
        let skills = merge_skill_sources([
            vec![skill("review", "project")],
            vec![skill("review", "personal")],
        ]);
        assert_eq!(skills, vec![skill("review", "personal")]);
    }

    #[test]
    fn lists_only_user_invocable_skill_files() {
        let root =
            std::env::temp_dir().join(format!("claude-desk-skills-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("visible")).unwrap();
        fs::create_dir_all(root.join("hidden")).unwrap();
        fs::write(
            root.join("visible/SKILL.md"),
            "---\ndescription: Visible skill\n---\n",
        )
        .unwrap();
        fs::write(
            root.join("hidden/SKILL.md"),
            "---\nuser-invocable: false\n---\n",
        )
        .unwrap();

        let skills = skills_in(&root, "personal", "native", None);
        assert_eq!(
            skills,
            vec![ClaudeSkill {
                name: "visible".into(),
                description: "Visible skill".into(),
                scope: "personal".into(),
                invocation: "native".into(),
                path: None,
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovers_codex_standalone_and_shared_skills() {
        let home = std::env::temp_dir().join(format!("claude-desk-home-{}", uuid::Uuid::new_v4()));
        let project = home.join("project");
        fs::create_dir_all(home.join(".codex/skills/review")).unwrap();
        fs::create_dir_all(home.join(".codex/skills/.system/skill-creator")).unwrap();
        fs::create_dir_all(home.join(".agents/skills/okr-agent")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            home.join(".codex/skills/review/SKILL.md"),
            "---\ndescription: Review\n---\n",
        )
        .unwrap();
        fs::write(
            home.join(".codex/skills/.system/skill-creator/SKILL.md"),
            "---\ndescription: Create skills\n---\n",
        )
        .unwrap();
        fs::write(
            home.join(".agents/skills/okr-agent/SKILL.md"),
            "---\ndescription: OKR\n---\n",
        )
        .unwrap();

        let skills = discover_skills(&home, &fs::canonicalize(&project).unwrap());
        assert!(skills
            .iter()
            .any(|skill| skill.name == "review" && skill.scope == "codex" && skill.path.is_some()));
        assert!(skills.iter().any(|skill| skill.name == "skill-creator"
            && skill.scope == "codex"
            && skill.path.is_some()));
        assert!(skills.iter().any(|skill| skill.name == "okr-agent"
            && skill.scope == "shared"
            && skill.path.is_some()));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn discovers_only_enabled_codex_plugin_skills_with_a_namespace() {
        let codex =
            std::env::temp_dir().join(format!("claude-desk-codex-{}", uuid::Uuid::new_v4()));
        let enabled = codex
            .join("plugins/cache/superpowers-marketplace/superpowers/1.0.0/skills/brainstorming");
        let disabled = codex.join("plugins/cache/other-marketplace/other/1.0.0/skills/hidden");
        fs::create_dir_all(&enabled).unwrap();
        fs::create_dir_all(&disabled).unwrap();
        fs::write(codex.join("config.toml"), "[plugins.\"superpowers@superpowers-marketplace\"]\nenabled = true\n\n[plugins.\"other@other-marketplace\"]\nenabled = false\n").unwrap();
        fs::write(
            enabled.join("SKILL.md"),
            "---\ndescription: Brainstorm\n---\n",
        )
        .unwrap();
        fs::write(disabled.join("SKILL.md"), "---\ndescription: Hidden\n---\n").unwrap();

        let skills = codex_plugin_skills(&codex);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "superpowers:brainstorming");
        assert_eq!(skills[0].scope, "codexPlugin");
        assert_eq!(skills[0].invocation, "external");
        fs::remove_dir_all(codex).unwrap();
    }

    #[test]
    fn discovers_enabled_claude_plugin_skills_from_the_installed_cache() {
        let home = std::env::temp_dir().join(format!("claude-desk-home-{}", uuid::Uuid::new_v4()));
        let project = home.join("project");
        let plugin = home.join(".claude/plugins/cache/superpowers-marketplace/superpowers/1.0.0");
        let skill_dir = plugin.join("skills/brainstorming");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: Brainstorm\n---\n",
        )
        .unwrap();
        fs::write(
            home.join(".claude/settings.json"),
            "{\"enabledPlugins\":{\"superpowers@superpowers-marketplace\":true}}",
        )
        .unwrap();
        fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            format!(
                "{{\"version\":2,\"plugins\":{{\"superpowers@superpowers-marketplace\":[{{\"scope\":\"user\",\"installPath\":{}}}]}}}}",
                serde_json::to_string(&plugin).unwrap()
            ),
        )
        .unwrap();

        let skills = discover_skills(&home, &fs::canonicalize(&project).unwrap());
        assert!(skills.iter().any(|skill| {
            skill.name == "superpowers:brainstorming"
                && skill.scope == "claudePlugin"
                && skill.invocation == "native"
                && skill.path.is_none()
        }));
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_skill_symlink_outside_its_declared_root() {
        let root = std::env::temp_dir().join(format!("claude-desk-root-{}", uuid::Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("claude-desk-outside-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("escaped")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("SKILL.md"), "---\ndescription: Secret\n---\n").unwrap();
        std::os::unix::fs::symlink(outside.join("SKILL.md"), root.join("escaped/SKILL.md"))
            .unwrap();

        assert!(skills_in(&root, "codex", "external", None).is_empty());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
