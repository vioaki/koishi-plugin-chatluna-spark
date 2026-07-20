import { CronExpressionParser } from 'cron-parser'
import type { TriggerProviderDef, TriggerProviderOccurrence } from 'koishi-plugin-chatluna-agent'
import {
  SPARK_TRIGGER_PROVIDER_ID,
  sparkProviderConfigSchema,
  type SparkProviderConfig
} from '../utils/params'

export function createSparkTriggerProvider(): TriggerProviderDef {
  return {
    id: SPARK_TRIGGER_PROVIDER_ID,
    label: 'ChatLuna Spark',
    description: 'Spark 的提醒、配置定时任务和节日问候调度。',
    kind: 'scheduled',
    schema: sparkProviderConfigSchema,
    defaultConfig: {
      mode: 'cron',
      expression: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      sparkType: 'scheduled',
      origin: 'scheduled',
      content: '定时任务',
      createdBy: 'plugin:chatluna-spark',
      autoCancelOnUserMessage: false,
      autoDeleteAfterFire: false
    } satisfies SparkProviderConfig,
    next: ({ config, after }) => nextSparkOccurrence(sparkProviderConfigSchema.parse(config), after)
  }
}

export function nextSparkOccurrence(
  config: SparkProviderConfig,
  after: Date
): TriggerProviderOccurrence | null {
  if (config.mode === 'cron') {
    const at = new Date(
      CronExpressionParser.parse(config.expression, {
        currentDate: after,
        tz: config.timezone
      })
        .next()
        .getTime()
    )
    return { at, occurrenceKey: at.toISOString() }
  }

  const at = new Date(config.at)
  if (!Number.isFinite(at.getTime()) || at.getTime() <= after.getTime()) return null
  return {
    at,
    periodKey: config.mode === 'festival' ? config.festivalDate : undefined,
    occurrenceKey: at.toISOString()
  }
}
