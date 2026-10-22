# Library Search — React Frontend + Hidden Admin

> Change request for the Poornima University Central Library "Book Locator".
> Two changes: **(1)** rebuild the frontend in React JS to match the approved design (hero screenshot), **(2)** remove the public "Staff" button and make the admin panel invisible and reachable only by the real admin.
>
> The backend (Node + SQLite, `backend/src/**`) and the public API stay as they are, except where section 2 says otherwise.

---

## 0. Current state (what exists today)

| Area | Today |
|---|---|
| Frontend | Hand-written vanilla JS SPA in `public/` (`js/router.js`, `js/views/*.js`, one 1,489-line `css/styles.css`), no build step |
| Nav | `public/index.html` line 29 has a public `<a href="/admin">Staff</a>` link |
| Admin routes | `/admin`, `/admin/books`, `/admin/upload`, `/admin/fields`, `/admin/notices` registered in `public/js/main.js` for everyone |
| Admin auth | A single shared `ADMIN_TOKEN` sent in the `x-admin-token` header; the browser keeps it in `sessionStorage` (`api.js`) |
| Leaks | `GET /api/config` returns `adminEnabled`; the login page says "Staff area" and explains what staff can do; the Browse empty state says "ask staff to mark a column…"; in development the token defaults to `dev-admin-token` and the README prints it |
| Hosting | Vercel (`vercel.json`: `outputDirectory: public`, SPA rewrite, strict CSP `style-src 'self'; script-src 'self'`) |

---

## 1. Move the frontend to React JS

### 1.1 Why
The vanilla preset cannot produce the target design (diagonal-cut photo hero, layered illustrations, animated search, keyboard shortcut, card lists). Moving to React gives reusable components, proper routing and a build pipeline for assets and fonts.

### 1.2 Stack

| Concern | Choice |
|---|---|
| Build | **Vite** + React 18 (JavaScript, not TypeScript — "React JS") |
| Routing | `react-router-dom` v6 (replaces `public/js/router.js`) |
| Data | `fetch` wrapper + `@tanstack/react-query` (caching, loading and error states, debounced search) |
| Styling | Plain CSS Modules (or one `tokens.css` + per-component `.module.css`). **No inline `style=` attributes** and no CDN fonts — the current CSP is `style-src 'self'` |
| Fonts | Self-hosted via `@fontsource/*` (no Google Fonts request) |
| Icons | `lucide-react` (search, book-open, database/layers, users, arrow-right, user) |
| Tests | Vitest + React Testing Library for components; keep the existing backend `node --test` suite |

### 1.3 Project layout

Move the frontend out of `public/` into its own folder; `public/` keeps only static assets (favicons, manifest, logo).

```
/
├─ backend/                 (unchanged)
├─ api/index.js             (unchanged)
├─ web/                     ← NEW React app
│  ├─ index.html
│  ├─ vite.config.js        (dev proxy: /api → http://localhost:5000)
│  ├─ package.json
│  ├─ public/               (favicons, site.webmanifest, logo-header.png, hero + illustration assets)
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx            (routes)
│     ├─ api/               (client.js, queries.js)
│     ├─ styles/            (tokens.css, global.css)
│     ├─ components/
│     │  ├─ Header/         (logo lockup, nav, optional admin avatar)
│     │  ├─ Hero/           (headline, subline, SearchBar, StatsRow, HeroArt)
│     │  ├─ SearchBar/      (input, Ctrl/⌘+K hint, submit button)
│     │  ├─ StatsRow/
│     │  ├─ UpdateCard/     (thumbnail, badge, date, title, text, arrow)
│     │  ├─ BookCard/  LocationSlip/  AvailabilityBadge/  EmptyState/  ErrorState/
│     │  └─ Decor/          (botanical line art, campus sketch, stacked books)
│     ├─ pages/             (Home, SearchResults, Book, Browse, Updates, NotFound)
│     └─ admin/             (lazy-loaded chunk — see section 2)
└─ package.json             (root scripts call into web/ and backend/)
```

### 1.4 Scripts and deployment

- Root `package.json`:
  - `dev` → run backend (`npm run dev:api`) and Vite (`npm --prefix web run dev`) together.
  - `build` → `npm --prefix web ci && npm --prefix web run build` (output `web/dist`).
  - `start` → backend serves `web/dist` and falls back to `index.html` for non-`/api` paths. Change `config.publicDir` to `web/dist`.
