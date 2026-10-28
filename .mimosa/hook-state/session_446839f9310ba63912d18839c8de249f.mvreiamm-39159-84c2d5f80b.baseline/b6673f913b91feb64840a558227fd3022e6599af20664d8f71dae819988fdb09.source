import { sanitizePhone } from "./phone";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

export interface RecipientRecord {
  phone: string;
  chatId: string;
  name: string;
  custom1: string;
  custom2: string;
}

export interface RecipientParseResult {
  recipients: RecipientRecord[];
  invalid: { value: string; reason: string }[];
  phoneColumn: string;
}

const PHONE_HEADER = /(phone|mobile|whatsapp|number|tel|هاتف|جوال|رقم|موبايل)/i;
const NAME_HEADER = /(name|اسم|الاسم|full.?name)/i;
const CUSTOM1_HEADER = /(custom.?1|note|ملاحظة|حقل.?1|مخصص.?1)/i;
const CUSTOM2_HEADER = /(custom.?2|company|شركة|حقل.?2|مخصص.?2)/i;

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 5000);
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = 0;

  for (const delimiter of candidates) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    if (count > bestScore) {
      bestScore = count;
      best = delimiter;
    }
  }

  return best;
}

/** RFC-4180-style parser. Handles quotes, escaped quotes and embedded newlines. */
export function parseCsv(input: string): ParsedCsv {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    matrix.push(row);
  }

  const nonEmpty = matrix.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  const headerCells = nonEmpty.shift() ?? [];
  const headers = uniqueHeaders(headerCells.map((cell) => cell.trim()));

  const rows = nonEmpty.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers, rows, delimiter };
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/** Converts the matrix produced by an .xlsx reader into the same shape as parseCsv. */
export function rowsFromMatrix(matrix: unknown[][]): ParsedCsv {
  const cells = matrix.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim())));
  const nonEmpty = cells.filter((row) => row.some((cell) => cell !== ""));
  const headerCells = nonEmpty.shift() ?? [];
  const headers = uniqueHeaders(headerCells);

  return {
    headers,
    rows: nonEmpty.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    }),
    delimiter: ",",
  };
}

function findHeader(headers: string[], pattern: RegExp, fallback = ""): string {
  return headers.find((header) => pattern.test(header)) ?? fallback;
}

export function recipientsFromRows(
  headers: string[],
  rows: Record<string, string>[],
  defaultCountryCode = "",
  step = 0,
): RecipientParseResult {
  const phoneColumn = findHeader(headers, PHONE_HEADER, headers[0] ?? "");
  const nameColumn = findHeader(headers, NAME_HEADER);
  const custom1Column = findHeader(headers, CUSTOM1_HEADER);
  const custom2Column = findHeader(headers, CUSTOM2_HEADER);

  const invalid: RecipientParseResult["invalid"] = [];
  const seen = new Set<string>();
  const recipients: RecipientRecord[] = [];

  rows.slice(step).forEach((row) => {
    const raw = (row[phoneColumn] ?? "").trim();
    if (!raw) return;
    const sanitized = sanitizePhone(raw, defaultCountryCode);
    if (!sanitized.valid) {
      invalid.push({ value: raw, reason: sanitized.reason });
      return;
    }
    if (seen.has(sanitized.digits)) return;
    seen.add(sanitized.digits);

    recipients.push({
      phone: sanitized.digits,
      chatId: sanitized.chatId,
      name: nameColumn ? (row[nameColumn] ?? "").trim() : "",
      custom1: custom1Column ? (row[custom1Column] ?? "").trim() : "",
      custom2: custom2Column ? (row[custom2Column] ?? "").trim() : "",
    });
  });

  return { recipients, invalid, phoneColumn };
}

/** Prevents spreadsheet formula execution when a cell starts with = + - @. */
export function neutralizeFormula(value: string): string {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value: string, delimiter = ","): string {
  const text = neutralizeFormula(value);
  const needsQuotes = text.includes('"') || text.includes("\n") || text.includes("\r") || text.includes(delimiter);
  const escaped = text.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** UTF-8 BOM makes Excel open Arabic CSV correctly on Windows. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map((cell) => escapeCsvCell(cell)).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(String(cell ?? ""))).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
