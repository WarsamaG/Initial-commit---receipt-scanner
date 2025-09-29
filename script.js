// Receipt Scanner logic
// - Handles drag & drop and file input
// - Uses Tesseract.js for client-side OCR
// - Parses date, merchant, total from OCR text
// - Displays results and supports CSV download
// - Includes robust error handling and progress updates

(function () {
  "use strict";

  // UI elements
  const dropArea = document.getElementById("drop-area");
  const fileInput = document.getElementById("file-input");
  const browseBtn = document.getElementById("browse-btn");
  const progressWrap = document.getElementById("progress");
  const progressBar = document.getElementById("progress-bar");
  const statusText = document.getElementById("status-text");
  const errorBox = document.getElementById("error");

  const dateValueEl = document.getElementById("date-value");
  const merchantValueEl = document.getElementById("merchant-value");
  const totalValueEl = document.getElementById("total-value");
  const downloadBtn = document.getElementById("download-csv");

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }

  function resetUI() {
    if (progressWrap) progressWrap.classList.add("hidden");
    if (progressBar) progressBar.value = 0;
    if (statusText) statusText.textContent = "";
  }

  function setProgress(message, progress) {
    if (progressWrap) progressWrap.classList.remove("hidden");
    if (statusText && message) statusText.textContent = message;
    if (typeof progress === "number" && progressBar) {
      progressBar.value = Math.max(0, Math.min(1, progress));
    }
  }

  async function handleFile(file) {
    clearError();
    resetUI();

    if (!file) {
      showError("No file selected.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      showError("Please select an image file (JPG, PNG, GIF).");
      return;
    }

    try {
      setProgress("Loading image…", 0);
      const imageUrl = URL.createObjectURL(file);

      setProgress("Running OCR…", 0.05);
      const result = await Tesseract.recognize(imageUrl, "eng", {
        logger: (m) => {
          if (m && m.status) {
            if (m.status === "recognizing text" && typeof m.progress === "number") {
              setProgress("Recognizing text…", m.progress);
            } else if (m.status === "loading tesseract core") {
              setProgress("Loading OCR engine…", 0.1);
            } else if (m.status === "initializing tesseract") {
              setProgress("Initializing OCR…", 0.15);
            } else if (m.status === "loading language traineddata") {
              setProgress("Loading language data…", 0.2);
            }
          }
        },
      });

      const text = result?.data?.text || "";
      if (!text.trim()) {
        showError("OCR did not detect any text. Try a clearer photo.");
        resetUI();
        return;
      }

      setProgress("Parsing text…", 0.98);
      const parsed = parseReceiptText(text);
      displayResults(parsed);
      resetUI();
    } catch (err) {
      console.error(err);
      showError("Something went wrong during OCR. Please try again.");
      resetUI();
    }
  }

  function parseReceiptText(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const fullText = lines.join(" \\n ");

    const datePatterns = [
      /(20\d{2}|19\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])/, // YYYY-MM-DD
      /(0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])[-\/.](20\d{2}|19\d{2})/, // MM-DD-YYYY
      /(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2}|19\d{2})/, // DD-MM-YYYY
      /(0?[1-9]|[12]\d|3[01])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*\s+(20\d{2}|19\d{2})/i,
    ];

    let foundDate = "";
    for (const rx of datePatterns) {
      const m = fullText.match(rx);
      if (m) { foundDate = m[0]; break; }
    }

    let foundTotal = "";
    const currencyAmount = /(?:\$|USD\s*\$?|EUR\s*€?|£|€)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/;
    const amountOnly = /(?<![A-Za-z])([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})(?![A-Za-z])/;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const isTotalLine = /(grand\s*total|total\s*amount|amount\s*due|balance\s*due|total)/i.test(line);
      if (isTotalLine) {
        const m1 = line.match(currencyAmount);
        if (m1) { foundTotal = m1[0].replace(/^[^0-9$€£]+/, "").trim(); break; }
        const m2 = line.match(amountOnly);
        if (m2) { foundTotal = m2[0]; break; }
      }
    }

    if (!foundTotal) {
      let maxVal = -1; let maxStr = "";
      for (const line of lines) {
        const matches = line.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/g);
        if (!matches) continue;
        for (const s of matches) {
          const v = parseFloat(s.replace(/,/g, ""));
          if (!isNaN(v) && v > maxVal) { maxVal = v; maxStr = s; }
        }
      }
      if (maxVal > 0) foundTotal = maxStr;
    }

    let foundMerchant = "";
    const skipKeywords = /(receipt|invoice|store|market|mart|supermarket|shop|cashier|transaction|date|time|subtotal|tax|vat|total|amount|phone|tel|address|pos|terminal|card|change|cash|credit|debit)/i;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const line = lines[i];
      const alphaRatio = (line.replace(/[^A-Za-z]/g, "").length || 0) / line.length;
      if (alphaRatio < 0.3) continue;
      if (skipKeywords.test(line)) continue;
      if (line.length < 2) continue;
      foundMerchant = line.replace(/[^A-Za-z0-9 .,&'-]/g, "").replace(/\s{2,}/g, " ").trim();
      if (foundMerchant) break;
    }

    return { date: foundDate || "", merchant: foundMerchant || "", total: foundTotal || "", raw: text };
  }

  function displayResults(data) {
    dateValueEl.textContent = data.date || "—";
    merchantValueEl.textContent = data.merchant || "—";
    totalValueEl.textContent = data.total || "—";
    downloadBtn.disabled = !(data.date || data.merchant || data.total);
    downloadBtn.dataset.date = data.date || "";
    downloadBtn.dataset.merchant = data.merchant || "";
    downloadBtn.dataset.total = data.total || "";
  }

  function downloadCSV() {
    const rows = [ ["Date", "Merchant", "Total"], [ downloadBtn.dataset.date || "", downloadBtn.dataset.merchant || "", downloadBtn.dataset.total || "" ] ];
    const csv = rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `receipt_data_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function escapeCsv(value) {
    const v = String(value ?? "");
    if (/[",\n]/.test(v)) { return '"' + v.replace(/"/g, '""') + '"'; }
    return v;
  }

  function bindEvents() {
    ["dragenter", "dragover"].forEach((evtName) => {
      dropArea.addEventListener(evtName, (e) => { e.preventDefault(); e.stopPropagation(); dropArea.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach((evtName) => {
      dropArea.addEventListener(evtName, (e) => { e.preventDefault(); e.stopPropagation(); dropArea.classList.remove("dragover"); });
    });
    dropArea.addEventListener("drop", (e) => { const files = e.dataTransfer?.files; if (files && files.length > 0) handleFile(files[0]); });

    dropArea.addEventListener("click", () => fileInput.click());
    browseBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { const files = fileInput.files; if (files && files.length > 0) { handleFile(files[0]); fileInput.value = ""; } });

    downloadBtn.addEventListener("click", downloadCSV);
  }

  bindEvents();
})();
