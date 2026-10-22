import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.jsx";

// ---- toast ----

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const show = useCallback((message, tone = "ok") => {
    clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={`toast${toast ? " is-visible" : ""}${toast?.tone === "error" ? " toast-error" : ""}`} role="status">
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}

// ---- dialog ----

export function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const onCancel = (event) => {
      event.preventDefault();
      onClose();
    };
    dialog?.addEventListener("cancel", onCancel);
    return () => dialog?.removeEventListener("cancel", onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} className={`dialog${wide ? " dialog-wide" : ""}`} aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Confirmation dialog; `typeToConfirm` requires typing a word first. */
export function Confirm({ title, body, confirmLabel, typeToConfirm, onConfirm, onClose }) {
  const [typed, setTyped] = useState("");
  const ok = !typeToConfirm || typed === typeToConfirm;
  return (
    <Dialog title={title} onClose={onClose}>
      <p>{body}</p>
      {typeToConfirm && (
        <div className="field">
          <label htmlFor="confirm-word">
            Type <strong>{typeToConfirm}</strong> to confirm
          </label>
          <input id="confirm-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="button button-ghost" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={!ok}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function Tags({ keys, tone }) {
  if (!keys?.length) return <span className="muted">none</span>;
  return keys.map((k) => (
    <code key={k} className={`tag tag-${tone}`}>
      {k}
    </code>
  ));
}
