import { Context } from 'koishi'

/**
 * 共享工具模块
 * 提取各模块中重复的代码
 */

// ===== 用户追踪 =====

/** 存储每个频道最后发消息的用户 ID（带过期时间） */
export const lastUserMap = new Map<string, { userId: string; timestamp: number }>()
export const USER_MAP_EXPIRE_MS = 30 * 60 * 1000 // 30 分钟过期

/** XML 标签正则 */
export const TAG_PATTERN = /<(reminder|follow-up|memo)\s+time="[^"]+">[\s\S]*?<\/\1>/g

/**
 * 初始化用户追踪（定期清理 + 监听消息）
 * 应该只调用一次
 */
export function initUserTracking(ctx: Context) {
  // 定期清理过期记录
  ctx.setInterval(() => {
    const now = Date.now()
    for (const [key, value] of lastUserMap) {
      if (now - value.timestamp > USER_MAP_EXPIRE_MS) {
        lastUserMap.delete(key)
      }
    }
  }, 10 * 60 * 1000)

  ctx.on('dispose', () => {
    lastUserMap.clear()
  })

  // 监听用户消息，记录真实的 userId
  ctx.on('message', (session) => {
    if (session.userId && session.channelId) {
      lastUserMap.set(session.channelId, {
        userId: session.userId,
        timestamp: Date.now()
      })
    }
  })
}

// ===== Character 相关 =====

/**
 * 获取 chatluna-character 配置的目标群组
 */
export function getCharacterGroups(ctx: Context): string[] {
  const characterService = ctx.chatluna_character as any
  if (characterService?._config?.applyGroup) {
    return characterService._config.applyGroup
  }
  return []
}

// ===== 消息构建 =====

/**
 * 构建触发消息
 * @param template 模板字符串，支持 {content} 和 {prompt}（兼容旧版）
 * @param content 任务内容
 */
export function buildTriggerMessage(template: string, content: string): string {
  const finalTemplate = template || '[系统提醒] {content}'
  return finalTemplate
    .replace('{content}', content)
    .replace('{prompt}', content)  // 兼容旧版配置
}
