# Fix Hit Counter, Show All Results, Enter Opens Book

> Fixes on top of `SEARCH_CHIP_RESULTS_AND_VISITOR_COUNTER.md`. Keep chat replies to 1–3 lines.

---

## 1. Hit counter: save on the server, never reset

**Problem (screenshot):** "Hit count : 0" and it resets. Cause: the count is kept in the temporary storage of the serverless function (`/tmp` SQLite on Vercel), or the page shows a default `0` when the call fails or before it returns.

**Fix**
- [ ] **Store the count in a persistent server-side store**, not in the browser and not in `/tmp`:
  - Default for Vercel: **Upstash Redis** (Vercel Marketplace). Key `library:hits:total`; increment with the atomic command `INCR`; also `HINCRBY library:hits:daily <YYYY-MM-DD> 1` (date in `Asia/Kolkata`).
  - Env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (server-side only; never sent to the browser; CSP `connect-src 'self'` stays).
  - Alternatives if you host the Node server on a persistent disk: SQLite file on that disk (`DB_PATH` on the mounted volume).
- [ ] Hide the storage behind two functions, `incrementHits()` and `getHits()`, so the store can change without touching the frontend.
- [ ] **Never reset:** no code path writes `0`/overwrites the total; startup, redeploy and cold start only read. No `SET` of the total except an explicit admin "import starting value" action (optional, one-time, to carry over an old number).
- [ ] `POST /api/visit` increments once per full page load and returns `{ total }`; `GET /api/visits` returns `{ total }`. The browser never keeps or computes the count.
- [ ] **Frontend display:** show the number from the server response only. While loading show a skeleton; if the request fails show `—`, **never `0`**. Keep the once-per-page-load guard (React StrictMode must not double count) and the same label/format (`Hit count : 1,284`).
- [ ] **Production safety:** if the persistent store is not configured in production, the server logs a clear error at start-up and `/api/visit` returns 503 instead of silently counting in temporary memory.
- [ ] Tests: 5 calls → +5; concurrent calls are not lost; restart/new instance keeps the total; failure shows `—` not `0`.

**Acceptance:** open the site 3 times → count rises by 3; redeploy or wait for a cold start → count is unchanged; the number never drops back to 0.

---

## 2. Show all results immediately (no "press Enter to see all")

**Problem (screenshot):** only 24 chips show, then "+2 more · press Enter to see all".

- [ ] Remove the 24/60 chip cap and the "+N more · press Enter to see all" line. Typing shows **every match** automatically, live, from one letter (debounce 150 ms).
- [ ] Backend `GET /api/suggest` returns all matches (no `limit` default; keep a safety ceiling of 5,000 and a `total`). Response stays light (`id`, `text`, `type`).
- [ ] For large catalogues render efficiently: window/virtualise the chip list (e.g. `react-window` variable layout or incremental rendering in batches of 200 while scrolling) so 5,000 chips don't freeze the page.
- [ ] Show the total above or beside the chips, e.g. "26 results".
- [ ] The chip area scrolls **inside** its own box if the chips don't fit; the page itself still does not scroll (one-screen layout).

## 3. Enter opens the book; remove the vertical bar

Read as: (a) **remove the vertical scrollbar** from the results area and (b) **Enter opens the result** instead of a separate "see all" page.

- [ ] **Hide the vertical scrollbar** on the chip area (`scrollbar-width: none; &::-webkit-scrollbar { display: none; }`) — it still scrolls with mouse wheel, touch and arrow keys. Add a faint top/bottom fade to show there is more.
- [ ] **Enter opens a book:** the first chip is highlighted by default; `Enter` opens that book's detail page with the location slip (Floor / Rack / Shelf). Arrow keys move the highlight, then `Enter` opens that chip. Clicking a chip also opens it.
- [ ] If only one result matches, `Enter` opens it directly. If none match, `Enter` does nothing (the empty message stays).
- [ ] The arrow button in the search bar behaves like `Enter`.
- [ ] Remove the `/search?q=` "all results" page link from the typing flow; `Back` from a book returns to the same query and chips.
- [ ] Hide the text caret styling issues: keep the normal input caret (it is not a separate element); no extra vertical line elements in the search bar.

## 4. Data glitch seen in the screenshot
One chip reads **"The白 Silk Road"** — a stray Chinese character (白) in the title. Check `backend/sample-data/sample-books.csv` and the imported Excel for stray non-Latin characters and fix the title to "The Silk Road". Add an import warning: "Title contains unexpected characters" when a title mixes scripts.

## 5. Acceptance checklist
- [ ] Typing `a` lists **all** matching titles at once; no "+N more" text.
- [ ] No vertical scrollbar visible in the results area; it still scrolls.
- [ ] `Enter` opens the highlighted (default first) book; arrows change the choice.
- [ ] Hit count is saved on the server, increases once per site open, and never resets or shows `0` on error.
- [ ] Home still fits one screen without page scroll.

## 6. Interpretation to confirm
"Remove the vertical book" was read as **vertical scroll bar**. If you meant something else (for example the vertical text cursor), tell me which element.
