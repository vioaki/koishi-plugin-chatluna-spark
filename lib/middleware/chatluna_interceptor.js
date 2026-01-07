"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupChatlunaInterceptor = setupChatlunaInterceptor;
const tag_parser_1 = require("../parser/tag_parser");
const scope_1 = require("../utils/scope");
const shared_1 = require("../utils/shared");
/**
 * ChatLuna 主插件专用拦截器
 * 通过 chatChain 中间件获取 AI 响应，检测标签、创建任务、并修改消息移除标签
 */
function setupChatlunaInterceptor(ctx, scope) {
    const tagParser = new tag_parser_1.TagParser(ctx);
    ctx.on('ready', () => {
        if (!ctx.chatluna?.chatChain) {
            return;
        }
        ctx.chatluna.chatChain.middleware('spark-tag-processor', async (session, context) => {
            try {
                const responseMessage = context.options?.responseMessage;
                if (!responseMessage?.content) {
                    return 2;
                }
                if (scope && session?.channelId && !(0, scope_1.isInScope)(session.channelId, scope)) {
                    return 2;
                }
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
                if (!content)
                    return 2;
                shared_1.TAG_PATTERN.lastIndex = 0;
                if (!shared_1.TAG_PATTERN.test(content)) {
                    return 2;
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
                const { cleanText, results } = await tagParser.parseAndExecute(content, enhancedSession);
                if (results.length > 0) {
                    if (typeof responseMessage.content === 'string') {
                        context.options.responseMessage.content = cleanText;
                    }
                    else if (Array.isArray(responseMessage.content)) {
                        for (let i = 0; i < responseMessage.content.length; i++) {
                            if (responseMessage.content[i].type === 'text') {
                                context.options.responseMessage.content[i].text = cleanText;
                                break;
                            }
                        }
                    }
                }
                return 2;
            }
            catch (err) {
                ctx.logger('spark').error('Tag processing failed:', err);
                return 2;
            }
        }).after('censor').before('render_message');
    });
}
