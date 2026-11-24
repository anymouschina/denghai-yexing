# M2 战斗（工蜂 m2-combat）方案

## 交付
- `src/guard/sim/kits/`：util.js（共用：扇形弹、圆形伤害、击退、聚团/残血查询）+ azhu/huoqing/yunque/xuanshuang（q/e/r/f/u 各有 cast+ai）+ mercs（dao/nu/tong 的 q）+ beasts（五神兽 q/e）；index.js 注册。
- `src/guard/sim/systems/bosses.js` + `data/bosses.json`：第 10/20/30 波 BOSS（灯骸老祖/旱魃/夜帝·无光），每只 3 招轮换，大招先 telegraph 红圈 ≥0.6 秒；夜帝半血进二阶段；每第 5 波（非 BOSS 波）1 只精英（×1.6 体型、血×8、额外预警重击）；剧情第 30 波 BOSS 死亡判胜；无尽 30 波后每 10 波轮换并按波数加血。
- `src/guard/render/combat.js`：新特效（落符、天雷、光束、护盾）与区域画法（狐火环、符雨、箭雨），extensions.js 追加 import。
- `tests/guard/m2-combat.test.mjs`。

## 步骤
1. 写 kits 共用函数与 4 英雄 → 2. 雇佣兵/神兽 → 3. BOSS/精英系统 → 4. 渲染 → 5. 测试 + 构建 + 空挂/认真打两档快速检查。

## 取舍与假设
- 数值以英雄攻击力系数（coef）写进 heroes.json / units.json 的 skills，代码不写死；只给初值，平衡留给总控最后统一跑。
- AI 规则：AOE 敌人聚团 ≥3 才放；治疗只在友军/孔明掉血时放；大招在敌人 ≥6 或 BOSS/精英在场时放。
- BOSS 不吃通用 AI（e.update 自带），沿北路（首开路）向孔明推进，控制效果对 BOSS 已有 35% 抗性（核心）。
- 不改 Sim.js / HUD / GuardGame。
