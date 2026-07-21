import { Context } from 'koishi'
import { Config, ScheduledConfig, ScheduledTaskConfig } from '../config'
import { SparkService } from '../service'
import { getSparkMetadata } from '../service/task_metadata'
import { SparkTargetEntry } from '../service/targets'
import type { SparkTaskMetadata } from '../types'

export class ScheduledTrigger {
  private _disposeTargets?: () => void

  constructor(
    private ctx: Context,
    private config: ScheduledConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    this.runSync('Scheduled target sync')
    this._disposeTargets = this.ctx.on('spark/targets-updated', async () => {
      await this.runSync('Scheduled target refresh')
    })

    if (this.config.enabled && this.config.tasks?.length) {
      this.ctx
        .logger('spark')
        .info(`Scheduled ${this.config.tasks.length} daily Spark trigger template(s)`)
    }
  }

  stop() {
    this._disposeTargets?.()
    this._disposeTargets = undefined
  }

  async syncTargets() {
    const configuredTasks = this.config.enabled ? (this.config.tasks ?? []) : []
    const targets =
      configuredTasks.length > 0
        ? (await this.sparkService.targets.listRuntimeTargets('scheduled')).filter(
            (target) => target.engine === 'chatluna'
          )
        : []
    const activeConfigKeys = new Set<string>()

    for (const target of targets) {
      for (const task of configuredTasks) {
        const configKey = this.getConfigKey(target, task)
        activeConfigKeys.add(configKey)
        try {
          await this.syncTargetTask(target, task, configKey)
        } catch (err) {
          this.ctx
            .logger('spark')
            .warn(
              `Scheduled task sync failed for ${target.id}/${task.name}: ${err instanceof Error ? err.message : String(err)}`
            )
        }
      }
    }

    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter((task) => {
      return getSparkMetadata(task)?.origin === 'scheduled'
    })

    for (const task of tasks) {
      const configKey = getSparkMetadata(task)?.configKey
      if (configKey && activeConfigKeys.has(configKey)) continue
      if (task.enabled) await this.sparkService.trigger.setSparkTaskEnabled(task.id, false)
    }
  }

  private async syncTargetTask(
    target: SparkTargetEntry,
    task: ScheduledTaskConfig,
    configKey: string
  ) {
    const expression = toDailyCronExpression(task.time)
    if (!expression) {
      this.ctx.logger('spark').warn(`Invalid scheduled task time "${task.time}" for "${task.name}"`)
      return
    }

    const existing = await this.sparkService.trigger.findSparkTaskByConfigKey(target.key, configKey)
    if (existing) {
      const metadata: SparkTaskMetadata = {
        sparkType: 'scheduled',
        origin: 'scheduled',
        content: task.prompt,
        createdBy: 'plugin:chatluna-spark',
        autoCancelOnUserMessage: false,
        autoDeleteAfterFire: false,
        targetKey: target.key,
        configKey
      }
      await this.sparkService.trigger.updateSparkTask(existing, {
        enabled: true,
        name: `Spark scheduled: ${task.name} (${target.name})`,
        condition: {
          type: 'cron',
          expression,
          timezone: this.mainConfig.timezone,
          misfire: 'skip'
        },
        metadata,
        content: task.prompt,
        routing: target.routing
      })
      return
    }

    await this.sparkService.trigger.createCron(target.routing, {
      type: 'scheduled',
      content: task.prompt,
      expression,
      name: `Spark scheduled: ${task.name} (${target.name})`,
      createdBy: 'plugin:chatluna-spark',
      bindingKey: target.key,
      metadata: {
        sparkOrigin: 'scheduled',
        configKey
      }
    })
  }

  private getConfigKey(target: SparkTargetEntry, task: ScheduledTaskConfig) {
    return `scheduled:${target.key}:${task.name}:${task.time}`
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

export function toDailyCronExpression(time: string) {
  const parts = time.split(':').map((s) => s.trim())
  if (parts.length !== 2) return null
  const [hour, minute] = parts
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null
  const hourNumber = Number(hour)
  const minuteNumber = Number(minute)
  if (hourNumber < 0 || hourNumber > 23 || minuteNumber < 0 || minuteNumber > 59) return null

  return `${minuteNumber} ${hourNumber} * * *`
}
