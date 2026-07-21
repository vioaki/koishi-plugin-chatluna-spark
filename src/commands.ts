import { Context, Session } from 'koishi'
import type { TriggerTask } from 'koishi-plugin-chatluna-agent'
import { SparkService } from './service'
import { getSparkMetadata } from './service/task_metadata'
import { SparkEngine, SparkTargetFeature } from './types'

export function registerTaskCommands(ctx: Context, sparkService: SparkService) {
  const isAdmin = (session: Session) => hasAdminAuthority(session)
  const isTaskOwner = (task: TriggerTask, session: Session) => {
    const metadata = getSparkMetadata(task)
    return (
      task.ownerKey === `${session.platform}:${session.selfId}:${session.userId}` ||
      metadata?.createdBy === session.userId
    )
  }

  ctx
    .command('spark.list', '查看 Spark 待执行任务')
    .userFields(['authority'])
    .action(async ({ session }) => {
      if (!session) return '当前会话不可用'

      const tasks = (await sparkService.trigger.listSparkTasks(session)).filter(
        (task) => task.enabled && (isAdmin(session) || isTaskOwner(task, session))
      )
      if (tasks.length === 0) return '暂无 Spark 待执行任务'

      return tasks
        .slice(0, 20)
        .map((task, index) => {
          const metadata = getSparkMetadata(task)
          const next = task.state.nextRunAt ? formatTime(task.state.nextRunAt) : '被动/无下次触发'
          const type = metadata?.sparkType ?? 'unknown'
          const content = metadata?.content ?? task.name
          return `${index + 1}. [ID:${task.id}] ${type} ${next}\n   ${content}`
        })
        .join('\n\n')
    })

  ctx
    .command('spark.cancel <id:number>', '取消 Spark 任务')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      if (!session) return '当前会话不可用'
      if (!id) return '请指定任务 ID'

      try {
        const task = await sparkService.trigger.getSparkTask(id, session)
        if (!task) return `Spark 任务 [${id}] 不存在`
        if (!isTaskOwner(task, session) && !isAdmin(session)) return '无法取消其他用户的任务'
        await sparkService.trigger.removeSparkTask(id, session)
        return `Spark 任务 [${id}] 已取消`
      } catch (err) {
        return formatTaskAccessError(err, id, '取消')
      }
    })

  ctx
    .command('spark.fire <id:number>', '立即触发 Spark 任务')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      if (!session) return '当前会话不可用'
      if (!id) return '请指定任务 ID'

      try {
        const task = await sparkService.trigger.getSparkTask(id, session)
        if (!task) return `Spark 任务 [${id}] 不存在`
        if (!isTaskOwner(task, session) && !isAdmin(session)) return '无法触发其他用户的任务'

        const run = await sparkService.trigger.fireSparkTask(id, session)
        return run.status === 'completed'
          ? `Spark 任务 [${id}] 已触发`
          : `触发失败：${run.error ?? run.status}`
      } catch (err) {
        return formatTaskAccessError(err, id, '触发')
      }
    })

  ctx
    .command('spark.stats', '查看 Spark 任务统计（管理员）')
    .userFields(['authority'])
    .action(async ({ session }) => {
      if (!session || !isAdmin(session)) return '权限不足'

      const tasks = await sparkService.trigger.listSparkTasks(session)
      const byType: Record<string, number> = {}
      for (const task of tasks) {
        const type = getSparkMetadata(task)?.sparkType ?? 'unknown'
        byType[type] = (byType[type] ?? 0) + 1
      }

      return [
        'Spark 任务统计',
        `总数: ${tasks.length}`,
        `启用: ${tasks.filter((task) => task.enabled).length}`,
        ...Object.entries(byType).map(([type, count]) => `- ${type}: ${count}`)
      ].join('\n')
    })
}

