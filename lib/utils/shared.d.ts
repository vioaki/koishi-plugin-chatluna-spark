import { Context } from 'koishi';
/**
 * 共享工具模块
 * 提取各模块中重复的代码
 */
/** 存储每个频道最后发消息的用户 ID（带过期时间） */
export declare const lastUserMap: Map<string, {
    userId: string;
    timestamp: number;
}>;
export declare const USER_MAP_EXPIRE_MS: number;
/** XML 标签正则 */
export declare const TAG_PATTERN: RegExp;
/**
 * 初始化用户追踪（定期清理 + 监听消息）
 * 应该只调用一次
 */
export declare function initUserTracking(ctx: Context): void;
/**
 * 获取 chatluna-character 配置的目标群组
 */
export declare function getCharacterGroups(ctx: Context): string[];
/**
 * 构建触发消息
 * @param template 模板字符串，支持 {content} 和 {prompt}（兼容旧版）
 * @param content 任务内容
 */
export declare function buildTriggerMessage(template: string, content: string): string;
