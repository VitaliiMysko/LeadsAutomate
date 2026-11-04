// Saves CSV text as `<prefix>-<date>.csv` through the browser's download.
// With a BOM, so Excel reads it as UTF-8. Returns the file name.
export function downloadCsv(text, prefix) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return link.download;
}
