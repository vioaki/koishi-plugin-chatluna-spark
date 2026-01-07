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
 * @param channelId 频道 ID（私聊为 private:xxx，群聊为群号）
 * @param scope 作用域配置
 * @returns 是否允许
 */
export declare function isInScope(channelId: string, scope: ScopeConfig): boolean;
