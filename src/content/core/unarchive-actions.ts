import type { FileInfo } from './types'
import { wait } from '../../shared/utils'
import { isRuntimeContextInvalidatedResult, sendRuntimeMessageSafe } from './runtime'
import { isArchiveFileName, isSecondaryVolume, stripArchiveExtension } from '../../shared/archive'
import { getItemPickCode, getItemTitle, getSelectedItems } from './native-dom'
import { WEB_API_URL } from '../../lib/constants'
import { getSettings } from '../../shared/settings'

const MAX_PROGRESS_CHECKS = 120
const PROGRESS_DELAY_MS = 1500
export const MAX_BATCH_UNARCHIVE_FILES = 20
const BATCH_INTERVAL_MS = 600
let batchRunning = false

type MainWorldResponse = { ok?: boolean, text?: string, error?: string, status?: number } | null

type ExtractEntry = {
  file_name?: string
  ico?: string
  file_category?: number
}

type UnarchiveResult = {
  ok: boolean
  fileName: string
  message: string
}

async function requestJson<T>(url: string, body?: URLSearchParams): Promise<T> {
  const res = await sendRuntimeMessageSafe<MainWorldResponse>({
    type: body ? 'MAIN_WORLD_FETCH' : 'MAIN_WORLD_GET',
    data: body ? { url, body: body.toString() } : { url },
  })

  if (isRuntimeContextInvalidatedResult(res)) throw new Error('扩展已更新，请刷新页面后继续使用')
  if (!res?.ok) throw new Error(res?.error || `接口请求失败${res?.status ? `(${res.status})` : ''}`)
  if (!res.text) throw new Error('接口返回为空')

  const json = JSON.parse(res.text)
  if (json?.state === false) throw new Error(json.message || json.error || `接口失败${json.code ? `(${json.code})` : ''}`)
  return json as T
}

function getCurrentCid(file: FileInfo): string {
  return file.parentId || new URLSearchParams(location.search).get('cid') || '0'
}

async function listFolders(parentCid: string): Promise<Set<string>> {
  const params = new URLSearchParams({
    aid: '1',
    cid: parentCid,
    offset: '0',
    limit: '1150',
    show_dir: '1',
    nf: '',
    qid: '0',
    type: '0',
    source: '',
    format: 'json',
    star: '',
    is_q: '',
    is_share: '',
    r_all: '1',
    o: 'file_name',
    asc: '1',
    cur: '1',
    natsort: '1',
  })
  const json = await requestJson<{ data?: Array<{ n?: string }> }>(`${WEB_API_URL}/files?${params}`)
  return new Set((json.data || []).map(item => item.n || '').filter(Boolean))
}

async function createUniqueFolder(parentCid: string, baseName: string) {
  const existing = await listFolders(parentCid)
  let name = baseName
  let index = 1
  while (existing.has(name)) {
    name = `${baseName} (${index})`
    index += 1
  }

  const body = new URLSearchParams({ pid: parentCid, cname: name })
  const json = await requestJson<{ cid?: string, file_id?: string, file_name?: string }>(`${WEB_API_URL}/files/add`, body)
  const cid = json.cid || json.file_id
  if (!cid) throw new Error('创建文件夹失败')
  return { cid, name }
}

async function deleteEmptyFolder(parentCid: string, folderCid: string) {
  const params = new URLSearchParams({
    aid: '1',
    cid: folderCid,
    offset: '0',
    limit: '2',
    show_dir: '1',
    format: 'json',
  })
  const list = await requestJson<{ count?: number, data?: unknown[] }>(`${WEB_API_URL}/files?${params}`)
  if ((list.count || list.data?.length || 0) > 0) return

  const body = new URLSearchParams({ pid: parentCid })
  body.append('fid[0]', folderCid)
  await requestJson(`${WEB_API_URL}/rb/delete`, body)
}

async function readArchiveEntries(pickCode: string): Promise<ExtractEntry[]> {
  const params = new URLSearchParams({
    pick_code: pickCode,
    file_name: '',
    paths: '文件',
    page_count: '999',
  })
  const json = await requestJson<{ data?: { list?: ExtractEntry[] } }>(`${WEB_API_URL}/files/extract_info?${params}`)
  const list = json.data?.list || []
  if (!list.length) throw new Error('压缩包内容为空或无法读取')
  return list
}

