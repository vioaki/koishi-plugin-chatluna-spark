import { Context } from 'koishi';
import { SparkService } from './index';
export declare class SparkScheduler {
    private ctx;
    private service;
    private _tasks;
    constructor(ctx: Context, service: SparkService);
    private listenToCancelEvents;
    start(): Promise<void>;
    private loadPendingTasks;
    private scheduleTask;
    private executeTask;
    /**
     * 判断是否应该使用 chatluna-character sandbox
     * 群聊且 chatluna_character 可用时使用
     */
    private shouldUseCharacterSandbox;
    /**
     * 从 channelId 提取 guildId
     */
    private extractGuildId;
    /**
     * 使用 ChatLuna 主插件 sandbox 执行任务
     */
    private executeChatLunaSandbox;
    private getRoom;
    stop(): void;
}
