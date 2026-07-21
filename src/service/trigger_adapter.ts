import { Context, Session } from 'koishi'
import type {
  TriggerActor,
  TriggerCondition,
  TriggerCreateInput,
  TriggerExecution,
  TriggerRun,
  TriggerTarget,
  TriggerTask,
  TriggerUpdateInput
} from 'koishi-plugin-chatluna-agent'
import { Config } from '../config'
import {
  SparkRouting,
  SparkScheduleType,
  SparkTaskMetadata,
  SparkTriggerMetadata,
  SparkTriggerOrigin
} from '../types'
import {
  getLegacySparkConfig,
  hasLegacyProviderRemovalError,
  LEGACY_SPARK_TRIGGER_PROVIDER_ID,
  metadataFromLegacy,
  type LegacySparkProviderConfig
} from '../utils/params'
import { buildTriggerMessage } from '../utils/shared'
import { attachSparkMetadata, getSparkMetadata, SparkTaskMetadataStore } from './task_metadata'
import { bindingKeyFromRouting, bindingKeyFromSession } from './targets'

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

export type CreateSparkFestivalInput = Omit<CreateSparkTriggerInput, 'type' | 'session' | 'routing'>

const PLUGIN_ACTOR: TriggerActor = {
  key: 'plugin:chatluna-spark',
  userId: 'plugin:chatluna-spark',
  authority: 4
}

const TRIGGER_TIMEOUT_SECONDS = 120

export class SparkTriggerAdapter {
  private _logger = this.ctx.logger('spark:trigger')
  private _metadata = new SparkTaskMetadataStore(this.ctx)
  private _disposeAutoCancel?: () => void
  private _disposeCleanupReady?: () => void
  private _disposeCleanupTimer?: () => void
  private _migration: Promise<void> = Promise.resolve()
  private _started = false

  constructor(
    private ctx: Context,
    private config: Config
  ) {}

  start() {
    if (this._started) return
    this.assertTimezone()
    this.assertTriggerV2()
    this._migration = this.migrateLegacyTasks().catch((err) => {
      this._logger.error(
        `Legacy Spark trigger migration failed: ${err instanceof Error ? err.message : String(err)}`
      )
    })
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
    this._started = false
  }

  async createOnce(input: CreateSparkTriggerInput): Promise<TriggerTask> {
    await this._migration
    if (input.fireAt.getTime() <= Date.now()) {
      throw new Error('fireAt must be in the future')
    }

    const source = this.resolveSource(input)
    const actor = await this.resolveActor(source.session)
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(source))
    const origin = this.resolveOrigin(input.metadata?.sparkOrigin, 'tool')
    const metadata: SparkTaskMetadata = {
      sparkType: input.type,
      origin,
      content: input.content,
      createdBy: input.createdBy ?? input.session?.userId ?? source.routing.userId,
      autoCancelOnUserMessage: input.autoCancelOnUserMessage === true,
      autoDeleteAfterFire: this.shouldAutoDeleteAfterFire(input, origin),
      targetKey,
      ...(typeof input.metadata?.configKey === 'string'
        ? { configKey: input.metadata.configKey }
        : {})
    }

