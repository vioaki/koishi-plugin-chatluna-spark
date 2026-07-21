import { Context, Session } from 'koishi'
import {
  SparkRouting,
  SparkEngine,
  SparkTarget,
  SparkTargetFeature,
  SparkTargetRecord,
  SparkTargetScope,
  SparkTargetType
} from '../types'

export const SPARK_TARGET_FEATURES: SparkTargetFeature[] = ['festival', 'scheduled', 'proactive']
const CHARACTER_TARGET_FEATURES: SparkTargetFeature[] = ['festival', 'proactive']

export interface SparkTargetEntry extends SparkTarget {
  id: string
  numericId?: number
  key: string
  bindingKey: string
  routing: SparkRouting
}

export interface AddTargetOptions {
  personal?: boolean
  engine?: SparkEngine
}

export class SparkTargetRegistry {
  constructor(private ctx: Context) {}

  async listEntries(): Promise<SparkTargetEntry[]> {
    return await this.listDatabaseEntries()
  }

  async listRuntimeTargets(feature?: SparkTargetFeature): Promise<SparkTargetEntry[]> {
    const targets = new Map<string, SparkTargetEntry>()

    for (const entry of await this.listEntries()) {
      if (!entry.enabled) continue
      if (feature && !entry.features.includes(feature)) continue

      const existing = targets.get(entry.key)
      if (!existing) {
        targets.set(entry.key, { ...entry })
        continue
      }

      existing.features = [...new Set([...existing.features, ...entry.features])]
      existing.enabled = existing.enabled || entry.enabled
    }

    return [...targets.values()]
  }

  async addFromSession(
    session: Session,
    name?: string,
    options: AddTargetOptions = {}
  ): Promise<SparkTargetEntry> {
    const target = this.targetFromSession(session, name, options)
    const existingDatabase = (await this.listDatabaseEntries()).find(
      (entry) => entry.key === this.getTargetKey(target)
    )
    if (existingDatabase) {
      const now = new Date()
      await this.ctx.database.set('chatluna_spark_targets', existingDatabase.numericId!, {
        name: target.name || existingDatabase.name,
        enabled: true,
        features: this.normalizeFeatures(target.features, target.engine),
        updatedAt: now
      })
      return (await this.getDatabaseEntry(existingDatabase.numericId!))!
    }

    const now = new Date()
    const row = await this.ctx.database.create('chatluna_spark_targets', {
      ...target,
      createdAt: now,
      updatedAt: now
    } as SparkTargetRecord)

    const entry = this.normalizeDatabaseEntry(row)
    if (!entry) throw new Error('created Spark target could not be normalized')
    return entry
  }

  async removeDatabaseTarget(id: number) {
    await this.ctx.database.remove('chatluna_spark_targets', [id])
  }

  async setDatabaseTargetEnabled(id: number, enabled: boolean) {
    await this.ctx.database.set('chatluna_spark_targets', id, {
      enabled,
      updatedAt: new Date()
    })
    return await this.getDatabaseEntry(id)
  }

  async renameDatabaseTarget(id: number, name: string) {
    await this.ctx.database.set('chatluna_spark_targets', id, {
      name: name.trim(),
      updatedAt: new Date()
    })
    return await this.getDatabaseEntry(id)
  }

  async setDatabaseTargetFeatures(id: number, features: SparkTargetFeature[]) {
    const target = await this.getDatabaseEntry(id)
    if (!target) return null
    await this.ctx.database.set('chatluna_spark_targets', id, {
      features: this.normalizeFeatures(features, target.engine),
      updatedAt: new Date()
    })
    return await this.getDatabaseEntry(id)
  }

