"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_FESTIVALS = void 0;
exports.getLunarFestivalDate = getLunarFestivalDate;
exports.getFestivalsForYear = getFestivalsForYear;
/**
 * 农历节日对应的公历日期（按年份）
 * 数据来源：天文台计算
 */
const LUNAR_FESTIVAL_DATES = {
    2025: {
        '春节': '01-29',
        '元宵节': '02-12',
        '端午节': '05-31',
        '七夕节': '08-29',
        '中秋节': '10-06',
        '重阳节': '10-29',
        '腊八节': '01-07', // 2025年腊八是2025-01-07
        '除夕': '01-28' // 2025年除夕是2025-01-28
    },
    2026: {
        '春节': '02-17',
        '元宵节': '03-03',
        '端午节': '06-19',
        '七夕节': '08-19',
        '中秋节': '09-25',
        '重阳节': '10-18',
        '腊八节': '12-26', // 2026年腊八是2026-12-26（农历2026年腊月初八）
        '除夕': '02-16' // 2026年除夕是2026-02-16
    },
    2027: {
        '春节': '02-06',
        '元宵节': '02-20',
        '端午节': '06-08',
        '七夕节': '08-08',
        '中秋节': '09-15',
        '重阳节': '10-08',
        '腊八节': '01-15',
        '除夕': '02-05'
    },
    2028: {
        '春节': '01-26',
        '元宵节': '02-09',
        '端午节': '05-28',
        '七夕节': '08-26',
        '中秋节': '10-03',
        '重阳节': '10-26',
        '腊八节': '01-05',
        '除夕': '01-25'
    },
    2029: {
        '春节': '02-13',
        '元宵节': '02-27',
        '端午节': '06-16',
        '七夕节': '08-16',
        '中秋节': '09-22',
        '重阳节': '10-15',
        '腊八节': '12-25',
        '除夕': '02-12'
    },
    2030: {
        '春节': '02-03',
        '元宵节': '02-17',
        '端午节': '06-05',
        '七夕节': '08-05',
        '中秋节': '09-12',
        '重阳节': '10-05',
        '腊八节': '01-13',
        '除夕': '02-02'
    }
};
/**
 * 感恩节日期（11月第四个周四）
 */
function getThanksgivingDate(year) {
    // 找到11月第一天
    const nov1 = new Date(year, 10, 1);
    // 找到第一个周四
    let firstThursday = 1 + ((4 - nov1.getDay() + 7) % 7);
    // 第四个周四
    const fourthThursday = firstThursday + 21;
    return `11-${fourthThursday.toString().padStart(2, '0')}`;
}
/**
 * 获取指定年份的农历节日公历日期
 */
function getLunarFestivalDate(festivalName, year) {
    const yearData = LUNAR_FESTIVAL_DATES[year];
    if (yearData && yearData[festivalName]) {
        return yearData[festivalName];
    }
    return null;
}
/**
 * 获取当年的节日列表（动态计算农历节日日期）
 */
