# VAERS — DuckDB build + dashboard

Two independent things over the U.S. **Vaccine Adverse Event Reporting System**
([vaers.hhs.gov](https://vaers.hhs.gov/)):

1. **Build** — turn VAERS's raw yearly CSVs into **one queryable DuckDB file**: transcoded,
   cleaned, and deduplicated into cases. Query it from SQL, pandas, or R — no server involved.
2. **Serve** — an Express API + Vue 3 dashboard over that file.

You can stop after the build; for many people the database *is* the useful part. Covers
**1990–2026 + NonDomestic** (~2.73M cases) at one current vintage.

![The VAERS dashboard](media/dashboard.png)

## Background

VAERS publishes its data as raw yearly CSVs — useful, but awkward to explore. The original 2019
project made it explorable by loading the CSVs into Elasticsearch and putting Grafana on top.
That worked, but it meant running two heavyweight services, and the setup drifted out of
reproducibility as the data grew.

![The original Elasticsearch + Grafana dashboard, 2019](media/VAERS-ES-Grafana.gif)

*The 2019 original (PHP → Elasticsearch → Grafana), still in git history — the behavioral target
this rewrite reproduces.*

This 2026 reboot keeps that dashboard experience and drops the infrastructure: DuckDB reads the
CSVs directly, so the whole stack is a build script, an API, and a frontend — one command, no
services to operate. The goals are **reproducibility** (any clone rebuilds the identical DB from
one published bundle), **honest counting** (VAERS's 2025 follow-up reports are collapsed into
cases so nothing is double-counted — see below), and keeping the fast, linked-panel filtering of
the Grafana original.

## Quick start

> ### ⚠️ Disk space
> This needs **~15 GB free while building**, settling at **~10 GB** once done (~9.3 GB database
> + the 560 MB bundle). The clone itself is only ~10 MB — the data is downloaded, not committed.
> Setup deletes the extracted CSVs and transcode cache (~5 GB of scratch) after the build;
> pass `--keep-csvs` to `bun run setup` to keep them.

**Needs:** [Bun](https://bun.sh), Node, and the `unzip` CLI (preinstalled on macOS; `apt-get
install unzip` on Debian/Ubuntu). The data is a
[Release asset](https://github.com/yehosef/vaers/releases); set `BUNDLE_URL` to override it.

### 1. Build — just the database

```bash
bun install
bun run setup          # downloads the bundle → data/vaers.duckdb  (~9 GB, ~15-20 min)
```

That's the whole build. Query it with anything that speaks DuckDB — no server, no Node:

```bash
duckdb data/vaers.duckdb "SELECT VAX_TYPE, count(*) FROM reports_vax GROUP BY 1 ORDER BY 2 DESC LIMIT 5"
```

```python
import duckdb
con = duckdb.connect('data/vaers.duckdb', read_only=True)
con.sql("SELECT AGE_YRS, SEX FROM reports WHERE DIED = 'Y'")
```

Tables: **`reports`** (one row per case, derived + cleaned — see
[Data manipulations](#data-manipulations)), **`reports_vax`** (distinct case ↔ vaccine-type ↔
manufacturer triples — count cases with `COUNT(DISTINCT VAERS_ID)`), **`symptoms`** /
**`reports_symptoms`** / **`symptom_bg`** (a dictionary of coded MedDRA terms, the distinct
case ↔ symptom pairs, and per-symptom background counts),
**`vaersdata`/`vaersvax`/`vaerssymptoms`** (the raw CSVs, untouched), and **`import_summary`** /
**`vaers_reject_errors`** (what was ingested, and which rows VAERS's own CSVs got rejected on).

```sql
-- most-reported symptoms for a vaccine type
SELECT s.SYMPTOM, COUNT(*) AS n
FROM reports_symptoms rs
JOIN symptoms s USING (SYMPTOM_ID)
WHERE rs.VAERS_ID IN (SELECT VAERS_ID FROM reports_vax WHERE VAX_TYPE = 'COVID19')
GROUP BY 1 ORDER BY n DESC LIMIT 10
```

### 2. Serve — the dashboard

```bash
bun run dev            # → http://localhost:3000   (Ctrl-C stops both servers)
```

Installs deps, runs the build above if the database isn't there yet (so a first run from a fresh
clone takes the ~15-20 minutes noted above), then starts the API and the dashboard together.
Once the database exists it starts in seconds.

<details>
<summary>Run the two servers separately</summary>

```bash
(cd server && npm install) && (cd web && npm install)
bun run server    # http://localhost:3001   (API)
bun run web       # http://localhost:3000   (dashboard; proxies /api → 3001)
```

> The server opens the DB **READ_ONLY** — stop it before rebuilding. DuckDB allows one writer
> or many readers, not both.
</details>

## The dashboard

Like the 2019 original's six Grafana dashboards, the reboot is a set of **focused views** under
one persistent shell. One filter context — free-text/VAERS-ID query, multi-select VAX TYPE,
ad-hoc `field op value` filters, a date range, and an underreporting `rate` — carries over in
full when you switch views; only the panel grid changes. Every view ends in the same sortable,
paginated case table: **click any row** for a modal with the primary report plus every
follow-up, its vaccines, symptom codes, and history fields. Most panels are also
**click-to-filter**: clicking a pie slice, age bar, symptom bar, or a manufacturer/state/
admin-by row adds the matching ad-hoc filter.

### Views

- **Overview** (`/`) — the general dashboard: events per year, total, onset day, vax types,
  dose count, reactions, age (buckets or single-year <20), symptoms.
- **People** (`/people`) — who is in the reports: age, sex, state, reactions, the coded-symptom
  panel, and which history fields each case carries.
- **Vaccine** (`/vaccine`) — the products: vax types, manufacturers, who administered and who
  funded, route/site/dose-series, and the **vaccine combinations** given together.
- **All Reports** (`/all`) — every report, plotted by **RECVDATE** (see below), with a
  **"No VAX_DATE only"** toggle isolating the ~11.5% of reports that have no vaccination date.
- **Data Quality** (`/data-quality`) — the reporting artifacts: report lag, deaths by DATEDIED
  vs by VAX_DATE year, VAX_DATE missingness, follow-up counts, and raw (uncleaned) lot numbers.

**Two date axes.** Most views plot events by **VAX_DATE** — when the vaccine was given. But
314k reports (~11.5%) have no VAX_DATE at all and can never appear on those charts. All Reports
therefore plots by **RECVDATE** — when VAERS received the report — where every report is
visible; the filter bar always shows which field the date range is bound to. (The 2019 original
solved this with two parallel dashboard sets on different datasources; the toggle is the honest
one-page version.)

The **Symptoms** panel is dual-mode: with no filters it shows the most-reported coded MedDRA
terms overall; once any filter is active it switches to *significant* terms — symptoms
over-represented in the filtered set vs the whole database (the JLH score Kibana used), which
surfaces what is *distinctive* about a selection rather than the generic terms that top every
list.

- **Query**: all-digits = exact VAERS_ID (zero-padding agnostic — `25006` finds `0025006`);
  text searches the narrative.
- **Ad-hoc filters** adapt per field: low-cardinality fields (STATE, SEX, `FOLLOWUP_COUNT`) get
  a dropdown; wide numerics (AGE_YRS) get a range. E.g. `FOLLOWUP_COUNT > 0` surfaces the ~68k
  multi-report cases.
- **rate** scales counts by `100 / rate` to simulate underreporting (VAERS captures an
  estimated 1–10% of events).

![Selecting a VAX TYPE](media/dashboard-vaxtype-select.png)

*VAX TYPE is a multi-select with type-to-filter — typing `COVID` narrows to COVID19/COVID19-2.*

![Filtered to COVID19](media/dashboard-covid19.png)

*Picking COVID19 reloads all eight panels: 2.73M → 1.63M cases, events collapse to 2020+, the
age profile shifts to adults, and Vax Types now lists what was co-administered.*

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
  every count (kept in `vaersdata`). `NUM_VAX`/`VAX_TYPES`/`VAX_COMBO` aggregate the primary's
  vaccines only.
- **`VAX_COMBO`** — the report's distinct vaccine types, sorted and joined with `::`
  (`DTAP::IPV::MMR`); single-vaccine reports carry the bare type. Backs the Vaccine view's
  combinations panel with a plain GROUP BY.
- **`NUMDAYS`** — uses the stored value; if absent, derives `|ONSET − VAX|`. The absolute value
  silently "fixes" onset-before-vaccination rows rather than flagging them, and values
  **>10000 days are dropped to NULL** as implausible.
- **`clean_nullable`** — 24 null-like strings (`"none"`, `"n/a"`, `"unknown"`, …) in the history
  fields (OTHER_MEDS, CUR_ILL, HISTORY, ALLERGIES, LAB_DATA) count as absent. The cleaned text
  itself is **not stored** — `reports.HAS_DATA` records which fields survived, and the
  `clean_null(x)` macro is persisted in the database so you (and the case modal) can apply the
  same rule to the raw `vaersdata` columns.
- **Reactions are plain columns** — the dashboard's "reactions" (DIED, HOSPITAL, L_THREAT,
  DISABLE, ER_VISIT, ER_ED_VISIT, X_STAY, plus `!RECOVED` when `RECOVD = 'N'`) are computed at
  query time from the outcome booleans; filter with e.g. `WHERE DIED = 'Y'`. (Earlier schema
  revisions materialized a `REACTIONS[]` list and a `SHORT_SYMPTOM_TEXT` excerpt; both are gone
  — the excerpt is computed per page of the case table.)
- **Symptoms are dictionary-encoded** — `symptoms` assigns each distinct coded MedDRA term a
  deterministic id (alphabetical `row_number`, so identical raw data rebuilds to identical
  ids); `reports_symptoms` holds the distinct case↔symptom pairs (primary submissions only,
  restricted to cases present in `reports`); `symptom_bg` holds each term's background count.
- **`rate`** — a *display-time* multiplier (`100 / rate`) you choose in the UI; it scales counts
  to model underreporting and is **not** part of the stored data.

## Layout

```
BUILD
  pipeline/setup.js   download bundle → extract → build → reclaim scratch
  pipeline/import.js  windows-1252 → UTF-8 transcode + read_csv into the raw tables
  pipeline/build.js   import every CSV + build the reports model
  pipeline/sql/       build_reports.sql — the derived reports / reports_vax / symptoms model
SERVE
  server/             Express API over DuckDB, port 3001
  web/                Vue 3 + Vite + Observable Plot, port 3000
  pipeline/dev.js     build-if-needed, then run both of the above together
datasets/             bundle + extracted CSVs (git-ignored)
data/                 generated: vaers.duckdb + cleaned/ (git-ignored)
```

## API

`POST /api/dashboard` (the requested panel aggregates in one round trip — the body's
`panels: []` names which of the ~27 registered panels to compute, so each view pays only for
its own; `date_field` picks the VAX_DATE/RECVDATE axis and `no_vaxdate_only` is the All Reports
toggle) · `POST /api/cases` (paginated + sortable) ·
`GET /api/case/:id` · `GET /api/field-values?field=X` · `GET /api/filters/vax-types` ·
`GET /api/status`. Panel keys, ad-hoc fields/operators and the date field are whitelisted
(unknown panel key → 400); all input is bound parameters.

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
Pass **all three** of that year's files — a data-only append leaves NUM_VAX/VAX_TYPES and the
symptom tables stale — and only use it to refresh the **current** year within the same vintage.
**When in doubt, the full `bun run setup` rebuild is always correct.**

The derived model's schema has revisions of its own (this vintage dropped the materialized
`REACTIONS[]`/`SHORT_SYMPTOM_TEXT`/cleaned-history columns and added the symptom tables), so a
database built from an older checkout differs from one built from this one — rebuild after
pulling if your queries hit the `reports` schema.

## About the data

VAERS is a voluntary, passive system; reports can be filed by anyone and are **unverified**. A
report is **not** proof a vaccine caused an event. See the VAERS Data Use Guide (in `datasets/`)
for official disclaimers. Known quirks: onset dates before vaccination dates, missing NUMDAYS,
reports without a VAX_DATE, vague free-text.

## License

Code: **BSD 3-Clause** — see [LICENSE](LICENSE). The VAERS data itself is a U.S. government
public-domain dataset and is not covered by that license; the bundle is redistributed as
published by [vaers.hhs.gov](https://vaers.hhs.gov/), and the derived `reports` model is
described under [Data manipulations](#data-manipulations).

---
Original project & data curation: Yehosef Shapiro (yehosef at gmail).
