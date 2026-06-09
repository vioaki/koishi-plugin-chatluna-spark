import { Context, Session } from 'koishi'
import {
  bindingKeyFromSession,
  type TriggerTask,
  type TriggerTaskParams,
  type WakeupAction,
  type WakeupTemplate,
  type WakeupRouting
} from 'koishi-plugin-chatluna-agent'
import { Config } from '../config'
import { SparkScheduleType, SparkTriggerMetadata } from '../types'
import { getSparkParams, SparkTaskParams } from '../utils/params'
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
  autoDeleteAfterFire?: boolean
  metadata?: Partial<SparkTriggerMetadata> & Record<string, unknown>
  replyTo?: 'channel' | 'user' | 'silent'
}

type SparkWakeupOptions = WakeupTemplate & {
  source?: WakeupAction['source']
  requestId?: string
  signal?: AbortSignal
}

export class SparkTriggerAdapter {
  private _logger = this.ctx.logger('spark:trigger')
  private _disposeAutoCancel?: () => void
  private _disposeCleanupReady?: () => void
  private _disposeCleanupTimer?: () => void

  constructor(
    private ctx: Context,
    private config: Config
  ) {
    this.listenForAutoCancel()
    this.startExecutedAiTriggerCleanup()
  }

  stop() {
    this._disposeAutoCancel?.()
    this._disposeAutoCancel = undefined
    this._disposeCleanupReady?.()
    this._disposeCleanupReady = undefined
    this._disposeCleanupTimer?.()
    this._disposeCleanupTimer = undefined
  }

  async createOnce(input: CreateSparkTriggerInput): Promise<TriggerTask> {
    if (input.fireAt.getTime() <= Date.now()) {
      throw new Error('fireAt must be in the future')
    }

    const bindingKey =
      input.bindingKey ??
      (input.session ? await this.resolveSessionBindingKey(input.session) : undefined)

    const task = await this.ctx.chatluna_agent.trigger.createTask(this.resolveCreateSource(input), {
      providerKind: 'once',
      name: input.name ?? this.formatTaskName(input.type, input.content),
      bindingKey,
      createdBy: input.createdBy ?? input.session?.userId ?? input.routing?.userId ?? 'spark',
      source: 'plugin',
      params: this.buildParams(input, {
        fireAt: input.fireAt.toISOString()
      }),
      wakeupTemplate: this.buildWakeupTemplate(input)
    })

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
    const task = await this.ctx.chatluna_agent.trigger.createTask(source, {
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
    })

    this._logger.info(`Created Spark ${input.type} cron trigger [${task.id}]`)
    return task
  }

  async wakeup(source: Session | WakeupRouting, type: SparkScheduleType, content: string) {
    const options: SparkWakeupOptions = {
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
    }

    return await this.ctx.chatluna_agent.trigger.wakeup(source, options)
  }

  async listSparkTasks() {
    const tasks = await this.ctx.chatluna_agent.trigger.listTasks()
    return tasks.filter((task) => this.isSparkTask(task))
  }

  async findSparkTaskByConfigKey(bindingKey: string, configKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find(
      (task) => task.bindingKey === bindingKey && getSparkParams(task)?.configKey === configKey
    )
  }

  async findSparkTaskByTargetKey(providerKind: string, origin: string, targetKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find(
      (task) =>
        task.providerKind === providerKind &&
        getSparkParams(task)?.sparkOrigin === origin &&
        getSparkParams(task)?.targetKey === targetKey
    )
  }

  isSparkTask(task: TriggerTask): boolean {
    return getSparkParams(task) != null
  }

