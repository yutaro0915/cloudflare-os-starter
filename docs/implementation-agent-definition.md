# 実装計画・結果: Agents / Skills / Tools

- 作成: 2026-08-07
- 更新: 2026-08-08
- 状態: 実装・ローカル検証・dev 配備完了
- 対象: `cloudflare-os/` submodule

## 1. 目的

ユーザーが再利用可能な Agent と Skill をアカウント単位で定義・保管し、新しい会話を始めるときに通常のモデルまたはカスタム Agent を選べるようにする。

管理 UI は会話中の設定ではなく、サイドバー末尾の独立した `Agents`、`Skills`、`Tools` に置く。Skill は Codex / Claude Code 型の `SKILL.md` として保存し、pi にはメタデータを先に提示して、必要時だけ全文を読み込ませる。

## 2. 確定仕様

### 2.1 画面

サイドバーの主要メニュー末尾は、上から次の順とする。

1. `Agents`
2. `Skills`
3. `Tools`

- `/agents`: 保存済み Agent の一覧と編集、右側に Agent 専用 Preview。
- `/skills`: frontmatter 付き完全な `SKILL.md` の一覧、検証、保存、削除。
- `/tools`: backend 登録済み tool の一覧、説明、入力契約、JSON 入力の契約検証。
- Skill と Tool に会話 Preview は設けない。実ランタイムでの組み合わせは Agent Preview で試す。
- Home と Workspace の新規会話ピッカーでは、通常モデルまたは保存済み Agent を選択できる。

### 2.2 保存形式

```ts
interface AgentDefinition {
  version: 2;
  id: string;
  name: string;
  modelId: string;
  agentsMd: string;
  skillIds: string[];
  tools: { enabled?: string[]; disabled?: string[] } | null;
}

interface SkillDefinition {
  version: 1;
  id: string;
  name: string;
  description: string;
  markdown: string;
}
```

- User Durable Object が Agent と Skill を別 collection として所有する。
- Agent は Skill 本文を埋め込まず、安定 ID の `skillIds` だけを参照する。
- Skill の `name` と `description` は完全な `SKILL.md` の YAML frontmatter から導出する。
- Skill 名はユーザー内で一意とし、参照中の Skill は削除できない。
- 保存時に schema version、未知フィールド、必須値、モデル、tool 名、Skill 参照、YAML frontmatter、Markdown 本文をサーバーで検証する。

旧 v1 Agent に埋め込まれた Skill だけは、既存 dev データを失わないため User DO で一度だけ v2 の独立 Skill へ移す。これ以外の旧形式互換層は追加しない。

### 2.3 新規会話のスナップショット

通常チャットは公開 RPC に保存済み `agentId` だけを渡す。User DO が会話開始時に Agent、参照 Skill 全文、モデルを解決し、`AgentDefinitionSnapshot` としてチャットへ固定する。

そのため、会話開始後に Agent や Skill を編集・削除しても既存会話には遡及せず、次に始める会話から反映される。通常チャットと Preview は同じ Overseer / agent loop、prompt 合成、tool 構築経路を使う。

### 2.4 pi への Skill の段階的開示

初期 system prompt に Skill 本文は入れず、選択 Skill ごとに次だけを `<available_skills>` として渡す。

- `name`
- `description`
- 仮想 location: `agent-skill://<id>/SKILL.md`
- 明示呼び出し: `/skill:<name>`

pi がタスクとの一致を判断したとき、ハーネス提供の `readSkill` tool を Skill ID または catalog 名で呼ぶ。tool は、その会話でスナップショット済みの完全な `SKILL.md` だけを返す。返却文書は tool result に保存され、後続 turn の履歴再生でも同じ内容を使う。

`readSkill` はユーザーが選ぶ業務 tool ではなく Skill 機構そのものなので、Agent の allow / block policy を適用した後に追加し、policy から無効化できない。spawned agent には Agent 固有の `AGENTS.md` と Skill catalog を継承させない。

### 2.5 Agent Preview と Durable Object