async function unlockArchiveIfNeeded(file: FileInfo, error: unknown) {
  const password = prompt(`${file.fileName}\n可能需要解压密码，请输入密码后重试。`)
  if (!password) throw error instanceof Error ? error : new Error(String(error))

  const body = new URLSearchParams({ pick_code: file.pickCode, secret: password })
  await requestJson(`${WEB_API_URL}/files/push_extract`, body)

  for (let i = 0; i < MAX_PROGRESS_CHECKS; i++) {
    const json = await requestJson<{ data?: { extract_status?: { unzip_status?: number, progress?: number } } }>(`${WEB_API_URL}/files/push_extract?pick_code=${encodeURIComponent(file.pickCode)}`)
    const status = json.data?.extract_status?.unzip_status
    const progress = json.data?.extract_status?.progress || 0
    if (status === 4 || progress >= 100) return
    await wait(PROGRESS_DELAY_MS)
  }

  throw new Error('密码验证超时，请稍后重试')
}

async function readEntriesWithPasswordSupport(file: FileInfo, allowPasswordPrompt = true): Promise<ExtractEntry[]> {
  try {
    return await readArchiveEntries(file.pickCode)
  }
  catch (error) {
    if (!allowPasswordPrompt) throw new Error('需要密码，批量解压已跳过', { cause: error })
    await unlockArchiveIfNeeded(file, error)
    return await readArchiveEntries(file.pickCode)
  }
}

async function submitExtract(file: FileInfo, targetCid: string, entries: ExtractEntry[]) {
  const body = new URLSearchParams()
  body.set('pick_code', file.pickCode)
  body.set('to_pid', targetCid)
  body.set('paths', '文件')

  for (const entry of entries) {
    const name = entry.file_name || ''
    if (!name) continue
    const isDir = entry.ico === 'folder' || entry.file_category === 0
    body.append(isDir ? 'extract_dir[]' : 'extract_file[]', name)
  }

  const json = await requestJson<{ data?: { extract_id?: number | string } }>(`${WEB_API_URL}/files/add_extract_file`, body)
  const extractId = json.data?.extract_id
  if (!extractId) throw new Error('提交解压任务失败')
  return String(extractId)
}

export async function resolveArchiveFileId(file: FileInfo, parentCid: string): Promise<string | undefined> {
  if (file.fileId) return file.fileId
  try {
    const params = new URLSearchParams({
      aid: '1',
      cid: parentCid,
      offset: '0',
      limit: '1150',
      show_dir: '0',
      format: 'json',
    })
    const json = await requestJson<{ data?: Array<{ pc?: string, fid?: string, file_id?: string }> }>(`${WEB_API_URL}/files?${params}`)
    const match = (json.data || []).find(entry => entry.pc === file.pickCode)
    return match?.fid || match?.file_id
  }
  catch {
    return undefined
  }
}

async function deleteArchiveFile(parentCid: string, fileId: string) {
  const body = new URLSearchParams({ pid: parentCid })
  body.append('fid[0]', fileId)
  await requestJson(`${WEB_API_URL}/rb/delete`, body)
}

async function waitExtractDone(extractId: string, onProgress?: (percent: number) => void): Promise<{ done: boolean, message: string }> {
  for (let i = 0; i < MAX_PROGRESS_CHECKS; i++) {
    const json = await requestJson<{ data?: { percent?: number } }>(`${WEB_API_URL}/files/add_extract_file?extract_id=${encodeURIComponent(extractId)}`)
    const percent = json.data?.percent || 0
    onProgress?.(percent)
    if (percent >= 100) return { done: true, message: '解压完成' }
    await wait(PROGRESS_DELAY_MS)
  }
  return { done: false, message: '任务已提交，仍在后台解压，请稍后刷新查看' }
}

