import { Context } from 'koishi'
import { parseTime } from '../utils/time_parser'
import { createSparkTask } from '../database'
import { SparkTaskType, CancelEvent } from '../types'
import { extractSessionInfo } from '../utils/session_helper'

export interface ParsedTag {
  type: 'reminder' | 'follow-up' | 'memo'
  data: any
  raw: string
}

export class TagParser {
  // XML 开闭标签格式，只匹配特定的标签名
  // 匹配: <reminder time="30m">喝水</reminder>
  // 匹配: <follow-up time="2h">聊天</follow-up>
  // 匹配: <memo time="2024-01-15 09:00">生日</memo>
  private static readonly SUPPORTED_TAGS = ['reminder', 'follow-up', 'memo']
  private static readonly TAG_PATTERN = /<(reminder|follow-up|memo)\s+time="([^"]+)">([\s\S]*?)<\/\1>/g

  constructor(private ctx: Context) {}

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
          // 用户主动要求的提醒，不会自动取消
          await this.createTask(
            session,
            tag.data,
            SparkTaskType.REMINDER,
            [],
            ['user-created']
          )
          break

        case 'follow-up':
          // AI 主动聊天，用户发消息时自动取消
          await this.createTask(
            session,
            tag.data,
            SparkTaskType.FOLLOW_UP,
            [CancelEvent.USER_MESSAGE],
            ['ai-chat', 'auto-cancel']
          )
          break

        case 'memo':
          // AI 记住的事情，主动提醒用户，不会自动取消
          await this.createTask(
            session,
            tag.data,
            SparkTaskType.MEMO,
            [],
            ['ai-memo']
          )
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
    type: SparkTaskType,
    cancelOn: CancelEvent[],
    tags: string[] = []
  ) {
    const logger = this.ctx.logger('spark')

    // 使用公共工具函数提取用户信息
    const { realUserId, channelId, guildId } = extractSessionInfo(session)

    // 清理 @ 前缀
    let cleanChannelId = channelId
    if (cleanChannelId?.startsWith('@')) {
      cleanChannelId = cleanChannelId.substring(1)
    }

    // 验证必要信息
    if (!realUserId || !cleanChannelId) {
      const errorMsg = `Invalid session: missing userId or channelId (userId=${realUserId}, channelId=${cleanChannelId})`
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    // 创建任务（不保存 roomId，执行时再查询）
    const task = await createSparkTask(this.ctx, {
      userId: realUserId,
      channelId: cleanChannelId,
      guildId,
      triggerTime: data.time,
      type,
      content: data.message,
      cancelOn,
      tags
    })

    // 触发任务创建事件
    this.ctx.emit('spark/task-created', task)

    return task
  }
}
