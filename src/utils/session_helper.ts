import { Context, Session } from 'koishi'

/**
 * 从 channelId 提取真实的 userId
 * 私聊时 channelId 格式为 private:xxx，需要提取
 * 群聊时直接返回 userId
 */
export function extractRealUserId(userId: string | undefined, channelId: string | undefined): string | undefined {
  if (channelId?.startsWith('private:')) {
    return channelId.replace('private:', '')
  }
  return userId
}

/**
 * 从 channelId 提取 guildId
 * 私聊：返回 "0"
 * 群聊：从 channelId 中提取（格式为 guildId:channelId）
 */
export function extractGuildId(channelId: string | undefined): string {
  if (!channelId) return '0'

  if (channelId.startsWith('private:')) {
    return '0'
  }

  if (channelId.includes(':')) {
    return channelId.split(':')[0]
  }

  return '0'
}

/**
 * 判断是否为群聊
 */
export function isGroupChat(channelId: string | undefined): boolean {
  if (!channelId) return false
  return channelId.includes(':') && !channelId.startsWith('private:')
}

/**
 * 从 session 中提取完整的用户信息
 */
export function extractSessionInfo(session: Session | any): {
  userId: string | undefined
  channelId: string | undefined
  guildId: string | undefined
  realUserId: string | undefined
} {
  const userId = session.userId || session.user?.id || session.event?.user?.id
  const channelId = session.channelId || session.channel?.id || session.event?.channel?.id
  const guildId = session.guildId || session.guild?.id || session.event?.guild?.id || extractGuildId(channelId)
  const realUserId = extractRealUserId(userId, channelId)

  return { userId, channelId, guildId, realUserId }
}

/**
 * 创建合成的 Koishi Session
 */
export function createSyntheticSession(
  ctx: Context,
  userId: string,
  channelId: string,
  content: string
): Session | null {
  const isGroup = isGroupChat(channelId)

  for (const bot of ctx.bots) {
    try {
      const session = bot.session({
        type: 'message',
        timestamp: Date.now(),
        selfId: bot.selfId,
        user: { id: userId },
        channel: { id: channelId, type: 0 },
        guild: isGroup ? { id: channelId.split(':')[0] } : undefined,
        content
      } as any)

      return session
    } catch {
      continue
    }
  }

  return null
}
