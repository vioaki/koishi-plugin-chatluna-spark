"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SparkTriggerAdapter = void 0;
const koishi_plugin_chatluna_agent_1 = require("koishi-plugin-chatluna-agent");
const types_1 = require("../types");
const shared_1 = require("../utils/shared");
class SparkTriggerAdapter {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this._logger = this.ctx.logger('spark:trigger');
        this.listenForAutoCancel();
    }
    async createOnce(input) {
        if (input.fireAt.getTime() <= Date.now()) {
            throw new Error('fireAt must be in the future');
        }
        const bindingKey = input.bindingKey ?? (input.session ? await this.resolveSessionBindingKey(input.session) : undefined);
        const task = await this.ctx.chatluna_agent.trigger.createTask(this.resolveCreateSource(input), {
            providerKind: 'once',
            name: input.name ?? this.formatTaskName(input.type, input.content),
            bindingKey,
            createdBy: input.createdBy ?? input.session?.userId ?? input.routing?.userId ?? 'spark',
            source: 'plugin',
            params: this.buildParams(input, {
                fireAt: input.fireAt.toISOString()
            }),
            wakeupTemplate: this.buildWakeupTemplate(input)
        });
        this._logger.info(`Created Spark ${input.type} trigger [${task.id}]`);
        return task;
    }
    async createCron(source, input) {
        const task = await this.ctx.chatluna_agent.trigger.createTask(source, {
            providerKind: 'cron',
            name: input.name ?? this.formatTaskName(input.type, input.content),
            bindingKey: input.bindingKey,
            createdBy: input.createdBy ?? 'spark',
            source: 'plugin',
            params: this.buildParams(input, {
                expression: input.expression,
                missedRunPolicy: input.missedRunPolicy ?? 'skip'
            }),
            wakeupTemplate: this.buildWakeupTemplate(input)
        });
        this._logger.info(`Created Spark ${input.type} cron trigger [${task.id}]`);
        return task;
    }
    async wakeup(source, type, content) {
        return await this.ctx.chatluna_agent.trigger.wakeup(source, {
            message: (0, shared_1.buildTriggerMessage)(this.config.triggerTemplate, content),
            replyTo: 'channel',
            execMode: 'chain',
            newConversation: false,
            source: {
                kind: 'spark',
                detail: {
                    spark: true,
                    sparkType: type,
                    sparkContent: content,
                    sparkOrigin: 'proactive'
                }
            }
        });
    }
    async listSparkTasks() {
        const tasks = await this.ctx.chatluna_agent.trigger.listTasks();
        return tasks.filter(task => this.isSparkTask(task));
    }
    async findSparkTaskByConfigKey(bindingKey, configKey) {
        const tasks = await this.listSparkTasks();
        return tasks.find(task => task.enabled &&
            task.bindingKey === bindingKey &&
            task.params?.configKey === configKey);
    }
    isSparkTask(task) {
        return task.params?.spark === true;
    }
    async migrateLegacyPendingTasks() {
        const tasks = await this.ctx.database.get('chatluna_spark_tasks', {
            status: types_1.SparkTaskStatus.PENDING
        });
        let migrated = 0;
        for (const task of tasks) {
            if (task.metadata?.migratedToTriggerTaskId) {
                continue;
            }
            try {
                const triggerTask = await this.migrateLegacyTask(task);
                await this.ctx.database.set('chatluna_spark_tasks', task.id, {
                    status: types_1.SparkTaskStatus.CANCELLED,
                    metadata: {
                        ...(task.metadata ?? {}),
                        migratedToTriggerTaskId: triggerTask.id,
                        migratedAt: new Date()
                    }
                });
                migrated++;
            }
            catch (err) {
                this._logger.warn(`Failed to migrate legacy task [${task.id}]: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (migrated > 0) {
            this._logger.info(`Migrated ${migrated} legacy pending task(s) to ChatLuna Agent Trigger`);
        }
    }
    async migrateLegacyTask(task) {
        const routing = this.routingFromLegacyTask(task);
        const legacyTriggerTime = new Date(task.triggerTime);
        const missed = legacyTriggerTime.getTime() <= Date.now();
        const fireAt = missed ? new Date(Date.now() + 1000) : legacyTriggerTime;
        return await this.createOnce({
            type: this.mapLegacyType(task.type),
            content: task.content,
            fireAt,
            routing,
            createdBy: task.userId || 'spark',
            name: `Spark legacy #${task.id}`,
            autoCancelOnUserMessage: task.cancelOn?.includes('user-message'),
            metadata: {
                sparkOrigin: 'legacy',
                legacyTaskId: task.id,
                legacyTags: task.tags ?? [],
                legacyTriggerTime: legacyTriggerTime.toISOString(),
                legacyMissed: missed
            }
        });
    }
    routingFromLegacyTask(task) {
        const channelId = task.channelId;
        const isDirect = channelId?.startsWith('private:') || !task.guildId;
        const userId = isDirect && channelId?.startsWith('private:')
            ? channelId.replace('private:', '')
            : task.userId;
        const bot = this.getFallbackBot();
        if (!bot && (!task.metadata?.platform || !task.metadata?.selfId)) {
            throw new Error('Cannot migrate legacy task without an available bot or stored routing metadata');
        }
        return {
            platform: task.metadata?.platform ?? bot.platform,
            selfId: task.metadata?.selfId ?? bot.selfId,
            userId,
            guildId: isDirect ? undefined : task.guildId ?? channelId,
            channelId: isDirect ? undefined : channelId,
            isDirect
        };
    }
    getFallbackBot() {
        return Object.values(this.ctx.bots)[0];
    }
    resolveCreateSource(input) {
        if (input.session)
            return input.session;
        if (input.routing)
            return input.routing;
        throw new Error('Spark trigger requires a session or routing');
    }
    buildWakeupTemplate(input) {
        return {
            message: (0, shared_1.buildTriggerMessage)(this.config.triggerTemplate, input.content),
            replyTo: input.replyTo ?? 'channel',
            execMode: 'chain',
            newConversation: false
        };
    }
    buildParams(input, params) {
        return {
            ...params,
            ...(input.metadata ?? {}),
            spark: true,
            sparkType: input.type,
            sparkContent: input.content,
            autoCancelOnUserMessage: input.autoCancelOnUserMessage === true
        };
    }
    mapLegacyType(type) {
        switch (type) {
            case types_1.SparkTaskType.MEMO:
                return 'reminder';
            case types_1.SparkTaskType.FOLLOW_UP:
                return 'follow_up';
            case types_1.SparkTaskType.SCHEDULED:
                return 'scheduled';
            case types_1.SparkTaskType.FESTIVAL:
                return 'festival';
            default:
                return 'reminder';
        }
    }
    formatTaskName(type, content) {
        const preview = content.length > 24 ? `${content.slice(0, 24)}...` : content;
        return `Spark ${type}: ${preview}`;
    }
    listenForAutoCancel() {
        this.ctx.on('message', async (session) => {
            try {
                const bindingKey = await this.resolveSessionBindingKey(session);
                const tasks = (await this.listSparkTasks()).filter(task => task.enabled &&
                    task.bindingKey === bindingKey &&
                    task.params?.autoCancelOnUserMessage === true);
                for (const task of tasks) {
                    await this.ctx.chatluna_agent.trigger.removeTask(task.id);
                    this._logger.info(`Auto-cancelled follow-up trigger [${task.id}] by user message`);
                }
            }
            catch (err) {
                this._logger.debug(`Auto-cancel check skipped: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    }
    async resolveSessionBindingKey(session) {
        try {
            return (await this.ctx.chatluna.conversation.resolveConstraint(session)).bindingKey;
        }
        catch {
            return (0, koishi_plugin_chatluna_agent_1.bindingKeyFromSession)(session);
        }
    }
}
exports.SparkTriggerAdapter = SparkTriggerAdapter;
