function spreadsheetSafe(value) {
  const text = value == null ? '' : String(value);
  return /^(?:[\t\r]|\s*[=+\-@])/.test(text) ? `'${text}` : text;
}

export function csvCell(value) {
  return `"${spreadsheetSafe(value).replaceAll('"', '""')}"`;
}

export function createCsv(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
