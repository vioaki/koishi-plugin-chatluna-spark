import { Session } from 'koishi';
export declare enum SparkTaskType {
    REMINDER = "reminder",// 用户主动要求的提醒
    FOLLOW_UP = "follow-up",// AI 主动聊天
    MEMO = "memo",// 旧表兼容：迁移时按 reminder 处理
    SCHEDULED = "scheduled",// 定时任务（配置文件）
    FESTIVAL = "festival"
}
export type SparkMode = 'tool' | 'xml' | 'both';
export type SparkScheduleType = 'reminder' | 'follow_up' | 'scheduled' | 'festival' | 'proactive';
export interface SparkTriggerMetadata {
    spark: true;
    sparkType: SparkScheduleType;
    sparkContent: string;
    sparkOrigin?: 'tool' | 'xml' | 'scheduled' | 'festival' | 'legacy' | 'proactive';
    sparkToolSource?: 'chatluna' | 'character';
    autoCancelOnUserMessage?: boolean;
    legacyTaskId?: number;
    configKey?: string;
    conversationId?: string;
    preset?: string;
    requestId?: string;
    character?: boolean;
}
export declare enum SparkTaskStatus {
    PENDING = "pending",
    EXECUTED = "executed",
    CANCELLED = "cancelled",
    FAILED = "failed"
}
export declare enum CancelEvent {
    USER_MESSAGE = "user-message",
    TASK_COMPLETED = "task-completed",
    MANUAL = "manual"
}
export declare enum TaskConditionType {
    USER_IDLE = "user-idle",
    TIME_RANGE = "time-range",
    CUSTOM = "custom"
}
export interface TaskCondition {
    type: TaskConditionType | string;
    duration?: number;
    startTime?: Date;
    endTime?: Date;
    params?: any;
    data?: any;
}
export interface SparkTask {
    id: number;
    userId: string;
    channelId: string;
    guildId?: string;
    triggerTime: Date;
    type: SparkTaskType;
    content: string;
    status: SparkTaskStatus;
    cancelOn: CancelEvent[];
    condition?: TaskCondition;
    tags?: string[];
    metadata?: Record<string, any>;
    roomId?: number;
    createdAt: Date;
}
declare module 'koishi' {
    interface Tables {
        chatluna_spark_tasks: SparkTask;
    }
    interface Context {
        chatluna: any;
    }
    interface Events {
        'chatluna/after-chat'(conversationId: string, sourceMessage: any, responseMessage: any, promptVariables: any, chatInterface: any, session: Session): void | Promise<void>;
    }
}
