-- AlonSpace: categories transcribed from the two supplied 2026 spreadsheets.
-- Category names only; spreadsheet amounts are NOT imported as paid transactions or estimates.
-- Existing categories/amounts/entries are preserved. Re-running is safe.
BEGIN;
WITH seed(floor, name, kind, sort_order) AS (
  VALUES
  (4,'חומרי ניקוי','regular',10),
  (4,'קפה ומטבח','regular',20),
  (4,'חשמל','electricity',30),
  (4,'ארנונה','arnona',40),
  (4,'ביטוח','regular',50),
  (4,'אינטרנט ותקשורת','regular',60),
  (4,'אפליקציית חדר ישיבות','regular',70),
  (4,'דמי ניהול בניין-רמות','regular',80),
  (4,'חשמל מיזוג-רמות','electricity',90),
  (4,'תחזוקה ותיקונים','regular',100),
  (4,'עינב','regular',110),
  (4,'יאיר','regular',120),
  (4,'לילי','regular',130),
  (4,'שונות','regular',140),
  (6,'חומרי ניקוי','regular',10),
  (6,'קפה ומטבח','regular',20),
  (6,'חשמל','electricity',30),
  (6,'ארנונה','arnona',40),
  (6,'ביטוח','regular',50),
  (6,'אינטרנט ותקשורת','regular',60),
  (6,'אפליקציית חדר ישיבות','regular',70),
  (6,'דמי ניהול בניין-רמות','regular',80),
  (6,'חשמל מיזוג-רמות','electricity',90),
  (6,'תחזוקה ותיקונים','regular',100),
  (6,'עינב','regular',110),
  (6,'יאיר','regular',120),
  (6,'לילי','regular',130),
  (6,'שונות','regular',140)
)
INSERT INTO expense_categories (floor,name,kind,sort_order,default_amount)
SELECT floor,name,kind,sort_order,0 FROM seed
ON CONFLICT (floor,name) DO UPDATE
SET kind = EXCLUDED.kind,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE;
COMMIT;
