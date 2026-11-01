# asentify-market-data

Public market data for the Asentify NFT marketplace on the **Asentum testnet**, produced by Asentify's own indexer.
Everything here is derived from public, finalized blockchain events. There are no keys or secrets in this repository.

## What runs

`.github/workflows/index.yml` runs `indexer/asentify-indexer.mjs` every 10 minutes (GitHub may delay scheduled runs).
Each run reads the new finalized blocks of:

| | Address |
|---|---|
| Marketplace | `0xbb35f3e0dc49d568456b4e7a81fb25c6985af751` |
| Collection | `0x35162eafe0f1260c6a9a57291f5bdd79179cef82` |

from `https://testnet.asentum.com` (eth_getLogs in ≤ 500-block ranges, receipts as a fallback), checks token owners
on chain (`ownerOf`), and publishes the result on the **`data`** branch:

| File (branch `data`) | Content |
|---|---|
| `api/market/<collection>` and `api/market/<collection>.json` | Snapshot: floor, offers, sales, owners, supply, activity, with status labels |
| `api/market/config` | `{market, collections, startBlock, complete, discovered}`; `discovered` = collections people created, found through the marketplace (shown as Unverified on the site) |
| `status.json` | Last run time, indexed block and last error per collection |
| `api/market/collections.json` | `{verified, discovered}`: the listed collections and the ones people created, found through the marketplace |
| `data/indexer.sqlite` | The indexer's database (events, checkpoints, verified owners) |

Read it at `https://raw.githubusercontent.com/Asentifyxx13/asentify-market-data/data/<file>` (CORS open, cached ~5 minutes).

The `data` branch is replaced by a single new commit on every run, so the repository does not grow.

**Weekly backup:** `.github/workflows/backup.yml` copies the database to the **`backup`** branch every Sunday
(`backups/indexer-YYYY-MM-DD.sqlite`, newest 12 kept) through `indexer/backup.mjs`. A copy is made only if the
database passes SQLite's integrity check and has not gone backwards (fewer events or a lower indexed block than the
newest backup); otherwise the run fails, GitHub e-mails the owner, and the existing backups stay as they are. This
matters because the public gateway does not serve the whole chain (it starts at block 865,584), so blocks it stops
serving could not be read again.

If the `data` branch is deleted, the next run restores the newest backup and continues from its checkpoint.
With no backup either, it rebuilds everything from block 930,000.

## Operating it

- **Run now:** Actions tab → *index* → *Run workflow*.
- **Runs indefinitely:** GitHub disables scheduled workflows after 60 days without repository activity.
  `.github/workflows/keepalive.yml` re-enables all three scheduled workflows every Monday through the GitHub API, which resets that
  timer (no dummy commits). If it ever stops anyway, re-enable *index* in the Actions tab; the website shows
  *Out of date* about 30 minutes after the data stops updating.
- **Back up now:** Actions tab → *backup* → *Run workflow*.
- **Go back to an older backup:** put that `backups/indexer-….sqlite` at `data/indexer.sqlite` on the `data` branch.
- **Start over from scratch:** delete both the `data` and `backup` branches, then *Run workflow* on *index*.
- **Change addresses or start block:** edit the `env:` block in `.github/workflows/index.yml`.

## Source

`indexer/asentify-indexer.mjs` is a bundled build of the indexer in the Asentify repository (private), branch
`indexer/receipts-source`; the first line names the exact commit. It only reads the chain and sends no transactions.
