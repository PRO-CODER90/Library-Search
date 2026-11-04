// Admin-only Support tab: the developer's contact details (from build-time
// env, never hard-coded) and a contact form that posts to Formspree.
// Only the signed-in admin ever loads this chunk.

import { useState } from "react";
import { storage } from "../hooks.js";
import { useAdmin } from "./AdminApp.jsx";
import { useToast } from "./parts.jsx";

const env = import.meta.env;
const CONTACT = {
  name: env.VITE_SUPPORT_NAME || "",
  email: env.VITE_SUPPORT_EMAIL || "",
  phone: env.VITE_SUPPORT_PHONE || "",
  hours: env.VITE_SUPPORT_HOURS || "",
  response: env.VITE_SUPPORT_RESPONSE || "Within 24 hours",
};
const ENDPOINT = env.VITE_FORMSPREE_ENDPOINT || "https://formspree.io/f/xdeepoow";
const APP_VERSION = "3.0.0";
const THROTTLE_MS = 30 * 1000;
const LAST_SENT = "supportLastSent";

const ISSUES = [
  "Cannot upload CSV/Excel",
  "Book data wrong",
  "Search problem",
  "Login problem",
  "Visitor counter",
  "Feature request",
  "Other",
];
const PRIORITIES = ["Low", "Normal", "Urgent"];
const TAB_NAMES = { books: "Books", upload: "Upload", fields: "Fields", support: "Support" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (phone) => phone.replace(/[^\d+]/g, "");
// Plain text only: strip control characters before sending.
const clean = (text, max) => String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);

function istNow() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
}

function CopyButton({ text }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="button button-small button-ghost"
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => toast("Copied."))
          .catch(() => toast("Couldn't copy.", "error"))
      }
    >
      Copy
    </button>
  );
}

