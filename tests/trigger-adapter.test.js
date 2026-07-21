const test = require('node:test')
const assert = require('node:assert/strict')

const { SparkTriggerAdapter } = require('../lib/service/trigger_adapter')
const { getSparkMetadata } = require('../lib/service/task_metadata')
const {
  mockLogger,
  createSession,
  createTask,
  createTaskMetadata,
  createLegacyProviderConfig
} = require('./helpers')

function metadataRecord(taskId, metadata = createTaskMetadata()) {
  return {
    taskId,
    ...metadata,
    targetKey: metadata.targetKey ?? '',
    configKey: metadata.configKey ?? '',
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

function createContext(triggerOverrides = {}, listenerStore = {}, initialMetadata = []) {
  const metadataRows = initialMetadata.map((row) => ({ ...row }))
  listenerStore.metadataRows = metadataRows
  const trigger = {
    async create(actor, input) {
      return createTask({ ownerKey: actor.key, attachMetadata: false, ...input })
    },
    async list() {
      return []
    },
    async get(_actor, id) {
      return createTask({ id, attachMetadata: false })
    },
    async remove() {},
    async update(_actor, id, input) {
      return createTask({ id, attachMetadata: false, ...input })
    },
    async setEnabled(_actor, id, enabled) {
      return createTask({ id, enabled, attachMetadata: false })
    },
    async fire(_actor, id) {
      return { id: 'run-1', taskId: id, origin: 'manual', status: 'completed' }
    },
    async wakeup() {
      return { ok: true, requestId: 'request-1' }
    },
    ...triggerOverrides
  }
  return {
    logger: () => mockLogger(listenerStore.records ?? []),
    database: {
      async get(table, query) {
        if (table !== 'chatluna_spark_task_meta') return []
        return metadataRows
          .filter((row) => query?.taskId == null || row.taskId === query.taskId)
          .map((row) => ({ ...row }))
      },
      async create(table, row) {
        assert.equal(table, 'chatluna_spark_task_meta')
        metadataRows.push({ ...row })
        return { ...row }
      },
      async set(table, query, update) {
        assert.equal(table, 'chatluna_spark_task_meta')
        const row = metadataRows.find((candidate) => candidate.taskId === query.taskId)
        if (row) Object.assign(row, update)
      },
      async remove(table, query) {
        assert.equal(table, 'chatluna_spark_task_meta')
        for (let index = metadataRows.length - 1; index >= 0; index--) {
          if (metadataRows[index].taskId === query.taskId) metadataRows.splice(index, 1)
        }
      }
    },
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

test('adapter creates a one-shot reminder with built-in Trigger V2 condition and metadata', async () => {
  const created = []
  const store = {}
  const fireAt = new Date(Date.now() + 60_000)
  const session = createSession({ authority: 2 })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async create(actor, input) {
          created.push({ actor, input })
          return createTask({ ownerKey: actor.key, attachMetadata: false, ...input })
        }
      },
      store
    ),
    config
  )

  const task = await adapter.createOnce({
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
  assert.deepEqual(created[0].input.condition, {
    type: 'once',
    at: fireAt.toISOString()
  })
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
  assert.equal(store.metadataRows.length, 1)
  assert.equal(store.metadataRows[0].taskId, task.id)
  assert.equal(store.metadataRows[0].content, '喝水')
  assert.equal('at' in store.metadataRows[0], false)
  assert.equal('timezone' in store.metadataRows[0], false)
})

test('adapter maps group sessions and stores follow-up cancellation metadata', async () => {
  const created = []
  const store = {}
  const session = createSession({
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async create(actor, input) {
          created.push({ actor, input })
          return createTask({ ownerKey: actor.key, attachMetadata: false, ...input })
        }
      },
      store
    ),
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
  assert.equal(store.metadataRows[0].autoCancelOnUserMessage, true)
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

test('adapter finds disabled config tasks through Spark metadata', async () => {
  const metadata = createTaskMetadata({
    sparkType: 'scheduled',
    origin: 'scheduled',
    autoDeleteAfterFire: false,
    configKey: 'scheduled:daily'
  })
  const existing = createTask({
    id: 99,
    enabled: false,
    condition: {
      type: 'cron',
      expression: '15 8 * * *',
      timezone: 'Asia/Shanghai',
      misfire: 'skip'
    },
    metadata,
    attachMetadata: false
  })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list() {
          return [existing]
        }
      },
      {},
      [metadataRecord(existing.id, metadata)]
    ),
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

test('adapter never treats unrelated built-in Agent tasks as Spark tasks', async () => {
  const sparkTask = createTask({ id: 10, attachMetadata: false })
  const agentTask = createTask({ id: 11, name: 'Agent task', attachMetadata: false })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list() {
          return [sparkTask, agentTask]
        }
      },
      {},
      [metadataRecord(sparkTask.id)]
    ),
    config
  )

  assert.deepEqual(
    (await adapter.listSparkTasks()).map((task) => task.id),
    [sparkTask.id]
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
  const metadata = [
    createTaskMetadata(),
    createTaskMetadata(),
    createTaskMetadata({ origin: 'festival', sparkType: 'festival', autoDeleteAfterFire: false })
  ]
  const tasks = [
    createTask({ id: 1, state: completed, attachMetadata: false }),
    createTask({ id: 2, state: { ...completed, lastError: 'send failed' }, attachMetadata: false }),
    createTask({ id: 3, state: completed, attachMetadata: false })
  ]
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list() {
          return tasks
        },
        async remove(actor, id) {
          removed.push({ actor, id })
        }
      },
      {},
      tasks.map((task, index) => metadataRecord(task.id, metadata[index]))
    ),
    config
  )

  assert.equal(await adapter.cleanupExecutedAiTriggers(), 1)
  assert.equal(removed[0].id, 1)
  assert.equal(removed[0].actor.key, 'plugin:chatluna-spark')
})

