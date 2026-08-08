# Tech News Gatekeeper (Zenn & Qiita)

Read-only gatekeeper exposing Japanese tech news to agents as an auto-provisioned
singleton (`NewsSession`, suggested binding `NEWS`). Built on the starter's
custom-gatekeeper skeleton; the Durable Object class keeps the original
`CustomGatekeeper` name so no migration is needed.

## What agents can do

- `listTrending({site?, limit?})` — Zenn / Qiita trending (both interleaved by default)
- `listTopic(site, topic)` — latest per topic/tag (e.g. `"llm"`)
- `listAuthor(site, username)` — latest per author
- `readArticle(url)` — full body (Qiita: Markdown via API v2; Zenn: text extracted
  from `body_html` via the unofficial `zenn.dev/api`)

Every method records an observation via `authorizeObservation()` before returning.
There are no actions and no credentials.

## Data sources

- Zenn: unofficial JSON API (`https://zenn.dev/api/articles`); may change without notice.
- Qiita: official API v2 (unauthenticated, 60 req/h per IP) and the
  `popular-items/feed` Atom feed for trending.

## Observer policy

All data served is public (zenn.dev / qiita.com), so observer tracking is a no-op
(strategy D) and `CustomVerifier.verify()` accepts every observer. Do not copy this
policy for non-public data.

## Check

```sh
pnpm test
pnpm run types:check
pnpm exec wrangler deploy --dry-run
```