- `vercel.json`: `buildCommand` = `npm run build`, `outputDirectory` = `web/dist`. Keep the `/api/*` rewrite, the SPA fallback and the CSP (keep `script-src 'self'`; allow `img-src 'self' data:`).
- Node requirement stays `>=22.13`; the old "no `npm install` needed" note in the README is replaced by "run `npm run build` once".
- Delete `public/js/**`, `public/css/styles.css` and the old `public/index.html` only after parity (section 1.8) is checked.

### 1.5 Target design — the home page (match the screenshot)

**Overall mood:** warm "old university library" — cream paper, navy ink, gold accents, serif type, hand-drawn line art.

**Design tokens** (`styles/tokens.css`; pick exact values from the screenshot with an eyedropper)

| Token | Approx. value | Use |
|---|---|---|
| `--navy-900` | `#0B2A4A` | Header, headline, primary button, stat numbers |
| `--navy-700` | `#14407A` | Links ("View all updates"), focus ring |
| `--cream-50` | `#FBF6EA` | Page background, with a subtle paper-grain texture |
| `--cream-100` | `#F5EEDC` | Cards, search bar fill |
| `--gold-500` | `#C8962E` | Active nav underline, small rules, "NEW ARRIVAL" badge, italic *your* |
| `--ink-600` | `#4A4A4A` | Body copy |
| `--line` | `#E4D8BC` | Hairlines, card borders |

**Type**
- Display and headings: a high-contrast book serif (e.g. `@fontsource/source-serif-4` or `libre-caslon-text`), bold, tight leading. H1 ≈ 64–72 px desktop.
- Eyebrow/lockup text: same serif, small caps, wide tracking (`PU LIBRARY · BOOK INDEX 01`, `POORNIMA UNIVERSITY`).
- Handwritten tagline: a script font (e.g. `@fontsource/caveat`), rotated about −8°.
- UI text (placeholder, badges): serif or a quiet sans — do not mix more than two families plus the script.

**Header** (navy bar, ~94 px)
- Left: Poornima University crest (`logo-header.png`) + three-line lockup: `POORNIMA UNIVERSITY` / `CENTRAL LIBRARY` / `BOOK LOCATOR` (gold).
- Right: **Browse**, **Updates** — active item is gold with a gold underline. **No "Staff" link.**
- Far right: a circular user-icon button. **It renders only when an admin session exists** (section 2.5). Anonymous visitors see just Browse and Updates, so nothing hints that an admin area exists.
- Library name comes from `/api/config` (`libraryName`) rather than being hard-coded.

**Hero** (cream background, left 60% / right 40%)
- Eyebrow: gold rules either side of `PU LIBRARY · BOOK INDEX 01`.
- H1, two lines: "Find the book." / "Find *your* place." — "your" in gold italic.
- Sub-copy: "Search by title, author, subject or shelf code." and, smaller, "One letter is enough to get started."
- **SearchBar:** large rounded rectangle, 2 px navy border, magnifier icon, placeholder "Search title, author, subject or shelf code…", a `Ctrl K` key-cap hint (shows `⌘ K` on macOS), and a square navy submit button with an arrow at the right end.
  - `Ctrl/⌘+K` focuses the input from anywhere; `Esc` blurs it.
  - Typing searches live (debounce 150 ms, one letter is enough) and navigates to `/search?q=…`; `Enter` or the arrow button submits.
- **StatsRow** under the search bar: three items separated by thin vertical rules — book-open icon **25 Books**, database icon **12 Categories**, users icon **21 Available now**. Values come from `GET /api/stats`; never hard-code them.
- **Right side:** full-bleed library photo, clipped with a diagonal left edge (`clip-path: polygon(...)`), flush with the header and the hero's bottom edge. Provide `web/public/hero-library.jpg` (the photo from the mock-up or a licensed equivalent) in AVIF/WebP + JPG with explicit width/height.
- **Decorative art** (SVG/PNG with transparent background, `aria-hidden="true"`, `pointer-events: none`):
  - botanical line sketches on the left edge;
  - pencil sketch of the campus clock-tower building behind the search area;
  - handwritten "Knowledge today / A brighter tomorrow" with a short gold underline, near the photo;
  - a stack of sketched books labelled DISCOVER / SEARCH / LOCATE / READ / REPEAT, bottom right, with leaf sprigs.
  - On screens under 900 px hide the sketches, keep the botanical sprig, and stack the photo above or below the headline.

**Library updates section**
- Heading "Library updates" with a short gold rule and a hairline running to the right edge, then **View all updates →** (navy, underlined) linking to `/updates`.
- `UpdateCard` (one row, rounded 12 px, hairline border): 250 × 120 thumbnail on the left; gold pill **NEW ARRIVAL** + date (`16 Oct 2026`); bold serif title; one-line description; arrow icon on the far right. The whole card is a link.
- Data: `GET /api/notices` (latest 1–3). If a notice has no image, show the stacked-books placeholder. The badge text comes from the notice's category (add an optional `kind` to notices if it isn't there; default "UPDATE").

