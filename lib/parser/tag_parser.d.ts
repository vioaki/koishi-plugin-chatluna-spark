import { Context } from 'koishi';
export interface ParsedTag {
    type: 'reminder' | 'follow-up' | 'memo';
    data: any;
    raw: string;
}
export declare class TagParser {
    private ctx;
    private static readonly SUPPORTED_TAGS;
    private static readonly TAG_PATTERN;
    constructor(ctx: Context);
    /**
     * 解析文本中的所有标签并执行
     */
    parseAndExecute(text: string, session: any): Promise<{
        cleanText: string;
        results: ParsedTag[];
    }>;
    /**
     * 解析单个标签
     */
    private parseTag;
    /**
     * 执行标签动作
     */
    private executeTag;
    /**
     * 创建提醒任务
     */
    private createTask;
}
