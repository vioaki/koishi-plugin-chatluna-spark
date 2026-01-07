import { Context } from 'koishi';
import { SparkTask, SparkTaskType, CancelEvent, TaskCondition } from './types';
export declare function extendDatabase(ctx: Context): void;
export declare function createSparkTask(ctx: Context, data: {
    userId: string;
    channelId: string;
    guildId?: string;
    triggerTime: Date | number;
    type: SparkTaskType;
    content: string;
    cancelOn?: CancelEvent[];
    condition?: TaskCondition;
    tags?: string[];
    metadata?: Record<string, any>;
    roomId?: number;
}): Promise<SparkTask>;
