# VAERS Dashboard (DuckDB + Node)

An interactive dashboard over the U.S. **Vaccine Adverse Event Reporting System**
([vaers.hhs.gov](https://vaers.hhs.gov/)). This repo ships all the source CSVs (via git LFS)
and a self-contained stack — a DuckDB build pipeline, an Express API, and a Vue 3 dashboard —
so you can rebuild the database and explore the data with one command and two servers.

It's a reboot of the original 2019 project (PHP → Elasticsearch 6 → Grafana, preserved in git
history). The dashboard reproduces that Grafana experience: one shared filter context driving
eight linked panels, plus a drill-down into each case's report history.

![Original Grafana dashboard](media/VAERS-ES-Grafana.gif)

*(The GIF is the original Grafana dashboard — the behavioral target this rewrite reproduces.)*

Data currently covers **1990–2026 + NonDomestic**, all at one current vintage
(~2.68M cases). Everything is JavaScript/SQL — no PHP, Elasticsearch, or Grafana.

## Architecture

```
datasets/
  AllVAERSDataCSVS.zip     the full 1990–present data bundle (git LFS, ~560 MB) — the ONLY
                           data file in the repo; extracted locally by setup, never committed
  <YEAR>VAERSData.zip      optional: a fresher current-year bundle, applied over the top
  VAERS/data/              git-ignored — CSVs extracted from the zip(s) by setup
pipeline/                  DuckDB build (bun)
  setup.js                 one command: unzip the bundle(s) + build the DB
  import.js                windows-1252 → UTF-8 transcode + read_csv into raw tables
  sql/build_reports.sql    denormalized `reports` + `reports_vax` dashboard model
  build.js                 import all CSVs + build the model
server/                    Express API over DuckDB (@duckdb/node-api), port 3001
web/                       Vue 3 + Vite + Observable Plot dashboard, port 3000
data/                      git-ignored, generated: vaers.duckdb + cleaned/
```

Only one data file is versioned — the zip bundle — so the repo stays small (fits GitHub's
free LFS tier). Everything else is generated locally from it.

## Quick start

```bash
git lfs pull                      # fetch datasets/AllVAERSDataCSVS.zip (~560 MB)

bun install                       # pipeline deps (root)
cd server && npm install && cd ..
cd web && npm install && cd ..

bun pipeline/setup.js             # unzip the bundle + build the DB (~2–3 min, ~2.68M cases)

cd server && npm start            # http://localhost:3001   (API)
cd web && npm run dev             # http://localhost:3000   (dashboard; proxies /api → 3001)
```

`setup.js` needs the `unzip` CLI (preinstalled on macOS; `apt-get install unzip` on
Debian/Ubuntu). It reports the sizes it produced when done.

### Disk footprint

| What | Size |
|------|------|
| `datasets/AllVAERSDataCSVS.zip` (in repo, LFS) | ~560 MB |
| extracted CSVs (`datasets/VAERS/data/`, git-ignored) | ~2.6 GB |
| `data/cleaned/` transcode cache (git-ignored, deletable) | ~2.6 GB |
| `data/vaers.duckdb` (git-ignored) | ~9.3 GB |

Budget **~15 GB free disk** for a full setup. `data/cleaned/` is a scratch cache and can be
deleted after the build.

> The server opens the DB **READ_ONLY**. Stop it before re-running the build —
> DuckDB allows one writer or multiple readers of a file, not both.

## The dashboard

One filter context — free-text/VAERS-ID query, **multi-select** VAX TYPE, adaptive ad-hoc
`field op value` filters, a VAX_DATE range, and an underreporting `rate` scale — drives eight
linked panels; every change reloads all of them (with a loading overlay):

- **VAERS EVENTS** — cases per year · **Total** (+ sparkline) · **Onset day** (0–19)
- **Vax Types** table · **Num Vacc.** (1–8) · **Reactions** pie · **Age** buckets
- **Case details** — paginated; `#VAX` cell colors by dose count; a `+N ↩` badge marks cases
  with follow-up reports. **Click any row** for a modal showing the primary + every follow-up
  report (order, received date, reporter, full narrative, outcomes).

Filter conveniences (matching the old Grafana UX):
- **Query**: an all-digits value is an exact **VAERS_ID** match (zero-padding agnostic —
  `25006` finds `0025006`); text searches the narrative (`SYMPTOM_TEXT`).
- **VAX TYPE**: multi-select with *All*, type-to-filter, and a *Selected (N)* header; several
  selected means "any of them" (OR).
- **Ad-hoc filters** query the data for each field's values: low-cardinality fields (STATE,
  SEX, REACTIONS, `FOLLOWUP_COUNT`, …) get a value dropdown; wide numerics (AGE_YRS, NUMDAYS)
  get a range input with a min–max hint. E.g. **`FOLLOWUP_COUNT > 0`** surfaces the ~60k
  multi-report cases.
