# koishi-plugin-chatluna-spark

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-spark?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chatluna-spark)

为 [ChatLuna](https://github.com/ChatLunaLab/chatluna) 添加主动对话能力的 Koishi 插件。让 AI 不再只是被动回复，而是能够主动与用户互动。

## 功能特性

- **定时提醒** - AI 可以设置提醒，在指定时间主动提醒用户
- **备忘录** - AI 记住用户提到的事情，在合适的时间主动提醒
- **主动聊天** - 当用户长时间不说话时，AI 会主动发起对话
- **节日问候** - 在节日当天自动发送祝福（支持农历节日）
- **定时任务** - 每天定时执行指定任务

## 安装

```bash
npm install koishi-plugin-chatluna-spark
```

或在 Koishi 插件市场搜索 `chatluna-spark` 安装。

## 前置要求

- [koishi-plugin-chatluna](https://github.com/ChatLunaLab/chatluna) - 必需
- [koishi-plugin-chatluna-character](https://github.com/ChatLunaLab/chatluna) - 可选，用于群聊角色扮演模式

## 预设配置

要让 AI 能够使用提醒功能，需要在 ChatLuna 预设中添加以下内容：

```
## 提醒与备忘功能

你可以使用 XML 标签来设置提醒。标签会被系统解析，不会显示给用户。

### 可用标签

1. `<reminder>` - 用户要求的提醒（到时间一定会触发）
2. `<memo>` - 你主动记住的事情（到时间一定会触发）
3. `<follow-up>` - 你想稍后继续聊（如果用户先说话则自动取消）

### 时间格式

- 相对时间：`30s`/`5m`/`2h`/`1d`/`1w`（秒/分/时/天/周）
- 绝对时间：`14:30` 或 `2024-01-15 09:00`

### 使用示例

用户说"30分钟后提醒我喝水"：
好的，我会提醒你的~<reminder time="30m">提醒用户喝水</reminder>

用户说"我下周一要考试"：
加油！我会提前提醒你复习的~<memo time="2024-01-14 20:00">提醒用户明天要考试，问问准备得怎么样</memo>

聊完天后你想稍后再找用户：
那我先不打扰你了~<follow-up time="2h">问问用户事情处理得怎么样了</follow-up>
```

## 用户命令

| 命令 | 说明 |
|------|------|
| `spark.my` | 查看我的待执行任务 |
| `spark.cancel <id>` | 取消指定任务 |
| `spark.admin.tasks` | 查看所有待执行任务（管理员） |
| `spark.admin.stats` | 查看任务统计（管理员） |
| `spark.admin.clean` | 清理已完成/取消的任务（管理员） |

## 标签详解

### `<reminder>` - 用户提醒

用户主动要求的提醒，到时间**一定会触发**。

```xml
<reminder time="30m">提醒用户喝水</reminder>
<reminder time="2024-01-15 09:00">提醒用户开会</reminder>
```

### `<memo>` - 备忘录

AI 主动记住用户提到的事情，到时间**一定会触发**。

```xml
<memo time="2024-01-14 20:00">提醒用户明天要考试</memo>
<memo time="1d">问问用户项目进展如何</memo>
```

### `<follow-up>` - 跟进聊天

AI 想稍后主动找用户聊天，如果用户先发消息则**自动取消**。

```xml
<follow-up time="2h">看看用户在做什么</follow-up>
<follow-up time="30m">继续之前的话题</follow-up>
```

## 工作原理

1. **标签解析** - 监听 AI 的回复，解析其中的 XML 标签
2. **任务创建** - 将解析出的标签转换为定时任务存入数据库
3. **标签移除** - 在发送给用户前移除 XML 标签
4. **任务执行** - 到达指定时间后，创建"影子会话"触发 AI 回复
5. **消息发送** - AI 的回复会自动发送给用户

## 支持的平台

- ChatLuna 房间模式（私聊/群聊）
- chatluna-character 角色扮演模式（群聊）

## 许可证

MIT License

## 相关链接

- [ChatLuna](https://github.com/ChatLunaLab/chatluna)
- [Koishi](https://koishi.chat)
