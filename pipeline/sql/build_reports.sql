-- ===========================================================================
-- build_reports.sql — denormalized dashboard model.
--
-- Builds the serving tables from the raw import (vaersdata / vaersvax /
-- vaerssymptoms):
--   reports          : one row per VAERS report, with derived dashboard fields.
--   reports_vax      : distinct (VAERS_ID, VAX_TYPE, VAX_MANU) — vax-type
--                      dropdown, Vax Types + Manufacturers panels, MANU filter.
--   symptoms         : MedDRA symptom dictionary (deterministic USMALLINT ids).
--   reports_symptoms : distinct (case, symptom) pairs, primary submissions only.
--   symptom_bg       : per-symptom background counts over all of reports.
--
-- Derived-field semantics are ported from the old PHP importer
-- (import-data.php / import-vax.php): clean_nullable (24 null-like strings),
-- fix_numdays (stored-else-|onset-vax| with swap fix, >10000 cap), HAS_DATA,
-- NUM_VAX. The former REACTIONS[] list and SHORT_SYMPTOM_TEXT are computed at
-- query time from the outcome booleans / SYMPTOM_TEXT instead of stored.
--
-- The whole rebuild is one transaction: a failed build must not leave the
-- serving tables dropped. Invariant checks at the end abort the transaction
-- (error()) instead of committing a broken model.
--
-- No ART indexes: measured against the dashboard queries, zonemaps on the
-- date-clustered table beat the date indexes, joins/aggregations can't use
-- ART, and the only VAERS_ID equality path wraps the column in TRY_CAST.
-- ===========================================================================

-- clean_nullable: the exact 24 null-like expressions from import-data.php.
-- Persisted in the DB — the API's case modal applies it to raw vaersdata rows.
CREATE OR REPLACE MACRO clean_null(x) AS
  CASE WHEN x IS NULL THEN NULL
       WHEN trim(lower(x)) IN (
         'unknown','unk','na','no','n/a','none','none;','none.','none known',
         'no known allergies','nkda','nka','no known drug allergy',
         'no know drug or food allergies',
         'no allergies to medications, food, or other products',
         'none reported','none on file','not stated','no relevant history;',
         'no relevant history','no relevant hx','no relevant hx;','no relevant hx.',
         'no hx of drug allergy'
       ) THEN NULL
       WHEN trim(x) = '' THEN NULL
       ELSE x END;

BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- reports_vax: distinct report/vax-type/manufacturer triples.
-- Grain is (VAERS_ID, VAX_TYPE, VAX_MANU) — a case with the same VAX_TYPE from
-- two manufacturers contributes two rows. Every consumer that counts cases
-- MUST use COUNT(DISTINCT VAERS_ID), never COUNT(*).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS reports_vax;
CREATE TABLE reports_vax AS
  SELECT DISTINCT VAERS_ID, VAX_TYPE, VAX_MANU
  FROM vaersvax
  WHERE VAX_TYPE IS NOT NULL AND VAX_TYPE <> ''
    AND COALESCE(REPORT_ORDER, 1) = 1;  -- primary submission only

