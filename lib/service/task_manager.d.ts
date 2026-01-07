import { Context } from 'koishi';
import { SparkTask } from '../types';
export declare class TaskManager {
    private ctx;
    constructor(ctx: Context);
    private registerEventHandlers;
    private handleCancelEvent;
    cancelTask(taskId: number, reason?: string): Promise<void>;
    checkTaskCondition(task: SparkTask): Promise<boolean>;
    private checkUserIdle;
    private checkTimeRange;
}
