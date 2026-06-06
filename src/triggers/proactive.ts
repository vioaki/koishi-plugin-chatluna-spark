import { Context, Session } from 'koishi'
import { SparkService } from '../service'
import { isSessionInScope } from '../utils/scope'
import { Config } from '../index'

export interface ProactiveConfig {
  enabled: boolean
  checkInterval: number
  initialDelay: number
  initialProbability: number
  probabilityIncrease: number
  maxProbability: number
  sleepStart: string
  sleepEnd: string
  prompts: string[]
}

interface RoomState {
  session: Session
  lastChatTime: number
  currentProbability: number
}

export class ProactiveTrigger {
  private _timer: any
  private _roomStates: Map<string, RoomState> = new Map()
  private _dispose?: () => void

  constructor(
    private ctx: Context,
    private config: ProactiveConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    if (!this.config.enabled) return

    this._dispose = this.ctx.on('message', (session) => {
      if (!isSessionInScope(session, this.mainConfig.scope)) {
        return
      }

      this._roomStates.set(this.getSessionKey(session), {
        session,
        lastChatTime: Date.now(),
        currentProbability: 0
      })
    })

    this._timer = this.ctx.setInterval(() => {
      this.checkAndTrigger()
    }, this.config.checkInterval * 60 * 1000)

    this.ctx.logger('spark').info(
      `Proactive chat enabled (check every ${this.config.checkInterval}min, delay ${this.config.initialDelay}h)`
    )
  }

  stop() {
    this._dispose?.()
    this._dispose = undefined

    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }

    this._roomStates.clear()
  }

  private isInSleepTime(): boolean {
    const now = new Date()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const { sleepStart, sleepEnd } = this.config

    if (sleepStart > sleepEnd) {
      return currentTime >= sleepStart || currentTime < sleepEnd
    }

    return currentTime >= sleepStart && currentTime < sleepEnd
  }

  private async checkAndTrigger() {
    if (this.isInSleepTime()) return

    const now = Date.now()
    const initialDelayMs = this.config.initialDelay * 60 * 60 * 1000

    for (const state of this._roomStates.values()) {
      const timeSinceLastChat = now - state.lastChatTime
      if (timeSinceLastChat < initialDelayMs) continue

      if (state.currentProbability === 0) {
        state.currentProbability = this.config.initialProbability
      } else {
        state.currentProbability = Math.min(
          state.currentProbability + this.config.probabilityIncrease,
          this.config.maxProbability
        )
      }

      if (Math.random() > state.currentProbability) continue

      const prompts = this.config.prompts?.length ? this.config.prompts : ['主动来找用户聊天']
      const prompt = prompts[Math.floor(Math.random() * prompts.length)]

      try {
        const result = await this.sparkService.trigger.wakeup(state.session, 'proactive', prompt)
        if (result.ok || result.deferred) {
          state.lastChatTime = now
          state.currentProbability = 0
        }
      } catch (err) {
        this.ctx.logger('spark').warn(`Proactive wakeup failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private getSessionKey(session: Session) {
    return `${session.platform}:${session.selfId}:${session.guildId ?? 'direct'}:${session.channelId ?? session.userId}`
  }
}
