"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRealUserId = extractRealUserId;
exports.extractGuildId = extractGuildId;
exports.isGroupChat = isGroupChat;
exports.extractSessionInfo = extractSessionInfo;
exports.createSyntheticSession = createSyntheticSession;
/**
 * 从 channelId 提取真实的 userId
 * 私聊时 channelId 格式为 private:xxx，需要提取
 * 群聊时直接返回 userId
 */
function extractRealUserId(userId, channelId) {
    if (channelId?.startsWith('private:')) {
        return channelId.replace('private:', '');
    }
    return userId;
}
/**
 * 从 channelId 提取 guildId
 * 私聊：返回 "0"
 * 群聊：从 channelId 中提取（格式为 guildId:channelId）
 */
function extractGuildId(channelId) {
    if (!channelId)
        return '0';
    if (channelId.startsWith('private:')) {
        return '0';
    }
    if (channelId.includes(':')) {
        return channelId.split(':')[0];
    }
    return '0';
}
/**
 * 判断是否为群聊
 */
function isGroupChat(channelId) {
    if (!channelId)
        return false;
    return channelId.includes(':') && !channelId.startsWith('private:');
}
/**
 * 从 session 中提取完整的用户信息
 */
function extractSessionInfo(session) {
    const userId = session.userId || session.user?.id || session.event?.user?.id;
    const channelId = session.channelId || session.channel?.id || session.event?.channel?.id;
    const guildId = session.guildId || session.guild?.id || session.event?.guild?.id || extractGuildId(channelId);
    const realUserId = extractRealUserId(userId, channelId);
    return { userId, channelId, guildId, realUserId };
}
/**
 * 创建合成的 Koishi Session
 */
function createSyntheticSession(ctx, userId, channelId, content) {
    const isGroup = isGroupChat(channelId);
    for (const bot of ctx.bots) {
        try {
            const session = bot.session({
                type: 'message',
                timestamp: Date.now(),
                selfId: bot.selfId,
                user: { id: userId },
                channel: { id: channelId, type: 0 },
                guild: isGroup ? { id: channelId.split(':')[0] } : undefined,
                content
            });
            return session;
        }
        catch {
            continue;
        }
    }
    return null;
}
