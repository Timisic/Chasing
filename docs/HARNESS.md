# Chasing：现状与闭环 Harness 设计

2026-11-01 整理。第一部分是代码与记录里能核对的现状，第二部分是待确认的设计提案。

## 一、现状

### 时间线（来自 Pi 会话记录与文档）

| 日期 | 事件 |
| --- | --- |
| 08-15 | V1 实现，几次冒烟会话（deepseek-v4-flash） |
| 08-16 | **唯一一次完整真实会话**：主题「Eval 全流程地图」，20 问 20 答，用户确认结束。证据在 `~/.pi/agent/sessions/--Users-hong--/2026-08-16T14-36-33-231Z_*.jsonl` |
| 08-16 | 复盘发现 6 类 bad case → 写 `V2.md` |
| 08-17 | V2 实现：掌握度探测、结构化问题字段、coverage 验收、真实抓取来源、Langfuse outbox |
| 09-04 | 卸载 Chasing 扩展。V2 **没有经过任何真实会话** |
| 11-01 | `npm run check` 通过：类型检查 + 24 个验收测试全绿 |

### 架构

```text
用户 ── Pi TUI ── LLM（Pi 的模型与工具循环）
                    │  每轮 before_agent_start 注入 prompt.ts 的行为契约 + 当前状态
                    ▼
          Chasing 扩展 src/index.ts
          ├─ 13 个工具：模型只能通过它们推进流程
          │    recommend/confirm_mode · prepare_diagnostic_round · record_mastery_map
          │    propose/confirm_mission · define/update_coverage · add_material
          │    fetch_sources · prepare_question · suggest_end/confirm_end
          ├─ 守卫（硬约束，写在代码里）
          │    问句只能有一个问号 · 背景/例子/提示长度上限 · 没确认 mission 和 coverage 不能正式提问
          │    来源必须真抓取过 · coverage 未全部 verified 不能建议结束 · 禁止读工作区
          ├─ 渲染：message_end 用准备好的结构化问题替换模型原文
          └─ 证据 evidence.ts → .chasing/sessions/*.jsonl + Pi custom entry
                               → 可选 langfuse.ts（outbox + 超时 + 可重放）
```

### 一次 Learn 会话的流程

```text
目标澄清 → 掌握度探测（一批 2–6 题，记 known/partial/unknown/misconception）
        → 推荐模式 + 提出 mission → 用户确认 → 定义 3–8 个 coverage
        → 全景构建（mapping）→ 盲区深挖（deepening，介入顺序：澄清→缩小→提示→极短解释）
        → 理解验收（verification，复述）→ 全部 verified → 建议结束 → 用户确认 → 不生成总结
```

### 缺口

1. **评测这一半完全没做**。PRD 刻意把 Rubric、Judge、Bad Case 归因、对比实验推迟到 V1 之后。现在只有证据采集，没有消费证据的那一端。
2. **V2 没有被真实使用过**。V2 修的 6 个问题是否真修好，没有证据。
3. 扩展装上后**默认接管每个 Pi 会话**（`createInitialState` 里 `active: true`）。09-04 的卸载可能和这个有关，待确认。
   - 已修复（11-01）：启动时默认不启用，`/chasing` 才开启；未开启时 Chasing 工具直接报错。
4. 项目放在简历仓库的 `archive/` 下，没有独立仓库，简历上也就没法放链接。

## 二、闭环 Harness 设计（提案）

### 核心想法

现在的系统只有「跑 → 记录」。闭环要补上「看 → 定义好坏 → 打分 → 归因 → 改 → 证明改好了没改坏」，让每个 bad case 最终都变成一条**守卫**、一个**评测维度**或一条**回归用例**。

```text
        ┌──────────────── 真实会话（证据的唯一来源）◀──────────────┐
        ▼                                                          │
   ① 证据 JSONL                                                    │
        ▼                                                          │
   ② 人工回看标注：逐轮看 问题+理由+回答，标 bad case 与归因        │
        ▼                                                          │
   ③ 沉淀：bad case 库 → Rubric vN（维度来自 bad case，ADR-0002）  │
        ▼                                                          │
   ④ LLM Judge 按 Rubric 打分 → 和人工标注对齐（一致性报告）       │
        ▼                                                          │
   ⑤ 归因分流 ─┬─ 能机械判定 → 加守卫 + 验收测试（硬 harness）     │
               ├─ 策略问题   → 改 prompt / 工具描述，升版本号       │
               └─ 模型问题   → 换模型或记录为已知局限               │
        ▼                                                          │
   ⑥ 回归：固定场景 + 模拟学习者，新旧版本各跑一遍，Judge 对比     │
        ▼                                                          │
   ⑦ 报告：本轮改了什么、哪些 bad case 消失、有没有新问题 ─────────┘
```