-- ---------------------------------------------------------------------------
-- reports: one row per vaersdata row (count parity preserved via 1:1 LEFT JOIN).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS reports;
CREATE TABLE reports AS
WITH vax_agg AS (
  SELECT
    VAERS_ID,
    COUNT(*)                                            AS NUM_VAX,
    array_sort(list(DISTINCT VAX_TYPE)
      FILTER (WHERE VAX_TYPE IS NOT NULL AND VAX_TYPE <> '')) AS VAX_TYPES
  FROM vaersvax
  WHERE COALESCE(REPORT_ORDER, 1) = 1                   -- primary submission's vaccines
  GROUP BY VAERS_ID
),
followups AS (   -- how many follow-up (secondary) reports exist per case
  SELECT VAERS_ID,
         COUNT(*) FILTER (WHERE COALESCE(REPORT_ORDER, 1) > 1) AS FOLLOWUP_COUNT
  FROM vaersdata
  GROUP BY VAERS_ID
)
SELECT
  d.VAERS_ID,
  d.RECVDATE,
  d.VAX_DATE,
  d.ONSET_DATE,
  d.DATEDIED,
  d.AGE_YRS,
  d.STATE,
  d.SEX,
  d.SYMPTOM_TEXT,

  -- NUMDAYS: stored else |ONSET - VAX| (swap fix via abs), drop implausible >10000.
  CASE
    WHEN d.NUMDAYS IS NOT NULL
      THEN CASE WHEN d.NUMDAYS > 10000 THEN NULL ELSE d.NUMDAYS END
    WHEN d.VAX_DATE IS NOT NULL AND d.ONSET_DATE IS NOT NULL THEN
      CASE WHEN abs(date_diff('day', d.VAX_DATE, d.ONSET_DATE)) > 10000 THEN NULL
           ELSE abs(date_diff('day', d.VAX_DATE, d.ONSET_DATE)) END
    ELSE NULL
  END                                                   AS NUMDAYS,

  -- Outcome / adhoc-filterable raw columns. The dashboard derives the old
  -- REACTIONS[] pseudo-values from these at query time (DIED='Y', RECOVD='N'…).
  d.DIED, d.L_THREAT, d.HOSPITAL, d.DISABLE, d.RECOVD,
  d.ER_VISIT, d.ER_ED_VISIT, d.X_STAY, d.BIRTH_DEFECT, d.OFC_VISIT,
  d.V_ADMINBY, d.V_FUNDBY,

  d.IS_DOMESTIC,
  coalesce(fu.FOLLOWUP_COUNT, 0)           AS FOLLOWUP_COUNT,
  coalesce(va.NUM_VAX, 0)                  AS NUM_VAX,
  coalesce(va.VAX_TYPES, []::VARCHAR[])    AS VAX_TYPES,

  -- HAS_DATA: which history fields survive clean_nullable (import-data.php
  -- has_fields). The cleaned text itself is NOT stored — the case modal reads
  -- raw vaersdata through the clean_null macro.
  list_filter([
    CASE WHEN clean_null(d.OTHER_MEDS) IS NOT NULL THEN 'OTHER_MEDS' END,
    CASE WHEN clean_null(d.CUR_ILL)    IS NOT NULL THEN 'CUR_ILL'    END,
    CASE WHEN clean_null(d.HISTORY)    IS NOT NULL THEN 'HISTORY'    END,
    CASE WHEN clean_null(d.ALLERGIES)  IS NOT NULL THEN 'ALLERGIES'  END,
    CASE WHEN clean_null(d.LAB_DATA)   IS NOT NULL THEN 'LAB_DATA'   END
  ], lambda x: x IS NOT NULL)                   AS HAS_DATA

FROM vaersdata d
LEFT JOIN vax_agg va USING (VAERS_ID)
LEFT JOIN followups fu USING (VAERS_ID)
WHERE COALESCE(d.REPORT_ORDER, 1) = 1;   -- one row per case (primary report)

-- ---------------------------------------------------------------------------
-- symptoms: dictionary of coded MedDRA terms across every submission.
-- Deterministic ids (row_number over ORDER BY) so identical raw data rebuilds
-- to identical ids — part of the README reproducibility contract.
-- ---------------------------------------------------------------------------
-- USMALLINT guard (max 65535) BEFORE the cast can blow up mid-CREATE.
SELECT CASE WHEN COUNT(*) > 65535
            THEN error('symptom vocabulary (' || COUNT(*) || ') overflows USMALLINT — widen SYMPTOM_ID')
       END
FROM (SELECT DISTINCT trim(s) AS sym
      FROM vaerssymptoms, UNNEST([SYMPTOM1, SYMPTOM2, SYMPTOM3, SYMPTOM4, SYMPTOM5]) t(s)
      WHERE s IS NOT NULL AND trim(s) <> '');

