/**
 * Minimal RFC-4180 CSV parser: quoted fields, embedded commas/quotes/newlines,
 * doubled-quote escaping, CRLF or LF. Returns all rows (header included).
 *
 * @example parseCsv('email,name\r\na@b.com,"Doe, Jane"') // [["email","name"],["a@b.com","Doe, Jane"]]
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      started = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      started = true;
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
      i += 1;
      continue;
    }
    field += c;
    started = true;
    i += 1;
  }
  if (started || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
