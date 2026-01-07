import { Context, Session } from 'koishi'
import { TagParser } from '../parser/tag_parser'
import { isInScope, ScopeConfig } from '../utils/scope'
import { lastUserMap, TAG_PATTERN } from '../utils/shared'

/**
 * chatluna-character 专用检测器
 * 通过拦截 logger.debug 获取 AI 原始响应，只检测标签并创建任务
 */
export function setupCharacterInterceptor(ctx: Context, scope?: ScopeConfig) {
  const tagParser = new TagParser(ctx)

  // 初始化拦截器
  function initInterceptor() {
    if (!ctx.chatluna_character) {
      return false
    }

    let currentSession: Session | null = null

    ctx.chatluna_character.collect(async (session: Session) => {
      currentSession = session
    })

    const characterService = ctx.chatluna_character as any
    const characterLogger = characterService.logger

    if (characterLogger && typeof characterLogger.debug === 'function') {
      const originalDebug = characterLogger.debug.bind(characterLogger)

      characterLogger.debug = (...args: any[]) => {
        originalDebug(...args)

        const message = args[0]
        if (typeof message === 'string' && message.startsWith('model response: ')) {
          const response = message.substring('model response: '.length)

          if (currentSession) {
            processModelResponse(response, currentSession)
          }
        }
      }

      ctx.on('dispose', () => {
        characterLogger.debug = originalDebug
      })

      return true
    } else {
      return false
    }
  }

  async function processModelResponse(response: string, session: Session) {
    if (scope && session?.channelId && !isInScope(session.channelId, scope)) {
      return
    }

    TAG_PATTERN.lastIndex = 0
    if (!TAG_PATTERN.test(response)) {
      return
    }
    TAG_PATTERN.lastIndex = 0

    const channelId = session?.channelId
    const userRecord = channelId ? lastUserMap.get(channelId) : null
    const realUserId = userRecord?.userId || session?.userId

    const enhancedSession = {
      userId: realUserId,
      channelId: session?.channelId,
      guildId: session?.guildId
    }

    try {
      await tagParser.parseAndExecute(response, enhancedSession)
    } catch (err) {
      ctx.logger('spark').error('Tag processing failed:', err)
    }
  }

  if (initInterceptor()) {
    return
  }

  // @ts-ignore
  ctx.on('internal/service', (name: string) => {
    if (name === 'chatluna_character' && ctx.chatluna_character) {
      initInterceptor()
    }
  })
}
