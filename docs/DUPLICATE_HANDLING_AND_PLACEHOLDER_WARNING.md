# Duplicate Book Handling (Auto + Manual) and the "Placeholder" Warning

> Builds on the Excel-upload and admin specs. Keep chat replies to 1–3 lines.

---

## 1. What the screenshot (Admin → Books → Duplicates) shows

- 27 books listed; several titles appear more than once (*Analog Communication Systems* ×2, *Basic Electrical And Electronics Engineering* ×4+), each with identical Floor/Rack/Shelf (3 / R-14 / B, 3 / R-16 / F).
- The **Duplicates** filter just lists the rows. Nothing says *which* rows duplicate each other, how many copies there are, or lets the admin fix them.
- Every row carries a yellow **Placeholder** tag (section 4).
- Uploading the same sheet twice creates the extra rows; nothing stops or warns about it.

Some repeats may be **real extra copies** (a library often owns 4 copies of one textbook), so the system must not just delete them.

---

## 2. Duplicate detection

### 2.1 Match key (`dup_key`)
Computed on import and on every edit, stored in an indexed column.

1. **Strong key** when the file has a unique identifier (`entity_id`, ISBN, accession number): the identifier alone.
2. Otherwise **Title + First Author**, normalised:
   - lowercase, strip accents, remove punctuation, collapse spaces, drop leading "the/a/an";
   - author names token-sorted and initials-tolerant so `Sharma, Sanjay` = `Sanjay Sharma` = `Sharma S.`;
   - second author ignored for the key.

### 2.2 Confidence levels
| Level | Rule | Default action |
|---|---|---|
| **Exact** | same `dup_key`, same Floor/Rack/Shelf (or location blank) | Handled automatically (2.4) |
| **Same book, different place** | same `dup_key`, different location | Treated as another copy; needs your rule (2.4) |
| **Likely** | title similarity ≥ 0.92 (token-set / Jaro-Winkler) and same author | Sent to manual review, never auto-merged |
| **Possible** | same title, different or missing author | Shown as a hint only |

### 2.3 Where it runs
1. **Inside the uploaded file** (rows repeated in the same sheet).
2. **Against the existing catalogue** (rows already in the database).
3. **Repeated file:** store a SHA-256 hash of every uploaded file in an `uploads` table (name, hash, uploaded by, time, result). If the same hash is uploaded again, show a banner *"This exact file was uploaded on 05 Nov 2026 at 4:12 PM. Nothing new to import."* and default the mode to **Skip duplicates**. Also store a per-row hash so unchanged rows are skipped even in an edited file.

### 2.4 Upload step: "When duplicates are found"
Shown in the Upload preview (dry run), with counts: `New 58 · Exact duplicates 24 · Different place 3 · Need review 2`.

| Option | Behaviour |
|---|---|
| **Smart (default)** | Exact duplicates: skip (no change). Same book + blank fields in database: fill only the blanks. Never overwrites a value the admin edited or verified. Different place: add as another copy. Likely/Possible: queued for review. |
| **Skip all duplicates** | Import only rows with no match. |
| **Add as copies** | Matching rows increase `copies` and keep their own location. |
| **Update existing** | Overwrite matching books with the file's values (asks for confirmation; shows a before/after diff). |
| **Import everything** | No checking (warns "this will create duplicates"). |
| **Review manually** | Import the clearly new rows, put all matches in the review queue (section 3). |

- The result screen lists exactly what happened per row (added / skipped / copy added / updated / queued) and can be downloaded as CSV.
- Everything runs in **one transaction** and can be undone (section 2.5).

### 2.5 Safety
- Soft delete: merged/removed rows go to `book_history` for 30 days with **Undo**.
- Every automatic or manual action is written to an audit log (who, when, what).
- Concurrent uploads: dedupe check and insert happen in the same transaction so two simultaneous uploads cannot both insert the same new book.

---

## 3. Manual duplicate handling (Admin → Books → **Duplicates**)

Replace the flat filtered list with a review screen.

