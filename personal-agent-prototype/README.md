# Personal Agent Prototype

単一チャット UX と、Home Server 上の Codex を非同期実行する control plane の試作です。

## Home Server 接続

1. Web アプリで **Devices** を開きます。
2. 表示された起動コマンドをコピーします。
3. Home Server で実行します。
4. Home Worker は外向き HTTPS 通信だけを行い、control plane から Task を取得します。

Home Server では事前に Codex CLI の認証を済ませてください。Worker は `@openai/codex-sdk` を使用します。

接続経路だけ確認する場合は、起動コマンドに `MOCK_CODEX=1` を追加できます。

## Cloudflare

`personal-agent-prototype-yutaro` という独立 Worker としてデプロイします。既存の `os.cherie-lab.com` 用 Worker には触れません。

デプロイは `codex/personal-agent-prototype` ブランチ専用の GitHub Actions workflow から実行します。
