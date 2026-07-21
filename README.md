# koishi-plugin-chatluna-spark

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-spark?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chatluna-spark)

为 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 添加主动对话能力的 Koishi 插件，基于 ChatLuna Agent Trigger 支持定时提醒、跟进、节日问候、主动聊天等功能。

## 功能

- `spark_schedule`：让 ChatLuna 创建一次性提醒和可自动取消的跟进
- 配置定时：按 target 每天执行指定提示词
- 节日问候：自动计算下一个节日并更新问候任务
- 主动聊天：target 长时间无人发言后按概率主动发起对话
- Character：将节日问候写入原生 wake-up 调度器，并按 Spark 概率策略主动聊天

## 版本要求

- `koishi-plugin-chatluna >= 1.4.0-alpha.40`
- `koishi-plugin-chatluna-agent >= 1.0.41`
- Character 功能可选：`koishi-plugin-chatluna-character >= 0.0.230`

Spark `1.5.x` 仅支持以上新版 API。旧版 Agent Trigger 环境请继续使用 Spark `0.4.2`。

## 安装

在 Koishi 插件市场安装 `koishi-plugin-chatluna-spark`，或使用 npm：

```sh
npm install koishi-plugin-chatluna-spark
```

必须先启用 `database`、`chatluna` 和 `chatluna-agent`。需要 Character 功能时，再安装并启用 `chatluna-character`。

## 快速使用

默认 `mode` 为 `tool`，会为 ChatLuna 注册 `spark_schedule`。建议在 ChatLuna 预设中补充：

```text
当你判断未来某个时间主动发起对话会有帮助时，可以使用 spark_schedule，不需要等用户明确要求。

type:
- reminder：明确时间点的提醒、问候、关心或必须触发的事项。
- follow_up：稍后继续话题或确认进展；如果用户先发消息则自动取消。

time 支持：30s、5m、2h、1d、1w、14:30、2026-01-15 09:00。
content 写触发时要说的话或要做的事。不要为同一意图创建重复任务。
```

节日问候、配置定时任务、主动聊天只对已加入 target 的 ChatLuna 会话生效：

```sh
spark.target.add [名称]
```

为当前 Character 会话启用节日问候和主动聊天：

```sh
spark.target.add --character [名称]
```

ChatLuna 群聊默认绑定整个群；仅绑定当前群内个人时使用：

```sh
spark.target.add --personal [名称]
```

Character 群聊使用共享角色会话，不支持 `--personal`。Character target 支持 `festival` 和 `proactive`；提醒和定时任务继续使用 Character 内置的 `wake_up_reply_*` 与 `next_reply`。

Character 自带空闲触发与 Spark 主动聊天相互独立。Spark 使用本插件配置的空闲时长、递增概率、休息时段和提示词，命中后复用 Character 原生回复链路。

## 模式

| `mode` | 说明                                    |
| ------ | --------------------------------------- |
| `tool` | 默认；为 ChatLuna 注册 `spark_schedule` |
| `xml`  | 解析 ChatLuna 回复中的 Spark XML 标签   |
| `both` | 同时启用 Tool 和 XML                    |

`timezone` 默认是 `Asia/Shanghai`，用于 Cron、节日和主动聊天休息时段的时间计算。

`autoDeleteExecutedAiTriggers` 默认开启。Tool/XML 创建的一次性任务成功执行后自动删除；配置定时和节日任务不受影响。

## 命令

| 命令                                    | 说明                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| `spark.list`                            | 查看当前用户可管理的 ChatLuna 任务                   |
| `spark.cancel <id>`                     | 取消 ChatLuna 任务                                   |
| `spark.fire <id>`                       | 立即触发 ChatLuna 任务                               |
| `spark.stats`                           | 查看 ChatLuna 任务统计（管理员）                     |
| `spark.target.list`                     | 列出 target                                          |
| `spark.target.remove <id>`              | 删除 target                                          |
| `spark.target.enable <id>`              | 启用 target                                          |
| `spark.target.disable <id>`             | 停用 target                                          |
| `spark.target.rename <id> <name>`       | 重命名 target                                        |
| `spark.target.features <id> [features]` | 设置 `festival scheduled proactive`、`all` 或 `none` |

Character target 的 features 可设置为 `festival`、`proactive` 或 `none`，不支持 `scheduled`。`spark.target.*` 需要管理员权限。

## XML 模式

XML 仅用于 ChatLuna 主链路。启用后可在 ChatLuna 预设中加入：

```text
你可以使用 Spark XML 标签创建未来任务，标签会在回复发送前移除。

<reminder time="时间">触发时要说的话或要做的事</reminder>
<follow-up time="时间">如果用户没有先回复，稍后继续的话题</follow-up>

time 支持：30s、5m、2h、1d、1w、14:30、2026-01-15 09:00。
正常回复可以同时包含自然语言和标签，不要只输出标签，也不要创建重复任务。
```

## 工作方式

1. ChatLuna 的单次任务和配置定时分别复用 Agent Trigger V2 内置的 `once` 与 `cron` 场景。
2. Spark 只按 Agent task ID 保存自动取消、来源和 target 等管理信息，不实现第二套调度逻辑。
3. Character 节日问候通过 Character 原生一次性 wake-up 执行，不建立第二套任务系统。
4. Character 主动聊天仅由 Spark 判断触发时机，实际回复复用 Character 的人格、历史、模型和发送流程。
5. Spark 每小时检查下一节日，并只更新带 Spark 标记的 Character wake-up。
6. 删除或停用 Character target 时，Spark 只清理对应节日任务，不影响用户创建的 Character 任务。
7. `follow_up` 在同一会话的创建者先发消息时自动取消。

## 升级说明

- 从 `0.4.2` 升级后，现有 target 会继续保留，并自动重建配置定时和节日任务。
- 旧版 `chatluna-spark` provider 任务会自动迁移到 Agent 内置的 `once` 或 `cron` 场景。
- `0.4.2` 创建的一次性提醒无法从旧 Agent 私有数据中可靠迁移，需要重新创建。
- 旧 target 没有 `engine` 字段时按 ChatLuna 处理。
- Character 节日问候和主动聊天需要使用 `spark.target.add --character [名称]` 单独加入。
- `1.5.0` 已有 Character target 不会自动开启主动聊天；使用 `spark.target.features <id> festival proactive` 手动启用。

## 开发验证

```sh
npm install
npm test
npm run audit:prod
```

`npm test` 包含类型检查、构建、单元测试和 npm 打包内容检查。

## 故障排查

- 没有 `spark.*` 命令：检查 Spark、ChatLuna 和 Agent 的版本及启动日志。
- 无法添加 Character target：确认 Character `0.0.230+` 已启用，且日志出现 `Spark Character integration attached`。
- Character 节日问候未触发：用 `spark.target.list` 检查 target、启用状态和 `festival` feature，并确认对应 Bot 在线。
- Character 主动聊天未触发：检查 `proactive.enabled`、target 的 `proactive` feature、空闲时长、休息时段和概率配置。
- ChatLuna 配置功能未触发：用 `spark.target.list` 检查 target、启用状态和 features。
- 平台发送失败：继续检查 Agent、Character、Bot 和平台适配器日志。

## 许可证

MIT License
