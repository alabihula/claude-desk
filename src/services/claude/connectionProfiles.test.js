import { describe, expect, it } from 'vitest'
import {
  activeConnectionProfile,
  connectionProfileSettings,
  createConnectionProfile,
  normalizeConnectionProfiles,
  updateConnectionProfile,
} from './connectionProfiles'

describe('Claude connection profiles', () => {
  it('migrates the current single connection into a named default profile', () => {
    const state = normalizeConnectionProfiles({}, {
      baseUrl: 'https://gateway.example.com', token: 'secret', model: 'provider-model', autoCompact: false,
    }, 'Default')

    expect(state.profiles).toHaveLength(1)
    expect(activeConnectionProfile(state.profiles, state.activeId)).toMatchObject({
      name: 'Default', baseUrl: 'https://gateway.example.com', token: 'secret', model: 'provider-model',
    })
    expect(activeConnectionProfile(state.profiles, state.activeId)).not.toHaveProperty('autoCompact')
  })

  it('keeps inactive credentials while reconciling manual JSON edits into the active profile', () => {
    const state = normalizeConnectionProfiles({
      activeConnectionProfileId: 'work',
      connectionProfiles: [
        { id: 'work', name: 'Work', baseUrl: 'https://old', token: 'old-token', model: 'old-model' },
        { id: 'backup', name: 'Backup', baseUrl: 'https://backup', token: 'backup-token', model: 'backup-model' },
      ],
    }, { baseUrl: 'https://new', token: 'new-token', model: 'new-model' })

    expect(activeConnectionProfile(state.profiles, state.activeId)).toMatchObject({
      id: 'work', name: 'Work', baseUrl: 'https://new', token: 'new-token', model: 'new-model',
    })
    expect(state.profiles[1]).toMatchObject({ id: 'backup', token: 'backup-token' })
  })

  it('updates and serializes profiles without allowing the id to change', () => {
    const profile = createConnectionProfile('Primary')
    const updated = updateConnectionProfile([profile], profile.id, { id: 'other', name: 'Renamed', token: 'secret' })
    expect(updated[0]).toMatchObject({ id: profile.id, name: 'Renamed', token: 'secret' })
    expect(connectionProfileSettings(updated, profile.id)).toEqual({
      connectionProfiles: updated,
      activeConnectionProfileId: profile.id,
    })
  })
})
