const test = require('node:test')
const assert = require('node:assert/strict')

const { SparkTriggerAdapter } = require('../lib/service/trigger_adapter')
const { mockLogger, createSession, createTask, createProviderConfig } = require('./helpers')

function createContext(triggerOverrides = {}, listenerStore = {}) {
  const trigger = {
    async create(actor, input) {
      return createTask({ ownerKey: actor.key, ...input })
    },
    async list() {
      return []
    },
    async get(_actor, id) {
      return createTask({ id })
    },
    async remove() {},
    async update(_actor, id, input) {
      return createTask({ id, ...input })
    },
    async setEnabled(_actor, id, enabled) {
      return createTask({ id, enabled })
    },
    async fire(_actor, id) {
      return { id: 'run-1', taskId: id, origin: 'manual', status: 'completed' }
    },
    async wakeup() {
      return { ok: true, requestId: 'request-1' }
    },
    registerProvider(provider) {
      listenerStore.provider = provider
      return () => {}
    },
    listProviders() {
      return listenerStore.provider ? [{ id: listenerStore.provider.id }] : []
    },
    ...triggerOverrides
  }
  return {
    logger: () => mockLogger(),
    chatluna_agent: { trigger },
    chatluna: {
      conversation: {
        async resolveConstraint(session) {
          return {
            bindingKey: session.isDirect
              ? `personal:${session.platform}:${session.selfId}:direct:${session.userId}`
              : `shared:${session.platform}:${session.selfId}:${session.guildId}`
          }
        }
      }
    },
    on(event, listener) {
      listenerStore[event] = listener
      return () => {}
    },
    setInterval() {
      return () => {}
    }
  }
}

const config = {
  triggerTemplate: '[系统提示] {content}',
  timezone: 'Asia/Shanghai',
  autoDeleteExecutedAiTriggers: true
}

test('adapter creates a one-shot reminder with Trigger V2 actor and direct target', async () => {
  const created = []
  const fireAt = new Date(Date.now() + 60_000)
  const session = createSession({ authority: 2 })
  const adapter = new SparkTriggerAdapter(
    createContext({
      async create(actor, input) {
        created.push({ actor, input })
        return createTask({ ownerKey: actor.key, ...input })
      }
    }),
    config
  )

  await adapter.createOnce({
    type: 'reminder',
    content: '喝水',
    fireAt,
    session,
    metadata: { sparkOrigin: 'tool' }
  })

  assert.equal(created.length, 1)
  assert.deepEqual(created[0].actor, {
    key: 'sandbox:koishi:user-a',
    userId: 'user-a',
    authority: 2,
    session
  })
  assert.equal(created[0].input.condition.type, 'extension')
  assert.equal(created[0].input.condition.provider, 'chatluna-spark')
  assert.deepEqual(created[0].input.execution, {
    model: { type: 'default' },
    conversation: { type: 'route' },
    prompt: '[系统提示] 喝水',
    timeoutSeconds: 120,
    tools: { type: 'none' }
  })
  assert.deepEqual(created[0].input.target, {
    bot: { platform: 'sandbox', selfId: 'koishi' },
    destination: { type: 'direct', userId: 'user-a' },
    principalId: 'user-a',
    delivery: 'channel'
  })
})

test('adapter maps group sessions to channel destinations', async () => {
  const created = []
  const session = createSession({
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  const adapter = new SparkTriggerAdapter(
    createContext({
      async create(actor, input) {
        created.push({ actor, input })
        return createTask({ ownerKey: actor.key, ...input })
      }
    }),
    config
  )

  await adapter.createOnce({
    type: 'follow_up',
    content: '继续聊',
    fireAt: new Date(Date.now() + 60_000),
    session,
    autoCancelOnUserMessage: true
  })

  assert.deepEqual(created[0].input.target.destination, {
    type: 'channel',
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  assert.equal(created[0].input.condition.config.autoCancelOnUserMessage, true)
})

test('adapter rejects past one-shot times before creating tasks', async () => {
  let created = false
  const adapter = new SparkTriggerAdapter(
    createContext({
      async create() {
        created = true
      }
    }),
    config
  )

  await assert.rejects(
    adapter.createOnce({
      type: 'reminder',
      content: '过期任务',
      fireAt: new Date(Date.now() - 1000),
      session: createSession()
    }),
    /fireAt must be in the future/
  )
  assert.equal(created, false)
})

test('adapter finds disabled config tasks through provider config', async () => {
  const existing = createTask({
    id: 99,
    enabled: false,
    config: createProviderConfig({
      mode: 'cron',
      expression: '15 8 * * *',
      sparkType: 'scheduled',
      origin: 'scheduled',
      autoDeleteAfterFire: false,
      configKey: 'scheduled:daily'
    })
  })
  const adapter = new SparkTriggerAdapter(
    createContext({
      async list() {
        return [existing]
      }
    }),
    config
  )

  assert.equal(
    await adapter.findSparkTaskByConfigKey(
      'personal:sandbox:koishi:direct:user-a',
      'scheduled:daily'
    ),
    existing
  )
})

test('adapter auto-deletes only successful completed AI one-shot tasks', async () => {
  const removed = []
  const completed = {
    status: 'completed',
    runCount: 1,
    lastRunAt: new Date().toISOString(),
    lastError: null
  }
  const tasks = [
    createTask({ id: 1, state: completed }),
    createTask({
      id: 2,
      state: { ...completed, lastError: 'send failed' }
    }),
    createTask({
      id: 3,
      state: completed,
      config: createProviderConfig({ origin: 'festival', autoDeleteAfterFire: false })
    })
  ]
  const adapter = new SparkTriggerAdapter(
    createContext({
      async list() {
        return tasks
      },
      async remove(actor, id) {
        removed.push({ actor, id })
      }
    }),
    config
  )

  assert.equal(await adapter.cleanupExecutedAiTriggers(), 1)
  assert.equal(removed[0].id, 1)
  assert.equal(removed[0].actor.key, 'plugin:chatluna-spark')
})

test('manual fire removes successful auto-delete tasks', async () => {
  const removed = []
  const task = createTask()
  const adapter = new SparkTriggerAdapter(
    createContext({
      async get() {
        return task
      },
      async remove(_actor, id) {
        removed.push(id)
      }
    }),
    config
  )

  const run = await adapter.fireSparkTask(task.id, createSession())
  assert.equal(run.status, 'completed')
  assert.deepEqual(removed, [task.id])
})

test('follow-up tasks are cancelled when the same user sends a message', async () => {
  const listeners = {}
  const removed = []
  const task = createTask({
    config: createProviderConfig({ autoCancelOnUserMessage: true })
  })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list() {
          return [task]
        },
        async remove(actor, id) {
          removed.push({ actor, id })
        }
      },
      listeners
    ),
    config
  )
  adapter.start()

  await listeners.message(createSession())
  assert.equal(removed.length, 1)
  assert.equal(removed[0].actor.key, 'sandbox:koishi:user-a')
  adapter.stop()
})

test('adapter reports an explicit error for pre-V2 Agent services', () => {
  const adapter = new SparkTriggerAdapter(
    {
      logger: () => mockLogger(),
      chatluna_agent: { trigger: { createTask() {} } },
      chatluna: {},
      on() {}
    },
    config
  )

  assert.throws(() => adapter.start(), /Trigger V2.*1\.0\.41.*missing methods/)
})

test('adapter rejects invalid configured timezones during startup', () => {
  const adapter = new SparkTriggerAdapter(createContext(), {
    ...config,
    timezone: 'Invalid/Timezone'
  })

  assert.throws(() => adapter.start(), /Invalid Spark timezone/)
})
