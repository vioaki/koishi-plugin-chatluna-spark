import { StructuredTool, type ToolRunnableConfig, type ToolSchemaBase } from '@langchain/core/tools'
import { z } from 'zod'
import type { Context, Session } from 'koishi'
import { SparkTriggerAdapter } from '../service/trigger_adapter'
import { parseTime } from '../utils/time_parser'

type SparkToolSource = 'chatluna' | 'character'

interface SparkToolRunConfig {
  session?: Session
  source?: SparkToolSource
  conversationId?: string
  preset?: string
  userId?: string
  agentContext?: {
    requestId?: string
  }
}

const scheduleSchema = z.object({
  type: z
    .enum(['reminder', 'follow_up'])
    .describe(
      'Task type. Use reminder for definite future proactive messages, reminders, encouragement, check-ins, or remembered facts. Use follow_up only for optional later continuations; follow_up is cancelled automatically if the user sends a message before it fires.'
    ),
  time: z
    .string()
    .describe(
      'Trigger time. Convert natural language time to one of these formats: 30s, 5m, 2h, 1d, 1w, HH:mm, or yyyy-MM-dd HH:mm.'
    ),
  content: z
    .string()
    .min(1)
    .describe(
      'The concise instruction or message the assistant should act on when the trigger fires.'
    ),
  replyTo: z
    .enum(['channel', 'user', 'silent'])
    .optional()
    .describe('Where to send the reply. Defaults to channel.')
})

type SparkScheduleInput = z.infer<typeof scheduleSchema>

export function registerSparkScheduleTool(ctx: Context, adapter: SparkTriggerAdapter) {
  class SparkScheduleTool extends StructuredTool<
    ToolSchemaBase,
    SparkScheduleInput,
    SparkScheduleInput,
    string
  > {
    name = 'spark_schedule'
    description =
      'Create a future proactive Spark trigger. The assistant may call this on its own initiative when a future message would help, even without an explicit user request. Use reminder for definite future reminders, greetings, encouragement, care, or remembered facts to bring up later. Use follow_up only for optional later continuations that should be cancelled if the user replies first.'
    schema: ToolSchemaBase = scheduleSchema as unknown as ToolSchemaBase

    async _call(input: SparkScheduleInput, _runManager?: unknown, runConfig?: ToolRunnableConfig) {
      const configurable = getSparkToolConfig(runConfig)
      const session = configurable?.session
      const toolSource = this.getToolSource(configurable.source)

      if (!session?.bot) {
        return JSON.stringify({
          success: false,
          error: 'missing_session',
          message: 'Missing ChatLuna session.'
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
          createdBy: session.userId ?? configurable.userId ?? 'spark',
          autoCancelOnUserMessage,
          replyTo: input.replyTo,
          metadata: {
            sparkOrigin: 'tool',
            sparkToolSource: toolSource,
            conversationId: configurable.conversationId,
            preset: configurable.preset,
            requestId: configurable.agentContext?.requestId,
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

function getSparkToolConfig(runConfig?: ToolRunnableConfig): SparkToolRunConfig {
  return (runConfig?.configurable ?? {}) as SparkToolRunConfig
}
