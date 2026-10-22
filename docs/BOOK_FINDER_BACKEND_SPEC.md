# Library Book Finder – Backend Specification (Node.js, CSV, Dynamic Fields)

> Companion to `BOOK_FINDER_SPEC.md`. This file defines the **Node.js backend**, a **test dataset**, **CSV import**, and a **schema-less design** so the final dataset can have different columns from the sample one without any code changes.

---

## 1. Requirements Recap

| # | Requirement | How this spec meets it |
|---|---|---|
| 1 | Sample dataset for testing only | Section 3: two sample CSVs (a normal one and a "changed columns" one) in `/sample-data` |
| 2 | Backend in Node.js | Express server (Section 4–6) |
| 3 | Final data arrives as CSV | Upload endpoint + CSV parser (Section 7) |
| 4 | Fields auto-add / auto-remove | Schema-less storage + automatic field registry (Section 5) |

**Core idea:** the backend never hard-codes column names such as `title` or `shelf`. It stores each CSV row as a flexible JSON record, **discovers the columns from the CSV header on every upload**, and exposes them through an API so the frontend can render search results and filters from whatever fields exist.

---

## 2. Tech Stack

| Purpose | Package |
|---|---|
| Server | `express` |
| CSV upload | `multer` (memory storage) |
| CSV parsing | `csv-parse` (streaming/sync, delimiter and BOM handling) |
| Storage | `better-sqlite3` (single file DB, no server to run) |
| Security | `helmet`, `cors`, `express-rate-limit` |
| Config | `dotenv` |
| Tests | `vitest` or `jest` + `supertest` |

Requires Node.js 18 or newer.

**Why SQLite with JSON rows?** It is one file, works on small hosts, supports fast substring search over thousands of rows, and a JSON column lets every dataset have different fields. If you later need to deploy to a serverless host (e.g. Vercel) where the disk is read-only or temporary, swap the storage layer for Postgres/Supabase (Section 12). The API stays identical.

---

## 3. Sample Datasets (for testing only)

Save these in `/sample-data`. They exist purely to test the app; the real dataset replaces them later.

### 3.1 `sample-books.csv` (baseline columns)

```csv
id,title,author,category,isbn,floor,rack,shelf,copies,available
1,Harry Potter and the Philosopher's Stone,J.K. Rowling,Fiction,9780747532699,1,R-02,A,3,yes
2,Harry Potter and the Chamber of Secrets,J.K. Rowling,Fiction,9780747538493,1,R-02,A,2,yes
3,Introduction to Algorithms,Thomas H. Cormen,Computer Science,9780262046305,2,R-07,C,3,yes
4,Clean Code,Robert C. Martin,Computer Science,9780132350884,2,R-07,D,2,no
5,Wings of Fire,A.P.J. Abdul Kalam,Biography,9788173711466,1,R-05,B,4,no
6,Concepts of Physics,H.C. Verma,Physics,9788177091878,3,R-11,D,5,yes
7,The Alchemist,Paulo Coelho,Fiction,9780062315007,1,R-02,C,2,yes
8,Discovery of India,Jawaharlal Nehru,History,9780143031031,2,R-09,A,1,yes
9,A Brief History of Time,Stephen Hawking,Science,9780553380163,3,R-12,B,2,yes
10,Atomic Habits,James Clear,Self Help,9780735211292,1,R-04,A,6,yes
11,The Great Gatsby,F. Scott Fitzgerald,Fiction,9780743273565,1,R-03,B,2,yes
12,To Kill a Mockingbird,Harper Lee,Fiction,9780061120084,1,R-03,B,3,no
13,Python Crash Course,Eric Matthes,Computer Science,9781593279288,2,R-08,A,4,yes
14,Data Structures Using C,Reema Thareja,Computer Science,9780198099307,2,R-08,B,3,yes
15,Organic Chemistry,Morrison and Boyd,Chemistry,9780136436690,3,R-13,A,2,yes
16,Fundamentals of Physics,Halliday and Resnick,Physics,9781119306856,3,R-11,C,3,yes
17,Rich Dad Poor Dad,Robert Kiyosaki,Finance,9781612680194,1,R-04,C,5,yes
18,The白 Silk Road,Valerie Hansen,History,9780199935369,2,R-09,C,1,yes
19,Ignited Minds,A.P.J. Abdul Kalam,Self Help,9780143033684,1,R-04,B,2,yes
20,Engineering Mathematics,B.S. Grewal,Mathematics,9788174091956,3,R-14,A,6,yes
21,Let Us C,Yashavant Kanetkar,Computer Science,9788183331630,2,R-08,C,7,yes
22,Malgudi Days,R.K. Narayan,Fiction,9780143039655,1,R-03,C,3,yes
23,Zen and the Art of Motorcycle Maintenance,Robert M. Pirsig,Philosophy,9780060839871,2,R-10,A,1,yes
24,Quantum Mechanics,David J. Griffiths,Physics,9781107179868,3,R-11,E,2,no
25,Zero to One,Peter Thiel,Business,9780804139298,1,R-04,D,3,yes
```

