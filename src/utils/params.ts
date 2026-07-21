import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import { z } from 'zod'
import type { SparkTaskMetadata } from '../types'

export const LEGACY_SPARK_TRIGGER_PROVIDER_ID = 'chatluna-spark'
export const LEGACY_SPARK_PROVIDER_REMOVAL_ERROR = `Unknown trigger provider: ${LEGACY_SPARK_TRIGGER_PROVIDER_ID}`

const metadataShape = {
  sparkType: z.enum(['reminder', 'follow_up', 'scheduled', 'festival', 'proactive']),
  origin: z.enum(['tool', 'xml', 'scheduled', 'festival', 'proactive']),
  content: z.string().min(1),
  createdBy: z.string().min(1),
  autoCancelOnUserMessage: z.boolean(),
  autoDeleteAfterFire: z.boolean(),
  targetKey: z.string().min(1).optional(),
  configKey: z.string().min(1).optional()
}

export const sparkTaskMetadataSchema = z.object(metadataShape).strict()

export const legacySparkProviderConfigSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...metadataShape,
      mode: z.literal('once'),
      at: z.string().datetime({ offset: true }),
      timezone: z.string().min(1)
    })
    .strict(),
  z
    .object({
      ...metadataShape,
      mode: z.literal('cron'),
      expression: z.string().min(1),
      timezone: z.string().min(1)
    })
    .strict(),
  z
    .object({
      ...metadataShape,
      mode: z.literal('festival'),
      at: z.string().datetime({ offset: true }),
      timezone: z.string().min(1),
      festivalName: z.string().min(1),
      festivalDate: z.string().min(1)
    })
    .strict()
])

export type LegacySparkProviderConfig = z.infer<typeof legacySparkProviderConfigSchema>

export function getLegacySparkConfig(
  task: Pick<TriggerTask, 'condition'>
): LegacySparkProviderConfig | null {
  if (
    task.condition.type !== 'extension' ||
    task.condition.provider !== LEGACY_SPARK_TRIGGER_PROVIDER_ID
  ) {
    return null
  }
  const parsed = legacySparkProviderConfigSchema.safeParse(task.condition.config)
  return parsed.success ? parsed.data : null
}

export function metadataFromLegacy(config: LegacySparkProviderConfig): SparkTaskMetadata {
  return {
    sparkType: config.sparkType,
    origin: config.origin,
    content: config.content,
    createdBy: config.createdBy,
    autoCancelOnUserMessage: config.autoCancelOnUserMessage,
    autoDeleteAfterFire: config.autoDeleteAfterFire,
    ...(config.targetKey ? { targetKey: config.targetKey } : {}),
    ...(config.configKey ? { configKey: config.configKey } : {})
  }
}

export function hasLegacyProviderRemovalError(task: Pick<TriggerTask, 'state'>) {
  return task.state.lastError === LEGACY_SPARK_PROVIDER_REMOVAL_ERROR
}
