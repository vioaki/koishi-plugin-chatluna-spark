import { Context, Session } from 'koishi'
import {
  bindingKeyFromRouting,
  bindingKeyFromSession,
  type WakeupRouting
} from 'koishi-plugin-chatluna-agent'
import {
  SparkTarget,
  SparkTargetFeature,
  SparkTargetRecord,
  SparkTargetScope,
  SparkTargetType
} from '../types'

export const SPARK_TARGET_FEATURES: SparkTargetFeature[] = ['festival', 'scheduled', 'proactive']

export interface SparkTargetEntry extends SparkTarget {
  id: string
  numericId?: number
  key: string
  bindingKey: string
  routing: WakeupRouting
}

export interface AddTargetOptions {
  personal?: boolean
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
        features: this.normalizeFeatures(target.features),
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
    await this.ctx.database.set('chatluna_spark_targets', id, {
      features: this.normalizeFeatures(features),
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
      'type' | 'platform' | 'selfId' | 'userId' | 'guildId' | 'channelId' | 'scope'
    >
  ) {
    return this.getBindingKey(
      this.routingFromTarget(target),
      target.type === 'direct' ? 'personal' : target.scope
    )
  }

  getBindingKey(routing: WakeupRouting, scope: SparkTargetScope = 'personal') {
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
  ): WakeupRouting {
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

    const isDirect = session.isDirect
    const type: SparkTargetType = isDirect ? 'direct' : 'group'
    const scope: SparkTargetScope = isDirect ? 'personal' : options.personal ? 'personal' : 'shared'
    const userId = session.userId
    const guildId = isDirect ? undefined : (session.guildId ?? session.channelId)
    const channelId = session.channelId ?? (isDirect ? undefined : guildId)

    return {
      name: name?.trim() || this.formatDefaultName(session, scope),
      enabled: true,
      platform: session.platform,
      selfId: session.selfId,
      type,
      userId,
      guildId,
      channelId,
      scope,
      features: [...SPARK_TARGET_FEATURES]
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

    return {
      name: target.name?.trim() || `${target.platform}:${target.userId}`,
      enabled: target.enabled !== false,
      platform: target.platform,
      selfId: target.selfId,
      type,
      userId: target.userId,
      guildId: type === 'direct' ? undefined : (target.guildId ?? target.channelId),
      channelId: target.channelId,
      scope,
      features: this.normalizeFeatures(target.features)
    }
  }

  private normalizeFeatures(features: unknown): SparkTargetFeature[] {
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
    const bindingKey = this.getBindingKey(routing, target.scope)
    return {
      ...target,
      ...meta,
      key: bindingKey,
      bindingKey,
      routing
    }
  }
}
