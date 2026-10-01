/**
 * 115m 2.0 · 播放会话控制器（Layer 2）
 * 编排「首播解析 / 加载播放列表 / 切集 / 切清晰度 / 上一下一集 / 播完连播」。
 * 依赖：PlayerCore（能力层）+ 播放列表适配层 + 播放源构建；不涉及任何 DOM。
 */

import { PlayerCore } from './player-core'
import { SubtitleController } from './subtitles'
import { HistoryController } from './history'
import { createContentStore, type PlaybackMode } from '../state/content-state'
import { loadBreadcrumb, loadPlaylist } from '../adapters/playlist'
import { downloadVideo, loadFavorite, removeVideo, setFavorite } from '../adapters/files'
import { loadSubtitleCues, loadSubtitleList } from '../adapters/subtitles'
import { getPreciseCover, releaseCoverSession, type VideoThumbnail } from '../adapters/thumbnail'
import {
  prepareQualitySource,
  resolvePlaybackSources,
  type PreparedPlaybackSource,
  type ResolvedPlaybackSources,
} from '../stream/stream-builder'
import { getPlaylistPosition, getDeleteFallback } from '../stream/playlist-navigation'
import { MoveDialog } from '../ui/move-dialog'
import { buildNavigateToVideoUrl, readPathFromLocation } from '../services/player-query'
import { exitPlayer } from '../services/exit'
import type { QualityOption } from '../types/types'
import type { SubtitleItem } from '../services/subtitles'

export interface SessionParams {
  pickCode: string
  cid: string
  title: string
  fileSize: string
  isFavorite: boolean
}

export interface SwitchOptions {
  autoPlay?: boolean
  keepPlaylistOpen?: boolean
}

export class PlaybackSession {
  readonly content = createContentStore()
  readonly subtitles = new SubtitleController()
  readonly history: HistoryController

  private qualityOptions: QualityOption[] = []
  private subtitleItems: SubtitleItem[] = []
  private switching = false

  constructor(
    private readonly core: PlayerCore,
    private readonly params: SessionParams,
  ) {
    this.history = new HistoryController(core, () => ({
      pickCode: this.content.get().pickCode,
      fileName: this.content.get().title,
    }))
  }

  /** 首播：解析源 → 装载首播源 → 加载播放列表。返回首播源供状态提示使用。 */
  async start(): Promise<PreparedPlaybackSource> {
    this.content.set({
      pickCode: this.params.pickCode,
      cid: this.params.cid,
      title: this.params.title,
      fileSize: this.params.fileSize,
      isFavorite: this.params.isFavorite,
      // URL 若带 path 参数，先立即渲染面包屑，后续由接口精修
      path: readPathFromLocation(window.location.search),
    })
    this.core.onEnded(() => this.autoAdvance())

    const resolved = await resolvePlaybackSources(this.params.pickCode)
    this.applySources(resolved)
    this.core.load(resolved.initial.src, resolved.initial.type, false)

    if (this.params.cid) void this.loadList()
    void this.loadSubtitles(this.params.pickCode)
    void this.refreshFavorite()

    this.history.start()
    void this.history.restore(this.params.pickCode)

    return resolved.initial
  }

  /** 切换字幕；sid 为空串表示关闭字幕。 */
  async setSubtitle(sid: string): Promise<void> {
    if (sid === this.content.get().subtitle) return
    if (!sid) {
      this.subtitles.clear()
      this.content.set({ subtitle: '' })
      return
    }
    const item = this.subtitleItems.find(entry => entry.sid === sid)
    if (!item) return
    try {
      const cues = await loadSubtitleCues(item)
      this.subtitles.setCues(cues)
      this.content.set({ subtitle: sid })
    }
    catch (error) {
      console.warn('[115m-v2] 字幕加载失败', error)
    }
  }

  /** 切换清晰度。 */
  async setQuality(label: string): Promise<void> {
    if (!label || label === this.content.get().quality) return
    const option = this.qualityOptions.find(entry => entry.label === label)
    if (!option) return
    try {
      const source = await prepareQualitySource(option, this.content.get().pickCode)
      this.core.load(source.src, source.type, true)
      this.content.set({ quality: label })
    }
    catch (error) {
      console.warn('[115m-v2] 切换清晰度失败', error)
    }
  }

