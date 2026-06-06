import { Context, Schema } from 'koishi'
import { SparkService } from './service'
import { extendDatabase } from './database'
import { setupChatlunaInterceptor } from './middleware/chatluna_interceptor'
import { ScheduledTrigger } from './triggers/scheduled'
import { FestivalTrigger } from './triggers/festival'
import { ProactiveTrigger } from './triggers/proactive'
import { ScopeConfig } from './utils/scope'
import { registerSparkScheduleTool } from './tool/spark_schedule'
import { SparkMode } from './types'
import { installCompatPatches } from './compat/patches'
import 'koishi-plugin-chatluna-agent'

export const name = 'chatluna-spark'
export const inject = {
  required: ['database', 'chatluna', 'chatluna_agent']
}

export const usage = `
## chatluna-spark

为 ChatLuna Agent Trigger 添加提醒、跟进、定时任务、节日问候、主动聊天等能力。

默认使用 \`spark_schedule\` tool，XML 标签作为兼容模式保留。
`

export interface Config {
  mode: SparkMode
  triggerTemplate: string
  scope: ScopeConfig
  scheduled: {
    enabled: boolean
    tasks: {
      name: string
      time: string
      prompt: string
    }[]
  }
  festival: {
    enabled: boolean
    promptTemplate: string
    defaultTime: string
    custom: {
      name: string
      date: string
      time: string
      description: string
    }[]
  }
  proactive: {
    enabled: boolean
    checkInterval: number
    initialDelay: number
    initialProbability: number
    probabilityIncrease: number
    maxProbability: number
    sleepStart: string
    sleepEnd: string
    prompts: string[]
  }
  compat: {
    qqTriggerMessageIdPatch: boolean
  }
}

export const Config = Schema.intersect([
  Schema.object({
    mode: Schema.union(['tool', 'xml', 'both'])
      .default('tool')
      .description('任务创建模式。tool：注册 spark_schedule；xml：解析 XML 标签；both：两者都启用。'),
    triggerTemplate: Schema.string()
      .role('textarea')
      .default('[系统提示：现在是提醒时间，请根据以下内容主动向用户发起对话] {content}')
      .description('Agent Trigger 唤醒消息模板。{content} 会被替换为任务内容。')
  }).description('基础配置'),

  Schema.object({
    scope: Schema.object({
      mode: Schema.union(['全部启用', '白名单', '黑名单'])
        .default('全部启用')
        .description('作用域模式'),
      list: Schema.array(Schema.object({
        type: Schema.union(['私聊', '群聊'])
          .required()
          .description('类型'),
        id: Schema.string()
          .description('ID（留空表示该类型的所有频道）')
      }))
        .role('table')
        .default([])
        .description('频道列表')
    }).description('控制插件在哪些地方生效')
  }).description('作用域'),

  Schema.object({
    scheduled: Schema.object({
      enabled: Schema.boolean()
        .default(false)
        .description('启用定时任务'),
      tasks: Schema.array(Schema.object({
        name: Schema.string()
          .required()
          .description('任务名称'),
        time: Schema.string()
          .required()
          .description('触发时间（格式：HH:mm，例如 08:00）'),
        prompt: Schema.string()
          .role('textarea')
          .required()
          .description('提示词')
      }))
        .role('table')
        .default([])
        .description('定时任务列表')
    }).description('定时任务配置')
  }).description('定时任务'),

  Schema.object({
    festival: Schema.object({
      enabled: Schema.boolean()
        .default(true)
        .description('启用节日问候'),
      promptTemplate: Schema.string()
        .role('textarea')
        .default('今天是{festivalName}（{festivalDesc}），请向用户送上节日祝福。要符合你的人设，自然地表达。')
        .description('节日提示词模板。可用变量：{festivalName}、{festivalDesc}'),
      defaultTime: Schema.string()
        .default('09:00')
        .description('默认触发时间（格式：HH:mm）'),
      custom: Schema.array(Schema.object({
        name: Schema.string()
          .required()
          .description('节日名称'),
        date: Schema.string()
          .required()
          .description('日期（格式：MM-DD，例如 03-15）'),
        time: Schema.string()
          .default('09:00')
          .description('触发时间（格式：HH:mm）'),
        description: Schema.string()
          .required()
          .description('节日描述')
      }))
        .role('table')
        .default([])
        .description('自定义节日')
    }).description('节日问候配置')
  }).description('节日问候'),

  Schema.object({
    proactive: Schema.object({
      enabled: Schema.boolean()
        .default(false)
        .description('启用主动聊天'),
      checkInterval: Schema.number()
        .default(15)
        .min(5)
        .max(60)
        .description('检查间隔（分钟）'),
      initialDelay: Schema.number()
        .default(2)
        .min(0.5)
        .max(24)
        .description('初始延迟（小时）'),
      initialProbability: Schema.number()
        .default(0.1)
        .min(0)
        .max(1)
        .step(0.05)
        .description('初始概率（0-1）'),
      probabilityIncrease: Schema.number()
        .default(0.05)
        .min(0)
        .max(0.5)
        .step(0.01)
        .description('每次检查增加的概率'),
      maxProbability: Schema.number()
        .default(0.8)
        .min(0)
        .max(1)
        .step(0.05)
        .description('最大概率'),
      sleepStart: Schema.string()
        .default('23:00')
        .description('休息开始时间'),
      sleepEnd: Schema.string()
        .default('07:00')
        .description('休息结束时间'),
      prompts: Schema.array(Schema.string())
        .role('table')
        .default(['主动来找用户聊天，可以分享一些有趣的事情或者关心一下用户'])
        .description('主动聊天提示词')
    }).description('主动聊天配置')
  }).description('主动聊天'),

  Schema.object({
    compat: Schema.object({
      qqTriggerMessageIdPatch: Schema.boolean()
        .default(false)
        .description('兼容旧版 ChatLuna/QQ 适配器在 Trigger 私聊 markdown 发送时携带虚拟 messageId 的问题。新版修复后应保持关闭。')
    }).description('临时兼容项')
  }).description('兼容项')
]) as Schema<Config>

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('spark')

  extendDatabase(ctx)
  installCompatPatches(ctx, config.compat ?? {})

  const sparkService = new SparkService(ctx, config)
  sparkService.start().catch(err => logger.warn(err))

  if (config.mode === 'tool' || config.mode === 'both') {
    registerSparkScheduleTool(ctx, sparkService.trigger, config.scope)
  }

  if (config.mode === 'xml' || config.mode === 'both') {
    setupChatlunaInterceptor(ctx, sparkService.trigger, config.scope)
  }

  if (config.scheduled?.enabled) {
    const scheduledTrigger = new ScheduledTrigger(ctx, config.scheduled, sparkService, config)
    scheduledTrigger.start()
    ctx.on('dispose', () => scheduledTrigger.stop())
  }

  if (config.festival?.enabled) {
    const festivalTrigger = new FestivalTrigger(ctx, config.festival, sparkService, config)
    festivalTrigger.start()
    ctx.on('dispose', () => festivalTrigger.stop())
  }

  if (config.proactive?.enabled) {
    const proactiveTrigger = new ProactiveTrigger(ctx, config.proactive, sparkService, config)
    proactiveTrigger.start()
    ctx.on('dispose', () => proactiveTrigger.stop())
  }

  registerTaskCommands(ctx, sparkService)
  logger.info(`Spark plugin loaded in ${config.mode} mode`)
}