- **rate** multiplies every count by `100 / rate` to simulate underreporting (VAERS captures
  an estimated 1–10% of events).

## Data model — counting cases, not report submissions

Since **May 8, 2025**, VAERS public files include *secondary reports*: a follow-up report from
an additional source (provider, manufacturer) for a patient/vaccine/dose already reported.
These are **not new adverse events** — they re-report the same case. The files expose this via
a new **`ORDER`** column (1 = primary, >1 = follow-up), and secondaries **reuse the case's
VAERS_ID** (a case's rows can even span multiple year-files, bucketed by received date).

To avoid double-counting, the model counts **cases (primary reports)**:

- `import.js` captures `ORDER` as **`REPORT_ORDER`** (rows from older primary-only files
  default to 1).
- `reports` is **one row per case** (`REPORT_ORDER = 1`); vaccines are aggregated from the
  primary submission only. Each case carries **`FOLLOWUP_COUNT`**.
- Every follow-up row is preserved in `vaersdata` and surfaced through the case modal.

Derived fields ported from the original PHP importer: **NUMDAYS** (stored, else
`|ONSET − VAX|` with the onset-before-vax swap fix, dropping >10000), **REACTIONS** (list from
the 8 outcome booleans), **clean_nullable** (24 null-like history strings → NULL),
**HAS_DATA**, **NUM_VAX** / **VAX_TYPES**. `reports_vax` holds distinct `(VAERS_ID, VAX_TYPE)`
pairs (primary only) for the dropdown + Vax Types panel.

## API

- `POST /api/dashboard` — `{query, vax_types[], adhoc[], date_from, date_to, rate}` → all eight
  panel aggregates in one round trip (rate-scaled).
- `POST /api/cases` — same filters + `{limit, offset}` → paginated rows (with `FOLLOWUP_COUNT`).
- `GET  /api/case/:id` — every report row for one case (primary + follow-ups) for the modal.
- `GET  /api/field-values?field=X` — classify a field (`enum` / `numeric` / `text`) for the
  adaptive ad-hoc input.
- `GET  /api/filters/vax-types` · `GET /api/status`.

Ad-hoc fields/operators are whitelisted; list fields (`REACTIONS`, `VAX_TYPES`, `HAS_DATA`)
filter via `list_has_any` / `list_contains`. All user input is passed as bound parameters.

## Updating the data

VAERS updates weekly; the bundled zip is a point-in-time snapshot and does **not** auto-update.
To refresh a year (say the current one), download its zip from
[vaers.hhs.gov](https://vaers.hhs.gov/data/datasets.html) (captcha-gated) and either:

**Simple — drop it in and re-run setup:**

```bash
cp ~/Downloads/2026VAERSData.zip datasets/    # applied over the top of the bundle
# stop the server first (write lock)
bun pipeline/setup.js                          # re-extracts + full rebuild
```

Commit the small year zip (not the 560 MB bundle) so monthly updates stay cheap.

**Faster — incremental (skip the full rebuild):**

```bash
unzip -o -j ~/Downloads/2026VAERSData.zip '*VAERS*.csv' -d datasets/VAERS/data
# stop the server first
bun pipeline/import.js --append --files 2026VAERSDATA.csv 2026VAERSVAX.csv 2026VAERSSYMPTOMS.csv
bun pipeline/build.js --skip-import            # rebuild just the reports model (~25 s)
```

`--append` **replaces** a file's prior rows (matched by filename), so re-importing an updated
year is idempotent — no full re-import needed. The single **`AllVAERSDataCSVS.zip`** ("All
Years", ~560 MB) is one captcha for the entire history.

## About the data

VAERS is a voluntary, passive reporting system; reports can be filed by anyone and are
**unverified**. A report is not proof a vaccine caused an event. See the VAERS Data Use Guide
(in `datasets/`) for official disclaimers. Known quirks: onset dates before vaccination dates,
missing NUMDAYS, reports without a VAX_DATE, and vague free-text.

---
Original project & data curation: Yehosef Shapiro (yehosef at gmail).
