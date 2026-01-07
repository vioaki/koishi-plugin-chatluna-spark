import { Context, Session } from 'koishi';
/**
 * 从 channelId 提取真实的 userId
 * 私聊时 channelId 格式为 private:xxx，需要提取
 * 群聊时直接返回 userId
 */
export declare function extractRealUserId(userId: string | undefined, channelId: string | undefined): string | undefined;
/**
 * 从 channelId 提取 guildId
 * 私聊：返回 "0"
 * 群聊：从 channelId 中提取（格式为 guildId:channelId）
 */
export declare function extractGuildId(channelId: string | undefined): string;
/**
 * 判断是否为群聊
 */
export declare function isGroupChat(channelId: string | undefined): boolean;
/**
 * 从 session 中提取完整的用户信息
 */
export declare function extractSessionInfo(session: Session | any): {
    userId: string | undefined;
    channelId: string | undefined;
    guildId: string | undefined;
    realUserId: string | undefined;
};
/**
 * 创建合成的 Koishi Session
 */
export declare function createSyntheticSession(ctx: Context, userId: string, channelId: string, content: string): Session | null;
