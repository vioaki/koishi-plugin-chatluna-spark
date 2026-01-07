import { Context } from 'koishi'
import { SparkTask, SparkTaskStatus, CancelEvent, TaskConditionType } from '../types'
import { extractRealUserId } from '../utils/session_helper'

export class TaskManager {
  constructor(private ctx: Context) {
    this.registerEventHandlers()
  }

  private registerEventHandlers() {
    this.ctx.on('message', async (session) => {
      const logger = this.ctx.logger('spark:task')

      const channelId = session.channelId
      const userId = extractRealUserId(session.userId, channelId)

      logger.debug(`Message received: userId="${userId}", channelId="${channelId}"`)

      await this.handleCancelEvent(
        CancelEvent.USER_MESSAGE,
        userId,
        channelId
      )
    })

    this.ctx.on('spark/task-executed', async (task: SparkTask) => {
      await this.handleCancelEvent(
        CancelEvent.TASK_COMPLETED,
        task.userId,
        task.channelId,
        { completedTaskType: task.type }
      )
    })
  }

  private async handleCancelEvent(
    event: CancelEvent,
    userId: string,
    channelId: string,
    extra?: any
  ) {
    const logger = this.ctx.logger('spark:task')

    try {
      logger.debug(`Checking cancel event [${event}] for userId="${userId}", channelId="${channelId}"`)

      const tasks = await this.ctx.database.get('chatluna_spark_tasks', {
        userId,
        channelId,
        status: SparkTaskStatus.PENDING
      })

      logger.debug(`Found ${tasks.length} pending tasks for this user/channel`)

      if (tasks.length > 0) {
        logger.debug(`Tasks: ${JSON.stringify(tasks.map(t => ({ id: t.id, type: t.type, cancelOn: t.cancelOn })))}`)
      }

      const tasksToCancel = tasks.filter(task =>
        task.cancelOn && task.cancelOn.includes(event)
      )

      if (tasksToCancel.length === 0) {
        return
      }

      logger.info(
        `Event [${event}] triggered, canceling ${tasksToCancel.length} tasks`
      )

      for (const task of tasksToCancel) {
        if (event === CancelEvent.TASK_COMPLETED && extra) {
          if (
            task.type !== extra.completedTaskType ||
            !task.tags?.includes('follow-up')
          ) {
            continue
          }
        }

        await this.cancelTask(task.id, `Auto-cancelled by event: ${event}`)
      }

    } catch (err) {
      logger.error('Failed to handle cancel event:', err)
    }
  }

  async cancelTask(taskId: number, reason?: string) {
    const logger = this.ctx.logger('spark:task')

    // 获取现有任务以保留 metadata
    const [existingTask] = await this.ctx.database.get('chatluna_spark_tasks', { id: taskId })
    const existingMetadata = existingTask?.metadata || {}

    await this.ctx.database.set('chatluna_spark_tasks', taskId, {
      status: SparkTaskStatus.CANCELLED,
      metadata: {
        ...existingMetadata,
        cancelReason: reason,
        cancelledAt: new Date()
      }
    })

    this.ctx.emit('spark/task-cancelled', taskId)

    logger.info(`Task [${taskId}] cancelled: ${reason}`)
  }

  async checkTaskCondition(task: SparkTask): Promise<boolean> {
    if (!task.condition) {
      return true
    }

    const condition = task.condition

    switch (condition.type) {
      case TaskConditionType.USER_IDLE:
        return await this.checkUserIdle(task, condition.duration || 0)

      case TaskConditionType.TIME_RANGE:
        return this.checkTimeRange(condition)

      default:
        return true
    }
  }

  private async checkUserIdle(task: SparkTask, duration: number): Promise<boolean> {
    try {
      const messages = await this.ctx.database.get('chathub_message', {
        userId: task.userId,
        createdAt: { $gte: new Date(Date.now() - duration) }
      } as any)

      return messages.length === 0
    } catch (err) {
      this.ctx.logger('spark:task').error('Failed to check user idle:', err)
      return true
    }
  }

  private checkTimeRange(condition: any): boolean {
    const now = new Date()
    const { startTime, endTime } = condition

    if (startTime && now < new Date(startTime)) {
      return false
    }

    if (endTime && now > new Date(endTime)) {
      return false
    }

    return true
  }
}
