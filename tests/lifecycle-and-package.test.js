const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { apply } = require('../lib')
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
    async parallel() {},
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
  return ctx
}

test('apply registers commands before the Trigger V2 provider and integrations', async () => {
  const ctx = createApplyContext()
  apply(ctx, createConfig())
  for (const ready of ctx.handlers.ready ?? []) await ready()
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(ctx.commands.includes('spark.list'))
  assert.ok(ctx.commands.includes('spark.target.add [name:text]'))
  assert.equal(ctx.providers[0].id, 'chatluna-spark')
  assert.equal(ctx.providers[0].kind, 'scheduled')
  assert.equal(ctx.tools[0].name, 'spark_schedule')
  assert.equal(ctx.middleware[0].name, 'spark-tag-processor')
  assert.ok(ctx.operations.indexOf('command:spark.list') < ctx.operations.indexOf('provider'))
  assert.ok(
    ctx.records.some(([level, message]) => level === 'info' && /Spark plugin loaded/.test(message))
  )
})

test('provider and component startup failures do not prevent command registration', async () => {
  const ctx = createApplyContext({ providerError: 'provider failed', syncError: 'sync failed' })
  apply(ctx, createConfig())
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(ctx.commands.includes('spark.list'))
  assert.ok(ctx.commands.includes('spark.target.add [name:text]'))
  assert.ok(
    ctx.records.some(
      ([level, message]) =>
        level === 'error' && /Trigger V2 startup failed: provider failed/.test(message)
    )
  )
  assert.ok(ctx.records.some(([level, message]) => level === 'warn' && /sync failed/.test(message)))
})

test('spark_schedule is unavailable to Character and creates ChatLuna tasks only', async () => {
  const tools = []
  const created = []
  registerSparkScheduleTool(
    {
      chatluna: {
        platform: {
          registerTool(name, spec) {
            tools.push({ name, spec })
            return () => {}
          }
        }
      },
      on() {}
    },
    {
      async createOnce(input) {
        created.push(input)
        return { id: 12 }
      }
    }
  )

  assert.equal(tools[0].spec.meta.defaultAvailability.characterScope, 'none')
  const tool = tools[0].spec.createTool()
  const output = JSON.parse(
    await tool._call({ type: 'follow_up', time: '5m', content: '继续聊天' }, undefined, {
      configurable: { session: createSession(), source: 'character' }
    })
  )
  assert.equal(output.success, true)
  assert.deepEqual(created[0].metadata, { sparkOrigin: 'tool' })
})

test('package metadata locks Trigger V2 development dependencies and release surface', () => {
  const root = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')

  assert.equal(pkg.version, '0.5.0')
  assert.equal(pkg.dependencies['cron-parser'], '5.4.0')
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna'], '1.4.0-alpha.41')
  assert.equal(pkg.devDependencies['koishi-plugin-chatluna-agent'], '1.0.41')
  assert.equal(pkg.peerDependencies['koishi-plugin-chatluna'], '>=1.4.0-alpha.40 <2.0.0')
  assert.equal(pkg.peerDependencies['koishi-plugin-chatluna-agent'], '>=1.0.41 <2.0.0')
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
  assert.equal(pkg.scripts.prepack, 'npm run clean && npm run build')
  assert.deepEqual(pkg.files, ['lib', 'README.md', 'LICENSE'])
  assert.match(gitignore, /^lib\/$/m)
})
