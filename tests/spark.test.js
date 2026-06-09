const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { parseTime } = require('../lib/utils/time_parser')
const { TagParser, parseSparkTags } = require('../lib/parser/tag_parser')
const { SparkTriggerAdapter } = require('../lib/service/trigger_adapter')
const { registerSparkScheduleTool } = require('../lib/tool/spark_schedule')
const { FestivalTrigger, toFestivalFireAt } = require('../lib/triggers/festival')
const { ScheduledTrigger, toDailyCronExpression } = require('../lib/triggers/scheduled')
const { ProactiveTrigger } = require('../lib/triggers/proactive')
const { SparkTargetRegistry } = require('../lib/service/targets')
const { apply, registerTaskCommands, registerTargetCommands } = require('../lib')

function mockLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  }
}

function createMemoryDatabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }))
  let nextId = rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1

  return {
    rows,
    async get(_table, query) {
      if (query?.id != null) {
        return rows.filter((row) => row.id === query.id).map((row) => ({ ...row }))
      }
      return rows.map((row) => ({ ...row }))
    },
    async create(_table, row) {
      const created = { ...row, id: nextId++ }
      rows.push(created)
      return { ...created }
    },
    async set(_table, id, patch) {
      const row = rows.find((candidate) => candidate.id === id)
      if (row) Object.assign(row, patch)
    },
    async remove(_table, ids) {
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id)
        if (index >= 0) rows.splice(index, 1)
      }
    }
  }
}

