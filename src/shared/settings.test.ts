import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_IDS,
  getSettings,
  subscribeSettings,
  updateSettings,
} from './settings'

describe('settings module', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }
    vi.stubGlobal('localStorage', mockLocalStorage)

    const emitter = new EventTarget()
    vi.stubGlobal('addEventListener', emitter.addEventListener.bind(emitter))
    vi.stubGlobal('removeEventListener', emitter.removeEventListener.bind(emitter))
    vi.stubGlobal('dispatchEvent', emitter.dispatchEvent.bind(emitter))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns default settings when storage is empty', () => {
    const settings = getSettings()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.enableVideoPreview).toBe(true)
    expect(settings.deleteArchiveAfterExtraction).toBe(false)
    expect(settings.sidebarEnabledIds).toEqual(DEFAULT_SIDEBAR_IDS)
  })

  it('migrates legacy sidebar settings if present', () => {
    store.m115_sidebar_enabled = JSON.stringify(['wangpan', 'star'])
    const settings = getSettings()
    expect(settings.sidebarEnabledIds).toEqual(['wangpan', 'star'])
    expect(settings.enableVideoPreview).toBe(true)
    expect(JSON.parse(store.m115_user_settings).sidebarEnabledIds).toEqual(['wangpan', 'star'])
  })

  it('updates settings and dispatches events', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSettings(listener)

    const updated = updateSettings({ enableVideoPreview: false, deleteArchiveAfterExtraction: true })
    expect(updated.enableVideoPreview).toBe(false)
    expect(updated.deleteArchiveAfterExtraction).toBe(true)
    expect(getSettings().enableVideoPreview).toBe(false)
    expect(getSettings().deleteArchiveAfterExtraction).toBe(true)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ enableVideoPreview: false, deleteArchiveAfterExtraction: true }),
    )

    unsubscribe()
  })
})
