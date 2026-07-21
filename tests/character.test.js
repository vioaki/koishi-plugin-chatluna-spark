const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CharacterAdapter,
  characterSessionKey,
  formatCharacterFestivalMarker,
  formatCharacterTime,
  parseCharacterFestivalMarker
} = require('../lib/service/character')
const { createTarget, mockLogger } = require('./helpers')

function createCharacterContext(initial = {}, options = {}) {
  const wakeUps = new Map(
    Object.entries(initial).map(([key, items]) => [key, items.map((item) => ({ ...item }))])
  )
  const lastSessions = new Map()
  const persisted = []
  const proactiveRuns = []
  let nextUid = 1

  const bot = {
    platform: 'sandbox',
    selfId: 'koishi',
    sid: 'sandbox:koishi',
    session(event) {
      const isDirect = event.channel.type === 1
      return {
        bot,
        platform: 'sandbox',
        selfId: 'koishi',
        messageId: event.message?.id,
        content: event.message?.elements?.join('') ?? event.message?.content,
        userId: event.user.id,
        username: event.user.name,
        guildId: event.guild?.id,
        channelId: event.channel.id,
        isDirect
      }
    }
  }

  const sessionForKey = (key) => {
    const [type, id] = key.split(':')
    return bot.session({
      channel: { id, type: type === 'private' ? 1 : 0 },
      guild: type === 'group' ? { id } : undefined,
      user: { id: type === 'private' ? id : 'user-a', name: 'User A' }
    })
  }
  for (const key of wakeUps.keys()) lastSessions.set(key, sessionForKey(key))

  const trigger = {
    _config: {},
    keys() {
      return [...wakeUps.keys()]
    },
    getWakeUpReplies(key) {
      return wakeUps.get(key) ?? []
    },
    getLastSession(key) {
      return lastSessions.get(key)
    },
    setLastSession(session) {
      lastSessions.set(characterSessionKey(session), session)
    },
    async registerWakeUpReply(session, rawTime, reason, repeatRule) {
      const item = {
        uid: `spark-${nextUid++}`,
        rawTime,
        reason,
        naturalReason: reason,
        repeatRule,
        triggerAt: Date.now() + 60_000,
        createdAt: Date.now()
      }
      const key = characterSessionKey(session)
      wakeUps.set(key, [...(wakeUps.get(key) ?? []), item])
      return item
    },
    async setWakeUpReplies(session, items) {
      const key = characterSessionKey(session)
      wakeUps.set(
        key,
        items.map((item) => ({ ...item }))
      )
      persisted.push({ key, items: items.map((item) => ({ ...item })) })
    }
  }

  const character = {
    isMute() {
      return options.muted === true
    },
    isResponseLocked() {
      return options.locked === true
    },
    async triggerCollect(session, reason) {
      proactiveRuns.push({ session, reason })
      return options.triggered !== false
    }
  }

  return {
    ctx: {
      bots: [bot],
      chatluna_character: character,
      chatluna_character_trigger: trigger,
      logger: () => mockLogger()
    },
    trigger,
    wakeUps,
    lastSessions,
    persisted,
    proactiveRuns
  }
}

function userWakeUp(uid = 'user-task') {
  return {
    uid,
    rawTime: '10:00:00',
    reason: '用户自己的任务',
    naturalReason: '用户自己的任务',
    repeatRule: 'daily',
    triggerAt: Date.now() + 60_000,
    createdAt: Date.now()
  }
}

function sparkWakeUp(targetId, festivalDate, uid = `spark-${targetId}`) {
  const marker = formatCharacterFestivalMarker(targetId, festivalDate)
  return {
    uid,
    rawTime: '2026/08/19-09:00:00',
    reason: `节日问候\n${marker}`,
    naturalReason: marker,
    repeatRule: 'once',
    triggerAt: Date.now() + 60_000,
    createdAt: Date.now()
  }
}

test('Character festival bridge validates the native trigger API', () => {
  const { ctx } = createCharacterContext()
  delete ctx.chatluna_character_trigger.setWakeUpReplies

  assert.throws(() => new CharacterAdapter(ctx).start(), /missing methods: setWakeUpReplies/)
})

