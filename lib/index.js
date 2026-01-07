"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.usage = exports.inject = exports.name = void 0;
exports.apply = apply;
const koishi_1 = require("koishi");
const service_1 = require("./service");
const database_1 = require("./database");
const character_interceptor_1 = require("./middleware/character_interceptor");
const chatluna_interceptor_1 = require("./middleware/chatluna_interceptor");
const scheduled_1 = require("./triggers/scheduled");
const festival_1 = require("./triggers/festival");
const proactive_1 = require("./triggers/proactive");
const types_1 = require("./types");
const session_helper_1 = require("./utils/session_helper");
const shared_1 = require("./utils/shared");
exports.name = 'chatluna-spark';
exports.inject = {
    required: ['database', 'chatluna'],
    optional: ['chatluna_character']
};
exports.usage = `
## chatluna-spark

为 ChatLuna 添加主动对话能力，支持定时提醒、节日问候、主动聊天等功能。

访问 [插件文档](https://github.com/vioaki/koishi-plugin-chatluna-spark) 了解如何配置和使用。
`;
exports.Config = koishi_1.Schema.intersect([
    // 基础配置
    koishi_1.Schema.object({
        triggerTemplate: koishi_1.Schema.string()
            .role('textarea')
            .default('[系统提示：现在是提醒时间，请根据以下内容主动向用户发起对话] {content}')
            .description('影子会话触发消息模板。{content} 会被替换为任务内容（如"提醒用户喝水"）')
    }).description('基础配置'),
    // 作用域配置
    koishi_1.Schema.object({
        scope: koishi_1.Schema.object({
            mode: koishi_1.Schema.union(['全部启用', '白名单', '黑名单'])
                .default('全部启用')
                .description('作用域模式'),
            list: koishi_1.Schema.array(koishi_1.Schema.object({
                type: koishi_1.Schema.union(['私聊', '群聊'])
                    .required()
                    .description('类型'),
                id: koishi_1.Schema.string()
                    .description('ID（留空表示该类型的所有频道）')
            }))
                .role('table')
                .default([])
                .description('频道列表')
        }).description('控制插件在哪些地方生效')
    }).description('作用域'),
    // 定时任务
    koishi_1.Schema.object({
        scheduled: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean()
                .default(false)
                .description('启用定时任务'),
            tasks: koishi_1.Schema.array(koishi_1.Schema.object({
                name: koishi_1.Schema.string()
                    .required()
                    .description('任务名称'),
                time: koishi_1.Schema.string()
                    .required()
                    .description('触发时间（格式：HH:mm，例如 08:00）'),
                prompt: koishi_1.Schema.string()
                    .role('textarea')
                    .required()
                    .description('提示词')
            }))
                .role('table')
                .description('定时任务列表')
        }).description('定时任务配置')
    }).description('定时任务'),
    // 节日配置
    koishi_1.Schema.object({
        festival: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean()
                .default(true)
                .description('启用节日问候（已内置 24 节气、传统节日、现代节日、西方节日）'),
            promptTemplate: koishi_1.Schema.string()
                .role('textarea')
                .default('今天是{festivalName}（{festivalDesc}），请向用户送上节日祝福。要符合你的人设，自然地表达。')
                .description('节日提示词模板。可用变量：{festivalName}（节日名称）、{festivalDesc}（节日描述）'),
            defaultTime: koishi_1.Schema.string()
                .default('09:00')
                .description('默认触发时间（格式：HH:mm）'),
            custom: koishi_1.Schema.array(koishi_1.Schema.object({
                name: koishi_1.Schema.string()
                    .required()
                    .description('节日名称'),
                date: koishi_1.Schema.string()
                    .required()
                    .description('日期（格式：MM-DD，例如 03-15）'),
                time: koishi_1.Schema.string()
                    .default('09:00')
                    .description('触发时间（格式：HH:mm）'),
                description: koishi_1.Schema.string()
                    .required()
                    .description('节日描述')
            }))
                .role('table')
                .description('自定义节日（如：主人生日）')
        }).description('节日问候配置')
    }).description('节日问候'),
    // 主动聊天
    koishi_1.Schema.object({
        proactive: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean()
                .default(false)
                .description('启用主动聊天（长时间没有对话时，AI 主动发起聊天）'),
            checkInterval: koishi_1.Schema.number()
                .default(15)
                .min(5)
                .max(60)
                .description('检查间隔（分钟）'),
            initialDelay: koishi_1.Schema.number()
                .default(2)
                .min(0.5)
                .max(24)
                .description('初始延迟（小时）- 距离最后对话多久后开始有概率触发'),
            initialProbability: koishi_1.Schema.number()
                .default(0.1)
                .min(0)
                .max(1)
                .step(0.05)
                .description('初始概率（0-1）'),
            probabilityIncrease: koishi_1.Schema.number()
                .default(0.05)
                .min(0)
                .max(0.5)
                .step(0.01)
                .description('每次检查增加的概率'),
            maxProbability: koishi_1.Schema.number()
                .default(0.8)
                .min(0)
                .max(1)
                .step(0.05)
                .description('最大概率'),
            sleepStart: koishi_1.Schema.string()
                .default('23:00')
                .description('休息开始时间（不会主动聊天）'),
            sleepEnd: koishi_1.Schema.string()
                .default('07:00')
                .description('休息结束时间'),
            prompts: koishi_1.Schema.array(koishi_1.Schema.string())
                .role('table')
                .default(['主动来找用户聊天，可以分享一些有趣的事情或者关心一下用户'])
                .description('主动聊天提示词（随机选择一个）')
        }).description('主动聊天配置。工作原理：距离最后对话指定时间后开始有概率主动聊天，概率逐步增加直到触发或用户主动聊天。')
    }).description('主动聊天')
]);
function apply(ctx, config) {
    const logger = ctx.logger('spark');
    // 1. 扩展数据库
    (0, database_1.extendDatabase)(ctx);
    // 2. 初始化用户追踪（共享模块）
    (0, shared_1.initUserTracking)(ctx);
    // 3. 注册拦截器
    (0, character_interceptor_1.setupCharacterInterceptor)(ctx, config.scope);
    (0, chatluna_interceptor_1.setupChatlunaInterceptor)(ctx, config.scope);
    // 4. 创建 Spark 服务
    const sparkService = new service_1.SparkService(ctx, config);
    // 5. 启动定时任务
    if (config.scheduled?.enabled) {
        const scheduledTrigger = new scheduled_1.ScheduledTrigger(ctx, config.scheduled, sparkService, config);
        scheduledTrigger.start();
        ctx.on('dispose', () => {
            scheduledTrigger.stop();
        });
    }
    // 6. 启动节日问候
    if (config.festival?.enabled) {
        const festivalTrigger = new festival_1.FestivalTrigger(ctx, config.festival, sparkService, config);
        festivalTrigger.start();
        ctx.on('dispose', () => {
            festivalTrigger.stop();
        });
    }
    // 7. 启动主动聊天
    if (config.proactive?.enabled) {
        const proactiveTrigger = new proactive_1.ProactiveTrigger(ctx, config.proactive, sparkService, config);
        proactiveTrigger.start();
        ctx.on('dispose', () => {
            proactiveTrigger.stop();
        });
    }
    logger.info('Spark plugin loaded');
    // 用户命令
    ctx.command('spark.my', '查看我的待执行任务')
        .userFields(['authority'])
        .action(async ({ session }) => {
        const channelId = session.channelId;
        const guildId = session.guildId;
        const userId = (0, session_helper_1.extractRealUserId)(session.userId, channelId);
        logger.debug(`spark.my: userId="${userId}", channelId="${channelId}", guildId="${guildId}"`);
        const tasks = await ctx.database.get('chatluna_spark_tasks', {
            userId,
            $or: [
                { channelId },
                { channelId: guildId }
            ],
            status: types_1.SparkTaskStatus.PENDING
        });
        logger.debug(`spark.my: found ${tasks.length} tasks`);
        if (tasks.length === 0) {
            return '你暂无待执行任务';
        }
        let message = `你的待执行任务 (${tasks.length})\n\n`;
        const formatTime = (date) => {
            const d = new Date(date);
            const now = new Date();
            const diff = d.getTime() - now.getTime();
            if (diff < 0)
                return '已过期';
            if (diff < 60000)
                return '即将触发';
            if (diff < 3600000)
                return `${Math.floor(diff / 60000)}分钟后`;
            if (diff < 86400000)
                return `${Math.floor(diff / 3600000)}小时后`;
            return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        };
        tasks.forEach((task, i) => {
            const tags = task.tags?.length ? ` [${task.tags.join(', ')}]` : '';
            message += `${i + 1}. [ID:${task.id}]${tags} ${formatTime(task.triggerTime)}\n   ${task.content}\n\n`;
        });
        return message.trim();
    });
    ctx.command('spark.cancel <id:number>', '取消指定任务')
        .userFields(['authority'])
        .usage('取消指定 ID 的任务\n示例：spark.cancel 42')
        .action(async ({ session }, id) => {
        if (!id) {
            return '请指定任务 ID\n使用 spark.my 查看任务列表';
        }
        const tasks = await ctx.database.get('chatluna_spark_tasks', { id });
        if (tasks.length === 0) {
            return `任务 [${id}] 不存在`;
        }
        if (tasks[0].status !== types_1.SparkTaskStatus.PENDING) {
            return `任务 [${id}] 已经${tasks[0].status === types_1.SparkTaskStatus.EXECUTED ? '执行' : tasks[0].status === types_1.SparkTaskStatus.CANCELLED ? '取消' : '失败'}，无法取消`;
        }
        const userId = (0, session_helper_1.extractRealUserId)(session.userId, session.channelId);
        const isAdmin = session.user && session.user.authority >= 4;
        if (tasks[0].userId !== userId && !isAdmin) {
            return '无法取消其他用户的任务';
        }
        await ctx.database.set('chatluna_spark_tasks', id, {
            status: types_1.SparkTaskStatus.CANCELLED
        });
        ctx.emit('spark/task-cancelled', id);
        return `任务 [${id}] 已取消`;
    });
    // 管理员命令
    ctx.command('spark.admin.tasks', '查看所有任务（管理员）')
        .userFields(['authority'])
        .action(async ({ session }) => {
        if (!session.user || session.user.authority < 4) {
            return '权限不足';
        }
        const tasks = await ctx.database.get('chatluna_spark_tasks', {
            status: types_1.SparkTaskStatus.PENDING
        });
        if (tasks.length === 0) {
            return '暂无待执行任务';
        }
        let message = `所有待执行任务 (${tasks.length})\n\n`;
        tasks.slice(0, 20).forEach((task, i) => {
            const time = new Date(task.triggerTime);
            const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${time.getHours()}:${time.getMinutes().toString().padStart(2, '0')}`;
            message += `${i + 1}. [ID:${task.id}] ${timeStr}\n   用户: ${task.userId}\n   ${task.content.slice(0, 30)}...\n\n`;
        });
        if (tasks.length > 20) {
            message += `... 还有 ${tasks.length - 20} 条任务`;
        }
        return message.trim();
    });
    ctx.command('spark.admin.stats', '查看统计信息（管理员）')
        .userFields(['authority'])
        .action(async ({ session }) => {
        if (!session.user || session.user.authority < 4) {
            return '权限不足';
        }
        const allTasks = await ctx.database.get('chatluna_spark_tasks', {});
        const stats = {
            pending: 0,
            executed: 0,
            cancelled: 0,
            failed: 0,
            byType: {}
        };
        for (const task of allTasks) {
            switch (task.status) {
                case types_1.SparkTaskStatus.PENDING:
                    stats.pending++;
                    break;
                case types_1.SparkTaskStatus.EXECUTED:
                    stats.executed++;
                    break;
                case types_1.SparkTaskStatus.CANCELLED:
                    stats.cancelled++;
                    break;
                case types_1.SparkTaskStatus.FAILED:
                    stats.failed++;
                    break;
            }
            stats.byType[task.type] = (stats.byType[task.type] || 0) + 1;
        }
        let message = `任务统计\n\n`;
        message += `待执行: ${stats.pending}\n`;
        message += `已执行: ${stats.executed}\n`;
        message += `已取消: ${stats.cancelled}\n`;
        message += `失败: ${stats.failed}\n\n`;
        message += `按类型:\n`;
        for (const [type, count] of Object.entries(stats.byType)) {
            message += `- ${type}: ${count}\n`;
        }
        return message.trim();
    });
    ctx.command('spark.admin.clean', '清理已完成的任务（管理员）')
        .userFields(['authority'])
        .action(async ({ session }) => {
        if (!session.user || session.user.authority < 4) {
            return '权限不足';
        }
        const result = await ctx.database.remove('chatluna_spark_tasks', {
            $or: [
                { status: types_1.SparkTaskStatus.EXECUTED },
                { status: types_1.SparkTaskStatus.CANCELLED },
                { status: types_1.SparkTaskStatus.FAILED }
            ]
        });
        return `已清理 ${result.matched} 条任务记录`;
    });
}