function createTarget(overrides = {}) {
  return {
    id: overrides.id ?? 'db:1',
    numericId: overrides.numericId,
    name: overrides.name ?? '测试目标',
    enabled: overrides.enabled ?? true,
    platform: overrides.platform ?? 'sandbox',
    selfId: overrides.selfId ?? 'koishi',
    type: overrides.type ?? 'direct',
    userId: overrides.userId ?? 'user-a',
    guildId: overrides.guildId,
    channelId: overrides.channelId ?? 'private:user-a',
    scope: overrides.scope ?? 'personal',
    features: overrides.features ?? ['festival', 'scheduled', 'proactive'],
    key: overrides.key ?? 'personal:sandbox:koishi:direct:user-a',
    bindingKey: overrides.bindingKey ?? overrides.key ?? 'personal:sandbox:koishi:direct:user-a',
    routing: overrides.routing ?? {
      platform: overrides.platform ?? 'sandbox',
      selfId: overrides.selfId ?? 'koishi',
      userId: overrides.userId ?? 'user-a',
      guildId: overrides.guildId,
      channelId: overrides.channelId ?? 'private:user-a',
      isDirect: (overrides.type ?? 'direct') === 'direct'
    }
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

test('parseTime rejects invalid calendar and clock values instead of rolling dates', () => {
  assert.equal(parseTime('2026-02-31 09:00').isValid, false)
  assert.equal(parseTime('2026-02-31').isValid, false)
  assert.equal(parseTime('25:99').isValid, false)
})

test('task commands use short spark command names only', () => {
  const commands = []
  const ctx = {
    command(name, description) {
      const command = {
        name,
        description,
        userFields() {
          return command
        },
        action(fn) {
          command.fn = fn
          return command
        }
      }
      commands.push(command)
      return command
    }
  }
  const sparkService = {
    trigger: {
      async listSparkTasks() {
        return []
      },
      isSparkTask() {
        return true
      }
    }
  }

  registerTaskCommands(ctx, sparkService)

  assert.deepEqual(
    commands.map((command) => command.name),
    ['spark.list', 'spark.cancel <id:number>', 'spark.fire <id:number>', 'spark.stats']
  )
  assert.equal(
    commands.some((command) => command.name.startsWith('spark.task')),
    false
  )
})

test('task commands allow the task creator to list, cancel, and fire tasks', async () => {
  const commands = new Map()
  const task = {
    id: 7,
    enabled: true,
    providerKind: 'once',
    userId: 'agent-user',
    createdBy: 'user-a',
    nextFireAt: new Date(Date.now() + 60_000),
    params: {
      spark: true,
      sparkType: 'reminder',
      sparkContent: '喝水'
    }
  }
  let removed
  let fired
  const ctx = {
    chatluna_agent: {
      trigger: {
        async getTask(id) {
          return id === task.id ? task : null
        },
        async removeTask(id) {
          removed = id
        },
        async fire(id) {
          fired = id
          return { ok: true }
        }
      }
    },
    command(name, description) {
      const command = {
        name,
        description,
        userFields() {
          return command
        },
        action(fn) {
          command.fn = fn
          commands.set(name, command)
          return command
        }
      }
      return command
    }
  }
  const sparkService = {
    trigger: {
      async listSparkTasks() {
        return [task]
      },
      isSparkTask(candidate) {
        return candidate?.params?.spark === true
      }
    }
  }

  registerTaskCommands(ctx, sparkService)

  const session = { userId: 'user-a', user: { authority: 1 } }
  assert.match(await commands.get('spark.list').fn({ session }), /\[ID:7\]/)
  assert.equal(
    await commands.get('spark.cancel <id:number>').fn({ session }, 7),
    'Spark 任务 [7] 已取消'
  )
  assert.equal(removed, 7)
  assert.equal(
    await commands.get('spark.fire <id:number>').fn({ session }, 7),
    'Spark 任务 [7] 已触发'
  )
  assert.equal(fired, 7)
})

test('apply registers configured integrations and disposes listeners', async () => {
  const disposeHandlers = []
  const readyHandlers = []
  const commands = []
  const tools = []
  const middleware = []
  const providers = []
  let disposed = 0
  const ctx = {
    logger: () => mockLogger(),
    model: {
      extend() {}
    },
    on(event, fn) {
      if (event === 'dispose') {
        disposeHandlers.push(fn)
        return () => {
          disposed++
        }
      }
      if (event === 'ready') {
        readyHandlers.push(fn)
      }
      return () => {
        disposed++
      }
    },
    setInterval() {
      return () => {
        disposed++
      }
    },
    command(name, description) {
      const command = {
        name,
        description,
        option() {
          return command
        },
        userFields() {
          return command
        },
        action() {
          commands.push(name)
          return command
        }
      }
      return command
    },
    chatluna: {
      platform: {
        registerTool(name, spec) {
          tools.push({ name, spec })
          return () => {
            disposed++
          }
        }
      },
      chatChain: {
        middleware(name, handler) {
          middleware.push({ name, handler })
          return {
            after() {
              return {
                before() {}
              }
            }
          }
        }
      },
      conversation: {
        async resolveConstraint() {
          return { bindingKey: 'binding' }
        }
      }
    },
    chatluna_agent: {
      trigger: {
        registerProvider(provider) {
          providers.push(provider)
          return () => {
            disposed++
          }
        },
        async listTasks() {
          return []
        },
        async setEnabled() {},
        async createTask() {},
        async updateTask() {}
      }
    }
  }

  apply(ctx, {
    mode: 'both',
    triggerTemplate: '[系统提示] {content}',
    autoDeleteExecutedAiTriggers: true,
    scheduled: { enabled: false, tasks: [] },
    festival: {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    proactive: {
      enabled: false,
      checkInterval: 15,
      initialDelay: 2,
      initialProbability: 0.1,
      probabilityIncrease: 0.05,
      maxProbability: 0.8,
      sleepStart: '23:00',
      sleepEnd: '07:00',
      prompts: ['主动问候']
    }
  })

  for (const ready of readyHandlers) await ready()

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['spark_schedule']
  )
  assert.deepEqual(
    middleware.map((item) => item.name),
    ['spark-tag-processor']
  )
  assert.deepEqual(
    providers.map((provider) => provider.kind),
    ['spark_festival']
  )
  assert.ok(commands.includes('spark.list'))
  assert.ok(commands.includes('spark.target.add [name:text]'))

  for (const dispose of disposeHandlers) dispose()
  assert.ok(disposed >= 5)
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

test('XML pure parser strips invalid control tags and reports failures', () => {
  const result = parseSparkTags(
    '收到 <reminder time="bad-time">喝水</reminder> <follow-up time="5m"></follow-up> 继续'
  )

  assert.equal(result.cleanText, '收到   继续')
  assert.equal(result.results.length, 0)
  assert.deepEqual(
    result.failures.map((failure) => failure.reason),
    ['invalid_time', 'empty_message']
  )
})

test('target registry lists database targets and merges duplicate binding keys', async () => {
  const database = createMemoryDatabase([
    {
      id: 1,
      name: 'daily',
      enabled: true,
      platform: 'sandbox',
      selfId: 'koishi',
      type: 'direct',
      userId: 'user-a',
      channelId: 'private:user-a',
      scope: 'personal',
      features: ['scheduled'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 2,
      name: 'festival',
      enabled: true,
      platform: 'sandbox',
      selfId: 'koishi',
      type: 'direct',
      userId: 'user-a',
      channelId: 'private:user-a',
      scope: 'personal',
      features: ['festival'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 3,
      name: 'disabled',
      enabled: false,
      platform: 'sandbox',
      selfId: 'koishi',
      type: 'direct',
      userId: 'user-b',
      channelId: 'private:user-b',
      scope: 'personal',
      features: ['festival'],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ])
  const registry = new SparkTargetRegistry({ database })

  const entries = await registry.listRuntimeTargets()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'personal:sandbox:koishi:direct:user-a')
  assert.deepEqual(entries[0].features.sort(), ['festival', 'scheduled'])

  const scheduled = await registry.listRuntimeTargets('scheduled')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].id, 'db:1')
})

test('target registry creates direct, group shared, and group personal targets from session', async () => {
  const database = createMemoryDatabase()
  const registry = new SparkTargetRegistry({ database })

  const direct = await registry.addFromSession(
    {
      platform: 'sandbox',
      selfId: 'koishi',
      userId: 'user-a',
      channelId: 'private:user-a',
      isDirect: true
    },
    '私聊'
  )
  assert.equal(direct.id, 'db:1')
  assert.equal(direct.type, 'direct')
  assert.equal(direct.scope, 'personal')
  assert.equal(direct.key, 'personal:sandbox:koishi:direct:user-a')
  assert.deepEqual(direct.features, ['festival', 'scheduled', 'proactive'])

  const groupShared = await registry.addFromSession(
    {
      platform: 'sandbox',
      selfId: 'koishi',
      userId: 'user-a',
      guildId: 'guild-a',
      channelId: 'channel-a',
      isDirect: false
    },
    '群聊'
  )
  assert.equal(groupShared.scope, 'shared')
  assert.equal(groupShared.key, 'shared:sandbox:koishi:guild-a')
  assert.deepEqual(groupShared.routing, {
    platform: 'sandbox',
    selfId: 'koishi',
    userId: 'user-a',
    guildId: 'guild-a',
    channelId: 'channel-a',
    isDirect: false
  })

  const groupPersonal = await registry.addFromSession(
    {
      platform: 'sandbox',
      selfId: 'koishi',
      userId: 'user-b',
      guildId: 'guild-a',
      channelId: 'channel-a',
      isDirect: false
    },
    '群聊个人',
    { personal: true }
  )
  assert.equal(groupPersonal.scope, 'personal')
  assert.equal(groupPersonal.key, 'personal:sandbox:koishi:guild-a:user-b')
})

test('target commands register spark.target names and refresh target sync', async () => {
  const commands = new Map()
  let refreshed = 0
  const database = createMemoryDatabase()
  const ctx = {
    database,
    async parallel(event) {
      if (event === 'spark/targets-updated') refreshed++
    },
    command(name, description) {
      const command = {
        name,
        description,
        options: [],
        option(key, spec) {
          command.options.push({ key, spec })
          return command
        },
        userFields() {
          return command
        },
        action(fn) {
          command.fn = fn
          commands.set(name, command)
          return command
        }
      }
      return command
    }
  }
  const sparkService = {
    targets: new SparkTargetRegistry(ctx)
  }

  registerTargetCommands(ctx, sparkService)

  assert.deepEqual(
    [...commands.keys()],
    [
      'spark.target.add [name:text]',
      'spark.target.list',
      'spark.target.remove <id>',
      'spark.target.enable <id>',
      'spark.target.disable <id>',
      'spark.target.rename <id> <name:text>',
      'spark.target.features <id> [features:text]'
    ]
  )

  const session = {
    platform: 'sandbox',
    selfId: 'koishi',
    userId: 'user-a',
    guildId: 'guild-a',
    channelId: 'channel-a',
    isDirect: false,
    user: { authority: 4 }
  }
  assert.match(
    await commands.get('spark.target.add [name:text]').fn({ session, options: {} }, '群聊'),
    /\[db:1\].*group\/shared/
  )
  assert.equal(refreshed, 1)
  assert.equal(
    await commands.get('spark.target.features <id> [features:text]').fn({ session }, 'db:1'),
    'Spark target db:1 当前功能：festival,scheduled,proactive'
  )
  assert.match(await commands.get('spark.target.list').fn({ session }), /^\d+\. \[db:1\]/)
  assert.equal(
    await commands.get('spark.target.rename <id> <name:text>').fn({ session }, 'db:1', '测试群'),
    '已重命名 Spark target：[db:1] 启用 测试群 sandbox/koishi group/shared guild=guild-a channel=channel-a user=user-a features=festival,scheduled,proactive'
  )
  assert.equal(refreshed, 2)
  assert.equal(
    await commands
      .get('spark.target.features <id> [features:text]')
      .fn({ session }, 'db:1', 'festival proactive'),
    '已更新 Spark target 功能：[db:1] 启用 测试群 sandbox/koishi group/shared guild=guild-a channel=channel-a user=user-a features=festival,proactive'
  )
  assert.equal(refreshed, 3)
  assert.equal(
    await commands.get('spark.target.disable <id>').fn({ session }, 'db:1'),
    '已停用 Spark target：[db:1] 停用 测试群 sandbox/koishi group/shared guild=guild-a channel=channel-a user=user-a features=festival,proactive'
  )
})

test('spark_festival provider prepares the next custom festival and rolls after fire', () => {
  const ctx = { logger: () => mockLogger() }
  const sparkService = {
    targets: {
      async listRuntimeTargets() {
        return []
      }
    },
    trigger: {
      async listSparkTasks() {
        return []
      }
    }
  }
  const trigger = new FestivalTrigger(
    ctx,
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )
  trigger.getFestivalsForYear = () => [
    { name: '明日节日', date: '06-09', time: '08:30', description: '测试一', category: 'modern' },
    { name: '后日节日', date: '06-10', time: '08:30', description: '测试二', category: 'modern' },
    { name: '非法节日', date: '02-31', time: '08:30', description: '非法', category: 'modern' }
  ]

  const provider = trigger.createProvider()
  const prepared = trigger.prepareFestivalTask(
    {
      params: { targetKey: 'personal:sandbox:koishi:direct:user-a' },
      wakeupTemplate: {}
    },
    new Date('2026-06-08T00:00:00+08:00')
  )

  assert.equal(provider.kind, 'spark_festival')
  assert.equal(prepared.nextFireAt.toISOString(), '2026-06-09T00:30:00.000Z')
  assert.equal(prepared.params.sparkOrigin, 'festival')
  assert.equal(prepared.params.targetKey, 'personal:sandbox:koishi:direct:user-a')
  assert.equal(prepared.params.festivalName, '明日节日')
  assert.equal(prepared.params.festivalDate, '2026-06-09')
  assert.match(prepared.wakeupTemplate.message, /今天是明日节日：测试一/)

  const rolled = provider.afterFire({
    task: {
      params: prepared.params,
      wakeupTemplate: prepared.wakeupTemplate
    },
    firedAt: new Date('2026-06-09T08:30:01+08:00')
  })
  assert.equal(rolled.nextFireAt.toISOString(), '2026-06-10T00:30:00.000Z')
  assert.equal(rolled.params.festivalName, '后日节日')
})

test('festival fire time conversion rejects invalid date and time values', () => {
  const after = new Date('2026-06-08T00:00:00+08:00')

  assert.equal(
    toFestivalFireAt(
      { name: 'bad', date: '02-31', time: '09:00', description: '', category: 'modern' },
      2026,
      after,
      true
    ),
    null
  )
  assert.equal(
    toFestivalFireAt(
      { name: 'bad', date: '06-09', time: '24:00', description: '', category: 'modern' },
      2026,
      after,
      true
    ),
    null
  )
  assert.equal(
    toFestivalFireAt(
      { name: 'ok', date: '06-09', time: '08:30', description: '', category: 'modern' },
      2026,
      after,
      true
    ).toISOString(),
    '2026-06-09T00:30:00.000Z'
  )
})

test('festival sync creates one spark_festival task per target and disables stale targets', async () => {
  const created = []
  const disabled = []
  const target = createTarget({ name: '私聊目标' })
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async createTask(source, task) {
          created.push({ source, task })
          return { id: created.length, ...task }
        },
        async updateTask() {},
        async setEnabled(id, enabled) {
          disabled.push({ id, enabled })
        }
      }
    }
  }
  const sparkService = {
    targets: {
      async listRuntimeTargets(feature) {
        assert.equal(feature, 'festival')
        return [target]
      }
    },
    trigger: {
      async findSparkTaskByTargetKey() {
        return null
      },
      async listSparkTasks() {
        return [
          {
            id: 9,
            enabled: true,
            providerKind: 'spark_festival',
            bindingKey: 'old',
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: 'old'
            }
          }
        ]
      }
    }
  }
  const trigger = new FestivalTrigger(
    ctx,
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  await trigger.syncTargets()

  assert.equal(created.length, 1)
  assert.equal(created[0].source, target.routing)
  assert.equal(created[0].task.providerKind, 'spark_festival')
  assert.equal(created[0].task.name, 'Spark festival: 私聊目标')
  assert.equal(created[0].task.params.targetKey, target.key)
  assert.deepEqual(disabled, [{ id: 9, enabled: false }])
})

test('festival heal refreshes only overdue active spark_festival tasks', async () => {
  const updated = []
  const target = createTarget({ name: '私聊目标' })
  const now = new Date('2026-06-10T10:00:00+08:00')
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async updateTask(id, patch) {
          updated.push({ id, patch })
        }
      }
    }
  }
  const sparkService = {
    targets: {
      async listRuntimeTargets(feature) {
        assert.equal(feature, 'festival')
        return [target]
      }
    },
    trigger: {
      async listSparkTasks() {
        return [
          {
            id: 30,
            enabled: true,
            providerKind: 'spark_festival',
            nextFireAt: new Date('2026-06-10T08:30:00+08:00'),
            wakeupTemplate: { replyTo: 'channel' },
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: target.key
            }
          },
          {
            id: 31,
            enabled: true,
            providerKind: 'spark_festival',
            nextFireAt: new Date('2026-06-10T09:30:30+08:00'),
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: target.key
            }
          },
          {
            id: 32,
            enabled: false,
            providerKind: 'spark_festival',
            nextFireAt: new Date('2026-06-10T08:30:00+08:00'),
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: target.key
            }
          },
          {
            id: 33,
            enabled: true,
            providerKind: 'spark_festival',
            nextFireAt: new Date('2026-06-10T08:30:00+08:00'),
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: 'inactive'
            }
          }
        ]
      }
    }
  }
  const trigger = new FestivalTrigger(
    ctx,
    {
      enabled: true,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}'
    }
  )

  const healed = await trigger.healOverdueFestivalTasks(now)

  assert.equal(healed, 1)
  assert.deepEqual(
    updated.map((item) => item.id),
    [30]
  )
  assert.deepEqual(updated[0].patch, {
    wakeupTemplate: { replyTo: 'channel' }
  })
})

