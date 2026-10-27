# New Look (Navy + Pink), No Updates Section, Visible Admin Login

> Supersedes the earlier design and "hidden admin" parts of `REACT_MIGRATION_AND_ADMIN_LOCKDOWN.md`. Everything else (React + Vite, Excel upload, admin editing) stays.
> Keep chat replies to 1–3 lines while implementing.

---

## 1. New look (match the new screenshot)

Replaces the cream/gold "old paper" theme with a **bright navy + pink** theme: white-blush background, wavy navy bands, cherry blossoms and a real building photo.

### 1.1 Tokens (`styles/tokens.css`; confirm exact values with an eyedropper)

| Token | Approx. | Use |
|---|---|---|
| `--navy-900` | `#0B1F4D` | Header band, headline, text, bottom wave |
| `--navy-700` | `#1B3A80` | Links, icons, search border |
| `--pink-500` | `#E8348A` | Login button, search arrow button, "*your*", active nav underline, rules, swooshes |
| `--pink-100` | `#FDE7F1` | Icon circles behind stats, soft blobs |
| `--bg` | `#FFF8FB` → `#FFFFFF` | Page background (soft white-to-blush gradient) |
| `--ink-600` | `#5B6275` | Secondary text |

Remove the old cream, gold and paper-grain tokens and textures.

### 1.2 Header
- Navy band with a **curved/wavy bottom edge** (SVG or `clip-path`), floating above the hero.
- Left: Poornima University crest + lockup `POORNIMA UNIVERSITY` / `CENTRAL LIBRARY` (large white serif caps) / `BOOK LOCATOR` (small, wide-tracked, gold/pale-yellow as in the image).
- Right, in order: **Home** (house icon, pink text, pink underline when active) · **Login** (pink pill button with user icon, see section 3) · thin vertical divider · `PROUD PARTNER OF` / `RAJASTHAN ROYALS` text plus the partner logo.
- **No Browse and no Updates buttons** (section 4).

### 1.3 Hero
- Eyebrow: pink rules either side of `PU LIBRARY · BOOK INDEX 01`.
- H1: "Find the book. / Find *your* place." — bold serif in navy, **"your" in pink italic script style**, ~72 px desktop.
- Sub-copy: "Search by title, author, subject or shelf code." (navy, medium) and "One letter is enough to get started." (grey).
- **Search bar:** white, rounded, 2 px navy border, magnifier icon, `Ctrl` `K` key-caps, and a **pink square button with a white arrow**. Behaviour as before (live search from one letter, `Ctrl/⌘+K` focus, Enter to submit).
- **Stats row** (values from `/api/stats`, never hard-coded): book-open **Books**, database **Categories**, users **Available now**; each icon sits in a **soft pink circle**; thin vertical dividers between items.
- **Right side:** large photo of the library building framed by a **curved wave edge** on the left and bottom; cherry-blossom branches overlapping the top-left and right edges of the photo; falling petals (subtle, respect `prefers-reduced-motion`).
- **Decorative art** (`aria-hidden`, transparent PNG/SVG): pink line sketch of the clock tower behind the headline; handwritten "Knowledge today / A brighter tomorrow" with a short pink underline; blossom sprigs and leaf line art on the left edge; open-book sketch bottom left; cricket-batter + palace skyline sketch in pink at the bottom right.
- **Bottom:** a double wave divider (navy band with a pink swoosh above it) closing the hero. The page ends here with a slim footer (library name, copyright).
- Mobile (< 900 px): stack photo under the search block, hide the sketches, keep blossoms small, make Login a compact pill, hide the partner text but keep its logo.

### 1.4 Assets to supply
`hero-library-building.jpg` (WebP/AVIF + JPG), blossom PNGs, clock-tower / book / cricket sketches, Poornima crest, partner logo. Use the images from the design mock-up or licensed equivalents; set explicit width/height; lazy-load decorative images; hero photo `fetchpriority="high"`.

