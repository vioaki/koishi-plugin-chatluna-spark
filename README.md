# koishi-plugin-chatluna-spark

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-spark?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chatluna-spark)

为 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 添加主动对话能力的 Koishi 插件。Spark 基于 `koishi-plugin-chatluna-agent` 的 Trigger 能力创建未来唤醒任务，让 AI 可以在合适的时间主动提醒、问候、跟进或继续对话。

## 功能特性

- **Tool 默认模式** - 注册 `spark_schedule` 工具，让模型用结构化工具创建提醒和跟进
- **XML 模式** - 解析 `<reminder>`、`<follow-up>` 标签，适合不使用 tool 的预设
- **主动触发** - AI 可以自行判断未来何时主动联系用户，不需要用户明确下达提醒命令
- **自动清理** - AI 通过 tool/XML 创建的一次性触发器成功执行后默认自动删除
- **目标白名单** - 节日祝福、固定定时任务、主动聊天只对显式注册的 target 生效
- **定时任务** - 对白名单 target 每天定时执行指定提示词
- **节日问候** - 每个 target 只保留一个节日任务，执行后自动滚动到下一个节日
- **主动聊天** - 白名单 target 长时间不说话时按概率主动发起对话

## 前置要求

- `koishi-plugin-chatluna` 1.4.0-alpha.40 或更高版本
- `koishi-plugin-chatluna-agent` 1.0.41 或更高版本

Spark `0.5.x` 只支持 ChatLuna Agent Trigger V2。Spark `0.4.2` 仅适用于仍使用旧 Trigger API 的环境，不能与 Agent `1.0.41+` 混用。

## 安装

在 Koishi 插件市场安装 `koishi-plugin-chatluna-spark`，或使用 npm：

```sh
npm install koishi-plugin-chatluna-spark
```

启用前请先确认 Koishi 中已启用 `database`、`chatluna` 和 `chatluna-agent` 服务。

## 快速使用

默认使用 `tool` 模式。安装并启用插件后，确认 ChatLuna Agent 的工具权限中允许 `spark_schedule`，模型即可通过工具创建未来触发器。

推荐在 ChatLuna 预设中补充：

```text
当你判断未来某个时间主动发起对话会有帮助时，使用 spark_schedule 工具；不需要等用户明确要求。比如用户说明天一整天课会很累，且你知道用户早上 8 点开始上课，可以主动设置早上 8 点的问候和加油。

type:
- reminder: 明确时间点的主动问候、提醒、关心、鼓励，或记住某件事并在明确时间主动提起。到时间后一定会触发。
- follow_up: 你想在一段时间后继续话题、确认进展或关心用户，但如果用户先发消息就不再需要主动打扰。用户先发消息会自动取消。

time 需要把自然语言时间转换为支持格式：30s、5m、2h、1d、1w、14:30、2026-01-15 09:00。
content 写到时间后希望你主动对用户说的话或要做的事。

不要为同一意图同时创建多个任务；不确定是否需要打扰用户时使用 follow_up，明确承诺提醒或必须触发时使用 reminder。
```

## 模式配置

`mode` 支持三种值：

| 模式   | 说明                                                                 |
| ------ | -------------------------------------------------------------------- |
| `tool` | 默认模式，只注册 `spark_schedule` 工具                               |
| `xml`  | 只解析 XML 标签，需要自行在预设中加入 XML 提示词                     |
| `both` | 同时启用 tool 和 XML，适合调试；不要让模型为同一意图同时使用两种方式 |

`autoDeleteExecutedAiTriggers` 默认开启。开启后，AI 通过 `spark_schedule` 或 XML 创建的一次性 Spark 触发器成功执行后会自动从 ChatLuna Agent Trigger 中删除；Agent WebUI 人工创建任务、节日祝福和配置定时任务不会受影响。

`timezone` 默认是 `Asia/Shanghai`，用于配置定时任务、Cron 和节日时间计算。可填写其他 IANA 时区，例如 `Asia/Tokyo`、`Europe/London`。

Spark 不再提供独立的“作用域”配置。需要限制插件在哪些会话生效时，使用 Koishi 自带的插件管理、权限、适配器配置，或 ChatLuna Agent 的工具权限。

## 主动目标

节日问候、固定定时任务、主动聊天只对已加入 target 的会话生效。

### 当前会话加入 target

```sh
spark.target.add [名称]
```

群聊默认加入整个群；只想绑定当前群内个人：

```sh
spark.target.add --personal [名称]
```

### 管理 target

| 命令                                    | 说明                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `spark.target.list`                     | 列出已注册 target                                                          |
| `spark.target.remove <id>`              | 删除 target                                                                |
| `spark.target.enable <id>`              | 启用 target                                                                |
| `spark.target.disable <id>`             | 停用 target                                                                |
| `spark.target.rename <id> <name>`       | 重命名 target                                                              |
| `spark.target.features <id> [features]` | 查看或设置 target 功能；可用 `festival scheduled proactive`、`all`、`none` |

`spark.target.*` 命令需要管理员权限。

`features` 控制 target 上启用哪些配置型主动功能，默认三项全开：`festival`、`scheduled`、`proactive`。关闭某个 feature 或停用 target 后，Spark 会在重载/同步时禁用对应的配置型 Agent Trigger 任务。

提醒、配置定时任务和节日问候统一使用 Trigger V2 provider `chatluna-spark`。每个启用 `festival` feature 的 target 只保留一个节日任务，任务执行后会滚动到下一个内置或自定义节日。

## XML 模式提示词

