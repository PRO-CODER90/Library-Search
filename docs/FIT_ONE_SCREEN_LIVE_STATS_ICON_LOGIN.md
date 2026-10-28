# One-Screen Home, Live Stats, Icon-Only Login

> Small fixes on top of `NEW_LOOK_PINK_NAVY_AND_VISIBLE_LOGIN.md`. Keep chat replies to 1–3 lines.

---

## 1. Fit the home page to one screen (no page scroll)

**Problem (live site, 1920×~900 browser):** the page scrolls; the stats row wraps ("21 Available now" drops to a second line) and pushes content below the fold.

**Fix**
- [ ] Make the page a fixed-height layout: `html, body, #root { height: 100%; }`, the app shell `min-height: 100dvh; height: 100dvh; overflow: hidden;` on desktop, as a column: header (auto height) + hero (`flex: 1; min-height: 0`) + optional slim footer.
- [ ] Size everything from the viewport instead of fixed pixels: headline `font-size: clamp(2.25rem, 5.2vh + 1rem, 4.5rem)`, vertical gaps `clamp(0.75rem, 2vh, 2rem)`, header height `clamp(72px, 12vh, 120px)`, hero photo `height: 100%` with `object-fit: cover`.
- [ ] **Stats row stays on one line:** `display: flex; flex-wrap: nowrap; gap: clamp(1rem, 2vw, 2.5rem)`, each item `flex: 0 1 auto`, icon circle `clamp(44px, 6vh, 64px)`; separators are `border-left` on items 2+, not extra elements that can wrap. Row width ≤ the search bar width.
- [ ] Remove the bottom wave divider/footer height that adds scroll; if a footer is kept, make it ≤ 40 px inside the 100dvh layout.
- [ ] Use `100dvh` (not `100vh`) so mobile browser bars don't cause scrolling; no `overflow-y: scroll` on `body`; no scrollbar visible on Home.
- [ ] Short/small screens: below `max-height: 640px` or `max-width: 900px` reduce the type scale and hide decorative sketches first; if content still cannot fit (phones in landscape), allow scrolling only there. Other pages (search results, admin tables) scroll normally inside their own container.
- [ ] Test sizes: 1920×900, 1920×1080, 1536×730 (laptop), 1366×650, 1280×600, 390×844 — **no scrollbar on Home at any of them** (except the tiny-height fallback above).

## 2. Stats reflect the data that actually exists

The three tiles (Books, Categories, Available now) must come from the loaded catalogue and show **only what the data supports**. The uploaded Excel only has Title, Authors, Floor, Rack, Shelf — no category or availability column — so showing "12 Categories / 21 Available now" would be wrong.

- [ ] `GET /api/stats` returns computed values only:
  - `books` = count of books in the database (always shown).
  - `categories` = count of distinct non-empty values in the field with role `category`; **omitted if no such field** or all values are empty.
  - `available` = count of books marked available in the field with role `availability`; **omitted if no such field** (do not assume "all available").
  - Optional extra tiles when data exists: `authors` (distinct first authors), `locations` (distinct Floor+Rack+Shelf combos), so the row is not empty-looking when only Books remains.
- [ ] Frontend renders one tile per key present in the response; no hard-coded numbers or labels fallback. With the current Excel the row shows **Books** and **Authors** (and **Shelves** if wanted).
- [ ] Numbers update immediately after an admin upload, edit or delete (invalidate the stats query; server cache ≤ 60 s or cleared on write).
- [ ] While loading show skeleton tiles; on error hide the row (no "0" placeholders).
- [ ] Labels are pluralised correctly (`1 Book`, `2 Books`) and numbers use Indian digit grouping (`1,25,000`) when large.
- [ ] Tests: catalogue with no category/availability fields → only `books` (+ `authors`); catalogue with both fields → all three; delete a book → count drops.

## 3. Header: remove Home, icon-only Login

- [ ] Delete the **Home** link (house icon + text) from the header, desktop and mobile. The crest/lockup on the left links to `/` instead.
- [ ] Login button: remove the word "Login" from the pink button. Show the **user icon only**, same pink style (round or pill with equal padding), still visible to everyone.
- [ ] Keep it accessible: `aria-label="Login"` and `title="Login"` (tooltip on hover), 44 px minimum tap target, visible focus ring.
- [ ] Clicking it opens `/login`; after sign-in the same button shows the admin's initial/avatar with the menu (Admin dashboard · Sign out).
- [ ] Header right side is now: icon login button · divider · "PROUD PARTNER OF RAJASTHAN ROYALS" mark.

## 4. Acceptance checklist
- [ ] Home page shows no vertical scrollbar at the test sizes in section 1; stats are on one line.
- [ ] With the Excel data, stats show real counts only; nothing invented.
- [ ] No Home link and no "Login" text in the header; the user icon opens `/login`; screen readers read "Login".
- [ ] Search, book detail and admin screens are unaffected and scroll normally.

## 5. Interpretation to confirm
"Remove the login written on the logo" is read as: remove the **text "Login" from the button** but keep the button (icon only). If you meant removing the whole button, say so and the admin would be reached only by typing `/login`.
