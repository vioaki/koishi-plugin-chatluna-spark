"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveChatEngine = void 0;
const database_1 = require("../database");
const types_1 = require("../types");
class ActiveChatEngine {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    start() {
        if (!this.config.enabled) {
            this.ctx.logger('spark:active').info('Active chat is disabled');
            return;
        }
        this.ctx.logger('spark:active').info('🤖 Active chat engine started');
    }
    async scheduleActiveChat(userId, channelId, roomId) {
        const logger = this.ctx.logger('spark:active');
        try {
            const delay = this.calculateDelay();
            logger.info(`Scheduling active chat for user ${userId} in ${Math.floor(delay / 60000)} minutes`);
            await (0, database_1.createSparkTask)(this.ctx, {
                userId,
                channelId,
                type: types_1.SparkTaskType.FOLLOW_UP, // 使用 FOLLOW_UP 类型
                content: '主动发起对话',
                triggerTime: delay,
                cancelOn: [],
                roomId,
                condition: {
                    type: types_1.TaskConditionType.USER_IDLE,
                    duration: this.config.baseInterval * 1000
                },
                tags: ['active', 'auto']
            });
        }
        catch (err) {
            logger.error('Failed to schedule active chat:', err);
        }
    }
    calculateDelay() {
        const baseDelay = this.config.baseInterval * 1000;
        const randomFactor = Math.random() * 0.3;
        return baseDelay * (1 + randomFactor);
    }
    isInSleepTime() {
        const now = new Date();
        const hour = now.getHours();
        const { sleepStartHour, sleepEndHour } = this.config;
        if (sleepStartHour < sleepEndHour) {
            return hour >= sleepStartHour && hour < sleepEndHour;
        }
        else {
            return hour >= sleepStartHour || hour < sleepEndHour;
        }
    }
}
exports.ActiveChatEngine = ActiveChatEngine;
