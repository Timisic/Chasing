// Turn a Pi session file into a Markdown transcript for manual bad-case review.
// Usage: node scripts/export-turns.ts <pi-session.jsonl> > eval/sessions/<name>.md
import { readFileSync } from "node:fs";

type Entry = { type: string; customType?: string; data?: any; message?: { role: string; content: unknown } };

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/export-turns.ts <pi-session.jsonl>");
  process.exit(1);
}

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
      : "";

const quote = (value: string) => value.trim().split("\n").map((line) => `> ${line}`).join("\n");

const entries = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry);
const out: string[] = [];
let turn = 0;

for (const entry of entries) {
  if (entry.type === "message" && entry.message?.role === "user") {
    out.push(`**用户**\n\n${quote(text(entry.message.content))}\n`);
    continue;
  }
  if (entry.type !== "custom" || entry.customType !== "chasing:event") continue;
  const { type, data, phase } = entry.data;
  if (type === "question_prepared") {
    turn += 1;
    out.push(`---\n\n## Q${turn} · ${data.stage} · 介入：${data.intervention}\n`);
    out.push(`- 理由（用户不可见）：${data.rationale}`);
    if (data.interventionText) out.push(`- 介入文字：${data.interventionText}`);
    if (data.context) out.push(`- 背景：${data.context}`);
    if (data.example) out.push(`- 例子：${data.example}`);
    out.push(`- **问题**：${data.question}`);
    if (data.answerGuide) out.push(`- 回答提示：${data.answerGuide}`);
    if (data.sources?.length) out.push(`- 来源：${data.sources.map((s: any) => s.url).join("、")}`);
    out.push("- 标注：bad case？□  维度：  归因：harness / 工具 / 策略 / 模型 / 可观测\n");
  } else if (type !== "user_answer" && type !== "user_input" && type !== "diagnostic_answer") {
    out.push(`*[${type} · ${phase ?? ""}] ${JSON.stringify(data)}*\n`);
  }
}

console.log(out.join("\n"));
