/**
 * 作用域检查工具
 */
export interface ScopeItem {
    type: '私聊' | '群聊';
    id?: string;
}
export interface ScopeConfig {
    mode: '全部启用' | '白名单' | '黑名单';
    list: ScopeItem[];
}
/**
 * 检查频道是否在作用域内
 * @param channelId 频道 ID（私聊可为 private:xxx，群聊为频道或群号）
 * @param scope 作用域配置
 * @param isDirect 显式指定是否私聊，优先于 channelId 前缀判断
 * @param userId 私聊用户 ID，用于匹配私聊白/黑名单
 * @returns 是否允许
 */
export declare function isInScope(channelId: string | undefined, scope: ScopeConfig, isDirect?: boolean, userId?: string, guildId?: string): boolean;
export declare function isSessionInScope(session: any, scope?: ScopeConfig): boolean;
