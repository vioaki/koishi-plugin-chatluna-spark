"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendDatabase = extendDatabase;
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
