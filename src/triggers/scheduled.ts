import { Context, Session } from 'koishi'
import { SparkService } from '../service'
import { isSessionInScope } from '../utils/scope'
import { Config } from '../index'

export interface ScheduledConfig {
  enabled: boolean
  tasks: ScheduledTask[]
}

export interface ScheduledTask {
  name: string
  time: string
  prompt: string
}

export class ScheduledTrigger {
  private _created = new Set<string>()
  private _dispose?: () => void

  constructor(
    private ctx: Context,
    private config: ScheduledConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    if (!this.config.tasks || this.config.tasks.length === 0) return

    this._dispose = this.ctx.on('message', async (session) => {
      await this.syncForSession(session)
    })

    this.ctx.logger('spark').info(`Scheduled ${this.config.tasks.length} daily Spark trigger template(s)`)
  }

  stop() {
    this._dispose?.()
    this._dispose = undefined
    this._created.clear()
  }

  private async syncForSession(session: Session) {
    if (!isSessionInScope(session, this.mainConfig.scope)) {
      return
    }

    for (const task of this.config.tasks) {
      const expression = this.toCron(task.time)
      if (!expression) continue

      const bindingKey = await this.resolveBindingKey(session)
      const configKey = `scheduled:${task.name}:${task.time}`
      const key = `${bindingKey}:${configKey}`
      if (this._created.has(key)) continue
      this._created.add(key)

      try {
        if (await this.sparkService.trigger.findSparkTaskByConfigKey(bindingKey, configKey)) {
          continue
        }

        await this.sparkService.trigger.createCron(session, {
          type: 'scheduled',
          content: task.prompt,
          expression,
          name: `Spark scheduled: ${task.name}`,
          createdBy: 'spark',
          bindingKey,
          metadata: {
            sparkOrigin: 'scheduled',
            configKey
          }
        } as any)
      } catch (err) {
        this.ctx.logger('spark').warn(`Failed to create scheduled trigger "${task.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private toCron(time: string) {
    const parts = time.split(':').map(s => s.trim())
    if (parts.length !== 2) return null
    const [hour, minute] = parts
    if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null
    return `${Number(minute)} ${Number(hour)} * * *`
  }

  private async resolveBindingKey(session: Session) {
    return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey
  }
}
