# Library Book Finder – UI Change Request

> Updates to `BOOK_FINDER_SPEC.md` (frontend). Three changes: **(1)** remove the "Browse A–Z" section, **(2)** light theme only in a white, blue and pink palette, **(3)** new favicon using the Poornima University logo.

---

## 1. Remove the "Browse A–Z" Section

The section currently shows a **"Browse A–Z"** heading with a row of letter buttons (`# A B C … Z`) on the home page. Remove it completely.

### 1.1 Frontend tasks
- [ ] Delete the A–Z letter bar component (e.g. `AlphabetBar.jsx` / `BrowseAZ.jsx`) and its styles.
- [ ] Remove the `<h2>Browse A–Z</h2>` heading and the letter buttons from `Home.jsx`.
- [ ] Remove any route that only served the letter filter (e.g. `/browse/letter/:letter` or `/browse?letter=`).
- [ ] Remove letter-filter state and helper functions (e.g. `selectedLetter`, `filterByLetter`, the `#` bucket for titles starting with digits or symbols).
- [ ] Remove related links from the navbar, footer or sitemap.
- [ ] Make sure no empty gap is left on the home page (adjust spacing so the search box and any category tiles sit naturally).

### 1.2 Backend tasks (only if already added)
- [ ] Remove any `?letter=` query handling from `GET /api/books`.
- [ ] Remove any letter-count endpoint (e.g. `/api/facets/letters`).
- [ ] The main search (`GET /api/search`) is **not** affected. A single letter typed in the search box must keep working exactly as before.

### 1.3 Docs and tests
- [ ] In `BOOK_FINDER_SPEC.md`, delete "A-Z letter bar" from section 3.3 (Browse) and from the nice-to-have list if mentioned.
- [ ] Remove any test or acceptance item for A–Z browsing.

### 1.4 Check
- The home page no longer shows "Browse A–Z" or any letter buttons.
- Typing `a` in the search box still lists every book containing "a".
- No console errors or 404s from removed routes.

---

## 2. Theme: Light Only, White + Blue + Pink

### 2.1 Remove everything dark-mode related
- [ ] Delete the dark theme and any theme toggle button.
- [ ] Remove `@media (prefers-color-scheme: dark)` blocks and `[data-theme="dark"]` rules.
- [ ] Remove saved-theme logic (`localStorage` theme key).
- [ ] If using Tailwind, remove `darkMode` config and every `dark:` class.
- [ ] Force light everywhere by adding to the HTML head:

```html
<meta name="color-scheme" content="light" />
```

and in CSS:

```css
:root { color-scheme: light; }
```

