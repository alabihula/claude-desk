import { describe, expect, it } from 'vitest'
import { externalSkillPrompt, matchingSkills, selectedSkillInput, slashSkillQuery } from './skills'

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

  it('ranks a built-in command name ahead of external description matches', () => {
    const skills = [
      { name: 'aliyun-observability', description: 'Configure an MCP endpoint', scope: 'codex' },
      { name: 'mcp', description: 'Show configured MCP servers', scope: 'builtIn' },
      { name: 'my-command', description: 'Run a command', scope: 'codex' },
    ]
    expect(matchingSkills(skills, 'm').map((skill) => skill.name)).toEqual([
      'mcp',
      'my-command',
      'aliyun-observability',
    ])
  })

  it('keeps native skills as slash commands and binds external skills to their file', () => {
    expect(selectedSkillInput({ name: 'review', invocation: 'native' })).toEqual({ text: '/review ', skill: null })
    expect(selectedSkillInput({ name: 'superpowers:brainstorm', invocation: 'external', path: '/tmp/SKILL.md' })).toEqual({
      text: '/superpowers:brainstorm ',
      skill: { name: 'superpowers:brainstorm', path: '/tmp/SKILL.md' },
    })
  })

  it('turns an external skill selection into an explicit skill-file request', () => {
    const prompt = externalSkillPrompt('/superpowers:brainstorm 设计一个方案', {
      name: 'superpowers:brainstorm',
      path: '/tmp/superpowers/skills/brainstorm/SKILL.md',
    })
    expect(prompt).toContain('/tmp/superpowers/skills/brainstorm/SKILL.md')
    expect(prompt).toContain('User request: 设计一个方案')
    expect(prompt).not.toContain('/superpowers:brainstorm 设计一个方案')
  })

})
