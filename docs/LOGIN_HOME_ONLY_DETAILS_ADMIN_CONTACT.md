# Login Label, Home-Only Login Button, Book Page Fit, Admin Support Form

> Builds on the earlier specs. Keep chat replies to 1–3 lines.

---

## 1. "Sign In" → "Login", and only on the Home screen

**Problem (screenshot of `/book/20`):** the header on the book page shows a white **Sign In** pill. It should say **Login**, and it should not appear on any page except Home.

- [ ] Replace every "Sign In" / "Sign in" / "Staff sign in" text with **Login** (button, form title, page `<title>`, messages, tests, README). Sign-out text becomes **Logout**.
- [ ] The Login button (user icon, pink, as in the Home spec) is rendered **only on `/`**. Do not render it on `/book/:id`, search, `/login`, `/admin` or the 404 page. Implement with a header prop (`showLogin={isHome}`) or `useMatch("/")` in `Header`, not by hiding with CSS.
- [ ] All non-Home pages use the **same header as Home** (crest, "Poornima University / Central Library / Book Locator", partner mark) — remove the older header seen on the book page (PU shield + "Central Library / Book Locator" + Sign In pill). One `Header` component for the whole site.
- [ ] Clicking the crest/title goes to `/`. The admin reaches Login from Home, or directly at `/login`.
- [ ] Signed-in admin: on Home the button becomes the avatar menu (Admin dashboard · Logout). Inside `/admin` the admin pages have their own Logout control (the public header is not shown there).
- [ ] Tests: header on `/` has the Login button; on `/book/20`, `/login`, `/admin`, `/xyz` it does not; no occurrence of "Sign In" in the built bundle.

## 2. Remove the "Details" section from the public book page (admin only)

**Problem (screenshot):** the book page is taller than the screen, with a **Details** heading below the fold, so the browser scrolls. The visitor should not have to scroll to it.

- [ ] **Public book page** (`/book/:id`) shows only: Back, cover tile, title, author(s), **Where to find it** (Floor / Rack / Shelf), the 3 steps, and the rack diagram. **Remove the Details section completely** from this page.
- [ ] The page fits one screen with no page scroll (same fixed-height layout rules as Home: `100dvh` column, sizes via `clamp()`/vh; rack diagram scales down; at very small heights the fallback may scroll). Test at 1920×900, 1536×730, 1366×650, 390×844.
- [ ] **Details move to the Admin panel only:** in Admin → Books, opening/editing a book shows a **Details** panel with every field from `/api/fields` (including ones not shown publicly, `entity_id`, placeholder-location flag, created/updated time). Visitors never see it. Public API responses keep returning only fields marked "show on card"/location; the full record stays behind admin auth.
- [ ] Do not scroll to or anchor anything on load (`scrollTo(0,0)` on route change; no `#details` anchors).

## 3. Admin panel only — Support / Contact section

A new tab **Support** in the Admin panel (visible only when logged in; not linked or rendered anywhere public). It lets library staff reach the developer if they face issues.

### 3.1 Contact info card
Config-driven (env / `config.js`, so it can change without code edits). **Fill these in:**

| Item | Value |
|---|---|
| Developer name | `SUPPORT_NAME` — *to be provided* |
| Email | `SUPPORT_EMAIL` — *to be provided* |
| Phone / WhatsApp | `SUPPORT_PHONE` — *to be provided (optional)* |
| Availability | e.g. "Mon–Sat, 10 AM – 7 PM IST" — *to be provided* |
| Response time | e.g. "Within 24 hours" |

Show them with tap-to-call / mailto / WhatsApp links, copy buttons, and a short note: "For urgent issues, call or WhatsApp." Do not hard-code personal details into the repo; read them from env at build time (`VITE_SUPPORT_*`).

### 3.2 Contact form (Formspree)
- **Endpoint:** `https://formspree.io/f/xdeepoow` — store as `VITE_FORMSPREE_ENDPOINT`.
- **Fields**

| Field | Type | Required | Notes |
|---|---|---|---|
| Your name | text | Yes | Prefilled from the admin's account |
| Your email | email | Yes | Formspree reply-to (`email`) |
| Phone | tel | No | |
| Library / department | text | No | |
| Issue type | select | Yes | Cannot upload CSV/Excel · Book data wrong · Search problem · Login problem · Visitor counter · Feature request · Other |
| Priority | select | Yes | Low · Normal · Urgent (default Normal) |
| Subject | text | Yes | Also sent as `_subject` ("[Library Admin] …") |
| Message | textarea | Yes | 10–2000 chars, live counter |
| Page / what you were doing | text | No | Auto-filled with the current admin tab |
| Screenshot or file | file | No | **Only works on Formspree paid plans**; if unavailable remove this field and ask for a link instead |
| Consent line | checkbox | Yes | "I agree that these details are sent to the developer." |
| Honeypot | hidden `_gotcha` | – | Spam trap; must stay empty |

- **Auto-attached context** (hidden fields, no secrets): admin username, app version, browser/OS string, site URL, time (IST). **Never** send the session cookie, passwords or hashes.
- **Behaviour:** submit with `fetch(endpoint, { method: "POST", headers: { Accept: "application/json" }, body: FormData })`; disable the button while sending; success message "Sent. The developer will reply to <email>." and clear the form; on failure show the error plus the direct email/phone as fallback and keep the typed text. Client-side validation with inline error messages, accessible labels, keyboard friendly. Throttle: one submission per 30 seconds per browser.
- **Security (important):**
  - The site's CSP is `connect-src 'self'; form-action 'self'`, which **blocks Formspree**. Update `vercel.json` (and server headers) to `connect-src 'self' https://formspree.io; form-action 'self' https://formspree.io`.
  - The endpoint URL is visible to anyone who inspects the admin JS bundle. In the Formspree dashboard turn on spam filtering/reCAPTCHA and restrict allowed domains to the live site.
  - The form is rendered only for authenticated admins (inside the lazy admin chunk), and sanitised/validated before sending.
- Use the same navy/pink tokens: white card, pink submit button, navy text.

### 3.3 Acceptance
- [ ] Support tab visible only after Login; absent for visitors and in the public bundle.
- [ ] Contact card shows the configured name/email/phone with working links.
- [ ] Valid form submits to Formspree and arrives in the inbox with all fields and the auto-attached context; invalid or honeypot-filled submits are blocked.
- [ ] No CSP errors in the console when submitting.

## 4. Overall acceptance
- [ ] "Login" wording everywhere; button only on Home.
- [ ] Book page has no Details section and no page scrolling at the test sizes.
- [ ] Details and Support exist only inside the Admin panel.

## 5. Decisions needed
- **Developer contact details** (name, email, phone, hours) to show in the Support card.
- **Screenshot upload:** keep only if the Formspree plan supports file uploads.
- **Interpretation:** the stray lines "This is for the Admin panel only" were read as applying to item 2 (Details) and item 4 (Support). Tell me if that is wrong.
