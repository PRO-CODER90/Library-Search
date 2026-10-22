import { extname } from "node:path";
import { HttpError, SECURITY_HEADERS, readBody } from "../http.js";
import { parseMultipart } from "../utils/multipart.js";
import { csvCell } from "../utils/sanitize.js";
import { exportCsv, importCsv } from "../services/library.js";

const CSV_TYPES = new Set(["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream", ""]);
const CSV_EXTENSIONS = new Set([".csv", ".tsv", ".txt"]);

function checkFile(filename, type) {
  if (!CSV_EXTENSIONS.has(extname(filename).toLowerCase())) {
    throw new HttpError(415, "Upload a .csv file (export it from Excel or Google Sheets as CSV).");
  }
  if (!CSV_TYPES.has(type.toLowerCase())) throw new HttpError(415, `Files of type ${type} aren't accepted; upload CSV.`);
}

const flag = (value) => ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());

export function registerUploadRoutes(router, { db, config, audit }) {
  router.add(
    "POST",
    "/api/upload",
    async ({ req, url, session }) => {
      const type = req.headers["content-type"] ?? "";
      // Room for multipart framing around a max-size file.
      const body = await readBody(req, config.maxUploadBytes + 64 * 1024);
      let options;
      let file;

      if (type.startsWith("multipart/form-data")) {
        let parsed;
        try {
          parsed = parseMultipart(body, type);
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        file = parsed.files.file;
        if (!file) throw new HttpError(400, "Attach the CSV as form field “file”.");
        options = parsed.fields;
      } else if (/^(text\/csv|text\/plain|application\/csv)/.test(type)) {
        // Raw CSV body with options in the query string (handy for curl).
        file = { filename: url.searchParams.get("filename") || "upload.csv", type: type.split(";")[0], buffer: body };
        options = Object.fromEntries(url.searchParams);
      } else {
        throw new HttpError(415, "Send multipart/form-data with a “file” field, or a text/csv body.");
      }

      checkFile(file.filename, file.type);
      if (file.buffer.length > config.maxUploadBytes) {
        throw new HttpError(413, `The file is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
      }
      if (!file.buffer.length) throw new HttpError(422, "The file is empty.");

      const report = importCsv(db, {
        buffer: file.buffer,
        filename: file.filename,
        mode: options.mode || "replace",
        keyField: options.keyField || "",
        dryRun: flag(options.dryRun),
      });
      if (!report.dryRun) {
        audit(report.mode === "replace" ? "replace_catalogue" : `upload_${report.mode}`, req, {
          username: session.u,
          filename: file.filename,
          rows: report.rowsImported,
        });
      }
      return report;
    },
    { admin: true, rateLimit: "upload" }
  );

  router.add(
    "GET",
    "/api/export",
    ({ res }) => {
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="library-${stamp}.csv"`,
        "Cache-Control": "no-store",
      });
      res.write("﻿"); // so Excel reads UTF-8
      for (const chunk of exportCsv(db, csvCell)) res.write(chunk);
      res.end();
      return { handled: true };
    },
    { admin: true }
  );
}
