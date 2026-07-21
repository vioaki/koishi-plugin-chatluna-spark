const test = require('node:test')
const assert = require('node:assert/strict')

const { ScheduledTrigger } = require('../lib/triggers/scheduled')
const { FestivalTrigger } = require('../lib/triggers/festival')
const { ProactiveTrigger, isTimeInWindow } = require('../lib/triggers/proactive')
const {
  mockLogger,
  createTarget,
  createTask,
  createTaskMetadata,
  createSession
} = require('./helpers')

function createComponentContext() {
  return {
    logger: () => mockLogger(),
    on() {
      return () => {}
    },
    setInterval() {
      return () => {}
    }
  }
}

const mainConfig = {
  timezone: 'Asia/Shanghai',
  triggerTemplate: '[系统提示] {content}'
}

test('proactive sleep window uses the configured timezone instead of server local time', () => {
  const date = new Date('2026-06-08T15:30:00.000Z')

  assert.equal(isTimeInWindow(date, '23:00', '07:00', 'Asia/Shanghai'), true)
  assert.equal(isTimeInWindow(date, '23:00', '07:00', 'UTC'), false)
  assert.equal(isTimeInWindow(date, '00:00', '00:00', 'Asia/Shanghai'), false)
})

test('scheduled component creates cron tasks and disables stale configuration tasks', async () => {
  const target = createTarget({ features: ['scheduled'] })
  const created = []
  const disabled = []
  const stale = createTask({
    id: 9,
    condition: {
      type: 'cron',
      expression: '0 7 * * *',
      timezone: 'Asia/Shanghai',
      misfire: 'skip'
    },
    metadata: createTaskMetadata({
      sparkType: 'scheduled',
      origin: 'scheduled',
      autoDeleteAfterFire: false,
      configKey: 'scheduled:stale'
    })
  })
  const service = {
    targets: {
      async listRuntimeTargets(feature) {
        assert.equal(feature, 'scheduled')
        return [target]
      }
    },
    trigger: {
      async findSparkTaskByConfigKey() {
        return undefined
      },
      async createCron(source, input) {
        created.push({ source, input })
      },
      async listSparkTasks() {
        return [stale]
      },
      async setSparkTaskEnabled(id, enabled) {
        disabled.push([id, enabled])
      }
    }
  }
  const trigger = new ScheduledTrigger(
    createComponentContext(),
    { enabled: true, tasks: [{ name: '早安', time: '08:15', prompt: '说早安' }] },
    service,
    mainConfig
  )

  await trigger.syncTargets()

  assert.equal(created.length, 1)
  assert.equal(created[0].input.expression, '15 8 * * *')
  assert.equal(created[0].input.bindingKey, target.key)
  assert.equal(created[0].input.metadata.sparkOrigin, 'scheduled')
  assert.deepEqual(created[0].source, target.routing)
  assert.deepEqual(disabled, [[9, false]])
})

test('scheduled component updates an existing task with the built-in cron condition', async () => {
  const target = createTarget({ features: ['scheduled'] })
  const existing = createTask({
    condition: {
      type: 'cron',
      expression: '0 7 * * *',
      timezone: 'Asia/Shanghai',
      misfire: 'skip'
    },
    metadata: createTaskMetadata({
      sparkType: 'scheduled',
      origin: 'scheduled',
      autoDeleteAfterFire: false,
      configKey: `scheduled:${target.key}:早安:08:15`
    })
  })
  const updates = []
  const service = {
    targets: {
      async listRuntimeTargets() {
        return [target]
      }
    },
    trigger: {
      async findSparkTaskByConfigKey() {
        return existing
      },
      async updateSparkTask(task, input) {
        updates.push({ task, input })
      },
      async listSparkTasks() {
        return [existing]
      }
    }
  }
  const trigger = new ScheduledTrigger(
    createComponentContext(),
    { enabled: true, tasks: [{ name: '早安', time: '08:15', prompt: '新的早安' }] },
    service,
    mainConfig
  )

  await trigger.syncTargets()

  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].input.condition, {
    type: 'cron',
    expression: '15 8 * * *',
    timezone: 'Asia/Shanghai',
    misfire: 'skip'
  })
  assert.equal(updates[0].input.content, '新的早安')
})

