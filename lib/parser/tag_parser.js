"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagParser = void 0;
const time_parser_1 = require("../utils/time_parser");
const database_1 = require("../database");
const types_1 = require("../types");
const session_helper_1 = require("../utils/session_helper");
class TagParser {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * 解析文本中的所有标签并执行
     */
    async parseAndExecute(text, session) {
        const results = [];
        let cleanText = text;
        const matches = [...text.matchAll(TagParser.TAG_PATTERN)];
        for (const match of matches) {
            const [fullMatch, type, timeStr, content] = match;
            try {
                const parsed = await this.parseTag(type, timeStr, content.trim());
                if (parsed) {
                    results.push({ ...parsed, raw: fullMatch });
                    await this.executeTag(parsed, session);
                }
            }
            catch (err) {
                this.ctx.logger('spark:parser').error(`Failed to parse tag: ${fullMatch}`, err);
            }
            // 从文本中移除标签
            cleanText = cleanText.replace(fullMatch, '').trim();
        }
        return { cleanText, results };
    }
    /**
     * 解析单个标签
     */
    async parseTag(type, timeStr, message) {
        const parsedTime = (0, time_parser_1.parseTime)(timeStr);
        if (!parsedTime.isValid) {
            this.ctx.logger('spark:parser').warn(`Invalid time in tag: ${timeStr}`);
            return null;
        }
        if (!message) {
            this.ctx.logger('spark:parser').warn(`Empty message in tag`);
            return null;
        }
        return {
            type,
            data: {
                time: parsedTime.date,
                message,
                timeDescription: parsedTime.description
            },
            raw: ''
        };
    }
    /**
     * 执行标签动作
     */
    async executeTag(tag, session) {
        try {
            switch (tag.type) {
                case 'reminder':
                    // 用户主动要求的提醒，不会自动取消
                    await this.createTask(session, tag.data, types_1.SparkTaskType.REMINDER, [], ['user-created']);
                    break;
                case 'follow-up':
                    // AI 主动聊天，用户发消息时自动取消
                    await this.createTask(session, tag.data, types_1.SparkTaskType.FOLLOW_UP, [types_1.CancelEvent.USER_MESSAGE], ['ai-chat', 'auto-cancel']);
                    break;
                case 'memo':
                    // AI 记住的事情，主动提醒用户，不会自动取消
                    await this.createTask(session, tag.data, types_1.SparkTaskType.MEMO, [], ['ai-memo']);
                    break;
            }
        }
        catch (err) {
            this.ctx.logger('spark').error(`Failed to execute tag [${tag.type}]:`, err);
            throw err;
        }
    }
    /**
     * 创建提醒任务
     */
    async createTask(session, data, type, cancelOn, tags = []) {
        const logger = this.ctx.logger('spark');
        // 使用公共工具函数提取用户信息
        const { realUserId, channelId, guildId } = (0, session_helper_1.extractSessionInfo)(session);
        // 清理 @ 前缀
        let cleanChannelId = channelId;
        if (cleanChannelId?.startsWith('@')) {
            cleanChannelId = cleanChannelId.substring(1);
        }
        // 验证必要信息
        if (!realUserId || !cleanChannelId) {
            const errorMsg = `Invalid session: missing userId or channelId (userId=${realUserId}, channelId=${cleanChannelId})`;
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }
        // 创建任务（不保存 roomId，执行时再查询）
        const task = await (0, database_1.createSparkTask)(this.ctx, {
            userId: realUserId,
            channelId: cleanChannelId,
            guildId,
            triggerTime: data.time,
            type,
            content: data.message,
            cancelOn,
            tags
        });
        // 触发任务创建事件
        this.ctx.emit('spark/task-created', task);
        return task;
    }
}
exports.TagParser = TagParser;
// XML 开闭标签格式，只匹配特定的标签名
// 匹配: <reminder time="30m">喝水</reminder>
// 匹配: <follow-up time="2h">聊天</follow-up>
// 匹配: <memo time="2024-01-15 09:00">生日</memo>
TagParser.SUPPORTED_TAGS = ['reminder', 'follow-up', 'memo'];
TagParser.TAG_PATTERN = /<(reminder|follow-up|memo)\s+time="([^"]+)">([\s\S]*?)<\/\1>/g;
