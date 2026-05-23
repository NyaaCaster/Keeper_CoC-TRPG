# CoC 7e 武器表

记录本项目自定义角色卡装备槽用的标准武器清单。**按口径合并版**（B 方案）：保留汤普森 / 雷明顿 / 格洛克 / AK-47 等经典具名条目，其余按口径 / 用途归并，使单表条数控制在 ~30 行。

> 时间起点：2026-05-23
> 数据落地目标：`src/data/cocWeapons.ts`，单 `WEAPON_REGISTRY_ALL` + `getWeaponList(era)`。
> 卡片接入：`InventoryEntry.kind === "weapon"` 通过 `weaponId` 引用本表（详见 `.docs/character-card-current.md` 第 5.3 节）。

---

## 一、字段定义与口径约定

每条武器固定 8 列：

| 列 | 含义 | 取值示例 |
|---|---|---|
| `id` | 主键，`<slug>`，跨时代唯一 | `fist`、`thompson-smg`、`glock17` |
| `nameZh` | 中文显示名 | `拳头`、`汤普森冲锋枪`、`格洛克 17` |
| `nameEn` | 英文备注 | `Fist/Punch`、`Thompson SMG`、`Glock 17` |
| `era` | 时代标签 | `any` / `1920s` / `modern` |
| `skill` | 关联技能 | `格斗(斗殴)` / `火器(手枪)` / `火器(步枪/散弹)` / `火器(冲锋枪)` / `火器(重武器)` / `投掷` |
| `damage` | 伤害骰 + DB 加成口径 | `1D3 + DB`（近战）/ `1D10`（火器）/ `1D8 + ½DB`（投掷） |
| `range` | 射程 | 近战 = `触及`；火器 = 米数（`15m`）；投掷 = `STR×N米` |
| `attacks` | 每轮攻击次数 | `1` / `2` / `1(3)` 表示连发 / `1/2` 表示两轮一发 |
| `maxAmmo` | 装弹数（创建期固定） | 近战 / 投掷 = `0`；左轮 6；半自动 7~17；步枪 5~30 |
| `malfunction` | 故障值（命中骰 ≥ 此值卡壳，可省略） | `100`（几乎不卡）/ `99` / `95` / `90` |

**DB 加成口径**（与 `cocRules.ts` 配合）：
- 近战武器：伤害 `+ DB`（数据层标 `addDB: true`）
- 投掷武器：伤害 `+ ½ DB`（向下取整，数据层标 `halfDB: true`）
- 火器：**不加 DB**
- 弓 / 十字弓：算"投掷"，加 ½ DB

**era 三态**：
- `any`：两个时代都可选（近战 + 投掷 + 弓 / 十字弓 / 拳脚等纯肌肉武器）
- `1920s`：仅 1920s 可选（汤普森冲锋枪、毛瑟手枪、双管短管散弹等）
- `modern`：仅 modern 可选（格洛克 / AK-47 / MP5 / 巴雷特等）

---

## 二、近战 · 格斗(斗殴)（共 9 条 · 全 era=any）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo |
|---|---|---|---|---|---|---|---|---|
| `fist` | 拳头 | Fist/Punch | any | 格斗(斗殴) | 1D3 + DB | 触及 | 1 | 0 |
| `kick` | 踢腿 | Kick | any | 格斗(斗殴) | 1D3 + DB | 触及 | 1 | 0 |
| `headbutt` | 头槌 | Head Butt | any | 格斗(斗殴) | 1D4 + DB | 触及 | 1 | 0 |
| `grapple` | 擒抱 | Grapple | any | 格斗(斗殴) | 特殊 | 触及 | 1 | 0 |
| `small-club` | 警棍 / 短棒 | Small Club | any | 格斗(斗殴) | 1D6 + DB | 触及 | 1 | 0 |
| `large-club` | 大棒 / 铁管 | Large Club | any | 格斗(棍棒) | 1D8 + DB | 触及 | 1 | 0 |
| `whip` | 鞭子 | Whip | any | 格斗(鞭) | 1D3 + ½DB | 3m | 1 | 0 |
| `brass-knuckles` | 指虎 | Brass Knuckles | any | 格斗(斗殴) | 1D3+1 + DB | 触及 | 1 | 0 |
| `garrote` | 钢丝绞索 | Garrote | any | 格斗(斗殴) | 特殊 | 触及 | 1 | 0 |

