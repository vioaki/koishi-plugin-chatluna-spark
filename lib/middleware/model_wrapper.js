"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAG_PATTERN = exports.lastUserMap = void 0;
exports.setupEarlyModelWrapper = setupEarlyModelWrapper;
const tag_parser_1 = require("../parser/tag_parser");
const scope_1 = require("../utils/scope");
// XML 标签正则
const TAG_PATTERN = /<(reminder|follow-up|memo)\s+time="[^"]+">[\s\S]*?<\/\1>/g;
exports.TAG_PATTERN = TAG_PATTERN;
// 存储每个频道最后发消息的用户 ID（带过期时间）
const lastUserMap = new Map();
exports.lastUserMap = lastUserMap;
const USER_MAP_EXPIRE_MS = 30 * 60 * 1000; // 30 分钟过期
/**
 * 尽早包装 createChatModel 方法
 * 必须在 chatluna_character 加载之前调用
 */
function setupEarlyModelWrapper(ctx, scope) {
    const logger = ctx.logger('spark:model-wrapper');
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
    // 立即包装 createChatModel（如果 chatluna 已经可用）
    if (ctx.chatluna?.createChatModel) {
        wrapCreateChatModel(ctx, logger, scope);
    }
    else {
        // 监听 chatluna 服务可用
        // @ts-ignore - Koishi 内部事件
        ctx.on('internal/service', (name) => {
            if (name === 'chatluna' && ctx.chatluna?.createChatModel) {
                wrapCreateChatModel(ctx, logger, scope);
            }
        });
    }
}
function wrapCreateChatModel(ctx, logger, scope) {
    // 检查是否已经包装过
    if (ctx.chatluna.createChatModel._sparkWrapped) {
        logger.debug('createChatModel already wrapped, skipping');
        return;
    }
    const tagParser = new tag_parser_1.TagParser(ctx);
    const originalCreateChatModel = ctx.chatluna.createChatModel.bind(ctx.chatluna);
    ctx.chatluna.createChatModel = async function (platform, model) {
        const modelRef = await originalCreateChatModel(platform, model);
        const originalDescriptor = Object.getOwnPropertyDescriptor(modelRef, 'value');
        if (originalDescriptor && originalDescriptor.get) {
            const originalGetter = originalDescriptor.get.bind(modelRef);
            Object.defineProperty(modelRef, 'value', {
                get() {
                    const modelInstance = originalGetter();
                    if (!modelInstance || modelInstance._sparkWrapped)
                        return modelInstance;
                    // 包装 invoke 方法
                    const originalInvoke = modelInstance.invoke.bind(modelInstance);
                    modelInstance.invoke = async function (input, options) {
                        const result = await originalInvoke(input, options);
                        // 检查结果中是否有标签
                        if (result?.content) {
                            const content = typeof result.content === 'string'
                                ? result.content
                                : String(result.content);
                            TAG_PATTERN.lastIndex = 0;
                            if (TAG_PATTERN.test(content)) {
                                TAG_PATTERN.lastIndex = 0;
                                logger.info('🏷️ [Model Invoke] Detected XML tags in model response');
                                // 获取 session 信息
                                const session = options?.configurable?.session;
                                const channelId = session?.channelId || session?.guildId;
                                const userRecord = channelId ? lastUserMap.get(channelId) : null;
                                const realUserId = userRecord?.userId || session?.userId;
                                // 检查作用域
                                if (scope && channelId && !(0, scope_1.isInScope)(channelId, scope)) {
                                    return result;
                                }
                                const enhancedSession = {
                                    userId: realUserId,
                                    channelId: channelId,
                                    guildId: session?.guildId
                                };
                                // 解析标签并创建任务
                                try {
                                    const { cleanText, results } = await tagParser.parseAndExecute(content, enhancedSession);
                                    if (results.length > 0) {
                                        logger.success(`✅ [Model Invoke] Parsed ${results.length} tags`);
                                        // 修改返回内容
                                        if (typeof result.content === 'string') {
                                            result.content = cleanText;
                                        }
                                    }
                                }
                                catch (err) {
                                    logger.error('[Model Invoke] Tag processing failed:', err);
                                }
                            }
                        }
                        return result;
                    };
                    modelInstance._sparkWrapped = true;
                    return modelInstance;
                },
                configurable: true,
                enumerable: true
            });
        }
        return modelRef;
    };
    ctx.chatluna.createChatModel._sparkWrapped = true;
    logger.info('✅ [Model Wrapper] createChatModel wrapped successfully (early)');
}
