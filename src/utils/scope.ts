/**
 * 作用域检查工具
 */

export interface ScopeItem {
  type: '私聊' | '群聊'
  id?: string
}

export interface ScopeConfig {
  mode: '全部启用' | '白名单' | '黑名单'
  list: ScopeItem[]
}

/**
 * 检查频道是否在作用域内
 * @param channelId 频道 ID（私聊可为 private:xxx，群聊为频道或群号）
 * @param scope 作用域配置
 * @param isDirect 显式指定是否私聊，优先于 channelId 前缀判断
 * @param userId 私聊用户 ID，用于匹配私聊白/黑名单
 * @returns 是否允许
 */
export function isInScope(
  channelId: string | undefined,
  scope: ScopeConfig,
  isDirect?: boolean,
  userId?: string,
  guildId?: string
): boolean {
  if (!scope || scope.mode === '全部启用') {
    return true
  }

  const isPrivate = isDirect ?? channelId?.startsWith('private:') ?? false
  const ids = new Set([channelId, guildId, userId].filter(Boolean))

  // 检查是否匹配列表中的项
  const isInList = scope.list?.some(item => {
    if (item.type === '私聊') {
      // 私聊类型
      if (!isPrivate) return false
      // 如果没有指定 ID，匹配所有私聊
      if (!item.id) return true
      // 否则匹配具体的私聊 ID
      const privateId = channelId?.startsWith('private:')
        ? channelId.replace('private:', '')
        : userId
      return privateId === item.id
    } else if (item.type === '群聊') {
      // 群聊类型
      if (isPrivate) return false
      // 如果没有指定 ID，匹配所有群聊
      if (!item.id) return true
      // 否则匹配具体的群号
      return ids.has(item.id)
    }
    return false
  }) || false

  if (scope.mode === '白名单') {
    // 白名单模式：只有在列表中的才允许
    return isInList
  } else if (scope.mode === '黑名单') {
    // 黑名单模式：不在列表中的才允许
    return !isInList
  }

  return true
}

export function isSessionInScope(session: any, scope?: ScopeConfig): boolean {
  if (!scope) return true
  return isInScope(
    session?.channelId,
    scope,
    session?.isDirect,
    session?.userId,
    session?.guildId
  )
}
