-- ===========================================================================
-- build_reports.sql — denormalized dashboard model.
--
-- Builds two physical tables from the raw import (vaersdata / vaersvax):
--   reports      : one row per VAERS report, with derived dashboard fields.
--   reports_vax  : distinct (VAERS_ID, VAX_TYPE) — vax-type dropdown + Vax Types panel.
--
-- Derived-field semantics are ported verbatim from the old PHP importer
-- (import-data.php / import-vax.php): clean_nullable (24 null-like strings),
-- combine_reactions, fix_numdays (stored-else-|onset-vax| with swap fix, >10000 cap),
-- SHORT_SYMPTOM_TEXT (first 10 lines), HAS_DATA, NUM_VAX.
-- ===========================================================================

-- clean_nullable: the exact 24 null-like expressions from import-data.php.
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

-- ---------------------------------------------------------------------------
-- reports_vax: distinct report/vax-type pairs.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS reports_vax;
CREATE TABLE reports_vax AS
  SELECT DISTINCT VAERS_ID, VAX_TYPE
  FROM vaersvax
  WHERE VAX_TYPE IS NOT NULL AND VAX_TYPE <> '';

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
  GROUP BY VAERS_ID
)
SELECT
  d.VAERS_ID,
  d.RECVDATE,
  d.VAX_DATE,
  d.ONSET_DATE,
  d.AGE_YRS,
  d.STATE,
  d.SEX,
  d.SYMPTOM_TEXT,
  -- SHORT_SYMPTOM_TEXT: first 10 lines (import-data.php shorten_text / keepXLines).
  array_to_string(
    list_slice(string_split(coalesce(d.SYMPTOM_TEXT, ''), chr(10)), 1, 10), chr(10)
  )                                                     AS SHORT_SYMPTOM_TEXT,

  -- NUMDAYS: stored else |ONSET - VAX| (swap fix via abs), drop implausible >10000.
  CASE
    WHEN d.NUMDAYS IS NOT NULL
      THEN CASE WHEN d.NUMDAYS > 10000 THEN NULL ELSE d.NUMDAYS END
    WHEN d.VAX_DATE IS NOT NULL AND d.ONSET_DATE IS NOT NULL THEN
      CASE WHEN abs(date_diff('day', d.VAX_DATE, d.ONSET_DATE)) > 10000 THEN NULL
           ELSE abs(date_diff('day', d.VAX_DATE, d.ONSET_DATE)) END
    ELSE NULL
  END                                                   AS NUMDAYS,

  -- Outcome / adhoc-filterable raw columns.
  d.DIED, d.L_THREAT, d.HOSPITAL, d.DISABLE, d.RECOVD,
  d.ER_VISIT, d.ER_ED_VISIT, d.X_STAY, d.BIRTH_DEFECT, d.OFC_VISIT,
  d.V_ADMINBY, d.V_FUNDBY,

  -- History fields, run through clean_nullable.
  clean_null(d.OTHER_MEDS)  AS OTHER_MEDS,
  clean_null(d.CUR_ILL)     AS CUR_ILL,
  clean_null(d.HISTORY)     AS HISTORY,
  clean_null(d.ALLERGIES)   AS ALLERGIES,
  clean_null(d.LAB_DATA)    AS LAB_DATA,

  d.IS_DOMESTIC,
  coalesce(va.NUM_VAX, 0)                  AS NUM_VAX,
  coalesce(va.VAX_TYPES, []::VARCHAR[])    AS VAX_TYPES,

  -- REACTIONS list from the 8 outcome booleans (import-data.php combine_reactions).
  list_filter([
    CASE WHEN d.L_THREAT    = 'Y' THEN 'L_THREAT'    END,
    CASE WHEN d.DIED        = 'Y' THEN 'DIED'        END,
    CASE WHEN d.HOSPITAL    = 'Y' THEN 'HOSPITAL'    END,
    CASE WHEN d.DISABLE     = 'Y' THEN 'DISABLE'     END,
    CASE WHEN d.RECOVD      = 'N' THEN '!RECOVED'    END,
    CASE WHEN d.ER_VISIT    = 'Y' THEN 'ER_VISIT'    END,
    CASE WHEN d.ER_ED_VISIT = 'Y' THEN 'ER_ED_VISIT' END,
    CASE WHEN d.X_STAY      = 'Y' THEN 'X_STAY'      END
  ], lambda x: x IS NOT NULL)                   AS REACTIONS,

  -- HAS_DATA: which history fields survive clean_nullable (import-data.php has_fields).
  list_filter([
    CASE WHEN clean_null(d.OTHER_MEDS) IS NOT NULL THEN 'OTHER_MEDS' END,
    CASE WHEN clean_null(d.CUR_ILL)    IS NOT NULL THEN 'CUR_ILL'    END,
    CASE WHEN clean_null(d.HISTORY)    IS NOT NULL THEN 'HISTORY'    END,
    CASE WHEN clean_null(d.ALLERGIES)  IS NOT NULL THEN 'ALLERGIES'  END,
    CASE WHEN clean_null(d.LAB_DATA)   IS NOT NULL THEN 'LAB_DATA'   END
  ], lambda x: x IS NOT NULL)                   AS HAS_DATA

FROM vaersdata d
LEFT JOIN vax_agg va USING (VAERS_ID);

-- Indexes for filtered aggregation.
CREATE INDEX idx_reports_vaxdate  ON reports(VAX_DATE);
CREATE INDEX idx_reports_recvdate ON reports(RECVDATE);
CREATE INDEX idx_reports_id       ON reports(VAERS_ID);
CREATE INDEX idx_rv_type          ON reports_vax(VAX_TYPE);
CREATE INDEX idx_rv_id            ON reports_vax(VAERS_ID);
