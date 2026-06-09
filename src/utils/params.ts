import type { TriggerTask, TriggerTaskParams } from 'koishi-plugin-chatluna-agent'
import type { SparkTriggerMetadata } from '../types'

export type SparkTaskParams = TriggerTaskParams & Partial<SparkTriggerMetadata>

export function getSparkParams(task: Pick<TriggerTask, 'params'>): SparkTaskParams | null {
  const params = task.params
  return params?.spark === true ? (params as SparkTaskParams) : null
}

export function isSparkParams(
  params: TriggerTaskParams | null | undefined
): params is SparkTaskParams {
  return params?.spark === true
}
