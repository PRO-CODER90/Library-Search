# Library Search — Book Locator

Poornima University Central Library: search any book and see exactly which **floor, rack and shelf** it is on.

- **Frontend:** React 18 + Vite + React Router (`web/`)
- **Backend:** Node.js 22 (no dependencies): `node:http`, built-in SQLite (`node:sqlite`), scrypt auth (`backend/`)
- **Shared:** `shared/search.js` — normalisation and highlighting used by both sides

## Run

```bash
npm run build      # installs and builds the React app into web/dist
npm start          # http://localhost:5000 (serves the API and web/dist)
npm test           # 70 backend tests
npm run dev & npm run dev:web   # API on :5000, Vite dev server with /api proxy
```

Node 22.13+ required. In development the server prints a one-off admin password for `/login`.

## Features

- Live, ranked, accent-insensitive search over every searchable field (one letter is enough; `R-07` = `r07`), with highlighting.
- Location "call slip", step-by-step directions and a shelf diagram for every book.
- Excel (.xlsx) or CSV catalogue upload with preview, placeholder shelf locations and inline editing.
- **Schema-less catalogue:** upload any CSV; columns become fields automatically (replace / append / upsert, dry-run diff). The UI renders from `/api/fields`, never from hard-coded column names.
- **Admin:** the header's **Login** button opens `/login`; the dashboard is `/admin` (Books, Upload, Fields; a separate lazy chunk, `noindex`). Sign-in with a scrypt-hashed password, `HttpOnly; SameSite=Strict` session cookie, CSRF header, rate limiting (10 failures / 15 min), audit log. Without a session every admin endpoint answers 401.

## Admin setup

```bash
npm run admin:hash -- --generate
```

Set the printed `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` in the environment (Vercel → Settings → Environment Variables), redeploy, then click **Login**. Production refuses to start with a partial or weak setup; on Vercel with none set, sign-in is off.

## Deploy (Vercel)

`vercel.json` builds the React app (`npm run build` → `web/dist`) and runs the backend as the `api/index.js` function. Vercel has no persistent disk: the database lives in `/tmp` and resets on cold starts (sample catalogue reloads). For a real, editable catalogue host `npm start` on a server with a persistent disk and set `DB_PATH`.

Specs are in `docs/`.
