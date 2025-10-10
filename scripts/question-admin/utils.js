function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPermissionDenied(error) {
  if (!error || typeof error !== "object") return false;
  const code = String(error.code || error?.message || "").toLowerCase();
  return (
    code.includes("permission_denied") ||
    code.includes("permission-denied") ||
    code.includes("permission denied")
  );
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && !Number.isNaN(value)) {
    if (value > 1e12) return value;
    if (value > 1e10) return value * 1000;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  return 0;
}

function ensureCrypto() {
  return typeof crypto !== "undefined" && crypto.getRandomValues ? crypto : null;
}

function generateShortId(prefix = "") {
  const cryptoObj = ensureCrypto();
  if (cryptoObj) {
    const bytes = new Uint8Array(8);
    cryptoObj.getRandomValues(bytes);
    let hex = "";
    bytes.forEach(byte => {
      hex += byte.toString(16).padStart(2, "0");
    });
    return `${prefix}${hex}`;
  }

  const fallback = Math.random().toString(16).slice(2, 10);
  return `${prefix}${fallback}`;
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeKey(value) {
  if (value == null) return "";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "";
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return String(value).trim();
}

function stripBom(text) {
  if (!text) return "";
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeCsvBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return "";
  }

  const attempts = [
    () => new TextDecoder("utf-8", { fatal: true }),
    () => new TextDecoder("utf-8"),
    () => new TextDecoder("shift_jis"),
    () => new TextDecoder("windows-31j"),
    () => new TextDecoder("ms932")
  ];

  for (const createDecoder of attempts) {
    try {
      const decoder = createDecoder();
      const text = decoder.decode(bytes);
      if (typeof text === "string") {
        return stripBom(text);
      }
    } catch (error) {
      // Try the next decoder.
    }
  }

  throw new Error(
    "CSVの文字エンコーディングを判別できませんでした。UTF-8形式で保存したファイルをアップロードしてください。"
  );
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const handleError = () => {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    };

    if (typeof TextDecoder === "undefined") {
      const fallbackReader = new FileReader();
      fallbackReader.onload = () => {
        resolve(stripBom(String(fallbackReader.result || "")));
      };
      fallbackReader.onerror = handleError;
      fallbackReader.readAsText(file, "utf-8");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result;
        const buffer =
          result instanceof ArrayBuffer
            ? result
            : result?.buffer instanceof ArrayBuffer
              ? result.buffer
              : null;

        if (!buffer) {
          resolve(stripBom(String(result || "")));
          return;
        }

        const bytes = new Uint8Array(buffer);
        resolve(decodeCsvBytes(bytes));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = handleError;
    reader.readAsArrayBuffer(file);
  });
}

function parseCsv(text) {
  const sanitized = stripBom(String(text || ""));
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];
    if (char === "\"") {
      if (inQuotes && sanitized[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && sanitized[i + 1] === "\n") {
        i++;
      }
      row.push(current);
      rows.push(row);
      current = "";
      row = [];
      continue;
    }
    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.map(cols => cols.map(col => col.trim()));
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export {
  sleep,
  isPermissionDenied,
  toMillis,
  ensureCrypto,
  generateShortId,
  base64UrlFromBytes,
  normalizeKey,
  stripBom,
  decodeCsvBytes,
  readFileAsText,
  parseCsv,
  parseDateTimeLocal
};
