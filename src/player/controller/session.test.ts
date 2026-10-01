// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSession } from './session'
import { MoveDialog } from '../ui/move-dialog'
import { loadBreadcrumb } from '../adapters/playlist'

vi.mock('../ui/move-dialog', () => {
  return {
    MoveDialog: vi.fn(),
  }
})

vi.mock('../adapters/playlist', () => {
  return {
    loadPlaylist: vi.fn().mockResolvedValue({ items: [], path: [] }),
    loadBreadcrumb: vi.fn().mockResolvedValue([{ cid: 'target-cid', name: '新目录' }]),
  }
})

vi.mock('../stream/stream-builder', () => {
  return {
    resolvePlaybackSources: vi.fn(),
    prepareQualitySource: vi.fn(),
  }
})

vi.mock('../adapters/files', () => {
  return {
    downloadVideo: vi.fn(),
    loadFavorite: vi.fn(),
    removeVideo: vi.fn(),
    setFavorite: vi.fn(),
  }
})

vi.mock('../adapters/subtitles', () => {
  return {
    loadSubtitleCues: vi.fn(),
    loadSubtitleList: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('../adapters/thumbnail', () => {
  return {
    getPreciseCover: vi.fn(),
    loadCovers: vi.fn().mockResolvedValue([]),
    releaseCoverSession: vi.fn(),
  }
})

vi.mock('../services/exit', () => {
  return {
    exitPlayer: vi.fn(),
  }
})

describe('PlaybackSession - moveEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/player/?pickcode=p1&cid=root')
  })

  it('移动当前正在播放的视频：保持正常播放，不切集、不退出，更新 cid 与面包屑', async () => {
    const fakeCore = {
      store: {
        subscribe: vi.fn(() => () => {}),
      },
      on: vi.fn(),
    } as any

    const session = new PlaybackSession(fakeCore, {
      pickCode: 'p1',
      cid: 'root',
      title: '第1集',
      fileSize: '100MB',
      isFavorite: false,
    })

    session.content.set({
      pickCode: 'p1',
      cid: 'root',
      playlist: [
        { pickCode: 'p1', fileId: 'f1', name: '第1集', cid: 'root' },
        { pickCode: 'p2', fileId: 'f2', name: '第2集', cid: 'root' },
      ],
    })

    const switchToSpy = vi.spyOn(session, 'switchTo').mockResolvedValue()

    vi.mocked(MoveDialog).mockImplementation(function () {
      return {
        show: vi.fn().mockResolvedValue({ moved: true, targetCid: 'folder-archive' }),
      } as any
    } as any)

    await session.moveEpisode('p1')

    // 绝不切集
    expect(switchToSpy).not.toHaveBeenCalled()

    // content 与 item 的 cid 已更新
    const content = session.content.get()
    expect(content.cid).toBe('folder-archive')
    expect(content.playlist.find(e => e.pickCode === 'p1')?.cid).toBe('folder-archive')

    // 仍然在播放列表中（不影响连播与剧集展示）
    expect(content.playlist).toHaveLength(2)

    // URL 中的 cid 已同步更新
    expect(new URLSearchParams(window.location.search).get('cid')).toBe('folder-archive')

    // 触发了面包屑更新
    expect(loadBreadcrumb).toHaveBeenCalledWith('p1')
  })

  it('移动非当前剧集：从播放列表中剔除，不影响当前播放', async () => {
    const fakeCore = {
      store: {
        subscribe: vi.fn(() => () => {}),
      },
      on: vi.fn(),
    } as any

    const session = new PlaybackSession(fakeCore, {
      pickCode: 'p1',
      cid: 'root',
      title: '第1集',
      fileSize: '100MB',
      isFavorite: false,
    })

    session.content.set({
      pickCode: 'p1',
      cid: 'root',
      playlist: [
        { pickCode: 'p1', fileId: 'f1', name: '第1集', cid: 'root' },
        { pickCode: 'p2', fileId: 'f2', name: '第2集', cid: 'root' },
      ],
    })

    const switchToSpy = vi.spyOn(session, 'switchTo').mockResolvedValue()

    vi.mocked(MoveDialog).mockImplementation(function () {
      return {
        show: vi.fn().mockResolvedValue({ moved: true, targetCid: 'folder-archive' }),
      } as any
    } as any)

    await session.moveEpisode('p2')

    // 绝不切集
    expect(switchToSpy).not.toHaveBeenCalled()

    // p2 已从播放列表中剔除
    const content = session.content.get()
    expect(content.playlist).toHaveLength(1)
    expect(content.playlist[0].pickCode).toBe('p1')
    expect(content.cid).toBe('root')
  })
})