async function unarchiveOne(file: FileInfo, onProgress?: (percent: number) => void, allowPasswordPrompt = true): Promise<UnarchiveResult> {
  if (!isArchiveFileName(file.fileName)) return { ok: false, fileName: file.fileName, message: '不是压缩包' }
  if (isSecondaryVolume(file.fileName)) return { ok: false, fileName: file.fileName, message: '疑似分卷文件，已跳过' }

  const parentCid = getCurrentCid(file)
  const folder = await createUniqueFolder(parentCid, stripArchiveExtension(file.fileName))

  try {
    const entries = await readEntriesWithPasswordSupport(file, allowPasswordPrompt)
    const extractId = await submitExtract(file, folder.cid, entries)
    const { done, message } = await waitExtractDone(extractId, onProgress)

    if (done && getSettings().deleteArchiveAfterExtraction) {
      try {
        const fileId = await resolveArchiveFileId(file, parentCid)
        if (fileId) {
          await deleteArchiveFile(parentCid, fileId)
          return { ok: true, fileName: file.fileName, message: `${message}，原压缩包已移入回收站` }
        }
      }
      catch (delError) {
        console.warn('[115m] 删除原压缩包失败:', delError)
        return { ok: true, fileName: file.fileName, message: `${message}（原压缩包删除失败）` }
      }
    }

    return { ok: true, fileName: file.fileName, message }
  }
  catch (error) {
    try {
      await deleteEmptyFolder(parentCid, folder.cid)
    }
    catch {
      throw error
    }
    throw error
  }
}

function showToast(doc: Document, text: string, timeout = 5000) {
  let toast = doc.getElementById('m115-unarchive-toast')
  if (!toast) {
    toast = doc.createElement('div')
    toast.id = 'm115-unarchive-toast'
    toast.innerHTML = '<div class="m115-unarchive-toast-mark">↯</div><div class="m115-unarchive-toast-content"><div class="m115-unarchive-toast-body"></div></div>'
    doc.body.appendChild(toast)
  }
  const body = toast.querySelector<HTMLElement>('.m115-unarchive-toast-body')
  if (body) body.textContent = text
  else toast.textContent = text
  toast.className = 'm115-unarchive-toast show'
  const timer = Number(toast.getAttribute('data-timer') || '0')
  if (timer) window.clearTimeout(timer)
  if (timeout > 0) {
    const nextTimer = window.setTimeout(() => toast?.classList.remove('show'), timeout)
    toast.setAttribute('data-timer', String(nextTimer))
  }
  else {
    toast.removeAttribute('data-timer')
  }
}

function collectSelectedArchiveFiles(doc: Document): FileInfo[] {
  return getSelectedItems(doc).map((item) => {
    return {
      pickCode: getItemPickCode(item),
      fileName: getItemTitle(item),
      duration: 0,
      isVideo: false,
      fileId: item.getAttribute('file_id') || item.getAttribute('fid') || item.getAttribute('fileid') || undefined,
      parentId: item.getAttribute('cid') || item.getAttribute('p_id') || undefined,
    }
  }).filter(file => file.pickCode && isArchiveFileName(file.fileName))
}

function updateBatchButtonVisibility(doc: Document) {
  const btn = doc.getElementById('m115-batch-unarchive-btn') as HTMLElement | null
  if (!btn) return
  btn.style.display = collectSelectedArchiveFiles(doc).length ? '' : 'none'
}

async function runBatch(doc: Document, files: FileInfo[]) {
  if (batchRunning) {
    showToast(doc, '已有批量解压任务正在运行', 3000)
    return
  }

  batchRunning = true
  const results: UnarchiveResult[] = []
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      showToast(doc, `正在解压 ${i + 1}/${files.length}：${file.fileName}`, 0)
      try {
        results.push(await unarchiveOne(file, percent => showToast(doc, `正在解压 ${i + 1}/${files.length}：${file.fileName}\n状态：${formatExtractStatus(percent)}`, 0), false))
      }
      catch (error) {
        results.push({ ok: false, fileName: file.fileName, message: error instanceof Error ? error.message : String(error) })
      }
      if (i < files.length - 1) {
        await wait(BATCH_INTERVAL_MS)
      }
    }

    const success = results.filter(item => item.ok).length
    const failed = results.length - success
    const detail = failed ? `\n失败：${results.filter(item => !item.ok).map(item => `${item.fileName}：${item.message}`).join('\n')}` : ''
    const refreshed = success > 0 && await refreshNativeList(doc)
    showToast(doc, `解压完成：成功 ${success} 个，失败 ${failed} 个${detail}\n${refreshed ? '列表已刷新。' : '请刷新页面查看新文件夹。'}`, 3000)
  }
  finally {
    batchRunning = false
  }
}