export function registerTargetCommands(ctx: Context, sparkService: SparkService) {
  const requireAdmin = (session: Session | undefined) =>
    session && hasAdminAuthority(session) ? null : '权限不足'
  const refreshTargets = async () => {
    await ctx.parallel('spark/targets-updated')
  }

  ctx
    .command('spark.target.add [name:text]', '将当前会话加入 Spark target')
    .option('personal', '--personal')
    .option('character', '--character')
    .userFields(['authority'])
    .action(async ({ session, options }, name) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!session?.platform || !session?.selfId || !session?.userId) {
        return '当前会话缺少 platform/selfId/userId，无法注册目标'
      }

      const engine: SparkEngine = options?.character ? 'character' : 'chatluna'
      if (engine === 'character' && !sparkService.character) {
        return 'Character 功能不可用，请先安装并启用 koishi-plugin-chatluna-character >= 0.0.230'
      }

      let target
      try {
        target = await sparkService.targets.addFromSession(session, name, {
          personal: options?.personal,
          engine
        })
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
      await refreshTargets()
      return engine === 'character'
        ? `已加入 Character target：${formatTarget(target)}`
        : `已加入 Spark target：${formatTarget(target)}`
    })

  ctx
    .command('spark.target.list', '查看 Spark target')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const denied = requireAdmin(session)
      if (denied) return denied

      const targets = await sparkService.targets.listEntries()
      if (targets.length === 0) return '暂无 Spark target'
      return targets.map((target, index) => `${index + 1}. ${formatTarget(target)}`).join('\n')
    })

  ctx
    .command('spark.target.remove <id>', '删除 Spark 数据库 target')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!id) return '请指定 target ID'

      const databaseId = sparkService.targets.parseDatabaseId(id)
      if (databaseId == null) return 'target ID 应为 db:1 或 1'

      await sparkService.targets.removeDatabaseTarget(databaseId)
      await refreshTargets()
      return `已删除 Spark target db:${databaseId}`
    })

  ctx
    .command('spark.target.enable <id>', '启用 Spark 数据库 target')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!id) return '请指定 target ID'

      const databaseId = sparkService.targets.parseDatabaseId(id)
      if (databaseId == null) return 'target ID 应为 db:1 或 1'

      const target = await sparkService.targets.setDatabaseTargetEnabled(databaseId, true)
      await refreshTargets()
      return target
        ? `已启用 Spark target：${formatTarget(target)}`
        : `Spark target db:${databaseId} 不存在`
    })

  ctx
    .command('spark.target.disable <id>', '停用 Spark 数据库 target')
    .userFields(['authority'])
    .action(async ({ session }, id) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!id) return '请指定 target ID'

      const databaseId = sparkService.targets.parseDatabaseId(id)
      if (databaseId == null) return 'target ID 应为 db:1 或 1'

      const target = await sparkService.targets.setDatabaseTargetEnabled(databaseId, false)
      await refreshTargets()
      return target
        ? `已停用 Spark target：${formatTarget(target)}`
        : `Spark target db:${databaseId} 不存在`
    })

  ctx
    .command('spark.target.rename <id> <name:text>', '重命名 Spark target')
    .userFields(['authority'])
    .action(async ({ session }, id, name) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!id) return '请指定 target ID'
      if (!name?.trim()) return '请指定新的 target 名称'

      const databaseId = sparkService.targets.parseDatabaseId(id)
      if (databaseId == null) return 'target ID 应为 db:1 或 1'

      const target = await sparkService.targets.renameDatabaseTarget(databaseId, name)
      await refreshTargets()
      return target
        ? `已重命名 Spark target：${formatTarget(target)}`
        : `Spark target db:${databaseId} 不存在`
    })

  ctx
    .command('spark.target.features <id> [features:text]', '查看或设置 Spark target 功能')
    .userFields(['authority'])
    .action(async ({ session }, id, featuresText) => {
      const denied = requireAdmin(session)
      if (denied) return denied
      if (!id) return '请指定 target ID'

      const databaseId = sparkService.targets.parseDatabaseId(id)
      if (databaseId == null) return 'target ID 应为 db:1 或 1'

      const current = (await sparkService.targets.listEntries()).find(
        (target) => target.numericId === databaseId
      )
      if (!current) return `Spark target db:${databaseId} 不存在`
      if (!featuresText?.trim()) {
        return `Spark target db:${databaseId} 当前功能：${formatFeatures(current.features)}`
      }

      const features = sparkService.targets.parseFeatures(featuresText)
      if (!features) {
        return `功能只能是 ${SPARK_TARGET_FEATURES_TEXT}，多个功能用空格或逗号分隔；也可使用 all 或 none`
      }
      if (current.engine === 'character' && features.includes('scheduled')) {
        return 'Character target 不支持 scheduled；可设置 festival、proactive 或 none'
      }

      const target = await sparkService.targets.setDatabaseTargetFeatures(databaseId, features)
      await refreshTargets()
      return target
        ? `已更新 Spark target 功能：${formatTarget(target)}`
        : `Spark target db:${databaseId} 不存在`
    })
}

const SPARK_TARGET_FEATURES_TEXT = 'festival, scheduled, proactive'

function hasAdminAuthority(session: Session) {
  const user = session.user as { authority?: number } | undefined
  return (user?.authority ?? 0) >= 4
}

function formatTaskAccessError(err: unknown, id: number, action: '取消' | '触发') {
  const message = err instanceof Error ? err.message : String(err)
  if (/permission|forbidden/i.test(message)) return `无法${action}其他用户的任务`
  if (/not found/i.test(message)) return `Spark 任务 [${id}] 不存在`
  return `${action}失败：${message}`
}

function formatTarget(target: {
  id: string
  name: string
  enabled: boolean
  engine: SparkEngine
  platform: string
  selfId: string
  type: string
  scope: string
  userId: string
  guildId?: string
  channelId?: string
  features: SparkTargetFeature[]
}) {
  const targetId =
    target.type === 'direct'
      ? `user=${target.userId}`
      : `guild=${target.guildId ?? '-'} channel=${target.channelId ?? '-'} user=${target.userId}`
  const targetKind = target.engine === 'character' ? 'Character' : 'ChatLuna'
  return `[${target.id}] ${target.enabled ? '启用' : '停用'} ${target.name} ${targetKind} ${target.platform}/${target.selfId} ${target.type}/${target.scope} ${targetId} features=${formatFeatures(target.features)}`
}

function formatFeatures(features: SparkTargetFeature[]) {
  return features.length > 0 ? features.join(',') : 'none'
}

function formatTime(date: Date | string) {
  const d = new Date(date)
  const now = new Date()
  const diff = d.getTime() - now.getTime()

  if (diff < 0) return '已过期'
  if (diff < 60000) return '即将触发'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟后`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时后`

  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
}
