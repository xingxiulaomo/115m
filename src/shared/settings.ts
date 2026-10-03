export interface M115Settings {
  /** 左侧导航栏启用的项 ID */
  sidebarEnabledIds: string[]
  /** 网盘列表与搜索结果页视频多帧封面预览开关 */
  enableVideoPreview: boolean
  /** 解压成功确认后，自动删除原压缩包（移至回收站） */
  deleteArchiveAfterExtraction: boolean
}

export const DEFAULT_SIDEBAR_IDS = ['wangpan', 'upload', 'star', 'recyclebin']

export const DEFAULT_SETTINGS: M115Settings = {
  sidebarEnabledIds: DEFAULT_SIDEBAR_IDS,
  enableVideoPreview: true,
  deleteArchiveAfterExtraction: false,
}

const SETTINGS_STORAGE_KEY = 'm115_user_settings'
const LEGACY_SIDEBAR_KEY = 'm115_sidebar_enabled'
const SETTINGS_CHANGE_EVENT = 'm115:settings-change'

function getStorage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null
  }
  catch {
    return null
  }
}

function getEventTarget(): EventTarget | null {
  if (typeof window !== 'undefined') return window
  if (typeof globalThis !== 'undefined' && typeof globalThis.dispatchEvent === 'function') {
    return globalThis as unknown as EventTarget
  }
  return null
}

/**
 * 获取当前全局设置（包含旧版本迁移与默认值保底）
 */
export function getSettings(): M115Settings {
  const storage = getStorage()
  if (!storage) return { ...DEFAULT_SETTINGS }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<M115Settings>
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        sidebarEnabledIds: Array.isArray(parsed?.sidebarEnabledIds)
          ? parsed.sidebarEnabledIds
          : [...DEFAULT_SETTINGS.sidebarEnabledIds],
        enableVideoPreview: typeof parsed?.enableVideoPreview === 'boolean'
          ? parsed.enableVideoPreview
          : DEFAULT_SETTINGS.enableVideoPreview,
        deleteArchiveAfterExtraction: typeof parsed?.deleteArchiveAfterExtraction === 'boolean'
          ? parsed.deleteArchiveAfterExtraction
          : DEFAULT_SETTINGS.deleteArchiveAfterExtraction,
      }
    }

    // 尝试迁移旧侧边栏配置
    const legacySidebar = storage.getItem(LEGACY_SIDEBAR_KEY)
    if (legacySidebar) {
      const parsedLegacy = JSON.parse(legacySidebar) as string[]
      if (Array.isArray(parsedLegacy)) {
        const migrated: M115Settings = {
          ...DEFAULT_SETTINGS,
          sidebarEnabledIds: parsedLegacy,
        }
        storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      }
    }
  }
  catch {
    // 忽略异常，降级回默认
  }

  return { ...DEFAULT_SETTINGS }
}

/**
 * 更新全局设置
 */
export function updateSettings(partial: Partial<M115Settings>): M115Settings {
  const current = getSettings()
  const next: M115Settings = {
    ...current,
    ...partial,
  }

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
      // 同时同步更新旧侧边栏 key，兼容老代码/不同版本
      if (partial.sidebarEnabledIds) {
        storage.setItem(LEGACY_SIDEBAR_KEY, JSON.stringify(next.sidebarEnabledIds))
      }
    }
    catch {
      // ignore
    }
  }

  const target = getEventTarget()
  if (target && typeof target.dispatchEvent === 'function') {
    try {
      target.dispatchEvent(new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: next }))
    }
    catch {
      // ignore
    }
  }

  return next
}

/**
 * 监听设置变更（支持同页 CustomEvent 与跨标签页 storage 事件）
 */
export function subscribeSettings(callback: (settings: M115Settings) => void): () => void {
  const target = getEventTarget()
  if (!target) return () => {}

  const handleCustomEvent = (event: Event) => {
    const custom = event as CustomEvent<M115Settings>
    if (custom.detail) {
      callback(custom.detail)
    }
    else {
      callback(getSettings())
    }
  }

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY || event.key === LEGACY_SIDEBAR_KEY) {
      callback(getSettings())
    }
  }

  target.addEventListener(SETTINGS_CHANGE_EVENT, handleCustomEvent as EventListener)
  target.addEventListener('storage', handleStorageEvent as EventListener)

  return () => {
    target.removeEventListener(SETTINGS_CHANGE_EVENT, handleCustomEvent as EventListener)
    target.removeEventListener('storage', handleStorageEvent as EventListener)
  }
}
