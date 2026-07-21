const test = require('node:test')
const assert = require('node:assert/strict')

const { registerTaskCommands, registerTargetCommands } = require('../lib/commands')
const { SparkTargetRegistry } = require('../lib/service/targets')
const { createMemoryDatabase, createSession, createTask, createTaskMetadata } = require('./helpers')

function createCommandContext() {
  const commands = new Map()
  return {
    commands,
    ctx: {
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
          action(fn) {
            command.fn = fn
            commands.set(name, command)
            return command
          }
        }
        return command
      },
      async parallel() {}
    }
  }
}

test('task commands use the public adapter and preserve creator permissions', async () => {
  const { ctx, commands } = createCommandContext()
  const task = createTask({
    id: 7,
    metadata: createTaskMetadata({ content: '喝水', createdBy: 'user-a' })
  })
  const calls = []
  const service = {
    trigger: {
      async listSparkTasks(session) {
        calls.push(['list', session.userId])
        return [task]
      },
      async getSparkTask(id, session) {
        calls.push(['get', id, session.userId])
        return task
      },
      async removeSparkTask(id, session) {
        calls.push(['remove', id, session.userId])
      },
      async fireSparkTask(id, session) {
        calls.push(['fire', id, session.userId])
        return { status: 'completed' }
      }
    }
  }

  registerTaskCommands(ctx, service)
  assert.deepEqual(
    [...commands.keys()],
    ['spark.list', 'spark.cancel <id:number>', 'spark.fire <id:number>', 'spark.stats']
  )

  const session = createSession()
  assert.match(await commands.get('spark.list').fn({ session }), /\[ID:7\].*喝水/s)
  assert.equal(
    await commands.get('spark.cancel <id:number>').fn({ session }, 7),
    'Spark 任务 [7] 已取消'
  )
  assert.equal(
    await commands.get('spark.fire <id:number>').fn({ session }, 7),
    'Spark 任务 [7] 已触发'
  )
  assert.ok(calls.some((call) => call[0] === 'remove'))
  assert.ok(calls.some((call) => call[0] === 'fire'))
})

test('task commands reject non-owner access and allow administrator stats', async () => {
  const { ctx, commands } = createCommandContext()
  const task = createTask({
    ownerKey: 'sandbox:koishi:user-b',
    metadata: createTaskMetadata({ createdBy: 'user-b' })
  })
  const service = {
    trigger: {
      async listSparkTasks() {
        return [task]
      },
      async getSparkTask() {
        return task
      },
      async removeSparkTask() {
        throw new Error('must not remove')
      },
      async fireSparkTask() {
        throw new Error('must not fire')
      }
    }
  }
  registerTaskCommands(ctx, service)

  const user = createSession({ userId: 'user-a', authority: 1 })
  assert.equal(
    await commands.get('spark.cancel <id:number>').fn({ session: user }, 1),
    '无法取消其他用户的任务'
  )
  assert.equal(await commands.get('spark.stats').fn({ session: user }), '权限不足')

  const admin = createSession({ userId: 'admin', authority: 4 })
  assert.match(await commands.get('spark.stats').fn({ session: admin }), /总数: 1/)
})