- `Apply to preview` は現在の未保存 draft を検証し、保存操作とは独立して右ペインの一時会話へ適用する。
- 再 Apply は Preview の会話表示をリセットし、その時点の draft で次の Preview 会話を始める。
- Preview はユーザー ID から決まる専用 Overseer DO を使い、`agentPreview: true` として User DO に登録する。
- この DO は通常 Workspace / Output の一覧、backfill、Recent から除外する。
- 未保存 draft は `AuthenticatedApi.startAgentPreviewChat` の認証境界だけを通り、返却される公開 Overseer capability に draft 受け渡し用 RPC は追加しない。
- React state には callable な Cap'n Web RPC stub を直接渡さず、`{overseer}` オブジェクトに包んで保持し、終了時に dispose する。

## 3. 実装範囲

### Shared API

- Agent v2 / Skill v1 の共有型とコメント。
- Agent CRUD、Skill CRUD / validate、Preview open / start。
- 通常 `newChat` の任意 `agentId`。

### Backend

- User DO の Agent / Skill 独立保存と厳格検証。
- 保存済み Agent と参照 Skill の会話単位 snapshot。
- metadata catalog、`readSkill`、tool policy、履歴 replay。
- ユーザー別の hidden Preview DO と capability 境界。

### Frontend

- 独立した `/agents`、`/skills`、`/tools`。
- 3 ペインの Agent 一覧 / 編集 / Preview。
- `SKILL.md` エディタと frontmatter 検証。
- built-in tool registry と副作用を起こさない入力契約テスト。
- Home / Workspace の Agent picker。

## 4. 非対象

- 任意 JavaScript tool や MCP server の登録・実行。
- Skill / Agent の共有、公開カタログ、権限体系の追加。
- Skill ごとの会話 Preview、Tool ごとの実行 Preview。
- 既存会話への定義変更の遡及。
- 本番配備、commit、push。

## 5. 検証結果

- backend 全体: 27 files、305 tests PASS。既存の環境依存 integration 4 tests は skip。
- frontend 全体: 26 files、118 tests PASS。
- 全体型検査: 26 packages PASS。
- lint: PASS。既存 warning と `AgentPreview` の非ブロッキングな scoping warning のみ。
- build: PASS。既存の chunk size warning のみ。
- `git diff --check`: PASS。
- starter `check`: deploy script 12 tests、custom gatekeeper 2 tests、error reporter 2 tests、全 build、4 Worker の `wrangler deploy --dry-run` が PASS。
- ローカル E2E: Skill 保存、未保存 Agent の Apply、`readSkill`、完全 `SKILL.md` 読込、期待応答 `E2E-SKILL-OK`、一時 Skill 削除、hidden Preview 非表示を確認。
- dev E2E: Workers AI の Kimi K2.7 Code で `DEV_SKILL_CHECK` を送り、`readSkill` tool call と `DEV-SKILL-OK` を確認。Tool 入力契約 UI も検証し、一時 Skill を削除した。Agent は保存しておらず、hidden Preview は Workspace 一覧へ現れていない。
- dev 設定: AI Gateway provider は `cloudflare` のみ、`WORKERS_AI` binding と Workers AI Gateway を維持。
- dev 配備: Workshop version `143239b6-c093-46be-b0b1-fc90d3f6fc8c`。Context `9bf858c6-e8b5-42c5-be49-3473e88a9bd7`、custom Gatekeeper `22279718-9a7c-4769-b32e-d61f54828ea4`、error reporter `839b0f8b-d255-4487-86a2-04e58f7fa871`。

## 6. 完了条件

- [x] サイドバー末尾に Agents / Skills / Tools がこの順で独立表示される。
- [x] Agent を model / `AGENTS.md` / Skill 参照 / tool policy で管理できる。
- [x] Skill を frontmatter 付き完全な `SKILL.md` として独立管理できる。
- [x] pi が metadata catalog を見て、必要時に `readSkill` で全文を段階的に取得できる。
- [x] 通常チャットと Preview が同じ snapshot / runtime 経路を使う。
- [x] 未保存 draft を Agent 専用 Preview で会話テストできる。
- [x] Preview runtime が Workspace / Output 一覧に露出しない。
- [x] built-in Tools と入力契約テストを独立画面で確認できる。
- [x] 全テスト、型検査、lint、build、dry-run、ローカル E2E、dev E2E が成功する。
- [x] dev を Workers AI 構成のまま配備する。
