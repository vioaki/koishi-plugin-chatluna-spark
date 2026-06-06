import { Context, Session } from 'koishi';
import { type TriggerTask, type WakeupRouting } from 'koishi-plugin-chatluna-agent';
import { Config } from '../index';
import { SparkScheduleType } from '../types';
export interface CreateSparkTriggerInput {
    type: SparkScheduleType;
    content: string;
    fireAt: Date;
    session?: Session;
    routing?: WakeupRouting;
    bindingKey?: string;
    createdBy?: string;
    name?: string;
    autoCancelOnUserMessage?: boolean;
    metadata?: Record<string, any>;
    replyTo?: 'channel' | 'user' | 'silent';
}
export declare class SparkTriggerAdapter {
    private ctx;
    private config;
    private _logger;
    constructor(ctx: Context, config: Config);
    createOnce(input: CreateSparkTriggerInput): Promise<TriggerTask>;
    createCron(source: Session | WakeupRouting, input: Omit<CreateSparkTriggerInput, 'fireAt' | 'session' | 'routing'> & {
        expression: string;
        missedRunPolicy?: 'skip' | 'fire_once';
    }): Promise<TriggerTask>;
    wakeup(source: Session | WakeupRouting, type: SparkScheduleType, content: string): Promise<import("koishi-plugin-chatluna-agent").WakeupResult>;
    listSparkTasks(): Promise<TriggerTask[]>;
    findSparkTaskByConfigKey(bindingKey: string, configKey: string): Promise<TriggerTask>;
    isSparkTask(task: TriggerTask): boolean;
    migrateLegacyPendingTasks(): Promise<void>;
    private migrateLegacyTask;
    private routingFromLegacyTask;
    private getFallbackBot;
    private resolveCreateSource;
    private buildWakeupTemplate;
    private buildParams;
    private mapLegacyType;
    private formatTaskName;
    private listenForAutoCancel;
    private resolveSessionBindingKey;
}
