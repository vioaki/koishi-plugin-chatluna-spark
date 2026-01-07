import { Context } from 'koishi';
export interface ActiveChatConfig {
    enabled: boolean;
    baseInterval: number;
    probabilityIncrease: number;
    sleepStartHour: number;
    sleepEndHour: number;
}
export declare class ActiveChatEngine {
    private ctx;
    private config;
    constructor(ctx: Context, config: ActiveChatConfig);
    start(): void;
    scheduleActiveChat(userId: string, channelId: string, roomId?: number): Promise<void>;
    private calculateDelay;
    private isInSleepTime;
}