> 擒抱 / 绞索 "特殊"：按 7e 战斗章节走擒抱规则（机动 / 缴械 / 持续伤害），不在伤害骰栏简化。

---

## 三、近战 · 锐器与钝器（共 7 条 · 全 era=any）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo |
|---|---|---|---|---|---|---|---|---|
| `knife-small` | 小刀 / 匕首 | Small Knife | any | 格斗(斗殴) | 1D4 + DB | 触及 | 1 | 0 |
| `knife-medium` | 中型刀 | Medium Knife | any | 格斗(剑) | 1D4+2 + DB | 触及 | 1 | 0 |
| `knife-large` | 大型刀 / 砍刀 | Large Knife | any | 格斗(剑) | 1D8 + DB | 触及 | 1 | 0 |
| `sword` | 剑 / 马刀 | Sword/Saber | any | 格斗(剑) | 1D8+1 + DB | 触及 | 1 | 0 |
| `axe-hand` | 短斧 | Hand Axe | any | 格斗(斧) | 1D6+1 + DB | 触及 | 1 | 0 |
| `axe-battle` | 战斧 / 大斧 | Battle Axe | any | 格斗(斧) | 1D8+2 + DB | 触及 | 1 | 0 |
| `chainsaw` | 链锯 | Chainsaw | modern | 格斗(链锯) | 2D8 | 触及 | 1 | 0 |

> 链锯归 `era=modern`：与 `cocSkills.ts` 的 `fighting-chainsaw` 分支 `eraOnly="modern"` 对齐（民用量产虽始于 1929 但 7e 1920s 不收）。链锯不加 DB。

---

## 四、投掷 · 弓 / 十字弓（共 5 条 · 全 era=any）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo |
|---|---|---|---|---|---|---|---|---|
| `thrown-rock` | 投掷石块 / 砖 | Thrown Rock | any | 投掷 | 1D4 + ½DB | STR×3m | 1 | 0 |
| `thrown-knife` | 飞刀 | Thrown Knife | any | 投掷 | 1D4 + ½DB | STR×3m | 1 | 0 |
| `spear-thrown` | 标枪 / 短矛 | Spear (Thrown) | any | 投掷 | 1D8 + ½DB | STR×3m | 1 | 0 |
| `bow` | 弓 | Bow | any | 火器(弓) | 1D6+1 + ½DB | 30m | 1 | 1 |
| `crossbow` | 十字弓 | Crossbow | any | 火器(弓) | 1D8+2 | 50m | 1/2 | 1 |

> 十字弓不加 DB（机械蓄力，与肌力无关）。

---

## 五、手枪 · 1920s（共 4 条 · era=1920s）

按"小 / 中 / 大 / 马格南"四档口径合并，保留 1920s 经典型号气质。

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `pistol-small-1920s` | .22 / .25 自动手枪 | Small Auto (.22/.25) | 1920s | 火器(手枪) | 1D6 | 10m | 2 | 6 | 100 |
| `pistol-medium-1920s` | .32 / .380 自动手枪 | Medium Auto (.32/.380) | 1920s | 火器(手枪) | 1D8 | 15m | 2 | 8 | 100 |
| `revolver-38-1920s` | .38 警用左轮 | .38 Revolver | 1920s | 火器(手枪) | 1D10 | 15m | 1(3) | 6 | 100 |
| `pistol-heavy-1920s` | .44 / .45 自动 / 长型柯尔特 | Heavy Auto (.44/.45) | 1920s | 火器(手枪) | 1D10+2 | 15m | 1 | 7 | 100 |

