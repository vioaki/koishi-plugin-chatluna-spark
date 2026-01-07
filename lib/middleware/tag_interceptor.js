"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_PATTERN = exports.lastUserMap = void 0;
exports.setupTagInterceptor = setupTagInterceptor;
const tag_parser_1 = require("../parser/tag_parser");
const scope_1 = require("../utils/scope");
// XML 标签正则
const TAG_PATTERN = /<(reminder|follow-up|memo)\s+time="[^"]+">[\s\S]*?<\/\1>/g;
exports.TAG_PATTERN = TAG_PATTERN;
// 存储每个频道最后发消息的用户 ID（带过期时间）
const lastUserMap = new Map();
exports.lastUserMap = lastUserMap;
const USER_MAP_EXPIRE_MS = 30 * 60 * 1000; // 30 分钟过期
function setupTagInterceptor(ctx, scope) {
    const tagParser = new tag_parser_1.TagParser(ctx);
    const logger = ctx.logger('spark:interceptor');
    // 当前正在处理的会话信息
    let currentSession = null;
    // 定期清理过期记录
    ctx.setInterval(() => {
        const now = Date.now();
        for (const [key, value] of lastUserMap) {
            if (now - value.timestamp > USER_MAP_EXPIRE_MS) {
                lastUserMap.delete(key);
            }
        }
    }, 10 * 60 * 1000);
    ctx.on('dispose', () => {
        lastUserMap.clear();
    });
    // 监听用户消息，记录真实的 userId
    ctx.on('message', (session) => {
        if (session.userId && session.channelId) {
            lastUserMap.set(session.channelId, {
                userId: session.userId,
                timestamp: Date.now()
            });
        }
    });
    // ========== 方案1: 拦截 chatluna-character 的 logger.debug ==========
    // chatluna-character 在 getModelResponse 中会打印 "model response: ..."
    ctx.on('ready', () => {
        const characterService = ctx.chatluna_character;
        if (!characterService?.logger) {
            logger.debug('chatluna_character logger not available');
            return;
        }
        // 使用 collect 追踪当前处理的会话
        characterService.collect(async (session) => {
            currentSession = session;
        });
        const characterLogger = characterService.logger;
        if (typeof characterLogger.debug !== 'function') {
            logger.warn('chatluna_character logger.debug not available');
            return;
        }
        const originalDebug = characterLogger.debug.bind(characterLogger);
        characterLogger.debug = (...args) => {
            // 调用原始的 debug 方法
            originalDebug(...args);
            // 检查是否是模型响应日志
            const message = args[0];
            if (typeof message === 'string' && message.startsWith('model response: ')) {
                const response = message.substring('model response: '.length);
                if (currentSession) {
                    processModelResponse(response, currentSession);
                }
            }
        };
        // 清理函数
        ctx.on('dispose', () => {
            characterLogger.debug = originalDebug;
        });
        logger.info('✅ [Character] Logger interceptor registered');
    });
    // ========== 方案2: ChatLuna chatChain 中间件 ==========
    ctx.on('ready', () => {
        if (!ctx.chatluna?.chatChain) {
            logger.debug('ChatLuna chatChain not available');
            return;
        }
        ctx.chatluna.chatChain.middleware('spark-tag-processor', async (session, context) => {
            try {
                const responseMessage = context.options?.responseMessage;
                if (!responseMessage?.content) {
                    return 2; // CONTINUE
                }
                // 获取消息内容
                let content = '';
                if (typeof responseMessage.content === 'string') {
                    content = responseMessage.content;
                }
                else if (Array.isArray(responseMessage.content)) {
                    content = responseMessage.content
                        .filter((item) => item.type === 'text')
                        .map((item) => item.text || '')
                        .join('');
                }
                if (content) {
                    processModelResponse(content, session);
                }
                return 2; // CONTINUE
            }
            catch (err) {
                logger.error('[ChatLuna] Tag processing failed:', err);
                return 2; // CONTINUE
            }
        }).after('censor').before('render_message');
        logger.info('✅ [ChatLuna] chatChain middleware registered');
    });
    // ========== 方案3: chatluna/after-chat 事件 ==========
    ctx.on('chatluna/after-chat', async (conversationId, sourceMessage, responseMessage, promptVariables, chatInterface, session) => {
        try {
            const content = typeof responseMessage?.content === 'string'
                ? responseMessage.content
                : String(responseMessage?.content || '');
            if (content) {
                processModelResponse(content, session);
            }
        }
        catch (err) {
            logger.error('[after-chat] Tag processing failed:', err);
        }
    });
    /**
     * 处理模型响应，提取标签并创建任务
     */
    async function processModelResponse(response, session) {
        // 检查作用域
        if (scope && session?.channelId && !(0, scope_1.isInScope)(session.channelId, scope)) {
            return;
        }
        // 检测标签
        TAG_PATTERN.lastIndex = 0;
        if (!TAG_PATTERN.test(response)) {
            return;
        }
        TAG_PATTERN.lastIndex = 0;
        logger.info('🏷️ Detected XML tags in model response');
        // 获取真实的 userId
        const channelId = session?.channelId;
        const userRecord = channelId ? lastUserMap.get(channelId) : null;
        const realUserId = userRecord?.userId || session?.userId;
        const enhancedSession = {
            userId: realUserId,
            channelId: session?.channelId,
            guildId: session?.guildId
        };
        try {
            // 解析标签并创建任务（不需要返回 cleanText，因为我们不修改消息）
            const { results } = await tagParser.parseAndExecute(response, enhancedSession);
            if (results.length > 0) {
                logger.success(`✅ Parsed ${results.length} tags, tasks created`);
            }
        }
        catch (err) {
            logger.error('Tag processing failed:', err);
        }
    }
    logger.info('✅ Tag interceptor setup complete');
}
