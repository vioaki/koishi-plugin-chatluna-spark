import { Context, Session } from 'koishi'
import type { SparkTargetEntry } from './targets'

type CharacterRepeatRule = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'

interface CharacterWakeUpReply {
  uid: string
  rawTime: string
  reason: string
  naturalReason: string
  repeatRule?: CharacterRepeatRule
  triggerAt: number
  createdAt: number
}

interface CharacterTriggerStore {
  _config: unknown
  registerWakeUpReply(
    session: Session,
    rawTime: string,
    reason: string,
    repeatRule: CharacterRepeatRule,
    config: unknown
  ): Promise<false | CharacterWakeUpReply>
  setWakeUpReplies(session: Session, list: CharacterWakeUpReply[]): Promise<void>
  getWakeUpReplies(key: string): CharacterWakeUpReply[]
  setLastSession(session: Session): void
  getLastSession(key: string): Session | undefined
  keys(): string[]
}

interface CharacterContext extends Context {
  chatluna_character_trigger: CharacterTriggerStore
}

export interface CharacterFestivalInput {
  fireAt: Date
  content: string
  festivalDate: string
}

const CHARACTER_FESTIVAL_MARKER = /\[spark-character-festival:(\d+):(\d{4}-\d{2}-\d{2})\]/

export class CharacterFestivalAdapter {
  private ctx: CharacterContext
  private logger: ReturnType<Context['logger']>

  constructor(ctx: Context) {
    this.ctx = ctx as CharacterContext
    this.logger = this.ctx.logger('spark:character-festival')
  }

  start() {
    const store = this.ctx.chatluna_character_trigger as unknown as Record<string, unknown>
    const required = [
      'registerWakeUpReply',
      'setWakeUpReplies',
      'getWakeUpReplies',
      'setLastSession',
      'getLastSession',
      'keys'
    ]
    const missing = required.filter((method) => typeof store[method] !== 'function')
    if (missing.length > 0) {
      throw new Error(
        `ChatLuna Character >= 0.0.230 is required; missing trigger methods: ${missing.join(', ')}`
      )
    }
  }

  async syncTarget(target: SparkTargetEntry, input: CharacterFestivalInput) {
    const targetId = requireTargetId(target)
    const session = this.resolveSession(target)
    const store = this.ctx.chatluna_character_trigger
    const key = characterSessionKey(session)
    const marker = formatCharacterFestivalMarker(targetId, input.festivalDate)
    const reason = `${input.content}\n${marker}`
    const rawTime = formatCharacterTime(input.fireAt)

    store.setLastSession(session)
    const current = [...store.getWakeUpReplies(key)]
    const ownItems = current.filter(
      (item) => parseCharacterFestivalMarker(item.reason)?.targetId === targetId
    )
    if (
      ownItems.length === 1 &&
      ownItems[0].rawTime === rawTime &&
      ownItems[0].reason === reason &&
      (ownItems[0].repeatRule ?? 'once') === 'once'
    ) {
      return false
    }

    const pending = await store.registerWakeUpReply(session, rawTime, reason, 'once', store._config)
    if (!pending) {
      throw new Error(`Character rejected festival time: ${rawTime}`)
    }

    const retained = store
      .getWakeUpReplies(key)
      .filter((item) => parseCharacterFestivalMarker(item.reason)?.targetId !== targetId)
    await store.setWakeUpReplies(session, [...retained, pending])
    return true
  }

  async cleanupTargets(targets: SparkTargetEntry[]) {
    const activeRoutes = new Map<number, string>()
    const sessions = new Map<string, Session>()

    for (const target of targets) {
      const targetId = requireTargetId(target)
      const key = characterTargetSessionKey(target)
      activeRoutes.set(targetId, key)
      try {
        sessions.set(key, this.resolveSession(target))
      } catch {
        // A stored Character session can still be used while its bot is reconnecting.
      }
    }

    let removed = 0
    for (const key of this.ctx.chatluna_character_trigger.keys()) {
      const current = this.ctx.chatluna_character_trigger.getWakeUpReplies(key)
      let pendingRemoval = 0
      const retained = current.filter((item) => {
        const marker = parseCharacterFestivalMarker(item.reason)
        if (!marker || activeRoutes.get(marker.targetId) === key) return true
        pendingRemoval++
        return false
      })
      if (retained.length === current.length) continue

      const session = sessions.get(key) ?? this.ctx.chatluna_character_trigger.getLastSession(key)
      if (!session) {
        this.logger.warn(`Cannot clean Character festival wake-up without session: ${key}`)
        continue
      }
      await this.ctx.chatluna_character_trigger.setWakeUpReplies(session, retained)
      removed += pendingRemoval
    }
    return removed
  }

  private resolveSession(target: SparkTargetEntry): Session {
    const routing = target.routing
    const bot = this.ctx.bots.find(
      (candidate) =>
        candidate.selfId === routing.selfId &&
        (candidate.platform === routing.platform ||
          candidate.sid === `${routing.platform}:${routing.selfId}` ||
          routing.platform.startsWith(`${candidate.platform}:`))
    )
    if (!bot) {
      throw new Error(`Character bot unavailable: ${routing.platform}/${routing.selfId}`)
    }

    return bot.session({
      channel: {
        id: routing.channelId ?? routing.userId,
        type: routing.isDirect ? 1 : 0
      },
      guild: routing.isDirect
        ? undefined
        : { id: routing.guildId ?? routing.channelId ?? routing.userId },
      // Scheduled greetings are active messages; a placeholder ID makes QQ send them as replies.
      message: { content: '', elements: [] },
      selfId: bot.selfId,
      timestamp: Date.now(),
      type: 'message',
      user: { id: routing.userId, name: routing.username ?? routing.userId }
    })
  }
}

export function characterSessionKey(session: Pick<Session, 'isDirect' | 'userId' | 'guildId'>) {
  return `${session.isDirect ? 'private' : 'group'}:${session.isDirect ? session.userId : session.guildId}`
}

export function formatCharacterTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatCharacterFestivalMarker(targetId: number, festivalDate: string) {
  return `[spark-character-festival:${targetId}:${festivalDate}]`
}

export function parseCharacterFestivalMarker(reason: string) {
  const match = reason.match(CHARACTER_FESTIVAL_MARKER)
  if (!match) return null
  return { targetId: Number(match[1]), festivalDate: match[2] }
}

function requireTargetId(target: SparkTargetEntry) {
  if (target.numericId == null) {
    throw new Error(`Character festival target requires a database ID: ${target.id}`)
  }
  return target.numericId
}

function characterTargetSessionKey(target: SparkTargetEntry) {
  const routing = target.routing
  return `${routing.isDirect ? 'private' : 'group'}:${routing.isDirect ? routing.userId : (routing.guildId ?? routing.channelId)}`
}
