"use strict";
/**
 * 共享工具模块
 * 提取各模块中重复的代码
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_PATTERN = void 0;
exports.buildTriggerMessage = buildTriggerMessage;
/** XML 标签正则 */
exports.TAG_PATTERN = /<(reminder|follow-up)\s+time="[^"]+">[\s\S]*?<\/\1>/g;
// ===== 消息构建 =====
/**
 * 构建触发消息
 * @param template 模板字符串，支持 {content} 和 {prompt}（兼容旧版）
 * @param content 任务内容
 */
function buildTriggerMessage(template, content) {
    const finalTemplate = template || '[系统提醒] {content}';
    return finalTemplate
        .replace('{content}', content)
        .replace('{prompt}', content); // 兼容旧版配置
}