  /** 收藏 / 取消收藏当前视频。 */
  async toggleFavorite(marked: boolean): Promise<void> {
    const content = this.content.get()
    const item = content.playlist.find(entry => entry.pickCode === content.pickCode)
    const result = await setFavorite(item?.fileId || '', marked)
    this.content.set({ isFavorite: result })
    const params = new URLSearchParams(window.location.search)
    params.set('marked', result ? '1' : '0')
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }

  /** 下载原画。 */
  async download(): Promise<void> {
    try {
      await downloadVideo(this.content.get().pickCode)
    }
    catch (error) {
      console.warn('[115m-v2] 下载失败', error)
    }
  }

  /** 移动指定剧集到其它目录。若移动的是当前正在播放的视频，保持正常播放，不中断、不切集、不退出。 */
  async moveEpisode(pickCode: string): Promise<void> {
    const content = this.content.get()
    const item = content.playlist.find(entry => entry.pickCode === pickCode)
    if (!item?.fileId) return

    const dialog = new MoveDialog(item.fileId, item.cid || content.cid || '0', () => {})
    const result = await dialog.show()
    if (!result.moved) return

    const isCurrent = pickCode === content.pickCode
    if (isCurrent) {
      if (result.targetCid) {
        const updatedPlaylist = content.playlist.map(entry =>
          entry.pickCode === pickCode ? { ...entry, cid: result.targetCid } : entry,
        )
        this.content.set({ cid: result.targetCid, playlist: updatedPlaylist })
        const params = new URLSearchParams(window.location.search)
        params.set('cid', result.targetCid)
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
      }
      void this.loadBreadcrumb(pickCode)
      return
    }

    // 移动非当前剧集：从当前播放列表中移除
    this.content.set({
      playlist: content.playlist.filter(entry => entry.pickCode !== pickCode),
    })
  }

  /** 删除指定剧集；若为当前集则自动跳到下一集。 */
  async deleteEpisode(pickCode: string): Promise<void> {
    const content = this.content.get()
    const item = content.playlist.find(entry => entry.pickCode === pickCode)
    if (!item?.fileId) return

    try {
      await removeVideo(item.fileId, item.cid || content.cid, pickCode)
    }
    catch (error) {
      console.warn('[115m-v2] 删除失败', error)
      return
    }
    this.removeFromList(pickCode)
  }

  private removeFromList(pickCode: string): void {
    const content = this.content.get()
    const wasCurrent = content.pickCode === pickCode
    const fallback = getDeleteFallback(content.playlist, pickCode)
    this.content.set({ playlist: content.playlist.filter(entry => entry.pickCode !== pickCode) })

    if (wasCurrent) {
      if (fallback.nextPickCode) {
        void this.switchTo(fallback.nextPickCode, { autoPlay: true, keepPlaylistOpen: true })
      }
      else {
        void exitPlayer({ cid: this.params.cid || this.content.get().cid })
      }
    }
  }

  /** 删除当前视频，并自动跳到下一集（无则上一集，再无则返回）。 */
  async removeCurrent(): Promise<void> {
    await this.deleteEpisode(this.content.get().pickCode)
  }

  next(autoPlay = true): void {
    const { playlist, pickCode } = this.content.get()
    const pos = getPlaylistPosition(playlist, pickCode)
    if (pos.next) void this.switchTo(pos.next.pickCode, { autoPlay, keepPlaylistOpen: true })
  }

  prev(autoPlay = true): void {
    const { playlist, pickCode } = this.content.get()
    const pos = getPlaylistPosition(playlist, pickCode)
    if (pos.previous) void this.switchTo(pos.previous.pickCode, { autoPlay, keepPlaylistOpen: true })
  }