> 1920s 没有现代马格南 .357 / .44 量产民用版（虽然 .357 1934 才出，规则书会归到 1930s 末），本项目把".44 自动 / .45 ACP"作为 1920s 顶级手枪。

---

## 六、手枪 · 现代（共 4 条 · era=modern）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `pistol-small-modern` | 小口径自动手枪 (.22/.25) | Small Auto | modern | 火器(手枪) | 1D6 | 10m | 2 | 7 | 100 |
| `pistol-9mm` | 9mm 自动手枪 (格洛克 17 等) | 9mm Auto (Glock 17) | modern | 火器(手枪) | 1D10 | 15m | 3 | 17 | 100 |
| `revolver-357` | .357 马格南左轮 | .357 Magnum Revolver | modern | 火器(手枪) | 1D8+1D4 | 15m | 1(3) | 6 | 100 |
| `pistol-heavy-modern` | 大口径自动手枪 (.44/.45/沙鹰) | Heavy Auto (.44/.45) | modern | 火器(手枪) | 1D10+2 | 15m | 1 | 8 | 100 |

> 9mm 现代手枪 attacks=3 表示半自动可双扣 / 三连发，按 7e Pulp 现代规则。

---

## 七、步枪（共 4 条）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `rifle-bolt-1920s` | .30 栓动步枪 / 卡宾枪 | Bolt-Action Rifle | 1920s | 火器(步枪/散弹) | 2D6+4 | 110m | 1 | 5 | 100 |
| `rifle-22-any` | .22 步枪 | .22 Rifle | any | 火器(步枪/散弹) | 1D6+1 | 30m | 1 | 6 | 100 |
| `rifle-semi-modern` | 半自动步枪 (M1 / 民用 AR) | Semi-Auto Rifle | modern | 火器(步枪/散弹) | 2D6+3 | 90m | 2 | 10 | 100 |
| `rifle-50` | .50 大口径步枪 / 反器材 | .50 Rifle | any | 火器(步枪/散弹) | 2D10+4 | 150m | 1 | 5 | 100 |

> .22 / .50 两代通用故归 `any`；现代狙击枪（雷明顿 700 等）按"半自动步枪"档处理或下放到 `rifle-bolt`，不再独立条目。

---

## 八、散弹枪（共 3 条）

7e 散弹枪伤害分"距离档"（近 / 中 / 远），表中 `damage` 仅写**近距档**，中远距由战斗规则衰减。

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `shotgun-double-1920s` | 双管散弹枪（短管） | Double-Barrel Shotgun | 1920s | 火器(步枪/散弹) | 4D6 / 2D6 / 1D6 | 10m / 20m / 50m | 1 或 2 | 2 | 100 |
| `shotgun-pump-any` | 泵动散弹枪 (温彻斯特 1897 / 雷明顿 870) | Pump Shotgun | any | 火器(步枪/散弹) | 4D6 / 2D6 / 1D6 | 10m / 20m / 50m | 1 | 5 | 100 |
| `shotgun-semi-modern` | 半自动战斗散弹枪 (贝内利 M4 / SPAS-12) | Semi-Auto Shotgun | modern | 火器(步枪/散弹) | 4D6 / 2D6 / 1D6 | 10m / 20m / 50m | 2 | 8 | 100 |

> "1 或 2" 表示双管在同一回合可一发或两发齐发（齐发后需双扳机）。

---

## 九、冲锋枪 / 突击步枪（共 4 条）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `smg-thompson` | 汤普森冲锋枪 | Thompson SMG | 1920s | 火器(冲锋枪) | 1D10+2 | 20m | 1(3) | 30 | 96 |
| `smg-mp5` | MP5 / 现代冲锋枪 | MP5 (Modern SMG) | modern | 火器(冲锋枪) | 1D10 | 20m | 1(3) | 30 | 100 |
| `assault-ak47` | AK-47 / AKM | AK-47 | modern | 火器(步枪/散弹) | 2D6+1 | 90m | 1(3) | 30 | 96 |
| `assault-m16` | M16 / M4 / AR-15 | M16/AR-15 | modern | 火器(步枪/散弹) | 2D6 | 100m | 1(3) | 30 | 100 |

