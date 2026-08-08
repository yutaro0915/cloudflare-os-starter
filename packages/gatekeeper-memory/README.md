# Agent Memory Gatekeeper

Private long-term memory banks for agents. Auto-provisioned, resource-typed:
each bank is addressed as `memory://bank/<bankId>` and wired to an agent through
its Agent definition (the resource is not `grantable`, so it never appears in
the resource picker, and the account has no singleton, so it is never
ambient-folded into ordinary chats).

## What agents can do (`MemorySession`, suggested binding `MEMORY`)

- `remember({topic, content, id?})` — create or update an entry
- `recall({query?, topic?, limit?})` — search, newest first
- `forget(id)` — delete an entry
- `listTopics()` — overview of topics with counts

Limits: 1000 entries per bank, 8 KB per entry.

## Approval model

Reads are observations. Writes (`remember` / `forget`) are actions with kind
`memory-write`, auto-approvable (opt-in per user); every write stays in the
action log. Writes are simulated: pending actions overlay reads, the real
mutation happens in `applyAction()`, and reverts restore the recorded previous
entry.

## Observer policy

Strategy B: banks are private to the owning account. `addObserver()` accepts
only verifiers minted from the same account (`getMemoryAccountId()` match) and
rejects everyone else — v1 has no sharing.

## Check

```sh
pnpm test
pnpm run types:check
pnpm exec wrangler deploy --dry-run
```
