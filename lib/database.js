"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendDatabase = extendDatabase;
exports.createSparkTask = createSparkTask;
const types_1 = require("./types");
function extendDatabase(ctx) {
    ctx.model.extend('chatluna_spark_tasks', {
        id: 'unsigned',
        userId: 'string',
        channelId: 'string',
        guildId: 'string',
        triggerTime: 'timestamp',
        type: 'string',
        content: 'text',
        status: 'string',
        cancelOn: 'json',
        condition: 'json',
        tags: 'json',
        metadata: 'json',
        roomId: 'unsigned',
        createdAt: 'timestamp'
    }, {
        primary: 'id',
        autoInc: true
    });
}
async function createSparkTask(ctx, data) {
    const triggerTime = typeof data.triggerTime === 'number'
        ? new Date(Date.now() + data.triggerTime * 1000)
        : data.triggerTime;
    const task = await ctx.database.create('chatluna_spark_tasks', {
        userId: data.userId,
        channelId: data.channelId,
        guildId: data.guildId,
        triggerTime,
        type: data.type,
        content: data.content,
        status: types_1.SparkTaskStatus.PENDING,
        cancelOn: data.cancelOn || [],
        condition: data.condition,
        tags: data.tags || [],
        metadata: data.metadata || {},
        roomId: data.roomId,
        createdAt: new Date()
    });
    return task;
}
