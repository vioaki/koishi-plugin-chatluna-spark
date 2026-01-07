import { Context } from 'koishi'
import { CronJob } from 'cron'
import { SparkService } from '../service'
import { RoomHelper } from '../utils/room_helper'
import { isInScope } from '../utils/scope'
import { Config } from '../index'
import { getCharacterGroups } from '../utils/shared'

export interface ScheduledConfig {
  enabled: boolean
  tasks: ScheduledTask[]
}

export interface ScheduledTask {
  name: string
  time: string
  prompt: string
}

export class ScheduledTrigger {
  private _jobs: CronJob[] = []
  private _roomHelper: RoomHelper

  constructor(
    private ctx: Context,
    private config: ScheduledConfig,
    private sparkService: SparkService,
    private mainConfig: Config
  ) {
    this._roomHelper = new RoomHelper(ctx)
  }

  start() {
    if (!this.config.tasks || this.config.tasks.length === 0) {
      return
    }

    for (const task of this.config.tasks) {
      this.scheduleTask(task)
    }

    this.ctx.logger('spark').info(`Scheduled ${this.config.tasks.length} daily task(s)`)
  }

  stop() {
    for (const job of this._jobs) {
      job.stop()
    }
    this._jobs = []
  }

  private scheduleTask(task: ScheduledTask) {
    try {
      const [hour, minute] = task.time.split(':').map(s => s.trim())
      const cronExp = `${minute} ${hour} * * *`

      const job = new CronJob(
        cronExp,
        async () => {
          await this.triggerTask(task)
        },
        null,
        false,
        'Asia/Shanghai'
      )

      job.start()
      this._jobs.push(job)

    } catch (err) {
      this.ctx.logger('spark').error(`Failed to schedule ${task.name}:`, err)
    }
  }

  private async triggerTask(task: ScheduledTask) {
    this.ctx.logger('spark').info(`Running scheduled task: ${task.name}`)

    // 执行 ChatLuna 模式（遍历房间）
    await this.triggerChatLuna(task)

    // 执行 Character 模式（遍历群组）
    await this.triggerCharacter(task)
  }

  /**
   * ChatLuna 模式：遍历所有房间
   */
  private async triggerChatLuna(task: ScheduledTask) {
    const rooms = await this._roomHelper.getAllRooms()

    if (rooms.length === 0) {
      return
    }

    let successCount = 0

    for (const roomInfo of rooms) {
      try {
        if (this.mainConfig.scope && !isInScope(roomInfo.channelId, this.mainConfig.scope)) {
          continue
        }

        const success = await this.sparkService.sandbox.execute(
          roomInfo.userId,
          roomInfo.channelId,
          task.prompt,
          roomInfo.room
        )

        if (success) {
          successCount++
        }

      } catch (err) {
        // 静默处理单个房间的错误
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /**
   * Character 模式：遍历配置的群组
   */
  private async triggerCharacter(task: ScheduledTask) {
    if (!this.ctx.chatluna_character) {
      return
    }

    const groups = getCharacterGroups(this.ctx)

    if (groups.length === 0) {
      return
    }

    let successCount = 0

    for (const guildId of groups) {
      try {
        const success = await this.sparkService.characterSandbox.execute(
          'system',
          guildId,
          guildId,
          task.prompt
        )

        if (success) {
          successCount++
        }

      } catch (err) {
        // 静默处理单个群组的错误
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