  parseFeatures(input: string): SparkTargetFeature[] | null {
    const raw = input
      .split(/[,\s，、]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (raw.length === 0) return null

    if (raw.includes('all') || raw.includes('全部')) {
      return [...SPARK_TARGET_FEATURES]
    }
    if (raw.includes('none') || raw.includes('无')) {
      return []
    }

    const features = raw.filter((feature): feature is SparkTargetFeature =>
      SPARK_TARGET_FEATURES.includes(feature as SparkTargetFeature)
    )
    return features.length === raw.length ? [...new Set(features)] : null
  }

  parseDatabaseId(id: string | number): number | null {
    const raw = String(id).replace(/^db:/, '')
    if (!/^\d+$/.test(raw)) return null
    return Number(raw)
  }

  getTargetKey(
    target: Pick<
      SparkTarget,
      'engine' | 'type' | 'platform' | 'selfId' | 'userId' | 'guildId' | 'channelId' | 'scope'
    >
  ) {
    const bindingKey = this.getBindingKey(
      this.routingFromTarget(target),
      target.type === 'direct' ? 'personal' : target.scope
    )
    return target.engine === 'character' ? `character:${bindingKey}` : bindingKey
  }

  getBindingKey(routing: SparkRouting, scope: SparkTargetScope = 'personal') {
    return bindingKeyFromRouting(routing, scope)
  }

  getSessionBindingKeys(session: Session) {
    const keys = new Set<string>()
    keys.add(bindingKeyFromSession(session, 'personal'))
    if (!session.isDirect) {
      keys.add(bindingKeyFromSession(session, 'shared'))
    }
    return keys
  }

  routingFromTarget(
    target: Pick<SparkTarget, 'type' | 'platform' | 'selfId' | 'userId' | 'guildId' | 'channelId'>
  ): SparkRouting {
    const isDirect = target.type === 'direct'
    return {
      platform: target.platform,
      selfId: target.selfId,
      userId: target.userId,
      guildId: isDirect ? undefined : (target.guildId ?? target.channelId),
      channelId: target.channelId,
      isDirect
    }
  }

  private targetFromSession(
    session: Session,
    name?: string,
    options: AddTargetOptions = {}
  ): SparkTarget {
    if (!session.platform || !session.selfId || !session.userId) {
      throw new Error('Spark target session requires platform, selfId, and userId')
    }

    const engine = options.engine ?? 'chatluna'
    const isDirect = session.isDirect
    const type: SparkTargetType = isDirect ? 'direct' : 'group'
    if (engine === 'character' && !isDirect && options.personal) {
      throw new Error('Character group targets do not support personal scope')
    }
    const scope: SparkTargetScope = isDirect ? 'personal' : options.personal ? 'personal' : 'shared'
    const userId = session.userId
    const guildId = isDirect ? undefined : (session.guildId ?? session.channelId)
    const channelId = session.channelId ?? (isDirect ? undefined : guildId)

    return {
      name: name?.trim() || this.formatDefaultName(session, scope),
      enabled: true,
      engine,
      platform: session.platform,
      selfId: session.selfId,
      type,
      userId,
      guildId,
      channelId,
      scope,
      features: engine === 'character' ? [...CHARACTER_TARGET_FEATURES] : [...SPARK_TARGET_FEATURES]
    }
  }

  private formatDefaultName(session: Session, scope: SparkTargetScope) {
    if (session.isDirect) {
      return `${session.platform}:${session.userId}`
    }
    const target = scope === 'shared' ? (session.guildId ?? session.channelId) : session.userId
    return `${session.platform}:${target}`
  }

  private async listDatabaseEntries() {
    const rows = await this.ctx.database.get('chatluna_spark_targets', {})
    return rows
      .map((row) => this.normalizeDatabaseEntry(row))
      .filter((target): target is SparkTargetEntry => target != null)
  }

  private async getDatabaseEntry(id: number) {
    const [row] = await this.ctx.database.get('chatluna_spark_targets', { id })
    return row ? this.normalizeDatabaseEntry(row) : null
  }

  private normalizeDatabaseEntry(target: SparkTargetRecord): SparkTargetEntry | null {
    const normalized = this.normalizeTarget(target)
    if (!normalized) return null
    return this.toEntry(normalized, {
      id: `db:${target.id}`,
      numericId: target.id
    })
  }

  private normalizeTarget(target: Partial<SparkTarget>): SparkTarget | null {
    if (!target.platform || !target.selfId || !target.userId) return null

    const type: SparkTargetType = target.type === 'group' ? 'group' : 'direct'
    const scope: SparkTargetScope =
      type === 'direct' ? 'personal' : target.scope === 'personal' ? 'personal' : 'shared'

    const engine: SparkEngine = target.engine === 'character' ? 'character' : 'chatluna'
    return {
      name: target.name?.trim() || `${target.platform}:${target.userId}`,
      enabled: target.enabled !== false,
      engine,
      platform: target.platform,
      selfId: target.selfId,
      type,
      userId: target.userId,
      guildId: type === 'direct' ? undefined : (target.guildId ?? target.channelId),
      channelId: target.channelId,
      scope,
      features: this.normalizeFeatures(target.features, engine)
    }
  }

  private normalizeFeatures(features: unknown, engine: SparkEngine): SparkTargetFeature[] {
    if (engine === 'character') {
      if (!Array.isArray(features)) return [...CHARACTER_TARGET_FEATURES]
      if (features.length === 0) return []
      return [
        ...new Set(
          features.filter((feature): feature is SparkTargetFeature =>
            CHARACTER_TARGET_FEATURES.includes(feature as SparkTargetFeature)
          )
        )
      ]
    }
    if (!Array.isArray(features)) {
      return [...SPARK_TARGET_FEATURES]
    }
    if (features.length === 0) return []

    const normalized = features.filter((feature): feature is SparkTargetFeature =>
      SPARK_TARGET_FEATURES.includes(feature as SparkTargetFeature)
    )
    return normalized.length > 0 ? [...new Set(normalized)] : [...SPARK_TARGET_FEATURES]
  }

  private toEntry(
    target: SparkTarget,
    meta: Pick<SparkTargetEntry, 'id'> & { numericId?: number }
  ): SparkTargetEntry {
    const routing = this.routingFromTarget(target)
    const bindingKey = this.getTargetKey(target)
    return {
      ...target,
      ...meta,
      key: bindingKey,
      bindingKey,
      routing
    }
  }
}

export function bindingKeyFromRouting(routing: SparkRouting, scope: SparkTargetScope = 'personal') {
  if (scope === 'shared') {
    return `shared:${routing.platform}:${routing.selfId}:${routing.guildId ?? routing.channelId ?? routing.userId}`
  }
  if (routing.isDirect) {
    return `personal:${routing.platform}:${routing.selfId}:direct:${routing.userId}`
  }
  return `personal:${routing.platform}:${routing.selfId}:${routing.guildId ?? routing.channelId}:${routing.userId}`
}

export function bindingKeyFromSession(session: Session, scope: SparkTargetScope = 'personal') {
  if (!session.userId) throw new Error('Spark session requires userId')
  return bindingKeyFromRouting(
    {
      platform: session.platform,
      selfId: session.selfId,
      userId: session.userId,
      username: session.username,
      guildId: session.guildId,
      channelId: session.channelId,
      isDirect: session.isDirect
    },
    scope
  )
}
