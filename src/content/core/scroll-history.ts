/**
 * 文件列表滚动位置记忆
 *
 * 核心规则：
 * 1. 只记忆当前活动目录的滚动位置。
 * 2. 切换到任何其他文件夹时，强制重置滚动条在最顶部（scrollTop = 0）。
 * 3. 只有在当前同一个文件夹内（如重命名视频触发列表刷新、或原地刷新页面）时，才恢复之前滚动的位置。
 */

const ACTIVE_STORAGE_KEY = 'm115_active_scroll'
const LEGACY_STORAGE_KEY = 'm115_scroll_history'

// 清理旧版本遗留的多目录历史
try {
  sessionStorage.removeItem(LEGACY_STORAGE_KEY)
}
catch {
  // 忽略环境不支持
}

export interface ActiveScrollRecord {
  key: string
  scrollTop: number
}

export function getActiveScroll(): ActiveScrollRecord | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ActiveScrollRecord) : null
  }
  catch {
    return null
  }
}

export function setActiveScroll(key: string, scrollTop: number) {
  try {
    sessionStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify({ key, scrollTop }))
  }
  catch {
    // 忽略写入异常
  }
}

export function clearActiveScroll() {
  try {
    sessionStorage.removeItem(ACTIVE_STORAGE_KEY)
  }
  catch {
    // 忽略清理异常
  }
}

/**
 * 构建 key：cid + offset + tpl（视图类型）
 */
export function buildKey(cid: string, offset: string, tpl: string): string {
  return `${cid}_${offset}_${tpl}`
}

/**
 * 保存滚动位置（仅限当前活动 key）
 */
export function saveScrollPosition(key: string, scrollTop: number) {
  if (scrollTop < 0) return
  setActiveScroll(key, scrollTop)
}

/**
 * 恢复滚动位置（仅当同一目录时恢复，切目录时重置为 0）
 * @returns 是否成功恢复了非零位置
 */
export function restoreScrollPosition(key: string, scrollBox: Element): boolean {
  const active = getActiveScroll()
  if (active && active.key === key && active.scrollTop > 0) {
    scrollBox.scrollTop = active.scrollTop
    return true
  }
  scrollBox.scrollTop = 0
  setActiveScroll(key, 0)
  return false
}

/**
 * 从 document 或 URL 中多级提取真实的 cid
 * 优先级策略：
 * 1. 115 官方面包屑/路径栏 DOM（与界面当前实际呈现强同步）
 * 2. 115 列表已有项的父目录属性 (li[p_id] / li[parent_id])
 * 3. 115 官方 Core.FileConfig 全局变量
 * 4. iframe/顶级/父级窗口 URL 参数 (search 或 hash 中的 cid)
 */
