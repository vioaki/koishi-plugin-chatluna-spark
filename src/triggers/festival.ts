import { Context } from 'koishi'
import {
  type TriggerProvider,
  type TriggerTask,
  type WakeupTemplate
} from 'koishi-plugin-chatluna-agent'
import { z } from 'zod'
import { Config, FestivalConfig } from '../config'
import { Festival, getFestivalsForYear } from '../data/festivals'
import { SparkService } from '../service'
import { SparkTargetEntry } from '../service/targets'
import { getSparkParams, SparkTaskParams } from '../utils/params'
import { buildTriggerMessage } from '../utils/shared'

interface NextFestival {
  festival: Festival
  fireAt: Date
  dateKey: string
}

interface FestivalPrepareInput {
  params?: TriggerTask['params']
  wakeupTemplate?: WakeupTemplate
}

const FESTIVAL_OVERDUE_HEAL_INTERVAL_MS = 60 * 60 * 1000
const FESTIVAL_OVERDUE_HEAL_GRACE_MS = 60 * 60 * 1000

export class FestivalTrigger {
  private _disposeProvider?: () => void
  private _disposeTargets?: () => void
  private _disposeHealTimer?: () => void

  constructor(
    private ctx: Context,
    private config: FestivalConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    if (this.config.enabled) {
      this._disposeProvider = this.ctx.chatluna_agent.trigger.registerProvider(
        this.createProvider()
      )
      this._disposeHealTimer = this.ctx.setInterval(() => {
        this.healOverdueFestivalTasks().catch((err) => {
          this.ctx
            .logger('spark')
            .debug(
              `Festival overdue heal skipped: ${err instanceof Error ? err.message : String(err)}`
            )
        })
      }, FESTIVAL_OVERDUE_HEAL_INTERVAL_MS)
    }

    this.syncTargets().catch((err) => {
      this.ctx
        .logger('spark')
        .warn(`Festival target sync failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    this._disposeTargets = this.ctx.on('spark/targets-updated', async () => {
      await this.syncTargets()
    })
  }

  stop() {
    this._disposeHealTimer?.()
    this._disposeHealTimer = undefined
    this._disposeTargets?.()
    this._disposeTargets = undefined
    this._disposeProvider?.()
    this._disposeProvider = undefined
  }

  createProvider(): TriggerProvider {
    return {
      kind: 'spark_festival',
      name: 'Spark 节日祝福',
      description: 'Spark 根据节日配置循环唤醒代理，每个 target 只保留一个任务。',
      scheduled: true,
      needsMessage: false,
      schema: z.object({
        targetKey: z.string().optional().describe('Spark target binding key.')
      }),
      prepare: ({ input }) => this.prepareFestivalTask(input),
      afterFire: ({ task, firedAt }) => this.prepareFestivalTask(task, firedAt ?? new Date(), false)
    }
  }

  async syncTargets() {
    const targets = this.config.enabled
      ? await this.sparkService.targets.listRuntimeTargets('festival')
      : []
    const activeTargetKeys = new Set(targets.map((target) => target.key))

    for (const target of targets) {
      await this.syncTarget(target)
    }

    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) =>
        task.providerKind === 'spark_festival' && getSparkParams(task)?.sparkOrigin === 'festival'
    )

    for (const task of tasks) {
      const targetKey = getSparkParams(task)?.targetKey
      if (targetKey && activeTargetKeys.has(targetKey)) continue
      if (task.enabled) {
        await this.ctx.chatluna_agent.trigger.setEnabled(task.id, false)
      }
    }
  }

  async healOverdueFestivalTasks(now = new Date()) {
    if (!this.config.enabled) return 0

    const targets = await this.sparkService.targets.listRuntimeTargets('festival')
    const activeTargetKeys = new Set(targets.map((target) => target.key))
    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) =>
        task.providerKind === 'spark_festival' && getSparkParams(task)?.sparkOrigin === 'festival'
    )
    let healed = 0

    for (const task of tasks) {
      const targetKey = getSparkParams(task)?.targetKey
      if (!targetKey || !activeTargetKeys.has(targetKey)) continue
      if (!this.isOverdueFestivalTask(task, now)) continue

      try {
        await this.ctx.chatluna_agent.trigger.updateTask(task.id, {
          wakeupTemplate: task.wakeupTemplate ?? this.buildBaseWakeupTemplate()
        })
        healed++
        this.ctx.logger('spark').info(`Refreshed overdue Spark festival trigger [${task.id}]`)
      } catch (err) {
        this.ctx
          .logger('spark')
          .warn(
            `Failed to refresh overdue Spark festival trigger [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
          )
      }
    }

    return healed
  }

  prepareFestivalTask(
    input: FestivalPrepareInput,
    after = new Date(),
    allowCurrentMinuteGrace = true
  ): Partial<TriggerTask> {
    const next = this.findNextFestival(after, allowCurrentMinuteGrace)
    if (!next) {
      return {
        enabled: false,
        nextFireAt: null,
        params: {
          ...(input.params ?? {}),
          spark: true,
          sparkType: 'festival',
          sparkOrigin: 'festival'
        }
      }
    }

    const content = this.renderPrompt(next.festival)
    return {
      nextFireAt: next.fireAt,
      params: {
        ...(input.params ?? {}),
        spark: true,
        sparkType: 'festival',
        sparkOrigin: 'festival',
        sparkContent: content,
        festivalName: next.festival.name,
        festivalDate: next.dateKey
      },
      wakeupTemplate: {
        ...this.buildBaseWakeupTemplate(),
        ...(input.wakeupTemplate ?? {}),
        message: buildTriggerMessage(this.mainConfig.triggerTemplate, content)
      }
    }
  }

  getFestivalsForYear(year: number) {
    const builtinFestivals = getFestivalsForYear(year)
    const customFestivals: Festival[] = (this.config.custom || []).map((festival) => ({
      name: festival.name,
      date: festival.date,
      time: festival.time || this.config.defaultTime || '09:00',
      description: festival.description,
      category: 'modern' as const
    }))

    return [...builtinFestivals, ...customFestivals]
  }

  private async syncTarget(target: SparkTargetEntry) {
    const params = this.buildBaseParams(target, '节日祝福')
    const existing = await this.sparkService.trigger.findSparkTaskByTargetKey(
      'spark_festival',
      'festival',
      target.key
    )

    if (existing) {
      await this.ctx.chatluna_agent.trigger.updateTask(existing.id, {
        enabled: true,
        name: `Spark festival: ${target.name}`,
        bindingKey: target.bindingKey,
        platform: target.routing.platform,
        selfId: target.routing.selfId,
        userId: target.routing.userId,
        username: target.routing.username ?? null,
        guildId: target.routing.guildId ?? null,
        channelId: target.routing.channelId ?? null,
        isDirect: target.routing.isDirect,
        params,
        wakeupTemplate: this.buildBaseWakeupTemplate()
      })
      return
    }

    await this.ctx.chatluna_agent.trigger.createTask(target.routing, {
      providerKind: 'spark_festival',
      name: `Spark festival: ${target.name}`,
      bindingKey: target.bindingKey,
      createdBy: 'spark',
      source: 'plugin',
      params,
      wakeupTemplate: this.buildBaseWakeupTemplate()
    })
  }

  private buildBaseParams(target: SparkTargetEntry, content: string): SparkTaskParams {
    return {
      spark: true,
      sparkType: 'festival',
      sparkOrigin: 'festival',
      sparkContent: content,
      targetKey: target.key,
      configKey: `festival:${target.key}`
    }
  }

  private buildBaseWakeupTemplate(): WakeupTemplate {
    return {
      replyTo: 'channel',
      execMode: 'chain',
      newConversation: false
    }
  }

  private isOverdueFestivalTask(task: TriggerTask, now: Date) {
    if (!task.enabled || task.nextFireAt == null) return false

    const nextFireAt = new Date(task.nextFireAt).getTime()
    if (!Number.isFinite(nextFireAt)) return false

    return nextFireAt <= now.getTime() - FESTIVAL_OVERDUE_HEAL_GRACE_MS
  }

  private renderPrompt(festival: Festival) {
    return this.config.promptTemplate
      .replace(/{festivalName}/g, festival.name)
      .replace(/{festivalDesc}/g, festival.description)
  }

  private findNextFestival(after: Date, allowCurrentMinuteGrace: boolean): NextFestival | null {
    const years = [after.getFullYear(), after.getFullYear() + 1]
    const candidates: NextFestival[] = []

    for (const year of years) {
      for (const festival of this.getFestivalsForYear(year)) {
        const fireAt = toFestivalFireAt(festival, year, after, allowCurrentMinuteGrace)
        if (!fireAt) continue
        candidates.push({
          festival,
          fireAt,
          dateKey: `${year}-${festival.date}`
        })
      }
    }

    candidates.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    return candidates[0] ?? null
  }
}

export function toFestivalFireAt(
  festival: Festival,
  year: number,
  after: Date,
  allowCurrentMinuteGrace: boolean
) {
  const [month, day] = festival.date.split('-').map((part) => part.trim())
  const [hour, minute] = festival.time.split(':').map((part) => part.trim())
  if (!month || !day || !hour || !minute) return null
  if (
    !/^\d{1,2}$/.test(month) ||
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(hour) ||
    !/^\d{1,2}$/.test(minute)
  ) {
    return null
  }

  const monthNumber = Number(month)
  const dayNumber = Number(day)
  const hourNumber = Number(hour)
  const minuteNumber = Number(minute)
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31 ||
    hourNumber < 0 ||
    hourNumber > 23 ||
    minuteNumber < 0 ||
    minuteNumber > 59
  ) {
    return null
  }

  const fireAt = new Date(year, monthNumber - 1, dayNumber, hourNumber, minuteNumber, 0, 0)
  if (
    Number.isNaN(fireAt.getTime()) ||
    fireAt.getFullYear() !== year ||
    fireAt.getMonth() !== monthNumber - 1 ||
    fireAt.getDate() !== dayNumber
  ) {
    return null
  }

  if (fireAt.getTime() <= after.getTime()) {
    if (!allowCurrentMinuteGrace) return null

    const sameDay =
      fireAt.getFullYear() === after.getFullYear() &&
      fireAt.getMonth() === after.getMonth() &&
      fireAt.getDate() === after.getDate()
    const withinConfiguredMinute = after.getTime() - fireAt.getTime() < 60 * 1000
    return sameDay && withinConfiguredMinute ? new Date(after.getTime() + 1000) : null
  }

  return fireAt
}
