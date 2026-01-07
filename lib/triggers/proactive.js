"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProactiveTrigger = void 0;
const room_helper_1 = require("../utils/room_helper");
const scope_1 = require("../utils/scope");
const shared_1 = require("../utils/shared");
class ProactiveTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._roomStates = new Map();
        this._roomHelper = new room_helper_1.RoomHelper(ctx);
        this.listenToChatEvents();
    }
    listenToChatEvents() {
        this.ctx.on('message', (session) => {
            const channelId = session.channelId;
            const guildId = session.guildId;
            if (!channelId && !guildId)
                return;
            // 重置该频道/群组的状态
            const key = guildId || channelId;
            this._roomStates.set(key, {
                lastChatTime: Date.now(),
                currentProbability: 0
            });
        });
    }
    start() {
        if (!this.config.enabled) {
            return;
        }
        const intervalMs = this.config.checkInterval * 60 * 1000;
        this._timer = this.ctx.setInterval(() => {
            this.checkAndTrigger();
        }, intervalMs);
        this.ctx.logger('spark').info(`Proactive chat enabled (check every ${this.config.checkInterval}min, delay ${this.config.initialDelay}h)`);
    }
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
    isInSleepTime() {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const sleepStart = this.config.sleepStart;
        const sleepEnd = this.config.sleepEnd;
        if (sleepStart > sleepEnd) {
            return currentTime >= sleepStart || currentTime < sleepEnd;
        }
        else {
            return currentTime >= sleepStart && currentTime < sleepEnd;
        }
    }
    async checkAndTrigger() {
        if (this.isInSleepTime()) {
            return;
        }
        // 执行 ChatLuna 模式
        await this.checkChatLuna();
        // 执行 Character 模式
        await this.checkCharacter();
    }
    async checkChatLuna() {
        try {
            const rooms = await this._roomHelper.getAllRooms();
            const now = Date.now();
            const initialDelayMs = this.config.initialDelay * 60 * 60 * 1000;
            for (const roomInfo of rooms) {
                try {
                    const channelId = roomInfo.channelId;
                    if (this.mainConfig.scope && !(0, scope_1.isInScope)(channelId, this.mainConfig.scope)) {
                        continue;
                    }
                    let state = this._roomStates.get(channelId);
                    if (!state) {
                        state = { lastChatTime: now, currentProbability: 0 };
                        this._roomStates.set(channelId, state);
                        continue;
                    }
                    const timeSinceLastChat = now - state.lastChatTime;
                    if (timeSinceLastChat < initialDelayMs) {
                        continue;
                    }
                    if (state.currentProbability === 0) {
                        state.currentProbability = this.config.initialProbability;
                    }
                    else {
                        state.currentProbability = Math.min(state.currentProbability + this.config.probabilityIncrease, this.config.maxProbability);
                    }
                    const random = Math.random();
                    if (random > state.currentProbability) {
                        continue;
                    }
                    const prompts = this.config.prompts?.length ? this.config.prompts : ['主动来找用户聊天'];
                    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
                    const success = await this.sparkService.sandbox.execute(roomInfo.userId, roomInfo.channelId, prompt, roomInfo.room);
                    if (success) {
                        state.lastChatTime = now;
                        state.currentProbability = 0;
                    }
                }
                catch (err) {
                    // 静默处理单个房间的错误
                }
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        catch (err) {
            this.ctx.logger('spark').error('Proactive check failed:', err);
        }
    }
    async checkCharacter() {
        if (!this.ctx.chatluna_character) {
            return;
        }
        const groups = (0, shared_1.getCharacterGroups)(this.ctx);
        if (groups.length === 0) {
            return;
        }
        const now = Date.now();
        const initialDelayMs = this.config.initialDelay * 60 * 60 * 1000;
        for (const guildId of groups) {
            try {
                let state = this._roomStates.get(guildId);
                if (!state) {
                    state = { lastChatTime: now, currentProbability: 0 };
                    this._roomStates.set(guildId, state);
                    continue;
                }
                const timeSinceLastChat = now - state.lastChatTime;
                if (timeSinceLastChat < initialDelayMs) {
                    continue;
                }
                if (state.currentProbability === 0) {
                    state.currentProbability = this.config.initialProbability;
                }
                else {
                    state.currentProbability = Math.min(state.currentProbability + this.config.probabilityIncrease, this.config.maxProbability);
                }
                const random = Math.random();
                if (random > state.currentProbability) {
                    continue;
                }
                const prompts = this.config.prompts?.length ? this.config.prompts : ['主动来找用户聊天'];
                const prompt = prompts[Math.floor(Math.random() * prompts.length)];
                const success = await this.sparkService.characterSandbox.execute('system', guildId, guildId, prompt);
                if (success) {
                    state.lastChatTime = now;
                    state.currentProbability = 0;
                }
            }
            catch (err) {
                // 静默处理单个群组的错误
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
}
exports.ProactiveTrigger = ProactiveTrigger;