export function extractCid(doc: Document): string {
  // 1. 尝试从 115 官方面包屑/路径栏 DOM 提取
  const pathSelectors = [
    '#js_path_list [cid]',
    '#js_path_list [cate_id]',
    '#js_path_list [data-cid]',
    '.path-list [cid]',
    '.path-list [cate_id]',
    '.file-path [cid]',
    '.file-path [cate_id]',
    '.path-cell [cid]',
    '.path-cell [cate_id]',
    '#js_category_box [cid]',
    '#js_category_box [cate_id]',
  ]

  for (const selector of pathSelectors) {
    const nodes = doc.querySelectorAll?.<HTMLElement>(selector)
    if (nodes && nodes.length > 0) {
      const activeNode = Array.from(nodes).reverse().find(el =>
        el.classList.contains('cur')
        || el.classList.contains('current')
        || el.classList.contains('active'),
      ) || nodes[nodes.length - 1]

      const cid = activeNode?.getAttribute('cid')
        || activeNode?.getAttribute('cate_id')
        || activeNode?.getAttribute('data-cid')
      if (cid && cid.trim() !== '') {
        return cid.trim()
      }
    }
  }

  // 2. 尝试从列表项的父目录属性提取（列表中所有文件的 p_id 均为当前所在目录）
  const itemWithPid = doc.querySelector?.<HTMLElement>(
    '.list-contents li[rel="item"][p_id], .list-contents li[rel="item"][parent_id], .list-thumb li[rel="item"][p_id], .list-thumb li[rel="item"][parent_id]',
  )
  if (itemWithPid) {
    const pid = itemWithPid.getAttribute('p_id') || itemWithPid.getAttribute('parent_id') || itemWithPid.getAttribute('pid')
    if (pid && pid.trim() !== '') {
      return pid.trim()
    }
  }

  // 3. 尝试从 115 页面 JS 全局变量提取
  try {
    const win = doc.defaultView as any
    if (win?.Core?.FileConfig) {
      const coreCid = win.Core.FileConfig.CurCid ?? win.Core.FileConfig.cid
      if (coreCid !== undefined && coreCid !== null && String(coreCid).trim() !== '') {
        return String(coreCid).trim()
      }
    }
  }
  catch {
    // 忽略异常
  }

  // 4. 从当前文档 location 以及顶层/父级窗口 location 提取
  const locCandidates = [
    doc.defaultView?.location,
    doc.defaultView?.top?.location,
    doc.defaultView?.parent?.location,
  ]

  for (const loc of locCandidates) {
    try {
      if (!loc) continue
      const searchParams = new URLSearchParams(loc.search ?? '')
      const cid = searchParams.get('cid')
      if (cid && cid.trim() !== '') return cid.trim()

      if (loc.hash) {
        const hashQuery = loc.hash.includes('?') ? loc.hash.slice(loc.hash.indexOf('?') + 1) : ''
        const hashParams = new URLSearchParams(hashQuery)
        const hashCid = hashParams.get('cid')
        if (hashCid && hashCid.trim() !== '') return hashCid.trim()
      }
    }
    catch {
      // 跨域或安全异常忽略
    }
  }

  return '0'
}

/**
 * 从 document 或 URL 中提取 cid、offset、tpl
 */
export function extractListParams(doc: Document): { cid: string, offset: string, tpl: string } {
  const cid = extractCid(doc)

  let tpl = ''
  if (doc.querySelector?.('.list-thumb')) {
    tpl = 'view_large'
  }
  else if (doc.querySelector?.('.list-contents')) {
    tpl = 'view_list'
  }

  let offset = '0'
  const locCandidates = [
    doc.defaultView?.location,
    doc.defaultView?.top?.location,
    doc.defaultView?.parent?.location,
  ]

  for (const loc of locCandidates) {
    try {
      if (!loc) continue
      const searchParams = new URLSearchParams(loc.search ?? '')
      const paramOffset = searchParams.get('offset')
      if (offset === '0' && paramOffset && paramOffset.trim() !== '') {
        offset = paramOffset.trim()
      }
      if (!tpl) {
        const paramTpl = searchParams.get('tpl')
        if (paramTpl && paramTpl.trim() !== '') {
          tpl = paramTpl.trim()
        }
      }
      if (offset !== '0' && tpl) break
    }
    catch {
      // ignore
    }
  }

  return { cid, offset, tpl }
}

export function buildListKey(doc: Document): string {
  const { cid, offset, tpl } = extractListParams(doc)
  return buildKey(cid, offset, tpl)
}

/**
 * 找到文件列表的滚动容器
 * 115 网盘有两种视图：列表视图(.list-contents) 和 网格视图(.list-thumb)
 */
export function findScrollBox(doc: Document): Element | null {
  const listCell = doc.querySelector('.list-cell')
  if (!listCell) return null
  return listCell.querySelector('.list-contents') ?? listCell.querySelector('.list-thumb') ?? null
}

/**
 * 简单节流：确保 fn 在 interval 间隔内最多执行一次（trailing 模式）
 */
function throttle(fn: () => void, interval: number): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    const now = Date.now()
    const remaining = interval - (now - last)
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      fn()
    }
    else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn()
      }, remaining)
    }
  }
}

/**
 * 滚动位置管理器
 */
