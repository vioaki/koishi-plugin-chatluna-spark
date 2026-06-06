import { Context, Service } from 'koishi';
import { Config } from '../index';
import { SparkTriggerAdapter } from './trigger_adapter';
declare module 'koishi' {
    interface Context {
        spark: SparkService;
    }
}
export declare class SparkService extends Service {
    config: Config;
    trigger: SparkTriggerAdapter;
    constructor(ctx: Context, config: Config);
    start(): Promise<void>;
}