test('disabled festival config disables existing spark_festival tasks without creating new ones', async () => {
  const created = []
  const disabled = []
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async createTask(source, task) {
          created.push({ source, task })
        },
        async setEnabled(id, enabled) {
          disabled.push({ id, enabled })
        }
      }
    }
  }
  const sparkService = {
    targets: {
      async listRuntimeTargets() {
        throw new Error('targets should not be read when festival is disabled')
      }
    },
    trigger: {
      async listSparkTasks() {
        return [
          {
            id: 10,
            enabled: true,
            providerKind: 'spark_festival',
            params: {
              spark: true,
              sparkOrigin: 'festival',
              targetKey: 'target'
            }
          }
        ]
      }
    }
  }
  const trigger = new FestivalTrigger(
    ctx,
    {
      enabled: false,
      promptTemplate: '今天是{festivalName}：{festivalDesc}',
      defaultTime: '09:00',
      custom: []
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  await trigger.syncTargets()

  assert.equal(created.length, 0)
  assert.deepEqual(disabled, [{ id: 10, enabled: false }])
})

test('scheduled trigger syncs cron tasks only for scheduled targets', async () => {
  const created = []
  const disabled = []
  const target = createTarget({ name: '私聊目标', features: ['scheduled'] })
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async updateTask() {},
        async setEnabled(id, enabled) {
          disabled.push({ id, enabled })
        }
      }
    }
  }
  const sparkService = {
    targets: {
      async listRuntimeTargets(feature) {
        assert.equal(feature, 'scheduled')
        return [target]
      }
    },
    trigger: {
      async findSparkTaskByConfigKey() {
        return null
      },
      async createCron(source, input) {
        created.push({ source, input })
        return { id: created.length }
      },
      async listSparkTasks() {
        return [
          {
            id: 20,
            enabled: true,
            providerKind: 'cron',
            params: {
              spark: true,
              sparkOrigin: 'scheduled',
              configKey: 'scheduled:old'
            }
          }
        ]
      }
    }
  }
  const trigger = new ScheduledTrigger(
    ctx,
    {
      enabled: true,
      tasks: [{ name: 'daily', time: '08:15', prompt: '早安' }]
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  await trigger.syncTargets()

  assert.equal(created.length, 1)
  assert.equal(created[0].source, target.routing)
  assert.equal(created[0].input.bindingKey, target.bindingKey)
  assert.equal(created[0].input.expression, '15 8 * * *')
  assert.equal(created[0].input.metadata.sparkOrigin, 'scheduled')
  assert.equal(created[0].input.metadata.targetKey, target.key)
  assert.deepEqual(disabled, [{ id: 20, enabled: false }])
})