### 三个评测层级（依据 `docs/research/` 的调研）

| 层级 | 单位 | 方法 | 用来回答 |
| --- | --- | --- | --- |
| 守卫 | 单次工具调用 | 代码规则 + 验收测试 | 这类错误还会不会再出现 |
| Turn 级 | 一问一答 | Rubric 打分（人工 + Judge） | 这一问在当时上下文里好不好 |
| Session 级 | 整段会话 | 盲化成对比较（ACUTE-Eval 做法） | 新版本 / Agent 组 整体是否更好 |

**模拟学习者只用于第 ⑥ 步回归**：检查改动有没有破坏流程、守卫是否生效。它不能作为「提问质量变好了」的证据（Scarlatos 2026：简单 prompt 模拟的学生质量差）。质量结论只来自真实会话。

### 归因分类（第 ② 步标注用）

| 归因 | 例子（来自 V2.md 的真实 bad case） | 去向 |
| --- | --- | --- |
| Harness 实现 | 状态栏不随阶段更新；20 问中 18 问被截断逻辑删掉背景 | 修代码 + 测试 |
| 工具边界 | curl 被拦后模型从记忆伪造来源 | 加守卫：来源必须真抓取 |
| 策略 / Prompt | 探测阶段没形成掌握度地图；复述有遗漏仍宣布完成 | 改流程或 prompt，可能再加守卫 |
| 模型能力 | 待真实数据 | 换模型对比或列为局限 |
| 可观测性 | Langfuse 离线时 48 个事件全丢 | 修可靠性 |

V1 那 6 个 bad case 正好覆盖了前四类，可以直接作为 bad case 库的种子。

### 要新增的部分

| 部分 | 作用 | 形态 |
| --- | --- | --- |
| 导出 | 从 Pi 会话 / `.chasing` JSONL 抽出标准的 turn 列表 | 脚本 |
| 回看标注 | 逐轮显示 问题、理由、回答，标 bad case、维度、归因 | 先用本地 HTML 页或 CLI，越简单越好 |
| Bad case 库 + Rubric | `eval/badcases.jsonl`、`eval/rubric/v0.md` | 文件，带版本号 |
| Judge | 按 Rubric 给每个 turn 打分并给理由；会话级成对比较 | 脚本，调用模型 API |
| 校准 | Judge 与人工标注的一致率，分维度看哪里不准 | 报告 |
| 场景与模拟学习者 | 3–5 个主题 × 几种学习者画像（基本懂 / 有误解 / 完全不懂 / 只想要答案） | `eval/scenarios/`，用 Pi 的非交互模式驱动 |
| 报告 | 每轮迭代一页：版本差异、bad case 变化、分数变化 | `eval/reports/` |

### 里程碑

| 阶段 | 内容 | 完成标志 |
| --- | --- | --- |
| M0 整理 | 移出 archive、独立仓库；改成 `/chasing` 主动开启 | 能放进简历的链接；装着它也不影响普通 Pi |
| M1 种子数据 | 导出 08-16 会话；人工标注 20 轮；6 个 bad case 入库 | 第一份 bad case 库 |
| M2 V2 真实使用 | 按 PRD 的主题组合跑 4–5 场真实会话 | V2 的 bad case 清单 |
| M3 Rubric + Judge | 从 bad case 归纳 Rubric v0，Judge 打分并和人工对齐 | 一致性报告 |
| M4 回归 | 场景 + 模拟学习者，改一次策略，新旧版本对比 | 第一份迭代报告 |
| M5 对比实验 | 纯 Prompt 组 vs 扩展组，交叉顺序（ADR-0004 的问题：harness 到底有没有用） | 会话级成对比较结果 |

M3 和 M5 的结果就是简历上的「评测结论」。
