import { Context, Session } from 'koishi'
import type {
  TriggerActor,
  TriggerCreateInput,
  TriggerExecution,
  TriggerRun,
  TriggerTarget,
  TriggerTask,
  TriggerUpdateInput
} from 'koishi-plugin-chatluna-agent'
import { Config } from '../config'
import { SparkRouting, SparkScheduleType, SparkTriggerMetadata, SparkTriggerOrigin } from '../types'
import {
  getSparkConfig,
  SPARK_TRIGGER_PROVIDER_ID,
  type SparkProviderConfig
} from '../utils/params'
import { buildTriggerMessage } from '../utils/shared'
import { bindingKeyFromRouting, bindingKeyFromSession } from './targets'
import { createSparkTriggerProvider } from './trigger_provider'

export interface CreateSparkTriggerInput {
  type: SparkScheduleType
  content: string
  fireAt: Date
  session?: Session
  routing?: SparkRouting
  bindingKey?: string
  createdBy?: string
  name?: string
  autoCancelOnUserMessage?: boolean
  autoDeleteAfterFire?: boolean
  metadata?: SparkTriggerMetadata
  replyTo?: 'channel' | 'user' | 'silent'
}

export interface CreateSparkCronInput extends Omit<
  CreateSparkTriggerInput,
  'fireAt' | 'session' | 'routing'
> {
  expression: string
}

export interface CreateSparkFestivalInput extends Omit<
  CreateSparkTriggerInput,
  'type' | 'session' | 'routing'
> {
  festivalName: string
  festivalDate: string
}

const PLUGIN_ACTOR: TriggerActor = {
  key: 'plugin:chatluna-spark',
  userId: 'plugin:chatluna-spark',
  authority: 4
}

const TRIGGER_TIMEOUT_SECONDS = 120

export class SparkTriggerAdapter {
  private _logger = this.ctx.logger('spark:trigger')
  private _disposeProvider?: () => void
  private _disposeAutoCancel?: () => void
  private _disposeCleanupReady?: () => void
  private _disposeCleanupTimer?: () => void
  private _started = false

  constructor(
    private ctx: Context,
    private config: Config
  ) {}

  start() {
    if (this._started) return
    this.assertTimezone()
    this.assertTriggerV2()
    this._disposeProvider = this.ctx.chatluna_agent.trigger.registerProvider(
      createSparkTriggerProvider()
    )
    const registered = this.ctx.chatluna_agent.trigger
      .listProviders()
      .some((provider) => provider.id === SPARK_TRIGGER_PROVIDER_ID)
    if (!registered) {
      this._disposeProvider()
      this._disposeProvider = undefined
      throw new Error(`Trigger provider ${SPARK_TRIGGER_PROVIDER_ID} was not registered`)
    }

    this.listenForAutoCancel()
    this.startExecutedAiTriggerCleanup()
    this._started = true
  }

  stop() {
    this._disposeAutoCancel?.()
    this._disposeAutoCancel = undefined
    this._disposeCleanupReady?.()
    this._disposeCleanupReady = undefined
    this._disposeCleanupTimer?.()
    this._disposeCleanupTimer = undefined
    this._disposeProvider?.()
    this._disposeProvider = undefined
    this._started = false
  }

  async createOnce(input: CreateSparkTriggerInput): Promise<TriggerTask> {
    if (input.fireAt.getTime() <= Date.now()) {
      throw new Error('fireAt must be in the future')
    }

    const source = this.resolveSource(input)
    const actor = await this.resolveActor(source.session)
    const routing = source.routing
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(source))
    const origin = this.resolveOrigin(input.metadata?.sparkOrigin, 'tool')
    const config: SparkProviderConfig = {
      mode: 'once',
      at: input.fireAt.toISOString(),
      timezone: this.config.timezone,
      sparkType: input.type,
      origin,
      content: input.content,
      createdBy: input.createdBy ?? input.session?.userId ?? routing.userId,
      autoCancelOnUserMessage: input.autoCancelOnUserMessage === true,
      autoDeleteAfterFire: this.shouldAutoDeleteAfterFire(input, origin),
      targetKey,
      ...(typeof input.metadata?.configKey === 'string'
        ? { configKey: input.metadata.configKey }
        : {})
    }

