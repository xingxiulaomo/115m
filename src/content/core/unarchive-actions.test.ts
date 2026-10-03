// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatExtractStatus, MAX_BATCH_UNARCHIVE_FILES, setupUnarchiveActions } from './unarchive-actions'
import { isArchiveFileName, stripArchiveExtension } from '../../shared/archive'

describe('formatExtractStatus 解压状态文案', () => {
  it('100% 及以上显示收尾', () => {
    expect(formatExtractStatus(100)).toBe('正在收尾，即将完成')
    expect(formatExtractStatus(150)).toBe('正在收尾，即将完成')
  })

  it('0-99% 显示百分比', () => {
    expect(formatExtractStatus(50)).toBe('云端处理中 50%')
    expect(formatExtractStatus(33.7)).toBe('云端处理中 34%')
  })

  it('0% 显示已接收', () => {
    expect(formatExtractStatus(0)).toBe('云端已接收任务，正在处理')
  })
})

describe('unarchive-actions 归档识别集成', () => {
  it('识别常见压缩包并去扩展名', () => {
    expect(isArchiveFileName('电影.zip')).toBe(true)
    expect(stripArchiveExtension('电影.zip')).toBe('电影')
    expect(stripArchiveExtension('资料.tar.gz')).toBe('资料')
  })
})

describe('setupUnarchiveActions 入口', () => {
  it('在无目标元素时安全返回', () => {
    const doc = document.implementation.createHTMLDocument()
    expect(() => setupUnarchiveActions(doc)).not.toThrow()
  })

  it('批量解压最大数量上限配置合理', () => {
    expect(MAX_BATCH_UNARCHIVE_FILES).toBe(20)
  })
})