test('Character festival bridge persists one marked wake-up and updates it idempotently', async () => {
  const userTask = userWakeUp()
  const { ctx, wakeUps, persisted } = createCharacterContext({
    'group:guild-a': [userTask]
  })
  const adapter = new CharacterAdapter(ctx)
  adapter.start()
  const target = createTarget({
    numericId: 12,
    engine: 'character',
    type: 'group',
    guildId: 'guild-a',
    channelId: 'channel-a'
  })
  const fireAt = new Date('2026-08-19T01:00:00.000Z')

  assert.equal(
    await adapter.syncTarget(target, {
      fireAt,
      content: '请送上节日祝福',
      festivalDate: '2026-08-19'
    }),
    true
  )
  assert.equal(persisted.length, 1)
  assert.equal(wakeUps.get('group:guild-a').length, 2)
  assert.equal(wakeUps.get('group:guild-a')[0].uid, userTask.uid)
  assert.equal(wakeUps.get('group:guild-a')[1].rawTime, formatCharacterTime(fireAt))
  assert.deepEqual(parseCharacterFestivalMarker(wakeUps.get('group:guild-a')[1].reason), {
    targetId: 12,
    festivalDate: '2026-08-19'
  })

  assert.equal(
    await adapter.syncTarget(target, {
      fireAt,
      content: '请送上节日祝福',
      festivalDate: '2026-08-19'
    }),
    false
  )
  assert.equal(persisted.length, 1)

  await adapter.syncTarget(target, {
    fireAt: new Date('2027-08-19T01:00:00.000Z'),
    content: '新的节日祝福',
    festivalDate: '2027-08-19'
  })
  assert.equal(persisted.length, 2)
  assert.equal(wakeUps.get('group:guild-a').length, 2)
  assert.equal(wakeUps.get('group:guild-a')[0].uid, userTask.uid)
  assert.equal(
    parseCharacterFestivalMarker(wakeUps.get('group:guild-a')[1].reason).festivalDate,
    '2027-08-19'
  )
})

test('Character festival cleanup removes only stale Spark markers', async () => {
  const userTask = userWakeUp()
  const { ctx, wakeUps } = createCharacterContext({
    'group:guild-a': [userTask, sparkWakeUp(12, '2026-08-19'), sparkWakeUp(99, '2026-09-10')],
    'group:guild-b': [sparkWakeUp(12, '2026-08-19', 'wrong-route'), sparkWakeUp(88, '2026-10-01')]
  })
  const adapter = new CharacterAdapter(ctx)
  const active = createTarget({
    numericId: 12,
    engine: 'character',
    type: 'group',
    guildId: 'guild-a',
    channelId: 'channel-a'
  })

  assert.equal(await adapter.cleanupTargets([active]), 3)
  assert.deepEqual(
    wakeUps.get('group:guild-a').map((item) => item.uid),
    [userTask.uid, 'spark-12']
  )
  assert.deepEqual(wakeUps.get('group:guild-b'), [])
})

test('Character festival bridge maps direct targets to private Character sessions', async () => {
  const { ctx, lastSessions } = createCharacterContext()
  const adapter = new CharacterAdapter(ctx)
  const target = createTarget({ numericId: 3, engine: 'character' })

  await adapter.syncTarget(target, {
    fireAt: new Date('2026-08-19T01:00:00.000Z'),
    content: '节日祝福',
    festivalDate: '2026-08-19'
  })

  assert.equal(lastSessions.get('private:user-a').isDirect, true)
})

test('Character festival bridge creates an active session without passive reply metadata', async () => {
  const { ctx, lastSessions } = createCharacterContext()
  const adapter = new CharacterAdapter(ctx)
  const target = createTarget({
    numericId: 7,
    engine: 'character',
    type: 'group',
    guildId: 'guild-a',
    channelId: 'guild-a'
  })

  await adapter.syncTarget(target, {
    fireAt: new Date('2026-08-19T01:00:00.000Z'),
    content: '节日祝福',
    festivalDate: '2026-08-19'
  })

  const session = lastSessions.get('group:guild-a')
  assert.equal(session.content, '')
  assert.equal(session.messageId, undefined)
})

test('Character proactive chat reuses the native collector without fabricating a user message', async () => {
  const { ctx, lastSessions, proactiveRuns } = createCharacterContext()
  const adapter = new CharacterAdapter(ctx)
  adapter.start()
  const target = createTarget({
    numericId: 8,
    engine: 'character',
    type: 'group',
    guildId: 'guild-a',
    channelId: 'guild-a',
    features: ['proactive']
  })

  assert.equal(await adapter.triggerProactive(target, '主动关心用户'), true)
  assert.equal(proactiveRuns.length, 1)
  assert.equal(proactiveRuns[0].reason, 'Spark 主动聊天：主动关心用户')
  assert.equal(proactiveRuns[0].session.messageId, undefined)
  assert.equal(lastSessions.get('group:guild-a'), proactiveRuns[0].session)

  const busy = createCharacterContext({}, { muted: true })
  const busyAdapter = new CharacterAdapter(busy.ctx)
  busyAdapter.start()
  assert.equal(await busyAdapter.triggerProactive(target, '不应触发'), false)
  assert.equal(busy.proactiveRuns.length, 0)

  const locked = createCharacterContext({}, { locked: true })
  const lockedAdapter = new CharacterAdapter(locked.ctx)
  lockedAdapter.start()
  assert.equal(await lockedAdapter.triggerProactive(target, '不应重复触发'), false)
  assert.equal(locked.proactiveRuns.length, 0)
})
