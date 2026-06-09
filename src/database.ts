import { Context } from 'koishi'

export function extendDatabase(ctx: Context) {
  ctx.model.extend(
    'chatluna_spark_targets',
    {
      id: 'unsigned',
      name: 'string',
      enabled: 'boolean',
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
}
