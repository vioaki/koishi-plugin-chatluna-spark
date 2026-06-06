import { Context } from 'koishi';
export interface CompatConfig {
    qqTriggerMessageIdPatch?: boolean;
}
export declare function installCompatPatches(ctx: Context, config?: CompatConfig): void;
