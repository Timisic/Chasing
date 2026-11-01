# 基于 Pi Agent + Extension 构建，而不是从零搭建或纯 prompt

选择在 Pi Agent 基础上通过 Extension 扩展苏格拉底式学习能力，而不是从零搭建 agent 框架，也不是只写一个 prompt/skill。Pi 已经提供了 tool use、memory summary 等基础 agent 能力（仅 4 个内置工具、约 300 词系统提示词），Extension 层只需关注苏格拉底提问逻辑和评测 instrumentation。

这个选择同时解决了两个极端的问题：从零搭建会把时间花在重复造轮子上（tool use、context 管理等 Pi 已经做好的事）；纯 prompt/skill 则没有中间环节可以 instrument，bad case 只能归因到"prompt 不好"，评测深度不够。

Extension 层还带来一个额外的评测维度：同一套评测框架可以对比"纯 prompt 苏格拉底" vs "Extension 增强版"，用数据回答"harness 到底有没有用"这个问题。

## Considered Options

- **从零搭建 agent**：完全可控，但 1-2 天时间大部分会花在基础设施（tool use、memory、context 管理）上，挤压评测时间
- **纯 prompt / skill**：最快，但可迭代的杆只有 prompt 本身，评测归因深度不够，也难以体现架构思维
- **Pi Agent + Extension**：基础能力现成，Extension 提供 instrument 点和中间层逻辑，时间集中在评测上
