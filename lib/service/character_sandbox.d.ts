import { Context } from 'koishi';
import { Config } from '../index';
/**
 * chatluna-character 专用 Sandbox
 *
 * 通过向消息历史注入系统消息并触发 collect 来执行影子会话
 */
export declare class CharacterSandbox {
    private ctx;
    private config;
    constructor(ctx: Context, config: Config);
    /**
     * 执行影子会话
     */
    execute(userId: string, channelId: string, guildId: string, prompt: string): Promise<boolean>;
}
