import type { Context } from 'koishi';
import { SparkTriggerAdapter } from '../service/trigger_adapter';
import { ScopeConfig } from '../utils/scope';
export declare function registerSparkScheduleTool(ctx: Context, adapter: SparkTriggerAdapter, scope?: ScopeConfig): void;