如果 `mode` 设置为 `xml`，模型不会自动知道 Spark 标签，需要在 ChatLuna 预设中加入提示词。可直接使用：

```text
你可以使用 Spark XML 标签创建未来的主动对话任务。标签会被系统解析并在发送给用户前移除。

当你判断未来某个时间主动发起对话会有帮助时，可以自行创建任务，不需要等用户明确要求。比如用户说明天一整天课会很累，且你知道用户早上 8 点开始上课，可以主动设置早上 8 点的问候和加油。

可用标签：
<reminder time="时间">到时间后要主动对用户说的话或要做的事</reminder>
<follow-up time="时间">稍后可选跟进的话题；如果用户先发消息则自动取消</follow-up>

reminder 用于明确时间点的主动问候、提醒、关心、鼓励，或记住某件事并在明确时间主动提起。到时间后一定会触发。
follow-up 用于不确定是否还需要打扰用户的后续跟进；如果用户在同一会话先发消息，则自动取消。

time 需要写成支持格式：30s、5m、2h、1d、1w、14:30、2026-01-15 09:00。
content 写到时间后希望你主动对用户说的话或要做的事。

正常回复用户时可以同时包含自然语言和 XML 标签；不要只输出 XML 标签。
不要为同一意图同时创建多个任务。
```

示例：

```xml
好，明早上课前给你打气。
<reminder time="08:00">给用户发送早八上课前的问候和加油</reminder>

我稍后再来问问进展。
<follow-up time="2h">问问用户事情处理得怎么样了</follow-up>
```

## ChatLuna Character

Spark `0.5.0` 只接入 ChatLuna 主链路，不向 Character 提供 `spark_schedule`。Character 场景请使用 Character 内置的 `wake_up_reply_*` 配置和空闲触发能力。

不要在 Character 会话中依赖 Spark 创建提醒或跟进；Character 专用执行引擎不属于本版本。

## 用户命令

| 命令                | 说明                             |
| ------------------- | -------------------------------- |
| `spark.list`        | 查看当前用户的 Spark 任务        |
| `spark.cancel <id>` | 取消指定 Spark 任务              |
| `spark.fire <id>`   | 立即触发指定 Spark 任务          |
| `spark.stats`       | 查看 Spark 任务统计（管理员）    |
| `spark.target.*`    | 管理配置型主动功能 target 白名单 |

## 工作原理

1. Tool 或 XML 产生 Spark 任务意图
2. Spark 将任务转换为 Trigger V2 `chatluna-spark` provider 任务
3. Agent Trigger 负责定时、唤醒、会话解析、渲染和发送
4. `follow_up` 在用户先发消息时自动取消
5. tool/XML 创建的一次性 AI 触发器成功执行后默认自动删除
6. 固定定时任务按 target 白名单同步为 provider `cron` 模式任务
7. 节日问候按 target 白名单同步为 provider `festival` 模式任务，每个 target 只保留一个
8. Spark 会周期性滚动已完成、异常或明显过期的节日任务
9. 主动聊天只记录白名单 target 的沉默状态，并使用注册 target 的 routing 唤醒

## 项目结构

- `src/` 是唯一手写源码目录。
- `lib/` 是 TypeScript 构建产物，不手工编辑；发布前由 `prepack` 自动生成。
- `tests/` 使用 Node 内置 test runner，覆盖时间解析、XML/tool 创建、target 同步、节日 provider、定时任务、主动聊天和发布元数据。

核心模块：

- `src/service/trigger_adapter.ts`：Spark 到 ChatLuna Agent Trigger 的适配层，负责创建任务、唤醒、自动取消和执行后清理。
- `src/service/trigger_provider.ts`：Trigger V2 scheduled extension provider，统一计算 once、cron 和 festival 的下次执行时间。
- `src/service/targets.ts`：配置型主动能力的 target 白名单、路由和 feature 合并。
- `src/triggers/`：scheduled、festival、proactive 三类配置型主动能力。
- `src/parser/tag_parser.ts` 和 `src/tool/spark_schedule.ts`：XML 与 tool 两个任务创建入口。

## 开发与验证

```sh
npm install
npm run typecheck
npm run test:unit
npm run test:package
npm test
```

`npm test` 会执行类型检查、构建、单元测试和发布包 dry-run。`npm pack --dry-run --json` 预期只包含 `lib/**`、`README.md`、`LICENSE` 和 `package.json` 等 npm 必需元数据，不应包含 `src/`、`tests/`、本地联调目录或环境文件。

## 故障排查

- `spark_schedule` 没有被模型调用：确认 ChatLuna Agent 工具权限允许 `spark_schedule`，并在预设中说明何时使用该工具。
- 配置型节日/定时/主动聊天没有触发：先用 `spark.target.list` 确认目标会话已经注册并启用对应 feature。
- `follow_up` 被取消：这是预期行为。用户在同一会话先发消息时，Spark 会删除尚未触发的 follow-up 任务。
- Trigger 到点后发送失败：Spark 只负责创建和同步 Agent Trigger 任务，实际发送由 ChatLuna Agent 和适配器完成；请同时检查 Agent Trigger 任务状态、Bot 在线状态和目标平台适配器日志。

## 从 0.4.2 升级

- 升级 ChatLuna Agent 到 `1.0.41+` 后再安装 Spark `0.5.x`。
- 节日问候和插件配置中的定时任务会根据现有 Spark target 自动重建。
- Spark 不读取或修改 Agent 私有数据库表。
- `0.4.2` 创建的一次性提醒和跟进无法可靠迁移，需要重新创建。

## 许可证

MIT License
