import { Context, Service } from 'koishi'
import { Config } from '../config'
import type { CharacterAdapter } from './character'
import { SparkTargetRegistry } from './targets'
import { SparkTriggerAdapter } from './trigger_adapter'

declare module 'koishi' {
  interface Context {
    spark: SparkService
  }
}

export class SparkService extends Service {
  public trigger: SparkTriggerAdapter
  public character?: CharacterAdapter
  public targets: SparkTargetRegistry

  constructor(
    ctx: Context,
    public config: Config
  ) {
    super(ctx, 'spark', true)
    this.targets = new SparkTargetRegistry(ctx)
    this.trigger = new SparkTriggerAdapter(ctx, config)
  }
}
