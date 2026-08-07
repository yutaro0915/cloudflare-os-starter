#!/usr/bin/env bash
# deploy-status.sh — デプロイ状態の正確な確認
#
# なぜこれを使うか（2026-08-07 の確認ミス防止）:
#   - `wrangler deployments list` を head/tail で切り詰めると最新を逃す（古い順→新しい順の出力）
#   - GitHub Actions の成否で「デプロイされていない」と判断してはいけない（ローカルデプロイがあり得る）
#   このスクリプトは Cloudflare の deployments API（JSON・新着順）を直接叩き、先頭要素を最新として
#   表示する。順序や切り詰めに依存しない。
#
# 使い方:
#   scripts/deploy-status.sh dev          # 開発環境の全 worker
#   scripts/deploy-status.sh prod         # 本番環境の全 worker
#   scripts/deploy-status.sh <worker名>   # 個別 worker（例: cloudflare-os-workshop-dev）
#
# 必要なもの: CLOUDFLARE_API_TOKEN（無ければ ~/.cloudflare-os/ci-token を読む）と CLOUDFLARE_ACCOUNT_ID

set -u
cd "$(dirname "$0")/.." || exit 1

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-495d8f7ad5d97ab5254043eda39ff698}"
TOKEN="${CLOUDFLARE_API_TOKEN:-$(cat ~/.cloudflare-os/ci-token 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN がありません（~/.cloudflare-os/ci-token も無し）" >&2
  exit 1
fi

DEV_WORKERS="cloudflare-os-workshop-dev cloudflare-os-context-dev cloudflare-os-custom-dev cloudflare-os-error-reporter-dev"
PROD_WORKERS="cloudflare-os-workshop cloudflare-os-context cloudflare-os-custom cloudflare-os-error-reporter cloudflare-os-model-relay"

case "${1:-}" in
  dev)  WORKERS=$DEV_WORKERS ;;
  prod) WORKERS=$PROD_WORKERS ;;
  "")   echo "使い方: $0 dev | prod | <worker名>" >&2; exit 1 ;;
  *)    WORKERS="$1" ;;
esac

echo "アカウント: $ACCOUNT_ID"
echo "確認時刻:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "------------------------------------------------------------"

FAIL=0
for worker in $WORKERS; do
  # deployments API（JSON・新着順）: 先頭要素 = 最新デプロイ
  out=$(curl -s -m 15 -H "Authorization: Bearer $TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$worker/deployments?per_page=1" \
    | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if not d.get('success'):
        print('API_ERROR')
    else:
        deploys = d.get('result', {}).get('deployments', [])
        if not deploys:
            print('NO_DEPLOYMENTS')
        else:
            x = deploys[0]
            print(x.get('created_on', 'UNKNOWN'))
except Exception as e:
    print('PARSE_ERROR')
" 2>/dev/null)

  printf '%-40s latest_deploy=%s\n' "$worker" "$out"
  echo "------------------------------------------------------------"
done

echo "完了（最新デプロイが確認時刻付近なら稼働中。古ければ未デプロイ/失敗の可能性）"
exit $FAIL