test('scheduled cron conversion accepts HH:mm and rejects invalid values', () => {
  assert.equal(toDailyCronExpression('08:15'), '15 8 * * *')
  assert.equal(toDailyCronExpression('8:05'), '5 8 * * *')
  assert.equal(toDailyCronExpression('24:00'), null)
  assert.equal(toDailyCronExpression('12:60'), null)
  assert.equal(toDailyCronExpression('bad'), null)
})

test('scheduled trigger ignores invalid HH:mm times and disabled config disables stale tasks', async () => {
  let created = false
  const disabled = []
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async setEnabled(id, enabled) {
          disabled.push({ id, enabled })
        }
      }
    }
  }
  const sparkService = {
    targets: {
      async listRuntimeTargets() {
        return [createTarget({ features: ['scheduled'] })]
      }
    },
    trigger: {
      async findSparkTaskByConfigKey() {
        return null
      },
      async createCron() {
        created = true
      },
      async listSparkTasks() {
        return [
          {
            id: 21,
            enabled: true,
            providerKind: 'cron',
            params: {
              spark: true,
              sparkOrigin: 'scheduled',
              configKey: 'scheduled:old'
            }
          }
        ]
      }
    }
  }
  const invalid = new ScheduledTrigger(
    ctx,
    {
      enabled: true,
      tasks: [{ name: 'bad', time: '25:99', prompt: 'bad' }]
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  await invalid.syncTargets()
  assert.equal(created, false)
  assert.deepEqual(disabled, [{ id: 21, enabled: false }])

  const disabledConfig = new ScheduledTrigger(
    ctx,
    {
      enabled: false,
      tasks: [{ name: 'daily', time: '08:15', prompt: '早安' }]
    },
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  disabled.length = 0
  await disabledConfig.syncTargets()
  assert.deepEqual(disabled, [{ id: 21, enabled: false }])
})

test('proactive trigger tracks only target bindings and wakes registered routing', async () => {
  const target = createTarget({
    key: 'shared:sandbox:koishi:guild-a',
    bindingKey: 'shared:sandbox:koishi:guild-a',
    type: 'group',
    scope: 'shared',
    guildId: 'guild-a',
    channelId: 'channel-a',
    routing: {
      platform: 'sandbox',
      selfId: 'koishi',
      userId: 'user-a',
      guildId: 'guild-a',
      channelId: 'channel-a',
      isDirect: false
    }
  })
  const wakeups = []
  const ctx = { logger: () => mockLogger() }
  const sparkService = {
    targets: {
      async listRuntimeTargets(feature) {
        assert.equal(feature, 'proactive')
        return [target]
      },
      getSessionBindingKeys(session) {
        return new Set(
          session.guildId === 'guild-a'
            ? ['personal:sandbox:koishi:guild-a:user-b', 'shared:sandbox:koishi:guild-a']
            : ['shared:sandbox:koishi:guild-b']
        )
      }
    },
    trigger: {
      async wakeup(source, type, content) {
        wakeups.push({ source, type, content })
        return { ok: true }
      }
    }
  }
  const trigger = new ProactiveTrigger(
    ctx,
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
    sparkService,
    {
      triggerTemplate: '[系统提示] {content}',
      scope: { mode: '全部启用', list: [] }
    }
  )

  await trigger.refreshTargets()
  const state = trigger.getRoomState('shared:sandbox:koishi:guild-a')
  const originalLastChatTime = state.lastChatTime
  trigger.recordMessage({ guildId: 'guild-b' })
  assert.equal(state.lastChatTime, originalLastChatTime)

  trigger.recordMessage({ guildId: 'guild-a' })
  assert.ok(state.lastChatTime >= originalLastChatTime)

  const originalRandom = Math.random
  Math.random = () => 0
  try {
    state.lastChatTime = Date.now() - 1
    await trigger.checkAndTrigger()
  } finally {
    Math.random = originalRandom
  }

  assert.equal(wakeups.length, 1)
  assert.equal(wakeups[0].source, target.routing)
  assert.equal(wakeups[0].type, 'proactive')
  assert.equal(wakeups[0].content, '主动问候')
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

  registerSparkScheduleTool(ctx, adapter)

  assert.equal(registered.name, 'spark_schedule')

  const tool = registered.spec.createTool()
  assert.equal(tool.returnDirect, false)
  assert.match(tool.description, /proactive Spark trigger/)
  assert.match(tool.description, /own initiative/)
  assert.match(tool.description, /Use reminder/)
  assert.match(tool.description, /cancelled if the user replies first/)
  assert.deepEqual(tool.schema.shape.type._def.values, ['reminder', 'follow_up'])
  assert.match(tool.schema.shape.type.description, /proactive messages/)
  assert.match(tool.schema.shape.time.description, /Convert natural language time/)

  const output = JSON.parse(
    await tool.invoke(
      { type: 'follow_up', time: '5m', content: '继续刚才的话题' },
      {
        configurable: {
          session: { bot: {}, userId: 'user-a', channelId: 'private:user-a', isDirect: true }
        }
      }
    )
  )

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

  registerSparkScheduleTool(ctx, adapter)

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
  const output = JSON.parse(
    await tool.invoke(
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
    )
  )

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

test('adapter marks tool and XML once triggers for post-fire auto-delete by default', async () => {
  const created = []
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async createTask(source, task) {
          created.push({ source, task })
          return { id: created.length, ...task }
        },
        async listTasks() {
          return []
        }
      }
    },
    chatluna: {},
    on() {}
  }
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}'
  })
  const session = {
    bot: {},
    platform: 'sandbox',
    selfId: 'koishi',
    userId: 'user-a',
    channelId: 'private:user-a',
    isDirect: true
  }

  await adapter.createOnce({
    type: 'reminder',
    content: '上课加油',
    fireAt: new Date(Date.now() + 60_000),
    session,
    metadata: { sparkOrigin: 'tool' }
  })
  await adapter.createOnce({
    type: 'follow_up',
    content: '继续聊',
    fireAt: new Date(Date.now() + 120_000),
    session,
    metadata: { sparkOrigin: 'xml' }
  })
  await adapter.createOnce({
    type: 'festival',
    content: '节日祝福',
    fireAt: new Date(Date.now() + 180_000),
    session,
    metadata: { sparkOrigin: 'festival' }
  })

  assert.equal(created[0].task.params.sparkAutoDeleteAfterFire, true)
  assert.equal(created[1].task.params.sparkAutoDeleteAfterFire, true)
  assert.equal(created[2].task.params.sparkAutoDeleteAfterFire, false)
})

