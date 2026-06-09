import { Context } from 'koishi'
import { Config } from './config'
import { registerTargetCommands, registerTaskCommands } from './commands'
import { extendDatabase } from './database'
import { setupChatlunaInterceptor } from './middleware/chatluna_interceptor'
import { SparkService } from './service'
import { registerSparkScheduleTool } from './tool/spark_schedule'
import { FestivalTrigger } from './triggers/festival'
import { ProactiveTrigger } from './triggers/proactive'
import { ScheduledTrigger } from './triggers/scheduled'
import 'koishi-plugin-chatluna-agent'

export { Config }
export type { Config as SparkConfig } from './config'
export { registerTaskCommands, registerTargetCommands } from './commands'

export const name = 'chatluna-spark'
export const inject = {
  required: ['database', 'chatluna', 'chatluna_agent']
}

export const usage = `
## chatluna-spark

文档：https://github.com/vioaki/koishi-plugin-chatluna-spark#readme

为 ChatLuna 添加提醒、跟进、定时任务、节日问候、主动聊天等能力。
底层基于 ChatLuna Agent Trigger 创建和唤醒任务。

### 当前会话加入 target

节日问候、配置定时任务、主动聊天只对已加入 target 的会话生效。

\`\`\`
spark.target.add [名称]
\`\`\`

群聊默认加入整个群；只想绑定当前群内个人：

\`\`\`
spark.target.add --personal [名称]
\`\`\`

### 管理 target

\`\`\`
spark.target.list
spark.target.features <id> [festival scheduled proactive|all|none]
\`\`\`
`

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('spark')

  extendDatabase(ctx)
  const sparkService = new SparkService(ctx, config)
  ctx.on('dispose', () => sparkService.trigger.stop())

  if (config.mode === 'tool' || config.mode === 'both') {
    registerSparkScheduleTool(ctx, sparkService.trigger)
  }

  if (config.mode === 'xml' || config.mode === 'both') {
    setupChatlunaInterceptor(ctx, sparkService.trigger)
  }

  const scheduledTrigger = new ScheduledTrigger(ctx, config.scheduled, sparkService, config)
  scheduledTrigger.start()
  ctx.on('dispose', () => scheduledTrigger.stop())

  const festivalTrigger = new FestivalTrigger(ctx, config.festival, sparkService, config)
  festivalTrigger.start()
  ctx.on('dispose', () => festivalTrigger.stop())

  if (config.proactive.enabled) {
    const proactiveTrigger = new ProactiveTrigger(ctx, config.proactive, sparkService, config)
    proactiveTrigger.start()
    ctx.on('dispose', () => proactiveTrigger.stop())
  }

  registerTaskCommands(ctx, sparkService)
  registerTargetCommands(ctx, sparkService)
  logger.info(`Spark plugin loaded in ${config.mode} mode`)
}
