/**
 * 115m 2.0 · 缩略图业务适配层（Layer 1）
 * 复用 core 的抽帧实现（M3U8 切片 + WebCodecs），自带缓存与在途去重。
 */

import { getVideoCoverAt, getVideoCovers, openCoverSession, type CoverSession, type VideoThumbnail } from '../../lib/videoThumbnail'

export type { VideoThumbnail }

export async function loadCoverAt(pickCode: string, time: number, duration: number): Promise<VideoThumbnail | null> {
  if (!pickCode || !duration) return null
  try {
    return await getVideoCoverAt(pickCode, time, duration)
  }
  catch {
    return null
  }
}

/** 预热一批封面（一次 clipper 会话批量抽帧并落缓存），供悬停即时命中。 */
export async function loadCovers(pickCode: string, duration: number, count = 36): Promise<VideoThumbnail[]> {
  if (!pickCode || !duration) return []
  try {
    return await getVideoCovers(pickCode, duration, count)
  }
  catch {
    return []
  }
}

// 常驻抽帧会话：同一视频内连续精确抽帧复用同一个 clipper，做到「指哪出哪」且快；带单实例互斥防并发
let currentSession: { pickCode: string, session: CoverSession } | null = null
let openingPromise: { pickCode: string, promise: Promise<CoverSession> } | null = null

export async function getPreciseCover(pickCode: string, time: number, duration: number): Promise<VideoThumbnail | null> {
  if (!pickCode || !duration) return null

  if (!currentSession || currentSession.pickCode !== pickCode) {
    currentSession?.session.destroy()
    currentSession = null

    if (!openingPromise || openingPromise.pickCode !== pickCode) {
      openingPromise = {
        pickCode,
        promise: openCoverSession(pickCode),
      }
    }

    try {
      const session = await openingPromise.promise
      if (openingPromise?.pickCode === pickCode) {
        currentSession = { pickCode, session }
      }
      else {
        session.destroy()
        return null
      }
    }
    catch {
      return null
    }
    finally {
      if (openingPromise?.pickCode === pickCode) {
        openingPromise = null
      }
    }
  }

  return await currentSession.session.getCoverAt(time, duration)
}

/** 释放常驻会话（切集 / 卸载时调用）。 */
export function releaseCoverSession(): void {
  openingPromise = null
  currentSession?.session.destroy()
  currentSession = null
}
