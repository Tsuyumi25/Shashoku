import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePreferencesStore } from './preferencesStore'

beforeEach(() => setActivePinia(createPinia()))

describe('noting a project as opened', () => {
  it('puts it first, and moves one opened before up rather than listing it twice', () => {
    const preferences = usePreferencesStore()
    preferences.noteRecentProject('/a')
    preferences.noteRecentProject('/b')
    preferences.noteRecentProject('/a')
    expect(preferences.prefs.recentProjects).toEqual(['/a', '/b'])
  })

  it('forgets the oldest past what it keeps', () => {
    const preferences = usePreferencesStore()
    for (let n = 0; n < 40; n++) preferences.noteRecentProject(`/p${n}`)
    expect(preferences.prefs.recentProjects).toHaveLength(30)
    expect(preferences.prefs.recentProjects[0]).toBe('/p39')
    expect(preferences.prefs.recentProjects.at(-1)).toBe('/p10')
  })
})
