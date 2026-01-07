import { Context } from 'koishi';
import { ScopeConfig } from '../utils/scope';
declare const TAG_PATTERN: RegExp;
declare const lastUserMap: Map<string, {
    userId: string;
    timestamp: number;
}>;
/**
 * 尽早包装 createChatModel 方法
 * 必须在 chatluna_character 加载之前调用
 */
export declare function setupEarlyModelWrapper(ctx: Context, scope?: ScopeConfig): void;
export { lastUserMap, TAG_PATTERN };