function registerTaskCommands(ctx: Context, sparkService: SparkService) {
  const isAdmin = (session: any) => session.user && session.user.authority >= 4

  ctx.command('spark.task.list', '查看 Spark 待执行任务')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const tasks = (await sparkService.trigger.listSparkTasks()).filter(task =>
        task.enabled &&
        (isAdmin(session) || task.userId === session.userId)
      )

      if (tasks.length === 0) return '暂无 Spark 待执行任务'

      return tasks
        .slice(0, 20)
        .map((task, index) => {
          const params = task.params as any
          const next = task.nextFireAt ? formatTime(task.nextFireAt) : '被动/无下次触发'
          return `${index + 1}. [ID:${task.id}] ${params?.sparkType ?? task.providerKind} ${next}\n   ${params?.sparkContent ?? task.name ?? ''}`
        })
        .join('\n\n')
    })

  ctx.command('spark.task.cancel <id:number>', '取消 Spark 任务')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      if (!id) return '请指定任务 ID'

      const task = await ctx.chatluna_agent.trigger.getTask(id)
      if (!task || !sparkService.trigger.isSparkTask(task)) return `Spark 任务 [${id}] 不存在`
      if (task.userId !== session.userId && !isAdmin(session)) return '无法取消其他用户的任务'

      await ctx.chatluna_agent.trigger.removeTask(id)
      return `Spark 任务 [${id}] 已取消`
    })

  ctx.command('spark.task.fire <id:number>', '立即触发 Spark 任务')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      if (!id) return '请指定任务 ID'

      const task = await ctx.chatluna_agent.trigger.getTask(id)
      if (!task || !sparkService.trigger.isSparkTask(task)) return `Spark 任务 [${id}] 不存在`
      if (task.userId !== session.userId && !isAdmin(session)) return '无法触发其他用户的任务'

      const result = await ctx.chatluna_agent.trigger.fire(id, session)
      return result.ok || result.deferred
        ? `Spark 任务 [${id}] 已触发`
        : `触发失败：${result.error?.message ?? '未知错误'}`
    })

  ctx.command('spark.task.stats', '查看 Spark 任务统计（管理员）')
    .userFields(['authority'])
    .action(async ({ session }) => {
      if (!isAdmin(session)) return '权限不足'

      const tasks = await sparkService.trigger.listSparkTasks()
      const byType: Record<string, number> = {}
      for (const task of tasks) {
        const type = String((task.params as any)?.sparkType ?? task.providerKind ?? 'unknown')
        byType[type] = (byType[type] ?? 0) + 1
      }

      return [
        'Spark 任务统计',
        `总数: ${tasks.length}`,
        `启用: ${tasks.filter(task => task.enabled).length}`,
        ...Object.entries(byType).map(([type, count]) => `- ${type}: ${count}`)
      ].join('\n')
    })

  ctx.command('spark.task.clean', '清理已迁移旧任务（管理员）')
    .userFields(['authority'])
    .action(async ({ session }) => {
      if (!isAdmin(session)) return '权限不足'

      const tasks = await ctx.database.get('chatluna_spark_tasks', {
        status: 'cancelled'
      } as any)
      const migratedIds = tasks
        .filter(task => (task.metadata as any)?.migratedToTriggerTaskId)
        .map(task => task.id)

      if (migratedIds.length > 0) {
        await ctx.database.remove('chatluna_spark_tasks', migratedIds)
      }

      return `已清理 ${migratedIds.length} 条旧 Spark 任务记录`
    })
}

function formatTime(date: Date) {
  const d = new Date(date)
  const now = new Date()
  const diff = d.getTime() - now.getTime()

  if (diff < 0) return '已过期'
  if (diff < 60000) return '即将触发'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟后`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时后`

  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
}
