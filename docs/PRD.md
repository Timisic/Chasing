# Chasing V1 产品需求文档

**状态：** Ready for implementation

**产品形态：** Pi Agent Extension

**核心动词：** 追问

**首位用户：** 产品构建者本人

## Problem Statement

用户在学习新知识时，常见的 AI 产品会直接总结、讲解或给出答案，却很少通过持续追问来判断用户已经理解什么、真正困惑什么，以及哪些自认为理解的内容其实仍是盲区。直接回答可能让用户获得即时流畅感，却不一定帮助用户形成自己的理解。

用户也缺少一种可以系统观察和改进“模型问得好不好”的工具。现有评测大多关注回答质量；单个问题即使措辞漂亮，脱离当时的 mission、材料、对话上下文和用户回答，也无法判断它是否真正有价值。

Chasing 需要首先成为一个用户愿意真实使用的追问工具，同时留下足够完整、可回放的交互证据，为随后从 Bad Case 归纳评测维度、编写 Rubric、接入 LLM-as-a-Judge 和比较不同产品形态奠定基础。V1 不应在真实使用发生前预设复杂的 ZPD 状态模型、signal schema 或评分体系。

## Solution

Chasing 是一个在 Pi 启动后自动进入的 Extension。它通过多轮 onboarding 理解用户当前想弄明白的主题、学习或思考动机，并形成一份由用户确认的 mission。随后，模型默认每轮只提出一个最值得问的问题，根据用户回答自然调整下一问，而不是先集中阅读材料、再进入独立测验阶段。

V1 支持两种使用模式：

- **Learn：** 学习外部知识。用户可以提供本地 Markdown 材料；材料不足时，系统按需检索官方或一手来源。模型围绕当前 mission，通过知识探测和追问逐步接近用户的最近发展区。
- **Clarify / Decide：** 理清想法、假设与权衡。只有在涉及可验证事实时才检索外部来源。该模式属于 V1 产品能力，但不进入第一阶段的正式提问质量评测。

当用户卡住时，模型依次采用澄清、缩小问题、最小提示和极短解释等方式介入，并立即回到追问；长篇讲解始终禁止。模型可以在认为问题已经足够清楚时建议结束，但最终结束权属于用户。结束时不生成会话总结。

每次真实交互默认保存在本地，包括 mission、材料与来源、模型在提问前的极简内部理由、问题和用户回答。用户可以显式启用 Langfuse 同步，用于后续 trace 观察与评测迭代。V1 的目标是产生真实、完整、可研究的会话轨迹，而不是在首场会话前完成整套评测系统。

## User Stories

