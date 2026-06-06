import { Context } from 'koishi';
import { SparkService } from '../service';
import { Config } from '../index';
export interface ScheduledConfig {
    enabled: boolean;
    tasks: ScheduledTask[];
}
export interface ScheduledTask {
    name: string;
    time: string;
    prompt: string;
}
export declare class ScheduledTrigger {
    private ctx;
    private config;
    private sparkService;
    private mainConfig;
    private _created;
    private _dispose?;
    constructor(ctx: Context, config: ScheduledConfig, sparkService: SparkService, mainConfig: Config);
    start(): void;
    stop(): void;
    private syncForSession;
    private toCron;
    private resolveBindingKey;
}
