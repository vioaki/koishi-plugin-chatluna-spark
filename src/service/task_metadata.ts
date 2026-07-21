import { Context } from 'koishi'
import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import type { SparkTaskMetadata, SparkTaskMetadataRecord } from '../types'
import { sparkTaskMetadataSchema } from '../utils/params'

const metadataByTask = new WeakMap<TriggerTask, SparkTaskMetadata>()

export function attachSparkMetadata<T extends TriggerTask>(task: T, metadata: SparkTaskMetadata) {
  metadataByTask.set(task, metadata)
  return task
}

export function getSparkMetadata(task: TriggerTask) {
  return metadataByTask.get(task) ?? null
}

export class SparkTaskMetadataStore {
  constructor(private ctx: Context) {}

  async get(taskId: number) {
    const [row] = await this.ctx.database.get('chatluna_spark_task_meta', { taskId })
    return row ? this.fromRecord(row) : null
  }

  async list() {
    const rows = await this.ctx.database.get('chatluna_spark_task_meta', {})
    const result = new Map<number, SparkTaskMetadata>()
    for (const row of rows) {
      const metadata = this.fromRecord(row)
      if (metadata) result.set(row.taskId, metadata)
    }
    return result
  }

  async save(taskId: number, metadata: SparkTaskMetadata) {
    const parsed = sparkTaskMetadataSchema.parse(metadata)
    const now = new Date()
    const value = {
      ...parsed,
      targetKey: parsed.targetKey ?? '',
      configKey: parsed.configKey ?? '',
      updatedAt: now
    }
    const [existing] = await this.ctx.database.get('chatluna_spark_task_meta', { taskId })
    if (existing) {
      await this.ctx.database.set('chatluna_spark_task_meta', { taskId }, value)
    } else {
      await this.ctx.database.create('chatluna_spark_task_meta', {
        taskId,
        ...value,
        createdAt: now
      })
    }
    return parsed
  }

  async remove(taskId: number) {
    await this.ctx.database.remove('chatluna_spark_task_meta', { taskId })
  }

  private fromRecord(row: SparkTaskMetadataRecord) {
    const parsed = sparkTaskMetadataSchema.safeParse({
      sparkType: row.sparkType,
      origin: row.origin,
      content: row.content,
      createdBy: row.createdBy,
      autoCancelOnUserMessage: row.autoCancelOnUserMessage,
      autoDeleteAfterFire: row.autoDeleteAfterFire,
      ...(row.targetKey ? { targetKey: row.targetKey } : {}),
      ...(row.configKey ? { configKey: row.configKey } : {})
    })
    return parsed.success ? parsed.data : null
  }
}
