import { Context } from 'koishi'

export function extendDatabase(ctx: Context) {
  ctx.model.extend(
    'chatluna_spark_targets',
    {
      id: 'unsigned',
      name: 'string',
      enabled: 'boolean',
      engine: { type: 'string', initial: 'chatluna' },
      platform: 'string',
      selfId: 'string',
      type: 'string',
      userId: 'string',
      guildId: 'string',
      channelId: 'string',
      scope: 'string',
      features: 'json',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    },
    {
      primary: 'id',
      autoInc: true
    }
  )

  ctx.model.extend(
    'chatluna_spark_task_meta',
    {
      taskId: 'unsigned',
      sparkType: 'string',
      origin: 'string',
      content: 'text',
      createdBy: 'string',
      autoCancelOnUserMessage: 'boolean',
      autoDeleteAfterFire: 'boolean',
      targetKey: 'string',
      configKey: 'string',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    },
    {
      primary: 'taskId'
    }
  )
}