### 3.2 `sample-books-v2.csv` (different columns, for testing auto add/remove)

This file deliberately **removes** `isbn`, `copies`, `available` and **adds** `publisher`, `year`, `language`, `section`. Uploading it after the first file must work without code or database changes.

```csv
id,title,author,category,floor,rack,shelf,publisher,year,language,section
101,Godan,Munshi Premchand,Hindi Literature,1,R-20,A,Rajkamal Prakashan,1936,Hindi,Literature
102,Gitanjali,Rabindranath Tagore,Poetry,1,R-21,B,Macmillan,1910,English,Literature
103,Panchatantra,Vishnu Sharma,Folk Tales,1,R-22,C,Penguin,2006,English,Children
104,Rashmirathi,Ramdhari Singh Dinkar,Hindi Literature,1,R-20,B,Lokbharti,1952,Hindi,Literature
105,Indian Polity,M. Laxmikanth,Civics,2,R-15,A,McGraw Hill,2020,English,Competitive Exams
106,Quantitative Aptitude,R.S. Aggarwal,Competitive Exams,2,R-15,B,S. Chand,2021,English,Competitive Exams
107,Ramayana,Valmiki,Epic,1,R-23,A,Gita Press,1998,Sanskrit,Religion
108,Mahabharata,Vyasa,Epic,1,R-23,B,Gita Press,1998,Sanskrit,Religion
```

> The `The 白 Silk Road` title (row 18 in the first file) tests Unicode handling. Keep it.

---

## 4. Project Structure

```
backend/
├─ package.json
├─ .env
├─ sample-data/
│  ├─ sample-books.csv
│  └─ sample-books-v2.csv
├─ data/                      # created at runtime
│  └─ library.db
├─ src/
│  ├─ server.js               # app bootstrap
│  ├─ config.js               # env + defaults
│  ├─ db.js                   # SQLite connection + migrations
│  ├─ routes/
│  │  ├─ search.js            # GET /api/search
│  │  ├─ books.js             # GET/PUT/DELETE /api/books
│  │  ├─ fields.js            # GET/PATCH /api/fields
│  │  └─ upload.js            # POST /api/upload
│  ├─ services/
│  │  ├─ csvImport.js         # parse + clean + detect columns
│  │  ├─ fieldRegistry.js     # discover / update field metadata
│  │  ├─ searchEngine.js      # matching + ranking
│  │  └─ columnMapper.js      # guess title/author/location columns
│  ├─ middleware/
│  │  ├─ adminAuth.js
│  │  └─ errorHandler.js
│  └─ utils/
│     ├─ normalize.js         # lowercase, strip accents
│     └─ sanitize.js          # CSV-injection guard
└─ tests/
```

---

## 5. Dynamic Schema Design (auto add / remove fields)

### 5.1 Storage (never changes, no matter what the CSV looks like)

