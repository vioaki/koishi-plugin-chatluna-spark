import { Context, Session } from 'koishi'
import { TagParser } from '../parser/tag_parser'
import { TAG_PATTERN } from '../utils/shared'
import { SparkTriggerAdapter } from '../service/trigger_adapter'

interface TextMessagePart {
  type: string
  text?: string
}

interface ChatLunaMessageLike {
  content?: string | TextMessagePart[]
}

interface ChatLunaMiddlewareContext {
  options?: {
    responseMessage?: ChatLunaMessageLike
  }
}

/**
 * ChatLuna 主插件专用拦截器
 * 通过 chatChain 中间件获取 AI 响应，检测标签、创建任务、并修改消息移除标签
 */
export function setupChatlunaInterceptor(ctx: Context, adapter: SparkTriggerAdapter) {
  const tagParser = new TagParser(ctx, adapter)

  ctx.on('ready', () => {
    if (!ctx.chatluna?.chatChain) {
      return
    }

    ctx.chatluna.chatChain
      .middleware(
        'spark-tag-processor',
        async (session: Session, context: ChatLunaMiddlewareContext) => {
          try {
            const responseMessage = context.options?.responseMessage
            if (!responseMessage?.content) {
              return 2
            }

            let content = ''
            if (typeof responseMessage.content === 'string') {
              content = responseMessage.content
            } else if (Array.isArray(responseMessage.content)) {
              content = responseMessage.content
                .filter((item) => item.type === 'text')
                .map((item) => item.text || '')
                .join('')
            }

            if (!content) return 2

            TAG_PATTERN.lastIndex = 0
            if (!TAG_PATTERN.test(content)) {
              return 2
            }
            TAG_PATTERN.lastIndex = 0

            const { cleanText, results } = await tagParser.parseAndExecute(content, session)

            if (results.length > 0) {
              if (typeof responseMessage.content === 'string') {
                responseMessage.content = cleanText
              } else if (Array.isArray(responseMessage.content)) {
                const parts = responseMessage.content
                for (let i = 0; i < parts.length; i++) {
                  if (parts[i].type === 'text') {
                    parts[i].text = cleanText
                    break
                  }
                }
              }
            }

            return 2
          } catch (err) {
            ctx.logger('spark').error('Tag processing failed:', err)
            return 2
          }
        }
      )
      .after('censor')
      .before('render_message')
  })
}