function getFestivalsForYear(year) {
    const festivals = [];
    // 24节气（公历日期基本固定，误差1-2天）
    const solarTerms = [
        { name: '立春', date: '02-04', time: '09:00', description: '春季的开始，万物复苏', category: 'solar-term' },
        { name: '雨水', date: '02-19', time: '09:00', description: '降雨开始，雨量渐增', category: 'solar-term' },
        { name: '惊蛰', date: '03-06', time: '09:00', description: '春雷乍动，惊醒蛰虫', category: 'solar-term' },
        { name: '春分', date: '03-21', time: '09:00', description: '昼夜平分，春意正浓', category: 'solar-term' },
        { name: '清明', date: '04-05', time: '09:00', description: '天清地明，踏青祭祖', category: 'solar-term' },
        { name: '谷雨', date: '04-20', time: '09:00', description: '雨生百谷，春季最后一个节气', category: 'solar-term' },
        { name: '立夏', date: '05-06', time: '09:00', description: '夏季开始，万物繁茂', category: 'solar-term' },
        { name: '小满', date: '05-21', time: '09:00', description: '麦粒渐满，夏熟作物籽粒开始饱满', category: 'solar-term' },
        { name: '芒种', date: '06-06', time: '09:00', description: '有芒作物成熟，农事繁忙', category: 'solar-term' },
        { name: '夏至', date: '06-21', time: '09:00', description: '白昼最长，盛夏来临', category: 'solar-term' },
        { name: '小暑', date: '07-07', time: '09:00', description: '天气开始炎热', category: 'solar-term' },
        { name: '大暑', date: '07-23', time: '09:00', description: '一年中最热的时期', category: 'solar-term' },
        { name: '立秋', date: '08-08', time: '09:00', description: '秋季开始，暑去凉来', category: 'solar-term' },
        { name: '处暑', date: '08-23', time: '09:00', description: '炎热终止，暑气渐消', category: 'solar-term' },
        { name: '白露', date: '09-08', time: '09:00', description: '天气转凉，露凝而白', category: 'solar-term' },
        { name: '秋分', date: '09-23', time: '09:00', description: '昼夜平分，秋意渐浓', category: 'solar-term' },
        { name: '寒露', date: '10-08', time: '09:00', description: '气温更低，露水更凉', category: 'solar-term' },
        { name: '霜降', date: '10-23', time: '09:00', description: '天气渐冷，开始降霜', category: 'solar-term' },
        { name: '立冬', date: '11-08', time: '09:00', description: '冬季开始，万物收藏', category: 'solar-term' },
        { name: '小雪', date: '11-22', time: '09:00', description: '开始降雪，但雪量不大', category: 'solar-term' },
        { name: '大雪', date: '12-07', time: '09:00', description: '降雪量增多，地面积雪', category: 'solar-term' },
        { name: '冬至', date: '12-22', time: '09:00', description: '白昼最短，数九寒天开始', category: 'solar-term' },
        { name: '小寒', date: '01-06', time: '09:00', description: '天气寒冷，但还未到极点', category: 'solar-term' },
        { name: '大寒', date: '01-20', time: '09:00', description: '一年中最冷的时期', category: 'solar-term' }
    ];
    festivals.push(...solarTerms);
    // 农历节日（动态获取公历日期）
    const lunarFestivals = [
        { name: '春节', time: '00:00', description: '农历新年，阖家团圆' },
        { name: '元宵节', time: '09:00', description: '赏花灯，猜灯谜' },
        { name: '端午节', time: '09:00', description: '纪念屈原，吃粽子赛龙舟' },
        { name: '七夕节', time: '09:00', description: '中国情人节，牛郎织女相会' },
        { name: '中秋节', time: '09:00', description: '月圆人团圆，赏月吃月饼' },
        { name: '重阳节', time: '09:00', description: '登高望远，敬老孝亲' },
        { name: '腊八节', time: '09:00', description: '喝腊八粥，腊月初八' },
        { name: '除夕', time: '18:00', description: '年终岁末，守岁迎新' }
    ];
    for (const festival of lunarFestivals) {
        const date = getLunarFestivalDate(festival.name, year);
        if (date) {
            festivals.push({
                name: festival.name,
                date,
                time: festival.time,
                description: festival.description,
                category: 'traditional'
            });
        }
    }
    // 现代节日（公历固定日期）
    const modernFestivals = [
        { name: '元旦', date: '01-01', time: '00:00', description: '新年第一天，辞旧迎新', category: 'modern' },
        { name: '情人节', date: '02-14', time: '09:00', description: '浪漫的一天，表达爱意', category: 'modern' },
        { name: '妇女节', date: '03-08', time: '09:00', description: '国际妇女节，致敬女性', category: 'modern' },
        { name: '植树节', date: '03-12', time: '09:00', description: '种下希望，绿化环境', category: 'modern' },
        { name: '愚人节', date: '04-01', time: '09:00', description: '幽默玩笑的一天', category: 'modern' },
        { name: '劳动节', date: '05-01', time: '09:00', description: '向劳动者致敬', category: 'modern' },
        { name: '青年节', date: '05-04', time: '09:00', description: '五四运动纪念日', category: 'modern' },
        { name: '儿童节', date: '06-01', time: '09:00', description: '孩子们的快乐节日', category: 'modern' },
        { name: '建党节', date: '07-01', time: '09:00', description: '中国共产党建党纪念日', category: 'modern' },
        { name: '建军节', date: '08-01', time: '09:00', description: '中国人民解放军建军纪念日', category: 'modern' },
        { name: '教师节', date: '09-10', time: '09:00', description: '感恩师恩，尊师重教', category: 'modern' },
        { name: '国庆节', date: '10-01', time: '00:00', description: '中华人民共和国成立纪念日', category: 'modern' }
    ];
    festivals.push(...modernFestivals);
    // 西方节日
    const westernFestivals = [
        { name: '万圣节', date: '10-31', time: '18:00', description: '南瓜灯和糖果的夜晚', category: 'western' },
        { name: '感恩节', date: getThanksgivingDate(year), time: '09:00', description: '感恩相聚，火鸡大餐', category: 'western' },
        { name: '平安夜', date: '12-24', time: '18:00', description: '圣诞前夜，温馨祥和', category: 'western' },
        { name: '圣诞节', date: '12-25', time: '00:00', description: '圣诞快乐，礼物和欢笑', category: 'western' },
        { name: '跨年夜', date: '12-31', time: '23:00', description: '告别旧年，迎接新年', category: 'western' }
    ];
    festivals.push(...westernFestivals);
    return festivals;
}
/**
 * 兼容旧版：导出静态节日列表（使用当前年份）
 */
exports.BUILTIN_FESTIVALS = getFestivalsForYear(new Date().getFullYear());