```sql
-- every row of every CSV, stored as a JSON object
CREATE TABLE IF NOT EXISTS books (
  row_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  data        TEXT NOT NULL,          -- JSON: {"title":"...","shelf":"A",...}
  search_text TEXT NOT NULL,          -- normalized text of all searchable fields
  dataset_id  INTEGER NOT NULL,       -- which upload this row came from
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- the "field registry": what columns currently exist
CREATE TABLE IF NOT EXISTS fields (
  key           TEXT PRIMARY KEY,     -- normalized column name, e.g. "shelf"
  label         TEXT NOT NULL,        -- display name, e.g. "Shelf"
  type          TEXT NOT NULL,        -- text | number | boolean | date
  searchable    INTEGER DEFAULT 1,
  show_in_card  INTEGER DEFAULT 1,
  is_location   INTEGER DEFAULT 0,    -- part of "where is the book" label
  role          TEXT,                 -- title | author | category | null
  sort_order    INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1     -- 0 = column no longer in dataset
);

-- upload history
CREATE TABLE IF NOT EXISTS datasets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT,
  mode        TEXT,                   -- replace | append | upsert
  row_count   INTEGER,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Because rows are JSON, **adding or removing a column never needs `ALTER TABLE`**.

### 5.2 Auto-add / auto-remove rules (run on every upload)

1. Read the CSV header, giving the set **NEW**.
2. Read the field registry, giving the set **OLD** (active fields only).
3. Compare:
   - **Added** (in NEW, not in OLD): insert into `fields` with an auto-detected type, `searchable = 1` for text and number columns, `show_in_card = 1`.
   - **Removed** (in OLD, not in NEW): in `replace` mode, set `active = 0`. In `append` / `upsert` mode, keep them active, because older rows still hold that field.
   - **Unchanged**: keep the admin's custom settings (label, searchable, location flag).
4. Return a **diff report** to the caller:
   ```json
   { "added": ["publisher","year"], "removed": ["isbn","copies"], "kept": ["title","author"] }
   ```
5. Rebuild `search_text` for every row so search always covers exactly the currently searchable fields.

### 5.3 Header normalization

Convert each header to a safe key so odd CSV headers do not break anything:

| CSV header | Key | Label |
|---|---|---|
| `Book Title` | `book_title` | Book Title |
| `  ISBN-13 ` | `isbn_13` | ISBN-13 |
| `Shelf No.` | `shelf_no` | Shelf No. |
| (empty header) | `column_5` | Column 5 |
| duplicate `Author`, `Author` | `author`, `author_2` | Author |

### 5.4 Type detection

Check the first ~200 non-empty values per column:
- all `yes/no/true/false/1/0` → `boolean`
- all numeric → `number`
- all valid dates → `date`
- otherwise → `text`

Types are only used for display and sorting. Search always works on text.

### 5.5 Automatic role guessing (so the UI still knows what is the "title")

Because column names change, guess key roles from header aliases. The admin can override these in `PATCH /api/fields`.

```js
const ROLE_ALIASES = {
  title:    ["title", "book_title", "name", "book_name", "book"],
  author:   ["author", "authors", "writer", "by", "author_name"],
  category: ["category", "subject", "genre", "section", "department", "class"],
};
const LOCATION_ALIASES = [
  "floor", "section", "room", "hall", "rack", "shelf", "shelf_no",
  "row", "bay", "location", "almirah", "cupboard", "position"
];
```

- A field whose normalized key matches an alias gets that `role` (or `is_location = 1`).
- If **no title column** is found, use the first text column as the title and tell the admin in the upload response (`warnings`).
- The frontend builds the "location label" by joining all `is_location` fields in registry order, e.g. `Floor 2 · Rack R-07 · Shelf C`.

---

## 6. API Reference

Base path: `/api`. All responses are JSON.

### 6.1 Public

#### `GET /api/search`

| Query param | Meaning |
|---|---|
| `q` | search text (required; may be a single letter) |
| `fields` | optional comma list to limit search to certain fields |
| `page` | default `1` |
| `limit` | default `20`, max `100` |

Response:
```json
{
  "query": "a",
  "total": 23,
  "page": 1,
  "limit": 20,
  "results": [
    {
      "id": 1,
      "score": 100,
      "data": { "title": "...", "author": "...", "shelf": "A", "...": "..." },
      "location": "Floor 1 · Rack R-02 · Shelf A",
      "matched": ["title", "author"]
    }
  ]
}
```

#### `GET /api/fields`
Returns the active field registry so the frontend can render itself dynamically:
```json
{ "fields": [ { "key":"title","label":"Title","type":"text","role":"title","searchable":true,"show_in_card":true,"is_location":false } ] }
```

#### `GET /api/books/:id`
One book's full record.

#### `GET /api/books?page=&limit=&category=`
Paged listing / browse. Any registry field can be used as an exact-match filter, e.g. `?shelf=A&floor=1`.

#### `GET /api/facets/:fieldKey`
Distinct values of a field with counts (for browse tiles, category lists). Example: `/api/facets/category`.

#### `GET /api/health`
`{ "status": "ok", "books": 25 }`

### 6.2 Admin (requires header `x-admin-token: <ADMIN_TOKEN>`)

#### `POST /api/upload`  (multipart form-data)

| Form field | Meaning |
|---|---|
| `file` | the CSV file (required) |
| `mode` | `replace` (default), `append`, or `upsert` |
| `keyField` | required for `upsert`; the column that uniquely identifies a book (e.g. `isbn` or `id`) |
| `dryRun` | `true` = parse and report only, save nothing |

Response:
```json
{
  "datasetId": 3,
  "mode": "replace",
  "rowsRead": 25,
  "rowsImported": 25,
  "rowsSkipped": 0,
  "fields": { "added": ["publisher"], "removed": ["isbn"], "kept": ["title","author"] },
  "detected": { "delimiter": ",", "encoding": "utf-8", "titleField": "title" },
  "warnings": ["3 rows had fewer columns than the header and were padded."]
}
```

Recommended admin flow: upload with `dryRun=true`, review the diff, then upload again with `dryRun=false`.

#### `PATCH /api/fields/:key`
Change label, `searchable`, `show_in_card`, `is_location`, `role`, `sort_order`. After a `searchable` change the server rebuilds `search_text`.

#### `PUT /api/books/:id`  and  `DELETE /api/books/:id`
Edit a single record's JSON or delete it. `PUT` may include **new keys**, which are auto-registered as fields.

#### `POST /api/books`
Add one book (any keys allowed).

#### `DELETE /api/books`  with `?confirm=yes`
Wipe the library (useful before loading the final dataset).

#### `GET /api/export`
Download the current data as CSV with the current active fields as columns.

---

## 7. CSV Import Pipeline (`csvImport.js`)

```
file buffer
   │
   ├─ 1. size/type check (max 10 MB, .csv or text/csv)
   ├─ 2. decode: strip UTF-8 BOM; if invalid UTF-8, try windows-1252
   ├─ 3. detect delimiter: , ; \t |  (count in first 5 lines)
   ├─ 4. parse with csv-parse (quotes, embedded commas/newlines, trim)
   ├─ 5. clean headers → keys (Section 5.3)
   ├─ 6. drop fully empty rows; pad/trim ragged rows (warn)
   ├─ 7. trim cells; neutralize CSV-injection (cells starting = + - @)
   ├─ 8. detect types + roles (Sections 5.4, 5.5)
   ├─ 9. diff against field registry (Section 5.2)
   └─ 10. write in ONE transaction (replace / append / upsert)
