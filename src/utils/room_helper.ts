import { Context } from 'koishi'

export interface RoomInfo {
  roomId: number
  roomName: string
  room: any
  userId: string
  channelId: string
}

export class RoomHelper {
  constructor(private ctx: Context) {}

  /**
   * 获取所有房间，并正确构造 channelId
   */
  async getAllRooms(): Promise<RoomInfo[]> {
    try {
      const rooms = await this.ctx.database.get('chathub_room', {})
      const roomInfos: RoomInfo[] = []

      for (const room of rooms) {
        try {
          const users = await this.ctx.database.get('chathub_user', {
            defaultRoomId: room.roomId
          })

          if (users.length === 0) continue

          const user = users[0]
          const isPrivate = user.groupId === '0'

          let channelId: string

          if (isPrivate) {
            // 私聊：需要查询 binding 确定平台
            const bindings = await this.ctx.database.get('binding', {
              pid: user.userId
            })

            if (bindings.length === 0) {
              continue
            }

            const platform = bindings[0].platform

            if (platform === 'onebot') {
              // OneBot 私聊：必须用 private: 前缀
              channelId = `private:${user.userId}`
            } else {
              // 其他平台（sandbox）：直接用 userId
              channelId = user.userId
            }
          } else {
            // 群聊：直接用 groupId
            channelId = user.groupId
          }

          roomInfos.push({
            roomId: room.roomId,
            roomName: room.roomName,
            room,
            userId: user.userId,
            channelId
          })
        } catch (err) {
          // 静默处理单个房间的错误
        }
      }

      return roomInfos

    } catch (err) {
      this.ctx.logger('spark').error('Failed to get rooms:', err)
      return []
    }
  }
}
