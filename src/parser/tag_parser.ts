import { Context, Session } from 'koishi'
import { SparkTriggerAdapter } from '../service/trigger_adapter'
import { SparkScheduleType } from '../types'
import { parseTime } from '../utils/time_parser'
import { TAG_PATTERN } from '../utils/shared'

export type SparkTagType = 'reminder' | 'follow-up'
export type SparkTagFailureReason = 'invalid_time' | 'empty_message' | 'create_failed'

export interface ParsedTagData {
  time: Date
  message: string
  timeDescription: string
}

export interface ParsedTag {
  type: SparkTagType
  data: ParsedTagData
  raw: string
}

export interface SparkTagFailure {
  raw: string
  reason: SparkTagFailureReason
  detail: string
}

export interface SparkTagParseResult {
  cleanText: string
  results: ParsedTag[]
  failures: SparkTagFailure[]
}

export function parseSparkTags(text: string): SparkTagParseResult {
  const results: ParsedTag[] = []
  const failures: SparkTagFailure[] = []
  let cleanText = text

  TAG_PATTERN.lastIndex = 0
  const matches = [...text.matchAll(TAG_PATTERN)]
  TAG_PATTERN.lastIndex = 0

  for (const match of matches) {
    const [raw, type, timeStr, content] = match
    cleanText = cleanText.replace(raw, '').trim()

    const message = content.trim()
    const parsedTime = parseTime(timeStr)
    if (!parsedTime.isValid) {
      failures.push({
        raw,
        reason: 'invalid_time',
        detail: `Invalid time: ${timeStr}`
      })
      continue
    }

    if (!message) {
      failures.push({
        raw,
        reason: 'empty_message',
        detail: 'Empty message'
      })
      continue
    }

    results.push({
      type: type as SparkTagType,
      data: {
        time: parsedTime.date,
        message,
        timeDescription: parsedTime.description
      },
      raw
    })
  }

  return { cleanText, results, failures }
}

export class TagParser {
  constructor(
    private ctx: Context,
    private adapter: SparkTriggerAdapter
  ) {}

  async parseAndExecute(text: string, session: Session): Promise<SparkTagParseResult> {
    const parsed = parseSparkTags(text)

    for (const tag of parsed.results) {
      try {
        await this.executeTag(tag, session)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        parsed.failures.push({
          raw: tag.raw,
          reason: 'create_failed',
          detail
        })
        this.ctx.logger('spark').error(`Failed to execute tag [${tag.type}]:`, err)
      }
    }

    for (const failure of parsed.failures) {
      this.ctx.logger('spark:parser').warn(`${failure.reason}: ${failure.detail}`)
    }

    return parsed
  }

  private async executeTag(tag: ParsedTag, session: Session) {
    switch (tag.type) {
      case 'reminder':
        await this.createTask(session, tag.data, 'reminder', false)
        break

      case 'follow-up':
        await this.createTask(session, tag.data, 'follow_up', true)
        break
    }
  }

  private async createTask(
    session: Session,
    data: ParsedTagData,
    type: SparkScheduleType,
    autoCancelOnUserMessage: boolean
  ) {
    if (!session.bot) {
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
