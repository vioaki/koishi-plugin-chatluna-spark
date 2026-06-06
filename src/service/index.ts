import { Context, Service } from 'koishi'
import { Config } from '../index'
import { SparkTriggerAdapter } from './trigger_adapter'

declare module 'koishi' {
  interface Context {
    spark: SparkService
  }
}

export class SparkService extends Service {
  public trigger: SparkTriggerAdapter

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'spark', true)
    this.trigger = new SparkTriggerAdapter(ctx, config)
  }

  async start() {
    await this.trigger.migrateLegacyPendingTasks()
  }
}
