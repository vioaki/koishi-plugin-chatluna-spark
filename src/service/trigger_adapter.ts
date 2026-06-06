import { Context, Session } from 'koishi'
import {
  bindingKeyFromSession,
  type TriggerTask,
  type WakeupRouting
} from 'koishi-plugin-chatluna-agent'
import { Config } from '../index'
import { SparkTask, SparkTaskStatus, SparkTaskType, SparkScheduleType } from '../types'
import { buildTriggerMessage } from '../utils/shared'

export interface CreateSparkTriggerInput {
  type: SparkScheduleType
  content: string
  fireAt: Date
  session?: Session
  routing?: WakeupRouting
  bindingKey?: string
  createdBy?: string
  name?: string
  autoCancelOnUserMessage?: boolean
  metadata?: Record<string, any>
  replyTo?: 'channel' | 'user' | 'silent'
}

export class SparkTriggerAdapter {
  private _logger = this.ctx.logger('spark:trigger')

  constructor(
    private ctx: Context,
    private config: Config
  ) {
    this.listenForAutoCancel()
  }

  async createOnce(input: CreateSparkTriggerInput): Promise<TriggerTask> {
    if (input.fireAt.getTime() <= Date.now()) {
      throw new Error('fireAt must be in the future')
    }

    const bindingKey = input.bindingKey ?? (
      input.session ? await this.resolveSessionBindingKey(input.session) : undefined
    )

    const task = await this.ctx.chatluna_agent.trigger.createTask(
      this.resolveCreateSource(input),
      {
        providerKind: 'once',
        name: input.name ?? this.formatTaskName(input.type, input.content),
        bindingKey,
        createdBy: input.createdBy ?? input.session?.userId ?? input.routing?.userId ?? 'spark',
        source: 'plugin',
        params: this.buildParams(input, {
          fireAt: input.fireAt.toISOString()
        }),
        wakeupTemplate: this.buildWakeupTemplate(input)
      } as any
    )

    this._logger.info(`Created Spark ${input.type} trigger [${task.id}]`)
    return task
  }

  async createCron(
    source: Session | WakeupRouting,
    input: Omit<CreateSparkTriggerInput, 'fireAt' | 'session' | 'routing'> & {
      expression: string
      missedRunPolicy?: 'skip' | 'fire_once'
    }
  ): Promise<TriggerTask> {
    const task = await this.ctx.chatluna_agent.trigger.createTask(
      source,
      {
        providerKind: 'cron',
        name: input.name ?? this.formatTaskName(input.type, input.content),
        bindingKey: input.bindingKey,
        createdBy: input.createdBy ?? 'spark',
        source: 'plugin',
        params: this.buildParams(input, {
          expression: input.expression,
          missedRunPolicy: input.missedRunPolicy ?? 'skip'
        }),
        wakeupTemplate: this.buildWakeupTemplate(input)
      } as any
    )

    this._logger.info(`Created Spark ${input.type} cron trigger [${task.id}]`)
    return task
  }

  async wakeup(
    source: Session | WakeupRouting,
    type: SparkScheduleType,
    content: string
  ) {
    return await this.ctx.chatluna_agent.trigger.wakeup(source, {
      message: buildTriggerMessage(this.config.triggerTemplate, content),
      replyTo: 'channel',
      execMode: 'chain',
      newConversation: false,
      source: {
        kind: 'spark',
        detail: {
          spark: true,
          sparkType: type,
          sparkContent: content,
          sparkOrigin: 'proactive'
        }
      }
    } as any)
  }

  async listSparkTasks() {
    const tasks = await this.ctx.chatluna_agent.trigger.listTasks()
    return tasks.filter(task => this.isSparkTask(task))
  }

  async findSparkTaskByConfigKey(bindingKey: string, configKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find(task =>
      task.enabled &&
      task.bindingKey === bindingKey &&
      (task.params as any)?.configKey === configKey
    )
  }

  isSparkTask(task: TriggerTask): boolean {
    return (task.params as any)?.spark === true
  }

