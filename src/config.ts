import { Schema } from 'koishi'
import { SparkMode } from './types'

export interface ScheduledTaskConfig {
  name: string
  time: string
  prompt: string
}

export interface ScheduledConfig {
  enabled: boolean
  tasks: ScheduledTaskConfig[]
}

export interface FestivalCustomConfig {
  name: string
  date: string
  time: string
  description: string
}

export interface FestivalConfig {
  enabled: boolean
  promptTemplate: string
  defaultTime: string
  custom: FestivalCustomConfig[]
}

export interface ProactiveConfig {
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

export interface Config {
  mode: SparkMode
  timezone: string
  triggerTemplate: string
  autoDeleteExecutedAiTriggers: boolean
  scheduled: ScheduledConfig
  festival: FestivalConfig
  proactive: ProactiveConfig
}

export const Config = Schema.intersect([
  Schema.object({
    mode: Schema.union(['tool', 'xml', 'both'])
      .default('tool')
      .description(
        'ChatLuna 任务创建模式。tool：注册 spark_schedule；xml：解析 XML 标签；both：两者都启用。'
      ),
    timezone: Schema.string()
      .default('Asia/Shanghai')
      .description('定时任务、节日问候和主动聊天休息时段使用的 IANA 时区。'),
    triggerTemplate: Schema.string()
      .role('textarea')
      .default('[系统提示：现在是提醒时间，请根据以下内容主动向用户发起对话] {content}')
      .description('Spark 唤醒消息模板。{content} 会被替换为任务内容。'),
    autoDeleteExecutedAiTriggers: Schema.boolean()
      .default(true)
      .description(
        'AI 通过 tool/XML 创建的一次性任务成功执行后自动删除；不影响节日问候和配置定时任务。'
      )
  }).description('基础配置'),

  Schema.object({
    scheduled: Schema.object({
      enabled: Schema.boolean().default(false).description('启用定时任务'),
      tasks: Schema.array(
        Schema.object({
          name: Schema.string().required().description('任务名称'),
          time: Schema.string().required().description('触发时间（格式：HH:mm，例如 08:00）'),
          prompt: Schema.string().role('textarea').required().description('提示词')
        })
      )
        .role('table')
        .default([])
        .description('定时任务列表')
    }).description('定时任务配置')
  }).description('定时任务'),

  Schema.object({
    festival: Schema.object({
      enabled: Schema.boolean().default(true).description('启用节日问候'),
      promptTemplate: Schema.string()
        .role('textarea')
        .default(
          '今天是{festivalName}（{festivalDesc}），请向用户送上节日祝福。要符合你的人设，自然地表达。'
        )
        .description('节日提示词模板。可用变量：{festivalName}、{festivalDesc}'),
      defaultTime: Schema.string().default('09:00').description('默认触发时间（格式：HH:mm）'),
      custom: Schema.array(
        Schema.object({
          name: Schema.string().required().description('节日名称'),
          date: Schema.string().required().description('日期（MM-DD 或 MMDD，例如 03-15）'),
          time: Schema.string().default('09:00').description('触发时间（格式：HH:mm）'),
          description: Schema.string().required().description('节日描述')
        })
      )
        .role('table')
        .default([])
        .description('自定义节日')
    }).description('节日问候配置')
  }).description('节日问候'),

  Schema.object({
    proactive: Schema.object({
      enabled: Schema.boolean().default(false).description('启用主动聊天'),
      checkInterval: Schema.number().default(15).min(5).max(60).description('检查间隔（分钟）'),
      initialDelay: Schema.number().default(2).min(0.5).max(24).description('初始延迟（小时）'),
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
      maxProbability: Schema.number().default(0.8).min(0).max(1).step(0.05).description('最大概率'),
      sleepStart: Schema.string().default('23:00').description('休息开始时间'),
      sleepEnd: Schema.string().default('07:00').description('休息结束时间'),
      prompts: Schema.array(Schema.string())
        .role('table')
        .default(['主动来找用户聊天，可以分享一些有趣的事情或者关心一下用户'])
        .description('主动聊天提示词')
    }).description('主动聊天配置')
  }).description('主动聊天')
]) as Schema<Config>
