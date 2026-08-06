# 実装計画: エージェントシステム再編（宣言的エージェント定義）

- 作成: 2026-08-07
- 状態: 実装済み・dev 検証済み（2026-08-07）
- 正本: このファイル。シーケンス図 = `docs/agent-tools-sequence.svg`（現状 + 提案の流れ）

---

## 0. 新セッションへの引き継ぎ情報

- プロジェクト場所: `~/LLMWiki/projects/cloudflare-os-hub`
- リポジトリ: starter = `yutaro0915/cloudflare-os-starter`（main/develop、ローカルは main チェックアウト）/ submodule = `yutaro0915/cloudflare-os`（fork、f37b590、**ローカルブランチ main/develop が f37b590 を指す・HEAD は detached**）
- リモート: origin = 自分のフォーク / upstream = Cloudflare 本家（追従用）
- 変更対象はすべて **submodule（cloudflare-os/packages/**）内。starter はデプロイ検証のみ
- ビルド/検証: submodule ルートで `pnpm types:check` / `pnpm test`（変更関連のみ）/ `pnpm build`。starter ルートで `pnpm run check`（テスト+ビルド+dry-run）
- 注意: vitest フルスイートは既知の 6 ファイル収集失敗あり → **変更関連のテストファイルのみ**を回す運用（`pnpm --filter workshop-backend test -- <file>` 等）
- 本番 `os.cherie-lab.com` / dev `os-dev.cherie-lab.com` 稼働中（同一アカウント・$5）。dev デプロイ = `DEPLOYMENT_CONFIG=deployment.dev.jsonc pnpm deploy`
- 秘密情報は GitHub Actions secrets / Worker secrets にあり。コード変更に secret は不要

---

## 1. 概要

ワークスペースごとの「宣言的エージェント定義」を導入する。エージェントのツール・プロンプトを TypeScript コード（agent.ts 内ハードコード）から分離し、ワークスペース単位の定義（JSONC）として管理・UI から編集できるようにする。ランタイム（agent.ts）は定義を読み込んで適用する。

やること（ユーザー指示）:
1. バックエンドのエージェントシステム再編
2. フロントエンドでの DO 接続と UI の設定
3. 最終的な動作

---

## 2. 前提知識（現状の仕組み・必読）

### 2.1 RPC 層
- フロント ⇄ バックエンドは capnweb RPC（WebSocket /api）。型の正本は `workshop-shared/src/api.ts`（約 2,900 行）
- 公開面: `PublicApi`（@44・未認証）/ `AuthenticatedApi`（@289・認証済み）/ `AdminApi`（@750）/ **`Overseer`（@1297・ワークスペース DO の RPC 面）**
- DO クラスのメソッドは capnweb の RpcTarget なので、**OverseerImpl にメソッドを足すと自動で RPC 公開される**（server.ts 経由の明示ルートは不要な場合が多い。ただし公開面の型は workshop-shared に追加が必要）

### 2.2 DO パターン
- `OverseerDurableObject`（overseer.ts @6290）は `OverseerImpl` をラップ。storage は typed-storage（`@gadgets/typed-storage`）:
  `this.impl.storage.code.put({...})` のような形
- DO クラスは `ctx.exports` 経由（wrangler に明示 binding 不要）

### 2.3 エージェント（agent.ts）
- ツール定義: `let tools: Record<string, AgentTool>` @2307。`defineTool({name, label, description, parameters, execute})` 形式。既存ツール: readFile / writeFile / editFile / webFetch / observeUserChanges / describeBinding / setGadgetBinding / createGadget / listBlueprints / executeCode / listConnectableResources / requestConnection（+ 条件付き giveUp @2817）
- **既存のツール絞り込み** @2834:
  ```ts
  if (agentContext.spawnerConfig) {
    tools = { describeBinding: tools.describeBinding, executeCode: tools.executeCode,
              ...(callbackInitiated ? {giveUp: tools.giveUp} : {}) };
  }
  let toolList = Object.values(tools);
  ```
- システムプロンプト: `SYSTEM_PROMPT` @377 / `SPAWNER_SYSTEM_PROMPT` @524 / **2 スロット組立** @2056-2100:
  - `instanceInstructions = formatInstanceInstructions(await hooks.getInstanceInstructions())`（/admin のエージェント指示）
  - `systemPromptSlots[0]` = 静的（キャッシュ維持）/ `[1]` = 動的。**定義の prompts は動的スロット [1] に注入する（静的を汚さない）**
- hooks: `interface AgentHooks` @232。`getInstanceInstructions()` @321。**`getAgentDefinition()` をここに追加し、実装は呼び出し側（overseer 側）が提供**
- 注入: `runAgentLoopContinue(context, ...)` の `context.tools = toolList` @3033

### 2.4 フロントエンド
- TanStack Router file-based routing。`src/routes/*.tsx`。グローバルナビ = `src/components/AppShell/Sidebar.tsx`（Home / Workspaces / Blueprints / Outputs / 動的 gatekeeper apps）
- ワークスペース UI = `src/routes/workspace.$id.tsx` → `GadgetEditor.tsx`。RPC セッション: `useAuthenticatedApi()`（AuthContext）→ ワークスペースの `overseer` オブジェクト（`stub: RpcStub<Overseer>`）を生成（GadgetEditor @422-470）。**Agent タブはこの overseer stub 経由で DO に接続する**
- 認証済み RPC の取得例: `BlueprintLandingPage.tsx` の `useAuth(rpcStub)`

### 2.5 デプロイ
- starter の deploy.mjs が deployment.jsonc から設定生成。submodule の変更は fork に commit/push → デプロイ
- 検証: submodule で `pnpm types:check` → `pnpm test`（変更関連）→ `pnpm build`、starter で `pnpm run check`

---

## 3. 決定事項（AgentDefinition の形）

### 3.1 型（workshop-shared/src/api.ts に追加）
```ts
// ワークスペースごとの宣言的エージェント定義。null = 未設定（現行挙動）
export interface AgentDefinition {
  version: 1;
  // システムプロンプトの動的スロットに注入する断片（順序維持）
  prompts?: string[];
  // スキル参照（まずは Context コレクション ID 等の文字列リスト。展開は後）
  skills?: string[];
  // モデル上書き（任意・省略時は従来どおり）
  model?: { provider: AiModelProvider; model: string } | null;
  // ツール制御（enabled 優先 = ホワイトリスト。enabled 省略時は disabled を除外）
  tools?: { enabled?: string[]; disabled?: string[] } | null;
}
```

### 3.2 RPC（Overseer インターフェースに追加）
```ts
getAgentDefinition(): Promise<AgentDefinition | null>;
saveAgentDefinition(definition: AgentDefinition): Promise<void>;
resetAgentDefinition(): Promise<void>;
```

### 3.3 保存形式
- **構造化オブジェクトを DO storage に保存**（生テキストではない）。UI は JSONC テキスト ⇄ 構造化の変換を担当
- バリデーションは DO 側で実施（client 任せにしない）:
  - 未知フィールド → 拒否
  - `tools.enabled/disabled` のツール名は既知ツール（上記 2.3 の一覧）のみ許可 → 未知は拒否
  - `prompts` は文字列配列・空文字は拒否
  - `model.provider/model` は既知の組み合わせのみ許可（ai-models.ts の SUGGESTED_MODELS と照合）

### 3.4 挙動
- 定義なし（null）: 現行と完全に同じ
- `tools.enabled` 指定時: 指定ツールのみ有効（spawnerConfig 制限より先に適用。サブエージェントの制限はさらに狭める）
- `tools.disabled` のみ: 指定ツールを除外
- prompts は動的スロット [1] に、instanceInstructions の後に追記
- 適用タイミング: buildAgent 毎（chat.start / 新スレッド時）。編集中のスレッドには影響しない（次スレッドから）

---

## 4. タスク一覧

| ID | 層 | 内容 | ファイル | 依存 |
|---|---|---|---|---|
| T1 | shared | `AgentDefinition` 型 + Overseer RPC 3 メソッド追加 | `packages/workshop-shared/src/api.ts` | — |
| T2 | backend | OverseerImpl に storage フィールド + CRUD 実装 + バリデーション | `packages/workshop-backend/src/overseer.ts` | T1 |
| T3 | backend | AgentHooks に `getAgentDefinition` 追加 + hooks 実装 | `packages/workshop-backend/src/agent.ts`（型）/ `overseer.ts`（実装） | T1, T2 |
| T4 | backend | buildAgent で定義読み込み → tools フィルタ + prompts 注入 | `packages/workshop-backend/src/agent.ts` | T3 |
| T5 | backend | テスト（バリデーション + フィルタ + 注入） | `packages/workshop-backend/src/agent-definition.test.ts` 等 | T4 |
| T6 | frontend | Agent タブ UI + DO 接続（JSONC エディタ・保存・リセット・プレビュー） | `packages/workshop-frontend/src/routes/` + `GadgetEditor.tsx` または新規 | T1, T2 |
| T7 | 全体 | 最終動作（dev デプロイ + E2E） | — | T1-T6 |

---

## 5. タスク詳細

### T1: workshop-shared に型と RPC を追加
- 場所: `packages/workshop-shared/src/api.ts`
- `AgentDefinition` インターフェースを追加（3.1 の形。`AiModelProvider` は同ファイル既存の型を参照）
- `interface Overseer`（@1297）に 3 メソッド追加（3.2 の形。doc-comment 必須 — workshop-backend AGENTS.md の規約「exported member は全て doc-comment」）
- 検証: `pnpm --dir cloudflare-os --filter @gadgets/workshop-shared types:check`（該当 script 名は package.json 確認）

### T2: OverseerImpl に CRUD 実装
- 場所: `packages/workshop-backend/src/overseer.ts`
- `OverseerImpl` の storage に `agentDefinition` を保持（typed-storage のパターンに従う。既存 `storage.code` と同様の宣言。型: `AgentDefinition | null`）
- `getAgentDefinition()`: storage から返す（null 可）
- `saveAgentDefinition(def)`: バリデーション（3.3）→ storage に保存
- `resetAgentDefinition()`: null に戻す
- バリデーション関数は切り出してテスト可能に（例: `validateAgentDefinition(def, knownTools)` を同ファイル or 別ファイル export）
- 検証: `pnpm --dir cloudflare-os --filter @gadgets/workshop-backend types:check`

### T3: AgentHooks に getAgentDefinition を追加
- `packages/workshop-backend/src/agent.ts` @232 `interface AgentHooks` に:
  ```ts
  getAgentDefinition(): Promise<AgentDefinition | null>;
  ```
  （import は workshop-shared から）
- hooks の実装側（overseer.ts 内で buildAgent を呼ぶ箇所）に、storage から定義を返す実装を追加（`getInstanceInstructions` と同じパターン。呼び出し箇所を grep で特定: `getInstanceInstructions` の実装を提供している場所）

### T4: buildAgent で適用
- `packages/workshop-backend/src/agent.ts`
- buildAgent 冒頭（2056 付近）:
  ```ts
  let agentDefinition = await hooks.getAgentDefinition();
  ```
- **tools フィルタ**（spawnerConfig 分岐 @2834 の直後に挿入。適用順: spawnerConfig の狭め → definition の enabled/disabled）:
  ```ts
  if (agentDefinition?.tools) {
    if (agentDefinition.tools.enabled?.length) {
      let allowed = new Set(agentDefinition.tools.enabled);
      tools = Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name)));
    } else if (agentDefinition.tools.disabled?.length) {
      let blocked = new Set(agentDefinition.tools.disabled);
      tools = Object.fromEntries(Object.entries(tools).filter(([name]) => !blocked.has(name)));
    }
  }
  ```
- **prompts 注入**（systemPromptSlots 組立 @2062 付近・動的スロット）: instanceInstructions の後に定義の prompts を追記:
  ```ts
  let definitionPrompts = (agentDefinition?.prompts ?? []).filter(p => p.trim()).join("\n\n");
  // 動的スロット（systemPromptSlots[1]）の先頭 or instanceInstructions の後に連結
  ```
- 注意: **静的スロット [0] を変更しない**（prompt cache 維持）。spawner 分岐（agentContext.spawnerConfig）では定義の prompts も適用してよいかは要判断（まず通常エージェントのみ適用が安全 → 実装時に hooks で spawner か判別し、spawner では prompts のみ適用 or スキップを決める。**初期は通常エージェントのみ**）
- 検証: `pnpm --dir cloudflare-os --filter @gadgets/workshop-backend types:check`

### T5: テスト
- 場所: `packages/workshop-backend/src/` に `agent-definition.test.ts`（vitest。既存テストの構成に従う）
- 対象:
  - `validateAgentDefinition`: 正常系 / 未知フィールド拒否 / 未知ツール名拒否 / enabled+disabled 同時（enabled 優先） / 空文字 prompt 拒否
  - ツールフィルタ関数（T4 で切り出した純関数）: enabled ホワイトリスト / disabled 除外 / 空配列 = 全許可
- 実行: `pnpm --dir cloudflare-os --filter @gadgets/workshop-backend test -- agent-definition`（フルスイートは既知の収集失敗があるため対象ファイル指定）

### T6: フロントエンド（DO 接続 + UI）
- 場所: `packages/workshop-frontend/src/`
- **DO 接続**: 既存の `overseer.stub`（GadgetEditor @422-470 のパターン。`useAuthenticatedApi()` → workspace の overseer stub）に `getAgentDefinition / saveAgentDefinition / resetAgentDefinition` が自動で生える（RPC は型定義だけでフロントから呼べる。capnweb の stub 経由）
- **UI 配置**: ワークスペース内の「Agent」タブ/メニューを追加。実装時に GadgetEditor.tsx のタブ/ナビ構造（Explorer/Blueprints/Outputs 相当がどこにあるか）を確認して配置を決定。なければ `routes/agent.tsx` + Sidebar.tsx に「Agent」項目追加（ワークスペース選択が必要なら workspace 配下）
- UI 内容:
  - JSONC エディタ（テキストエリア or Monaco — CodeEditor.tsx 既存を再利用可）
  - 保存（パース → `saveAgentDefinition`）/ リセット（`resetAgentDefinition`）/ プレビュー（現在の定義の要約表示）
  - エラー表示（バリデーション失敗時・DO からのエラーを表示）
- 検証: `pnpm --dir cloudflare-os --filter @gadgets/workshop-frontend build`（vite ビルド）

### T7: 最終動作
1. submodule で全検証: `pnpm types:check` / 変更テスト / `pnpm build`
2. fork にコミット（メッセージは変更内容。例: `feat: declarative agent definition (per-workspace prompts + tool control)`）→ `git push origin develop`（開発ブランチ）
3. starter で `pnpm run check` → `DEPLOYMENT_CONFIG=deployment.dev.jsonc pnpm deploy`（dev 環境へ）
4. E2E（os-dev.cherie-lab.com）:
   - ワークスペースで定義を保存（例: `tools.disabled: ["webFetch"]`）
   - チャットで「ニュースを検索して」→ エージェントが webFetch を使えない（使わない）ことを確認
   - prompts 断片（例: 「あなたは日本語で回答する」）が反映されることを確認
   - リセット → 元の挙動に戻ることを確認
5. 結果報告後、本番はユーザー承認があれば同手順でデプロイ

---

## 6. 既知の制約・注意

- **静的スロット [0] を汚さない**（prompt cache が壊れる）。定義の prompts は動的スロット [1] のみ
- ツールフィルタは spawnerConfig 分岐（@2834）の**後**に入れる。適用順序: spawner の狭め → 定義のフィルタ
- バリデーションは DO 側。未知ツール名は**拒否**（サイレント無視しない）
- 適用は buildAgent 毎。実行中のスレッドには影響しない（次スレッドから）
- vitest フルスイートの収集失敗（6 ファイル・既知）は無関係。対象ファイル指定で回す
- 変更は kernel（agent.ts / overseer.ts）に及ぶ。upstream 追従時のコンフリクトを減らすため、**追加は既存機構の延長として実装**（フィルタ位置・スロット注入位置を乱さない）
- フロントのタブ配置は実装時に GadgetEditor の構造を確認してから確定（本計画では 2 案併記）

---

## 7. 完了条件

- [x] T1-T6 実装・ビルド GREEN
- [x] T5 テスト GREEN（変更関連、10/10）
- [x] dev デプロイ成功・E2E で「定義なし = 現行」「定義あり = フィルタ/注入が効く」を確認
- [x] E2E 後に定義をリセットし、dev ワークスペースを既定状態へ復元
- [ ] 本番はユーザー承認後に適用
