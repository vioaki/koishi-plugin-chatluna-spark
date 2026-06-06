"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProactiveTrigger = void 0;
const scope_1 = require("../utils/scope");
class ProactiveTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._roomStates = new Map();
    }
    start() {
        if (!this.config.enabled)
            return;
        this._dispose = this.ctx.on('message', (session) => {
            if (!(0, scope_1.isSessionInScope)(session, this.mainConfig.scope)) {
                return;
            }
            this._roomStates.set(this.getSessionKey(session), {
                session,
                lastChatTime: Date.now(),
                currentProbability: 0
            });
        });
        this._timer = this.ctx.setInterval(() => {
            this.checkAndTrigger();
        }, this.config.checkInterval * 60 * 1000);
        this.ctx.logger('spark').info(`Proactive chat enabled (check every ${this.config.checkInterval}min, delay ${this.config.initialDelay}h)`);
    }
    stop() {
        this._dispose?.();
        this._dispose = undefined;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._roomStates.clear();
    }
    isInSleepTime() {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const { sleepStart, sleepEnd } = this.config;
        if (sleepStart > sleepEnd) {
            return currentTime >= sleepStart || currentTime < sleepEnd;
        }
        return currentTime >= sleepStart && currentTime < sleepEnd;
    }
    async checkAndTrigger() {
        if (this.isInSleepTime())
            return;
        const now = Date.now();
        const initialDelayMs = this.config.initialDelay * 60 * 60 * 1000;
        for (const state of this._roomStates.values()) {
            const timeSinceLastChat = now - state.lastChatTime;
            if (timeSinceLastChat < initialDelayMs)
                continue;
            if (state.currentProbability === 0) {
                state.currentProbability = this.config.initialProbability;
            }
            else {
                state.currentProbability = Math.min(state.currentProbability + this.config.probabilityIncrease, this.config.maxProbability);
            }
            if (Math.random() > state.currentProbability)
                continue;
            const prompts = this.config.prompts?.length ? this.config.prompts : ['主动来找用户聊天'];
            const prompt = prompts[Math.floor(Math.random() * prompts.length)];
            try {
                const result = await this.sparkService.trigger.wakeup(state.session, 'proactive', prompt);
                if (result.ok || result.deferred) {
                    state.lastChatTime = now;
                    state.currentProbability = 0;
                }
            }
            catch (err) {
                this.ctx.logger('spark').warn(`Proactive wakeup failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    getSessionKey(session) {
        return `${session.platform}:${session.selfId}:${session.guildId ?? 'direct'}:${session.channelId ?? session.userId}`;
    }
}
exports.ProactiveTrigger = ProactiveTrigger;