function ContactCard() {
  const configured = CONTACT.name || CONTACT.email || CONTACT.phone;
  return (
    <section className="card support-card">
      <h2>Developer contact</h2>
      {!configured ? (
        <p className="muted">
          Contact details are not set yet. Add VITE_SUPPORT_NAME, VITE_SUPPORT_EMAIL, VITE_SUPPORT_PHONE and VITE_SUPPORT_HOURS to the
          environment and rebuild.
        </p>
      ) : (
        <dl className="support-list">
          {CONTACT.name && (
            <div>
              <dt>Name</dt>
              <dd>{CONTACT.name}</dd>
            </div>
          )}
          {CONTACT.email && (
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> <CopyButton text={CONTACT.email} />
              </dd>
            </div>
          )}
          {CONTACT.phone && (
            <div>
              <dt>Phone / WhatsApp</dt>
              <dd>
                <a href={`tel:${digits(CONTACT.phone)}`}>{CONTACT.phone}</a> ·{" "}
                <a href={`https://wa.me/${digits(CONTACT.phone).replace(/^\+/, "")}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>{" "}
                <CopyButton text={CONTACT.phone} />
              </dd>
            </div>
          )}
          {CONTACT.hours && (
            <div>
              <dt>Availability</dt>
              <dd>{CONTACT.hours}</dd>
            </div>
          )}
          <div>
            <dt>Response time</dt>
            <dd>{CONTACT.response}</dd>
          </div>
        </dl>
      )}
      {CONTACT.phone && <p className="support-note">For urgent issues, call or WhatsApp.</p>}
    </section>
  );
}

const EMPTY = { name: "", email: "", phone: "", department: "", issue: "", priority: "Normal", subject: "", message: "", page: "", link: "", consent: false, _gotcha: "" };

function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = "Enter your name.";
  if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.issue) e.issue = "Choose an issue type.";
  if (!f.subject.trim()) e.subject = "Enter a subject.";
  const len = f.message.trim().length;
  if (len < 10 || len > 2000) e.message = "Write 10 to 2,000 characters.";
  if (f.link && !/^https?:\/\/\S+$/i.test(f.link.trim())) e.link = "Paste a full link starting with https://";
  if (!f.consent) e.consent = "Please tick to agree.";
  return e;
}

function Field({ id, label, required = false, error = "", children }) {
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function ContactForm() {
  const { me } = useAdmin();
  const tab = TAB_NAMES[new URLSearchParams(window.location.search).get("from")] ?? "Support";
  const [form, setForm] = useState({ ...EMPTY, name: me.username, page: `Admin → ${tab}` });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const aria = (key) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `s-${key}-error` } : {});

  async function submit(event) {
    event.preventDefault();
    setStatus(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (form._gotcha) return; // a bot filled the hidden trap: drop silently
    const wait = THROTTLE_MS - (Date.now() - storage.get(LAST_SENT, 0));
    if (wait > 0) {
      setStatus({ ok: false, text: `Please wait ${Math.ceil(wait / 1000)} s before sending again.` });
      return;
    }

    const body = new FormData();
    body.append("name", clean(form.name, 100));
    body.append("email", clean(form.email.trim(), 200));
    body.append("phone", clean(form.phone, 40));
    body.append("department", clean(form.department, 120));
    body.append("issue", form.issue);
    body.append("priority", form.priority);
    body.append("subject", clean(form.subject, 150));
    body.append("_subject", `[Library Admin] ${clean(form.subject, 150)}`);
    body.append("message", clean(form.message.trim(), 2000));
    body.append("page", clean(form.page, 150));
    if (form.link) body.append("screenshot_link", clean(form.link.trim(), 500));
    body.append("consent", "yes");
    body.append("_gotcha", "");
    // Context for the developer. Never the session cookie, passwords or hashes.
    body.append("admin_username", me.username);
    body.append("app_version", APP_VERSION);
    body.append("browser", clean(navigator.userAgent, 300));
    body.append("site", window.location.origin);
    body.append("time_ist", istNow());

    setBusy(true);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errors?.map((e) => e.message).join(" ") || `Sending failed (${response.status}).`);
      storage.set(LAST_SENT, Date.now());
      setStatus({ ok: true, text: `Sent. The developer will reply to ${form.email.trim()}.` });
      setForm({ ...EMPTY, name: me.username, page: form.page });
      setErrors({});
    } catch (error) {
      const fallback = [CONTACT.email && `email ${CONTACT.email}`, CONTACT.phone && `call ${CONTACT.phone}`].filter(Boolean).join(" or ");
      setStatus({ ok: false, text: `${error.message || "Sending failed."}${fallback ? ` You can also ${fallback}.` : ""}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form support-form" onSubmit={submit} noValidate>
      <h2>Report a problem or ask for help</h2>
      <div className="form-grid">
        <Field id="s-name" label="Your name" required error={errors.name}>
          <input id="s-name" autoComplete="name" maxLength={100} value={form.name} onChange={set("name")} {...aria("name")} />
        </Field>
        <Field id="s-email" label="Your email" required error={errors.email}>
          <input id="s-email" type="email" autoComplete="email" maxLength={200} value={form.email} onChange={set("email")} {...aria("email")} />
        </Field>
        <Field id="s-phone" label="Phone">
          <input id="s-phone" type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={set("phone")} />
        </Field>
        <Field id="s-department" label="Library / department">
          <input id="s-department" maxLength={120} value={form.department} onChange={set("department")} />
        </Field>
        <Field id="s-issue" label="Issue type" required error={errors.issue}>
          <select id="s-issue" value={form.issue} onChange={set("issue")} {...aria("issue")}>
            <option value="">Choose…</option>
            {ISSUES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </Field>
        <Field id="s-priority" label="Priority" required>
          <select id="s-priority" value={form.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <div className="field-wide">
          <Field id="s-subject" label="Subject" required error={errors.subject}>
            <input id="s-subject" maxLength={150} value={form.subject} onChange={set("subject")} {...aria("subject")} />
          </Field>
        </div>
        <div className="field-wide">
          <Field id="s-message" label="Message" required error={errors.message}>
            <textarea id="s-message" rows={5} maxLength={2000} value={form.message} onChange={set("message")} {...aria("message")} />
            <span className="char-count" aria-live="polite">
              {form.message.trim().length} / 2000
            </span>
          </Field>
        </div>
        <Field id="s-page" label="Page / what you were doing">
          <input id="s-page" maxLength={150} value={form.page} onChange={set("page")} />
        </Field>
        <Field id="s-link" label="Screenshot link (optional)" error={errors.link}>
          <input id="s-link" type="url" placeholder="https://drive.google.com/…" maxLength={500} value={form.link} onChange={set("link")} {...aria("link")} />
        </Field>
      </div>
      {/* Spam trap: people never see or fill this. */}
      <input type="text" name="_gotcha" className="visually-hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form._gotcha} onChange={set("_gotcha")} />
      <label className={`check${errors.consent ? " has-error" : ""}`}>
        <input type="checkbox" checked={form.consent} onChange={set("consent")} {...aria("consent")} />
        <span>I agree that these details are sent to the developer.</span>
      </label>
      {errors.consent && (
        <p className="field-error" id="s-consent-error">
          {errors.consent}
        </p>
      )}
      {status && (
        <p className={status.ok ? "form-ok" : "form-error"} role={status.ok ? "status" : "alert"}>
          {status.text}
        </p>
      )}
      <div>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Sending…" : "Send to developer"}
        </button>
      </div>
    </form>
  );
}

export default function Support() {
  return (
    <section className="support">
      <h1>Support</h1>
      <ContactCard />
      <ContactForm />
    </section>
  );
}