test('manual fire removes both a successful auto-delete task and its metadata', async () => {
  const removed = []
  const store = {}
  const task = createTask({ attachMetadata: false })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async get() {
          return task
        },
        async remove(_actor, id) {
          removed.push(id)
        }
      },
      store,
      [metadataRecord(task.id)]
    ),
    config
  )

  const run = await adapter.fireSparkTask(task.id, createSession())
  assert.equal(run.status, 'completed')
  assert.deepEqual(removed, [task.id])
  assert.equal(store.metadataRows.length, 0)
})

test('follow-up tasks are cancelled only by their original creator', async () => {
  const listeners = {}
  const removed = []
  const metadata = createTaskMetadata({
    autoCancelOnUserMessage: true,
    createdBy: 'user-a',
    targetKey: 'shared:sandbox:koishi:guild-a'
  })
  const task = createTask({ id: 7, metadata, attachMetadata: false })
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list(_actor, filter) {
          return filter?.conditionType ? [] : [task]
        },
        async remove(actor, id) {
          removed.push({ actor, id })
        }
      },
      listeners,
      [metadataRecord(task.id, metadata)]
    ),
    config
  )
  adapter.start()

  await listeners.message(
    createSession({
      isDirect: false,
      userId: 'user-b',
      guildId: 'guild-a',
      channelId: 'channel-a',
      authority: 4
    })
  )
  assert.equal(removed.length, 0)

  await listeners.message(
    createSession({
      isDirect: false,
      userId: 'user-a',
      guildId: 'guild-a',
      channelId: 'channel-a'
    })
  )
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
      database: {},
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

test('adapter never registers a custom Trigger provider', async () => {
  let registrations = 0
  const adapter = new SparkTriggerAdapter(
    createContext({
      registerProvider() {
        registrations++
        throw new Error('must not register a provider')
      }
    }),
    config
  )

  adapter.start()
  await adapter.listSparkTasks()
  assert.equal(registrations, 0)
  adapter.stop()
})

