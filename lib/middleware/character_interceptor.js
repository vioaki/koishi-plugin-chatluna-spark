"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupCharacterInterceptor = setupCharacterInterceptor;
const tag_parser_1 = require("../parser/tag_parser");
const scope_1 = require("../utils/scope");
const shared_1 = require("../utils/shared");
/**
 * chatluna-character 专用检测器
 * 通过拦截 logger.debug 获取 AI 原始响应，只检测标签并创建任务
 */
function setupCharacterInterceptor(ctx, scope) {
    const tagParser = new tag_parser_1.TagParser(ctx);
    // 初始化拦截器
    function initInterceptor() {
        if (!ctx.chatluna_character) {
            return false;
        }
        let currentSession = null;
        ctx.chatluna_character.collect(async (session) => {
            currentSession = session;
        });
        const characterService = ctx.chatluna_character;
        const characterLogger = characterService.logger;
        if (characterLogger && typeof characterLogger.debug === 'function') {
            const originalDebug = characterLogger.debug.bind(characterLogger);
            characterLogger.debug = (...args) => {
                originalDebug(...args);
                const message = args[0];
                if (typeof message === 'string' && message.startsWith('model response: ')) {
                    const response = message.substring('model response: '.length);
                    if (currentSession) {
                        processModelResponse(response, currentSession);
                    }
                }
            };
            ctx.on('dispose', () => {
                characterLogger.debug = originalDebug;
            });
            return true;
        }
        else {
            return false;
        }
    }
    async function processModelResponse(response, session) {
        if (scope && session?.channelId && !(0, scope_1.isInScope)(session.channelId, scope)) {
            return;
        }
        shared_1.TAG_PATTERN.lastIndex = 0;
        if (!shared_1.TAG_PATTERN.test(response)) {
            return;
        }
        shared_1.TAG_PATTERN.lastIndex = 0;
        const channelId = session?.channelId;
        const userRecord = channelId ? shared_1.lastUserMap.get(channelId) : null;
        const realUserId = userRecord?.userId || session?.userId;
        const enhancedSession = {
            userId: realUserId,
            channelId: session?.channelId,
            guildId: session?.guildId
        };
        try {
            await tagParser.parseAndExecute(response, enhancedSession);
        }
        catch (err) {
            ctx.logger('spark').error('Tag processing failed:', err);
        }
    }
    if (initInterceptor()) {
        return;
    }
    // @ts-ignore
    ctx.on('internal/service', (name) => {
        if (name === 'chatluna_character' && ctx.chatluna_character) {
            initInterceptor();
        }
    });
}