test('festival component keeps one task per target and rolls completed tasks forward', async () => {
  const target = createTarget({ features: ['festival'] })
  const created = []
  const updates = []
  let existing
  const service = {
    targets: {
      async listRuntimeTargets() {
        return [target]
      }
    },
    trigger: {
      async findSparkTaskByTargetKey() {
        return existing
      },
      async createFestival(source, input) {
        created.push({ source, input })
      },
      async listSparkTasks() {
        return existing ? [existing] : []
      },
      async updateSparkTask(task, input) {
        updates.push({ task, input })
      },
      async setSparkTaskEnabled() {}
    }
  }
  const trigger = new FestivalTrigger(
    createComponentContext(),
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    service,
    mainConfig
  )
  trigger.getFestivalsForYear = () => [
    {
      name: '测试节日',
      date: '06-09',
      time: '09:00',
      description: '测试描述',
      category: 'modern'
    }
  ]

  await trigger.syncTargets(new Date('2026-06-08T00:00:00.000Z'))
  assert.equal(created.length, 1)
  assert.deepEqual(created[0].source, target.routing)
  assert.equal(created[0].input.fireAt.toISOString(), '2026-06-09T01:00:00.000Z')
  assert.equal(created[0].input.content, '今天是测试节日：测试描述')

  existing = createTask({
    state: {
      status: 'waiting',
      runCount: 0,
      nextRunAt: '2026-06-09T01:00:00.000Z'
    },
    condition: { type: 'once', at: '2026-06-09T01:00:00.000Z' },
    metadata: createTaskMetadata({
      sparkType: 'festival',
      origin: 'festival',
      content: '今天是测试节日：测试描述',
      autoDeleteAfterFire: false
    })
  })
  await trigger.syncTargets(new Date('2026-06-08T00:00:00.000Z'))
  assert.equal(updates.length, 0)

  existing = createTask({
    state: {
      status: 'completed',
      runCount: 1,
      lastRunAt: '2026-06-09T01:00:00.000Z'
    },
    condition: { type: 'once', at: '2026-06-09T01:00:00.000Z' },
    metadata: createTaskMetadata({
      sparkType: 'festival',
      origin: 'festival',
      autoDeleteAfterFire: false
    })
  })
  await trigger.syncTargets(new Date('2027-06-08T00:00:00.000Z'))
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0].input.condition, {
    type: 'once',
    at: '2027-06-09T01:00:00.000Z'
  })
  assert.equal(updates[0].input.metadata.origin, 'festival')
})

test('festival component accepts compact custom dates and selects the nearer festival', () => {
  const trigger = new FestivalTrigger(
    createComponentContext(),
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: [
        {
          name: '测试节',
          date: '0721',
          time: '13:40',
          description: 'test'
        }
      ]
    },
    {},
    mainConfig
  )

  const next = trigger.findNextFestival(new Date('2026-07-21T05:37:00.000Z'))
  assert.equal(next.festival.name, '测试节')
  assert.equal(next.festival.date, '07-21')
  assert.equal(next.fireAt.toISOString(), '2026-07-21T05:40:00.000Z')
})

test('disabled festival configuration disables existing Spark tasks', async () => {
  const disabled = []
  const existing = createTask({
    metadata: createTaskMetadata({
      sparkType: 'festival',
      origin: 'festival',
      autoDeleteAfterFire: false
    })
  })
  const service = {
    targets: {
      async listRuntimeTargets() {
        throw new Error('must not read targets')
      }
    },
    trigger: {
      async listSparkTasks() {
        return [existing]
      },
      async setSparkTaskEnabled(id, enabled) {
        disabled.push([id, enabled])
      }
    }
  }
  const trigger = new FestivalTrigger(
    createComponentContext(),
    { enabled: false, promptTemplate: '', defaultTime: '09:00', custom: [] },
    service,
    mainConfig
  )

  await trigger.syncTargets()
  assert.deepEqual(disabled, [[existing.id, false]])
})

