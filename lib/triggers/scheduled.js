"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledTrigger = void 0;
const cron_1 = require("cron");
const room_helper_1 = require("../utils/room_helper");
const scope_1 = require("../utils/scope");
const shared_1 = require("../utils/shared");
class ScheduledTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._jobs = [];
        this._roomHelper = new room_helper_1.RoomHelper(ctx);
    }
    start() {
        if (!this.config.tasks || this.config.tasks.length === 0) {
            return;
        }
        for (const task of this.config.tasks) {
            this.scheduleTask(task);
        }
        this.ctx.logger('spark').info(`Scheduled ${this.config.tasks.length} daily task(s)`);
    }
    stop() {
        for (const job of this._jobs) {
            job.stop();
        }
        this._jobs = [];
    }
    scheduleTask(task) {
        try {
            const [hour, minute] = task.time.split(':').map(s => s.trim());
            const cronExp = `${minute} ${hour} * * *`;
            const job = new cron_1.CronJob(cronExp, async () => {
                await this.triggerTask(task);
            }, null, false, 'Asia/Shanghai');
            job.start();
            this._jobs.push(job);
        }
        catch (err) {
            this.ctx.logger('spark').error(`Failed to schedule ${task.name}:`, err);
        }
    }
    async triggerTask(task) {
        this.ctx.logger('spark').info(`Running scheduled task: ${task.name}`);
        // 执行 ChatLuna 模式（遍历房间）
        await this.triggerChatLuna(task);
        // 执行 Character 模式（遍历群组）
        await this.triggerCharacter(task);
    }
    /**
     * ChatLuna 模式：遍历所有房间
     */
    async triggerChatLuna(task) {
        const rooms = await this._roomHelper.getAllRooms();
        if (rooms.length === 0) {
            return;
        }
        let successCount = 0;
        for (const roomInfo of rooms) {
            try {
                if (this.mainConfig.scope && !(0, scope_1.isInScope)(roomInfo.channelId, this.mainConfig.scope)) {
                    continue;
                }
                const success = await this.sparkService.sandbox.execute(roomInfo.userId, roomInfo.channelId, task.prompt, roomInfo.room);
                if (success) {
                    successCount++;
                }
            }
            catch (err) {
                // 静默处理单个房间的错误
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    /**
     * Character 模式：遍历配置的群组
     */
    async triggerCharacter(task) {
        if (!this.ctx.chatluna_character) {
            return;
        }
        const groups = (0, shared_1.getCharacterGroups)(this.ctx);
        if (groups.length === 0) {
            return;
        }
        let successCount = 0;
        for (const guildId of groups) {
            try {
                const success = await this.sparkService.characterSandbox.execute('system', guildId, guildId, task.prompt);
                if (success) {
                    successCount++;
                }
            }
            catch (err) {
                // 静默处理单个群组的错误
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
exports.ScheduledTrigger = ScheduledTrigger;
