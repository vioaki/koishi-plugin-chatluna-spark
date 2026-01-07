import { Session } from 'koishi';
export declare enum SparkTaskType {
    REMINDER = "reminder",// 用户主动要求的提醒
    FOLLOW_UP = "follow-up",// AI 主动聊天
    MEMO = "memo",// AI 记住的事情，主动提醒用户
    SCHEDULED = "scheduled",// 定时任务（配置文件）
    FESTIVAL = "festival"
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
export interface ConversationRoom {
    roomId: number;
    roomName: string;
    roomMasterId: string;
    conversationId: string;
    visibility: 'public' | 'private';
    preset: string;
    model: string;
    chatMode: string;
    autoUpdate: boolean;
    updatedTime: Date;
}
export interface ChatHubUser {
    userId: string;
    groupId: string;
    defaultRoomId: number;
}
export interface ChatHubMessage {
    id: string;
    text: string;
    role: string;
    conversation: string;
    userId: string;
    createdAt: Date;
}
export interface CharacterMessage {
    content: string;
    name: string;
    id: string;
    messageId?: string;
    timestamp?: number;
    quote?: CharacterMessage;
    images?: {
        url: string;
        hash: string;
        formatted: string;
    }[];
}
declare module 'koishi' {
    interface Tables {
        chatluna_spark_tasks: SparkTask;
        chathub_room: ConversationRoom;
        chathub_user: ChatHubUser;
        chathub_message: ChatHubMessage;
    }
    interface Context {
        chatluna: any;
        chatluna_character?: any;
    }
    interface Events {
        'chatluna_character/message_collect'(session: Session, messages: CharacterMessage[]): void | Promise<void>;
        'chatluna/after-chat'(conversationId: string, sourceMessage: any, responseMessage: any, promptVariables: any, chatInterface: any, session: Session): void | Promise<void>;
    }
}