1. 作为 Pi 用户，我希望 Chasing 随 Pi 自动启动，以便无需记住额外命令即可进入学习体验。
2. 作为 Pi 用户，我希望可以显式离开 Chasing，以便 Extension 不会永久接管普通 Pi 使用。
3. 作为学习者，我希望可以选择 Learn 模式，以便 Agent 将我的目标视为获取和检验外部知识。
4. 作为思考者，我希望可以选择 Clarify / Decide 模式，以便 Agent 帮助我检查想法与权衡，而不把所有问题都伪装成知识测验。
5. 作为用户，我希望 Agent 根据初始描述推荐模式，以便降低模式选择成本。
6. 作为用户，我希望最终模式仍由我确认，以便错误的自动分类不会扭曲整场会话。
7. 作为学习者，我希望 Agent 在 onboarding 中提出足够的问题来理解我的真实目的，以便后续追问围绕我真正想完成的事情展开。
8. 作为学习者，我希望 Agent 根据我的回答生成简洁的 mission，以便对话拥有稳定目标。
9. 作为学习者，我希望在正式追问前检查并修改生成的 mission，以便 Agent 不会围绕误解后的目标进行优化。
10. 作为学习者，我希望每个 session 保存各自的 mission，以便不相关主题不会互相覆盖。
11. 作为学习者，我希望无需预先描述知识水平即可开始，以便 Agent 通过真实互动而非单纯自评完成知识探测。
12. 作为学习者，我希望可以提供一个或多个本地 Markdown 文档，以便问题建立在我真正想学习的材料上。
13. 作为学习者，我希望材料保持可选，以便没有预备文档时也能探索主题。
14. 作为学习者，我希望 Agent 在现有材料不足时检索官方或一手来源，以便它不会依据不可靠的参数知识判断我的理解。
15. 作为学习者，我希望检索来源与当前问题直接相关，以便宽泛研究不会延迟或干扰对话。
16. 作为学习者，我希望依赖外部事实的问题展示精简依据，以便我能检查根据而不打断追问节奏。
17. 作为学习者，我希望 Agent 从第一次交流就开始探测，以便学习和知识探测形成一段连续对话。
18. 作为学习者，我希望 Agent 每次只提出一个聚焦问题，以便我能深入思考而非应付批量问卷。
19. 作为学习者，我希望每个新问题都回应我刚才所说的内容，以便对话具有适应性而非脚本感。
20. 作为学习者，我希望好问题能够揭示我的理解、概念边界、盲区、矛盾、推理路径或证据标准，以便即使答错也能产生真实学习 signal。
21. 作为学习者，我希望错误或不确定的回答被视为有用信息而非立即失败，以便 Agent 能够暴露和探索盲区。
22. 作为学习者，我希望 Agent 在教学前先澄清模糊回答，以便它不会解决一个我实际并不存在的问题。
23. 作为学习者，我希望 Agent 在我的推理方向有效但卡住时缩小问题，以便挑战仍然可完成。
24. 作为学习者，我希望在明确求助或无法继续时获得最小提示，以便对话不会演变为挫败体验。
25. 作为学习者，我希望在追问和提示仍然失败时只获得极短解释，以便产品不会退化成传统回答引擎。
26. 作为学习者，我希望 Agent 在提示或解释后重新回到追问，以便我能展示自己的理解。
27. 作为学习者，我希望 Agent 即使知道答案也避免长篇讲解，以便“追问”始终是产品的主要行为。
28. 作为学习者，我希望可以随时结束 session，以便模型不能把我困在无限对话中。
29. 作为学习者，我希望模型在 mission 已基本解决且继续提问很少产生新信息时建议结束，以便话题不会无限漂移。
30. 作为学习者，我希望结束建议必须经过我确认，以便模型不能单方面终止仍有价值的思考。
31. 作为学习者，我希望结束时不自动生成会话总结，以便结束保持轻量，也不把产品变成笔记生成器。
32. 作为 Pi 用户，我希望结束后可以开始新的 Chasing 主题或返回普通 Pi，以便下一步操作足够明确。
33. 作为产品构建者，我希望每个问题保留一段简短的提问前理由，以便以后检查模型观察到了什么以及为什么选择这个问题。
34. 作为产品构建者，我希望提问前理由在用户回答之前产生，以便它不能被改写成事后合理化。
35. 作为产品构建者，我希望理由保持简短、自然语言和内部可见，以便 instrumentation 不会制造缺乏依据的状态 schema 或改变用户体验。
36. 作为产品构建者，我希望原始对话和来源默认保存在本地，以便主要证据可以回放并接受后续重新评测。
37. 作为产品构建者，我希望 Langfuse 同步必须显式配置，以便远程可观测性不是隐含的隐私决定。
38. 作为产品构建者，我希望每个 session 能识别相关模型、Prompt、Extension 和配置版本，以便后续比较能够追溯行为来源。
39. 作为产品构建者，我希望在引入自动评分前保留原始会话证据，以便未来 Rubric 版本可以重新评测旧 session。
40. 作为产品构建者，我希望 Learn 与 Clarify / Decide session 可以分离，以便首个评测数据集不会混合不兼容的目标。
41. 作为产品构建者，我希望通过完整 session 测试 V1 行为，以便测试保护用户可见契约而非临时内部抽象。
42. 作为产品构建者，我希望在定义正式评测维度前从真实使用中收集 Bad Case，以便评测框架建立在实际失败之上。