    return await this.createTask(actor, routing, config, {
      name: input.name ?? this.formatTaskName(input.type, input.content),
      replyTo: input.replyTo
    })
  }

  async createCron(
    source: Session | SparkRouting,
    input: CreateSparkCronInput
  ): Promise<TriggerTask> {
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    const origin = this.resolveOrigin(input.metadata?.sparkOrigin, 'scheduled')
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(resolved))
    const config: SparkProviderConfig = {
      mode: 'cron',
      expression: input.expression,
      timezone: this.config.timezone,
      sparkType: input.type,
      origin,
      content: input.content,
      createdBy: input.createdBy ?? resolved.routing.userId,
      autoCancelOnUserMessage: input.autoCancelOnUserMessage === true,
      autoDeleteAfterFire: this.shouldAutoDeleteAfterFire(input, origin),
      targetKey,
      ...(typeof input.metadata?.configKey === 'string'
        ? { configKey: input.metadata.configKey }
        : {})
    }

    return await this.createTask(actor, resolved.routing, config, {
      name: input.name ?? this.formatTaskName(input.type, input.content),
      replyTo: input.replyTo
    })
  }

  async createFestival(
    source: Session | SparkRouting,
    input: CreateSparkFestivalInput
  ): Promise<TriggerTask> {
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(resolved))
    const config: SparkProviderConfig = {
      mode: 'festival',
      at: input.fireAt.toISOString(),
      timezone: this.config.timezone,
      sparkType: 'festival',
      origin: 'festival',
      content: input.content,
      createdBy: input.createdBy ?? PLUGIN_ACTOR.key,
      autoCancelOnUserMessage: false,
      autoDeleteAfterFire: false,
      targetKey,
      festivalName: input.festivalName,
      festivalDate: input.festivalDate,
      ...(typeof input.metadata?.configKey === 'string'
        ? { configKey: input.metadata.configKey }
        : {})
    }

    return await this.createTask(actor, resolved.routing, config, {
      name: input.name ?? this.formatTaskName('festival', input.content),
      replyTo: input.replyTo
    })
  }

  async wakeup(source: Session | SparkRouting, content: string) {
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    return await this.ctx.chatluna_agent.trigger.wakeup(actor, {
      execution: this.buildExecution(content),
      target: this.buildTarget(resolved.routing, 'channel')
    })
  }

  async listSparkTasks(session?: Session) {
    const actor = await this.resolveActor(session)
    return await this.ctx.chatluna_agent.trigger.list(actor, {
      conditionType: SPARK_TRIGGER_PROVIDER_ID
    })
  }

  async getSparkTask(id: number, session?: Session) {
    const actor = await this.resolveActor(session)
    const task = await this.ctx.chatluna_agent.trigger.get(actor, id)
    return this.isSparkTask(task) ? task : null
  }

  async removeSparkTask(id: number, session?: Session) {
    await this.ctx.chatluna_agent.trigger.remove(await this.resolveActor(session), id)
  }

  async setSparkTaskEnabled(id: number, enabled: boolean, session?: Session) {
    return await this.ctx.chatluna_agent.trigger.setEnabled(
      await this.resolveActor(session),
      id,
      enabled
    )
  }

  async fireSparkTask(id: number, session?: Session): Promise<TriggerRun> {
    const actor = await this.resolveActor(session)
    const task = await this.ctx.chatluna_agent.trigger.get(actor, id)
    if (!this.isSparkTask(task)) throw new Error(`Spark task not found: ${id}`)

    const run = await this.ctx.chatluna_agent.trigger.fire(actor, id)
    const config = getSparkConfig(task)
    if (run.status === 'completed' && config?.autoDeleteAfterFire === true) {
      await this.ctx.chatluna_agent.trigger.remove(actor, id)
    }
    return run
  }

  async updateSparkTask(
    task: TriggerTask,
    input: {
      name?: string
      enabled?: boolean
      config?: SparkProviderConfig
      content?: string
      routing?: SparkRouting
      replyTo?: 'channel' | 'user' | 'silent'
    },
    session?: Session
  ) {
    const config = input.config ?? getSparkConfig(task)
    if (!config) throw new Error(`Spark task [${task.id}] has invalid provider config`)
    const nextConfig = input.content == null ? config : { ...config, content: input.content }
    const update: TriggerUpdateInput = {
      name: input.name ?? task.name,
      enabled: input.enabled ?? task.enabled,
      condition: {
        type: 'extension',
        provider: SPARK_TRIGGER_PROVIDER_ID,
        config: nextConfig
      },
      execution: input.content == null ? task.execution : this.buildExecution(input.content),
      target: input.routing
        ? this.buildTarget(input.routing, input.replyTo)
        : input.replyTo
          ? { ...task.target, delivery: this.resolveDelivery(input.replyTo) }
          : task.target
    }
    return await this.ctx.chatluna_agent.trigger.update(
      await this.resolveActor(session),
      task.id,
      update
    )
  }

  async findSparkTaskByConfigKey(targetKey: string, configKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find((task) => {
      const config = getSparkConfig(task)
      return config?.targetKey === targetKey && config.configKey === configKey
    })
  }

  async findSparkTaskByTargetKey(origin: SparkTriggerOrigin, targetKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find((task) => {
      const config = getSparkConfig(task)
      return config?.origin === origin && config.targetKey === targetKey
    })
  }

  isSparkTask(task: TriggerTask): boolean {
    return getSparkConfig(task) != null
  }

  async cleanupExecutedAiTriggers() {
    if (this.config.autoDeleteExecutedAiTriggers === false) return 0

    const tasks = await this.listSparkTasks()
    let removed = 0
    for (const task of tasks) {
      if (!this.isExecutedAiTriggerCleanupCandidate(task)) continue
      try {
        await this.ctx.chatluna_agent.trigger.remove(PLUGIN_ACTOR, task.id)
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

  async actorFromSession(session: Session): Promise<TriggerActor> {
    if (!session.userId) throw new Error('Spark trigger session requires userId')
    const user = session.user as { authority?: number } | undefined
    let authority = user?.authority
    if (authority == null && session.getUser) {
      authority = (await session.getUser(session.userId, ['authority']))?.authority
    }
    return {
      key: `${session.platform}:${session.selfId}:${session.userId}`,
      userId: session.userId,
      authority: authority ?? 0,
      session
    }
  }

  private async createTask(
    actor: TriggerActor,
    routing: SparkRouting,
    config: SparkProviderConfig,
    options: { name: string; replyTo?: 'channel' | 'user' | 'silent' }
  ) {
    const input: TriggerCreateInput = {
      name: options.name,
      condition: {
        type: 'extension',
        provider: SPARK_TRIGGER_PROVIDER_ID,
        config
      },
      execution: this.buildExecution(config.content),
      target: this.buildTarget(routing, options.replyTo)
    }
    const task = await this.ctx.chatluna_agent.trigger.create(actor, input)
    this._logger.info(`Created Spark ${config.sparkType} trigger [${task.id}]`)
    return task
  }

  private buildExecution(content: string): TriggerExecution {
    return {
      model: { type: 'default' },
      conversation: { type: 'route' },
      prompt: buildTriggerMessage(this.config.triggerTemplate, content),
      timeoutSeconds: TRIGGER_TIMEOUT_SECONDS,
      tools: { type: 'none' }
    }
  }

  private buildTarget(
    routing: SparkRouting,
    replyTo: 'channel' | 'user' | 'silent' = 'channel'
  ): TriggerTarget {
    return {
      bot: { platform: routing.platform, selfId: routing.selfId },
      destination: routing.isDirect
        ? { type: 'direct', userId: routing.userId }
        : {
            type: 'channel',
            ...(routing.guildId ? { guildId: routing.guildId } : {}),
            channelId: routing.channelId ?? routing.guildId ?? routing.userId
          },
      principalId: routing.userId,
      delivery: this.resolveDelivery(replyTo)
    }
  }

  private resolveDelivery(replyTo: 'channel' | 'user' | 'silent') {
    return replyTo === 'user' ? ('direct' as const) : replyTo
  }

  private resolveSource(input: CreateSparkTriggerInput) {
    if (input.session) return this.resolveExternalSource(input.session)
    if (input.routing) return this.resolveExternalSource(input.routing)
    throw new Error('Spark trigger requires a session or routing')
  }

  private resolveExternalSource(source: Session | SparkRouting): {
    session?: Session
    routing: SparkRouting
  } {
    if ('bot' in source) {
      if (!source.userId) throw new Error('Spark trigger session requires userId')
      return {
        session: source,
        routing: {
          platform: source.platform,
          selfId: source.selfId,
          userId: source.userId,
          username: source.username,
          guildId: source.guildId,
          channelId: source.channelId,
          isDirect: source.isDirect
        }
      }
    }
    return { routing: source }
  }

  private async resolveActor(session?: Session) {
    return session ? await this.actorFromSession(session) : PLUGIN_ACTOR
  }

  private async resolveTargetKey(source: { session?: Session; routing: SparkRouting }) {
    if (source.session) {
      try {
        return (await this.ctx.chatluna.conversation.resolveConstraint(source.session)).bindingKey
      } catch {
        return bindingKeyFromSession(source.session)
      }
    }
    return bindingKeyFromRouting(source.routing)
  }

  private resolveOrigin(value: unknown, fallback: SparkTriggerOrigin): SparkTriggerOrigin {
    return value === 'tool' ||
      value === 'xml' ||
      value === 'scheduled' ||
      value === 'festival' ||
      value === 'proactive'
      ? value
      : fallback
  }

  private shouldAutoDeleteAfterFire(
    input: Pick<CreateSparkTriggerInput, 'autoDeleteAfterFire'>,
    origin: SparkTriggerOrigin
  ) {
    if (input.autoDeleteAfterFire != null) return input.autoDeleteAfterFire
    if (this.config.autoDeleteExecutedAiTriggers === false) return false
    return origin === 'tool' || origin === 'xml'
  }

  private isExecutedAiTriggerCleanupCandidate(task: TriggerTask) {
    const config = getSparkConfig(task)
    return (
      config?.mode === 'once' &&
      config.autoDeleteAfterFire === true &&
      (config.origin === 'tool' || config.origin === 'xml') &&
      task.state.status === 'completed' &&
      task.state.runCount > 0 &&
      task.state.lastRunAt != null &&
      (task.state.lastError == null || task.state.lastError === '')
    )
  }

  private formatTaskName(type: SparkScheduleType, content: string) {
    const preview = content.length > 24 ? `${content.slice(0, 24)}...` : content
    return `Spark ${type}: ${preview}`
  }

  private listenForAutoCancel() {
    this._disposeAutoCancel = this.ctx.on('message', async (session) => {
      try {
        const keys = new Set([bindingKeyFromSession(session, 'personal')])
        if (!session.isDirect) keys.add(bindingKeyFromSession(session, 'shared'))
        try {
          keys.add((await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey)
        } catch {}

        const tasks = (await this.listSparkTasks(session)).filter((task) => {
          const config = getSparkConfig(task)
          return (
            task.enabled &&
            config?.autoCancelOnUserMessage === true &&
            config.targetKey != null &&
            keys.has(config.targetKey)
          )
        })
        const actor = await this.actorFromSession(session)
        for (const task of tasks) {
          await this.ctx.chatluna_agent.trigger.remove(actor, task.id)
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
    if (this.config.autoDeleteExecutedAiTriggers === false) return
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

  private assertTriggerV2() {
    const trigger = this.ctx.chatluna_agent?.trigger as unknown as Record<string, unknown>
    const required = [
      'create',
      'list',
      'get',
      'remove',
      'update',
      'setEnabled',
      'fire',
      'wakeup',
      'registerProvider',
      'listProviders'
    ]
    const missing = required.filter((name) => typeof trigger?.[name] !== 'function')
    if (missing.length > 0) {
      throw new Error(
        `ChatLuna Agent Trigger V2 (koishi-plugin-chatluna-agent >= 1.0.41) is required; missing methods: ${missing.join(', ')}`
      )
    }
  }

  private assertTimezone() {
    try {
      new Intl.DateTimeFormat('en', { timeZone: this.config.timezone }).format()
    } catch {
      throw new Error(`Invalid Spark timezone: ${this.config.timezone}`)
    }
  }
}
