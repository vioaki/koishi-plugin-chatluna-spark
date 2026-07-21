const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { apply } = require('../lib')
const { extendDatabase } = require('../lib/database')
const { setupChatlunaInterceptor } = require('../lib/middleware/chatluna_interceptor')
const { registerSparkScheduleTool } = require('../lib/tool/spark_schedule')
const { mockLogger, createSession } = require('./helpers')

function createConfig(overrides = {}) {
  return {
    mode: 'both',
    timezone: 'Asia/Shanghai',
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
    },
    ...overrides
  }
}

function createApplyContext(options = {}) {
  const commands = []
  const tools = []
  const middleware = []
  const providers = []
  const operations = []
  const records = []
  const handlers = {}
  let targetRefreshes = 0
  const trigger = {
    registerProvider(provider) {
      if (options.providerError) throw new Error(options.providerError)
      providers.push(provider)
      operations.push('provider')
      return () => {}
    },
    listProviders() {
      return providers.map((provider) => ({ id: provider.id }))
    },
    async create() {},
    async list() {
      if (options.syncError) throw new Error(options.syncError)
      return []
    },
    async get() {},
    async remove() {},
    async update() {},
    async setEnabled() {},
    async fire() {},
    async wakeup() {}
  }
  if (options.missingV2Method) delete trigger[options.missingV2Method]

  const ctx = {
    handlers,
    records,
    get targetRefreshes() {
      return targetRefreshes
    },
    commands,
    tools,
    middleware,
    providers,
    operations,
    logger: () => mockLogger(records),
    model: { extend() {} },
    database: {
      async get() {
        if (options.syncError) throw new Error(options.syncError)
        return []
      }
    },
    on(event, listener) {
      ;(handlers[event] ??= []).push(listener)
      return () => {}
    },
    setInterval() {
      return () => {}
    },
    setTimeout(callback) {
      callback()
      return () => {}
    },
    inject(services, callback) {
      if (options.character && services.every((service) => ctx[service])) callback(ctx)
    },
    async parallel(event) {
      if (event === 'spark/targets-updated') targetRefreshes++
    },
    command(name, description) {
      operations.push(`command:${name}`)
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
          return () => {}
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
    chatluna_agent: { trigger }
  }
  if (options.character) {
    ctx.bots = []
    ctx.chatluna_character = {
      isMute() {
        return false
      },
      isResponseLocked() {
        return false
      },
      async triggerCollect() {
        return true
      }
    }
    ctx.chatluna_character_trigger = {
      _config: {},
      async registerWakeUpReply() {},
      async setWakeUpReplies() {},
      getWakeUpReplies() {
        return []
      },
      setLastSession() {},
      getLastSession() {},
      keys() {
        return []
      }
    }
  }
  return ctx
}

test('apply uses Trigger V2 built-ins without registering a duplicate provider', async () => {
  const ctx = createApplyContext()
  apply(ctx, createConfig())
  for (const ready of ctx.handlers.ready ?? []) await ready()
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(ctx.commands.includes('spark.list'))
  assert.ok(ctx.commands.includes('spark.target.add [name:text]'))
  assert.equal(ctx.providers.length, 0)
  assert.equal(ctx.tools[0].name, 'spark_schedule')
  assert.equal(ctx.middleware[0].name, 'spark-tag-processor')
  assert.ok(
    ctx.records.some(([level, message]) => level === 'info' && /Spark plugin loaded/.test(message))
  )
})

test('Trigger V2 and component startup failures do not prevent command registration', async () => {
  const ctx = createApplyContext({ missingV2Method: 'wakeup', syncError: 'sync failed' })
  apply(ctx, createConfig())
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(ctx.commands.includes('spark.list'))
  assert.ok(ctx.commands.includes('spark.target.add [name:text]'))
  assert.ok(
    ctx.records.some(
      ([level, message]) =>
        level === 'error' && /Trigger V2 startup failed:.*missing methods: wakeup/.test(message)
    )
  )
  assert.ok(ctx.records.some(([level, message]) => level === 'warn' && /sync failed/.test(message)))
})

test('apply attaches the optional Character integration', async () => {
  const ctx = createApplyContext({ character: true })
  apply(ctx, createConfig())
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(
    ctx.records.some(
      ([level, message]) => level === 'info' && /Spark Character integration attached/.test(message)
    )
  )
  assert.ok(ctx.commands.includes('spark.list'))
})

test('bot status changes refresh configured targets after adapters become available', async () => {
  const ctx = createApplyContext()
  apply(ctx, createConfig())

  await ctx.handlers['bot-status-updated'][0]({})
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(ctx.targetRefreshes, 1)
})

test('target schema defaults legacy rows to the ChatLuna target kind', () => {
  const models = []
  extendDatabase({
    model: {
      extend(name, fields) {
        models.push({ name, fields })
      }
    }
  })

  assert.equal(models.length, 2)
  assert.equal(models[0].name, 'chatluna_spark_targets')
  assert.deepEqual(models[0].fields.engine, { type: 'string', initial: 'chatluna' })
  assert.equal(models[1].name, 'chatluna_spark_task_meta')
  assert.equal('at' in models[1].fields, false)
  assert.equal('expression' in models[1].fields, false)
  assert.equal('timezone' in models[1].fields, false)
})

test('spark_schedule is unavailable to Character and creates ChatLuna tasks only', async () => {
  require('koishi-plugin-chatluna')
  const { Context } = require('koishi')
  const { PlatformService } = require('koishi-plugin-chatluna/llm-core/platform/service')

  const ctx = new Context()
  const platform = new PlatformService(ctx)
  ctx.chatluna = { platform }
  const created = []
  registerSparkScheduleTool(ctx, {
    async createOnce(input) {
      created.push(input)
      return { id: 12 }
    }
  })

  const registry = platform.getToolRegistry()
  assert.equal(registry.spark_schedule.meta.defaultAvailability.characterScope, 'none')
  assert.equal(registry.spark_schedule.meta.defaultAvailability.chatluna, true)

  const tool = platform.getTool('spark_schedule').createTool({})
  const characterOutput = JSON.parse(
    await tool.invoke(
      { type: 'follow_up', time: '5m', content: '继续聊天' },
      { configurable: { session: createSession(), source: 'character' } }
    )
  )
  const chatlunaOutput = JSON.parse(
    await tool.invoke(
      { type: 'reminder', time: '5m', content: '喝水' },
      { configurable: { session: createSession(), source: 'chatluna' } }
    )
  )

  assert.equal(characterOutput.success, false)
  assert.equal(characterOutput.error, 'unsupported_source')
  assert.equal(chatlunaOutput.taskId, 12)
  assert.equal(created.length, 1)
  assert.deepEqual(created[0].metadata, { sparkOrigin: 'tool' })

  platform.dispose()
})

test('ChatLuna XML interceptor removes tags in place across multipart content', async () => {
  let ready
  let middleware
  const created = []
  const ctx = {
    logger: () => mockLogger(),
    on(event, callback) {
      if (event === 'ready') ready = callback
      return () => {}
    },
    chatluna: {
      chatChain: {
        middleware(_name, callback) {
          middleware = callback
          return {
            after() {
              return { before() {} }
            }
          }
        }
      }
    }
  }
  setupChatlunaInterceptor(ctx, {
    async createOnce(input) {
      created.push(input)
      return { id: 1 }
    }
  })
  await ready()

  const responseMessage = {
    content: [
      { type: 'text', text: '前置 <reminder time="5m">' },
      { type: 'image_url', image_url: 'https://example.com/image.png' },
      { type: 'text', text: '喝水</reminder> 后置' }
    ]
  }
  await middleware(createSession(), { options: { responseMessage } })

  assert.equal(created.length, 1)
  assert.equal(responseMessage.content[0].text, '前置 ')
  assert.equal(responseMessage.content[1].type, 'image_url')
  assert.equal(responseMessage.content[2].text, ' 后置')
})

test('package metadata locks Trigger V2 development dependencies and release surface', () => {
  const root = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')

  assert.equal(pkg.version, '1.5.1')
  assert.equal(pkg.dependencies['cron-parser'], undefined)
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna'], '1.4.0-alpha.41')
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna-agent'], '1.0.41')
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna-character'], '0.0.230')
  assert.equal(pkg.peerDependencies['koishi-plugin-chatluna'], '>=1.4.0-alpha.40 <2.0.0')
  assert.equal(pkg.peerDependencies['koishi-plugin-chatluna-agent'], '>=1.0.41 <2.0.0')
  assert.equal(pkg.peerDependencies['koishi-plugin-chatluna-character'], '>=0.0.230 <0.1.0')
  assert.equal(pkg.peerDependenciesMeta['koishi-plugin-chatluna-character'].optional, true)
  assert.deepEqual(pkg.koishi.service.optional, [
    'chatluna_character',
    'chatluna_character_trigger'
  ])
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
  assert.equal(pkg.scripts.prepack, 'npm run clean && npm run build')
  assert.deepEqual(pkg.files, ['lib', 'README.md', 'LICENSE'])
  assert.match(gitignore, /^lib\/$/m)
})
