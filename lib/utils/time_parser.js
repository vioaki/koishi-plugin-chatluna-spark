"use strict";
/**
 * 精确时间解析器
 *
 * 支持两种格式：
 * 1. 相对时间：数字+单位（如 "30s", "5m", "2h", "1d"）
 * 2. 绝对时间：ISO 8601 或常见格式（如 "2024-01-15 14:30", "14:30"）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTime = parseTime;
exports.formatTime = formatTime;
exports.getRelativeTime = getRelativeTime;
/**
 * 解析时间字符串
 *
 * 支持格式：
 * - 相对时间：30s, 5m, 2h, 1d, 1w（秒/分/时/天/周）
 * - 绝对时间：2024-01-15 14:30, 2024-01-15T14:30:00, 14:30
 */
function parseTime(input) {
    const trimmed = input.trim();
    // 1. 尝试解析相对时间
    const relative = parseRelativeTime(trimmed);
    if (relative) {
        return {
            date: relative,
            description: formatTime(relative),
            isValid: true
        };
    }
    // 2. 尝试解析绝对时间
    const absolute = parseAbsoluteTime(trimmed);
    if (absolute) {
        return {
            date: absolute,
            description: formatTime(absolute),
            isValid: true
        };
    }
    // 解析失败
    return {
        date: new Date(),
        description: '无法解析时间',
        isValid: false
    };
}
/**
 * 解析相对时间
 * 格式：数字 + 单位
 * - s/sec/second(s) = 秒
 * - m/min/minute(s) = 分钟
 * - h/hr/hour(s) = 小时
 * - d/day(s) = 天
 * - w/week(s) = 周
 */
function parseRelativeTime(input) {
    // 匹配：数字 + 可选空格 + 单位
    const match = input.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)$/i);
    if (!match) {
        return null;
    }
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    let milliseconds;
    switch (unit) {
        case 's':
        case 'sec':
        case 'second':
        case 'seconds':
            milliseconds = value * 1000;
            break;
        case 'm':
        case 'min':
        case 'minute':
        case 'minutes':
            milliseconds = value * 60 * 1000;
            break;
        case 'h':
        case 'hr':
        case 'hour':
        case 'hours':
            milliseconds = value * 60 * 60 * 1000;
            break;
        case 'd':
        case 'day':
        case 'days':
            milliseconds = value * 24 * 60 * 60 * 1000;
            break;
        case 'w':
        case 'week':
        case 'weeks':
            milliseconds = value * 7 * 24 * 60 * 60 * 1000;
            break;
        default:
            return null;
    }
    return new Date(Date.now() + milliseconds);
}
/**
 * 解析绝对时间
 * 支持格式：
 * - ISO 8601: 2024-01-15T14:30:00
 * - 日期时间: 2024-01-15 14:30
 * - 仅时间: 14:30 (当天或次日)
 */
function parseAbsoluteTime(input) {
    const now = new Date();
    // 1. 尝试 ISO 8601 或标准日期时间格式
    // 匹配: 2024-01-15 14:30 或 2024-01-15T14:30:00
    const dateTimeMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (dateTimeMatch) {
        const [, year, month, day, hour, minute, second = '0'] = dateTimeMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
        if (!isNaN(date.getTime())) {
            return date;
        }
    }
    // 2. 仅日期格式: 2024-01-15 (默认当天 00:00)
    const dateOnlyMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0);
        if (!isNaN(date.getTime())) {
            return date;
        }
    }
    // 3. 仅时间格式: 14:30 或 14:30:00
    const timeOnlyMatch = input.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnlyMatch) {
        const [, hour, minute, second = '0'] = timeOnlyMatch;
        const date = new Date(now);
        date.setHours(parseInt(hour), parseInt(minute), parseInt(second), 0);
        // 如果时间已过，设为明天
        if (date <= now) {
            date.setDate(date.getDate() + 1);
        }
        return date;
    }
    // 4. 尝试 Date.parse (兜底)
    const parsed = Date.parse(input);
    if (!isNaN(parsed)) {
        return new Date(parsed);
    }
    return null;
}
/**
 * 格式化时间为友好显示
 */
function formatTime(date) {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const diffSeconds = Math.floor(diff / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const timeStr = date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    if (diffDays > 0) {
        return `${timeStr} (${diffDays}天后)`;
    }
    else if (diffHours > 0) {
        return `${timeStr} (${diffHours}小时后)`;
    }
    else if (diffMinutes > 0) {
        return `${timeStr} (${diffMinutes}分钟后)`;
    }
    else if (diffSeconds > 0) {
        return `${timeStr} (${diffSeconds}秒后)`;
    }
    else {
        return `${timeStr} (即将触发)`;
    }
}
/**
 * 获取相对时间描述
 */
function getRelativeTime(date) {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    if (diff < 0)
        return '已过期';
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}天后`;
    if (hours > 0)
        return `${hours}小时后`;
    if (minutes > 0)
        return `${minutes}分钟后`;
    return `${seconds}秒后`;
}
