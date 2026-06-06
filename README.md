# koishi-plugin-chatluna-spark

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-spark?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chatluna-spark)

为 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 添加主动对话能力的 Koishi 插件。新版 Spark 基于 `koishi-plugin-chatluna-agent` 的 Trigger 能力实现，不再自行创建影子会话或直接发送消息。

## 功能特性

- **Tool 默认模式** - 注册 `spark_schedule` 工具，让模型用工具创建提醒和跟进任务
- **XML 兼容模式** - 保留 `<reminder>`、`<follow-up>` 标签
- **定时提醒** - 在指定时间主动提醒用户
- **记忆提醒** - AI 可以记住用户提到的事情，并在明确时间主动提起
- **主动聊天** - 用户长时间不说话时按概率主动发起对话
- **节日问候** - 按当年节日日期创建一次性祝福任务
- **定时任务** - 每天定时执行指定任务

## 前置要求

- `koishi-plugin-chatluna` 1.4.0-alpha.22 或更高版本
- `koishi-plugin-chatluna-agent` 1.0.32 或更高版本
- Koishi database 服务

`koishi-plugin-chatluna` 1.4.0-alpha.22 修复了 tool 调用后历史消息裁剪错序的问题。低于该版本时，模型在调用 `spark_schedule` 后可能只回复 `！`、表情或颜文字。

## 模式配置

`mode` 支持三种值：

| 模式 | 说明 |
|------|------|
| `tool` | 默认模式，只注册 `spark_schedule` 工具 |
| `xml` | 只解析 XML 标签 |
| `both` | 同时启用 tool 和 XML，适合迁移或调试 |

## 推荐预设：Tool 模式

在 ChatLuna 预设中说明模型优先使用工具：

```text
当用户要求提醒、稍后跟进、或你需要在未来某个时间主动提起一件事时，使用 spark_schedule 工具。

type:
- reminder: 用户要求你在未来提醒，或你需要记住某件事并在明确时间主动提起。到时间后一定会触发。
- follow_up: 你想在一段时间后继续话题、确认进展或关心用户，但如果用户先发消息就不再需要主动打扰。用户先发消息会自动取消。

time 支持 30s、5m、2h、1d、1w、14:30、2026-01-15 09:00。
content 写到时间后希望你主动对用户说的话或要做的事。

不要为同一意图同时创建多个任务；不确定是否需要打扰用户时使用 follow_up，明确承诺提醒或必须触发时使用 reminder。
```

## chatluna-character

`chatluna-character` 使用 ChatLuna 的全局工具注册与 Agent 工具权限。Spark 会把 `spark_schedule` 注册为 character 可用工具，是否启用仍由 ChatLuna Agent 的工具权限和 character 路由决定。

新版 Spark 不再通过 character 日志截获 XML 标签。character 场景建议使用默认的 Tool 模式；XML 只作为 ChatLuna 主链路的兼容模式保留。

## XML 兼容预设

如果 `mode` 设置为 `xml` 或 `both`，可以继续使用 XML 标签。标签会被系统解析并在发送给用户前移除。

```xml
<reminder time="30m">提醒用户喝水</reminder>
<follow-up time="2h">问问用户事情处理得怎么样了</follow-up>
```

## 用户命令

| 命令 | 说明 |
|------|------|
| `spark.task.list` | 查看当前用户的 Spark 任务 |
| `spark.task.cancel <id>` | 取消指定 Spark 任务 |
| `spark.task.fire <id>` | 立即触发指定 Spark 任务 |
| `spark.task.stats` | 查看 Spark 任务统计（管理员） |
| `spark.task.clean` | 清理已迁移的旧任务记录（管理员） |

旧命令 `spark.my`、`spark.cancel`、`spark.admin.*` 已移除。

## 临时兼容项

`compat` 配置默认关闭。只有在当前环境仍使用旧版 ChatLuna / QQ 适配器且确认遇到对应问题时，才建议临时打开：

| 配置 | 作用 |
|------|------|
| `compat.qqTriggerMessageIdPatch` | 兼容旧版 ChatLuna/QQ 私聊 markdown 发送时携带虚拟 `messageId` 的问题 |

这些开关是迁移期 workaround。上游修复到位后应保持关闭。

## 工作原理

1. Tool 或 XML 产生 Spark 任务意图
2. Spark 将任务转换为 ChatLuna Agent Trigger 任务
3. Agent Trigger 负责定时、唤醒、会话解析、渲染和发送
4. `follow_up` 在用户先发消息时自动取消
5. 定时任务使用 Agent Trigger `cron`，节日问候使用当年 `once` 任务
6. 配置型定时/节日任务会在目标会话下一次有真实消息时同步到该会话，避免脱离 ChatLuna routing 创建不可达任务
7. 旧 `chatluna_spark_tasks` 中的 pending 任务会在启动时迁移到 Agent Trigger

## 许可证

MIT License
