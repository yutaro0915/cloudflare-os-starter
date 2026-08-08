# Cloudflare OS ハブ — プロジェクト化計画

- 日付: 2026-08-06
- 目標: 「自己改善するハブ」をプロジェクトとして起動し、明後日のハッカソン（上級生・冷やかし枠）で発表
- 発表スタンス: 新入生の作品を評価する会での「話のネタ」。ガチの競技ではないので、**デモは 1 サイクル確実に回ること**を最優先にする

---

## ビジョン

メンバーが使うほど機能が最適化されていくハブ:

```
メンバー → issue（不具合/要望）
   ↓ 自動受取・分類
エージェント（プロバイダ非依存）が実装 → PR
   ↓ 人間がレビュー
マージ → 自動デプロイ（dev → 本番）
   ↓
ハブに反映 → メンバーが使う → 次の issue
```

基盤 = 既存の Cloudflare 資産（AI Gateway・Workers・KV/R2・動的 Worker）+ Cloudflare OS の基本構成（認証・共有・Blueprint・Gatekeeper）の上に載せるので、**安定した土台の上でのカスタム**になる。

---

## スコープ（2 日でやること / やらないこと）

### ✅ 2 日でやる（デモのコア）

1. **GitHub 化** — フォークを yutaro0915 配下の private repo で管理（starter + submodule の 2 リポジトリ）
2. **開発/本番分離** — 本番 `os.cherie-lab.com`（現行維持）+ 開発 `os-dev.cherie-lab.com`（2 つ目のデプロイ・同じアカウントなので $5 据え置き・データ独立・ダミーデータ）
3. **自動実装フロー（プロバイダ非依存）** — issue → エージェント実装 → PR → レビュー → マージ → 自動デプロイ（dev）の 1 サイクルを動かす
4. **カスタムの実演** — 既存の deepseek リレー + カタログを「安定基盤上のカスタム」として見せる + 目玉 1 個（後述）
5. **発表** — デモスクリプト + 構成図 1 枚

### ⏳ ロードマップ（ハッカソン後・構想として発表）

- **エージェントバンク**（OS 内でスキル・良いプロンプトを共有・管理する機能）
- **アウトプット拡張**（Blueprints エコシステムの管理 UI）
- **CI/CD 強化**（GitHub Actions で merge → 自動デプロイ・アップストリーム追従の自動化）

---

## フェーズ詳細

### Day 1 午前: 基盤（GitHub + 環境分離）

1. GitHub private repo 2 つ作成:
   - `yutaro0915/cloudflare-os`（submodule 本体のフォーク。ローカル commit fcb5ce9 / 22b71da / f37b590 を push）
   - `yutaro0915/cloudflare-os-starter`（デプロイラッパー。submodule gitlink も追従）
2. ブランチ戦略: `main`（本番反映可能）/ `develop`（開発）/ `feature/*`
3. 開発環境のデプロイ:
   - `deployment.dev.jsonc` を git 管理（worker 名を `-dev` に、URL を os-dev.cherie-lab.com に）
   - データは**独立・空**なので、ダミーデータ（サンプルワークスペース/Blueprint）をスクリプト or UI で投入
   - 本番 `deployment.jsonc` と分離して管理（実データ・実 Gatekeeper は本番のみ）
4. 検証: `pnpm run check` → `pnpm deploy --config deployment.dev.jsonc`（deploy.mjs の対応を確認）

### Day 1 午後: 自動実装フロー

1. **薄いオーケストレーション層**を作る（プロバイダ非依存の契約）:
   - 入力: 「リポジトリ + issue/タスク仕様」
   - 実装: 任意のエージェント CLI が実行（Codex / Claude Code / その他 / クラウド上のエージェント — 呼び出し側を差し替え可能に）
   - 出力: PR
2. 実装例: `bin/agent-do <issue番号>` スクリプト（エージェントを起動 → 実装 → コミット → PR 作成 → 結果を issue にコメント）
3. デモ用に小さい issue を 1 つ用意（例: フロントのラベル修正 or ツール 1 個追加）→ 自動実装 → PR → レビュー → `develop` にマージ → dev デプロイ → 動作確認
4. 人間ゲート: **dev への自動デプロイは可、本番へのデプロイは人間承認**

### Day 1 夜 / Day 2 午前: 目玉カスタム = エージェントシステム再編 + エージェントバンク MVP

1. 目玉カスタム = **エージェントシステム再編（宣言的エージェント定義）**（2026-08-07 確定・下記デモ MVP）
   - デモ MVP: ワークスペースの agent definition（JSONC）→ agent.ts が読み込み → `tools.enabled` でツールを絞る + `prompts` 断片を動的スロットへ注入（UI は最小限 or シード定義で実演）
   - ライブ実演例: 「このワークスペースでは webFetch を無効化」→ チャットでエージェントのツールが変わる
   - 本格実装（Agent タブ・skills・model 制御）はハッカソン後（構想セクション参照）
2. エージェントバンク MVP（ドッグフーディング）:
   - 「スキル/良いプロンプトを共有するガジェット」を**ハブ自身のエージェントに作らせる**
   - つまり「ハブが自分の拡張を作る」というデモになる（2 日で作れる範囲の MVP）

### Day 2 午後: 発表準備

