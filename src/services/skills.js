export function slashSkillQuery(value) {
  const match = /^\/([^\s]*)$/.exec(String(value || ''))
  return match ? match[1].toLocaleLowerCase() : null
}

export function matchingSkills(skills, query) {
  const needle = String(query || '').toLocaleLowerCase()
  return [...skills]
    .filter((skill) => !needle || `${skill.name} ${skill.description || ''}`.toLocaleLowerCase().includes(needle))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function selectedSkillInput(skill) {
  if (!skill) return { text: '', skill: null }
  return {
    text: `/${skill.name} `,
    skill: skill.invocation === 'external' ? { name: skill.name, path: skill.path } : null,
  }
}

export function externalSkillPrompt(content, skill) {
  if (!skill?.path) return content
  const request = content.trim().replace(new RegExp(`^/${escapeRegExp(skill.name)}(?:\\s+|$)`), '').trim()
  return [
    `Use the reusable skill instructions in this local SKILL.md file: ${JSON.stringify(skill.path)}`,
    'Read that file completely before acting. Resolve its relative references from the directory containing SKILL.md. Follow it when compatible with Claude Code and the user request; if it depends on Codex-only tools that are unavailable, explain the limitation and use the closest safe Claude capability.',
    request ? `User request: ${request}` : 'Apply the skill to the current user request.',
  ].join('\n\n')
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
