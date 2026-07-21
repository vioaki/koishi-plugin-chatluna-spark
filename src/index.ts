import { Context } from 'koishi'
import { Config } from './config'
import { registerTargetCommands, registerTaskCommands } from './commands'
import { extendDatabase } from './database'
import { setupChatlunaInterceptor } from './middleware/chatluna_interceptor'
import { SparkService } from './service'
import { CharacterFestivalAdapter } from './service/character_festival'
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
  required: ['database', 'chatluna', 'chatluna_agent'],
  optional: ['chatluna_character_trigger']
}

export const usage = `
## chatluna-spark

文档：https://github.com/vioaki/koishi-plugin-chatluna-spark#readme

为 ChatLuna 添加提醒、跟进、定时任务、节日问候和主动聊天，并为 Character 补充节日问候。

### 当前会话加入 target

ChatLuna 的节日问候、配置定时任务、主动聊天只对已加入 target 的会话生效。

\`\`\`
spark.target.add [名称]
\`\`\`

为当前 Character 会话启用节日问候：

\`\`\`
spark.target.add --character [名称]
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

### Character

Character target 仅启用节日问候。提醒、定时任务和主动聊天请使用 Character 内置的 \`wake_up_reply_*\`、\`next_reply\` 和空闲触发。
`

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('spark')

  extendDatabase(ctx)
  const sparkService = new SparkService(ctx, config)
  ctx.on('dispose', () => sparkService.trigger.stop())

  let disposeBotRefresh: (() => void) | undefined
  ctx.on('bot-status-updated', () => {
    disposeBotRefresh?.()
    disposeBotRefresh = ctx.setTimeout(() => {
      disposeBotRefresh = undefined
      ctx.parallel('spark/targets-updated').catch((err) => {
        logger.warn(`Bot target refresh failed: ${formatError(err)}`)
      })
    }, 1000)
  })
  ctx.on('dispose', () => {
    disposeBotRefresh?.()
    disposeBotRefresh = undefined
  })

  registerTaskCommands(ctx, sparkService)
  registerTargetCommands(ctx, sparkService)

  if (config.mode === 'tool' || config.mode === 'both') {
    try {
      registerSparkScheduleTool(ctx, sparkService.trigger)
    } catch (err) {
      logger.error(`Spark tool registration failed: ${formatError(err)}`)
    }
  }

  if (config.mode === 'xml' || config.mode === 'both') {
    try {
      setupChatlunaInterceptor(ctx, sparkService.trigger)
    } catch (err) {
      logger.error(`Spark XML interceptor registration failed: ${formatError(err)}`)
    }
  }

  try {
    sparkService.trigger.start()
  } catch (err) {
    logger.error(`Spark Trigger V2 startup failed: ${formatError(err)}`)
  }

  ctx.inject(['chatluna_character_trigger'], (characterCtx) => {
    const characterFestival = new CharacterFestivalAdapter(characterCtx)
    try {
      characterFestival.start()
      sparkService.characterFestival = characterFestival
      logger.info('Spark Character festival bridge attached')
      characterCtx.parallel('spark/targets-updated').catch((err) => {
        logger.warn(`Character festival refresh failed: ${formatError(err)}`)
      })
    } catch (err) {
      logger.error(`Spark Character festival bridge startup failed: ${formatError(err)}`)
      return
    }

    characterCtx.on('dispose', () => {
      if (sparkService.characterFestival === characterFestival) {
        sparkService.characterFestival = undefined
      }
    })
  })

  const scheduledTrigger = new ScheduledTrigger(ctx, config.scheduled, sparkService, config)
  startComponent(logger, 'Scheduled', () => scheduledTrigger.start())
  ctx.on('dispose', () => scheduledTrigger.stop())

  const festivalTrigger = new FestivalTrigger(ctx, config.festival, sparkService, config)
  startComponent(logger, 'Festival', () => festivalTrigger.start())
  ctx.on('dispose', () => festivalTrigger.stop())

  if (config.proactive.enabled) {
    const proactiveTrigger = new ProactiveTrigger(ctx, config.proactive, sparkService, config)
    startComponent(logger, 'Proactive', () => proactiveTrigger.start())
    ctx.on('dispose', () => proactiveTrigger.stop())
  }

  logger.info(`Spark plugin loaded in ${config.mode} mode`)
}

function startComponent(logger: ReturnType<Context['logger']>, label: string, start: () => void) {
  try {
    start()
  } catch (err) {
    logger.error(`${label} component startup failed: ${formatError(err)}`)
  }
}

function formatError(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