- [ ] **Header:** "11 duplicate groups · 27 books" with a **Run check now** button (re-scans the whole catalogue), a confidence filter (Exact / Likely / Possible) and **Auto-merge all exact** (asks for confirmation, shows the count).
- [ ] **Group cards:** each group shows its rows side by side (Title, Author(s), Floor / Rack / Shelf, copies, source upload, added date, verified/temporary location) with the differing fields highlighted.
- [ ] **Actions per group:**
  - **Keep as copies** — one book on the site with "N copies" and each copy's location (default for same title + author).
  - **Merge into one** — choose the master row; fields are combined (non-empty beats empty, verified location beats temporary), `copies` = number merged.
  - **Keep one, delete others.**
  - **Not a duplicate** — remembered in `duplicate_ignores` so it is never flagged again.
  - **Edit** any row inline (Floor / Rack / Shelf / title / author).
- [ ] Bulk select across groups, keyboard shortcuts, and **Undo** toast after every action.
- [ ] **Books tab fixes:** the Duplicates chip filters to rows that belong to a group, shows a badge like `×4`, and the "27 books" line reads "27 books in 11 groups". Rows link to their group.
- [ ] **Public site:** one book appears once in search chips (`Basic Electrical And Electronics Engineering ×4` if desired) and the book page lists every copy's location. Admin-only details stay admin-only.

## 4. The "Placeholder" warning in the screenshot

Review of the yellow **Placeholder** tag on every row:

| Issue | Fix |
|---|---|
| The word is unclear: staff cannot tell what is a placeholder or what to do | Rename to **"Temporary location"** with a warning icon and tooltip: *"Auto-filled. Set the real Floor, Rack and Shelf."* |
| It appears on every row, so it becomes noise | Add a top banner *"24 books still have temporary locations"* with **Show them** and **Mark all as verified**; keep the per-row tag small |
| Not clear when it goes away | Editing Floor, Rack **or** Shelf (inline or in the form) saves immediately, shows "Saved ✓" and removes the tag; **Verify** button on the row for "this random value is actually correct" |
| Inline edit boxes look like plain inputs | Autosave on blur/Enter, highlight changed fields, show saving/error state |
| Contrast (amber on blush) | Use amber background `#FFF1CC`, text `#7A4B00` (≥ 4.5:1) |
| Duplicate rows all show the same temporary values | Expected (values are seeded from the title). In a duplicate group the tag is shown once per group and "Verify" applies to all copies |
| Tag must never appear to visitors | Confirm the public API and pages omit `location_is_placeholder` |
| "Edit" button icon renders as a raw glyph (✎) | Use an icon component with an `aria-label="Edit"` |

Note: this review is from the screenshot only; confirm the behaviours in the running app (does an edit clear the tag, does a re-upload keep an edited value).

## 5. Backend changes
- [ ] Columns on `books`: `dup_key` (indexed), `row_hash`, `copies` (default 1), `location_is_placeholder`, `deleted_at`, `source_upload_id`.
- [ ] Tables: `uploads` (id, filename, sha256, mode, counts, uploaded_by, created_at), `duplicate_ignores` (key_a, key_b), `book_history`, `audit_log`.
- [ ] Endpoints (admin only): `POST /api/admin/upload?dryRun&mode&onDuplicate=smart|skip|copies|update|all|review`, `GET /api/admin/duplicates?level=`, `POST /api/admin/duplicates/merge`, `/keep-copies`, `/ignore`, `/delete`, `POST /api/admin/duplicates/rescan`, `POST /api/admin/undo/:actionId`, `POST /api/admin/books/verify-location`.
- [ ] Normalisation helpers in `utils/normalize.js`; migration to compute `dup_key` for existing rows.

## 6. Tests and acceptance
- [ ] Uploading the same file twice with **Smart** adds 0 books and shows the "already uploaded" banner.
- [ ] A file with a repeated row (inside the file) imports it once (or as a copy, per option).
- [ ] `Sharma, Sanjay` and `Sanjay Sharma` with the same title are grouped; a different book by the same author is not.
- [ ] Smart mode never overwrites an admin-edited or verified location.
- [ ] Merge, keep-as-copies, delete, ignore and undo all work and are logged; dry run changes nothing.
- [ ] Review screen groups the screenshot's examples (Analog Communication Systems, Basic Electrical And Electronics Engineering) correctly.
- [ ] Editing any location field removes the "Temporary location" tag; the banner count updates; public pages never show it.
- [ ] Two concurrent uploads of the same file do not create duplicates.

## 7. Decisions needed
- Default when the same title/author appears with different shelves: **add as copy** (assumed) or ask each time?
- Show "×N copies" to visitors, or only the locations?
- Match key: Title + First Author is assumed because the template has no ISBN/accession column; tell me if a unique ID column will be added.