function injectBatchButton(doc: Document) {
  const existing = doc.getElementById('m115-batch-unarchive-btn')
  if (existing) {
    updateBatchButtonVisibility(doc)
    return
  }
  const toolbar = doc.querySelector<HTMLElement>('#js_operate_box ul')
  if (!toolbar) return

  const btn = doc.createElement('li')
  btn.id = 'm115-batch-unarchive-btn'
  btn.setAttribute('menu', 'm115_batch_unarchive')
  btn.className = 'm115-batch-unarchive-btn'
  btn.innerHTML = '<i></i><span>批量解压</span>'
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const files = collectSelectedArchiveFiles(doc)
    if (!files.length) {
      updateBatchButtonVisibility(doc)
      return
    }
    if (files.length > MAX_BATCH_UNARCHIVE_FILES) {
      showToast(doc, `一次最多解压 ${MAX_BATCH_UNARCHIVE_FILES} 个压缩包，请减少选择数量`, 4000)
      return
    }
    if (batchRunning) {
      showToast(doc, '已有批量解压任务正在运行', 3000)
      return
    }
    if (!confirm(`将解压 ${files.length} 个压缩包，并分别创建同名文件夹。该操作会持续请求 115 接口，是否继续？`)) return
    void runBatch(doc, files)
  }, true)

  toolbar.insertAdjacentElement('afterbegin', btn)
  updateBatchButtonVisibility(doc)
}

function injectStyles(doc: Document) {
  if (doc.getElementById('m115-unarchive-action-style')) return
  const style = doc.createElement('style')
  style.id = 'm115-unarchive-action-style'
  style.textContent = `
    .m115-unarchive-btn {
      display: inline-block !important;
      width: auto !important;
      min-width: 44px !important;
      height: 24px !important;
      margin: 0 6px 0 0 !important;
      padding: 0 8px !important;
      border: 1px solid #2563eb !important;
      border-radius: 4px !important;
      background: #fff !important;
      color: #2563eb !important;
      font-size: 12px !important;
      line-height: 22px !important;
      text-align: center !important;
      cursor: pointer;
      text-decoration: none !important;
      vertical-align: middle;
      overflow: visible !important;
      text-indent: 0 !important;
    }
    .m115-batch-unarchive-btn span {
      color: #2563eb !important;
    }
    .m115-batch-unarchive-btn:hover span {
      color: #1d4ed8 !important;
    }
    .m115-unarchive-btn:hover {
      background: #eff6ff !important;
    }
    .m115-unarchive-btn.is-busy {
      opacity: .6;
      pointer-events: none;
    }
    .m115-unarchive-toast {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 999999;
      display: flex;
      align-items: flex-start;
      gap: 9px;
      width: min(340px, calc(100vw - 36px));
      padding: 10px 12px 10px 10px;
      border: 1px solid rgba(59, 130, 246, .18);
      border-left: 5px solid #2563eb;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(255, 255, 255, .98), rgba(239, 246, 255, .96));
      color: #0f172a;
      box-shadow: 0 12px 30px rgba(15, 23, 42, .16), 0 3px 9px rgba(37, 99, 235, .1);
      font-size: 12px;
      line-height: 1.45;
      opacity: 0;
      pointer-events: none;
      white-space: pre-wrap;
      transform: translate3d(16px, -8px, 0) scale(.98);
      transition: opacity .22s ease, transform .22s ease;
      backdrop-filter: blur(10px);
    }
    .m115-unarchive-toast::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .8);
    }
    .m115-unarchive-toast-mark {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      background: #2563eb;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      box-shadow: 0 6px 14px rgba(37, 99, 235, .24);
    }
    .m115-unarchive-toast-content {
      flex: 1;
      min-width: 0;
    }
    .m115-unarchive-toast-body {
      color: #1e293b;
      font-weight: 500;
      word-break: break-word;
    }
    .m115-unarchive-toast.show {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }
  `
  doc.head?.appendChild(style)
}

async function refreshNativeList(doc: Document) {
  try {
    await sendRuntimeMessageSafe({ type: 'REQUEST_MOVE_REFRESH' })
    return true
  }
  catch {
    await Promise.resolve()
  }

  const win = doc.defaultView as (Window & { Main?: any }) | null
  try {
    if (typeof win?.Main?.ReInstance === 'function') {
      win.Main.ReInstance({ type: '', star: '', is_q: '', is_share: '' })
      return true
    }
    if (typeof win?.Main?.List?.Load === 'function') {
      win.Main.List.Load()
      return true
    }
  }
  catch {
    await Promise.resolve()
  }
  const refreshBtn = Array.from(doc.querySelectorAll<HTMLElement>('a,button,li')).find(el => el.textContent?.trim() === '刷新' || el.getAttribute('menu') === 'refresh')
  refreshBtn?.click()
  return !!refreshBtn
}