    return await this.createTask(
      actor,
      source.routing,
      { type: 'once', at: input.fireAt.toISOString() },
      metadata,
      {
        name: input.name ?? this.formatTaskName(input.type, input.content),
        replyTo: input.replyTo
      }
    )
  }

  async createCron(
    source: Session | SparkRouting,
    input: CreateSparkCronInput
  ): Promise<TriggerTask> {
    await this._migration
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    const origin = this.resolveOrigin(input.metadata?.sparkOrigin, 'scheduled')
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(resolved))
    const metadata: SparkTaskMetadata = {
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

    return await this.createTask(
      actor,
      resolved.routing,
      {
        type: 'cron',
        expression: input.expression,
        timezone: this.config.timezone,
        misfire: 'skip'
      },
      metadata,
      {
        name: input.name ?? this.formatTaskName(input.type, input.content),
        replyTo: input.replyTo
      }
    )
  }

  async createFestival(source: Session | SparkRouting, input: CreateSparkFestivalInput) {
    await this._migration
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    const targetKey = input.bindingKey ?? (await this.resolveTargetKey(resolved))
    const metadata: SparkTaskMetadata = {
      sparkType: 'festival',
      origin: 'festival',
      content: input.content,
      createdBy: input.createdBy ?? PLUGIN_ACTOR.key,
      autoCancelOnUserMessage: false,
      autoDeleteAfterFire: false,
      targetKey,
      ...(typeof input.metadata?.configKey === 'string'
        ? { configKey: input.metadata.configKey }
        : {})
    }

    return await this.createTask(
      actor,
      resolved.routing,
      { type: 'once', at: input.fireAt.toISOString() },
      metadata,
      {
        name: input.name ?? this.formatTaskName('festival', input.content),
        replyTo: input.replyTo
      }
    )
  }

  async wakeup(source: Session | SparkRouting, content: string) {
    await this._migration
    const resolved = this.resolveExternalSource(source)
    const actor = await this.resolveActor(resolved.session)
    return await this.ctx.chatluna_agent.trigger.wakeup(actor, {
      execution: this.buildExecution(content),
      target: this.buildTarget(resolved.routing, 'channel')
    })
  }

  async listSparkTasks(session?: Session) {
    await this._migration
    const actor = await this.resolveActor(session)
    const [tasks, metadata] = await Promise.all([
      this.ctx.chatluna_agent.trigger.list(actor),
      this._metadata.list()
    ])
    return tasks.flatMap((task) => {
      const value = metadata.get(task.id)
      return value ? [attachSparkMetadata(task, value)] : []
    })
  }

  async getSparkTask(id: number, session?: Session) {
    await this._migration
    const actor = await this.resolveActor(session)
    const task = await this.ctx.chatluna_agent.trigger.get(actor, id)
    const metadata = await this._metadata.get(id)
    return metadata ? attachSparkMetadata(task, metadata) : null
  }

  async removeSparkTask(id: number, session?: Session) {
    await this._migration
    await this.removeTask(await this.resolveActor(session), id)
  }

  async setSparkTaskEnabled(id: number, enabled: boolean, session?: Session) {
    await this._migration
    const task = await this.ctx.chatluna_agent.trigger.setEnabled(
      await this.resolveActor(session),
      id,
      enabled
    )
    const metadata = await this._metadata.get(id)
    return metadata ? attachSparkMetadata(task, metadata) : task
  }

  async fireSparkTask(id: number, session?: Session): Promise<TriggerRun> {
    const actor = await this.resolveActor(session)
    const task = await this.getSparkTask(id, session)
    if (!task) throw new Error(`Spark task not found: ${id}`)

    const run = await this.ctx.chatluna_agent.trigger.fire(actor, id)
    const metadata = getSparkMetadata(task)
    if (run.status === 'completed' && metadata?.autoDeleteAfterFire === true) {
      await this.removeTask(actor, id)
    }
    return run
  }

  async updateSparkTask(
    task: TriggerTask,
    input: {
      name?: string
      enabled?: boolean
      condition?: TriggerCondition
      metadata?: SparkTaskMetadata
      content?: string
      routing?: SparkRouting
      replyTo?: 'channel' | 'user' | 'silent'
    },
    session?: Session
  ) {
    await this._migration
    const currentMetadata =
      input.metadata ?? getSparkMetadata(task) ?? (await this._metadata.get(task.id))
    if (!currentMetadata) throw new Error(`Spark task [${task.id}] has no metadata`)
    const nextMetadata =
      input.content == null ? currentMetadata : { ...currentMetadata, content: input.content }
    const update: TriggerUpdateInput = {
      name: input.name ?? task.name,
      enabled: input.enabled ?? task.enabled,
      condition: input.condition ?? task.condition,
      execution: input.content == null ? task.execution : this.buildExecution(input.content),
      target: input.routing
        ? this.buildTarget(input.routing, input.replyTo)
        : input.replyTo
          ? { ...task.target, delivery: this.resolveDelivery(input.replyTo) }
          : task.target
    }
    return await this.updateTask(await this.resolveActor(session), task, update, nextMetadata)
  }

  async findSparkTaskByConfigKey(targetKey: string, configKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find((task) => {
      const metadata = getSparkMetadata(task)
      return metadata?.targetKey === targetKey && metadata.configKey === configKey
    })
  }

  async findSparkTaskByTargetKey(origin: SparkTriggerOrigin, targetKey: string) {
    const tasks = await this.listSparkTasks()
    return tasks.find((task) => {
      const metadata = getSparkMetadata(task)
      return metadata?.origin === origin && metadata.targetKey === targetKey
    })
  }

  isSparkTask(task: TriggerTask): boolean {
    return getSparkMetadata(task) != null
  }

  async cleanupExecutedAiTriggers() {
    if (this.config.autoDeleteExecutedAiTriggers === false) return 0

    const tasks = await this.listSparkTasks()
    let removed = 0
    for (const task of tasks) {
      if (!this.isExecutedAiTriggerCleanupCandidate(task)) continue
      try {
        await this.removeTask(PLUGIN_ACTOR, task.id)
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
    condition: TriggerCondition,
    metadata: SparkTaskMetadata,
    options: { name: string; replyTo?: 'channel' | 'user' | 'silent' }
  ) {
    const input: TriggerCreateInput = {
      name: options.name,
      condition,
      execution: this.buildExecution(metadata.content),
      target: this.buildTarget(routing, options.replyTo)
    }
    const task = await this.ctx.chatluna_agent.trigger.create(actor, input)
    try {
      await this._metadata.save(task.id, metadata)
    } catch (err) {
      await this.ctx.chatluna_agent.trigger.remove(PLUGIN_ACTOR, task.id)
      throw err
    }
    this._logger.info(`Created Spark ${metadata.sparkType} trigger [${task.id}]`)
    return attachSparkMetadata(task, metadata)
  }

  private async updateTask(
    actor: TriggerActor,
    task: TriggerTask,
    input: TriggerUpdateInput,
    metadata: SparkTaskMetadata
  ) {
    const previousMetadata = await this._metadata.get(task.id)
    await this._metadata.save(task.id, metadata)
    try {
      const updated = await this.ctx.chatluna_agent.trigger.update(actor, task.id, input)
      return attachSparkMetadata(updated, metadata)
    } catch (err) {
      await this.restoreMetadata(task.id, previousMetadata)
      throw err
    }
  }

  private async removeTask(actor: TriggerActor, id: number) {
    await this.ctx.chatluna_agent.trigger.remove(actor, id)
    try {
      await this._metadata.remove(id)
    } catch (err) {
      this._logger.warn(
        `Failed to remove Spark metadata for trigger [${id}]: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async migrateLegacyTasks() {
    const tasks = await this.ctx.chatluna_agent.trigger.list(PLUGIN_ACTOR, {
      conditionType: LEGACY_SPARK_TRIGGER_PROVIDER_ID
    })
    let migrated = 0
    for (const task of tasks) {
      const legacy = getLegacySparkConfig(task)
      if (!legacy) {
        this._logger.warn(`Skipped invalid legacy Spark trigger [${task.id}]`)
        continue
      }
      try {
        await this.migrateLegacyTask(task, legacy)
        migrated++
      } catch (err) {
        this._logger.warn(
          `Failed to migrate legacy Spark trigger [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    if (migrated > 0) {
      this._logger.info(`Migrated ${migrated} legacy Spark trigger(s) to Trigger V2 built-ins`)
    }
    await this.removeOrphanMetadata()
  }

  private async migrateLegacyTask(task: TriggerTask, legacy: LegacySparkProviderConfig) {
    const metadata = metadataFromLegacy(legacy)
    const input: TriggerUpdateInput = {
      name: task.name,
      enabled: task.enabled,
      condition: this.legacyCondition(legacy),
      execution: task.execution,
      target: task.target
    }
    if (hasLegacyProviderRemovalError(task)) {
      await this.replaceLegacyTask(task, input, metadata)
      return
    }
    await this.updateTask(PLUGIN_ACTOR, task, input, metadata)
  }

  private async replaceLegacyTask(
    task: TriggerTask,
    input: TriggerUpdateInput,
    metadata: SparkTaskMetadata
  ) {
    const trigger = this.ctx.chatluna_agent.trigger
    const owner: TriggerActor = {
      key: task.ownerKey,
      userId: task.target.principalId,
      authority: PLUGIN_ACTOR.authority
    }
    if (task.enabled) await trigger.setEnabled(PLUGIN_ACTOR, task.id, false)

    let replacement: TriggerTask | undefined
    try {
      replacement = await trigger.create(owner, input)
      await this._metadata.save(replacement.id, metadata)
    } catch (err) {
      if (replacement) {
        try {
          await trigger.remove(PLUGIN_ACTOR, replacement.id)
        } catch (cleanupError) {
          this._logger.warn(
            `Failed to remove incomplete Spark trigger [${replacement.id}]: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          )
        }
      }
      await this.restoreLegacyTask(task)
      throw err
    }
    if (!replacement) throw new Error(`Failed to create replacement for Spark trigger [${task.id}]`)

    try {
      await trigger.remove(PLUGIN_ACTOR, task.id)
    } catch (err) {
      try {
        await trigger.remove(PLUGIN_ACTOR, replacement.id)
        await this._metadata.remove(replacement.id)
      } catch (cleanupError) {
        this._logger.warn(
          `Failed to roll back replacement Spark trigger [${replacement.id}]: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        )
      }
      await this.restoreLegacyTask(task)
      throw err
    }

    try {
      await this._metadata.remove(task.id)
    } catch (err) {
      this._logger.warn(
        `Failed to remove legacy Spark metadata [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    this._logger.info(
      `Rebuilt legacy Spark trigger [${task.id}] as [${replacement.id}] after provider removal`
    )
  }

  private legacyCondition(config: LegacySparkProviderConfig): TriggerCondition {
    if (config.mode === 'cron') {
      return {
        type: 'cron',
        expression: config.expression,
        timezone: config.timezone,
        misfire: 'skip'
      }
    }
    return { type: 'once', at: config.at }
  }

  private async restoreLegacyTask(task: TriggerTask) {
    if (!task.enabled) return
    try {
      await this.ctx.chatluna_agent.trigger.setEnabled(PLUGIN_ACTOR, task.id, true)
    } catch (err) {
      this._logger.warn(
        `Failed to restore legacy Spark trigger [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async restoreMetadata(taskId: number, metadata: SparkTaskMetadata | null) {
    if (metadata) await this._metadata.save(taskId, metadata)
    else await this._metadata.remove(taskId)
  }

  private async removeOrphanMetadata() {
    const [tasks, metadata] = await Promise.all([
      this.ctx.chatluna_agent.trigger.list(PLUGIN_ACTOR),
      this._metadata.list()
    ])
    const activeIds = new Set(tasks.map((task) => task.id))
    for (const taskId of metadata.keys()) {
      if (!activeIds.has(taskId)) await this._metadata.remove(taskId)
    }
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
    const metadata = getSparkMetadata(task)
    return (
      task.condition.type === 'once' &&
      metadata?.autoDeleteAfterFire === true &&
      (metadata.origin === 'tool' || metadata.origin === 'xml') &&
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
          const metadata = getSparkMetadata(task)
          return (
            task.enabled &&
            metadata?.autoCancelOnUserMessage === true &&
            metadata.createdBy === session.userId &&
            metadata.targetKey != null &&
            keys.has(metadata.targetKey)
          )
        })
        const actor = await this.actorFromSession(session)
        for (const task of tasks) {
          await this.removeTask(actor, task.id)
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
    const required = ['create', 'list', 'get', 'remove', 'update', 'setEnabled', 'fire', 'wakeup']
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
