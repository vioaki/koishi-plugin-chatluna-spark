import { Context, Service } from 'koishi'
import { Config } from '../index'
import { SparkScheduler } from './scheduler'
import { SparkSandbox } from './sandbox'
import { CharacterSandbox } from './character_sandbox'
import { TaskManager } from './task_manager'
import { createSparkTask } from '../database'
import { SparkTaskType, CancelEvent, TaskCondition } from '../types'

declare module 'koishi' {
  interface Context {
    spark: SparkService
  }

  interface Events {
    'spark/task-created'(task: any): void
    'spark/task-executed'(task: any): void
    'spark/task-cancelled'(taskId: number): void
  }
}

export class SparkService extends Service {
  public scheduler: SparkScheduler
  public sandbox: SparkSandbox
  public characterSandbox: CharacterSandbox
  public taskManager: TaskManager

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'spark', true)

    this.scheduler = new SparkScheduler(ctx, this)
    this.sandbox = new SparkSandbox(ctx, config)
    this.characterSandbox = new CharacterSandbox(ctx, config)
    this.taskManager = new TaskManager(ctx)
  }

  async start() {
    await this.scheduler.start()
  }

  async stop() {
    this.scheduler.stop()
  }

  async addTask(
    userId: string,
    channelId: string,
    content: string,
    triggerTime: Date | number,
    options?: {
      type?: SparkTaskType
      tags?: string[]
      cancelOn?: CancelEvent[]
      condition?: TaskCondition
    }
  ) {
    const task = await createSparkTask(this.ctx, {
      userId,
      channelId,
      triggerTime,
      content,
      type: options?.type || SparkTaskType.REMINDER,  // 默认使用 REMINDER
      tags: options?.tags || [],
      cancelOn: options?.cancelOn || [],
      condition: options?.condition
    })

    this.ctx.emit('spark/task-created', task)
    return task
  }

  async cancelTask(taskId: number) {
    // 注意：taskManager.cancelTask 内部已经触发了 spark/task-cancelled 事件
    // 这里不需要再次触发
    await this.taskManager.cancelTask(taskId)
  }
}
