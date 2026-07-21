export type SparkMode = 'tool' | 'xml' | 'both'
export type SparkEngine = 'chatluna' | 'character'

export type SparkScheduleType = 'reminder' | 'follow_up' | 'scheduled' | 'festival' | 'proactive'

export type SparkTriggerOrigin = 'tool' | 'xml' | 'scheduled' | 'festival' | 'proactive'

export type SparkTargetFeature = 'festival' | 'scheduled' | 'proactive'
export type SparkTargetType = 'direct' | 'group'
export type SparkTargetScope = 'personal' | 'shared'

export interface SparkTarget {
  name: string
  enabled: boolean
  engine: SparkEngine
  platform: string
  selfId: string
  type: SparkTargetType
  userId: string
  guildId?: string
  channelId?: string
  scope: SparkTargetScope
  features: SparkTargetFeature[]
}

export interface SparkTargetRecord extends SparkTarget {
  id: number
  createdAt: Date
  updatedAt: Date
}

export interface SparkRouting {
  platform: string
  selfId: string
  userId: string
  username?: string
  guildId?: string
  channelId?: string
  isDirect: boolean
}

export interface SparkTriggerMetadata {
  sparkOrigin?: SparkTriggerOrigin
  configKey?: string
}

export interface SparkTaskMetadata {
  sparkType: SparkScheduleType
  origin: SparkTriggerOrigin
  content: string
  createdBy: string
  autoCancelOnUserMessage: boolean
  autoDeleteAfterFire: boolean
  targetKey?: string
  configKey?: string
}

export interface SparkTaskMetadataRecord extends SparkTaskMetadata {
  taskId: number
  targetKey: string
  configKey: string
  createdAt: Date
  updatedAt: Date
}

// ===== Koishi 模块扩展 =====
declare module 'koishi' {
  interface Tables {
    chatluna_spark_targets: SparkTargetRecord
    chatluna_spark_task_meta: SparkTaskMetadataRecord
  }

  interface Events {
    'spark/targets-updated'(): void | Promise<void>
  }
}