test('adapter rejects past one-shot trigger times before creating tasks', async () => {
  let created = false
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async createTask() {
          created = true
        },
        async listTasks() {
          return []
        }
      }
    },
    chatluna: {},
    on() {}
  }
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}'
  })

  await assert.rejects(
    adapter.createOnce({
      type: 'reminder',
      content: '过期任务',
      fireAt: new Date(Date.now() - 1000),
      routing: {
        platform: 'sandbox',
        selfId: 'koishi',
        userId: 'user-a',
        channelId: 'private:user-a',
        isDirect: true
      }
    }),
    /fireAt must be in the future/
  )
  assert.equal(created, false)
})

test('adapter config-key lookup includes disabled Spark config tasks', async () => {
  const existing = {
    id: 99,
    enabled: false,
    bindingKey: 'binding',
    params: {
      spark: true,
      sparkOrigin: 'scheduled',
      configKey: 'scheduled:personal:sandbox:koishi:direct:user-a:daily:08:15'
    }
  }
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async listTasks() {
          return [existing]
        }
      }
    },
    chatluna: {},
    on() {}
  }
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}',
    autoDeleteExecutedAiTriggers: false
  })

  assert.equal(
    await adapter.findSparkTaskByConfigKey(
      'binding',
      'scheduled:personal:sandbox:koishi:direct:user-a:daily:08:15'
    ),
    existing
  )
})

