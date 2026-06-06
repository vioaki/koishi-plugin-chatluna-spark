import { Context, Session } from 'koishi'
import { getFestivalsForYear, Festival } from '../data/festivals'
import { SparkService } from '../service'
import { isSessionInScope } from '../utils/scope'
import { Config } from '../index'

export interface FestivalConfig {
  enabled: boolean
  promptTemplate: string
  defaultTime: string
  custom: {
    name: string
    date: string
    time: string
    description: string
  }[]
}

export class FestivalTrigger {
  private _festivals: Festival[] = []
  private _created = new Set<string>()
  private _dispose?: () => void

  constructor(
    private ctx: Context,
    private config: FestivalConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {
    this.loadFestivals()
  }

  start() {
    if (this._festivals.length === 0) return

    this._dispose = this.ctx.on('message', async (session) => {
      await this.syncForSession(session)
    })
  }

  stop() {
    this._dispose?.()
    this._dispose = undefined
    this._created.clear()
  }

  private loadFestivals() {
    const currentYear = new Date().getFullYear()
    const builtinFestivals = getFestivalsForYear(currentYear)
    const customFestivals: Festival[] = (this.config.custom || []).map(c => ({
      name: c.name,
      date: c.date,
      time: c.time || this.config.defaultTime || '09:00',
      description: c.description,
      category: 'modern' as const
    }))

    this._festivals = [...builtinFestivals, ...customFestivals]
    this.ctx.logger('spark').info(`Loaded ${this._festivals.length} festivals for ${currentYear}`)
  }

  private async syncForSession(session: Session) {
    if (!isSessionInScope(session, this.mainConfig.scope)) {
      return
    }

    for (const festival of this._festivals) {
      const fireAt = this.toFireAt(festival)
      if (!fireAt) continue

      const bindingKey = await this.resolveBindingKey(session)
      const configKey = `festival:${fireAt.getFullYear()}:${festival.name}:${festival.date}:${festival.time}`
      const key = `${bindingKey}:${configKey}`
      if (this._created.has(key)) continue
      this._created.add(key)

      const prompt = this.config.promptTemplate
        .replace(/{festivalName}/g, festival.name)
        .replace(/{festivalDesc}/g, festival.description)

      try {
        if (await this.sparkService.trigger.findSparkTaskByConfigKey(bindingKey, configKey)) {
          continue
        }

        await this.sparkService.trigger.createOnce({
          type: 'festival',
          content: prompt,
          fireAt,
          session,
          name: `Spark festival: ${festival.name}`,
          createdBy: 'spark',
          bindingKey,
          metadata: {
            sparkOrigin: 'festival',
            configKey
          }
        } as any)
      } catch (err) {
        this.ctx.logger('spark').warn(`Failed to create festival trigger "${festival.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private toFireAt(festival: Festival) {
    const year = new Date().getFullYear()
    const [month, day] = festival.date.split('-').map(s => s.trim())
    const [hour, minute] = festival.time.split(':').map(s => s.trim())
    if (!month || !day || !hour || !minute) return null
    const fireAt = new Date(
      year,
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0,
      0
    )
    if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= Date.now()) return null
    return fireAt
  }

  private async resolveBindingKey(session: Session) {
    return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey
  }
}
