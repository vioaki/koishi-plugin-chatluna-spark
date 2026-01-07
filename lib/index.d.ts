import { Context, Schema } from 'koishi';
import { ScopeConfig } from './utils/scope';
export declare const name = "chatluna-spark";
export declare const inject: {
    required: string[];
    optional: string[];
};
export declare const usage = "\n## chatluna-spark\n\n\u4E3A ChatLuna \u6DFB\u52A0\u4E3B\u52A8\u5BF9\u8BDD\u80FD\u529B\uFF0C\u652F\u6301\u5B9A\u65F6\u63D0\u9192\u3001\u8282\u65E5\u95EE\u5019\u3001\u4E3B\u52A8\u804A\u5929\u7B49\u529F\u80FD\u3002\n\n\u8BBF\u95EE [\u63D2\u4EF6\u6587\u6863](https://github.com/vioaki/koishi-plugin-chatluna-spark) \u4E86\u89E3\u5982\u4F55\u914D\u7F6E\u548C\u4F7F\u7528\u3002\n";
export interface Config {
    triggerTemplate: string;
    scope: ScopeConfig;
    scheduled: {
        enabled: boolean;
        tasks: {
            name: string;
            time: string;
            prompt: string;
        }[];
    };
    festival: {
        enabled: boolean;
        promptTemplate: string;
        defaultTime: string;
        custom: {
            name: string;
            date: string;
            time: string;
            description: string;
        }[];
    };
    proactive: {
        enabled: boolean;
        checkInterval: number;
        initialDelay: number;
        initialProbability: number;
        probabilityIncrease: number;
        maxProbability: number;
        sleepStart: string;
        sleepEnd: string;
        prompts: string[];
    };
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
