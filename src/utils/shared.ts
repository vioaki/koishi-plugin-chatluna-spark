/**
 * 共享工具模块
 * 提取各模块中重复的代码
 */

/** XML 标签正则 */
export const TAG_PATTERN = /<(reminder|follow-up)\s+time="([^"]+)">([\s\S]*?)<\/\1>/g

// ===== 消息构建 =====

/**
 * 构建触发消息
 * @param template 模板字符串，支持 {content}
 * @param content 任务内容
 */
export function buildTriggerMessage(template: string, content: string): string {
  const finalTemplate = template || '[系统提醒] {content}'
  return finalTemplate.replace('{content}', content)
}