export function formatExtractStatus(percent: number) {
  if (percent >= 100) return '正在收尾，即将完成'
  if (percent > 0) return `云端处理中 ${Math.round(percent)}%`
  return '云端已接收任务，正在处理'
}

function stopUnarchiveButtonEvent(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

const actionCleanups = new Map<Document, () => void>()
const visibilityTimers = new Map<Document, number>()

export function setupUnarchiveActions(doc: Document) {
  const existing = actionCleanups.get(doc)
  if (existing) {
    injectBatchButton(doc)
    return existing
  }

  injectStyles(doc)
  injectBatchButton(doc)
  const scheduleVisibilityUpdate = () => {
    const timer = visibilityTimers.get(doc)
    if (timer) window.clearTimeout(timer)
    visibilityTimers.set(doc, window.setTimeout(() => updateBatchButtonVisibility(doc), 300))
  }
  const updateVisibility = () => updateBatchButtonVisibility(doc)
  const observer = new MutationObserver(scheduleVisibilityUpdate)
  doc.addEventListener('click', scheduleVisibilityUpdate, true)
  doc.addEventListener('pointerup', scheduleVisibilityUpdate, true)
  doc.addEventListener('keyup', scheduleVisibilityUpdate, true)
  doc.addEventListener('change', updateVisibility, true)
  observer.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'checked'] })

  const cleanup = () => {
    doc.removeEventListener('click', scheduleVisibilityUpdate, true)
    doc.removeEventListener('pointerup', scheduleVisibilityUpdate, true)
    doc.removeEventListener('keyup', scheduleVisibilityUpdate, true)
    doc.removeEventListener('change', updateVisibility, true)
    observer.disconnect()
    const timer = visibilityTimers.get(doc)
    if (timer) window.clearTimeout(timer)
    visibilityTimers.delete(doc)
    doc.getElementById('m115-batch-unarchive-btn')?.remove()
    actionCleanups.delete(doc)
  }
  actionCleanups.set(doc, cleanup)
  return cleanup
}

export function injectUnarchiveButton(item: HTMLElement, file: FileInfo) {
  if (!isArchiveFileName(file.fileName)) return
  if (item.querySelector('.m115-unarchive-btn')) return

  const doc = item.ownerDocument
  const target = item.querySelector('.file-opr') || item.querySelector('.file-name') || item
  const btn = doc.createElement('a')
  btn.href = 'javascript:;'
  btn.className = 'm115-unarchive-btn'
  btn.textContent = '解压'
  btn.title = '解压到同名文件夹'
  btn.addEventListener('pointerdown', stopUnarchiveButtonEvent, true)
  btn.addEventListener('mousedown', stopUnarchiveButtonEvent, true)
  btn.addEventListener('mouseup', stopUnarchiveButtonEvent, true)
  btn.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    item.classList.remove('selected', 'cur', 'hover')

    btn.classList.add('is-busy')
    showToast(doc, `正在解压：${file.fileName}\n请不要刷新或关闭页面。`, 0)
    try {
      const targetFile: FileInfo = {
        ...file,
        fileId: file.fileId || item.getAttribute('file_id') || item.getAttribute('fid') || item.getAttribute('fileid') || undefined,
        parentId: file.parentId || item.getAttribute('cid') || item.getAttribute('p_id') || undefined,
      }
      const result = await unarchiveOne(targetFile, percent => showToast(doc, `正在解压：${file.fileName}\n状态：${formatExtractStatus(percent)}\n请不要刷新或关闭页面。`, 0))
      const refreshed = await refreshNativeList(doc)
      showToast(doc, `${file.fileName}\n${result.message}。${refreshed ? '列表已刷新。' : '请刷新页面查看新文件夹。'}`, 3000)
    }
    catch (error) {
      alert(`解压失败：${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      btn.classList.remove('is-busy')
    }
  }, true)

  target.insertBefore(btn, target.firstChild)
}
