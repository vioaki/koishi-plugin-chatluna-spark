import { Context } from 'koishi';
import { ScopeConfig } from '../utils/scope';
declare const TAG_PATTERN: RegExp;
declare const lastUserMap: Map<string, {
    userId: string;
    timestamp: number;
}>;
export declare function setupTagInterceptor(ctx: Context, scope?: ScopeConfig): void;
export { lastUserMap, TAG_PATTERN };
