// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildListKey,
  extractCid,
  extractListParams,
  restoreScrollPosition,
  saveScrollPosition,
} from './scroll-history'

const ORIGINAL_SEARCH = window.location.search

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search: '' },
  })
})

afterEach(() => {
  sessionStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search: ORIGINAL_SEARCH },
  })
})

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { search },
  })
}

function makeScrollableBox() {
  const box = document.createElement('div')
  return box
}

describe('extractListParams', () => {
  it('parses cid, offset and tpl from search', () => {
    setSearch('?cid=123&offset=24&tpl=view_large')
    const doc = { defaultView: window } as unknown as Document
    expect(extractListParams(doc)).toEqual({ cid: '123', offset: '24', tpl: 'view_large' })
  })

  it('falls back to defaults when params missing', () => {
    setSearch('')
    const doc = { defaultView: window } as unknown as Document
    expect(extractListParams(doc)).toEqual({ cid: '0', offset: '0', tpl: '' })
  })

  it('extracts real cid from breadcrumb DOM when URL has no cid', () => {
    setSearch('')
    const doc = document.implementation.createHTMLDocument()
    const pathList = doc.createElement('div')
    pathList.id = 'js_path_list'
    pathList.innerHTML = `
      <a href="javascript:;" cid="0">全部文件</a>
      <a href="javascript:;" cid="100">父文件夹</a>
      <span class="cur" cid="200">当前子文件夹</span>
    `
    doc.body.appendChild(pathList)

    expect(extractCid(doc)).toBe('200')
    expect(extractListParams(doc).cid).toBe('200')
  })

  it('extracts cid from list items when breadcrumb is missing', () => {
    setSearch('')
    const doc = document.implementation.createHTMLDocument()
    const list = doc.createElement('div')
    list.className = 'list-contents'
    list.innerHTML = `
      <ul>
        <li rel="item" p_id="555" pick_code="abc">文件1</li>
      </ul>
    `
    doc.body.appendChild(list)

    expect(extractCid(doc)).toBe('555')
    expect(extractListParams(doc).cid).toBe('555')
  })
})

describe('buildListKey', () => {
  it('is stable regardless of list content', () => {
    setSearch('?cid=5&offset=0&tpl=view_large')
    const doc = { defaultView: window } as unknown as Document
    expect(buildListKey(doc)).toBe('5_0_view_large')
  })

  it('differs when cid changes', () => {
    const doc = { defaultView: window } as unknown as Document
    setSearch('?cid=1&offset=0&tpl=view_large')
    const keyA = buildListKey(doc)
    setSearch('?cid=2&offset=0&tpl=view_large')
    const keyB = buildListKey(doc)
    expect(keyA).not.toBe(keyB)
  })

  it('differs when offset changes', () => {
    const doc = { defaultView: window } as unknown as Document
    setSearch('?cid=1&offset=0&tpl=view_large')
    const keyA = buildListKey(doc)
    setSearch('?cid=1&offset=24&tpl=view_large')
    const keyB = buildListKey(doc)
    expect(keyA).not.toBe(keyB)
  })

  it('differs when view tpl changes', () => {
    const doc = { defaultView: window } as unknown as Document
    setSearch('?cid=1&offset=0&tpl=view_large')
    const keyA = buildListKey(doc)
    setSearch('?cid=1&offset=0&tpl=view_list')
    const keyB = buildListKey(doc)
    expect(keyA).not.toBe(keyB)
  })
})

describe('saveScrollPosition / restoreScrollPosition', () => {
  it('round-trips a saved position for the same active key', () => {
    saveScrollPosition('k', 300)
    const box = makeScrollableBox()
    const restored = restoreScrollPosition('k', box)
    expect(restored).toBe(true)
    expect(box.scrollTop).toBe(300)
  })

  it('resets scroll position to 0 when switching to a different key', () => {
    saveScrollPosition('folder_A', 300)
    const box = makeScrollableBox()
    box.scrollTop = 300

    // 切换到 folder_B
    const restored = restoreScrollPosition('folder_B', box)
    expect(restored).toBe(false)
    expect(box.scrollTop).toBe(0)
  })

  it('does not remember previous folders after switching (only active key is kept)', () => {
    saveScrollPosition('folder_A', 500)
    const box = makeScrollableBox()

    // 切换到 folder_B
    restoreScrollPosition('folder_B', box)
    expect(box.scrollTop).toBe(0)

    // 再次进入 folder_A 时也是作为新目录进入，重置为 0
    const restored = restoreScrollPosition('folder_A', box)
    expect(restored).toBe(false)
    expect(box.scrollTop).toBe(0)
  })

  it('ignores saving negative positions', () => {
    saveScrollPosition('k', -5)
    expect(sessionStorage.getItem('m115_active_scroll')).toBeNull()
  })

  it('does not restore when no record exists', () => {
    const box = makeScrollableBox()
    const restored = restoreScrollPosition('missing_key', box)
    expect(restored).toBe(false)
    expect(box.scrollTop).toBe(0)
  })
})
