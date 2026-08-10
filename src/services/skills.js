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
