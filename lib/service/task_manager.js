"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;
const types_1 = require("../types");
const session_helper_1 = require("../utils/session_helper");
class TaskManager {
    constructor(ctx) {
        this.ctx = ctx;
        this.registerEventHandlers();
    }
    registerEventHandlers() {
        this.ctx.on('message', async (session) => {
            const logger = this.ctx.logger('spark:task');
            const channelId = session.channelId;
            const userId = (0, session_helper_1.extractRealUserId)(session.userId, channelId);
            logger.debug(`Message received: userId="${userId}", channelId="${channelId}"`);
            await this.handleCancelEvent(types_1.CancelEvent.USER_MESSAGE, userId, channelId);
        });
        this.ctx.on('spark/task-executed', async (task) => {
            await this.handleCancelEvent(types_1.CancelEvent.TASK_COMPLETED, task.userId, task.channelId, { completedTaskType: task.type });
        });
    }
    async handleCancelEvent(event, userId, channelId, extra) {
        const logger = this.ctx.logger('spark:task');
        try {
            logger.debug(`Checking cancel event [${event}] for userId="${userId}", channelId="${channelId}"`);
            const tasks = await this.ctx.database.get('chatluna_spark_tasks', {
                userId,
                channelId,
                status: types_1.SparkTaskStatus.PENDING
            });
            logger.debug(`Found ${tasks.length} pending tasks for this user/channel`);
            if (tasks.length > 0) {
                logger.debug(`Tasks: ${JSON.stringify(tasks.map(t => ({ id: t.id, type: t.type, cancelOn: t.cancelOn })))}`);
            }
            const tasksToCancel = tasks.filter(task => task.cancelOn && task.cancelOn.includes(event));
            if (tasksToCancel.length === 0) {
                return;
            }
            logger.info(`Event [${event}] triggered, canceling ${tasksToCancel.length} tasks`);
            for (const task of tasksToCancel) {
                if (event === types_1.CancelEvent.TASK_COMPLETED && extra) {
                    if (task.type !== extra.completedTaskType ||
                        !task.tags?.includes('follow-up')) {
                        continue;
                    }
                }
                await this.cancelTask(task.id, `Auto-cancelled by event: ${event}`);
            }
        }
        catch (err) {
            logger.error('Failed to handle cancel event:', err);
        }
    }
    async cancelTask(taskId, reason) {
        const logger = this.ctx.logger('spark:task');
        // 获取现有任务以保留 metadata
        const [existingTask] = await this.ctx.database.get('chatluna_spark_tasks', { id: taskId });
        const existingMetadata = existingTask?.metadata || {};
        await this.ctx.database.set('chatluna_spark_tasks', taskId, {
            status: types_1.SparkTaskStatus.CANCELLED,
            metadata: {
                ...existingMetadata,
                cancelReason: reason,
                cancelledAt: new Date()
            }
        });
        this.ctx.emit('spark/task-cancelled', taskId);
        logger.info(`Task [${taskId}] cancelled: ${reason}`);
    }
    async checkTaskCondition(task) {
        if (!task.condition) {
            return true;
        }
        const condition = task.condition;
        switch (condition.type) {
            case types_1.TaskConditionType.USER_IDLE:
                return await this.checkUserIdle(task, condition.duration || 0);
            case types_1.TaskConditionType.TIME_RANGE:
                return this.checkTimeRange(condition);
            default:
                return true;
        }
    }
    async checkUserIdle(task, duration) {
        try {
            const messages = await this.ctx.database.get('chathub_message', {
                userId: task.userId,
                createdAt: { $gte: new Date(Date.now() - duration) }
            });
            return messages.length === 0;
        }
        catch (err) {
            this.ctx.logger('spark:task').error('Failed to check user idle:', err);
            return true;
        }
    }
    checkTimeRange(condition) {
        const now = new Date();
        const { startTime, endTime } = condition;
        if (startTime && now < new Date(startTime)) {
            return false;
        }
        if (endTime && now > new Date(endTime)) {
            return false;
        }
        return true;
    }
}
exports.TaskManager = TaskManager;
