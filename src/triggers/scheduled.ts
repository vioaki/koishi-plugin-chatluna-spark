import { Context } from 'koishi'
import { type TriggerTask } from 'koishi-plugin-chatluna-agent'
import { SparkService } from '../service'
import { Config, ScheduledConfig, ScheduledTaskConfig } from '../config'
import { SparkTargetEntry } from '../service/targets'
import { getSparkParams } from '../utils/params'
import { buildTriggerMessage } from '../utils/shared'

export class ScheduledTrigger {
  private _disposeTargets?: () => void

  constructor(
    private ctx: Context,
    private config: ScheduledConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    this.syncTargets().catch((err) => {
      this.ctx
        .logger('spark')
        .warn(`Scheduled target sync failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    this._disposeTargets = this.ctx.on('spark/targets-updated', async () => {
      await this.syncTargets()
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
        ? await this.sparkService.targets.listRuntimeTargets('scheduled')
        : []
    const activeConfigKeys = new Set<string>()

    for (const target of targets) {
      for (const task of configuredTasks) {
        const configKey = this.getConfigKey(target, task)
        activeConfigKeys.add(configKey)
        await this.syncTargetTask(target, task, configKey)
      }
    }

    const tasks = (await this.sparkService.trigger.listSparkTasks()).filter(
      (task) => task.providerKind === 'cron' && getSparkParams(task)?.sparkOrigin === 'scheduled'
    )

    for (const task of tasks) {
      const configKey = getSparkParams(task)?.configKey
      if (configKey && activeConfigKeys.has(configKey)) continue
      if (task.enabled) {
        await this.ctx.chatluna_agent.trigger.setEnabled(task.id, false)
      }
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

    const existing = await this.sparkService.trigger.findSparkTaskByConfigKey(
      target.bindingKey,
      configKey
    )
    const params = {
      spark: true,
      sparkType: 'scheduled',
      sparkOrigin: 'scheduled',
      sparkContent: task.prompt,
      targetKey: target.key,
      configKey,
      expression,
      missedRunPolicy: 'skip'
    }
    const wakeupTemplate = {
      message: buildTriggerMessage(this.mainConfig.triggerTemplate, task.prompt),
      replyTo: 'channel',
      execMode: 'chain',
      newConversation: false
    }

    if (existing) {
      await this.ctx.chatluna_agent.trigger.updateTask(existing.id, {
        enabled: true,
        name: `Spark scheduled: ${task.name} (${target.name})`,
        bindingKey: target.bindingKey,
        platform: target.routing.platform,
        selfId: target.routing.selfId,
        userId: target.routing.userId,
        username: target.routing.username ?? null,
        guildId: target.routing.guildId ?? null,
        channelId: target.routing.channelId ?? null,
        isDirect: target.routing.isDirect,
        params,
        wakeupTemplate
      } as Partial<TriggerTask>)
      return
    }

    await this.sparkService.trigger.createCron(target.routing, {
      type: 'scheduled',
      content: task.prompt,
      expression,
      name: `Spark scheduled: ${task.name} (${target.name})`,
      createdBy: 'spark',
      bindingKey: target.bindingKey,
      metadata: {
        sparkOrigin: 'scheduled',
        targetKey: target.key,
        configKey
      }
    })
  }

  private getConfigKey(target: SparkTargetEntry, task: ScheduledTaskConfig) {
    return `scheduled:${target.key}:${task.name}:${task.time}`
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
