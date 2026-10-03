import {
  DEFAULT_SIDEBAR_IDS,
  getSettings,
  updateSettings,
} from '../../shared/settings'

export const SETTINGS_MODAL_ID = 'm115-settings-modal'
export const EXTENSION_VERSION = globalThis.chrome?.runtime?.getManifest?.()?.version || '2.0.4'

export interface SidebarNavOption {
  id: string
  title: string
  icon: string
  defaultEnabled: boolean
}

const ICON_BASE = 'https://115.com/icons'

export const NAV_OPTIONS: SidebarNavOption[] = [
  { id: 'upload', title: '最近上传', icon: `${ICON_BASE}/storage/channel_recent_upload.svg`, defaultEnabled: true },
  { id: 'star', title: '星标文件', icon: `${ICON_BASE}/storage_starredfiles.svg`, defaultEnabled: true },
  { id: 'recyclebin', title: '回收站', icon: `${ICON_BASE}/storage_recyclebin.svg`, defaultEnabled: true },
  { id: 'clouddownload', title: '云下载', icon: `${ICON_BASE}/storage_clouddownload.svg`, defaultEnabled: false },
  { id: 'receive', title: '最近接收', icon: `${ICON_BASE}/storage/channel_recent_receive.svg`, defaultEnabled: false },
  { id: 'tags', title: '文件标签', icon: `${ICON_BASE}/storage_filetags.svg`, defaultEnabled: false },
  { id: 'share', title: '链接分享', icon: `${ICON_BASE}/storage/channel_link_share.svg`, defaultEnabled: false },
]

export interface SettingsModalOptions {
  activeTab?: 'nav' | 'browse' | 'about'
  onSidebarChange?: (enabledIds: Set<string>) => void
}

export function closeSettingsModal(doc: Document) {
  const existing = doc.getElementById(SETTINGS_MODAL_ID)
  if (!existing) return
  existing.remove()
}

/**
 * 打开 115m 全局设置弹窗
 */
