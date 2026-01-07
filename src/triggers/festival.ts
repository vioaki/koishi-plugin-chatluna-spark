import { Context } from 'koishi'
import { CronJob } from 'cron'
import { getFestivalsForYear, Festival } from '../data/festivals'
import { SparkService } from '../service'
import { RoomHelper } from '../utils/room_helper'
import { isInScope } from '../utils/scope'
import { Config } from '../index'
import { getCharacterGroups } from '../utils/shared'

export interface FestivalConfig {
  enabled: boolean
  promptTemplate: string
  defaultTime: string
  custom: {
    name: string
    date: string
    time: string
    description: string
  }[]
}

export class FestivalTrigger {
  private _jobs: CronJob[] = []
  private _festivals: Festival[] = []
  private _roomHelper: RoomHelper

  constructor(
    private ctx: Context,
    private config: FestivalConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {
    this._roomHelper = new RoomHelper(ctx)
    this.loadFestivals()
  }

  private loadFestivals() {
    const currentYear = new Date().getFullYear()

    const builtinFestivals = getFestivalsForYear(currentYear)

    const customFestivals: Festival[] = (this.config.custom || []).map(c => ({
      name: c.name,
      date: c.date,
      time: c.time || this.config.defaultTime || '09:00',
      description: c.description,
      category: 'modern' as const
    }))

    this._festivals = [...builtinFestivals, ...customFestivals]

    const counts = { 'solar-term': 0, 'traditional': 0, 'modern': 0, 'western': 0 }
    for (const f of builtinFestivals) {
      counts[f.category]++
    }

    this.ctx.logger('spark').info(
      `Loaded ${this._festivals.length} festivals for ${currentYear}`
    )
  }

  start() {
    if (this._festivals.length === 0) {
      return
    }

    for (const festival of this._festivals) {
      this.scheduleFestival(festival)
    }
  }

  stop() {
    for (const job of this._jobs) {
      job.stop()
    }
    this._jobs = []
  }

  private scheduleFestival(festival: Festival) {
    try {
      const [month, day] = festival.date.split('-').map(s => s.trim())
      const [hour, minute] = festival.time.split(':').map(s => s.trim())

      const cronExp = `${minute} ${hour} ${day} ${month} *`

      const job = new CronJob(
        cronExp,
        async () => {
          await this.triggerFestival(festival)
        },
        null,
        false,
        'Asia/Shanghai'
      )

      job.start()
      this._jobs.push(job)

    } catch (err) {
      this.ctx.logger('spark').error(`Failed to schedule festival ${festival.name}:`, err)
    }
  }

  private async triggerFestival(festival: Festival) {
    this.ctx.logger('spark').info(`Festival greeting: ${festival.name}`)

    const prompt = this.config.promptTemplate
      .replace(/{festivalName}/g, festival.name)
      .replace(/{festivalDesc}/g, festival.description)

    // 执行 ChatLuna 模式
    await this.triggerChatLuna(festival, prompt)

    // 执行 Character 模式
    await this.triggerCharacter(festival, prompt)
  }

  private async triggerChatLuna(festival: Festival, prompt: string) {
    const rooms = await this._roomHelper.getAllRooms()

    if (rooms.length === 0) {
      return
    }

    for (const roomInfo of rooms) {
      try {
        if (this.mainConfig.scope && !isInScope(roomInfo.channelId, this.mainConfig.scope)) {
          continue
        }

        await this.sparkService.sandbox.execute(
          roomInfo.userId,
          roomInfo.channelId,
          prompt,
          roomInfo.room
        )
      } catch (err) {
        // 静默处理单个房间的错误
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  private async triggerCharacter(festival: Festival, prompt: string) {
    if (!this.ctx.chatluna_character) {
      return
    }

    const groups = getCharacterGroups(this.ctx)

    if (groups.length === 0) {
      return
    }

    for (const guildId of groups) {
      try {
        await this.sparkService.characterSandbox.execute(
          'system',
          guildId,
          guildId,
          prompt
        )
      } catch (err) {
        // 静默处理单个群组的错误
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
