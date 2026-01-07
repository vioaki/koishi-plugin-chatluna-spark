"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparkService = void 0;
const koishi_1 = require("koishi");
const scheduler_1 = require("./scheduler");
const sandbox_1 = require("./sandbox");
const character_sandbox_1 = require("./character_sandbox");
const task_manager_1 = require("./task_manager");
const database_1 = require("../database");
const types_1 = require("../types");
class SparkService extends koishi_1.Service {
    constructor(ctx, config) {
        super(ctx, 'spark', true);
        this.config = config;
        this.scheduler = new scheduler_1.SparkScheduler(ctx, this);
        this.sandbox = new sandbox_1.SparkSandbox(ctx, config);
        this.characterSandbox = new character_sandbox_1.CharacterSandbox(ctx, config);
        this.taskManager = new task_manager_1.TaskManager(ctx);
    }
    async start() {
        await this.scheduler.start();
    }
    async stop() {
        this.scheduler.stop();
    }
    async addTask(userId, channelId, content, triggerTime, options) {
        const task = await (0, database_1.createSparkTask)(this.ctx, {
            userId,
            channelId,
            triggerTime,
            content,
            type: options?.type || types_1.SparkTaskType.REMINDER, // 默认使用 REMINDER
            tags: options?.tags || [],
            cancelOn: options?.cancelOn || [],
            condition: options?.condition
        });
        this.ctx.emit('spark/task-created', task);
        return task;
    }
    async cancelTask(taskId) {
        // 注意：taskManager.cancelTask 内部已经触发了 spark/task-cancelled 事件
        // 这里不需要再次触发
        await this.taskManager.cancelTask(taskId);
    }
}
exports.SparkService = SparkService;
