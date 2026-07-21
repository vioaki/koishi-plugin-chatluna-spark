import { Context } from 'koishi'
import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import { Config, FestivalConfig } from '../config'
import { Festival, getFestivalsForYear } from '../data/festivals'
import { SparkService } from '../service'
import { getSparkMetadata } from '../service/task_metadata'
import { SparkTargetEntry } from '../service/targets'
import type { SparkTaskMetadata } from '../types'

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
  private _customFestivals?: Festival[]

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
      this.runSync('Festival task heal')
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
    const chatlunaTargets = targets.filter((target) => target.engine === 'chatluna')
    const characterTargets = targets.filter((target) => target.engine === 'character')
    const activeTargetKeys = new Set(chatlunaTargets.map((target) => target.key))

    for (const target of chatlunaTargets) {
      try {
        await this.syncChatlunaTarget(target, now)
      } catch (err) {
        this.ctx
          .logger('spark')
          .warn(
            `Festival task sync failed for ${target.id}: ${err instanceof Error ? err.message : String(err)}`
          )
      }
    }

    if (this.sparkService.character) {
      for (const target of characterTargets) {
        try {
          await this.syncCharacterTarget(target, now)
        } catch (err) {
          this.ctx
            .logger('spark')
            .warn(
              `Character festival sync failed for ${target.id}: ${err instanceof Error ? err.message : String(err)}`
            )
        }
      }
      try {
        await this.sparkService.character.cleanupTargets(characterTargets)
      } catch (err) {
        this.ctx
          .logger('spark')
          .warn(
            `Character festival cleanup failed: ${err instanceof Error ? err.message : String(err)}`
          )
      }
    }

    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) => getSparkMetadata(task)?.origin === 'festival'
    )
    for (const task of tasks) {
      const targetKey = getSparkMetadata(task)?.targetKey
      if (targetKey && activeTargetKeys.has(targetKey)) continue
      if (task.enabled) await this.sparkService.trigger.setSparkTaskEnabled(task.id, false)
    }
  }

  getFestivalsForYear(year: number) {
    const builtinFestivals = getFestivalsForYear(year)
    return [...builtinFestivals, ...this.getCustomFestivals()]
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

  private async syncChatlunaTarget(target: SparkTargetEntry, now: Date) {
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
      const content = this.renderPrompt(next.festival)
      if (this.isCurrentFestivalTask(existing, next, content, now)) return
      await this.applyFestival(existing, target, next)
      return
    }

    const content = this.renderPrompt(next.festival)
    await this.sparkService.trigger.createFestival(target.routing, {
      content,
      fireAt: next.fireAt,
      name: `Spark festival: ${target.name}`,
      createdBy: 'plugin:chatluna-spark',
      bindingKey: target.key,
      metadata: {
        sparkOrigin: 'festival',
        configKey: `festival:${target.key}`
      }
    })
  }

  private async syncCharacterTarget(target: SparkTargetEntry, now: Date) {
    const next = this.findNextFestival(now, true)
    if (!next || !this.sparkService.character) return
    await this.sparkService.character.syncTarget(target, {
      fireAt: next.fireAt,
      content: this.renderPrompt(next.festival),
      festivalDate: next.dateKey
    })
  }

  private async applyFestival(task: TriggerTask, target: SparkTargetEntry, next: NextFestival) {
    const content = this.renderPrompt(next.festival)
    const metadata: SparkTaskMetadata = {
      sparkType: 'festival',
      origin: 'festival',
      content,
      createdBy: 'plugin:chatluna-spark',
      autoCancelOnUserMessage: false,
      autoDeleteAfterFire: false,
      targetKey: target.key,
      configKey: `festival:${target.key}`
    }
    await this.sparkService.trigger.updateSparkTask(task, {
      enabled: true,
      name: `Spark festival: ${target.name}`,
      condition: { type: 'once', at: next.fireAt.toISOString() },
      metadata,
      content,
      routing: target.routing
    })
  }

  private isCurrentFestivalTask(task: TriggerTask, next: NextFestival, content: string, now: Date) {
    const metadata = getSparkMetadata(task)
    const definitionMatches =
      task.enabled &&
      task.condition.type === 'once' &&
      task.condition.at === next.fireAt.toISOString() &&
      metadata?.origin === 'festival' &&
      metadata.content === content
    if (!definitionMatches) return false
    if (task.state.status === 'running') return true
    if (task.state.status !== 'waiting' || !task.state.nextRunAt) return false

    const nextRunAt = new Date(task.state.nextRunAt).getTime()
    return Number.isFinite(nextRunAt) && nextRunAt > now.getTime() - FESTIVAL_OVERDUE_GRACE_MS
  }

  private renderPrompt(festival: Festival) {
    return this.config.promptTemplate
      .replace(/{festivalName}/g, festival.name)
      .replace(/{festivalDesc}/g, festival.description)
  }

  private getCustomFestivals() {
    if (this._customFestivals) return this._customFestivals

    this._customFestivals = []
    for (const festival of this.config.custom ?? []) {
      const date = normalizeFestivalDate(festival.date)
      const time = normalizeClockTime(festival.time || this.config.defaultTime || '09:00')
      if (!date || !time) {
        this.ctx
          .logger('spark')
          .warn(`Ignoring invalid custom festival "${festival.name}": use MM-DD or MMDD and HH:mm`)
        continue
      }
      this._customFestivals.push({
        name: festival.name,
        date,
        time,
        description: festival.description,
        category: 'modern'
      })
    }
    return this._customFestivals
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
  const normalizedDate = normalizeFestivalDate(festival.date)
  if (!normalizedDate) return null
  const [month, day] = normalizedDate.split('-')
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

export function normalizeFestivalDate(value: string) {
  const input = value.trim()
  const match = input.match(/^(\d{1,2})-(\d{1,2})$/) ?? input.match(/^(\d{2})(\d{2})$/)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(2020, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
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
