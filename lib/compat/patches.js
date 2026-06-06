"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installCompatPatches = installCompatPatches;
function installCompatPatches(ctx, config = {}) {
    const logger = ctx.logger('spark:compat');
    const disposes = [];
    if (config.qqTriggerMessageIdPatch) {
        const dispose = installQqTriggerMessageIdPatch(ctx, logger);
        if (dispose)
            disposes.push(dispose);
    }
    ctx.on('dispose', () => {
        for (const dispose of disposes.reverse()) {
            dispose();
        }
    });
}
function installQqTriggerMessageIdPatch(ctx, logger) {
    const chain = ctx.chatluna?.chatChain;
    if (!chain?.middleware) {
        logger.debug('chatChain middleware API unavailable; skip QQ trigger message id patch');
        return;
    }
    chain.middleware('spark-compat-qq-trigger-message-id', async (session, context) => {
        const wakeup = context?.options?.triggerWakeup;
        if (wakeup &&
            session?.platform === 'qq' &&
            session?.messageId &&
            session.__sparkOriginalMessageId == null) {
            session.__sparkOriginalMessageId = session.messageId;
            session.messageId = undefined;
        }
        return 2;
    }, ctx).after('chatluna_agent_trigger_capture').before('render_message');
    logger.debug('installed QQ trigger message id patch');
    return () => { };
}
