import { Context } from 'koishi'
import { parseTime } from '../utils/time_parser'
import { SparkScheduleType } from '../types'
import { SparkTriggerAdapter } from '../service/trigger_adapter'

export interface ParsedTag {
  type: 'reminder' | 'follow-up'
  data: any
  raw: string
}

export class TagParser {
  // XML 开闭标签格式，只匹配特定的标签名
  // 匹配: <reminder time="30m">喝水</reminder>
  // 匹配: <follow-up time="2h">聊天</follow-up>
  private static readonly SUPPORTED_TAGS = ['reminder', 'follow-up']
  private static readonly TAG_PATTERN = /<(reminder|follow-up)\s+time="([^"]+)">([\s\S]*?)<\/\1>/g

  constructor(
    private ctx: Context,
    private adapter: SparkTriggerAdapter
  ) {}

  /**
   * 解析文本中的所有标签并执行
   */
  async parseAndExecute(
    text: string,
    session: any
  ): Promise<{ cleanText: string; results: ParsedTag[] }> {
    const results: ParsedTag[] = []
    let cleanText = text

    const matches = [...text.matchAll(TagParser.TAG_PATTERN)]

    for (const match of matches) {
      const [fullMatch, type, timeStr, content] = match

      try {
        const parsed = await this.parseTag(type as ParsedTag['type'], timeStr, content.trim())
        if (parsed) {
          results.push({ ...parsed, raw: fullMatch })
          await this.executeTag(parsed, session)
        }
      } catch (err) {
        this.ctx.logger('spark:parser').error(
          `Failed to parse tag: ${fullMatch}`,
          err
        )
      }

      // 从文本中移除标签
      cleanText = cleanText.replace(fullMatch, '').trim()
    }

    return { cleanText, results }
  }

  /**
   * 解析单个标签
   */
  private async parseTag(
    type: ParsedTag['type'],
    timeStr: string,
    message: string
  ): Promise<ParsedTag | null> {
    const parsedTime = parseTime(timeStr)

    if (!parsedTime.isValid) {
      this.ctx.logger('spark:parser').warn(
        `Invalid time in tag: ${timeStr}`
      )
      return null
    }

    if (!message) {
      this.ctx.logger('spark:parser').warn(
        `Empty message in tag`
      )
      return null
    }

    return {
      type,
      data: {
        time: parsedTime.date,
        message,
        timeDescription: parsedTime.description
      },
      raw: ''
    }
  }

  /**
   * 执行标签动作
   */
  private async executeTag(tag: ParsedTag, session: any) {
    try {
      switch (tag.type) {
        case 'reminder':
          await this.createTask(session, tag.data, 'reminder', false)
          break

        case 'follow-up':
          await this.createTask(session, tag.data, 'follow_up', true)
          break
      }
    } catch (err) {
      this.ctx.logger('spark').error(`Failed to execute tag [${tag.type}]:`, err)
      throw err
    }
  }

  /**
   * 创建提醒任务
   */
  private async createTask(
    session: any,
    data: any,
    type: SparkScheduleType,
    autoCancelOnUserMessage: boolean
  ) {
    if (!session?.bot) {
      throw new Error('XML Spark tags require a real ChatLuna session')
    }

    return await this.adapter.createOnce({
      type,
      content: data.message,
      fireAt: data.time,
      session,
      createdBy: session.userId ?? 'spark',
      autoCancelOnUserMessage,
      metadata: {
        sparkOrigin: 'xml'
      }
    })
  }
}
