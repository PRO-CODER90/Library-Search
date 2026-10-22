// Spreadsheet formula-injection guard: a cell starting with = + - @ would run
// as a formula if the exported CSV is opened in Excel. Numbers like -5 are fine.

export function sanitizeCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
}

/** Quote a value for CSV output. */
export function csvCell(value) {
  const text = sanitizeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