test('adapter migrates legacy once and cron tasks in place without duplicating schedules', async () => {
  const updates = []
  const onceConfig = createLegacyProviderConfig({ at: '2026-08-01T01:00:00.000Z' })
  const cronConfig = createLegacyProviderConfig({
    mode: 'cron',
    expression: '15 8 * * *',
    origin: 'scheduled',
    sparkType: 'scheduled',
    autoDeleteAfterFire: false
  })
  let active = [
    createTask({
      id: 31,
      attachMetadata: false,
      condition: { type: 'extension', provider: 'chatluna-spark', config: onceConfig }
    }),
    createTask({
      id: 32,
      attachMetadata: false,
      condition: { type: 'extension', provider: 'chatluna-spark', config: cronConfig }
    })
  ]
  const store = {}
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list(_actor, filter) {
          return filter?.conditionType === 'chatluna-spark'
            ? active.filter((task) => task.condition.type === 'extension')
            : active
        },
        async update(_actor, id, input) {
          updates.push({ id, input })
          const updated = createTask({ id, attachMetadata: false, ...input })
          active = active.map((task) => (task.id === id ? updated : task))
          return updated
        }
      },
      store
    ),
    config
  )

  adapter.start()
  const tasks = await adapter.listSparkTasks()

  assert.deepEqual(
    updates.map(({ id, input }) => [id, input.condition]),
    [
      [31, { type: 'once', at: onceConfig.at }],
      [
        32,
        {
          type: 'cron',
          expression: '15 8 * * *',
          timezone: 'Asia/Shanghai',
          misfire: 'skip'
        }
      ]
    ]
  )
  assert.deepEqual(
    tasks.map((task) => task.id),
    [31, 32]
  )
  assert.equal(store.metadataRows.length, 2)
  assert.equal('at' in store.metadataRows[0], false)
  assert.equal('expression' in store.metadataRows[1], false)
  assert.equal(getSparkMetadata(tasks[1]).origin, 'scheduled')
})

test('adapter rebuilds only legacy tasks already damaged by provider removal', async () => {
  const calls = []
  const legacyConfig = createLegacyProviderConfig({ at: '2026-08-01T01:00:00.000Z' })
  const stale = createTask({
    id: 41,
    ownerKey: 'sandbox:koishi:user-a',
    attachMetadata: false,
    condition: { type: 'extension', provider: 'chatluna-spark', config: legacyConfig },
    state: {
      status: 'waiting',
      nextRunAt: legacyConfig.at,
      runCount: 0,
      lastError: 'Unknown trigger provider: chatluna-spark'
    }
  })
  let active = [stale]
  const store = {}
  const adapter = new SparkTriggerAdapter(
    createContext(
      {
        async list(_actor, filter) {
          return filter?.conditionType === 'chatluna-spark'
            ? active.filter((task) => task.condition.type === 'extension')
            : active
        },
        async setEnabled(actor, id, enabled) {
          calls.push(['setEnabled', actor, id, enabled])
          return createTask({ id, enabled, attachMetadata: false })
        },
        async create(actor, input) {
          calls.push(['create', actor, input])
          const replacement = createTask({
            id: 42,
            ownerKey: actor.key,
            attachMetadata: false,
            ...input
          })
          active.push(replacement)
          return replacement
        },
        async remove(actor, id) {
          calls.push(['remove', actor, id])
          active = active.filter((task) => task.id !== id)
        },
        async update() {
          throw new Error('damaged legacy tasks must be rebuilt')
        }
      },
      store
    ),
    config
  )

  adapter.start()
  const tasks = await adapter.listSparkTasks()

  assert.deepEqual(
    calls.map((call) => call[0]),
    ['setEnabled', 'create', 'remove']
  )
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, 42)
  assert.deepEqual(tasks[0].condition, { type: 'once', at: legacyConfig.at })
  assert.equal(store.metadataRows[0].taskId, 42)
  assert.equal(calls[1][1].key, stale.ownerKey)
  assert.equal(calls[2][1].authority, 4)
})
