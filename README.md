# Asentify indexer backups

Weekly copies of the indexer database (`backups/indexer-YYYY-MM-DD.sqlite`, newest 12 kept).
`backups/latest.json` describes the newest one. Each copy passed SQLite's integrity check and
had at least as many events and as high an indexed block as the previous copy.

The `index` workflow restores the newest copy automatically if the `data` branch is missing.
To restore an older copy by hand: put it at `data/indexer.sqlite` on the `data` branch.
