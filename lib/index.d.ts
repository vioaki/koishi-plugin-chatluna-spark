import { Context, Schema } from 'koishi';
import { ScopeConfig } from './utils/scope';
import { SparkMode } from './types';
import 'koishi-plugin-chatluna-agent';
export declare const name = "chatluna-spark";
export declare const inject: {
    required: string[];
};
export declare const usage = "\n## chatluna-spark\n\n\u4E3A ChatLuna Agent Trigger \u6DFB\u52A0\u63D0\u9192\u3001\u8DDF\u8FDB\u3001\u5B9A\u65F6\u4EFB\u52A1\u3001\u8282\u65E5\u95EE\u5019\u3001\u4E3B\u52A8\u804A\u5929\u7B49\u80FD\u529B\u3002\n\n\u9ED8\u8BA4\u4F7F\u7528 `spark_schedule` tool\uFF0CXML \u6807\u7B7E\u4F5C\u4E3A\u517C\u5BB9\u6A21\u5F0F\u4FDD\u7559\u3002\n";
export interface Config {
    mode: SparkMode;
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
    compat: {
        qqTriggerMessageIdPatch: boolean;
    };
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
