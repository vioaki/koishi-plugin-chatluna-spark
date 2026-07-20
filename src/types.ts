export type SparkMode = 'tool' | 'xml' | 'both'

export type SparkScheduleType = 'reminder' | 'follow_up' | 'scheduled' | 'festival' | 'proactive'

export type SparkTriggerOrigin = 'tool' | 'xml' | 'scheduled' | 'festival' | 'proactive'

export type SparkTargetFeature = 'festival' | 'scheduled' | 'proactive'
export type SparkTargetType = 'direct' | 'group'
export type SparkTargetScope = 'personal' | 'shared'

export interface SparkTarget {
  name: string
  enabled: boolean
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

// ===== Koishi 模块扩展 =====
declare module 'koishi' {
  interface Tables {
    chatluna_spark_targets: SparkTargetRecord
  }

  interface Events {
    'spark/targets-updated'(): void | Promise<void>
  }
}
