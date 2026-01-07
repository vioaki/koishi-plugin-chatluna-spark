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
    private _jobs;
    private _roomHelper;
    constructor(ctx: Context, config: ScheduledConfig, sparkService: SparkService, mainConfig: Config);
    start(): void;
    stop(): void;
    private scheduleTask;
    private triggerTask;
    /**
     * ChatLuna 模式：遍历所有房间
     */
    private triggerChatLuna;
    /**
     * Character 模式：遍历配置的群组
     */
    private triggerCharacter;
}
