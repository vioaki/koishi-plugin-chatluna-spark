export interface Festival {
    name: string;
    date: string;
    time: string;
    description: string;
    category: 'solar-term' | 'traditional' | 'modern' | 'western';
}
/**
 * 获取指定年份的农历节日公历日期
 */
export declare function getLunarFestivalDate(festivalName: string, year: number): string | null;
/**
 * 获取当年的节日列表（动态计算农历节日日期）
 */
export declare function getFestivalsForYear(year: number): Festival[];
/**
 * 兼容旧版：导出静态节日列表（使用当前年份）
 */
export declare const BUILTIN_FESTIVALS: Festival[];
