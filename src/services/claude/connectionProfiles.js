function text(value) {
  return typeof value === 'string' ? value : ''
}

function id() {
  return globalThis.crypto?.randomUUID?.() || `connection-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createConnectionProfile(name, source = {}) {
  return {
    id: id(),
    name: text(name).trim() || 'Connection',
    baseUrl: text(source.baseUrl),
    token: text(source.token),
    model: text(source.model),
  }
}

function normalizeProfile(profile, fallbackName) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  return {
    id: text(profile.id).trim() || id(),
    name: text(profile.name).trim() || fallbackName,
    baseUrl: text(profile.baseUrl),
    token: text(profile.token),
    model: text(profile.model),
  }
}

function connectionFields(connection) {
  return {
    baseUrl: text(connection?.baseUrl),
    token: text(connection?.token),
    model: text(connection?.model),
  }
}

export function normalizeConnectionProfiles(settings, activeConnection, defaultName = 'Default connection') {
  const stored = Array.isArray(settings?.connectionProfiles)
    ? settings.connectionProfiles
      .map((profile, index) => normalizeProfile(profile, `${defaultName} ${index + 1}`))
      .filter(Boolean)
    : []
  const profiles = stored.length
    ? stored
    : [createConnectionProfile(defaultName, activeConnection)]
  const requestedId = text(settings?.activeConnectionProfileId)
  const activeId = profiles.some((profile) => profile.id === requestedId)
    ? requestedId
    : profiles[0].id

  // The active Claude settings file is the runtime source of truth. Merge it
  // back after manual JSON edits without touching the inactive saved profiles.
  const next = profiles.map((profile) => profile.id === activeId
    ? { ...profile, ...connectionFields(activeConnection) }
    : profile)
  return { profiles: next, activeId }
}

export function activeConnectionProfile(profiles, activeId) {
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || null
}

export function updateConnectionProfile(profiles, profileId, changes) {
  return profiles.map((profile) => profile.id === profileId ? { ...profile, ...changes, id: profile.id } : profile)
}

export function connectionProfileSettings(profiles, activeId) {
  const normalized = profiles
    .map((profile, index) => normalizeProfile(profile, `Connection ${index + 1}`))
    .filter(Boolean)
  if (!normalized.length) throw new Error('At least one Claude connection is required')
  const selected = normalized.some((profile) => profile.id === activeId) ? activeId : normalized[0].id
  return { connectionProfiles: normalized, activeConnectionProfileId: selected }
}
