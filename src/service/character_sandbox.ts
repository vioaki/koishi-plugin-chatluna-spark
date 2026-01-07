import { Context, Session, h } from 'koishi'
import { Config } from '../index'
import { buildTriggerMessage } from '../utils/shared'

/**
 * chatluna-character 专用 Sandbox
 *
 * 通过向消息历史注入系统消息并触发 collect 来执行影子会话
 */
export class CharacterSandbox {
  constructor(
    private ctx: Context,
    private config: Config
  ) {}

  /**
   * 执行影子会话
   */
  async execute(
    userId: string,
    channelId: string,
    guildId: string,
    prompt: string
  ): Promise<boolean> {
    const logger = this.ctx.logger('spark:character-sandbox')

    try {
      const characterService = this.ctx.chatluna_character as any
      if (!characterService) {
        logger.warn('chatluna_character not available')
        return false
      }

      logger.debug(`Shadow session for guild [${guildId}]`)

      // 构建触发消息
      const triggerMessage = buildTriggerMessage(this.config.triggerTemplate, prompt)

      // 遍历所有 bot，找到能用的
      let session: Session | null = null
      let selectedBot = null

      for (const bot of this.ctx.bots) {
        try {
          session = bot.session({
            type: 'message',
            timestamp: Date.now(),
            selfId: bot.selfId,
            user: { id: 'system', name: '[系统提醒]' },
            channel: { id: channelId, type: 0 },
            guild: { id: guildId },
            content: triggerMessage,
            elements: [h.text(triggerMessage)]
          } as any)

          // 确保 session 有必要的属性
          if (session) {
            session.content = triggerMessage
            session.elements = [h.text(triggerMessage)]
          }

          selectedBot = bot
          logger.debug(`Using bot: ${bot.platform}`)
          break
        } catch (err) {
          logger.debug(`Bot ${bot.platform} failed to create session`)
          continue
        }
      }

      if (!session || !selectedBot) {
        logger.error('No valid bot/session available')
        return false
      }

      // 构造系统消息
      const systemMessage = {
        content: triggerMessage,
        name: '[系统提醒]',
        id: 'system',
        messageId: `spark-${Date.now()}`,
        timestamp: Date.now()
      }

      // 获取当前群组的消息历史
      const messages = characterService.getMessages(guildId) || []

      // 添加系统消息到历史
      messages.push(systemMessage)

      // 触发消息收集事件，让 chatluna-character 处理
      await this.ctx.parallel(
        'chatluna_character/message_collect',
        session,
        messages
      )

      logger.debug(`Triggered response for guild [${guildId}]`)
      return true

    } catch (err) {
      logger.error('Character shadow session failed:', err)
      return false
    }
  }
}
