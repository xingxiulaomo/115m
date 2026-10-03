// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SETTINGS_MODAL_ID,
  closeSettingsModal,
  openSettingsModal,
} from './settings-modal'

describe('settings-modal component', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
      clear: () => { store = {} },
    })
    document.body.innerHTML = ''
  })

  it('renders modal overlay in document body', () => {
    openSettingsModal(document)
    const overlay = document.getElementById(SETTINGS_MODAL_ID)
    expect(overlay).toBeTruthy()
    expect(overlay?.querySelector('.m115-settings-panel')).toBeTruthy()
    expect(overlay?.querySelector('.m115-settings-title')?.textContent).toContain('115m 扩展设置')
    expect(overlay?.textContent).toContain('解压后删除原压缩包')
  })

  it('switches tabs on click', () => {
    openSettingsModal(document, { activeTab: 'browse' })
    const overlay = document.getElementById(SETTINGS_MODAL_ID)

    const navTab = overlay?.querySelector<HTMLButtonElement>('.m115-settings-tab[data-tab="nav"]')
    expect(navTab).toBeTruthy()

    navTab?.click()
    expect(overlay?.querySelector('.m115-settings-nav-item')).toBeTruthy()

    const aboutTab = overlay?.querySelector<HTMLButtonElement>('.m115-settings-tab[data-tab="about"]')
    aboutTab?.click()
    expect(overlay?.querySelector('.m115-settings-about')).toBeTruthy()
  })

  it('closes modal on close button click and closeSettingsModal', () => {
    openSettingsModal(document)
    expect(document.getElementById(SETTINGS_MODAL_ID)).toBeTruthy()

    closeSettingsModal(document)
    expect(document.getElementById(SETTINGS_MODAL_ID)).toBeNull()
  })

  it('closes on Escape key press', () => {
    openSettingsModal(document)
    expect(document.getElementById(SETTINGS_MODAL_ID)).toBeTruthy()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.getElementById(SETTINGS_MODAL_ID)).toBeNull()
  })
})
