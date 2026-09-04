# Personal Agent Prototype

単一チャット UX と、Home Server 上の Codex を非同期実行する control plane の試作です。

## Home Server 接続

1. Web アプリで **Devices** を開きます。
2. 表示された起動コマンドをコピーします。
3. Home Server で実行します。
4. Home Worker は外向き HTTPS 通信だけを行い、control plane から Task を取得します。

Home Server では事前に Codex CLI の認証を済ませてください。Worker は `@openai/codex-sdk` を使用します。

既定の実行権限は `read-only`、ネットワーク無効です。対象ワークスペースへの書き込みを許可する場合だけ `ALLOW_WRITE=1`、Codex 自身の外部通信を許可する場合だけ `ALLOW_NETWORK=1` を起動環境へ明示します。Control Plane との外向き HTTPS 通信は常に必要です。

Linux で `bubblewrap` を利用できず Codex の隔離起動に失敗する環境では、`CODEX_LEGACY_LANDLOCK=1` で互換用 Landlock 経路を選べます。システム全体のユーザー名前空間制限を無効化する必要はありません。

接続経路だけ確認する場合は、起動コマンドに `MOCK_CODEX=1` を追加できます。

## Cloudflare

`personal-agent-prototype-yutaro` という独立 Worker としてデプロイします。既存の `os.cherie-lab.com` 用 Worker には触れません。

デプロイは `codex/personal-agent-prototype` ブランチ専用の GitHub Actions workflow から実行します。