**Motion and states:** respect `prefers-reduced-motion`; skeleton shimmer for stats and notices; clear empty/error states; visible focus rings (`--navy-700`, 3 px).

### 1.6 Other pages (restyle with the same tokens, keep existing behaviour)

| Route | Content | Notes |
|---|---|---|
| `/` | Home (above) | |
| `/search?q=` | Ranked results as `BookCard`s with highlighted matches and the **location call slip + step-by-step directions** | Reuse the logic from `home.js` / `components.js`; fields come from `/api/fields`, never hard-coded column names |
| `/book/:id` | Book details and location | |
| `/browse`, `/browse/:field/:value` | Category tiles and filtered list | Change the empty-state text to "Nothing to browse yet." — no mention of staff |
| `/updates` | Full list of notices | |
| `*` | Friendly 404 | Also used for unauthorised admin URLs (section 2.4) |

### 1.7 Accessibility and quality bar
- Semantic landmarks (`header`, `nav`, `main`), one `h1` per page, labelled search `role="search"`.
- Contrast: gold text on cream must be ≥ 4.5:1 — use a darker gold (`#9A6F12`) for small text, bright gold only for rules and large type.
- Keyboard: full tab order, skip link, `Ctrl/⌘+K`.
- Performance: route-level code splitting, hero image `fetchpriority="high"`, decorative art lazy-loaded, Lighthouse ≥ 90 on Performance and Accessibility.

### 1.8 Parity checklist (must pass before deleting the old frontend)
- [ ] Typing a single letter returns every book containing it, paged.
- [ ] Multi-word, accent-insensitive and punctuation-insensitive codes (`R-07` = `r07`) behave as before.
- [ ] Result cards, call slip and directions render from `/api/fields` — a CSV with different columns still works with no frontend change.
- [ ] Browse by category, book detail, updates list.
- [ ] Deep links and refresh work on Vercel and on `npm start` (SPA fallback).
- [ ] No CSP violations in the console.
- [ ] Looks like the screenshot at 1440 px; usable at 390 px.

---

## 2. Remove "Staff"; make the admin panel hidden and truly admin-only

### 2.1 Goals
1. Nothing in the public UI or API tells a visitor that an admin area exists.
2. Only the real admin can open it, and **the server enforces this** — hiding links is not security.
3. A visitor who guesses the URL sees the normal "page not found".

### 2.2 Remove every public trace
- [ ] Delete the **Staff** link from the header (old `public/index.html:29`; the React `Header` must not render it).
- [ ] Remove the public Staff-related copy: the Browse empty state ("ask staff…"), the footer, `site.webmanifest`, the README quick-start line ("Sign in to the staff area at `/admin`…") and any `robots`/sitemap entry.
- [ ] Stop exposing `adminEnabled` in `GET /api/config` (`backend/src/routes/books.js:28`). Public config returns only what the public UI needs (`libraryName`).
- [ ] Rename the UI wording from "Staff area / Staff sign in" to neutral "Library admin" and show it **only after** authentication.
- [ ] Add `<meta name="robots" content="noindex,nofollow">` and `X-Robots-Tag: noindex` for the admin path.

### 2.3 Hidden admin entry point
- [ ] Add env var `ADMIN_PATH` (default none). The admin UI is mounted at `/<ADMIN_PATH>` (for example `/lib-desk-7f3k9q`), **not** at `/admin`. Pass it to the frontend at build time as `VITE_ADMIN_PATH`.
- [ ] Remove the `/admin/*` routes. If `VITE_ADMIN_PATH` is unset, no admin route is registered at all.
- [ ] Load the whole admin UI as a **lazy chunk** (`React.lazy(() => import("./admin"))`) so public visitors never download it.
- [ ] Treat the secret path only as a *second* layer. The real gate is 2.4.

### 2.4 Real authentication (replace the shared header token)

The current model — one long token typed into a form and stored in `sessionStorage` — is easy to leak (any XSS, shared screens, the dev default). Replace it:

| Item | Requirement |
|---|---|
| Credentials | `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (scrypt/argon2 hash, generated with a helper script `npm run admin:hash`). No plaintext password in env or code. |
| Login | `POST /api/<ADMIN_PATH>/login` (or `/api/auth/login`) with username + password. Constant-time comparison; reuse the existing rate limiter (10 failures / 15 min / IP) and add a short delay on failure. Same generic error for any failure. |
| Session | Server-signed session in an **`HttpOnly; Secure; SameSite=Strict`** cookie, 8-hour expiry, rotated on login, cleared on logout. Nothing stored in `localStorage`/`sessionStorage`. |
| CSRF | State-changing admin calls require a custom header (`X-Requested-With: library-admin`) plus the `SameSite=Strict` cookie; reject others with 403. |
| Enforcement | Every admin route (`{ admin: true }` in `routes/*.js`, including upload, export, delete-all, fields, notices) checks the session in `middleware/adminAuth.js`. Unauthenticated requests get **404 (not 401/403)** so the endpoints look non-existent. |
| Page gate | `/<ADMIN_PATH>` renders the login form to anyone who knows the URL; every other admin screen redirects to it when `GET /api/admin/me` is not authenticated. Any other unknown path → the normal 404 page. |
| Production safety | The server **refuses to start** in production if `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `ADMIN_PATH` are missing or the session secret is shorter than 32 bytes. Remove the `dev-admin-token` default; in development, generate a random password at start-up and print it once to the console. |
| Audit | Log successful and failed logins (time, IP, no password) and every destructive action (delete book, delete all, replace catalogue). |
| Optional | TOTP two-factor for the admin account (nice-to-have, not required for this change). |

Backwards compatibility: remove `x-admin-token` from `Access-Control-Allow-Headers` (`http.js:159`) once the cookie flow works, and delete `ADMIN_TOKEN` from `.env.example`.

### 2.5 Frontend behaviour
- [ ] `AuthContext` calls `GET /api/admin/me` on load of the admin chunk only (public pages make no admin request).
- [ ] Header shows the **user avatar button** from the mock-up only when `me.authenticated` is true; it opens a small menu: *Admin dashboard* · *Sign out*. Anonymous visitors see no avatar.
- [ ] A `RequireAdmin` route wrapper protects `books`, `upload`, `fields`, `notices`; on 401/404 it clears state and navigates to the login screen.
- [ ] Sign-out calls `POST /api/admin/logout` and clears the React Query cache.
- [ ] Port the existing admin screens (Books, Upload CSV with dry-run diff, Fields editor, Updates/notices, export) to React components under `web/src/admin/` — same features, restyled to the new tokens.

### 2.6 Acceptance tests (add to `backend/tests/api.test.js` and the React test suite)
- [ ] `GET /api/config` has no `adminEnabled` key.
- [ ] Every admin endpoint returns **404** with no cookie, with a forged cookie, with an expired cookie, and with the old `x-admin-token` header.
- [ ] Correct credentials → cookie set with `HttpOnly`, `Secure` (production), `SameSite=Strict`; wrong credentials → generic error; the 11th failure in 15 min → 429.
- [ ] A state-changing admin request without the CSRF header → 403.
- [ ] Production start fails without the admin env vars.
- [ ] Rendered public pages (Home, Search, Book, Browse, Updates) contain no "Staff", "admin" or `/admin` text/links; the public JS bundle does not include admin code (check build output for the admin chunk name).
- [ ] `/admin` and any random path show the 404 page; `/<ADMIN_PATH>` shows the login form.
- [ ] Signed-in admin sees the avatar, can upload a CSV, edit fields, post an update; after sign-out all admin URLs behave as anonymous again.

---

## 3. Suggested order of work

1. Scaffold `web/` with Vite + React, tokens, fonts, header, home hero, stats and update card — compare with the screenshot until it matches.
2. Port Search, Book, Browse, Updates to React; run the parity checklist (1.8).
3. Switch build/deploy (`vercel.json`, root scripts, `publicDir`); verify deep links.
4. Implement the new admin auth on the backend (2.4) with tests, then remove `x-admin-token`.
5. Port the admin screens into the lazy chunk and wire `RequireAdmin` + avatar (2.5).
6. Remove all public Staff/admin traces (2.2), delete the old `public/js` + CSS, update README, `.env.example` and docs, run the full test suite.

## 4. Decisions to confirm
- **Admin URL:** pick the secret path (`ADMIN_PATH`) and the admin username.
- **Avatar icon:** the mock-up shows a user icon in the header. This spec shows it only to a signed-in admin; say so if you want it removed entirely.
- **Hero photo and sketches:** supply the final image files (or approve using licensed/generated equivalents).
- **Hosting:** Vercel's `/tmp` database resets on cold starts, so admin uploads there are temporary. For a real catalogue the admin edits, host the Node server with a persistent disk.
