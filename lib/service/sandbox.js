"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparkSandbox = void 0;
const crypto_1 = require("crypto");
const tag_parser_1 = require("../parser/tag_parser");
const shared_1 = require("../utils/shared");
class SparkSandbox {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.tagParser = new tag_parser_1.TagParser(ctx);
    }
    /**
     * 执行影子会话并直接发送消息
     * 返回是否成功
     */
    async execute(userId, channelId, prompt, room) {
        const logger = this.ctx.logger('spark');
        try {
            // 如果传入了 room，直接使用；否则查询
            const targetRoom = room || await this.getUserRoom(userId, channelId);
            if (!targetRoom) {
                logger.warn(`No room for user ${userId}`);
                return false;
            }
            logger.debug(`Shadow session for [${targetRoom.roomName}]`);
            const triggerMessage = (0, shared_1.buildTriggerMessage)(this.config.triggerTemplate, prompt);
            const events = this.createChatEvents();
            // 遍历所有 bot，找到能用的
            let session = null;
            let selectedBot = null;
            for (const bot of this.ctx.bots) {
                try {
                    // 判断是否为群聊（排除 private: 前缀）
                    const isGroup = channelId.includes(':') && !channelId.startsWith('private:');
                    session = bot.session({
                        type: 'message',
                        timestamp: Date.now(),
                        selfId: bot.selfId,
                        user: { id: userId },
                        channel: { id: channelId, type: 0 },
                        guild: isGroup ? { id: channelId.split(':')[0] } : undefined,
                        content: triggerMessage
                    });
                    selectedBot = bot;
                    logger.debug(`Using bot: ${bot.platform}`);
                    break;
                }
                catch (err) {
                    logger.debug(`Bot ${bot.platform} failed to create session`);
                    continue;
                }
            }
            if (!session || !selectedBot) {
                logger.error('No valid bot/session available');
                return false;
            }
            // 调用 ChatLuna 生成回复
            const response = await this.ctx.chatluna.chat(session, targetRoom, {
                content: triggerMessage,
                role: 'system' // 以系统身份发送提醒
            }, events, false, {}, undefined, (0, crypto_1.randomUUID)());
            let rawContent = response.content;
            // 解析并执行标签
            const { cleanText, results } = await this.tagParser.parseAndExecute(rawContent, session);
            if (results.length > 0) {
                logger.debug(`Parsed ${results.length} tags`);
            }
            // 移除 action 标签
            const finalText = this.removeActionTags(cleanText);
            if (!finalText || !finalText.trim()) {
                logger.warn('Empty response');
                return false;
            }
            await session.send(finalText);
            logger.debug(`Sent to [${targetRoom.roomName}]`);
            return true;
        }
        catch (err) {
            logger.error('Shadow session failed:', err);
            return false;
        }
    }
    /**
     * 查询用户的房间
     */
    async getUserRoom(userId, channelId) {
        // 正确判断 guildId
        let guildId;
        if (channelId.startsWith('private:')) {
            // 私聊：guildId 始终是 "0"
            guildId = '0';
        }
        else if (channelId.includes(':')) {
            // 群聊：从 channelId 中提取
            guildId = channelId.split(':')[0];
        }
        else {
            // 默认：私聊
            guildId = '0';
        }
        const logger = this.ctx.logger('spark');
        logger.debug(`Looking for room: userId="${userId}", groupId="${guildId}"`);
        try {
            const userRoomInfo = await this.ctx.database.get('chathub_user', {
                userId,
                groupId: guildId
            });
            if (!userRoomInfo || userRoomInfo.length === 0) {
                logger.warn(`No room info for userId="${userId}", groupId="${guildId}"`);
                return null;
            }
            logger.debug(`Found user room info: defaultRoomId=${userRoomInfo[0].defaultRoomId}`);
            const rooms = await this.ctx.database.get('chathub_room', {
                roomId: userRoomInfo[0].defaultRoomId
            });
            if (!rooms || rooms.length === 0) {
                logger.warn(`Room ${userRoomInfo[0].defaultRoomId} not found`);
                return null;
            }
            return rooms[0];
        }
        catch (err) {
            logger.error('Failed to get user room:', err);
            return null;
        }
    }
    /**
     * 创建聊天事件处理器
     */
    createChatEvents() {
        const logger = this.ctx.logger('spark');
        return {
            'llm-new-token': async (token) => { },
            'llm-queue-waiting': async (queueLength) => {
                logger.debug(`Waiting in queue, length: ${queueLength}`);
            },
            'llm-calling-tool': async (toolName) => {
                logger.debug(`Calling tool: ${toolName}`);
            },
            'llm-call-tool-end': async (result) => { },
            'llm-used-token-count': async (count) => {
                logger.debug(`Used ${count} tokens`);
            }
        };
    }
    /**
     * 移除 action 标签
     */
    removeActionTags(text) {
        if (!text || typeof text !== 'string')
            return '';
        return text.replace(/\[action\][\s\S]*?\[\/action\]/gi, '').trim();
    }
}
exports.SparkSandbox = SparkSandbox;