## Implementation Decisions

- Build Chasing as a **Pi Agent Extension**, reusing Pi’s model access, tool use, session lifecycle and context infrastructure rather than creating a new agent runtime.
- Activate Chasing automatically when Pi starts. The user must still be able to disable Chasing and return to ordinary Pi.
- After a Chasing session ends, present only lightweight next actions: start a new topic or leave Chasing. Do not generate a session summary.
- Support two V1 modes: **Learn** and **Clarify / Decide**. Only Learn sessions are eligible for the initial formal evaluation work.
- Use multi-question onboarding. Gather enough information to form the topic, motivation, desired outcome and relevant constraints; do not restrict onboarding to a fixed two-question form.
- Synthesize onboarding answers into a concise mission, show it to the user once for correction, and associate the confirmed mission with the current session.
- Do not require users to declare their current knowledge level. Knowledge Probing begins through the conversation itself.
- Keep learning and probing fused. Do not introduce separate “read first” and “quiz later” phases.
- Accept local Markdown as the only user-supplied material format in V1. MarkItDown, PDF, Office formats, general URL ingestion and bulk multi-format import are deferred.
- When local material is absent or insufficient, retrieve information only as needed. Prefer official documentation, original papers and other primary sources. Parametric model knowledge must not be the sole basis for declaring a user answer incorrect.
- If a question materially depends on external facts, show at most three compact supporting links beside the question and retain the full source trace internally.
- Ask one question per turn in V1. Batch Grilling is deferred.
- Treat the six Socratic question categories in the reference note as an inspiration framework only. Do not force their sequence, insert them into the initial prompt, or use them as V1 scoring dimensions.
- Use the ZPD as a behavioral principle: questions should challenge the user just beyond what their answers already demonstrate. Do not introduce an explicit ZPD schema, confidence score, concept graph or persistent learner model in V1.
- A useful user answer may support or refute an understanding hypothesis, reveal a concept boundary, expose a contradiction or blind spot, or reveal a reasoning path or evidence standard. These are conceptual observations, not mandatory runtime labels in V1.
- Adapt through ordinary conversation context. Do not require fixed signal tags, probe states or next-branch fields.
- Apply progressive intervention in this order: clarify ambiguity; narrow or scaffold the question; provide a minimal hint when explicitly requested or repeatedly blocked; provide an extremely short explanation only when necessary; then return to questioning.
- Prohibit long-form teaching responses. Clarify / Decide may explore trade-offs, but it must still operate primarily through questions.
- Permit the model to suggest ending only when the mission appears addressed, the user has expressed the key understanding or trade-off in their own words, important assumptions have been examined, and further questions appear repetitive or low-value. The user retains final authority.
- Before showing each question, record a brief internal natural-language rationale answering only: what was observed in the latest answer, and why this is the most valuable question to ask now.
- Do not expose the internal rationale to the user. Do not require fixed rationale fields, confidence values, predicted responses or ZPD labels.
- Preserve the raw session locally as the canonical evidence. At minimum, the evidence must make the mission, selected mode, supplied materials, retrieved sources, configuration versions, model question, pre-question rationale and user answer recoverable in order.
- Support optional Langfuse synchronization through explicit configuration. No automatic redaction system is required in V1; the user chooses whether a session stays local or is synchronized.
- Do not make Langfuse availability a prerequisite for local Chasing sessions.
- Do not implement a shared experiment shell or built-in Prompt-versus-Agent group switch in V1. The exact comparison harness is intentionally deferred.
- Keep the architecture open to later Rubric scoring and trace replay, but do not implement Rubric, LLM-as-a-Judge, Judge calibration or automatic Bad Case classification as part of the first usable version.

## Testing Decisions

