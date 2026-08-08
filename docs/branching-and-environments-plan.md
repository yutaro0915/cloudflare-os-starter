# 実装計画: feature ごとの preview 環境と main=本番候補ライン

- 日付: 2026-08-08
- 状態: 承認済み・着手前
- **規範の正本**: cloudflare-os `.github/agents/rubrics/flow.md`(決定の経緯・却下案含む)。
  本ファイルは実装の段取りと進捗だけを持ち、規範は一切ここに書かない。
- 旧計画: `docs/self-improvement-loop-plan.md`(Phase 0-2 の記録として凍結。
  ブランチ・環境モデルは flow.md が上書きする)

## 全体像(rubrics/flow.md の要約、正本はそちら)

feature PR ごとに専用の preview 艦隊を立ち上げて実機確認 → 証跡を PR に添付 →
merge train が main へ直列マージ → starter の gitlink は「os main 上の SHA」だけを
人間承認付きで pin → production。共有 dev 環境は持たない。

## 前提(ユーザー操作、着手前に必要)

- [ ] cloudflare-os PR #6・starter PR #1 のマージ(trunk-based 移行の土台)
- [ ] starter main protection から旧必須チェック `pr-from-develop` を除去
- [ ] cloudflare-os repo に secrets 登録: `CLOUDFLARE_API_TOKEN`(preview デプロイ用。
      Workers 編集権限)、`CF_AI_GATEWAY_API_TOKEN`(preview の AI 用)
- [ ] `REPO_SYNC_TOKEN`(既出。bump 自動化用、starter Contents/PR RW)

## Phase A: preview 環境の立ち上げ・撤去(cloudflare-os 側)

1. **preview-env.yml**(on: pull_request opened/synchronize):
   starter main を checkout → submodule を PR head SHA に向ける →
   雛形(旧 deployment.dev.jsonc を starter 履歴から復元・整理)から
   worker 名 suffix `-pr-<N>` 付きの設定を生成 → `deploy.mjs` でデプロイ →
   PR に URL を sticky コメント。concurrency: `preview-pr-<N>`(cancel あり)
2. **preview-teardown.yml**(on: pull_request closed):
   `wrangler delete` で当該 suffix の worker 一式を削除。
   取りこぼし対策に日次の孤児掃除(open PR に対応しない `-pr-*` worker の削除)も同居
3. **シード投入**: デプロイ後 step で管理 API(または seed スクリプト)により
   テストアカウントを作成(signup OFF のため必須)。認証情報は GH secrets の
   `CI_SEED_USERNAME` / `CI_SEED_PASSWORD`
4. 検証: テスト PR で「立ち上げ → URL 応答 200 → ログイン可 → close で全 worker 消滅」

## Phase B: 証跡の組み込み

5. playwright-repro skill / repro playbook を「preview URL に対して実行」前提に改訂
   (ローカル起動は fallback に降格)。録画・スクショは pr-assets ブランチ + raw URL で
   PR 本文へインライン表示
6. claude-fix の prompt に「PR 作成後、preview 環境で確認し証跡を貼る」を追加
   (規範は flow.md / fix.md 参照のまま、手順参照だけ足す)

## Phase C: 本番 pin の堅牢化(starter 側)

7. bump-submodule.yml に **ancestor 検査**を追加: 指定 SHA が cloudflare-os main の
   祖先でなければ拒否(flow.md の規範の機械強制)
8. starter main 一本化の残整理: bump を直接 push 方式へ(本番ゲートは Environment 承認に
   一本化)。※この点は PR 方式維持との比較でユーザー最終確認を取る

## Phase D: 通し実弾検証

9. 実 issue → agent-fix → PR + preview 環境 + 証跡 → automerge → train → main →
   bump → 承認 → production、を 1 サイクル通す

## リスク・制約(受け入れ済み、経緯は flow.md)

- worker 数は open PR 数に比例(上限 500/アカウント)。teardown 規律で管理
- preview は workers.dev URL(カスタムドメインは本番のみ)
- AI 応答系は preview でも実プロバイダ課金が発生しうる(Workers AI 無料枠構成を雛形に使う)
