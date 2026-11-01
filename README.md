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
| `api/market/config` | `{market, collections, startBlock, complete}` (same shape as the website's `/api/market/config`) |
| `status.json` | Last run time, indexed block and last error per collection |
| `data/indexer.sqlite` | The indexer's database (events, checkpoints, verified owners) |

Read it at `https://raw.githubusercontent.com/Asentifyxx13/asentify-market-data/data/<file>` (CORS open, cached ~5 minutes).

The `data` branch is replaced by a single new commit on every run, so the repository does not grow.
If it is deleted, the next run rebuilds everything from block 930,000 (about 45 minutes).

## Operating it

- **Run now:** Actions tab → *index* → *Run workflow*.
- **Stopped running?** GitHub disables scheduled workflows after 60 days without repository activity. Re-enable it
  in the Actions tab (*Enable workflow*). The website shows *Out of date* when the data stops updating.
- **Start over:** delete the `data` branch, then *Run workflow*.
- **Change addresses or start block:** edit the `env:` block in `.github/workflows/index.yml`.

## Source

`indexer/asentify-indexer.mjs` is a bundled build of the indexer in the Asentify repository (private), branch
`indexer/receipts-source`; the first line names the exact commit. It only reads the chain and sends no transactions.
