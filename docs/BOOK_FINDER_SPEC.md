# Library Book Finder – Project Specification

> Purpose of this file: a build brief (for you or an AI coding assistant) to create a library **"where is this book?"** website, modelled on [bookfinderlibrary.vercel.app](https://bookfinderlibrary.vercel.app/), with **keyword / partial-match search** (even a single letter works).

---

## 1. Reference Site Analysis

**Site:** https://bookfinderlibrary.vercel.app/ (title: "Book Finder")

The site is a client-rendered React app (Create React App), so its text content is not visible without running JavaScript. What follows comes from its public build files (`asset-manifest.json` and the compiled CSS). Items marked *(inferred)* are educated guesses from class names, not confirmed behaviour. Please open the live site once and compare.

| Aspect | Finding |
|---|---|
| Framework | React (create-react-app build) |
| Styling | Tailwind CSS v3.4 + some custom CSS |
| Carousel | Swiper.js is bundled (likely a homepage banner/slider) *(inferred)* |
| Custom CSS classes | `Locate`, `centralLibrary`, `BookInput`, `BookSearchDiv`, `BookResultDiv`, `IdDiv`, `counterLabel`, `search-card`, `home-card`, `form-container`, `form-input`, `form-label`, `form-button` |
| Core idea | Search for a book, then see **where it is located** in the library (shelf / rack / place) *(inferred from class names such as "Locate" and "BookResultDiv")* |
| Home | Big "Central Library" style heading with a logo, plus clickable `home-card` tiles *(inferred)* |
| Search | A text input inside a `search-card` (max width ~600px), with results shown in a centered result area *(inferred)* |
| Data entry | A styled form (`form-container` with labelled inputs and a green submit button), likely for adding books *(inferred)* |
| Buttons | Blue, green, red, and yellow buttons with hover states, which suggests actions like add, edit, delete, and update *(inferred)* |
| Look and feel | Light cards (`#f7fbff`) with rounded corners and soft shadows, a dark-blue header color (`#092c72`), Gill Sans / Calibri-style heading font, centered layout, mobile layout that hides the big heading below 560px |

**Takeaway:** Keep the same simple concept (search, then see the book's exact location) with a clean card-based UI that works on phones.

---

## 2. Goal

Build a website where a visitor types something in a search box and instantly sees **which books match and exactly where each one is placed** (shelf, rack, floor, etc.).

### The key difference: flexible keyword matching

The search must be forgiving and instant:

- Typing **a single letter** (e.g. `A`) shows **every book whose details contain that letter**.
- Typing part of a word (`harr`) finds "Harry Potter".
- Typing a whole title finds that book.
- Search is **case-insensitive** (`a` = `A`).
- The same box also matches **author, category/subject, ISBN, and shelf code**, not only the title.
- Results update **as the user types** (no need to press Enter).

---

## 3. Core Features

### 3.1 Search (main feature)
1. Single search input, auto-focused on page load.
2. Live results while typing (debounced ~150 ms).
3. Matching rules (all case-insensitive, accents ignored):
   - **Substring match**: the query appears anywhere in a searchable field.
   - **Multi-word queries**: split by spaces; a book matches if **every** word matches somewhere (AND logic). Example: `potter rowling`.
   - Searchable fields: `title`, `author`, `category`, `isbn`, `shelf`, `location` (and `tags` if added).
4. **Ranking** (best first):
   1. Title starts with the query
   2. A word in the title starts with the query
   3. Title contains the query
   4. Author / category / other fields contain the query
   5. Ties broken alphabetically by title
5. **Highlight** the matched letters/words in the results.
6. Show a **result count** ("12 books found").
7. **Empty state**: friendly "No books found for 'xyz'. Try fewer letters." message.
8. Empty query: show a hint ("Type a letter or book name to begin") or the full catalogue, paginated.

### 3.2 Result card (what each result shows)
- Book title (highlighted match)
- Author
- Category / subject
- **Location block (the important part):**
  - Floor / Section / Room
  - Rack or Shelf number (e.g. `Rack 4 – Shelf C`)
  - Optional: position on the shelf (e.g. "3rd from left")
- Availability badge: *Available* / *Issued* (optional)
- Optional cover image

### 3.3 Browse
- Home page tiles (like `home-card`) for categories or sections, which open a filtered list.

### 3.4 Admin (add / edit / delete books)
- Simple login (password or email) protecting admin pages.
- **Add Book form:** title, author, category, ISBN, shelf, rack, floor/section, copies, cover URL.
- Edit and delete with a confirmation dialog (blue = edit, red = delete, green = save).
- Optional: bulk import from CSV/Excel.

### 3.5 Nice-to-have
- Typo tolerance (fuzzy match: "hary poter" finds "Harry Potter").
- Voice search.
- Barcode / ISBN scan.
- Mini library map highlighting the shelf.
- Recent searches.
- Dark mode.

---

## 4. Search Algorithm (reference implementation)

```js
// Normalise: lowercase + strip accents
const norm = (s = "") =>
  s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function searchBooks(books, rawQuery) {
  const q = norm(rawQuery).trim();
  if (!q) return [];                       // or return all books

  const words = q.split(/\s+/);            // multi-word AND search

  return books
    .map((book) => {
      const title    = norm(book.title);
      const haystack = norm(
        [book.title, book.author, book.category, book.isbn, book.shelf, book.location].join(" ")
      );

      // every word must appear somewhere
      if (!words.every((w) => haystack.includes(w))) return null;

      // scoring
      let score = 0;
      if (title.startsWith(q))                          score += 100;
      else if (title.split(/\s+/).some((t) => t.startsWith(q))) score += 60;
      else if (title.includes(q))                       score += 40;
      else                                              score += 10; // matched other field

      return { book, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title))
    .map((r) => r.book);
}
```

**Behaviour checks:**

| User types | Expected result |
|---|---|
| `a` | All books with the letter "a" anywhere in title/author/etc., title-starting-with-A first |
| `HARRY` | Same as `harry` |
| `pot` | Harry **Pot**ter, **Pot**ions Handbook, etc. |
| `rowling potter` | Only books matching both words |
| `C-12` | Books on shelf code C-12 |
| `zzzz` | Empty state message |

> Note: a single letter can match a large part of the catalogue. Use **pagination or "Load more"** (e.g. 20 per page) so the page stays fast.

---

## 5. Data Model

```json
{
  "id": "b-0001",
  "title": "Introduction to Algorithms",
  "author": "Thomas H. Cormen",
  "category": "Computer Science",
  "isbn": "9780262046305",
  "floor": "2",
  "section": "Computer Science",
  "rack": "R-07",
  "shelf": "C",
  "position": "3rd from left",
  "copies": 3,
  "available": true,
  "coverUrl": ""
}
```

Computed location label: `Floor 2 → Computer Science → Rack R-07 → Shelf C`

---

## 6. Suggested Tech Stack

| Layer | Option A (simple) | Option B (scalable) |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS | Next.js + Tailwind CSS |
| Data | Local `books.json` file | Supabase / Firebase / MongoDB Atlas |
| Search | In-browser JS (code above) or Fuse.js for fuzzy | Postgres `ILIKE` / full-text search, or Meilisearch |
| Admin auth | Simple password + local storage | Supabase Auth / Firebase Auth |
| Hosting | Vercel / Netlify | Vercel + managed DB |

**Recommendation:** Start with Option A. For a few thousand books, client-side search is instant and needs no backend. Move data into a database later when staff need to edit books online.

---

## 7. Pages and Routes

| Route | Page |
|---|---|
| `/` | Home: logo, big search box, category tiles |
| `/search?q=` | Live results list (shareable link) |
| `/book/:id` | Book details and exact location |
| `/browse/:category` | Books in a category |
| `/admin` | Login |
| `/admin/books` | Manage books (table with add/edit/delete) |
| `/admin/books/new` | Add Book form |

---

## 8. UI / UX Guidelines

- **Mobile first**: most people will search from a phone while standing in the library.
- Large, centered search box; minimum 16px font so iOS does not zoom.
- Card layout: light background, rounded corners (8px), soft shadow.
- Colors: deep blue header, white/very light blue cards, green for success/available, red for issued/delete, yellow for warnings.
- Make the **location** the most prominent part of each result (bold, colored badge).
- Keyboard: `/` focuses search, `Esc` clears it.
- Accessibility: labelled input, sufficient contrast, `aria-live` region announcing result count.

---

## 9. Folder Structure (Option A)

```
book-finder/
├─ public/
├─ src/
│  ├─ components/
│  │  ├─ SearchBar.jsx
│  │  ├─ BookCard.jsx
│  │  ├─ ResultList.jsx
│  │  ├─ LocationBadge.jsx
│  │  └─ Highlight.jsx
│  ├─ pages/
│  │  ├─ Home.jsx
│  │  ├─ Search.jsx
│  │  ├─ BookDetails.jsx
│  │  └─ admin/ (Login.jsx, Books.jsx, BookForm.jsx)
│  ├─ data/books.json
│  ├─ utils/search.js
│  ├─ App.jsx
│  └─ main.jsx
├─ tailwind.config.js
└─ package.json
```

---

## 10. Build Plan

1. **Setup**: create the Vite + React + Tailwind project.
2. **Data**: create `books.json` with 30–50 sample books (include varied letters, authors, and shelves).
3. **Search util**: implement `searchBooks()` from section 4 and unit-test the table in that section.
4. **UI**: SearchBar, ResultList, BookCard with highlighting and location badge.
5. **Pages**: Home, Search, Book details, Browse.
6. **Admin**: login, add/edit/delete (start with local JSON, then connect a database).
7. **Polish**: responsive layout, empty states, pagination, accessibility.
8. **Deploy**: push to GitHub, import into Vercel.

---

## 11. Acceptance Criteria

- [ ] Typing `a` lists all books containing the letter "a" (in any searchable field).
- [ ] Search is case-insensitive and updates while typing.
- [ ] Partial words and full titles both work.
- [ ] Searching by author, category, or shelf code also works.
- [ ] Each result clearly shows **where the book is placed** (floor/rack/shelf).
- [ ] The matched text is highlighted in results.
- [ ] A "no results" message appears for unmatched queries.
- [ ] Layout works on a 360px-wide phone screen.
- [ ] Admin can add, edit, and delete a book, and the change shows in search immediately.
- [ ] Page loads and searches in under 1 second for ~5,000 books.

---

## 12. Sample Seed Data

```json
[
  { "id": "b-0001", "title": "Harry Potter and the Philosopher's Stone", "author": "J.K. Rowling", "category": "Fiction", "isbn": "9780747532699", "floor": "1", "rack": "R-02", "shelf": "A", "available": true },
  { "id": "b-0002", "title": "Introduction to Algorithms", "author": "Thomas H. Cormen", "category": "Computer Science", "isbn": "9780262046305", "floor": "2", "rack": "R-07", "shelf": "C", "available": true },
  { "id": "b-0003", "title": "Wings of Fire", "author": "A.P.J. Abdul Kalam", "category": "Biography", "isbn": "9788173711466", "floor": "1", "rack": "R-05", "shelf": "B", "available": false },
  { "id": "b-0004", "title": "Concepts of Physics", "author": "H.C. Verma", "category": "Physics", "isbn": "9788177091878", "floor": "3", "rack": "R-11", "shelf": "D", "available": true },
  { "id": "b-0005", "title": "The Alchemist", "author": "Paulo Coelho", "category": "Fiction", "isbn": "9780062315007", "floor": "1", "rack": "R-02", "shelf": "C", "available": true }
]
```

---

## 13. Open Questions (confirm before building)

1. Is this for **one real library** (you will enter its books) or a demo?
2. How are locations described there: **floor + rack + shelf**, or something simpler like "Shelf 12"?
3. How many books approximately? (This decides client-side vs. database search.)
4. Do you need **admin login** from day one, or a read-only site first?
5. Language: English only, or Hindi as well?
