import { Context, Service } from 'koishi';
import { Config } from '../index';
import { SparkScheduler } from './scheduler';
import { SparkSandbox } from './sandbox';
import { CharacterSandbox } from './character_sandbox';
import { TaskManager } from './task_manager';
import { SparkTaskType, CancelEvent, TaskCondition } from '../types';
declare module 'koishi' {
    interface Context {
        spark: SparkService;
    }
    interface Events {
        'spark/task-created'(task: any): void;
        'spark/task-executed'(task: any): void;
        'spark/task-cancelled'(taskId: number): void;
    }
}
export declare class SparkService extends Service {
    config: Config;
    scheduler: SparkScheduler;
    sandbox: SparkSandbox;
    characterSandbox: CharacterSandbox;
    taskManager: TaskManager;
    constructor(ctx: Context, config: Config);
    start(): Promise<void>;
    stop(): Promise<void>;
    addTask(userId: string, channelId: string, content: string, triggerTime: Date | number, options?: {
        type?: SparkTaskType;
        tags?: string[];
        cancelOn?: CancelEvent[];
        condition?: TaskCondition;
    }): Promise<import("../types").SparkTask>;
    cancelTask(taskId: number): Promise<void>;
}
