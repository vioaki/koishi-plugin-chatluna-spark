"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReminderTool = createReminderTool;
// ← 修改：使用 any 类型避免导入问题
const time_parser_1 = require("../utils/time_parser");
const types_1 = require("../types");
const database_1 = require("../database");
function createReminderTool(ctx) {
    return {
        name: 'set_reminder',
        description: '设置一个定时提醒。当用户说"提醒我..."、"明天...叫我"等时使用。',
        schema: {
            type: 'object',
            properties: {
                time: {
                    type: 'string',
                    description: '时间描述，如"明天早上8点"、"3小时后"'
                },
                content: {
                    type: 'string',
                    description: '提醒内容'
                }
            },
            required: ['time', 'content']
        },
        func: async (params, session, options) => {
            const logger = ctx.logger('spark:tool');
            try {
                const { time: timeStr, content } = params;
                const parsedTime = (0, time_parser_1.parseTime)(timeStr);
                if (!parsedTime.isValid) {
                    return {
                        success: false,
                        message: `无法解析时间：${timeStr}`
                    };
                }
                if (parsedTime.date < new Date()) {
                    return {
                        success: false,
                        message: `指定的时间已过期`
                    };
                }
                const task = await (0, database_1.createSparkTask)(ctx, {
                    userId: session.userId,
                    channelId: session.channelId,
                    guildId: session.guildId,
                    triggerTime: parsedTime.date,
                    type: types_1.SparkTaskType.ALARM,
                    content
                });
                ctx.emit('spark/task-created', task);
                logger.success(`AI created reminder: "${content}" at ${parsedTime.description}`);
                return {
                    success: true,
                    message: `已设置提醒：${parsedTime.description}`,
                    taskId: task.id
                };
            }
            catch (error) {
                logger.error('Failed to create reminder:', error);
                return {
                    success: false,
                    message: `设置失败：${error.message}`
                };
            }
        }
    };
}