- Use one primary **session-level acceptance seam**: exercise Chasing through the Pi Extension boundary from startup through onboarding, mission confirmation, questioning, intervention, ending and evidence capture. This is the highest stable seam and protects the product behavior without locking tests to provisional internal modules.
- Drive the session-level seam with controllable model, retrieval and persistence test doubles. Assert only externally observable prompts, questions, sources, ending behavior and persisted evidence—not private implementation calls or speculative ZPD state.
- Verify that Pi startup enters Chasing automatically and that the user can leave Chasing for ordinary Pi.
- Verify mode selection and correction: the system may recommend Learn or Clarify / Decide, but the user can override it.
- Verify that onboarding may ask multiple questions, produces a mission, and requires user confirmation before the core questioning loop.
- Verify a Learn session with a local Markdown source and a Learn session without supplied material that triggers official-source retrieval.
- Verify that unsupported material formats are rejected clearly rather than silently parsed.
- Verify that only one core question is shown per turn.
- Verify the progressive intervention contract with conversational scenarios: ambiguous response, productive but stuck response, explicit request for help, and continued failure after a hint.
- Verify that no intervention produces a long-form explanation and that the next model action returns to questioning.
- Verify that fact-dependent questions show compact sources while questions that do not depend on retrieval do not add source clutter.
- Verify that the model can suggest ending but cannot end without user confirmation.
- Verify that ending produces no automatic session summary.
- Verify local evidence is sufficient to reconstruct the order of mission, sources, pre-question rationale, question and answer.
- Verify the pre-question rationale is persisted before the corresponding user answer becomes available.
- Verify that Langfuse being disabled or unavailable does not prevent local sessions or local evidence capture.
- Verify that Clarify / Decide works as a product mode but is excluded from Learn evaluation exports or selections.
- There is no existing implementation-level test prior art in the repository. The project currently contains only domain, ADR, reference and research documents; the first implementation should establish the session-level harness as its primary test convention.

## Out of Scope

- A formal evaluation Rubric for 提问质量评测.
- LLM-as-a-Judge execution, calibration or multi-Judge voting.
- Automatic Bad Case detection, confirmation or attribution.
- A fixed signal taxonomy or signal labeling pipeline.
- Explicit ZPD state fields, confidence scores or knowledge graphs.
- Cross-session memory, learning records or persistent learner profiles.
- Batch Grilling or multiple simultaneous questions.
- Multi-model comparison.
- A built-in Prompt-versus-Agent experiment harness or requirement that both conditions share one Extension shell.
- Simulated learners as evidence for real-user learning quality.
- MarkItDown and non-Markdown user-supplied material ingestion.
- HTML lessons, quizzes, reference handbooks or a complete teaching workspace.
- Long-form explanations and conventional answer-first tutoring.
- Formal 提问质量评测 of Clarify / Decide sessions in the first evaluation phase.
- Claims that V1 improves learning for the general population, produces long-term retention gains, or establishes statistically significant superiority.

## Further Notes

- The evidence priority is: current user decisions, current handwritten reference notes, domain glossary and ADRs, then the historical handoff. The deleted legacy reference is not a source of current requirements.
- V1 product quality and the later evaluation milestone are intentionally separated. V1 must produce authentic sessions first; immediately afterward, the builder will review Bad Cases, write Rubric v0, add LLM-as-a-Judge, calibrate the Judge against human labels and then design the repeated comparison.
- The initial evaluation should focus on Learn. Clarify / Decide remains usable in V1 but its quality framework will be developed later.
- For future comparisons of naturally diverging conversations, do not force two systems to receive identical turn-by-turn user answers. Preserve turn-level diagnostics and compare complete real interaction trajectories separately.
- A single-user evaluation can support claims about observed personal sessions, reproducible Bad Cases and product iteration. It cannot by itself support population-level learning-effect claims.
- Initial real use should cover genuinely needed topics rather than hard-coded benchmark subjects: at least one partially familiar topic, one unfamiliar topic, one Learn session grounded in local Markdown, one Learn session requiring external primary-source retrieval, and one Clarify / Decide smoke session excluded from formal evaluation.
