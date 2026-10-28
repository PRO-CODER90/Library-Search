import { useEffect, useRef } from "react";
import { Icon } from "./Icon.jsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Big search box. Ctrl/⌘+K focuses it from anywhere; Esc clears, then blurs. */
export default function SearchBar({ value, onChange, onSubmit, onKeyDown, inputProps, autoFocus = false }) {
  const input = useRef(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className="searchbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
    >
      <label htmlFor="q" className="visually-hidden">
        Search the catalogue
      </label>
      <Icon name="search" size={26} className="searchbar-icon" />
      <input
        ref={input}
        id="q"
        type="search"
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="search"
        placeholder="Search title, author, subject or shelf code…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== "Escape") return;
          if (value) onChange("");
          else event.currentTarget.blur();
        }}
      />
      {value && (
        <button type="button" className="searchbar-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name="x" size={16} />
        </button>
      )}
      <span className="keycaps" aria-hidden="true">
        <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
        <kbd>K</kbd>
      </span>
      <button type="submit" className="searchbar-go" aria-label="Search">
        <Icon name="arrow-right" size={22} />
      </button>
    </form>
  );
}
