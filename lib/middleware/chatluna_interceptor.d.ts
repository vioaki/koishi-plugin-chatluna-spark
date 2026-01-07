import { Context } from 'koishi';
import { ScopeConfig } from '../utils/scope';
/**
 * ChatLuna 主插件专用拦截器
 * 通过 chatChain 中间件获取 AI 响应，检测标签、创建任务、并修改消息移除标签
 */
export declare function setupChatlunaInterceptor(ctx: Context, scope?: ScopeConfig): void;
