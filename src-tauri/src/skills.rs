use crate::context;
use serde::Serialize;
use std::{collections::BTreeMap, fs, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSkill {
    pub name: String,
    pub description: String,
    pub scope: String,
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

fn skills_in(root: &Path, scope: &str) -> Vec<ClaudeSkill> {
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
            if fs::metadata(&skill_file).ok()?.len() > 256 * 1024 {
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
            let name = entry.file_name().to_string_lossy().trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(ClaudeSkill {
                name,
                description: metadata.get("description").cloned().unwrap_or_default(),
                scope: scope.into(),
            })
        })
        .collect()
}

pub fn merge_skills(project: Vec<ClaudeSkill>, personal: Vec<ClaudeSkill>) -> Vec<ClaudeSkill> {
    let mut merged = BTreeMap::new();
    for skill in project.into_iter().chain(personal) {
        merged.insert(skill.name.clone(), skill);
    }
    merged.into_values().collect()
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
    let personal_root = context::default_config_dir(home_dir).join("skills");
    let project_root = fs::canonicalize(project.join(".claude/skills"))
        .ok()
        .filter(|path| path.starts_with(&project));
    Ok(merge_skills(
        project_root
            .as_deref()
            .map(|path| skills_in(path, "project"))
            .unwrap_or_default(),
        skills_in(&personal_root, "personal"),
    ))
}

#[cfg(test)]
mod tests {
    use super::{frontmatter, merge_skills, skills_in, ClaudeSkill};
    use std::fs;

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
    fn gives_personal_skills_precedence_over_project_skills() {
        let project = ClaudeSkill {
            name: "review".into(),
            description: "Project".into(),
            scope: "project".into(),
        };
        let personal = ClaudeSkill {
            name: "review".into(),
            description: "Personal".into(),
            scope: "personal".into(),
        };
        let skills = merge_skills(vec![project], vec![personal]);
        assert_eq!(
            skills,
            vec![ClaudeSkill {
                name: "review".into(),
                description: "Personal".into(),
                scope: "personal".into()
            }]
        );
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

        assert_eq!(
            skills_in(&root, "personal"),
            vec![ClaudeSkill {
                name: "visible".into(),
                description: "Visible skill".into(),
                scope: "personal".into()
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }
}
