import { Context } from 'koishi'
import { SparkTask, SparkTaskStatus, SparkTaskType, CancelEvent, TaskCondition } from './types'

export function extendDatabase(ctx: Context) {
  ctx.model.extend(
    'chatluna_spark_tasks',
    {
      id: 'unsigned',
      userId: 'string',
      channelId: 'string',
      guildId: 'string',
      triggerTime: 'timestamp',
      type: 'string',
      content: 'text',
      status: 'string',
      cancelOn: 'json',
      condition: 'json',
      tags: 'json',
      metadata: 'json',
      roomId: 'unsigned',
      createdAt: 'timestamp'
    },
    {
      primary: 'id',
      autoInc: true
    }
  )
}

export async function createSparkTask(
  ctx: Context,
  data: {
    userId: string
    channelId: string
    guildId?: string
    triggerTime: Date | number
    type: SparkTaskType
    content: string
    cancelOn?: CancelEvent[]
    condition?: TaskCondition
    tags?: string[]
    metadata?: Record<string, any>
    roomId?: number
  }
): Promise<SparkTask> {
  const triggerTime = typeof data.triggerTime === 'number'
    ? new Date(Date.now() + data.triggerTime * 1000)
    : data.triggerTime

  const task = await ctx.database.create('chatluna_spark_tasks', {
    userId: data.userId,
    channelId: data.channelId,
    guildId: data.guildId,
    triggerTime,
    type: data.type,
    content: data.content,
    status: SparkTaskStatus.PENDING,
    cancelOn: data.cancelOn || [],
    condition: data.condition,
    tags: data.tags || [],
    metadata: data.metadata || {},
    roomId: data.roomId,
    createdAt: new Date()
  })

  return task as any as SparkTask
}
