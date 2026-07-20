function mockLogger(records = []) {
  return {
    debug(message) {
      records.push(['debug', message])
    },
    info(message) {
      records.push(['info', message])
    },
    warn(message) {
      records.push(['warn', message])
    },
    error(message) {
      records.push(['error', message])
    }
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
    async set(_table, id, update) {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) return
      Object.assign(row, typeof update === 'function' ? update(row) : update)
    },
    async remove(_table, ids) {
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id)
        if (index >= 0) rows.splice(index, 1)
      }
    }
  }
}

function createSession(overrides = {}) {
  const session = {
    bot: {},
    platform: overrides.platform ?? 'sandbox',
    selfId: overrides.selfId ?? 'koishi',
    userId: overrides.userId ?? 'user-a',
    username: overrides.username ?? 'User A',
    guildId: overrides.guildId,
    channelId: overrides.channelId ?? 'private:user-a',
    isDirect: overrides.isDirect ?? true,
    user: { authority: overrides.authority ?? 1 },
    async getUser() {
      return { authority: overrides.authority ?? 1 }
    }
  }
  return session
}

function createTarget(overrides = {}) {
  const type = overrides.type ?? 'direct'
  const isDirect = type === 'direct'
  return {
    id: overrides.id ?? 'db:1',
    numericId: overrides.numericId,
    name: overrides.name ?? '测试目标',
    enabled: overrides.enabled ?? true,
    platform: overrides.platform ?? 'sandbox',
    selfId: overrides.selfId ?? 'koishi',
    type,
    userId: overrides.userId ?? 'user-a',
    guildId: overrides.guildId,
    channelId: overrides.channelId ?? (isDirect ? 'private:user-a' : 'channel-a'),
    scope: overrides.scope ?? (isDirect ? 'personal' : 'shared'),
    features: overrides.features ?? ['festival', 'scheduled', 'proactive'],
    key:
      overrides.key ??
      (isDirect ? 'personal:sandbox:koishi:direct:user-a' : 'shared:sandbox:koishi:guild-a'),
    bindingKey:
      overrides.bindingKey ??
      overrides.key ??
      (isDirect ? 'personal:sandbox:koishi:direct:user-a' : 'shared:sandbox:koishi:guild-a'),
    routing: overrides.routing ?? {
      platform: overrides.platform ?? 'sandbox',
      selfId: overrides.selfId ?? 'koishi',
      userId: overrides.userId ?? 'user-a',
      guildId: overrides.guildId,
      channelId: overrides.channelId ?? (isDirect ? 'private:user-a' : 'channel-a'),
      isDirect
    }
  }
}

function createProviderConfig(overrides = {}) {
  const base = {
    mode: 'once',
    at: new Date(Date.now() + 60_000).toISOString(),
    timezone: 'Asia/Shanghai',
    sparkType: 'reminder',
    origin: 'tool',
    content: '喝水',
    createdBy: 'user-a',
    autoCancelOnUserMessage: false,
    autoDeleteAfterFire: true,
    targetKey: 'personal:sandbox:koishi:direct:user-a'
  }
  const config = { ...base, ...overrides }
  if (config.mode === 'cron') {
    delete config.at
    delete config.festivalName
    delete config.festivalDate
  } else if (config.mode === 'festival') {
    delete config.expression
  } else {
    delete config.expression
    delete config.festivalName
    delete config.festivalDate
  }
  return config
}

function createTask(overrides = {}) {
  const config = overrides.config ?? createProviderConfig()
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Spark reminder: 喝水',
    enabled: overrides.enabled ?? true,
    condition: overrides.condition ?? {
      type: 'extension',
      provider: 'chatluna-spark',
      config
    },
    execution: overrides.execution ?? {
      model: { type: 'default' },
      conversation: { type: 'route' },
      prompt: '[系统提示] 喝水',
      timeoutSeconds: 120,
      tools: { type: 'none' }
    },
    target: overrides.target ?? {
      bot: { platform: 'sandbox', selfId: 'koishi' },
      destination: { type: 'direct', userId: 'user-a' },
      principalId: 'user-a',
      delivery: 'channel'
    },
    state: overrides.state ?? {
      status: 'waiting',
      nextRunAt: config.at ?? new Date(Date.now() + 60_000).toISOString(),
      runCount: 0
    },
    ownerKey: overrides.ownerKey ?? 'sandbox:koishi:user-a',
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date()
  }
}

module.exports = {
  mockLogger,
  createMemoryDatabase,
  createSession,
  createTarget,
  createProviderConfig,
  createTask
}
