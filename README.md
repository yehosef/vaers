# VAERS Dashboard (DuckDB + Node)

An interactive dashboard over the U.S. **Vaccine Adverse Event Reporting System**
([vaers.hhs.gov](https://vaers.hhs.gov/)) — a DuckDB build pipeline, an Express API, and a Vue 3
dashboard. Covers **1990–2026 + NonDomestic** (~2.68M cases) at one current vintage.

![Original Grafana dashboard](media/VAERS-ES-Grafana.gif)

## Background

VAERS publishes its data as raw yearly CSVs — useful, but awkward to explore. The original 2019
project (still in git history) made it explorable by loading the CSVs into Elasticsearch and
putting Grafana on top. That worked, but it meant running two heavyweight services, and the
setup drifted out of reproducibility as the data grew.

This 2026 reboot keeps that dashboard experience and drops the infrastructure: DuckDB reads the
CSVs directly, so the whole stack is a build script, an API, and a frontend — one command, no
services to operate. The goals are **reproducibility** (any clone rebuilds the identical DB from
one published bundle), **honest counting** (VAERS's 2025 follow-up reports are collapsed into
cases so nothing is double-counted — see below), and keeping the fast, linked-panel filtering of
the Grafana original.

## Quick start

```bash
bun run dev            # → http://localhost:3000   (Ctrl-C stops both servers)
```

That's it — it installs deps, downloads the ~560 MB data bundle, builds the database, and
starts both servers. First run takes a few minutes; after that it's instant.

**Needs:** [Bun](https://bun.sh), Node, the `unzip` CLI (preinstalled on macOS; `apt-get install
unzip` on Debian/Ubuntu), and **~15 GB free disk during the build**, settling at **~10 GB**
(9.3 GB database + the 560 MB bundle). Setup deletes the extracted CSVs and transcode cache
(~5 GB of scratch) once the database is built — re-extracted from the bundle if you rebuild.
Pass `--keep-csvs` to `bun run setup` to keep them.

The data is **not in git** — it's a [Release asset](https://github.com/yehosef/vaers/releases),
so the clone stays ~10 MB. Set `BUNDLE_URL` to override the source.

<details>
<summary>Manual steps / individual commands</summary>

```bash
bun install && (cd server && npm install) && (cd web && npm install)
bun run setup     # download + unzip the bundle + build the DB
bun run server    # http://localhost:3001   (API)
bun run web       # http://localhost:3000   (dashboard; proxies /api → 3001)
```

> The server opens the DB **READ_ONLY** — stop it before rebuilding. DuckDB allows one writer
> or many readers, not both.
</details>

## The dashboard

One filter context — free-text/VAERS-ID query, multi-select VAX TYPE, ad-hoc `field op value`
filters, a VAX_DATE range, and an underreporting `rate` — drives eight linked panels: cases per
year, total, onset day, vax types, dose count, reactions, age buckets, and a paginated case
table. **Click any row** for a modal with the primary report plus every follow-up.

- **Query**: all-digits = exact VAERS_ID (zero-padding agnostic — `25006` finds `0025006`);
  text searches the narrative.
- **Ad-hoc filters** adapt per field: low-cardinality fields (STATE, SEX, `FOLLOWUP_COUNT`) get
  a dropdown; wide numerics (AGE_YRS) get a range. E.g. `FOLLOWUP_COUNT > 0` surfaces the ~60k
  multi-report cases.
- **rate** scales counts by `100 / rate` to simulate underreporting (VAERS captures an
  estimated 1–10% of events).

## Data model — cases, not report submissions

Since **May 8, 2025** VAERS files include *secondary reports*: follow-ups for a case already
reported. They are **not new adverse events**, and they reuse the case's VAERS_ID. Files mark
this with an **`ORDER`** column (1 = primary, >1 = follow-up).

To avoid double-counting, `reports` is **one row per case** (`REPORT_ORDER = 1`), each carrying
a `FOLLOWUP_COUNT`; every follow-up row is preserved in `vaersdata` and shown in the case modal.

### Data manipulations

The dashboard does **not** show raw VAERS rows. The raw CSVs land untouched in `vaersdata` /
`vaersvax` / `vaerssymptoms`; the `reports` model layered on top applies these changes (ported
from the original 2019 PHP importer, in `pipeline/sql/build_reports.sql`):

- **Encoding** — CSVs are transcoded windows-1252 → UTF-8 on import.
- **Primary reports only** — `reports` keeps `REPORT_ORDER = 1`; follow-ups are excluded from
  every count (kept in `vaersdata`). `NUM_VAX`/`VAX_TYPES` aggregate the primary's vaccines only.
- **`NUMDAYS`** — uses the stored value; if absent, derives `|ONSET − VAX|`. The absolute value
  silently "fixes" onset-before-vaccination rows rather than flagging them, and values
  **>10000 days are dropped to NULL** as implausible.
- **`clean_nullable`** — 24 null-like strings (`"none"`, `"n/a"`, `"unknown"`, …) in the history
  fields (OTHER_MEDS, CUR_ILL, HISTORY, ALLERGIES, LAB_DATA) become NULL.
- **`REACTIONS`** — a derived list from the 8 outcome booleans (DIED, HOSPITAL, L_THREAT,
  DISABLE, ER_VISIT, ER_ED_VISIT, X_STAY, plus `!RECOVED` when `RECOVD = 'N'`).
- **`HAS_DATA`** — which history fields survived `clean_nullable`.
- **`rate`** — a *display-time* multiplier (`100 / rate`) you choose in the UI; it scales counts
  to model underreporting and is **not** part of the stored data.

## Layout

```
pipeline/   DuckDB build (bun): dev.js · setup.js · import.js · build.js · sql/
server/     Express API over DuckDB, port 3001
web/        Vue 3 + Vite + Observable Plot, port 3000
datasets/   bundle + extracted CSVs (git-ignored)
data/       generated: vaers.duckdb + cleaned/ (git-ignored)
```

## API

`POST /api/dashboard` (all eight panels in one round trip) · `POST /api/cases` (paginated) ·
`GET /api/case/:id` · `GET /api/field-values?field=X` · `GET /api/filters/vax-types` ·
`GET /api/status`. Ad-hoc fields/operators are whitelisted; all input is bound parameters.

## Updating the data

VAERS updates weekly; the bundle is a point-in-time snapshot. Download a year's zip from
[vaers.hhs.gov](https://vaers.hhs.gov/data/datasets.html) (captcha-gated), then:

```bash
cp ~/Downloads/2026VAERSData.zip datasets/   # applied over the bundle
bun run setup                                # stop the server first; full rebuild
```

Faster incremental path (skip the full rebuild):

```bash
unzip -o -j ~/Downloads/2026VAERSData.zip '*VAERS*.csv' -d datasets/VAERS/data
bun pipeline/import.js --append --files 2026VAERSDATA.csv 2026VAERSVAX.csv 2026VAERSSYMPTOMS.csv
bun pipeline/build.js --skip-import          # rebuild just the reports model (~25 s)
```

`--append` replaces a file's prior rows (matched by filename), so re-importing is idempotent.
Pass **all three** of that year's files — a data-only append leaves NUM_VAX/VAX_TYPES stale —
and only use it to refresh the **current** year within the same vintage. **When in doubt, the
full `bun run setup` rebuild is always correct.**

## About the data

VAERS is a voluntary, passive system; reports can be filed by anyone and are **unverified**. A
report is **not** proof a vaccine caused an event. See the VAERS Data Use Guide (in `datasets/`)
for official disclaimers. Known quirks: onset dates before vaccination dates, missing NUMDAYS,
reports without a VAX_DATE, vague free-text.

---
Original project & data curation: Yehosef Shapiro (yehosef at gmail).
