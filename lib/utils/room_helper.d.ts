import { Context } from 'koishi';
export interface RoomInfo {
    roomId: number;
    roomName: string;
    room: any;
    userId: string;
    channelId: string;
}
export declare class RoomHelper {
    private ctx;
    constructor(ctx: Context);
    /**
     * 获取所有房间，并正确构造 channelId
     */
    getAllRooms(): Promise<RoomInfo[]>;
}
