import { Context, Session } from 'koishi'
import { SparkService } from '../service'
import { Config, ProactiveConfig } from '../config'
import { SparkTargetEntry } from '../service/targets'

export interface RoomState {
  target: SparkTargetEntry
  lastChatTime: number
  currentProbability: number
}

export class ProactiveTrigger {
  private _disposeTimer?: () => void
  private _roomStates: Map<string, RoomState> = new Map()
  private _disposeMessage?: () => void
  private _disposeTargets?: () => void

  constructor(
    private ctx: Context,
    private config: ProactiveConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {}

  start() {
    if (!this.config.enabled) return

    this.refreshTargets().catch((err) => {
      this.ctx
        .logger('spark')
        .warn(
          `Proactive target refresh failed: ${err instanceof Error ? err.message : String(err)}`
        )
    })
    this._disposeTargets = this.ctx.on('spark/targets-updated', async () => {
      await this.refreshTargets()
    })

    this._disposeMessage = this.ctx.on('message', (session) => {
      this.recordMessage(session)
    })

    this._disposeTimer = this.ctx.setInterval(
      () => {
        this.checkAndTrigger()
      },
      this.config.checkInterval * 60 * 1000
    )

    this.ctx
      .logger('spark')
      .info(
        `Proactive chat enabled (check every ${this.config.checkInterval}min, delay ${this.config.initialDelay}h)`
      )
  }

  stop() {
    this._disposeMessage?.()
    this._disposeMessage = undefined
    this._disposeTargets?.()
    this._disposeTargets = undefined

    this._disposeTimer?.()
    this._disposeTimer = undefined

    this._roomStates.clear()
  }

  async refreshTargets() {
    const targets = await this.sparkService.targets.listRuntimeTargets('proactive')
    const active = new Set(targets.map((target) => target.key))
    const now = Date.now()

    for (const target of targets) {
      const existing = this._roomStates.get(target.key)
      this._roomStates.set(target.key, {
        target,
        lastChatTime: existing?.lastChatTime ?? now,
        currentProbability: existing?.currentProbability ?? 0
      })
    }

    for (const key of this._roomStates.keys()) {
      if (!active.has(key)) {
        this._roomStates.delete(key)
      }
    }
  }

  getRoomState(key: string): RoomState | undefined {
    return this._roomStates.get(key)
  }

  recordMessage(session: Session) {
    const keys = this.sparkService.targets.getSessionBindingKeys(session)
    const now = Date.now()

    for (const key of keys) {
      const state = this._roomStates.get(key)
      if (!state) continue

      state.lastChatTime = now
      state.currentProbability = 0
    }
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

  async checkAndTrigger() {
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
        const result = await this.sparkService.trigger.wakeup(state.target.routing, prompt)
        if (result.ok) {
          state.lastChatTime = now
          state.currentProbability = 0
        }
      } catch (err) {
        this.ctx
          .logger('spark')
          .warn(`Proactive wakeup failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}
