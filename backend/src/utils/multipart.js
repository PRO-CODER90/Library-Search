// Minimal multipart/form-data parser for one uploaded file plus text fields.
// The whole body is already in memory (size-limited by the caller), so files
// are never written to disk.

export function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("Missing multipart boundary.");
  const delimiter = Buffer.from(`--${match[1] ?? match[2]}`);
  const fields = {};
  const files = {};

  let start = body.indexOf(delimiter);
  while (start !== -1) {
    start += delimiter.length;
    if (body.slice(start, start + 2).toString() === "--") break; // closing delimiter
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    const end = body.indexOf(delimiter, start);
    if (end === -1) break;
    // Part content ends with CRLF before the next delimiter.
    const part = body.slice(start, end - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const headers = part.slice(0, split).toString("utf8");
      const content = part.slice(split + 4);
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
      const type = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim() ?? "";
      if (name !== undefined) {
        if (filename !== undefined) files[name] = { filename, type, buffer: content };
        else fields[name] = content.toString("utf8");
      }
    }
    start = end;
  }
  return { fields, files };
}