(This stops browsers from auto-darkening form fields and scrollbars when the user's device is in dark mode.)

### 2.2 Palette

| Role | Name | Hex | Used for |
|---|---|---|---|
| Background | White | `#FFFFFF` | Page background, cards |
| Soft background | Blue tint | `#F3F8FF` | Section backgrounds, input fill, table stripes |
| Primary | Blue | `#1D4ED8` | Header, primary buttons, links, focus ring |
| Primary hover | Dark blue | `#1E40AF` | Button and link hover |
| Primary light | Light blue | `#DBEAFE` | Chips, selected state, borders on hover |
| Accent | Pink | `#DB2777` | Highlights, badges, location label, key call-to-action accent |
| Accent hover | Dark pink | `#BE185D` | Accent hover |
| Accent light | Light pink | `#FCE7F3` | Search-match highlight, soft badges |
| Text | Navy ink | `#0F172A` | Body text and headings |
| Muted text | Slate | `#475569` | Secondary text |
| Border | Light blue-grey | `#E2E8F0` | Card and input borders |
| Success | Green | `#16A34A` | "Available" badge |
| Danger | Red | `#DC2626` | "Issued" badge, delete |

Keep green and red **only** for status meaning (available / issued / delete) so the main look stays white, blue and pink.

### 2.3 CSS variables (drop into the global stylesheet)

```css
:root {
  color-scheme: light;

  --bg:            #FFFFFF;
  --bg-soft:       #F3F8FF;
  --primary:       #1D4ED8;
  --primary-hover: #1E40AF;
  --primary-light: #DBEAFE;
  --accent:        #DB2777;
  --accent-hover:  #BE185D;
  --accent-light:  #FCE7F3;
  --text:          #0F172A;
  --text-muted:    #475569;
  --border:        #E2E8F0;
  --success:       #16A34A;
  --danger:        #DC2626;

  --radius: 10px;
  --shadow: 0 2px 10px rgba(29, 78, 216, 0.10);
}

body {
  background: var(--bg);
  color: var(--text);
}
```

### 2.4 Tailwind config (if Tailwind is used)

```js
// tailwind.config.js
export default {
  // no darkMode key: light only
  theme: {
    extend: {
      colors: {
        brand: {
          bg:        "#FFFFFF",
          soft:      "#F3F8FF",
          blue:      "#1D4ED8",
          blueHover: "#1E40AF",
          blueLight: "#DBEAFE",
          pink:      "#DB2777",
          pinkHover: "#BE185D",
          pinkLight: "#FCE7F3",
          ink:       "#0F172A",
          muted:     "#475569",
          line:      "#E2E8F0",
        },
      },
    },
  },
};
```

### 2.5 Where each color goes

| Element | Style |
|---|---|
| Page | White background, navy text |
| Header / top bar | Solid blue (`--primary`) with white text and the logo |
| Search box | White fill, 2px blue-tint border, blue focus ring; large search icon in blue |
| Search button | Blue background, white text; pink only if you want the single main call-to-action to stand out |
| Result cards | White, thin light-blue border, soft blue shadow, rounded corners |
| Book title | Navy, bold |
| **Location badge** (most important info) | Light-pink background, dark-pink text, pink left border, so the shelf location is the first thing the eye finds |
| Search-match highlight | Light-pink background (`--accent-light`), dark text |
| Category / tag chips | Light-blue background, blue text |
| Available / Issued badges | Green / red text on very light tint of the same color |
| Links and hover | Blue, darker blue on hover |
| Admin buttons | Save = blue, Edit = blue outline, Delete = red |
| Footer | Soft blue background (`--bg-soft`), muted text |

### 2.6 Accessibility rules (keep text readable)
- Body text on white must stay navy (`#0F172A`); never put pink or light blue text on white for normal-size text.
- Pink `#DB2777` on white is about 4.6:1, which passes for text 14px and up; use `#BE185D` for small text.
- White text on blue `#1D4ED8` passes comfortably.
- Do not rely on color alone for status (add words: "Available", "Issued").
- Keep a visible focus outline (`2px solid var(--primary)` with offset) on inputs and buttons.

### 2.7 Check
- Device set to dark mode: the site still renders in light.
- No remaining dark backgrounds anywhere (search for `#0`, `#1`, `bg-gray-9`, `bg-black`, `dark:` in the code).
- Home, search results, book details, and admin screens all use only the palette above.

---

## 3. Favicon: Poornima University Logo

The new favicon is the **Poornima University seal** (blue circular emblem with the "PU" monogram, gear ring, and text "Poornima University" around it).

### 3.1 Source image needed
The image shared in the chat is a small preview (about 366 × 234 px) with a grey gradient background, which will look blurry and boxed when shrunk to a tab icon. For a clean result, provide:

- **Best:** the logo as an **SVG** or a transparent **PNG at least 512 × 512 px** (square, circle centered).
- **Acceptable:** a high-resolution JPG/PNG of the seal on white; the background will be cropped away and made transparent.

Save it as `logo-source.png` in the project root. If you only have the small preview, crop tightly to the circular seal first. Details inside the ring (the small text) will not be legible at 16–32 px; that is normal, and the blue disc with "PU" is what shows in the tab.

### 3.2 Files to generate

| File | Size | Purpose |
|---|---|---|
| `favicon.ico` | 16, 32, 48 px (multi-size) | Classic browsers |
| `favicon.svg` (optional) | vector | Modern browsers, sharpest if an SVG source exists |
| `favicon-32x32.png` | 32 × 32 | Browser tab |
| `favicon-16x16.png` | 16 × 16 | Browser tab (small) |
| `apple-touch-icon.png` | 180 × 180 | iPhone/iPad home screen (use solid white background, no transparency) |
| `android-chrome-192x192.png` | 192 × 192 | Android |
| `android-chrome-512x512.png` | 512 × 512 | Android / PWA splash |
| `site.webmanifest` | n/a | Names and icons for installs |

Place them all in the `public/` folder (Vite or Create React App) or the site root.

### 3.3 Generate with ImageMagick (one-time commands)

```bash
# 1) make a clean square source (circle centered, transparent background)
magick logo-source.png -trim +repage -background none -gravity center \
  -extent "%[fx:max(w,h)]x%[fx:max(w,h)]" logo-square.png

# 2) PNG sizes
magick logo-square.png -resize 16x16   public/favicon-16x16.png
magick logo-square.png -resize 32x32   public/favicon-32x32.png
magick logo-square.png -resize 192x192 public/android-chrome-192x192.png
magick logo-square.png -resize 512x512 public/android-chrome-512x512.png

# 3) Apple icon: solid white background, a little padding
magick logo-square.png -resize 150x150 -background white -gravity center \
  -extent 180x180 -alpha remove public/apple-touch-icon.png

# 4) Multi-size ICO
magick logo-square.png -define icon:auto-resize=48,32,16 public/favicon.ico
```

(No ImageMagick? Upload the square PNG to realfavicongenerator.net and copy the generated files into `public/`.)

### 3.4 HTML head (replace any old favicon lines, including the default React/Vite icon)

```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#1D4ED8" />
<meta name="color-scheme" content="light" />
```

### 3.5 `public/site.webmanifest`

```json
{
  "name": "Library Book Finder",
  "short_name": "Book Finder",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#1D4ED8",
  "background_color": "#FFFFFF",
  "display": "standalone"
}
```

### 3.6 Use the same logo in the header (optional but recommended)
Show `android-chrome-192x192.png` (or the SVG) at about 40 px height at the left of the blue header, next to the site name, so the tab icon and the page branding match.

### 3.7 Check
- Browser tab shows the blue PU seal, not the old default icon.
- Hard refresh (Ctrl+Shift+R) or open in a private window; browsers cache favicons aggressively.
- Add to home screen on a phone and confirm the icon appears with a white background and is not stretched.
- If the site is served from a sub-path, update the `href` values accordingly.

---

## 4. Combined Acceptance Checklist

- [ ] "Browse A–Z" heading and all letter buttons are gone from the home page; no dead routes remain.
- [ ] Search still works for single letters, partial words, and full titles.
- [ ] Only a light theme exists; no dark mode code, no toggle, and light is forced even on dark-mode devices.
- [ ] The UI uses the white / blue / pink palette from section 2.2, with the location badge in pink and primary actions in blue.
- [ ] Text contrast meets accessibility guidance (section 2.6).
- [ ] Favicon files exist in `public/`, the head tags are updated, and the Poornima University seal shows in the browser tab.
- [ ] The manifest and `theme-color` use the same blue as the header.