1. デモスクリプト（3〜5 分）:
   - ① ハブのライブ（カタログに v4 flash・チャットでアプリ生成）
   - ② 開発/本番分離の見せ方（dev で試す → 本番にマージ）
   - ③ issue → 自動実装 → PR → デプロイの 1 サイクル（ライブ or 録画）
   - ④ 構想: エージェントバンク・スキル共有・アウトプット拡張（図 1 枚）
2. 構成図の更新（リレー構成の図を基に dev/prod を追加）

---

## リスクと対策

| リスク | 対策 |
|---|---|
| 2 日で全部は無理 | デモのコアは「1 サイクル確実に動く」に絞る。構想はスライドで |
| 自動デプロイの事故 | dev は自動可・本番は人間承認。デモは dev で完結させる |
| フォーク差分の肥大化 | GitHub 化と同時に「アップストリーム追従手順」を README に明記 |
| データは移行不可 | dev はダミー・prod は実データ。最初から育てる場所 = 本番 |
| 新入生の発表の時間を奪わない | 冷やかし枠なので発表は短く・話のネタ中心 |

---

## 調査メモ: 認証まわり（2026-08-07・保留）

- 現状: パスワード方式。保存は **SHA-256 二重ハッシュ**（ソルトなし・KDF なし・2FA なし）。サインアップは /admin → Access で OFF 可能（未実施）
- 懸念: パスワード保存が弱い / 誰でもアカウント作成できる
- 選択肢:
  - A: サインアップ OFF（即効・無リスク）
  - B: Cloudflare Access サインイン（issuer/audience 設定・標準機能）。IdP 候補: Email OTP（低コスト）/ GitHub（org なし → 個別メール allowlist）/ Discord（カスタム OIDC、実測で discovery OK）
  - C: Discord「サーバー部員限定」は OIDC だけでは不可（bot メンバー検証が必要 = DIY・将来課題）
- 制約: GitHub org なし / **認証切替は既存アカウントデータ引き継ぎ不可**（username キー → email キー）→ 部員公開前が最後の移行チャンス
- 決定: **保留**。ハッカソン 2 日前のためデモを壊さない優先。ハッカソン後・部員公開前に再検討

## 決済事項（確定済み）

- [x] デモの主役 = **B: コア デモ（issue→自動PR→デプロイ 1 サイクル）+ エージェントバンク MVP の二本立て**（2026-08-06 選択）
- [x] GitHub repo は private で進める
- [x] dev 環境は同じアカウントの 2 つ目のデプロイ（os-dev.cherie-lab.com）
- [x] 目玉カスタム = **エージェントシステム再編（宣言的エージェント定義）**（2026-08-07・ユーザー指示）

---

## エージェントシステム再編（宣言的エージェント定義）— 2026-08-07

### やること
1. バックエンドのエージェントシステム再編
2. フロントエンドでの DO 接続と UI の設定
3. 最終的な動作

### 実装計画
詳細なタスクレベル計画 = **`docs/implementation-agent-definition.md`**（T1-T7・新セッションでそのまま着手可能）

### 設計（シーケンス図 `docs/agent-tools-sequence.svg` 参照）

| # | 変更箇所 | 内容 |
|---|---|---|
| 1 | **workshop-shared** | `AgentDefinition` 型 + CRUD RPC（get / save / reset）。形式 JSONC。フィールド: `prompts[]` / `skills[]` / `model?` / `tools.enabled[]` |
| 2 | **overseer.ts（OverseerDO）** | 定義を storage に保存（ワークスペース 1 つ = 1 定義）。API + バリデーション |
| 3 | **agent.ts** | ①buildAgent 時に定義を読み込み ②**tools を `definition.tools` でフィルタ**（spawnerConfig 分岐 @2834 と同じ機構）③prompts 断片を**動的スロット**（systemPromptSlots[1]）に注入（静的スロットは汚さない）④skills はまず「断片展開 + Context コレクション参照」 |
| 4 | **server.ts** | RPC ルート追加 |
| 5 | **workshop-frontend** | 「Agent」タブ（エディタ + プレビュー + リセット） |
| 6 | **テスト** | バリデーション + フィルタのユニットテスト / ビルド担保 |

### 設計の要（既存機構の再利用）
- **ツール制御は spawnerConfig と同じ機構**（agent.ts:2834 に実績）→ 新発明しない
- **プロンプトは動的スロット注入**（systemPromptSlots[1]）→ プロンプトキャッシュ維持
- **定義は OverseerDO の storage**（新 DO 不要）→ 共有が必要になったら定義 ID キーの DO に分離（Blueprint と同じパターン）
- **スキルは 3 段階**: 断片 → Context コレクション参照 → ツール化（後）

## 改訂 2026-08-08: develop 廃止（trunk-based へ移行)

上記「ブランチ戦略」「開発環境」の節は旧構成。現在は:

- ブランチ: `main`(本番) / `feature/*` のみ。`develop` と常設 dev 環境
  (deployment.dev.jsonc / os-dev.cherie-lab.com / `*-dev` workers) は廃止。
- main へは任意ブランチから PR(直接 push 禁止)。本番反映は Environment `production`
  の承認ゲートで人間が制御。
- ブランチごとの確認は PR 単位の ephemeral preview 環境で置き換える(実装予定)。
