import { Context } from 'koishi'
import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import { Config, FestivalConfig } from '../config'
import { Festival, getFestivalsForYear } from '../data/festivals'
import { SparkService } from '../service'
import { SparkTargetEntry } from '../service/targets'
import { getSparkConfig, type SparkProviderConfig } from '../utils/params'

interface NextFestival {
  festival: Festival
  fireAt: Date
  dateKey: string
}

const FESTIVAL_HEAL_INTERVAL_MS = 60 * 60 * 1000
const FESTIVAL_OVERDUE_GRACE_MS = 60 * 1000

export class FestivalTrigger {
  private _disposeTargets?: () => void
  private _disposeHealTimer?: () => void

  constructor(
    private ctx: Context,
    private config: FestivalConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    this.runSync('Festival target sync')
    this._disposeTargets = this.ctx.on('spark/targets-updated', async () => {
      await this.runSync('Festival target refresh')
    })
    this._disposeHealTimer = this.ctx.setInterval(() => {
      this.healFestivalTasks().catch((err) => {
        this.ctx
          .logger('spark')
          .warn(`Festival task heal failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, FESTIVAL_HEAL_INTERVAL_MS)
  }

  stop() {
    this._disposeHealTimer?.()
    this._disposeHealTimer = undefined
    this._disposeTargets?.()
    this._disposeTargets = undefined
  }

  async syncTargets(now = new Date()) {
    const targets = this.config.enabled
      ? await this.sparkService.targets.listRuntimeTargets('festival')
      : []
    const activeTargetKeys = new Set(targets.map((target) => target.key))

    for (const target of targets) await this.syncTarget(target, now)

    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) => getSparkConfig(task)?.origin === 'festival'
    )
    for (const task of tasks) {
      const targetKey = getSparkConfig(task)?.targetKey
      if (targetKey && activeTargetKeys.has(targetKey)) continue
      if (task.enabled) await this.sparkService.trigger.setSparkTaskEnabled(task.id, false)
    }
  }

  async healFestivalTasks(now = new Date()) {
    if (!this.config.enabled) return 0

    const targets = await this.sparkService.targets.listRuntimeTargets('festival')
    const targetsByKey = new Map(targets.map((target) => [target.key, target]))
    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) => getSparkConfig(task)?.origin === 'festival'
    )
    let healed = 0

    for (const task of tasks) {
      const config = getSparkConfig(task)
      const target = config?.targetKey ? targetsByKey.get(config.targetKey) : undefined
      if (!config || !target || !this.needsHeal(task, now)) continue

      try {
        await this.updateFestivalTask(task, target, now, false)
        healed++
        this.ctx.logger('spark').info(`Refreshed Spark festival trigger [${task.id}]`)
      } catch (err) {
        this.ctx
          .logger('spark')
          .warn(
            `Failed to refresh Spark festival trigger [${task.id}]: ${err instanceof Error ? err.message : String(err)}`
          )
      }
    }

    return healed
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

  findNextFestival(after: Date, allowCurrentMinuteGrace = true): NextFestival | null {
    const zonedYear = getTimeZoneParts(after, this.mainConfig.timezone)?.year ?? after.getFullYear()
    const years = [zonedYear, zonedYear + 1]
    const candidates: NextFestival[] = []

    for (const year of years) {
      for (const festival of this.getFestivalsForYear(year)) {
        const fireAt = toFestivalFireAt(
          festival,
          year,
          after,
          allowCurrentMinuteGrace,
          this.mainConfig.timezone
        )
        if (!fireAt) continue
        candidates.push({ festival, fireAt, dateKey: `${year}-${festival.date}` })
      }
    }

    candidates.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    return candidates[0] ?? null
  }

  private async syncTarget(target: SparkTargetEntry, now: Date) {
    const existing = await this.sparkService.trigger.findSparkTaskByTargetKey(
      'festival',
      target.key
    )
    const allowGrace = (existing?.state.runCount ?? 0) === 0
    const next = this.findNextFestival(now, allowGrace)
    if (!next) {
      if (existing?.enabled) await this.sparkService.trigger.setSparkTaskEnabled(existing.id, false)
      return
    }

    if (existing) {
      await this.applyFestival(existing, target, next)
      return
    }

    const content = this.renderPrompt(next.festival)
    await this.sparkService.trigger.createFestival(target.routing, {
      content,
      fireAt: next.fireAt,
      festivalName: next.festival.name,
      festivalDate: next.dateKey,
      name: `Spark festival: ${target.name}`,
      createdBy: 'plugin:chatluna-spark',
      bindingKey: target.key,
      metadata: {
        sparkOrigin: 'festival',
        configKey: `festival:${target.key}`
      }
    })
  }

  private async updateFestivalTask(
    task: TriggerTask,
    target: SparkTargetEntry,
    now: Date,
    allowCurrentMinuteGrace: boolean
  ) {
    const next = this.findNextFestival(now, allowCurrentMinuteGrace)
    if (!next) {
      if (task.enabled) await this.sparkService.trigger.setSparkTaskEnabled(task.id, false)
      return
    }
    await this.applyFestival(task, target, next)
  }

  private async applyFestival(task: TriggerTask, target: SparkTargetEntry, next: NextFestival) {
    const content = this.renderPrompt(next.festival)
    const config: SparkProviderConfig = {
      mode: 'festival',
      at: next.fireAt.toISOString(),
      timezone: this.mainConfig.timezone,
      sparkType: 'festival',
      origin: 'festival',
      content,
      createdBy: 'plugin:chatluna-spark',
      autoCancelOnUserMessage: false,
      autoDeleteAfterFire: false,
      targetKey: target.key,
      configKey: `festival:${target.key}`,
      festivalName: next.festival.name,
      festivalDate: next.dateKey
    }
    await this.sparkService.trigger.updateSparkTask(task, {
      enabled: true,
      name: `Spark festival: ${target.name}`,
      config,
      content,
      routing: target.routing
    })
  }

  private needsHeal(task: TriggerTask, now: Date) {
    if (!task.enabled) return false
    if (task.state.status === 'completed' || task.state.status === 'error') return true
    if (!task.state.nextRunAt) return true
    const nextRunAt = new Date(task.state.nextRunAt).getTime()
    return Number.isFinite(nextRunAt) && nextRunAt <= now.getTime() - FESTIVAL_OVERDUE_GRACE_MS
  }

  private renderPrompt(festival: Festival) {
    return this.config.promptTemplate
      .replace(/{festivalName}/g, festival.name)
      .replace(/{festivalDesc}/g, festival.description)
  }

  private async runSync(label: string) {
    try {
      await this.syncTargets()
    } catch (err) {
      this.ctx
        .logger('spark')
        .warn(`${label} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export function toFestivalFireAt(
  festival: Festival,
  year: number,
  after: Date,
  allowCurrentMinuteGrace: boolean,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
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

  const fireAt = zonedDate(year, monthNumber, dayNumber, hourNumber, minuteNumber, timezone)
  if (!fireAt) return null
  if (fireAt.getTime() > after.getTime()) return fireAt
  if (!allowCurrentMinuteGrace) return null

  const configured = getTimeZoneParts(fireAt, timezone)
  const current = getTimeZoneParts(after, timezone)
  const sameConfiguredMinute =
    configured != null &&
    current != null &&
    configured.year === current.year &&
    configured.month === current.month &&
    configured.day === current.day &&
    configured.hour === current.hour &&
    configured.minute === current.minute
  return sameConfiguredMinute && after.getTime() - fireAt.getTime() < 60 * 1000
    ? new Date(after.getTime() + 1000)
    : null
}

function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
) {
  let value = Date.UTC(year, month - 1, day, hour, minute)
  for (let index = 0; index < 3; index++) {
    const parts = getTimeZoneParts(new Date(value), timezone)
    if (!parts) return null
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const expected = Date.UTC(year, month - 1, day, hour, minute)
    value += expected - actual
  }

  const result = new Date(value)
  const parts = getTimeZoneParts(result, timezone)
  if (
    !parts ||
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return null
  }
  return result
}

function getTimeZoneParts(date: Date, timezone: string) {
  try {
    const entries = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date)
    const values = Object.fromEntries(entries.map((entry) => [entry.type, entry.value]))
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute)
    }
  } catch {
    return null
  }
}
