import { Context } from 'koishi';
import { SparkService } from '../service';
import { Config } from '../index';
export interface ProactiveConfig {
    enabled: boolean;
    checkInterval: number;
    initialDelay: number;
    initialProbability: number;
    probabilityIncrease: number;
    maxProbability: number;
    sleepStart: string;
    sleepEnd: string;
    prompts: string[];
}
export declare class ProactiveTrigger {
    private ctx;
    private config;
    private sparkService;
    private mainConfig;
    private _timer;
    private _roomHelper;
    private _roomStates;
    constructor(ctx: Context, config: ProactiveConfig, sparkService: SparkService, mainConfig: Config);
    private listenToChatEvents;
    start(): void;
    stop(): void;
    private isInSleepTime;
    private checkAndTrigger;
    private checkChatLuna;
    private checkCharacter;
}
