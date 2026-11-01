# Chasing

Chasing 是一个 Pi Agent Extension：它通过持续追问帮助用户学习知识或理清决策，并把可回放的交互证据默认保存在本地。

## 本地加载

在仓库根目录临时加载：

```bash
pi -e ./Chasing/src/index.ts
```

在 `Chasing/` 目录内临时加载：

```bash
pi -e ./src/index.ts
```

也可以把本地包加入 Pi 配置：

```bash
pi install ./Chasing
```

Pi 会从 `package.json` 的 `pi.extensions` 读取入口。项目级 Extension 只有在项目被信任后才会自动加载；开发时可以用 `/reload` 热重载。

## 使用

- Pi 启动后 Chasing 保持静默，等待用户主动发送主题、问题、粘贴内容或明确指定的 Markdown 材料；它不会把当前目录当成材料，也不会自动扫描目录。
- Learn onboarding 先用一轮 Batch 掌握度探测覆盖当前可问的 frontier，保存 `known / partial / unknown / misconception` mastery map；mission 确认后恢复每轮一个认知任务。
- 底部状态会依次显示目标澄清、掌握度探测、任务确认、全景构建、盲区深挖、理解验收和结束确认。
- `/chasing-leave`：退出 Chasing，恢复普通 Pi。
- `/chasing`：在当前 Pi session 中开始一个新的 Chasing 主题。
- `/chasing-sync`：把当前 session 的本地证据重放到已配置的 Langfuse。
- Learn 模式只接受本地 `.md` 或 `.markdown` 材料；Extension 会保存内容快照和 SHA-256，而不只保存易失效的路径。
- 每轮问题会先记录内部 rationale，再显示一个问题。背景、术语、例子、核心问句和回答提示分别保存，避免为了“单问”截断必要信息。用户回答会在下一轮模型调用前关联到对应问题。
- 外部事实检索会先保存完整 trace；用户侧的问题最多只显示其中三条紧凑来源链接。
- 结束必须由用户确认；结束后不会自动生成总结。

## 本地证据

规范化证据写入：

```text
.chasing/sessions/<session-id>.jsonl
```

同一事件也会以 Pi custom entry 写入 Pi session。每条证据包含顺序号、mode、mission、模型标识、Prompt/Extension/config/schema 版本，以及相应的材料、完整检索来源、问题、rationale 或回答。

## 可选 Langfuse 同步

远程同步默认关闭。要让配置不受 Pi 启动目录影响，在 `~/.config/chasing/config.json` 中设置：

```json
{
  "langfuse": {
    "enabled": true,
    "baseUrl": "http://localhost:3000"
  }
}
```

凭证从 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY` 读取，也可写入上述配置。项目目录中的 `.chasing/config.json` 可以覆盖全局设置；`CHASING_CONFIG_PATH` 可指定另一份全局配置。同步使用 Langfuse 的 OTLP/HTTP endpoint。事件先进入本地 `.langfuse-outbox.jsonl`，后台同步带硬超时；服务恢复后自动重试，也可用 `/chasing-sync` 补传，因此 Langfuse 缺失或挂起不会阻塞本地对话与证据。

macOS 上可用仓库内脚本克隆官方 Langfuse、生成本地密钥、创建全局 Chasing 配置并启动服务：

```bash
./scripts/setup-local-langfuse.sh
```

Langfuse 管理界面位于 `http://localhost:3000`。初始化管理员邮箱为 `chasing@local.test`，随机密码只保存在本机 Langfuse 目录的 `.env` 中。

## 开发与验证

```bash
npm install
npm run check
```

`npm run check` 依次运行严格 TypeScript 类型检查和 session-level acceptance tests。

主要文件：

- `src/index.ts`：Pi 生命周期、命令和 Chasing 工具
- `src/domain.ts`：会话状态与证据领域模型
- `src/prompt.ts`：每轮注入的 Chasing 行为契约
- `src/evidence.ts`：本地 JSONL 与 Pi custom entry
- `src/langfuse.ts`：可选 OTLP 同步
- `src/retrieval.ts`：受限 HTTPS 官方/一手来源抓取
- `test/acceptance.test.ts`：Pi Extension 边界验收
