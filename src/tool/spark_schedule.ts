import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Context } from 'koishi'
import { SparkTriggerAdapter } from '../service/trigger_adapter'
import { parseTime } from '../utils/time_parser'
import { isSessionInScope, ScopeConfig } from '../utils/scope'

type SparkToolSource = 'chatluna' | 'character'

interface SparkToolRunConfig {
  configurable?: {
    session?: any
    source?: SparkToolSource
    conversationId?: string
    preset?: string
    userId?: string
    agentContext?: {
      requestId?: string
    }
  }
}

const scheduleSchema = z.object({
  type: z.enum(['reminder', 'follow_up']).describe('Task type. Use reminder for definite future reminders or remembered facts that should be brought up later. Use follow_up for optional later check-ins; follow_up is cancelled automatically if the user sends a message before it fires.'),
  time: z.string().describe('Trigger time. Supports 30s, 5m, 2h, 1d, 1w, HH:mm, or yyyy-MM-dd HH:mm.'),
  content: z.string().min(1).describe('The concise instruction or message the assistant should act on when the trigger fires.'),
  replyTo: z.enum(['channel', 'user', 'silent']).optional().describe('Where to send the reply. Defaults to channel.')
})

export function registerSparkScheduleTool(
  ctx: Context,
  adapter: SparkTriggerAdapter,
  scope?: ScopeConfig
) {
  class SparkScheduleTool extends StructuredTool {
    name = 'spark_schedule'
    description = 'Create a future Spark trigger. Use reminder when the user asks to be reminded later, or when the assistant should remember and bring up something at a definite future time. Use follow_up only for optional later check-ins that should be cancelled if the user replies first.'
    schema: any = scheduleSchema

    async _call(input: any, _runManager?: any, runConfig?: SparkToolRunConfig) {
      const configurable = runConfig?.configurable
      const session = configurable?.session
      const toolSource = this.getToolSource(configurable?.source)

      if (!session?.bot) {
        return JSON.stringify({
          success: false,
          error: 'missing_session',
          message: 'Missing ChatLuna session.'
        })
      }

      if (!isSessionInScope(session, scope)) {
        return JSON.stringify({
          success: false,
          error: 'out_of_scope',
          message: 'Spark is not enabled for this session.'
        })
      }

      const parsed = parseTime(input.time)
      if (!parsed.isValid) {
        return JSON.stringify({
          success: false,
          error: 'invalid_time',
          message: `Invalid time: ${input.time}`
        })
      }

      try {
        const autoCancelOnUserMessage = input.type === 'follow_up'
        const task = await adapter.createOnce({
          type: input.type,
          content: input.content,
          fireAt: parsed.date,
          session,
          createdBy: session.userId ?? configurable?.userId ?? 'spark',
          autoCancelOnUserMessage,
          replyTo: input.replyTo,
          metadata: {
            sparkOrigin: 'tool',
            sparkToolSource: toolSource,
            conversationId: configurable?.conversationId,
            preset: configurable?.preset,
            requestId: configurable?.agentContext?.requestId,
            character: toolSource === 'character'
          }
        })

        return JSON.stringify({
          success: true,
          taskId: task.id,
          type: input.type,
          fireAt: parsed.date.toISOString(),
          autoCancelOnUserMessage,
          message: 'Spark trigger created.'
        })
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: 'create_failed',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }

    private getToolSource(source: unknown): SparkToolSource {
      return source === 'character' ? 'character' : 'chatluna'
    }
  }

  const dispose = ctx.chatluna.platform.registerTool('spark_schedule', {
    description: new SparkScheduleTool().description,
    selector: () => true,
    meta: {
      source: 'extension',
      group: 'spark',
      tags: ['spark', 'trigger', 'reminder'],
      defaultAvailability: {
        enabled: true,
        main: true,
        chatluna: true,
        characterScope: 'all'
      }
    },
    createTool: () => new SparkScheduleTool()
  })

  ctx.on('dispose', dispose)
}
