const test = require('node:test')
const assert = require('node:assert/strict')

const { parseTime } = require('../lib/utils/time_parser')
const { isInScope, isSessionInScope } = require('../lib/utils/scope')
const { TagParser } = require('../lib/parser/tag_parser')
const { SparkTriggerAdapter } = require('../lib/service/trigger_adapter')
const { registerSparkScheduleTool } = require('../lib/tool/spark_schedule')
const { installCompatPatches } = require('../lib/compat/patches')

function mockLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  }
}

test('parseTime keeps relative and invalid parsing behavior', () => {
  const before = Date.now()
  const parsed = parseTime('5m')
  const delta = parsed.date.getTime() - before

  assert.equal(parsed.isValid, true)
  assert.ok(delta >= 4.9 * 60 * 1000)
  assert.ok(delta <= 5.1 * 60 * 1000)

  assert.equal(parseTime('not-a-time').isValid, false)
})

test('scope supports direct sessions and group ids', () => {
  const whitelist = {
    mode: '白名单',
    list: [
      { type: '私聊', id: 'user-a' },
      { type: '群聊', id: 'guild-a' }
    ]
  }

  assert.equal(isInScope(undefined, whitelist, true, 'user-a'), true)
  assert.equal(isSessionInScope({ isDirect: false, channelId: 'channel-a', guildId: 'guild-a', userId: 'user-b' }, whitelist), true)
  assert.equal(isSessionInScope({ isDirect: false, channelId: 'channel-b', guildId: 'guild-b', userId: 'user-b' }, whitelist), false)
})

test('XML parser creates trigger tasks and strips supported tags', async () => {
  const created = []
  const adapter = {
    async createOnce(input) {
      created.push(input)
      return { id: created.length }
    }
  }
  const parser = new TagParser({ logger: () => mockLogger() }, adapter)

  const result = await parser.parseAndExecute(
    '好的 <reminder time="5m">喝水</reminder> 稍后见 <follow-up time="10m">继续聊天</follow-up>',
    { bot: {}, userId: 'user-a', channelId: 'private:user-a', isDirect: true }
  )

  assert.equal(result.cleanText, '好的  稍后见')
  assert.equal(created.length, 2)
  assert.equal(created[0].type, 'reminder')
  assert.equal(created[0].content, '喝水')
  assert.equal(created[0].autoCancelOnUserMessage, false)
  assert.equal(created[0].metadata.sparkOrigin, 'xml')
  assert.equal(created[1].type, 'follow_up')
  assert.equal(created[1].autoCancelOnUserMessage, true)
  assert.equal(created[1].metadata.sparkOrigin, 'xml')
})

test('spark_schedule tool creates follow-up trigger with current session', async () => {
  let registered
  const ctx = {
    chatluna: {
      platform: {
        registerTool(name, spec) {
          registered = { name, spec }
          return () => {}
        }
      }
    },
    on() {}
  }
  const created = []
  const adapter = {
    async createOnce(input) {
      created.push(input)
      return { id: 42 }
    }
  }

  registerSparkScheduleTool(ctx, adapter, { mode: '全部启用', list: [] })

  assert.equal(registered.name, 'spark_schedule')

  const tool = registered.spec.createTool()
  assert.equal(tool.returnDirect, false)
  assert.match(tool.description, /Use reminder/)
  assert.match(tool.description, /cancelled if the user replies first/)
  assert.deepEqual(tool.schema.shape.type._def.values, ['reminder', 'follow_up'])

  const output = JSON.parse(await tool.invoke(
    { type: 'follow_up', time: '5m', content: '继续刚才的话题' },
    { configurable: { session: { bot: {}, userId: 'user-a', channelId: 'private:user-a', isDirect: true } } }
  ))

  assert.equal(output.success, true)
  assert.equal(output.taskId, 42)
  assert.equal(output.type, 'follow_up')
  assert.equal(output.autoCancelOnUserMessage, true)
  assert.equal(output.message, 'Spark trigger created.')
  assert.equal(created.length, 1)
  assert.equal(created[0].type, 'follow_up')
  assert.equal(created[0].content, '继续刚才的话题')
  assert.equal(created[0].autoCancelOnUserMessage, true)
  assert.equal(created[0].metadata.sparkOrigin, 'tool')
  assert.equal(created[0].metadata.sparkToolSource, 'chatluna')
  assert.equal(created[0].metadata.character, false)
})