> **Rajasthan Royals name/logo:** it is a third-party brand and the header claims a partnership. Use only the official logo file you have permission to use, and confirm the "Proud partner" wording with the university.

### 1.5 Other pages
Search results, book detail and admin screens adopt the same tokens (navy text, pink buttons and accents, white cards with soft shadow). Keep the call slip and step-by-step directions unchanged.

---

## 2. Remove "Library updates" completely

- [ ] Delete the home-page section (heading, rule, **View all updates →**, and the New Arrivals / Announcements / Events cards) and the `UpdateCard` component.
- [ ] Delete the `/updates` page and route; no link to it anywhere (header, footer, sitemap).
- [ ] Stop calling `GET /api/notices` from the public site.
- [ ] Remove the **Updates** tab from the admin panel and its screen.
- [ ] Backend: remove the notices routes (`backend/src/routes/notices.js`) from the router, except keep `GET /api/admin/check`/`me` (move it to the auth route). Leave the `notices` table untouched so no data is lost; it can be dropped later.
- [ ] Remove the notice-related tests and README/docs mentions.
- [ ] Check there is no empty gap: the hero's bottom wave leads directly into the footer.

---

## 3. Admin page is now visible (un-hide)

This **reverses** section 2 of the earlier lockdown spec (secret path, no public sign of admin).

- [ ] Header has a pink **Login** button (user icon) visible to everyone. It opens `/login`.
- [ ] Remove the `ADMIN_PATH` / `VITE_ADMIN_PATH` secret path. Use fixed routes: `/login` (sign-in form) and `/admin` (dashboard; Upload, Books, Fields tabs).
- [ ] After sign-in the Login button changes to the user's name/avatar with a menu: **Admin dashboard** · **Sign out**. The page you were on is kept.
- [ ] Restore `adminEnabled` in `/api/config` only if needed to show/hide Login; otherwise always show it.
- [ ] Visiting `/admin` while signed out redirects to `/login` (no longer a 404). Wrong URL → normal 404.
- [ ] Remove the `noindex` requirement for `/login`; keep `noindex` on `/admin`.

**Security does not change — only visibility.** Keep everything from section 2.4 of the lockdown spec:
username + hashed password (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`), `HttpOnly; Secure; SameSite=Strict` session cookie, CSRF header, rate limit (10 failures / 15 min), server-side check on **every** admin API, which now returns **401** (not 404) when signed out, audit log, production refuses to start without the admin settings, no default dev token. Only the real admin can open the dashboard; a visible button gives visitors nothing without the credentials.

---

## 4. Remove "Browse" and "Updates" buttons

- [ ] Delete both links from the header (desktop and mobile menu).
- [ ] Header nav is now only: **Home**, **Login** (or the signed-in menu).
- [ ] Updates: page removed entirely (section 2).
- [ ] Browse: the nav button is removed. The `/browse` pages are not linked from anywhere; **keep or delete the route/code** — see decision below. Search keeps working as the only way to find books.

---

## 5. Acceptance checklist
- [ ] Home page at 1440 px matches the screenshot (navy/pink theme, curved header, blossoms, building photo, stats, wave divider); usable at 390 px.
- [ ] No "Library updates" section, no **View all updates**, no `/updates`, no admin Updates tab, no public call to `/api/notices`.
- [ ] Header shows only Home and Login (plus partner mark); no Browse or Updates buttons.
- [ ] Login button opens `/login`; correct credentials reach `/admin`; wrong ones show a generic error; the 11th failure is rate-limited.
- [ ] Every admin API rejects requests without a valid session (401); CSRF header enforced.
- [ ] Search (one letter, multi-word, codes), book detail and Excel/CSV upload and editing still work.
- [ ] No CSP errors (self-hosted fonts, no inline styles).

## 6. Decisions to confirm
- **Browse pages:** keep the `/browse` code unlinked, or delete it? (Default: keep, unlinked.)
- **Partner branding:** confirm permission and supply the official Rajasthan Royals logo file.
- **Admin Updates tab/notices:** removed per "remove completely"; say if you want notices kept for another purpose.
