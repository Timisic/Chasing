# 自适应追问系统的交互评估：如何比较自然分叉的真实会话

## 研究问题

当两个追问系统会提出不同问题，真实用户的后续回答也随之改变时，如何比较它们，而不强迫两组产生相同轨迹？

## 结论摘要

现有研究不要求两个交互系统逐轮收到相同回答。更可行的做法是同时保留两个评测层级：

1. **Turn 级诊断**：判断某一次提问在当时上下文中是否连贯、有依据、遵守策略，以及是否产生有用信息。
2. **完整轨迹比较**：让体验者分别完成两段自然展开的对话，再对完整对话进行盲化的成对比较。

对于 Chasing，单一真实用户的第一阶段适合做 **within-person repeated crossover（同一人重复交叉体验）**：在多个不同但尽量等价的学习任务上轮换 Prompt 组和 Agent 组的先后顺序。它可以支持“在这些真实自用会话中，哪一种方式更常产生高质量提问/更少 Bad Case”的探索性结论，但不能单独支持对一般用户群体的统计推广。

## 一手研究发现

### 1. 完整对话可以直接成对比较，不需要逐轮对齐

ACUTE-Eval 指出，单轮成对评价和整段对话的 Likert 评分各有明显缺陷；其方案让评审并排阅读两段完整多轮对话，只关注被比较系统一方，然后做成对偏好判断。这说明两条轨迹可以自然不同，比较单位仍然可以是完整对话。

来源：Li, Weston, Roller. 2019. [ACUTE-EVAL: Improved Dialogue Evaluation with Optimized Questions and Multi-turn Comparisons](https://arxiv.org/abs/1909.03087)

### 2. “亲自交互的人”可以同时担任体验评审

iEval 让同一个人依次与多个 chatbot 真实交互，然后既按多个方面评分，也对系统排序。作者报告这种“体验者即评审者”的设计提高了评分一致性。它与 Chasing 的单一首位用户场景直接相关：用户无需复现相同回答，而是需要在相近任务下真实体验各组。

来源：Svikhnushina, Filippova, Pu. 2022. [iEval: Interactive Evaluation Framework for Open-Domain Empathetic Chatbots](https://aclanthology.org/2022.sigdial-1.41/)

### 3. Turn 级分析和对话级比较应同时保留

TD-EVAL 将评估拆成两步：先在 turn 级检查具体错误，再通过完整对话的成对比较评价整体表现。论文报告这种组合能够识别传统指标漏掉的会话问题，并比只使用传统或 LLM 指标更贴近人类判断。

来源：Deng et al. 2025. [TD-EVAL: Revisiting Task-Oriented Dialogue Evaluation by Combining Turn-Level Precision with Dialogue-Level Comparisons](https://aclanthology.org/2025.sigdial-1.7/)

### 4. 教学对话需要观察整段策略，而不只是回答正确率

MathDial 的交互评估同时测量学生最终解题成功与导师过早直接告知答案的比例，体现“学生成功”与“导师是否留下探索空间”之间的权衡。其结果也显示，大模型擅长解题不等于擅长辅导。

来源：Macina et al. 2023. [MathDial: A Dialogue Tutoring Dataset with Rich Pedagogical Properties Grounded in Math Reasoning Problems](https://aclanthology.org/2023.findings-emnlp.372/)

另一项真实教学对话研究发现，即使单条回应看起来可接受，完整用户研究中仍有 45% 的会话出现模型推理错误，说明仅做静态 turn 评分不足以评估真实导师。

来源：Macina et al. 2023. [Opportunities and Challenges in Neural Dialog Tutoring](https://aclanthology.org/2023.eacl-main.173/)

### 5. 简单 Prompt 模拟出来的学生不能替代真实轨迹证据

一项专门评估模拟学生的研究发现，简单 prompting 生成的学生在自动与人工评估中表现较差；即使经过监督微调或偏好优化，模拟质量仍有限。因此模拟学生可以用于开发期压力测试，但不宜替代 Chasing 的真实用户证据。

来源：Scarlatos et al. 2026. [Simulated Students in Tutoring Dialogues: Substance or Illusion?](https://aclanthology.org/2026.acl-long.1960/)

## 对 Chasing 的最小可行设计建议（推论）

以下是基于上述研究对当前项目的推论，不是论文直接给出的结论。

### A. 使用两类评测记录，但不要求轨迹对齐

- **Turn record**：上下文、问题、提问前理由、用户回答，以及该回答是否产生有效 signal。
- **Session comparison**：完成两场自然对话后，对两段完整轨迹进行盲化成对判断。

不要把 A 组第 3 轮与 B 组第 3 轮强行视为同一个测量点。

### B. 单用户采用重复交叉，而不是“同题同回答”

- 准备多组难度和材料规模尽量接近、但内容不同的真实学习任务。
- Prompt 组与 Agent 组交替先后顺序，例如 AB、BA、AB、BA，降低熟悉效应和固定顺序偏差。
- 同一个具体知识任务不要在短时间内重复学习，因为第二次会受到第一次学习迁移污染。
- 每场结束后先独立记录体验，再进行两段轨迹的盲化比较，减少对实现身份的偏见。

### C. 第一阶段可以声称什么

可以声称：

- 在记录的个人真实学习任务中，哪一组更常产生高信息量提问；
- 哪一组出现了哪些可复核的 Bad Case；
- 哪些策略变化与轨迹改善同时出现；
- 完整会话的成对偏好如何分布。

不能仅凭单一用户声称：

- 对一般学习者普遍有效；
- 提升了长期学习效果；
- 某组在总体人群上具有统计显著优势。

### D. 暂不需要解决的内容

- 不需要立即构造模拟学生。
- 不需要让两组获得逐字相同的用户回答。
- 不需要现在确定完整 Rubric 或 ZPD schema。
- 不需要在第一版声称因果性或人群层面的统计结论。

## PRD 前仍需决定

1. 第一批真实学习任务如何组成“尽量等价但不重复”的任务对。
2. 每种产品形态至少体验多少场，才从纯原型使用转入正式探索性比较。
3. 完整轨迹的盲化成对问题具体问什么，例如“哪段对话更有效地暴露了学习者当前理解？”
4. 体验者何时评分，如何减少对系统身份和先后顺序的记忆偏差。
