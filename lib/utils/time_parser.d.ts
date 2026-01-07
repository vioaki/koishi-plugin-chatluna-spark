/**
 * 精确时间解析器
 *
 * 支持两种格式：
 * 1. 相对时间：数字+单位（如 "30s", "5m", "2h", "1d"）
 * 2. 绝对时间：ISO 8601 或常见格式（如 "2024-01-15 14:30", "14:30"）
 */
export interface ParsedTime {
    date: Date;
    description: string;
    isValid: boolean;
}
/**
 * 解析时间字符串
 *
 * 支持格式：
 * - 相对时间：30s, 5m, 2h, 1d, 1w（秒/分/时/天/周）
 * - 绝对时间：2024-01-15 14:30, 2024-01-15T14:30:00, 14:30
 */
export declare function parseTime(input: string): ParsedTime;
/**
 * 格式化时间为友好显示
 */
export declare function formatTime(date: Date): string;
/**
 * 获取相对时间描述
 */
export declare function getRelativeTime(date: Date): string;
