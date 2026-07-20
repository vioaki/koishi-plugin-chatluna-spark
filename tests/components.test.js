const test = require('node:test')
const assert = require('node:assert/strict')

const { ScheduledTrigger } = require('../lib/triggers/scheduled')
const { FestivalTrigger } = require('../lib/triggers/festival')
const { ProactiveTrigger } = require('../lib/triggers/proactive')
const {
  mockLogger,
  createTarget,
  createTask,
  createProviderConfig,
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

test('scheduled component creates cron tasks and disables stale configuration tasks', async () => {
  const target = createTarget({ features: ['scheduled'] })
  const created = []
  const disabled = []
  const stale = createTask({
    id: 9,
    config: createProviderConfig({
      mode: 'cron',
      expression: '0 7 * * *',
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
      async createCron(routing, input) {
        created.push({ routing, input })
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
  assert.deepEqual(disabled, [[9, false]])
})

test('scheduled component updates an existing V2 task with complete provider config', async () => {
  const target = createTarget({ features: ['scheduled'] })
  const existing = createTask({
    config: createProviderConfig({
      mode: 'cron',
      expression: '0 7 * * *',
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
  assert.equal(updates[0].input.config.expression, '15 8 * * *')
  assert.equal(updates[0].input.config.timezone, 'Asia/Shanghai')
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
      async createFestival(routing, input) {
        created.push({ routing, input })
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
  assert.equal(created[0].input.fireAt.toISOString(), '2026-06-09T01:00:00.000Z')
  assert.equal(created[0].input.content, '今天是测试节日：测试描述')

  existing = createTask({
    state: {
      status: 'completed',
      runCount: 1,
      lastRunAt: '2026-06-09T01:00:00.000Z'
    },
    config: createProviderConfig({
      mode: 'festival',
      at: '2026-06-09T01:00:00.000Z',
      sparkType: 'festival',
      origin: 'festival',
      autoDeleteAfterFire: false,
      festivalName: '测试节日',
      festivalDate: '2026-06-09'
    })
  })
  await trigger.healFestivalTasks(new Date('2027-06-08T00:00:00.000Z'))
  assert.equal(updates.length, 1)
  assert.equal(updates[0].input.config.festivalDate, '2027-06-09')
})

test('disabled festival configuration disables existing provider tasks', async () => {
  const disabled = []
  const existing = createTask({
    config: createProviderConfig({
      mode: 'festival',
      sparkType: 'festival',
      origin: 'festival',
      autoDeleteAfterFire: false,
      festivalName: '测试节日',
      festivalDate: '2026-06-09'
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
      async wakeup(routing, prompt) {
        wakeups.push({ routing, prompt })
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
  assert.deepEqual(wakeups[0].routing, target.routing)
})