  async switchTo(pickCode: string, options: SwitchOptions = {}): Promise<void> {
    if (!pickCode || pickCode === this.content.get().pickCode || this.switching) return
    this.switching = true
    this.content.set({ switching: true })
    try {
      // 切集前先把当前集进度落库
      await this.history.flush()

      const resolved = await resolvePlaybackSources(pickCode)
      const item = this.content.get().playlist.find(entry => entry.pickCode === pickCode)

      this.applySources(resolved)
      this.core.load(resolved.initial.src, resolved.initial.type, options.autoPlay !== false)
      // 定论：倍速不记忆，切集重置为 1x
      this.core.setRate(1)

      // 切集后字幕/历史归属新视频
      this.subtitles.clear()
      this.subtitleItems = []
      this.content.set({ subtitle: '', subtitles: [] })
      void this.loadSubtitles(pickCode)
      this.history.resetWindow()
      void this.history.restore(pickCode)
      void this.refreshFavorite()

      // 切集后释放常驻抽帧会话（若上个视频正在抽帧则立即熔断释放，防请求残留）
      releaseCoverSession()

      const pos = getPlaylistPosition(this.content.get().playlist, pickCode)
      this.content.set({
        pickCode,
        title: item?.name || this.content.get().title,
        fileSize: item?.size || '',
        currentIndex: pos.index >= 0 ? pos.index + 1 : 0,
        isFavorite: !!item?.isMarked,
      })

      window.history.replaceState(null, '', buildNavigateToVideoUrl(
        window.location.pathname,
        window.location.search,
        pickCode,
        {
          title: item?.name,
          fileId: item?.fileId,
          fileSize: item?.size,
          cid: item?.cid || this.content.get().cid,
          keepPlaylistOpen: options.keepPlaylistOpen,
        },
      ))
    }
    catch (error) {
      console.warn('[115m-v2] 切换集数失败', error)
    }
    finally {
      this.switching = false
      this.content.set({ switching: false })
    }
  }

  private applySources(resolved: ResolvedPlaybackSources): void {
    this.qualityOptions = resolved.options
    this.content.set({
      qualities: resolved.options.map(option => option.label),
      quality: resolved.qualityLabel,
    })
  }

  private async loadList(): Promise<void> {
    try {
      const { items, path } = await loadPlaylist(this.content.get().cid, this.content.get().pickCode)
      const pos = getPlaylistPosition(items, this.content.get().pickCode)
      const current = pos.current
      this.content.set({
        playlist: items,
        path: path.length ? path : this.content.get().path,
        currentIndex: pos.index >= 0 ? pos.index + 1 : 0,
        title: this.content.get().title || current?.name || '',
        fileSize: this.content.get().fileSize || current?.size || '',
      })

      // 播放列表响应未带路径时，独立拉取面包屑
      if (!path.length) void this.loadBreadcrumb(this.content.get().pickCode)
    }
    catch (error) {
      console.warn('[115m-v2] 播放列表加载失败', error)
    }
  }

  private async loadBreadcrumb(pickCode: string): Promise<void> {
    try {
      const path = await loadBreadcrumb(pickCode)
      if (path.length && pickCode === this.content.get().pickCode) {
        this.content.set({ path })
      }
    }
    catch {
      // 面包屑为低优先级，静默失败
    }
  }

  private async loadSubtitles(pickCode: string): Promise<void> {
    try {
      const list = await loadSubtitleList(pickCode)
      this.subtitleItems = list
      this.content.set({
        subtitles: list.map(item => ({ sid: item.sid, title: item.title })),
      })
    }
    catch (error) {
      console.warn('[115m-v2] 字幕列表加载失败', error)
    }
  }

  private async refreshFavorite(): Promise<void> {
    const pickCode = this.content.get().pickCode
    try {
      const marked = await loadFavorite(pickCode)
      if (marked !== null && pickCode === this.content.get().pickCode) {
        this.content.set({ isFavorite: marked })
      }
    }
    catch {
      // 收藏状态为低优先级，静默失败
    }
  }

  /** 设置播放模式。 */
  setMode(mode: PlaybackMode): void {
    this.content.set({ mode })
  }

  /** 进度条悬停预览：仅当用户悬停时按需抽取单帧（无后台多帧预热，杜绝风控洪峰）。 */
  getCoverAt(
    time: number,
    duration: number,
    onUpdate: (cover: { imgUrl: string, width?: number, height?: number } | null) => void,
  ): void {
    const pickCode = this.content.get().pickCode
    if (!pickCode || !duration) {
      onUpdate(null)
      return
    }

    void (async () => {
      const precise = await getPreciseCover(pickCode, time, duration)
      if (precise && pickCode === this.content.get().pickCode) {
        onUpdate({ imgUrl: precise.imgUrl, width: precise.width, height: precise.height })
      }
    })()
  }

  private autoAdvance(): void {
    const { playlist, pickCode, mode } = this.content.get()
    if (mode === 'loop-one') {
      this.core.seekTo(0)
      this.core.play()
      return
    }

    const pos = getPlaylistPosition(playlist, pickCode)
    const target = pos.next?.pickCode || (mode === 'loop-all' && playlist.length ? playlist[0].pickCode : '')
    if (target) void this.switchTo(target, { autoPlay: true, keepPlaylistOpen: true })
  }
}
