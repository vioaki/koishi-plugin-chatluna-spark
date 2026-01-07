"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FestivalTrigger = void 0;
const cron_1 = require("cron");
const festivals_1 = require("../data/festivals");
const room_helper_1 = require("../utils/room_helper");
const scope_1 = require("../utils/scope");
const shared_1 = require("../utils/shared");
class FestivalTrigger {
    constructor(ctx, config, sparkService, mainConfig) {
        this.ctx = ctx;
        this.config = config;
        this.sparkService = sparkService;
        this.mainConfig = mainConfig;
        this._jobs = [];
        this._festivals = [];
        this._roomHelper = new room_helper_1.RoomHelper(ctx);
        this.loadFestivals();
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
        const counts = { 'solar-term': 0, 'traditional': 0, 'modern': 0, 'western': 0 };
        for (const f of builtinFestivals) {
            counts[f.category]++;
        }
        this.ctx.logger('spark').info(`Loaded ${this._festivals.length} festivals for ${currentYear}`);
    }
    start() {
        if (this._festivals.length === 0) {
            return;
        }
        for (const festival of this._festivals) {
            this.scheduleFestival(festival);
        }
    }
    stop() {
        for (const job of this._jobs) {
            job.stop();
        }
        this._jobs = [];
    }
    scheduleFestival(festival) {
        try {
            const [month, day] = festival.date.split('-').map(s => s.trim());
            const [hour, minute] = festival.time.split(':').map(s => s.trim());
            const cronExp = `${minute} ${hour} ${day} ${month} *`;
            const job = new cron_1.CronJob(cronExp, async () => {
                await this.triggerFestival(festival);
            }, null, false, 'Asia/Shanghai');
            job.start();
            this._jobs.push(job);
        }
        catch (err) {
            this.ctx.logger('spark').error(`Failed to schedule festival ${festival.name}:`, err);
        }
    }
    async triggerFestival(festival) {
        this.ctx.logger('spark').info(`Festival greeting: ${festival.name}`);
        const prompt = this.config.promptTemplate
            .replace(/{festivalName}/g, festival.name)
            .replace(/{festivalDesc}/g, festival.description);
        // 执行 ChatLuna 模式
        await this.triggerChatLuna(festival, prompt);
        // 执行 Character 模式
        await this.triggerCharacter(festival, prompt);
    }
    async triggerChatLuna(festival, prompt) {
        const rooms = await this._roomHelper.getAllRooms();
        if (rooms.length === 0) {
            return;
        }
        for (const roomInfo of rooms) {
            try {
                if (this.mainConfig.scope && !(0, scope_1.isInScope)(roomInfo.channelId, this.mainConfig.scope)) {
                    continue;
                }
                await this.sparkService.sandbox.execute(roomInfo.userId, roomInfo.channelId, prompt, roomInfo.room);
            }
            catch (err) {
                // 静默处理单个房间的错误
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    async triggerCharacter(festival, prompt) {
        if (!this.ctx.chatluna_character) {
            return;
        }
        const groups = (0, shared_1.getCharacterGroups)(this.ctx);
        if (groups.length === 0) {
            return;
        }
        for (const guildId of groups) {
            try {
                await this.sparkService.characterSandbox.execute('system', guildId, guildId, prompt);
            }
            catch (err) {
                // 静默处理单个群组的错误
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
exports.FestivalTrigger = FestivalTrigger;
