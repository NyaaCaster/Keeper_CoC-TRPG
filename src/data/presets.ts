import { CharacterSheet } from "../types";

export const TEMPLATE_PRESETS: (CharacterSheet & { backgroundText?: string })[] = [
  // ==================== 1920s INVESTIGATORS (10) ====================
  {
    name: "阿尔伯特·克劳利 (Albert Crowley)",
    occupation: "1920s 秘术典籍研究员",
    gender: "男",
    age: 38,
    background: "1920s",
    attributes: { str: 45, con: 50, siz: 55, dex: 60, app: 50, int: 85, pow: 75, edu: 80, luck: 65 },
    skills: { "神秘学": 75, "图书馆使用": 80, "历史": 70, "聆听": 60, "拉丁语": 65, "侦查": 50, "说服": 45 },
    hp: 10, maxHp: 10, mp: 15, maxMp: 15, san: 75, maxSan: 75, maxSanLimit: 99, mythos: 0,
    backgroundText: "毕业于波士顿大学，毕生致力于译解中世纪遗留的禁忌手稿。性格孤僻，但在整理古籍疑点上无人能出其右。"
  },
  {
    name: "塞西莉亚·凡·德·贝尔 (Cecilia)",
    occupation: "1920s 时钟塔炼金术侍从",
    gender: "女",
    age: 24,
    background: "1920s",
    attributes: { str: 50, con: 60, siz: 45, dex: 70, app: 75, int: 80, pow: 80, edu: 75, luck: 55 },
    skills: { "神秘学": 70, "医学": 60, "侦查": 65, "聆听": 55, "化学": 65, "心理学": 50, "博物学": 45 },
    hp: 10, maxHp: 10, mp: 16, maxMp: 16, san: 80, maxSan: 80, maxSanLimit: 99, mythos: 0,
    backgroundText: "来自时钟塔矿石科的年轻见习魔术师，由于其家族传承的某些熔炼秘仪，对异常矿石及能量具有极度灵敏的感知力。"
  },
  {
    name: "托马斯·莫里亚蒂 (Thomas)",
    occupation: "1920s 伦敦世俗私家侦探",
    gender: "男",
    age: 42,
    background: "1920s",
    attributes: { str: 65, con: 55, siz: 60, dex: 65, app: 55, int: 75, pow: 60, edu: 70, luck: 50 },
    skills: { "侦查": 80, "法律": 55, "心理学": 70, "聆听": 65, "手枪": 60, "斗殴": 55, "乔装": 45 },
    hp: 11, maxHp: 11, mp: 12, maxMp: 12, san: 60, maxSan: 60, maxSanLimit: 99, mythos: 0,
    backgroundText: "前苏格兰场重案组资深警探，因不愿向上级腐败妥协而自立门户。他敏锐的双眼能轻易从黑暗的陋巷中辨识出危险谎言。"
  },
  {
    name: "海伦娜·勃兰特上尉 (Helena)",
    occupation: "1920s 圣堂教会调查代行者",
    gender: "女",
    age: 29,
    background: "1920s",
    attributes: { str: 70, con: 65, siz: 55, dex: 75, app: 60, int: 70, pow: 80, edu: 65, luck: 45 },
    skills: { "斗殴": 70, "闪避": 65, "神秘学": 60, "急救": 55, "意志力": 70, "潜行": 60, "聆听": 50 },
    hp: 12, maxHp: 12, mp: 16, maxMp: 16, san: 80, maxSan: 80, maxSanLimit: 99, mythos: 0,
    backgroundText: "隶属于圣堂教会异端审问处的精锐代行者。她游历欧洲各地的古老荒原、废弃礼拜堂，行使带有秘仪刻印的裁决。"
  },
  {
    name: "亚瑟·彭德尔顿 (Arthur)",
    occupation: "1920s 古董名器鉴赏商",
    gender: "男",
    age: 48,
    background: "1920s",
    attributes: { str: 50, con: 50, siz: 65, dex: 50, app: 65, int: 80, pow: 65, edu: 85, luck: 75 },
    skills: { "估价": 85, "历史": 75, "图书馆使用": 65, "说服": 70, "魅惑": 60, "聆听": 50, "艺术/手艺(古玩)": 60 },
    hp: 10, maxHp: 10, mp: 13, maxMp: 13, san: 65, maxSan: 65, maxSanLimit: 99, mythos: 0,
    backgroundText: "经营伦敦数家古董铺，对苏美尔及古埃及遗物有近乎痴迷的触觉。声称多次在濒死的噩梦中，听过某些远古青铜器的低语。"
  },
  {
    name: "莉莉安·卡特 (Lillian)",
    occupation: "1920s 孤胆战地无畏记者",
    gender: "女",
    age: 27,
    background: "1920s",
    attributes: { str: 55, con: 65, siz: 50, dex: 70, app: 80, int: 75, pow: 70, edu: 70, luck: 60 },
    skills: { "摄影": 75, "侦查": 70, "敏捷": 65, "聆听": 60, "说服": 65, "话术": 55, "骑乘": 40 },
    hp: 11, maxHp: 11, mp: 14, maxMp: 14, san: 70, maxSan: 70, maxSanLimit: 99, mythos: 0,
    backgroundText: "曾在欧战前线拍摄战况的传奇女记者，极其大胆，惯于深入常人规避的暴乱隔离区、异端聚会点，以此撰写震惊世人的揭秘报道。"
  },
  {
    name: "乔治·麦卡利斯特 (George)",
    occupation: "1920s 极地地质学探险家",
    gender: "男",
    age: 35,
    background: "1920s",
    attributes: { str: 75, con: 80, siz: 70, dex: 55, app: 45, int: 65, pow: 65, edu: 70, luck: 50 },
    skills: { "博物学": 75, "攀爬": 70, "导航": 65, "生存(极地)": 75, "重型武器": 50, "急救": 55, "侦查": 50 },
    hp: 15, maxHp: 15, mp: 13, maxMp: 13, san: 65, maxSan: 65, maxSanLimit: 99, mythos: 0,
    backgroundText: "数次踏足格陵兰封冻高原的硬汉探险家。具有难以磨灭的顽强体魄，声称曾在北极圈深处目睹过泛着诡异绿光的非自然无名石构。"
  },
  {
    name: "哈里森·格雷 (Harrison)",
    occupation: "1920s 异乡世袭老练猎手",
    gender: "男",
    age: 40,
    background: "1920s",
    attributes: { str: 70, con: 75, siz: 60, dex: 65, app: 50, int: 70, pow: 60, edu: 55, luck: 65 },
    skills: { "步枪/霰弹枪": 80, "追踪": 70, "潜行": 75, "博物学": 60, "聆听": 65, "侦查": 60, "闪避": 50 },
    hp: 13, maxHp: 13, mp: 12, maxMp: 12, san: 60, maxSan: 60, maxSanLimit: 99, mythos: 0,
    backgroundText: "居住在阿卡姆郊外森林深处的独立猎户。习惯在风暴来临的荒野里追踪凶猛的野兽，对超自然的捕食行为有着独树一帜的猎手直觉。"
  },
  {
    name: "克拉拉·阿什顿 (Clara)",
    occupation: "1920s 密大民俗学女讲师",
    gender: "女",
    age: 31,
    background: "1920s",
    attributes: { str: 40, con: 55, siz: 50, dex: 60, app: 70, int: 80, pow: 75, edu: 80, luck: 60 },
    skills: { "历史": 80, "神秘学": 75, "人类学": 70, "图书馆使用": 75, "聆听": 60, "心理学": 60, "其他语言(凯尔特语)": 50 },
    hp: 10, maxHp: 10, mp: 15, maxMp: 15, san: 75, maxSan: 75, maxSanLimit: 99, mythos: 0,
    backgroundText: "任职于密斯卡托尼克大学。专注于研究新英格兰沿海渔村（如印斯茅斯）失落的异端邪说以及当地被严密封锁的禁忌巫歌。"
  },
  {
    name: "理查德·弗利特伍德 (Richard)",
    occupation: "1920s 退役皇家空军上尉",
    gender: "男",
    age: 33,
    background: "1920s",
    attributes: { str: 65, con: 65, siz: 65, dex: 70, app: 60, int: 70, pow: 65, edu: 65, luck: 55 },
    skills: { "驾驶(飞机)": 80, "机械维修": 70, "手枪": 65, "导航": 65, "聆听": 50, "侦查": 55, "闪避": 55 },
    hp: 13, maxHp: 13, mp: 13, maxMp: 13, san: 65, maxSan: 65, maxSanLimit: 99, mythos: 0,
    backgroundText: "在一战中击落过多架敌机的功勋空军军官，战后被聘在荒废岛屿航线间担任长途货运机手。由于高空飞行经历，时常感到星空处于扭曲活动。"
  },

  // ==================== MODERN NEON AGE INVESTIGATORS (10) ====================
  {
    name: "加百列·修 (Gabriel)",
    occupation: "Modern 基金会外勤收容专家",
    gender: "男",
    age: 34,
    background: "modern",
    attributes: { str: 75, con: 70, siz: 60, dex: 70, app: 50, int: 75, pow: 70, edu: 75, luck: 55 },
    skills: { "侦查": 75, "手枪": 70, "计算机使用": 60, "心理学": 65, "急救": 55, "潜行": 60, "神秘学": 45 },
    hp: 13, maxHp: 13, mp: 14, maxMp: 14, san: 70, maxSan: 70, maxSanLimit: 99, mythos: 0,
    backgroundText: "SCP 基金会外勤特工，数次带队处理具有现实扭曲特性的级度失效事件。其冷血、高密度意志与冷静的火力排布受到高度评价。"
  },
  {
    name: "尤利娅·阿尼西莫娃",
    occupation: "Modern 圣堂教会社外行刑代行者",
    gender: "女",
    age: 28,
    background: "modern",
    attributes: { str: 70, con: 65, siz: 55, dex: 80, app: 70, int: 70, pow: 80, edu: 65, luck: 50 },
    skills: { "斗殴": 80, "闪避": 75, "神秘学": 65, "潜行": 70, "追踪": 60, "聆听": 55, "急救": 45 },
    hp: 12, maxHp: 12, mp: 16, maxMp: 16, san: 80, maxSan: 80, maxSanLimit: 99, mythos: 0,
    backgroundText: "常驻东欧的审问处代行者，拥有极高段位的格斗本领和魔术刻印。日常擅于利用现代战术伪装，将星之精或畸变异能斩杀于阴影角落。"
  },
  {
    name: "Dr. 洛兰·温彻斯特 (Lorraine)",
    occupation: "Modern 时钟塔魔眼收集学教授",
    gender: "女",
    age: 45,
    background: "modern",
    attributes: { str: 40, con: 55, siz: 50, dex: 60, app: 65, int: 85, pow: 75, edu: 90, luck: 60 },
    skills: { "神秘学": 85, "图书馆使用": 80, "医学": 70, "计算机使用": 55, "历史": 75, "侦查": 60, "说服": 50 },
    hp: 10, maxHp: 10, mp: 15, maxMp: 15, san: 75, maxSan: 75, maxSanLimit: 99, mythos: 0,
    backgroundText: "伦敦魔术协会时钟塔的高级讲师，对人体异常变异与特定灵魂能量折射产生的‘魔眼’颇有渊源，专门赴亚洲回收异态诅咒透核。"
  },
  {
    name: "高远健太郎 (Takato)",
    occupation: "Modern 极端民俗网络都市传说黑客",
    gender: "男",
    age: 25,
    background: "modern",
    attributes: { str: 50, con: 60, siz: 55, dex: 65, app: 60, int: 80, pow: 65, edu: 75, luck: 70 },
    skills: { "计算机使用": 85, "电子学": 75, "图书馆使用": 70, "侦查": 65, "神秘学": 50, "聆听": 60, "乔装": 45 },
    hp: 11, maxHp: 11, mp: 13, maxMp: 13, san: 65, maxSan: 65, maxSanLimit: 99, mythos: 0,
    backgroundText: "在地下暗网化名‘Labyrinth’的极端极客。热衷于在各大深网追踪绝密档案、都市死亡直播和不知出处的诡异代码。极高智商。"
  },
  {
    name: "雷恩·麦克唐纳 (Ryan)",
    occupation: "Modern 重装城市特警谈判专家",
    gender: "男",
    age: 39,
    background: "modern",
    attributes: { str: 65, con: 70, siz: 65, dex: 60, app: 55, int: 75, pow: 70, edu: 70, luck: 50 },
    skills: { "说服": 80, "心理学": 75, "聆听": 70, "手枪": 60, "法律": 55, "侦查": 50, "斗殴": 50 },
    hp: 13, maxHp: 13, mp: 14, maxMp: 14, san: 70, maxSan: 70, maxSanLimit: 99, mythos: 0,
    backgroundText: "原洛杉矶警局（LAPD）首席危机谈判专家。在数起离奇极端的人质挟持事件中扮演调解人，对狂躁症和群体惊恐有极强的抚慰手段。"
  },
  {
    name: "艾达·王 (Ada)",
    occupation: "Modern 跨国科技巨头商业保镖",
    gender: "女",
    age: 26,
    background: "modern",
    attributes: { str: 70, con: 60, siz: 50, dex: 80, app: 85, int: 70, pow: 65, edu: 65, luck: 60 },
    skills: { "斗殴": 75, "闪避": 80, "手枪": 70, "潜行": 75, "开锁": 60, "攀爬": 50, "乔装": 50 },
    hp: 11, maxHp: 11, mp: 13, maxMp: 13, san: 65, maxSan: 65, maxSanLimit: 99, mythos: 0,
    backgroundText: "为生化研究跨国财团处理敏感财产的核心现场安全特工。身手极为敏捷矯健，擅长破坏和隐秘捕获非自然基因污染样本。"
  },
  {
    name: "苏子明 (Su Ziming)",
    occupation: "Modern 中医脉象超心理学异士",
    gender: "男",
    age: 44,
    background: "modern",
    attributes: { str: 45, con: 55, siz: 50, dex: 55, app: 60, int: 80, pow: 80, edu: 80, luck: 65 },
    skills: { "心理学": 80, "医学": 75, "神秘学": 70, "聆听": 65, "博物学": 60, "急救": 55, "历史": 50 },
    hp: 10, maxHp: 10, mp: 16, maxMp: 16, san: 80, maxSan: 80, maxSanLimit: 99, mythos: 0,
    backgroundText: "精熟传统经脉之学，深层专研‘异质脑电波与恶劣诅咒现象交互研究’。其独到的诊脉秘术时能识破人体是否遭到外神寄生寄托。"
  },
  {
    name: "维克托·凯因 (Victor)",
    occupation: "Modern 前现场拆爆反爆专家",
    gender: "男",
    age: 36,
    background: "modern",
    attributes: { str: 60, con: 65, siz: 60, dex: 70, app: 50, int: 75, pow: 60, edu: 70, luck: 55 },
    skills: { "物理": 75, "化学": 70, "机械维修": 80, "重型武器": 60, "侦查": 55, "电子学": 65, "手枪": 45 },
    hp: 12, maxHp: 12, mp: 12, maxMp: 12, san: 60, maxSan: 60, maxSanLimit: 99, mythos: 0,
    backgroundText: "退役的国防排危先锋。拥有令人汗颜的超高现场排爆能力，只要有他在场，即便面对难以解读的血肉邪能符文引线也能冷静剪断。"
  },
  {
    name: "沈秋意 (Shen Qiuyi)",
    occupation: "Modern 现场法医学重案病理顾问",
    gender: "女",
    age: 32,
    background: "modern",
    attributes: { str: 40, con: 60, siz: 50, dex: 65, app: 70, int: 85, pow: 70, edu: 85, luck: 60 },
    skills: { "医学": 80, "法医学": 85, "科学(生物学)": 75, "图书馆使用": 60, "侦查": 65, "心理学": 55, "手枪": 25 },
    hp: 11, maxHp: 11, mp: 14, maxMp: 14, san: 70, maxSan: 70, maxSanLimit: 99, mythos: 0,
    backgroundText: "极其冷静、对死者遗骸抱持崇高敬意的首席法医学主检官。能仅凭尸体组织变质的异常肌理，推导出生前对视过的星空图谱形状。"
  },
  {
    name: "林渊 (Lin Yuan)",
    occupation: "Modern 迷途深水海洋地质地壳专家",
    gender: "男",
    age: 41,
    background: "modern",
    attributes: { str: 65, con: 70, siz: 65, dex: 55, app: 45, int: 75, pow: 75, edu: 80, luck: 55 },
    skills: { "博物学": 75, "游泳": 70, "导航": 65, "物理": 60, "心理学": 50, "侦查": 55, "重型武器": 40 },
    hp: 13, maxHp: 13, mp: 15, maxMp: 15, san: 75, maxSan: 75, maxSanLimit: 99, mythos: 0,
    backgroundText: "远洋深水重潜地质考察员。曾参与马里亚纳海沟异常断层搜捕。深信海底两万米以下盘踞着某些超越人类重力认知的无机生命大块物。"
  }
];