test('adapter auto-deletes only successful executed AI-created once triggers', async () => {
  const now = new Date()
  const removed = []
  const baseTask = {
    providerKind: 'once',
    enabled: false,
    fireCount: 1,
    lastFiredAt: now,
    lastError: null,
    bindingKey: 'binding',
    params: {
      spark: true,
      sparkAutoDeleteAfterFire: true,
      sparkType: 'reminder',
      sparkContent: 'content'
    }
  }
  const tasks = [
    { ...baseTask, id: 1, params: { ...baseTask.params, sparkOrigin: 'tool' } },
    { ...baseTask, id: 2, params: { ...baseTask.params, sparkOrigin: 'xml' } },
    { ...baseTask, id: 3, params: { ...baseTask.params, sparkOrigin: 'festival' } },
    {
      ...baseTask,
      id: 5,
      params: { ...baseTask.params, sparkOrigin: 'tool', sparkAutoDeleteAfterFire: false }
    },
    { ...baseTask, id: 6, enabled: true, params: { ...baseTask.params, sparkOrigin: 'tool' } },
    { ...baseTask, id: 7, fireCount: 0, params: { ...baseTask.params, sparkOrigin: 'tool' } },
    { ...baseTask, id: 8, lastFiredAt: null, params: { ...baseTask.params, sparkOrigin: 'tool' } },
    {
      ...baseTask,
      id: 9,
      lastError: 'send failed',
      params: { ...baseTask.params, sparkOrigin: 'tool' }
    },
    {
      ...baseTask,
      id: 10,
      providerKind: 'cron',
      params: { ...baseTask.params, sparkOrigin: 'tool' }
    },
    {
      ...baseTask,
      id: 11,
      source: 'webui',
      params: {
        sparkOrigin: 'tool',
        sparkAutoDeleteAfterFire: true
      }
    }
  ]
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async listTasks() {
          return tasks
        },
        async removeTask(id) {
          removed.push(id)
        }
      }
    },
    chatluna: {},
    on() {}
  }
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}',
    autoDeleteExecutedAiTriggers: true
  })

  const count = await adapter.cleanupExecutedAiTriggers()

  assert.equal(count, 2)
  assert.deepEqual(removed, [1, 2])
})