  async cleanupExecutedAiTriggers() {
    if (this.config.autoDeleteExecutedAiTriggers === false) {
      return 0
    }

    const tasks = await this.listSparkTasks()
    let removed = 0

    for (const task of tasks) {
      if (!this.isExecutedAiTriggerCleanupCandidate(task)) {
        continue
      }

      try {
        await this.ctx.chatluna_agent.trigger.removeTask(task.id)
        removed++
        this._logger.info(`Auto-deleted executed AI trigger [${task.id}]`)
      } catch (err) {
        this._logger.warn(
          `Failed to auto-delete executed AI trigger [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    return removed
  }

  private resolveCreateSource(input: CreateSparkTriggerInput): Session | WakeupRouting {
    if (input.session) return input.session
    if (input.routing) return input.routing
    throw new Error('Spark trigger requires a session or routing')
  }

  private buildWakeupTemplate(
    input: Pick<CreateSparkTriggerInput, 'content' | 'replyTo'>
  ): WakeupTemplate {
    return {
      message: buildTriggerMessage(this.config.triggerTemplate, input.content),
      replyTo: input.replyTo ?? 'channel',
      execMode: 'chain',
      newConversation: false
    }
  }

  private buildParams(
    input: Pick<
      CreateSparkTriggerInput,
      'type' | 'content' | 'autoCancelOnUserMessage' | 'autoDeleteAfterFire' | 'metadata'
    >,
    params: TriggerTaskParams
  ): SparkTaskParams {
    return {
      ...params,
      ...(input.metadata ?? {}),
      spark: true,
      sparkType: input.type,
      sparkContent: input.content,
      autoCancelOnUserMessage: input.autoCancelOnUserMessage === true,
      sparkAutoDeleteAfterFire: this.shouldAutoDeleteAfterFire(input)
    }
  }

  private shouldAutoDeleteAfterFire(
    input: Pick<CreateSparkTriggerInput, 'autoDeleteAfterFire' | 'metadata'>
  ) {
    if (input.autoDeleteAfterFire != null) {
      return input.autoDeleteAfterFire
    }
    if (this.config.autoDeleteExecutedAiTriggers === false) {
      return false
    }

    const origin = input.metadata?.sparkOrigin
    return origin === 'tool' || origin === 'xml'
  }

  private isExecutedAiTriggerCleanupCandidate(task: TriggerTask) {
    const params = getSparkParams(task)
    const origin = params?.sparkOrigin

    return (
      task.providerKind === 'once' &&
      params?.sparkAutoDeleteAfterFire === true &&
      (origin === 'tool' || origin === 'xml') &&
      task.enabled === false &&
      task.fireCount > 0 &&
      task.lastFiredAt != null &&
      (task.lastError == null || task.lastError === '')
    )
  }

  private formatTaskName(type: SparkScheduleType, content: string) {
    const preview = content.length > 24 ? `${content.slice(0, 24)}...` : content
    return `Spark ${type}: ${preview}`
  }

  private listenForAutoCancel() {
    this._disposeAutoCancel = this.ctx.on('message', async (session) => {
      try {
        const bindingKey = await this.resolveSessionBindingKey(session)
        const tasks = (await this.listSparkTasks()).filter(
          (task) =>
            task.enabled &&
            task.bindingKey === bindingKey &&
            getSparkParams(task)?.autoCancelOnUserMessage === true
        )

        for (const task of tasks) {
          await this.ctx.chatluna_agent.trigger.removeTask(task.id)
          this._logger.info(`Auto-cancelled follow-up trigger [${task.id}] by user message`)
        }
      } catch (err) {
        this._logger.debug(
          `Auto-cancel check skipped: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
  }

  private startExecutedAiTriggerCleanup() {
    if (this.config.autoDeleteExecutedAiTriggers === false) {
      return
    }

    const cleanup = () => {
      this.cleanupExecutedAiTriggers().catch((err) => {
        this._logger.debug(
          `Auto-delete cleanup skipped: ${err instanceof Error ? err.message : String(err)}`
        )
      })
    }

    this._disposeCleanupReady = this.ctx.on('ready', cleanup)
    this._disposeCleanupTimer = this.ctx.setInterval?.(cleanup, 60 * 1000)
  }

  private async resolveSessionBindingKey(session: Session) {
    try {
      return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey
    } catch {
      return bindingKeyFromSession(session)
    }
  }
}
