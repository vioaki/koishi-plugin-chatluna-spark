const test = require('node:test')
const assert = require('node:assert/strict')

const { parseTime } = require('../lib/utils/time_parser')
const { parseSparkTags, TagParser } = require('../lib/parser/tag_parser')
const { nextSparkOccurrence } = require('../lib/service/trigger_provider')
const { toFestivalFireAt } = require('../lib/triggers/festival')
const { mockLogger, createSession, createProviderConfig } = require('./helpers')

test('parseTime accepts relative time and rejects invalid calendar values', () => {
  const before = Date.now()
  const parsed = parseTime('5m')
  const delta = parsed.date.getTime() - before

  assert.equal(parsed.isValid, true)
  assert.ok(delta >= 4.9 * 60 * 1000)
  assert.ok(delta <= 5.1 * 60 * 1000)
  assert.equal(parseTime('not-a-time').isValid, false)
  assert.equal(parseTime('2026-02-31 09:00').isValid, false)
  assert.equal(parseTime('25:99').isValid, false)
})

test('XML parser creates reminders and strips control tags', async () => {
  const created = []
  const parser = new TagParser(
    { logger: () => mockLogger() },
    {
      async createOnce(input) {
        created.push(input)
        return { id: created.length }
      }
    }
  )
  const result = await parser.parseAndExecute(
    '好的 <reminder time="5m">喝水</reminder> <follow-up time="10m">继续聊天</follow-up>',
    createSession()
  )

  assert.equal(result.cleanText, '好的')
  assert.equal(created.length, 2)
  assert.equal(created[0].metadata.sparkOrigin, 'xml')
  assert.equal(created[1].autoCancelOnUserMessage, true)

  const invalid = parseSparkTags('<reminder time="bad">喝水</reminder>')
  assert.equal(invalid.results.length, 0)
  assert.equal(invalid.failures[0].reason, 'invalid_time')
})

test('Spark provider computes once, cron, and festival occurrences', () => {
  const after = new Date('2026-06-08T00:00:00.000Z')
  const onceAt = new Date('2026-06-08T01:00:00.000Z')
  const once = nextSparkOccurrence(createProviderConfig({ at: onceAt.toISOString() }), after)
  assert.equal(once.at.toISOString(), onceAt.toISOString())
  assert.equal(nextSparkOccurrence(createProviderConfig({ at: after.toISOString() }), after), null)

  const cron = nextSparkOccurrence(
    createProviderConfig({
      mode: 'cron',
      expression: '0 9 * * *',
      origin: 'scheduled',
      sparkType: 'scheduled',
      autoDeleteAfterFire: false
    }),
    after
  )
  assert.equal(cron.at.toISOString(), '2026-06-08T01:00:00.000Z')

  const festival = nextSparkOccurrence(
    createProviderConfig({
      mode: 'festival',
      at: onceAt.toISOString(),
      origin: 'festival',
      sparkType: 'festival',
      autoDeleteAfterFire: false,
      festivalName: '测试节日',
      festivalDate: '2026-06-08'
    }),
    after
  )
  assert.equal(festival.periodKey, '2026-06-08')
})

test('festival time conversion uses the configured timezone and rejects invalid dates', () => {
  const festival = {
    name: '测试节日',
    date: '06-09',
    time: '09:00',
    description: '测试',
    category: 'modern'
  }
  const after = new Date('2026-06-08T00:00:00.000Z')
  const fireAt = toFestivalFireAt(festival, 2026, after, false, 'Asia/Shanghai')
  assert.equal(fireAt.toISOString(), '2026-06-09T01:00:00.000Z')
  assert.equal(
    toFestivalFireAt({ ...festival, date: '02-31' }, 2026, after, false, 'Asia/Shanghai'),
    null
  )
  assert.equal(toFestivalFireAt(festival, 2026, after, false, 'Invalid/Timezone'), null)
})