test('adapter post-fire auto-delete can be disabled', async () => {
  let listed = false
  const ctx = {
    logger: () => mockLogger(),
    chatluna_agent: {
      trigger: {
        async listTasks() {
          listed = true
          return []
        }
      }
    },
    chatluna: {},
    on() {}
  }
  const adapter = new SparkTriggerAdapter(ctx, {
    triggerTemplate: '[系统提示] {content}',
    autoDeleteExecutedAiTriggers: false
  })

  const count = await adapter.cleanupExecutedAiTriggers()

  assert.equal(count, 0)
  assert.equal(listed, false)
})

test('Spark trigger metadata types do not expose legacy origin', () => {
  const dts = fs.readFileSync(path.join(__dirname, '../lib/types.d.ts'), 'utf8')

  assert.doesNotMatch(dts, /legacy/)
})

test('package metadata keeps build, test, and publish surfaces reproducible', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  const gitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8')

  assert.equal(fs.existsSync(path.join(__dirname, '../package-lock.json')), true)
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
  assert.equal(pkg.scripts['audit:prod'], 'npm audit --omit=dev')
  assert.equal(pkg.scripts.prepack, 'npm run clean && npm run build')
  assert.equal(pkg.scripts['test:unit'], 'npm run build && node --test tests/*.test.js')
  assert.equal(pkg.scripts['test:package'], 'npm pack --dry-run --json')
  assert.deepEqual(pkg.files, ['lib', 'README.md', 'LICENSE'])
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna'], '1.4.0-alpha.22')
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna-agent'], '1.0.32')
  assert.equal(pkg.overrides.langsmith, '0.6.0')
  assert.equal(pkg.overrides.uuid, '^11.1.1')
  assert.match(gitignore, /^lib\/$/m)
  assert.match(gitignore, /^\.DS_Store$/m)
})