  async migrateLegacyPendingTasks() {
    const tasks = await this.ctx.database.get('chatluna_spark_tasks', {
      status: SparkTaskStatus.PENDING
    })

    let migrated = 0
    for (const task of tasks) {
      if ((task.metadata as any)?.migratedToTriggerTaskId) {
        continue
      }

      try {
        const triggerTask = await this.migrateLegacyTask(task)
        await this.ctx.database.set('chatluna_spark_tasks', task.id, {
          status: SparkTaskStatus.CANCELLED,
          metadata: {
            ...(task.metadata ?? {}),
            migratedToTriggerTaskId: triggerTask.id,
            migratedAt: new Date()
          }
        })
        migrated++
      } catch (err) {
        this._logger.warn(`Failed to migrate legacy task [${task.id}]: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (migrated > 0) {
      this._logger.info(`Migrated ${migrated} legacy pending task(s) to ChatLuna Agent Trigger`)
    }
  }

  private async migrateLegacyTask(task: SparkTask) {
    const routing = this.routingFromLegacyTask(task)
    const legacyTriggerTime = new Date(task.triggerTime)
    const missed = legacyTriggerTime.getTime() <= Date.now()
    const fireAt = missed ? new Date(Date.now() + 1000) : legacyTriggerTime

    return await this.createOnce({
      type: this.mapLegacyType(task.type),
      content: task.content,
      fireAt,
      routing,
      createdBy: task.userId || 'spark',
      name: `Spark legacy #${task.id}`,
      autoCancelOnUserMessage: task.cancelOn?.includes('user-message' as any),
      metadata: {
        sparkOrigin: 'legacy',
        legacyTaskId: task.id,
        legacyTags: task.tags ?? [],
        legacyTriggerTime: legacyTriggerTime.toISOString(),
        legacyMissed: missed
      }
    })
  }

  private routingFromLegacyTask(task: SparkTask): WakeupRouting {
    const channelId = task.channelId
    const isDirect = channelId?.startsWith('private:') || !task.guildId
    const userId = isDirect && channelId?.startsWith('private:')
      ? channelId.replace('private:', '')
      : task.userId

    const bot = this.getFallbackBot()
    if (!bot && (!(task.metadata as any)?.platform || !(task.metadata as any)?.selfId)) {
      throw new Error('Cannot migrate legacy task without an available bot or stored routing metadata')
    }

    return {
      platform: (task.metadata as any)?.platform ?? bot.platform,
      selfId: (task.metadata as any)?.selfId ?? bot.selfId,
      userId,
      guildId: isDirect ? undefined : task.guildId ?? channelId,
      channelId: isDirect ? undefined : channelId,
      isDirect
    }
  }

  private getFallbackBot() {
    return Object.values(this.ctx.bots)[0]
  }

  private resolveCreateSource(input: CreateSparkTriggerInput): Session | WakeupRouting {
    if (input.session) return input.session
    if (input.routing) return input.routing
    throw new Error('Spark trigger requires a session or routing')
  }

  private buildWakeupTemplate(input: Pick<CreateSparkTriggerInput, 'content' | 'replyTo'>) {
    return {
      message: buildTriggerMessage(this.config.triggerTemplate, input.content),
      replyTo: input.replyTo ?? 'channel',
      execMode: 'chain',
      newConversation: false
    }
  }

  private buildParams(
    input: Pick<CreateSparkTriggerInput, 'type' | 'content' | 'autoCancelOnUserMessage' | 'metadata'>,
    params: Record<string, any>
  ) {
    return {
      ...params,
      ...(input.metadata ?? {}),
      spark: true,
      sparkType: input.type,
      sparkContent: input.content,
      autoCancelOnUserMessage: input.autoCancelOnUserMessage === true
    }
  }

  private mapLegacyType(type: SparkTaskType): SparkScheduleType {
    switch (type) {
      case SparkTaskType.MEMO:
        return 'reminder'
      case SparkTaskType.FOLLOW_UP:
        return 'follow_up'
      case SparkTaskType.SCHEDULED:
        return 'scheduled'
      case SparkTaskType.FESTIVAL:
        return 'festival'
      default:
        return 'reminder'
    }
  }

  private formatTaskName(type: SparkScheduleType, content: string) {
    const preview = content.length > 24 ? `${content.slice(0, 24)}...` : content
    return `Spark ${type}: ${preview}`
  }

  private listenForAutoCancel() {
    this.ctx.on('message', async (session) => {
      try {
        const bindingKey = await this.resolveSessionBindingKey(session)
        const tasks = (await this.listSparkTasks()).filter(task =>
          task.enabled &&
          task.bindingKey === bindingKey &&
          (task.params as any)?.autoCancelOnUserMessage === true
        )

        for (const task of tasks) {
          await this.ctx.chatluna_agent.trigger.removeTask(task.id)
          this._logger.info(`Auto-cancelled follow-up trigger [${task.id}] by user message`)
        }
      } catch (err) {
        this._logger.debug(`Auto-cancel check skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  private async resolveSessionBindingKey(session: Session) {
    try {
      return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey
    } catch {
      return bindingKeyFromSession(session)
    }
  }
}
