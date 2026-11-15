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
})