> 冲锋枪故障值 96 是 7e 汤普森原始值；MP5 / M16 因现代化制造工艺更可靠，本项目给 100。
> "1(3)" 表示半自动单发 / 短点射 3 发，详细按 7e 全自动射击规则结算。

---

## 十、重武器与爆炸物（共 4 条）

| id | 中文名 | 英文 | era | skill | damage | range | attacks | maxAmmo | malfunction |
|---|---|---|---|---|---|---|---|---|---|
| `mg-heavy` | 重机枪 (.30 / .50) | Heavy Machine Gun | any | 火器(重武器) | 2D6+4 | 150m | 1(10) | 100 | 96 |
| `flamethrower` | 火焰喷射器 | Flamethrower | any | 火器(重武器) | 2D6 燃烧 | 15m | 1 | 10 | 100 |
| `grenade-frag` | 手雷 / 碎片手榴弹 | Frag Grenade | any | 投掷 | 4D10 (3m 内) | STR×3m | 1 | 1 | 100 |
| `bazooka` | 火箭筒 / RPG | Bazooka/RPG | any | 火器(重武器) | 6D6 + 燃烧 | 100m | 1 | 1 | 99 |

> 1920s 也有"巴祖卡"前身（一战末期反坦克步枪 / 战壕迫击炮），本项目把火箭筒归 `any`。
> 火焰喷射器与爆炸物的"持续燃烧 / 范围杀伤"按 7e 规则书战斗章节处理，不在 `damage` 列简化。

---

## 十一、统计

| 分组 | 条数 | era=any | era=1920s | era=modern |
|---|---|---|---|---|
| 近战 · 斗殴 / 钝器 | 9 | 9 | 0 | 0 |
| 近战 · 锐器 / 链锯 | 7 | 6 | 0 | 1 |
| 投掷 / 弓 | 5 | 5 | 0 | 0 |
| 手枪 1920s | 4 | 0 | 4 | 0 |
| 手枪 modern | 4 | 0 | 0 | 4 |
| 步枪 | 4 | 2 | 1 | 1 |
| 散弹枪 | 3 | 1 | 1 | 1 |
| 冲锋 / 突击 | 4 | 0 | 1 | 3 |
| 重武器 | 4 | 4 | 0 | 0 |
| **合计** | **44** | **27** | **7** | **10** |

> 28 条 `any` 项跨代复用，与"近战 / 投掷 100% 重叠"的分析一致。
> 时代独占项 16 条，与 7e 各时代标志性火器对应。

---

## 十二、与角色卡的对接

- 玩家在槽位下拉里**只看到 `nameZh`**，按当前 `selectedEra` 过滤（`getWeaponList(era)` 返回 `era === selected || era === "any"`）
- `damage` / `range` / `attacks` / `maxAmmo` / `malfunction` 在槽位下方以小字提示，**不可手动调整**
- 创建期 `ammo = maxAmmo` 自动写入；跑团时由 KP 在 sheet 上扣加
- `skill` 字段在战斗系统接入时映射到角色 sheet 的对应技能值（"火器(手枪)" 走 `cocSkillSlots` 的 `parseSkillName` 解析回 SkillSelection）

## 十三、未涵盖（按需扩展）

以下条目当前**未收**，避免初版表过长。如未来跑团有需要再补：

- 1920s 旧式武器：左轮卡宾枪、温彻斯特连发霰弹、各国军用栓动步枪具名条目
- modern 狙击 / 反器材具名条目（巴雷特 M82 / 雷明顿 700）
- 现代非致命武器（电击枪 / 胡椒喷雾 / 橡皮弹）
- 战斗工兵装备（C4 炸药 / 闪光弹 / 烟雾弹的细分）
- 玩家可能想要的奇异武器（柯尔特 SAA / 勃朗宁 M1918 BAR / 老式毛瑟 C96）— 可作为跨代 / 风味武器后续追加
