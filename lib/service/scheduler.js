"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparkScheduler = void 0;
const types_1 = require("../types");
class SparkScheduler {
    constructor(ctx, service) {
        this.ctx = ctx;
        this.service = service;
        // 存储 taskId -> { timer, cancelled }
        this._tasks = new Map();
        this.listenToCancelEvents();
    }
    listenToCancelEvents() {
        this.ctx.on('spark/task-cancelled', (taskId) => {
            const taskInfo = this._tasks.get(taskId);
            if (taskInfo) {
                // 标记为已取消
                taskInfo.cancelled = true;
                // 尝试清除定时器
                clearTimeout(taskInfo.timer);
                this._tasks.delete(taskId);
                this.ctx.logger('spark').info(`Task [${taskId}] cancelled and timer cleared`);
            }
        });
    }
    async start() {
        await this.loadPendingTasks();
        this.ctx.on('spark/task-created', (task) => {
            this.scheduleTask(task);
        });
    }
    async loadPendingTasks() {
        const logger = this.ctx.logger('spark');
        try {
            const tasks = await this.ctx.database.get('chatluna_spark_tasks', {
                status: types_1.SparkTaskStatus.PENDING
            });
            if (tasks.length === 0) {
                return;
            }
            const now = new Date();
            let scheduledCount = 0;
            let executedCount = 0;
            for (const task of tasks) {
                // 确保 triggerTime 是 Date 对象
                const triggerTime = new Date(task.triggerTime);
                if (triggerTime <= now) {
                    await this.executeTask({ ...task, triggerTime });
                    executedCount++;
                }
                else {
                    this.scheduleTask({ ...task, triggerTime });
                    scheduledCount++;
                }
            }
            if (scheduledCount > 0 || executedCount > 0) {
                logger.info(`Loaded ${tasks.length} pending tasks (${scheduledCount} scheduled, ${executedCount} executed immediately)`);
            }
        }
        catch (err) {
            logger.error('Failed to load tasks:', err);
        }
    }
    scheduleTask(task) {
        const logger = this.ctx.logger('spark');
        // 确保 triggerTime 是 Date 对象
        const triggerTime = task.triggerTime instanceof Date ? task.triggerTime : new Date(task.triggerTime);
        let delay = triggerTime.getTime() - Date.now();
        if (delay < 0) {
            this.executeTask(task);
            return;
        }
        // JavaScript setTimeout 最大延迟约为 24.8 天 (2^31-1 ms)
        const MAX_TIMEOUT = 2147483647;
        if (delay > MAX_TIMEOUT) {
            logger.warn(`Task [${task.id}] delay exceeds max timeout, capping to ~24.8 days`);
            delay = MAX_TIMEOUT;
        }
        // 创建任务信息
        const taskInfo = { timer: null, cancelled: false };
        const timer = setTimeout(async () => {
            if (taskInfo.cancelled) {
                return;
            }
            await this.executeTask(task);
            this._tasks.delete(task.id);
        }, delay);
        taskInfo.timer = timer;
        this._tasks.set(task.id, taskInfo);
        logger.info(`Scheduled [${task.id}]: "${task.content}" in ${Math.floor(delay / 1000)}s`);
    }
    async executeTask(task) {
        const logger = this.ctx.logger('spark');
        try {
            const taskInfo = this._tasks.get(task.id);
            if (taskInfo?.cancelled) {
                return;
            }
            logger.info(`Executing [${task.id}]: ${task.content}`);
            const canExecute = await this.service.taskManager.checkTaskCondition(task);
            if (!canExecute) {
                logger.debug(`Task [${task.id}] skipped: condition not met`);
                await this.ctx.database.set('chatluna_spark_tasks', task.id, {
                    status: types_1.SparkTaskStatus.CANCELLED,
                    metadata: { reason: 'Condition not met' }
                });
                return;
            }
            // 判断是否使用 chatluna-character
            const useCharacter = this.shouldUseCharacterSandbox(task.channelId);
            if (useCharacter) {
                const guildId = this.extractGuildId(task.channelId);
                const success = await this.service.characterSandbox.execute(task.userId, task.channelId, guildId, task.content);
                if (!success) {
                    logger.warn(`CharacterSandbox failed, falling back`);
                    await this.executeChatLunaSandbox(task);
                }
                else {
                    await this.ctx.database.set('chatluna_spark_tasks', task.id, {
                        status: types_1.SparkTaskStatus.EXECUTED
                    });
                    this.ctx.emit('spark/task-executed', task);
                    logger.success(`Task [${task.id}] completed`);
                }
            }
            else {
                await this.executeChatLunaSandbox(task);
            }
        }
        catch (err) {
            logger.error(`Task [${task.id}] failed:`, err);
            await this.ctx.database.set('chatluna_spark_tasks', task.id, {
                status: types_1.SparkTaskStatus.FAILED,
                metadata: { error: err instanceof Error ? err.message : String(err) }
            });
        }
    }
    /**
     * 判断是否应该使用 chatluna-character sandbox
     * 群聊且 chatluna_character 可用时使用
     */
    shouldUseCharacterSandbox(channelId) {
        // 私聊不使用 character
        if (channelId.startsWith('private:')) {
            return false;
        }
        // 检查 chatluna_character 是否可用
        if (!this.ctx.chatluna_character) {
            return false;
        }
        // 群聊使用 character
        return true;
    }
    /**
     * 从 channelId 提取 guildId
     */
    extractGuildId(channelId) {
        if (channelId.includes(':')) {
            return channelId.split(':')[0];
        }
        return channelId;
    }
    /**
     * 使用 ChatLuna 主插件 sandbox 执行任务
     */
    async executeChatLunaSandbox(task) {
        const logger = this.ctx.logger('spark');
        const room = await this.getRoom(task.userId, task.channelId);
        if (!room) {
            logger.error(`No room found for task [${task.id}]`);
            await this.ctx.database.set('chatluna_spark_tasks', task.id, {
                status: types_1.SparkTaskStatus.FAILED,
                metadata: { reason: 'Room not found' }
            });
            return;
        }
        await this.service.sandbox.execute(task.userId, task.channelId, task.content, room);
        await this.ctx.database.set('chatluna_spark_tasks', task.id, {
            status: types_1.SparkTaskStatus.EXECUTED
        });
        this.ctx.emit('spark/task-executed', task);
        logger.success(`Task [${task.id}] completed`);
    }
    async getRoom(userId, channelId) {
        try {
            let guildId;
            let isGroup = false;
            if (channelId.startsWith('private:')) {
                guildId = '0';
                isGroup = false;
            }
            else if (channelId.includes(':')) {
                guildId = channelId.split(':')[0];
                isGroup = true;
            }
            else if (/^\d{6,}$/.test(channelId)) {
                guildId = channelId;
                isGroup = true;
            }
            else {
                guildId = '0';
                isGroup = false;
            }
            if (isGroup) {
                const userRooms = await this.ctx.database.get('chathub_user', {
                    groupId: guildId
                });
                if (userRooms.length === 0) {
                    return null;
                }
                const roomId = userRooms[0].defaultRoomId;
                const rooms = await this.ctx.database.get('chathub_room', { roomId });
                return rooms.length > 0 ? rooms[0] : null;
            }
            else {
                const userRooms = await this.ctx.database.get('chathub_user', {
                    userId,
                    groupId: '0'
                });
                if (userRooms.length === 0) {
                    return null;
                }
                const roomId = userRooms[0].defaultRoomId;
                const rooms = await this.ctx.database.get('chathub_room', { roomId });
                return rooms.length > 0 ? rooms[0] : null;
            }
        }
        catch (err) {
            this.ctx.logger('spark').error('Failed to get room:', err);
            return null;
        }
    }
    stop() {
        for (const taskInfo of this._tasks.values()) {
            clearTimeout(taskInfo.timer);
        }
        this._tasks.clear();
    }
}
exports.SparkScheduler = SparkScheduler;