test('target registry creates direct, group-shared, and group-personal entries', async () => {
  const database = createMemoryDatabase()
  const registry = new SparkTargetRegistry({ database })

  const direct = await registry.addFromSession(createSession(), '私聊')
  const groupSession = createSession({
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  const shared = await registry.addFromSession(groupSession, '群聊')
  const personal = await registry.addFromSession(groupSession, '群内个人', { personal: true })

  assert.equal(direct.key, 'personal:sandbox:koishi:direct:user-a')
  assert.equal(shared.key, 'shared:sandbox:koishi:guild-a')
  assert.equal(personal.key, 'personal:sandbox:koishi:guild-a:user-a')
  assert.equal(database.rows.length, 3)
})

test('target registry keeps legacy targets on ChatLuna and separates Character targets', async () => {
  const now = new Date()
  const database = createMemoryDatabase([
    {
      id: 1,
      name: '旧目标',
      enabled: true,
      platform: 'sandbox',
      selfId: 'koishi',
      type: 'group',
      userId: 'user-a',
      guildId: 'guild-a',
      channelId: 'channel-a',
      scope: 'shared',
      features: ['festival'],
      createdAt: now,
      updatedAt: now
    }
  ])
  const registry = new SparkTargetRegistry({ database })
  const session = createSession({
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })

  const legacy = (await registry.listEntries())[0]
  const character = await registry.addFromSession(session, '角色目标', { engine: 'character' })

  assert.equal(legacy.engine, 'chatluna')
  assert.equal(legacy.key, 'shared:sandbox:koishi:guild-a')
  assert.equal(character.engine, 'character')
  assert.equal(character.key, 'character:shared:sandbox:koishi:guild-a')
  assert.deepEqual(character.features, ['festival', 'proactive'])
  assert.equal(database.rows.length, 2)
})

test('Character group targets reject personal scope', async () => {
  const registry = new SparkTargetRegistry({ database: createMemoryDatabase() })
  const session = createSession({
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })

  await assert.rejects(
    registry.addFromSession(session, '错误目标', { engine: 'character', personal: true }),
    /Character group targets do not support personal scope/
  )
})

test('target registry preserves explicit Character feature choices', async () => {
  const now = new Date()
  const registry = new SparkTargetRegistry({
    database: createMemoryDatabase([
      {
        id: 1,
        name: '仅节日',
        enabled: true,
        engine: 'character',
        platform: 'sandbox',
        selfId: 'koishi',
        type: 'group',
        userId: 'user-a',
        guildId: 'guild-a',
        channelId: 'channel-a',
        scope: 'shared',
        features: ['festival'],
        createdAt: now,
        updatedAt: now
      }
    ])
  })

  const [target] = await registry.listEntries()
  assert.deepEqual(target.features, ['festival'])
})

test('target registry merges enabled duplicate runtime targets by binding key', async () => {
  const now = new Date()
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
      createdAt: now,
      updatedAt: now
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
      createdAt: now,
      updatedAt: now
    }
  ])
  const registry = new SparkTargetRegistry({ database })
  const targets = await registry.listRuntimeTargets()

  assert.equal(targets.length, 1)
  assert.deepEqual(targets[0].features.sort(), ['festival', 'scheduled'])
})

test('target commands manage the current conversation and refresh components', async () => {
  const database = createMemoryDatabase()
  const registry = new SparkTargetRegistry({ database })
  const { ctx, commands } = createCommandContext()
  let refreshes = 0
  ctx.parallel = async () => {
    refreshes++
  }
  registerTargetCommands(ctx, {
    targets: registry
  })

  const session = createSession({
    authority: 4,
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  assert.match(
    await commands.get('spark.target.add [name:text]').fn({ session, options: {} }, '测试群'),
    /已加入 Spark target/
  )
  assert.match(await commands.get('spark.target.list').fn({ session }), /^1\. \[db:1\]/)
  assert.equal(
    await commands
      .get('spark.target.features <id> [features:text]')
      .fn({ session }, 'db:1', 'festival proactive'),
    '已更新 Spark target 功能：[db:1] 启用 测试群 ChatLuna sandbox/koishi group/shared guild=guild-a channel=channel-a user=user-a features=festival,proactive'
  )
  assert.equal(refreshes, 2)
})

test('target command uses --character for Character festival and proactive targets', async () => {
  const database = createMemoryDatabase()
  const registry = new SparkTargetRegistry({ database })
  const { ctx, commands } = createCommandContext()
  registerTargetCommands(ctx, {
    targets: registry,
    character: {}
  })
  const session = createSession({
    authority: 4,
    isDirect: false,
    guildId: 'guild-a',
    channelId: 'channel-a'
  })

  const output = await commands
    .get('spark.target.add [name:text]')
    .fn({ session, options: { character: true } }, '角色群')

  assert.match(output, /Character/)
  assert.match(output, /Character target/)
  assert.equal(database.rows[0].engine, 'character')
  assert.deepEqual(database.rows[0].features, ['festival', 'proactive'])

  assert.match(
    await commands
      .get('spark.target.features <id> [features:text]')
      .fn({ session }, 'db:1', 'proactive'),
    /features=proactive$/
  )
})

test('target command explains when Character integration is unavailable', async () => {
  const { ctx, commands } = createCommandContext()
  registerTargetCommands(ctx, {
    targets: new SparkTargetRegistry({ database: createMemoryDatabase() })
  })

  const output = await commands
    .get('spark.target.add [name:text]')
    .fn({ session: createSession({ authority: 4 }), options: { character: true } }, '角色')

  assert.match(output, /Character 功能不可用/)
})
