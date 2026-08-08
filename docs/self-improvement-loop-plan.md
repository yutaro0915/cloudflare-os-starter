# 自己改善ループ計画 — バグ報告 → issue → 自動改修 → auto-merge → デプロイ

- 日付: 2026-08-08
- 状態: 承認済み・実施中
- 正本: 本ファイル（設計判断の経緯は LLMWiki セッションログ 2026-08-08）
- 関連: `PLAN.md`（コアデモ構想）、`docs/implementation-agent-definition.md`

## 全体像

```
[OS UI「Report a bug」]                        ← Phase 4（後回し・GH 側フロー完成後）
   └→ reportBug RPC → DO で dedupe → GitHub issue 起票 (label: auto-report)
[GitHub 上 — すべてネイティブ]
   triage workflow (issue opened):
     planner agent が分類 + 影響領域宣言をコメント → 自動修正可なら label: agent-fix
   claude.yml (label: agent-fix トリガ):
     claude-code-action が実装 → 再現/検証（wrangler dev + Playwright）→ PR (base: develop)
     証跡: スクリーンショット = orphan ブランチ pr-assets へ push し raw URL でインライン表示、
           動画/trace = Actions artifact
   CI workflow: tsc / vitest / build
   自作 merge train: GREEN + automerge ラベルの PR を Actions concurrency で直列マージ
     （最新 develop を merge → CI 再実行 → GREEN のみマージ / 衝突 → needs-rebase）
   deploy workflow (develop push): repository_dispatch → starter が gitlink bump → dev デプロイ
   完了コメント → issue close → ループ還流（main / 本番昇格は人間レビュー必須のまま）
```

## 確定した設計判断

- 実行基盤: **claude-code-action（GitHub ネイティブ、GA）を主**。Codex は PR レビュー
  （`@codex review`）とルーティン polling の副として併用可（issue 起票経路は既知不具合あり）
- リポジトリ: **両 repo（starter + cloudflare-os）を public 化**。画像インライン表示・
  Actions 無料枠・upstream 追従の実利のため（ユーザー決定 2026-08-08）
- merge queue: GitHub ネイティブ版は個人 repo で使用不可 → **自作 merge train**
  （Actions `concurrency` グループを mutex に使う。学習目的も兼ねる）
- 並行時の競合: 宣言ベース楽観ロック（triage が影響領域を issue にコメント、重複領域は
  `blocked-by` で待機）+ merge train の事後解決の二段構え。将来のサークルメンバー並行開発にも
  同じ train / CI を適用（人間もエージェントも develop への道は一本）
- 再現・検証: エージェントに **Playwright 再現スクリプトを書かせる**のを正本とする
  （修正前 FAIL → 修正後 GREEN → 回帰テストへ昇格）。スクリーンショットは人間レビュア向け補助
- ラベル状態機械: `auto-report → agent-fix → in-progress → needs-rebase / needs-human → done`
- ガードレール: issue 1 件あたり試行 2 回まで / エージェントは workflow・secrets・deploy 設定を
  変更禁止（CODEOWNERS + 変更ファイル検査）/ dev デプロイ後 smoke test FAIL で自動 revert /
  日次ディスパッチ回数上限

## public 化の前提条件（必須・この順）

1. **履歴監査**: gitleaks 等で 2 repo の全履歴をスキャン。deployment*.jsonc の内容確認。
   クリーン確認後にのみ public 化する（公開後の修正は手遅れ）
2. **サインアップ OFF**: 認証対策 A 案（PLAN.md 調査メモ）。public 化とセットで実施。
   Access 移行の判断は引き続き保留

## セキュリティ（public 化後のフロー防御）

- claude-code-action の起動は **write 権限保持者のみ**（既定を維持）。バグ報告 bot は専用
  PAT に write を付与
- 第三者 issue 本文は「命令」でなく調査対象データとして扱う旨を triage プロンプトに明記
- fork PR に secrets を渡さない GitHub 標準挙動を維持
- CI 用テスト認証情報は使い捨てを GitHub secrets に置く（dev/prod と共用しない。
  Keychain は runner に無い）

## 実装フェーズ

- [x] **Phase 0: public 化準備** — ①履歴監査（gitleaks、両 repo クリーン。検出 4 件は
      upstream 由来のテスト用ダミー値のみ）→ ②サインアップ OFF（ユーザー実施 2026-08-08）
      → ③両 repo public 化（2026-08-08）
- [ ] **Phase 1: ネイティブ配線** — 2026-08-08 大部分完了:
      CI workflow GREEN（cloudflare-os、build→lint→test。fresh checkout は build 先行が必須）、
      issue テンプレート、develop push → dev 自動デプロイ成功（run 31236327168。失敗原因は
      private submodule の clone 不可 + pnpm 二重指定で、public 化 + packageManager 準拠で解消）、
      本番ゲート = GitHub Environment `production`（required reviewer: yutaro0915。main deploy は
      承認待ち `waiting` になることを確認）。
      残: claude-code-action 導入（`/install-github-app`、
      アカウント承認が必要）+ CI workflow（tsc/vitest/build）+ develop push → dev 自動デプロイ
      （repository_dispatch で starter へ連携）。手動 issue → 自動 PR → 手動マージ → 自動デプロイ
      が通ることを確認。issue テンプレート（再現手順・期待/実際・環境）もここで作成
      （後の reportBug RPC の仕様書を兼ねる）
- [ ] **Phase 2: merge train** — 自作 train workflow + reconciler 再依頼（`@claude` に rebase
      衝突解決を再依頼、2 回失敗で needs-human）+ ガードレール実装
- [ ] **Phase 3: 検証・証跡** — claude.yml に検証手順（wrangler dev 起動 → シード → Playwright）
      と証跡規約を組み込み。pr-assets orphan ブランチ整備。再現スクリプト → 回帰テスト昇格の運用
- [ ] **Phase 4: ハブ側バグ報告** — OS UI「Report a bug」+ reportBug RPC + 指紋 dedupe +
      issue 自動起票
- [ ] **Phase 5: triage planner** — 分類 + 影響領域宣言 + blocked-by 自動付与

## 制約・注意

- AI 応答が絡むバグは CI で実モデルを呼べない（モック or UI/接続層バグに限定して適用）
- private 中は PR コメントの画像インライン表示不可（public 化で解消。それまでは blob リンク）
- Actions: public repo は無料枠無制限、private は月 2,000 分
- 本番（os.cherie-lab.com）昇格は常に人間承認ゲート