test('spark_schedule tool records ChatLuna character source metadata', async () => {
  let registered
  const ctx = {
    chatluna: {
      platform: {
        registerTool(name, spec) {
          registered = { name, spec }
          return () => {}
        }
      }
    },
    on() {}
  }
  const created = []
  const adapter = {
    async createOnce(input) {
      created.push(input)
      return { id: 43 }
    }
  }

  registerSparkScheduleTool(ctx, adapter, { mode: '全部启用', list: [] })

  const tool = registered.spec.createTool()
  const session = {
    bot: {},
    platform: 'sandbox',
    selfId: 'koishi',
    userId: 'user-a',
    guildId: 'guild-a',
    channelId: 'channel-a',
    isDirect: false
  }
  const output = JSON.parse(await tool.invoke(
    { type: 'reminder', time: '5m', content: '提醒用户喝水' },
    {
      configurable: {
        session,
        source: 'character',
        conversationId: 'sandbox:guild:guild-a',
        preset: 'vanilla',
        agentContext: { requestId: 'request-1' }
      }
    }
  ))

  assert.equal(output.success, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].createdBy, 'user-a')
  assert.deepEqual(created[0].metadata, {
    sparkOrigin: 'tool',
    sparkToolSource: 'character',
    conversationId: 'sandbox:guild:guild-a',
    preset: 'vanilla',
    requestId: 'request-1',
    character: true
  })
})

test('legacy overdue pending tasks migrate to near-future Agent triggers once', async () => {
  const oldTriggerTime = new Date(Date.now() - 60_000)
  const created = []
  const updated = []
  const ctx = {
    bots: {
      'sandbox:koishi': {
        platform: 'sandbox',
        selfId: 'koishi'
      }
    },
    logger: () => mockLogger(),
    database: {
      async get(table, query) {
        assert.equal(table, 'chatluna_spark_tasks')
        assert.deepEqual(query, { status: 'pending' })
        return [{
          id: 7,
          userId: 'user-a',
          channelId: 'private:user-a',
          triggerTime: oldTriggerTime,
          type: 'memo',
          content: '喝水',
          status: 'pending',
          cancelOn: [],
          tags: ['legacy'],
          metadata: {}
        }]
      },
      async set(table, id, patch) {
        updated.push({ table, id, patch })
      }
    },
    chatluna_agent: {
      trigger: {
        async createTask(source, task) {
          created.push({ source, task })
          return { id: 99, ...task }
        },
        async listTasks() {
          return []
        }
      }
    },
    chatluna: {},
    on() {}
  }

  const before = Date.now()
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}'
  })
  await adapter.migrateLegacyPendingTasks()

  assert.equal(created.length, 1)
  assert.equal(created[0].source.isDirect, true)
  assert.equal(created[0].source.userId, 'user-a')
  assert.equal(created[0].task.providerKind, 'once')
  const fireAt = new Date(created[0].task.params.fireAt).getTime()
  assert.ok(fireAt > before)
  assert.ok(fireAt <= Date.now() + 5_000)
  assert.equal(created[0].task.params.sparkOrigin, 'legacy')
  assert.equal(created[0].task.params.sparkType, 'reminder')
  assert.equal(created[0].task.params.legacyTaskId, 7)
  assert.equal(created[0].task.params.legacyMissed, true)
  assert.equal(created[0].task.params.legacyTriggerTime, oldTriggerTime.toISOString())

  assert.equal(updated.length, 1)
  assert.equal(updated[0].table, 'chatluna_spark_tasks')
  assert.equal(updated[0].id, 7)
  assert.equal(updated[0].patch.status, 'cancelled')
  assert.equal(updated[0].patch.metadata.migratedToTriggerTaskId, 99)
})

test('compat patches are disabled by default', async () => {
  let middleware
  const chain = {
    middleware(name, fn) {
      middleware = { name, fn }
      return {
        after() {
          return this
        },
        before() {
          return this
        }
      }
    }
  }
  const ctx = {
    bots: {},
    logger: () => mockLogger(),
    chatluna: { chatChain: chain },
    on() {}
  }

  installCompatPatches(ctx)

  assert.equal(middleware, undefined)
})

test('compat QQ trigger patch clears virtual message id before render when enabled', async () => {
  let middleware
  const chain = {
    middleware(name, fn) {
      middleware = { name, fn }
      return {
        after() {
          return this
        },
        before() {
          return this
        }
      }
    }
  }
  const ctx = {
    bots: {},
    logger: () => mockLogger(),
    chatluna: { chatChain: chain },
    on() {}
  }

  installCompatPatches(ctx, { qqTriggerMessageIdPatch: true })

  const session = { platform: 'qq', messageId: 'virtual-request-id' }
  const result = await middleware.fn(session, { options: { triggerWakeup: { requestId: 'virtual-request-id' } } })

  assert.equal(middleware.name, 'spark-compat-qq-trigger-message-id')
  assert.equal(result, 2)
  assert.equal(session.messageId, undefined)
  assert.equal(session.__sparkOriginalMessageId, 'virtual-request-id')
})
