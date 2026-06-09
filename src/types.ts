import { Context, Session } from 'koishi'

export type SparkMode = 'tool' | 'xml' | 'both'

export type SparkScheduleType = 'reminder' | 'follow_up' | 'scheduled' | 'festival' | 'proactive'

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

export interface SparkTriggerMetadata {
  spark: true
  sparkType: SparkScheduleType
  sparkContent: string
  sparkOrigin?: 'tool' | 'xml' | 'scheduled' | 'festival' | 'proactive'
  sparkToolSource?: 'chatluna' | 'character'
  autoCancelOnUserMessage?: boolean
  configKey?: string
  conversationId?: string
  preset?: string
  requestId?: string
  character?: boolean
  sparkAutoDeleteAfterFire?: boolean
  targetKey?: string
  festivalName?: string
  festivalDate?: string
}

export interface ChatLunaToolRegistration {
  description: string
  selector: () => boolean
  meta?: Record<string, unknown>
  createTool: () => unknown
}

export interface ChatLunaMiddlewareChain {
  after(name: string): {
    before(name: string): void
  }
}

export interface ChatLunaChatChainLike {
  middleware<TContext>(
    name: string,
    handler: (session: Session, context: TContext) => number | Promise<number>
  ): ChatLunaMiddlewareChain
}

export interface ChatLunaServiceLike {
  platform: {
    registerTool(name: string, spec: ChatLunaToolRegistration): () => void
  }
  chatChain?: ChatLunaChatChainLike
  conversation: {
    resolveConstraint(session: Session): Promise<{ bindingKey: string }>
  }
}

// ===== Koishi 模块扩展 =====
declare module 'koishi' {
  interface Context {
    chatluna: ChatLunaServiceLike
  }

  interface Tables {
    chatluna_spark_targets: SparkTargetRecord
  }

  interface Events {
    'chatluna/after-chat'(
      conversationId: string,
      sourceMessage: unknown,
      responseMessage: unknown,
      promptVariables: unknown,
      chatInterface: unknown,
      session: Session
    ): void | Promise<void>

    'spark/targets-updated'(): void | Promise<void>
  }
}
