"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledTrigger = void 0;
const scope_1 = require("../utils/scope");
class ScheduledTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._created = new Set();
    }
    start() {
        if (!this.config.tasks || this.config.tasks.length === 0)
            return;
        this._dispose = this.ctx.on('message', async (session) => {
            await this.syncForSession(session);
        });
        this.ctx.logger('spark').info(`Scheduled ${this.config.tasks.length} daily Spark trigger template(s)`);
    }
    stop() {
        this._dispose?.();
        this._dispose = undefined;
        this._created.clear();
    }
    async syncForSession(session) {
        if (!(0, scope_1.isSessionInScope)(session, this.mainConfig.scope)) {
            return;
        }
        for (const task of this.config.tasks) {
            const expression = this.toCron(task.time);
            if (!expression)
                continue;
            const bindingKey = await this.resolveBindingKey(session);
            const configKey = `scheduled:${task.name}:${task.time}`;
            const key = `${bindingKey}:${configKey}`;
            if (this._created.has(key))
                continue;
            this._created.add(key);
            try {
                if (await this.sparkService.trigger.findSparkTaskByConfigKey(bindingKey, configKey)) {
                    continue;
                }
                await this.sparkService.trigger.createCron(session, {
                    type: 'scheduled',
                    content: task.prompt,
                    expression,
                    name: `Spark scheduled: ${task.name}`,
                    createdBy: 'spark',
                    bindingKey,
                    metadata: {
                        sparkOrigin: 'scheduled',
                        configKey
                    }
                });
            }
            catch (err) {
                this.ctx.logger('spark').warn(`Failed to create scheduled trigger "${task.name}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    toCron(time) {
        const parts = time.split(':').map(s => s.trim());
        if (parts.length !== 2)
            return null;
        const [hour, minute] = parts;
        if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute))
            return null;
        return `${Number(minute)} ${Number(hour)} * * *`;
    }
    async resolveBindingKey(session) {
        return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey;
    }
}
exports.ScheduledTrigger = ScheduledTrigger;
