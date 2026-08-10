import { describe, expect, it } from 'vitest'
import { matchingSkills, slashSkillQuery } from './skills'

describe('slash skills', () => {
  it('opens only for a standalone slash command prefix', () => {
    expect(slashSkillQuery('')).toBeNull()
    expect(slashSkillQuery('/')).toBe('')
    expect(slashSkillQuery('/review')).toBe('review')
    expect(slashSkillQuery('/review latest changes')).toBeNull()
    expect(slashSkillQuery('path /review')).toBeNull()
  })

  it('filters by skill name and description', () => {
    const skills = [
      { name: 'review', description: 'Review changed files' },
      { name: 'deploy', description: 'Release the application' },
    ]
    expect(matchingSkills(skills, 'changed').map((skill) => skill.name)).toEqual(['review'])
    expect(matchingSkills(skills, 'de').map((skill) => skill.name)).toEqual(['deploy'])
  })
})