test('festival component sends Character targets only to the native festival bridge', async () => {
  const target = createTarget({
    numericId: 12,
    engine: 'character',
    features: ['festival']
  })
  const synced = []
  const cleaned = []
  const service = {
    targets: {
      async listRuntimeTargets() {
        return [target]
      }
    },
    trigger: {
      async listSparkTasks() {
        return []
      }
    },
    character: {
      async syncTarget(value, input) {
        synced.push({ value, input })
      },
      async cleanupTargets(values) {
        cleaned.push(values)
      }
    }
  }
  const trigger = new FestivalTrigger(
    createComponentContext(),
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    service,
    mainConfig
  )
  trigger.getFestivalsForYear = () => [
    {
      name: '测试节日',
      date: '06-09',
      time: '09:00',
      description: '测试描述',
      category: 'modern'
    }
  ]

  await trigger.syncTargets(new Date('2026-06-08T00:00:00.000Z'))

  assert.equal(synced.length, 1)
  assert.equal(synced[0].value, target)
  assert.equal(synced[0].input.festivalDate, '2026-06-09')
  assert.deepEqual(cleaned, [[target]])
})

test('proactive component tracks only registered targets and wakes their route', async () => {
  const target = createTarget({
    type: 'group',
    guildId: 'guild-a',
    channelId: 'channel-a',
    features: ['proactive']
  })
  const wakeups = []
  const service = {
    targets: {
      async listRuntimeTargets() {
        return [target]
      },
      getSessionBindingKeys(session) {
        return session.guildId === 'guild-a' ? new Set([target.key]) : new Set()
      }
    },
    trigger: {
      async wakeup(source, prompt) {
        wakeups.push({ source, prompt })
        return { ok: true }
      }
    }
  }
  const trigger = new ProactiveTrigger(
    createComponentContext(),
    {
      enabled: true,
      checkInterval: 15,
      initialDelay: 0,
      initialProbability: 1,
      probabilityIncrease: 0,
      maxProbability: 1,
      sleepStart: '00:00',
      sleepEnd: '00:00',
      prompts: ['主动问候']
    },
    service,
    mainConfig
  )

  await trigger.refreshTargets()
  trigger.recordMessage(
    createSession({ isDirect: false, guildId: 'guild-a', channelId: 'channel-a' })
  )
  await trigger.checkAndTrigger()

  assert.equal(wakeups.length, 1)
  assert.equal(wakeups[0].prompt, '主动问候')
  assert.deepEqual(wakeups[0].source, target.routing)
})

test('proactive component tracks Character targets and uses the native Character adapter', async () => {
  const target = createTarget({ engine: 'character', features: ['proactive'] })
  const wakeups = []
  const service = {
    targets: {
      async listRuntimeTargets() {
        return [target]
      },
      getSessionBindingKeys() {
        return new Set([target.key.replace(/^character:/, '')])
      }
    },
    trigger: {
      async wakeup() {
        throw new Error('Character targets must not use ChatLuna Agent')
      }
    },
    character: {
      async triggerProactive(value, prompt) {
        wakeups.push({ value, prompt })
        return true
      }
    }
  }
  const trigger = new ProactiveTrigger(
    createComponentContext(),
    {
      enabled: true,
      checkInterval: 15,
      initialDelay: 0,
      initialProbability: 1,
      probabilityIncrease: 0,
      maxProbability: 1,
      sleepStart: '00:00',
      sleepEnd: '00:00',
      prompts: ['主动问候']
    },
    service,
    mainConfig
  )

  await trigger.refreshTargets()
  const state = trigger.getRoomState(target.key)
  state.lastChatTime = 0
  state.currentProbability = 0.5
  trigger.recordMessage(createSession())
  assert.equal(state.currentProbability, 0)
  state.lastChatTime = 0
  await trigger.checkAndTrigger()

  assert.equal(trigger.getRoomState(target.key), state)
  assert.deepEqual(wakeups, [{ value: target, prompt: '主动问候' }])
  assert.equal(state.currentProbability, 0)
})
