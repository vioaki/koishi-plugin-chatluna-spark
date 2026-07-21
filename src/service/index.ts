import { Context, Service } from 'koishi'
import { Config } from '../config'
import type { CharacterFestivalAdapter } from './character_festival'
import { SparkTargetRegistry } from './targets'
import { SparkTriggerAdapter } from './trigger_adapter'

declare module 'koishi' {
  interface Context {
    spark: SparkService
  }
}

export class SparkService extends Service {
  public trigger: SparkTriggerAdapter
  public characterFestival?: CharacterFestivalAdapter
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
