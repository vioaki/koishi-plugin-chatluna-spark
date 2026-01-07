import { Context } from 'koishi';
import { ScopeConfig } from '../utils/scope';
/**
 * chatluna-character 专用检测器
 * 通过拦截 logger.debug 获取 AI 原始响应，只检测标签并创建任务
 */
export declare function setupCharacterInterceptor(ctx: Context, scope?: ScopeConfig): void;
