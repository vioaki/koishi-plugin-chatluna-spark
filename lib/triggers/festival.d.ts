import { Context } from 'koishi';
import { SparkService } from '../service';
import { Config } from '../index';
export interface FestivalConfig {
    enabled: boolean;
    promptTemplate: string;
    defaultTime: string;
    custom: {
        name: string;
        date: string;
        time: string;
        description: string;
    }[];
}
export declare class FestivalTrigger {
    private ctx;
    private config;
    private sparkService;
    private mainConfig;
    private _festivals;
    private _created;
    private _dispose?;
    constructor(ctx: Context, config: FestivalConfig, sparkService: SparkService, mainConfig: Config);
    start(): void;
    stop(): void;
    private loadFestivals;
    private syncForSession;
    private toFireAt;
    private resolveBindingKey;
}
