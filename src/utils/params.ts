import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import { z } from 'zod'

export const SPARK_TRIGGER_PROVIDER_ID = 'chatluna-spark'

const commonConfigShape = {
  timezone: z.string().min(1),
  sparkType: z.enum(['reminder', 'follow_up', 'scheduled', 'festival', 'proactive']),
  origin: z.enum(['tool', 'xml', 'scheduled', 'festival', 'proactive']),
  content: z.string().min(1),
  createdBy: z.string().min(1),
  autoCancelOnUserMessage: z.boolean(),
  autoDeleteAfterFire: z.boolean(),
  targetKey: z.string().min(1).optional(),
  configKey: z.string().min(1).optional()
}

export const sparkProviderConfigSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...commonConfigShape,
      mode: z.literal('once'),
      at: z.string().datetime({ offset: true })
    })
    .strict(),
  z
    .object({
      ...commonConfigShape,
      mode: z.literal('cron'),
      expression: z.string().min(1)
    })
    .strict(),
  z
    .object({
      ...commonConfigShape,
      mode: z.literal('festival'),
      at: z.string().datetime({ offset: true }),
      festivalName: z.string().min(1),
      festivalDate: z.string().min(1)
    })
    .strict()
])

export type SparkProviderConfig = z.infer<typeof sparkProviderConfigSchema>

export function getSparkConfig(task: Pick<TriggerTask, 'condition'>): SparkProviderConfig | null {
  if (
    !task.condition ||
    task.condition.type !== 'extension' ||
    task.condition.provider !== SPARK_TRIGGER_PROVIDER_ID
  ) {
    return null
  }

  const parsed = sparkProviderConfigSchema.safeParse(task.condition.config)
  return parsed.success ? parsed.data : null
}
