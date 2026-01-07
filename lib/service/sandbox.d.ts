import { Context } from 'koishi';
import { Config } from '../index';
export declare class SparkSandbox {
    private ctx;
    private config;
    private tagParser;
    constructor(ctx: Context, config: Config);
    /**
     * 执行影子会话并直接发送消息
     * 返回是否成功
     */
    execute(userId: string, channelId: string, prompt: string, room?: any): Promise<boolean>;
    /**
     * 查询用户的房间
     */
    private getUserRoom;
    /**
     * 创建聊天事件处理器
     */
    private createChatEvents;
    /**
     * 移除 action 标签
     */
    private removeActionTags;
}
