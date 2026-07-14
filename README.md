# VAERS Dashboard (DuckDB + Node)

An interactive dashboard over the U.S. **Vaccine Adverse Event Reporting System**
([vaers.hhs.gov](https://vaers.hhs.gov/)) data. This repo ships all the source CSVs
(via git LFS) and a self-contained stack — a DuckDB build pipeline, an Express API, and
a Vue 3 dashboard — so you can rebuild the database and explore the data with one command
and two servers.

It's a reboot of the original 2019 project (PHP → Elasticsearch 6 → Grafana, preserved in
git history). The dashboard reproduces that Grafana experience: one shared filter context
driving eight linked panels.

![VAERS dashboard](media/VAERS-ES-Grafana.gif)

*(The GIF above is the original Grafana dashboard — the behavioral target this rewrite reproduces.)*

## Architecture

```
datasets/VAERS/data/     Source CSVs (1990–2019 + NonDomestic), git LFS
pipeline/                DuckDB build (bun)
  import.js                windows-1252 → UTF-8 transcode + read_csv into raw tables
  sql/build_reports.sql    denormalized `reports` + `reports_vax` dashboard model
  build.js                 one command: import all CSVs + build the model
server/                  Express API over DuckDB (@duckdb/node-api), port 3001
web/                     Vue 3 + Vite + Observable Plot dashboard, port 3000
data/                    generated, git-ignored: vaers.duckdb + cleaned/
```

Everything is JavaScript/SQL — no PHP, Elasticsearch, or Grafana. The database is a single
DuckDB file, fully rebuildable from the CSVs.

## Quick start

```bash
# 1. install deps (root = pipeline, server, web)
bun install
cd server && npm install && cd ..
cd web && npm install && cd ..

# 2. build the database from the CSVs (~a few minutes; ~722k reports)
bun pipeline/build.js

# 3. run the API and the dashboard (two terminals)
cd server && npm start          # http://localhost:3001
cd web && npm run dev           # http://localhost:3000
```

Open http://localhost:3000. (The Vite dev server proxies `/api` to the backend, so no CORS
setup is needed.)

> The database is opened **READ_ONLY** by the server. Stop the server before re-running
> `pipeline/build.js`, since DuckDB allows either one writer or multiple readers of a file,
> not both.

## The dashboard

One filter context — free-text query, VAX TYPE, ad-hoc `field op value` filters, VAX_DATE
range, and an underreporting `rate` scale — drives eight linked panels; every filter change
reloads all of them:

- **Total** report count (+ monthly sparkline)
- **Vaccination Date** — reports per year
- **Num Vacc.** — vaccines per report (1–8)
- **Onset day** — days from vaccination to symptom onset (0–19)
- **Age** — age buckets (0-1 … 60+)
- **Reactions** — outcome pie (ER_VISIT, HOSPITAL, DIED, …)
- **Vax Types** — top vaccine types by report count
- **Case details** — paginated raw reports; the `#VAX` cell reddens with vaccine count

The `rate` selector multiplies every count by `100 / rate` to simulate underreporting
(VAERS is estimated to capture only 1–10% of events), mirroring the original Grafana variable.

## Data model & preserved semantics

`pipeline/import.js` loads each raw CSV into `vaersdata` / `vaersvax` / `vaerssymptoms`
using DuckDB `read_csv_auto` (with `dateformat='%m/%d/%Y'` for domestic files and
`all_varchar` + `strptime` for the NonDomestic set), tagging each row with
`FILE_NAME` / `FILE_LINE_NO` / `IS_DOMESTIC` and preserving rejects. `--append` dedups on
`(VAERS_ID, FILE_NAME, FILE_LINE_NO)` for incremental year updates.

`pipeline/sql/build_reports.sql` then materializes the `reports` table, porting the derived
fields from the original PHP importer:

- **NUMDAYS** — stored value, else `|ONSET_DATE − VAX_DATE|` (with the onset-before-vax
  swap fix), dropping implausible values > 10000.
- **REACTIONS** — a list built from the eight outcome booleans (`DIED`, `HOSPITAL`,
  `ER_VISIT`, `!RECOVED`, …).
- **clean_nullable** — the 24 null-like history strings (`unknown`, `none`, `n/a`,
  `no known allergies`, …) collapsed to NULL across the five history fields.
- **HAS_DATA** — which history fields survive `clean_nullable`.
- **NUM_VAX** / **VAX_TYPES** — from the per-report vaccine rows; `reports_vax` holds the
  distinct `(VAERS_ID, VAX_TYPE)` pairs used by the vax-type dropdown and Vax Types panel.

## API

- `POST /api/dashboard` — `{query, vax_type, adhoc[], date_from, date_to, rate}` → all eight
  panel aggregates in one round trip (rate-scaled).
- `POST /api/cases` — same filters + `{limit, offset}` → paginated case-details rows.
- `GET /api/filters/vax-types` — vax types for the dropdown (frequency-ordered).
- `GET /api/status` — health + record counts.

Ad-hoc filter fields and operators are whitelisted; list fields (`REACTIONS`, `VAX_TYPES`,
`HAS_DATA`) filter via `list_contains`. All user input is passed as bound parameters.

## Updating the data

`~/Downloads` may hold newer year sets. To add years:

```bash
# stop the server first (read/write lock)
cp ~/Downloads/2020VAERS*.csv datasets/VAERS/data/     # check header parity for 2020+
bun pipeline/import.js --append --files 2020VAERSDATA.csv 2020VAERSVAX.csv 2020VAERSSYMPTOMS.csv
bun pipeline/build.js --skip-import                    # rebuild the reports model
```

New years 2020–2023, 2026, and refreshed 2025 / NonDomestic are captcha-gated downloads
from vaers.hhs.gov.

## About the data

VAERS is a voluntary, passive reporting system; reports can be filed by anyone and are
**unverified**. A report is not proof that a vaccine caused an event. See the VAERS Data Use
Guide (in `datasets/`) for the official disclaimers. Known data quirks: onset dates before
vaccination dates, missing NUMDAYS, ~80k reports without a VAX_DATE, and vague free-text.

---
Original project & data curation: Yehosef Shapiro (yehosef at gmail).
