/**
 * 共享工具模块
 * 提取各模块中重复的代码
 */
/** XML 标签正则 */
export declare const TAG_PATTERN: RegExp;
/**
 * 构建触发消息
 * @param template 模板字符串，支持 {content} 和 {prompt}（兼容旧版）
 * @param content 任务内容
 */
export declare function buildTriggerMessage(template: string, content: string): string;