export class ScrollPositionManager {
  private scrollBox: Element | null = null
  private doc: Document | null = null
  private handleScroll: (() => void) | null = null
  private key = ''
  private isRestoring = false
  private targetScrollTop = 0
  private resetLockTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 绑定滚动容器
   */
  bind(scrollBox: Element, doc: Document) {
    this.unbind()

    this.scrollBox = scrollBox
    this.doc = doc
    this.key = buildListKey(doc)

    const active = getActiveScroll()
    if (active && active.key === this.key && active.scrollTop > 0) {
      this.targetScrollTop = active.scrollTop
      this.tryApplyScroll(active.scrollTop)
    }
    else {
      // 切换到了新文件夹或新页面：重置位置为最顶部 0
      this.resetToTop()
    }

    this.handleScroll = throttle(() => {
      if (!this.scrollBox || !this.key || this.isRestoring) return
      const currentKey = this.doc ? buildListKey(this.doc) : this.key
      if (currentKey !== this.key) {
        this.key = currentKey
        this.resetToTop()
        return
      }

      const st = this.scrollBox.scrollTop
      if (st > 0) {
        this.targetScrollTop = st
        setActiveScroll(this.key, st)
      }
      else if (this.scrollBox.scrollHeight > this.scrollBox.clientHeight + 10) {
        // 仅在容器高度充足且用户确实滚到顶部时记录 0，避免 DOM 坍塌过程误记 0
        this.targetScrollTop = 0
        setActiveScroll(this.key, 0)
      }
    }, 150)

    scrollBox.addEventListener('scroll', this.handleScroll, { passive: true })
  }

  /**
   * 外部强制重置为顶部（用于用户点击面包屑导航离开当前目录时快速重置）
   */
  forceResetToTop() {
    this.key = ''
    this.resetToTop()
  }

  private resetToTop() {
    if (!this.scrollBox) return
    this.targetScrollTop = 0
    this.isRestoring = true
    this.scrollBox.scrollTop = 0
    if (this.key) {
      setActiveScroll(this.key, 0)
    }

    if (this.resetLockTimer) {
      clearTimeout(this.resetLockTimer)
    }

    // 强化重置锁：在随后的 300ms 窗口与后续帧持续保持 scrollTop = 0，防 115 异步重绘或旧滚动残留
    this.resetLockTimer = setTimeout(() => {
      this.isRestoring = false
      this.resetLockTimer = null
    }, 300)

    window.requestAnimationFrame(() => {
      if (!this.scrollBox || this.targetScrollTop !== 0) return
      this.scrollBox.scrollTop = 0
      window.requestAnimationFrame(() => {
        if (!this.scrollBox || this.targetScrollTop !== 0) return
        this.scrollBox.scrollTop = 0
      })
    })
  }

  /**
   * 当列表发生变化（如重命名后刷新渲染）时检查并恢复
   */
  checkAndRestore() {
    if (!this.scrollBox || !this.doc) return
    const currentKey = buildListKey(this.doc)
    if (currentKey !== this.key) {
      this.key = currentKey
      this.resetToTop()
      return
    }

    const active = getActiveScroll()
    if (active && active.key === this.key && active.scrollTop > 0) {
      this.targetScrollTop = active.scrollTop
      if (this.scrollBox.scrollTop !== active.scrollTop) {
        this.tryApplyScroll(active.scrollTop)
      }
    }
  }

  private tryApplyScroll(top: number) {
    if (!this.scrollBox) return
    this.isRestoring = true
    this.scrollBox.scrollTop = top

    // 容器若尚未撑开，在下一帧再次尝试
    if (top > 0 && this.scrollBox.scrollTop < top) {
      window.requestAnimationFrame(() => {
        if (!this.scrollBox || this.targetScrollTop !== top) return
        this.scrollBox.scrollTop = top
        window.setTimeout(() => {
          this.isRestoring = false
        }, 50)
      })
    }
    else {
      window.requestAnimationFrame(() => {
        this.isRestoring = false
      })
    }
  }

  matches(scrollBox: Element, doc: Document): boolean {
    return this.scrollBox === scrollBox && this.key === buildListKey(doc)
  }

  /**
   * 解绑
   */
  unbind() {
    if (this.scrollBox && this.handleScroll) {
      this.scrollBox.removeEventListener('scroll', this.handleScroll)
    }
    this.scrollBox = null
    this.doc = null
    this.handleScroll = null
    this.key = ''
    this.targetScrollTop = 0
    this.isRestoring = false
    if (this.resetLockTimer) {
      clearTimeout(this.resetLockTimer)
      this.resetLockTimer = null
    }
  }
}

