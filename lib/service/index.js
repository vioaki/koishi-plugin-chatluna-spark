"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparkService = void 0;
const koishi_1 = require("koishi");
const trigger_adapter_1 = require("./trigger_adapter");
class SparkService extends koishi_1.Service {
    constructor(ctx, config) {
        super(ctx, 'spark', true);
        this.config = config;
        this.trigger = new trigger_adapter_1.SparkTriggerAdapter(ctx, config);
    }
    async start() {
        await this.trigger.migrateLegacyPendingTasks();
    }
}
exports.SparkService = SparkService;