```

Sketch:

```js
import { parse } from "csv-parse/sync";

export function parseCsv(buffer) {
  let text = buffer.toString("utf8").replace(/^\uFEFF/, "");   // strip BOM

  const delimiter = detectDelimiter(text);                      // , ; \t |

  const records = parse(text, {
    columns: false,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,   // tolerate ragged rows
    relax_quotes: true,
    trim: true,
  });

  const [headerRow, ...rows] = records;
  const keys = makeUniqueKeys(headerRow.map(toKey));            // Section 5.3

  const objects = rows.map((r) =>
    Object.fromEntries(keys.map((k, i) => [k, sanitizeCell(r[i] ?? "")]))
  );
  return { keys, headerRow, objects, delimiter };
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// stop spreadsheet formula injection if data is later exported/opened in Excel
function sanitizeCell(v) {
  return /^[=+\-@]/.test(v) && isNaN(Number(v)) ? "'" + v : v;
}
```

**Upload modes**

| Mode | Behaviour |
|---|---|
| `replace` | delete all existing rows, insert the new ones, deactivate fields that are no longer in the file (**use for the final dataset**) |
| `append` | add rows, keep all existing rows and fields |
| `upsert` | match on `keyField`; update existing rows, insert new ones |

All modes run inside a single DB transaction, so a failed upload leaves the old data untouched.

---

## 8. Search Engine (`searchEngine.js`)

Works on whatever fields are currently marked `searchable`.

```js
const norm = (s = "") =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// On import / field change: build one normalized string per row
function buildSearchText(data, searchableKeys) {
  return norm(searchableKeys.map((k) => data[k] ?? "").join(" | "));
}

// On request
function search(q, { page = 1, limit = 20 } = {}) {
  const query = norm(q).trim();
  if (!query) return { total: 0, results: [] };

  const words = query.split(/\s+/);

  // 1) coarse filter in SQL – every word must appear (single letters work)
  //    WHERE search_text LIKE '%word1%' AND search_text LIKE '%word2%'
  // 2) score the matching rows in JS (title role first)
  // 3) sort by score, then title; slice for the page
}
```

Scoring (using the field that has `role = 'title'`):

| Condition | Score |
|---|---|
| title starts with query | 100 |
| a title word starts with query | 60 |
| title contains query | 40 |
| matched only in another field | 10 |

Rules:
- Case-insensitive, accent-insensitive, any language (Hindi or other Unicode text works).
- `%` and `_` typed by the user are **escaped** before use in `LIKE`.
- All SQL uses **prepared statements** with bound parameters.
- Return which fields matched (`matched`) so the UI can highlight them.
- Single-letter queries return *all* matches, paged by `limit`.

---

## 9. Configuration (`.env`)

```
PORT=5000
ADMIN_TOKEN=change-me-to-a-long-random-string
DB_PATH=./data/library.db
MAX_UPLOAD_MB=10
CORS_ORIGIN=http://localhost:5173
AUTO_LOAD_SAMPLE=true        # load sample-books.csv when DB is empty (testing only)
```

`AUTO_LOAD_SAMPLE` makes the server import `sample-data/sample-books.csv` on first start so the frontend has data immediately. **Set it to `false` for production.**

---

## 10. Security and Robustness Checklist

- [ ] Admin routes require `x-admin-token` (constant-time compare); public routes are read-only.
- [ ] Rate-limit `/api/search` (e.g. 120 req/min/IP) and `/api/upload` (e.g. 10/hour).
- [ ] Upload size limit, extension and MIME check, and CSV parsed in memory (no file written to disk).
- [ ] Prepared statements only; never build SQL from user text.
- [ ] Escape `LIKE` wildcards.
- [ ] CSV-injection guard on cells (Section 7).
- [ ] `helmet` headers, restricted CORS origin.
- [ ] Never return raw stack traces; central `errorHandler`.
- [ ] Whole upload in one transaction with rollback.
- [ ] Cap total columns (e.g. 100) and row count (e.g. 200,000) to prevent abuse.

---

## 11. Tests to Write

| Test | Expectation |
|---|---|
| Upload `sample-books.csv` | 25 rows; fields include `title, author, shelf, isbn...` |
| Upload `sample-books-v2.csv` with `replace` | diff shows `added: publisher, year, language, section`, `removed: isbn, copies, available`; old rows gone |
| Same with `append` | old fields stay active; both datasets searchable |
| `GET /api/search?q=a` | returns every book containing "a" in any searchable field |
| `GET /api/search?q=HARRY` | same results as `harry` |
| `GET /api/search?q=rowling potter` | only books matching both words |
| `GET /api/search?q=100%` | no crash; `%` treated as a normal character |
| Unicode title (`白`) | searchable and returned unchanged |
| CSV with `;` delimiter / BOM / quoted commas | parsed correctly |
| CSV with duplicate or blank headers | unique keys generated |
| Ragged rows | padded, with a warning |
| Upload without admin token | `401` |
| `dryRun=true` | nothing saved, diff returned |
| `PATCH /api/fields/year {searchable:false}` | `year` no longer matched by search |
| Failed mid-upload (corrupt row) | old data intact (rollback) |

---

## 12. Deployment Notes

- **Data persistence:** SQLite needs a writable disk. It works on a VPS, Render/Railway with a persistent disk, or Fly.io volumes. **Vercel serverless functions have no persistent disk**, so on Vercel use a hosted database instead (Supabase Postgres or MongoDB Atlas). Only `db.js` needs to change: keep the same three tables, store `data` as `JSONB` in Postgres, and use `ILIKE '%word%'` or `pg_trgm` for search.
- **Final dataset:** set `AUTO_LOAD_SAMPLE=false`, call `DELETE /api/books?confirm=yes` (or just upload with `mode=replace`), upload the real CSV with `dryRun=true` first, review the field diff, then upload for real. Open `PATCH /api/fields` to mark which columns are searchable or location parts.
- **Backups:** keep the original CSV; the database can always be rebuilt from it. `GET /api/export` gives a current snapshot.
- **Frontend contract:** the frontend must read `/api/fields` at start-up and render cards/filters from it. It must **not** hard-code column names, which is what makes the auto add/remove work end to end.

---

## 13. Build Order

1. Init project, install packages, create `db.js` with the three tables.
2. Implement `normalize.js`, `columnMapper.js`, `fieldRegistry.js`.
3. Implement `csvImport.js` and the `POST /api/upload` route (with `dryRun`, modes, diff report).
4. Implement `searchEngine.js` and `GET /api/search`, `/api/fields`, `/api/books`, `/api/facets`.
5. Add admin auth, rate limiting, error handler.
6. Add `AUTO_LOAD_SAMPLE`, then write the tests in Section 11 using both sample files.
7. Connect the React frontend (reading `/api/fields` dynamically).
8. Deploy, upload the real CSV, tune the field settings.

---

## 14. Acceptance Criteria

- [ ] Fresh start with `AUTO_LOAD_SAMPLE=true` loads the 25 sample books.
- [ ] Uploading `sample-books-v2.csv` automatically adds `publisher/year/language/section` and removes `isbn/copies/available` with no code or schema changes.
- [ ] The upload response clearly lists added / removed / kept fields.
- [ ] Searching `a` returns all books containing "a"; case, accents, and partial words all work.
- [ ] Any CSV with a different delimiter, BOM, or odd headers imports correctly.
- [ ] A failed upload never corrupts existing data.
- [ ] Admin endpoints are protected; public endpoints are read-only.
- [ ] Search over 50,000 rows responds in under 300 ms.
