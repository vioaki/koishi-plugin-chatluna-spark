"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FestivalTrigger = void 0;
const festivals_1 = require("../data/festivals");
const scope_1 = require("../utils/scope");
class FestivalTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._festivals = [];
        this._created = new Set();
        this.loadFestivals();
    }
    start() {
        if (this._festivals.length === 0)
            return;
        this._dispose = this.ctx.on('message', async (session) => {
            await this.syncForSession(session);
        });
    }
    stop() {
        this._dispose?.();
        this._dispose = undefined;
        this._created.clear();
    }
    loadFestivals() {
        const currentYear = new Date().getFullYear();
        const builtinFestivals = (0, festivals_1.getFestivalsForYear)(currentYear);
        const customFestivals = (this.config.custom || []).map(c => ({
            name: c.name,
            date: c.date,
            time: c.time || this.config.defaultTime || '09:00',
            description: c.description,
            category: 'modern'
        }));
        this._festivals = [...builtinFestivals, ...customFestivals];
        this.ctx.logger('spark').info(`Loaded ${this._festivals.length} festivals for ${currentYear}`);
    }
    async syncForSession(session) {
        if (!(0, scope_1.isSessionInScope)(session, this.mainConfig.scope)) {
            return;
        }
        for (const festival of this._festivals) {
            const fireAt = this.toFireAt(festival);
            if (!fireAt)
                continue;
            const bindingKey = await this.resolveBindingKey(session);
            const configKey = `festival:${fireAt.getFullYear()}:${festival.name}:${festival.date}:${festival.time}`;
            const key = `${bindingKey}:${configKey}`;
            if (this._created.has(key))
                continue;
            this._created.add(key);
            const prompt = this.config.promptTemplate
                .replace(/{festivalName}/g, festival.name)
                .replace(/{festivalDesc}/g, festival.description);
            try {
                if (await this.sparkService.trigger.findSparkTaskByConfigKey(bindingKey, configKey)) {
                    continue;
                }
                await this.sparkService.trigger.createOnce({
                    type: 'festival',
                    content: prompt,
                    fireAt,
                    session,
                    name: `Spark festival: ${festival.name}`,
                    createdBy: 'spark',
                    bindingKey,
                    metadata: {
                        sparkOrigin: 'festival',
                        configKey
                    }
                });
            }
            catch (err) {
                this.ctx.logger('spark').warn(`Failed to create festival trigger "${festival.name}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    toFireAt(festival) {
        const year = new Date().getFullYear();
        const [month, day] = festival.date.split('-').map(s => s.trim());
        const [hour, minute] = festival.time.split(':').map(s => s.trim());
        if (!month || !day || !hour || !minute)
            return null;
        const fireAt = new Date(year, Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
        if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= Date.now())
            return null;
        return fireAt;
    }
    async resolveBindingKey(session) {
        return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey;
    }
}
exports.FestivalTrigger = FestivalTrigger;