export function openSettingsModal(doc: Document, options?: SettingsModalOptions) {
  closeSettingsModal(doc)

  const settings = getSettings()
  const enabledNavIds = new Set(settings.sidebarEnabledIds)
  let currentTab: 'nav' | 'browse' | 'about' = options?.activeTab || 'browse'

  const overlay = doc.createElement('div')
  overlay.id = SETTINGS_MODAL_ID
  overlay.className = 'm115-settings-overlay'

  const panel = doc.createElement('div')
  panel.className = 'm115-settings-panel'

  // 1. Header
  const header = doc.createElement('div')
  header.className = 'm115-settings-header'

  const titleGroup = doc.createElement('div')
  titleGroup.className = 'm115-settings-title-group'

  const title = doc.createElement('span')
  title.className = 'm115-settings-title'
  title.textContent = '115m 扩展设置'

  const badge = doc.createElement('span')
  badge.className = 'm115-settings-badge'
  badge.textContent = `v${EXTENSION_VERSION}`

  titleGroup.appendChild(title)
  titleGroup.appendChild(badge)

  const closeX = doc.createElement('button')
  closeX.type = 'button'
  closeX.className = 'm115-settings-close-btn'
  closeX.innerHTML = '&times;'
  closeX.title = '关闭'
  closeX.addEventListener('click', () => closeSettingsModal(doc))

  header.appendChild(titleGroup)
  header.appendChild(closeX)

  // 2. Tabs
  const tabsContainer = doc.createElement('div')
  tabsContainer.className = 'm115-settings-tabs'

  const tabs: Array<{ key: 'browse' | 'nav' | 'about', label: string, icon: string }> = [
    { key: 'browse', label: '浏览体验', icon: '🎬' },
    { key: 'nav', label: '左侧导航', icon: '📁' },
    { key: 'about', label: '关于扩展', icon: 'ℹ️' },
  ]

  const body = doc.createElement('div')
  body.className = 'm115-settings-body'

  const footer = doc.createElement('div')
  footer.className = 'm115-settings-footer'

  const renderPanes = () => {
    // 更新 Tab 选中高亮
    tabsContainer.querySelectorAll('.m115-settings-tab').forEach((tabEl) => {
      const key = (tabEl as HTMLElement).dataset.tab
      if (key === currentTab) tabEl.classList.add('is-active')
      else tabEl.classList.remove('is-active')
    })

    body.innerHTML = ''
    footer.innerHTML = ''

    if (currentTab === 'browse') {
      renderBrowsePane(body)
    }
    else if (currentTab === 'nav') {
      renderNavPane(body)
    }
    else if (currentTab === 'about') {
      renderAboutPane(body)
    }

    const leftActions = doc.createElement('div')
    leftActions.className = 'm115-settings-footer-left'
    if (currentTab === 'nav') {
      const resetBtn = doc.createElement('button')
      resetBtn.type = 'button'
      resetBtn.className = 'm115-settings-reset-btn'
      resetBtn.textContent = '恢复导航默认'
      resetBtn.addEventListener('click', () => {
        enabledNavIds.clear()
        DEFAULT_SIDEBAR_IDS.forEach(id => enabledNavIds.add(id))
        updateSettings({ sidebarEnabledIds: Array.from(enabledNavIds) })
        options?.onSidebarChange?.(enabledNavIds)
        renderPanes()
      })
      leftActions.appendChild(resetBtn)
    }
    footer.appendChild(leftActions)

    const doneBtn = doc.createElement('button')
    doneBtn.type = 'button'
    doneBtn.className = 'm115-settings-done-btn'
    doneBtn.textContent = '完成'
    doneBtn.addEventListener('click', () => closeSettingsModal(doc))
    footer.appendChild(doneBtn)
  }

  tabs.forEach((tab) => {
    const tabBtn = doc.createElement('button')
    tabBtn.type = 'button'
    tabBtn.className = 'm115-settings-tab'
    tabBtn.dataset.tab = tab.key
    tabBtn.innerHTML = `<span>${tab.icon}</span><span>${tab.label}</span>`
    tabBtn.addEventListener('click', () => {
      currentTab = tab.key
      renderPanes()
    })
    tabsContainer.appendChild(tabBtn)
  })

  // 渲染【浏览体验】面板
  const renderBrowsePane = (container: HTMLElement) => {
    const pane = doc.createElement('div')
    pane.className = 'm115-settings-pane'

    // 列表视频封面预览开关卡片
    const previewCard = doc.createElement('div')
    previewCard.className = 'm115-settings-card'

    const cardInfo = doc.createElement('div')
    cardInfo.className = 'm115-settings-card-info'

    const cardTitle = doc.createElement('div')
    cardTitle.className = 'm115-settings-card-title'
    cardTitle.textContent = '列表视频封面预览'

    const cardDesc = doc.createElement('div')
    cardDesc.className = 'm115-settings-card-desc'
    cardDesc.textContent = '在网盘文件列表与搜索页下方展示多帧截帧条（不影响播放器内进度条悬停预览）'

    cardInfo.appendChild(cardTitle)
    cardInfo.appendChild(cardDesc)

    const switchLabel = createToggleSwitch(
      doc,
      getSettings().enableVideoPreview,
      (checked) => {
        updateSettings({ enableVideoPreview: checked })
      },
    )

    previewCard.appendChild(cardInfo)
    previewCard.appendChild(switchLabel)
    pane.appendChild(previewCard)

    // 解压后自动删除原压缩包开关卡片
    const unarchiveDeleteCard = doc.createElement('div')
    unarchiveDeleteCard.className = 'm115-settings-card'

    const unarchiveDeleteInfo = doc.createElement('div')
    unarchiveDeleteInfo.className = 'm115-settings-card-info'

    const unarchiveDeleteTitle = doc.createElement('div')
    unarchiveDeleteTitle.className = 'm115-settings-card-title'
    unarchiveDeleteTitle.textContent = '解压后删除原压缩包'

    const unarchiveDeleteDesc = doc.createElement('div')
    unarchiveDeleteDesc.className = 'm115-settings-card-desc'
    unarchiveDeleteDesc.textContent = '云端解压成功后，自动将原压缩包移至回收站（仅解压完成才触发，失败或密码未解锁时不删除）'

    unarchiveDeleteInfo.appendChild(unarchiveDeleteTitle)
    unarchiveDeleteInfo.appendChild(unarchiveDeleteDesc)

    const unarchiveDeleteSwitch = createToggleSwitch(
      doc,
      getSettings().deleteArchiveAfterExtraction,
      (checked) => {
        updateSettings({ deleteArchiveAfterExtraction: checked })
      },
    )

    unarchiveDeleteCard.appendChild(unarchiveDeleteInfo)
    unarchiveDeleteCard.appendChild(unarchiveDeleteSwitch)
    pane.appendChild(unarchiveDeleteCard)

    container.appendChild(pane)
  }

  // 渲染【左侧导航】面板
  const renderNavPane = (container: HTMLElement) => {
    const pane = doc.createElement('div')
    pane.className = 'm115-settings-pane'

    NAV_OPTIONS.forEach((item) => {
      const row = doc.createElement('div')
      row.className = 'm115-settings-nav-item'

      const main = doc.createElement('div')
      main.className = 'm115-settings-nav-main'

      const icon = doc.createElement('i')
      icon.className = 'm115-settings-nav-icon'
      icon.style.backgroundImage = `url("${item.icon}")`

      const titleSpan = doc.createElement('span')
      titleSpan.className = 'm115-settings-nav-title'
      titleSpan.textContent = item.title

      main.appendChild(icon)
      main.appendChild(titleSpan)

      const switchLabel = createToggleSwitch(
        doc,
        enabledNavIds.has(item.id),
        (checked) => {
          if (checked) enabledNavIds.add(item.id)
          else enabledNavIds.delete(item.id)

          const list = Array.from(enabledNavIds)
          updateSettings({ sidebarEnabledIds: list })
          options?.onSidebarChange?.(enabledNavIds)
        },
      )

      row.appendChild(main)
      row.appendChild(switchLabel)
      pane.appendChild(row)
    })

    container.appendChild(pane)
  }

  // 渲染【关于】面板
  const renderAboutPane = (container: HTMLElement) => {
    const about = doc.createElement('div')
    about.className = 'm115-settings-about'

    const hero = doc.createElement('div')
    hero.className = 'm115-settings-about-hero'

    const name = doc.createElement('div')
    name.className = 'm115-settings-about-name'
    name.textContent = '115m 前端增强扩展'

    const sub = doc.createElement('div')
    sub.className = 'm115-settings-about-sub'
    sub.textContent = '为 115 网盘打造的现代化工业级流媒体播放与视觉盛宴套件'

    hero.appendChild(name)
    hero.appendChild(sub)

    const specs = doc.createElement('div')
    specs.className = 'm115-settings-about-specs'

    const specRows = [
      { label: '当前版本', value: `${EXTENSION_VERSION} (正式版)` },
      { label: '核心流媒体底座', value: 'Vidstack v1.15.6' },
      { label: '高清大图底座', value: 'PhotoSwipe v5' },
      { label: '开源许可证', value: 'GPL-3.0 License' },
      {
        label: '项目主页',
        html: '<a class="m115-settings-link" href="https://github.com/qh775885/115m" target="_blank" rel="noopener noreferrer">github.com/qh775885/115m</a>',
      },
    ]

    specRows.forEach((row) => {
      const r = doc.createElement('div')
      r.className = 'm115-settings-spec-row'
      const l = doc.createElement('span')
      l.className = 'm115-settings-spec-label'
      l.textContent = row.label
      const v = doc.createElement('span')
      v.className = 'm115-settings-spec-value'
      if (row.html) v.innerHTML = row.html
      else v.textContent = row.value || ''
      r.appendChild(l)
      r.appendChild(v)
      specs.appendChild(r)
    })

    about.appendChild(hero)
    about.appendChild(specs)
    container.appendChild(about)
  }

  // 键盘 ESC 监听
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeSettingsModal(doc)
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeSettingsModal(doc)
    }
  })

  // 绑定并初始渲染
  renderPanes()

  panel.appendChild(header)
  panel.appendChild(tabsContainer)
  panel.appendChild(body)
  panel.appendChild(footer)
  overlay.appendChild(panel)

  doc.body.appendChild(overlay)
  doc.addEventListener('keydown', handleKeyDown, { once: true })
}

/**
 * 创建现代化 Toggle Switch 开关组件
 */
function createToggleSwitch(
  doc: Document,
  initialChecked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const label = doc.createElement('label')
  label.className = 'm115-toggle-switch'

  const input = doc.createElement('input')
  input.type = 'checkbox'
  input.checked = initialChecked

  const slider = doc.createElement('span')
  slider.className = 'm115-toggle-slider'

  input.addEventListener('change', () => {
    onChange(input.checked)
  })

  label.appendChild(input)
  label.appendChild(slider)
  return label
}
