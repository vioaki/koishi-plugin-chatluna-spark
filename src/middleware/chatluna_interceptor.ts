import { Context, Session } from 'koishi'
import { TagParser } from '../parser/tag_parser'
import { SparkTriggerAdapter } from '../service/trigger_adapter'
import { TAG_PATTERN } from '../utils/shared'
import type { ChainMiddlewareContext } from 'koishi-plugin-chatluna/lib/chains/chain'

declare module 'koishi-plugin-chatluna/lib/chains/chain' {
  interface ChainMiddlewareName {
    'spark-tag-processor': never
    censor: never
    render_message: never
  }
}

interface TextMessagePart {
  type: string
  text?: string
}

interface ChatLunaMessageLike {
  content?: string | TextMessagePart[]
}

interface SparkChainOptions {
  responseMessage?: ChatLunaMessageLike
}

/**
 * ChatLuna 主插件专用拦截器
 * 通过 chatChain 中间件获取 AI 响应，检测标签、创建任务、并修改消息移除标签
 */
export function setupChatlunaInterceptor(ctx: Context, trigger: SparkTriggerAdapter) {
  const tagParser = new TagParser(ctx, trigger)

  ctx.on('ready', () => {
    if (!ctx.chatluna?.chatChain) {
      return
    }

    ctx.chatluna.chatChain
      .middleware(
        'spark-tag-processor',
        async (session: Session, context: ChainMiddlewareContext) => {
          try {
            const responseMessage = (context.options as SparkChainOptions | undefined)
              ?.responseMessage
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

            const { cleanText, results, failures } = await tagParser.parseAndExecute(
              content,
              session
            )

            if (results.length > 0 || failures.length > 0) {
              if (typeof responseMessage.content === 'string') {
                responseMessage.content = cleanText
              } else if (Array.isArray(responseMessage.content)) {
                removeSparkTagsFromTextParts(responseMessage.content)
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

function removeSparkTagsFromTextParts(parts: TextMessagePart[]) {
  const textParts = parts.filter(
    (part): part is TextMessagePart & { text: string } =>
      part.type === 'text' && typeof part.text === 'string'
  )
  const combined = textParts.map((part) => part.text).join('')
  TAG_PATTERN.lastIndex = 0
  const ranges = [...combined.matchAll(TAG_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }))
  TAG_PATTERN.lastIndex = 0

  let offset = 0
  for (const part of textParts) {
    const original = part.text
    const start = offset
    const end = start + original.length
    const fragments: string[] = []
    let cursor = 0

    for (const range of ranges) {
      if (range.end <= start || range.start >= end) continue
      const localStart = Math.max(range.start, start) - start
      const localEnd = Math.min(range.end, end) - start
      fragments.push(original.slice(cursor, localStart))
      cursor = localEnd
    }
    fragments.push(original.slice(cursor))
    part.text = fragments.join('')
    offset = end
  }
}