DROP TABLE IF EXISTS symptoms;
CREATE TABLE symptoms AS
  SELECT row_number() OVER (ORDER BY sym)::USMALLINT AS SYMPTOM_ID,
         sym                                          AS SYMPTOM
  FROM (SELECT DISTINCT trim(s) AS sym
        FROM vaerssymptoms, UNNEST([SYMPTOM1, SYMPTOM2, SYMPTOM3, SYMPTOM4, SYMPTOM5]) t(s)
        WHERE s IS NOT NULL AND trim(s) <> '');

-- ---------------------------------------------------------------------------
-- reports_symptoms: distinct (case, symptom) pairs. Primary submissions only,
-- and SEMI-joined to reports so the symptom universe == the reports universe
-- (orphan symptom rows with no vaersdata case are excluded — the JLH
-- significant-terms math needs foreground ⊆ background over the same set).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS reports_symptoms;
CREATE TABLE reports_symptoms AS
  SELECT DISTINCT p.VAERS_ID, s.SYMPTOM_ID
  FROM (SELECT v.VAERS_ID, trim(t.sym) AS sym
        FROM vaerssymptoms v,
             UNNEST([v.SYMPTOM1, v.SYMPTOM2, v.SYMPTOM3, v.SYMPTOM4, v.SYMPTOM5]) t(sym)
        WHERE COALESCE(v.REPORT_ORDER, 1) = 1
          AND t.sym IS NOT NULL AND trim(t.sym) <> '') p
  JOIN symptoms s ON s.SYMPTOM = p.sym
  SEMI JOIN reports r ON r.VAERS_ID = p.VAERS_ID;

-- symptom_bg: background (unfiltered) counts — the default Top Symptoms panel
-- reads this directly, and JLH scoring joins it instead of re-counting 13M rows.
DROP TABLE IF EXISTS symptom_bg;
CREATE TABLE symptom_bg AS
  SELECT SYMPTOM_ID, COUNT(*)::BIGINT AS bg_n
  FROM reports_symptoms
  GROUP BY 1;

-- ---------------------------------------------------------------------------
-- Build invariants — abort (roll back) rather than commit a broken model.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) <> COUNT(DISTINCT VAERS_ID)
            THEN error('reports: ' || (COUNT(*) - COUNT(DISTINCT VAERS_ID)) || ' duplicate VAERS_ID row(s)')
       END
FROM reports;

SELECT CASE WHEN COUNT(*) > 0
            THEN error('reports_symptoms: ' || COUNT(*) || ' duplicate (VAERS_ID, SYMPTOM_ID) pair(s)')
       END
FROM (SELECT VAERS_ID, SYMPTOM_ID FROM reports_symptoms GROUP BY 1, 2 HAVING COUNT(*) > 1);

SELECT CASE WHEN COUNT(*) > 0
            THEN error('reports_vax: ' || COUNT(*) || ' duplicate (VAERS_ID, VAX_TYPE, VAX_MANU) row(s)')
       END
FROM (SELECT VAERS_ID, VAX_TYPE, VAX_MANU FROM reports_vax GROUP BY 1, 2, 3 HAVING COUNT(*) > 1);

-- symptom ids are dense 1..N (deterministic rebuild contract). The message is NULL-proofed:
-- on an empty table MIN/MAX are NULL, and error(NULL) is a no-op that would let the empty
-- (e.g. symptoms failed to import) case slip through the very check meant to catch it.
SELECT CASE WHEN COUNT(*) = 0 OR MIN(SYMPTOM_ID) <> 1 OR MAX(SYMPTOM_ID) <> COUNT(*)
            THEN error('symptoms: ids not dense 1..N (min=' || COALESCE(MIN(SYMPTOM_ID)::VARCHAR, 'null')
                       || ', max=' || COALESCE(MAX(SYMPTOM_ID)::VARCHAR, 'null') || ', n=' || COUNT(*) || ')')
       END
FROM symptoms;

-- every fact row resolves to a dictionary entry
SELECT CASE WHEN COUNT(*) > 0
            THEN error('reports_symptoms: ' || COUNT(*) || ' orphan SYMPTOM_ID row(s)')
       END
FROM reports_symptoms rs ANTI JOIN symptoms s USING (SYMPTOM_ID);

COMMIT;
