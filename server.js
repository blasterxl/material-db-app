const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 4177);
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const DB_PATH =
  process.env.MATERIAL_DB_PATH ||
  path.join(APP_DIR, "databaza_materialov.json");
const BACKUP_DIR = path.join(APP_DIR, "zalohy_material_db_app");
const LABEL_PDF_SCRIPT = path.join(APP_DIR, "generate_labels_pdf.py");

const materialFields = [
  "nazov",
  "interny_kod",
  "poradove_cislo",
  "skratka",
  "EAN_QR",
  "merna_jednotka",
];
const propertyFields = [
  "oblubeny",
  "nedostupny",
  "vyradeny",
  "archivovany",
  "skryty",
  "skupiny",
  "tagy",
  "poznamka",
  "updatedAt",
];
const undoStack = [];

function defaultProperties(overrides = {}) {
  return {
    oblubeny: Boolean(overrides.oblubeny),
    nedostupny: Boolean(overrides.nedostupny),
    vyradeny: Boolean(overrides.vyradeny),
    archivovany: Boolean(overrides.archivovany),
    skryty: Boolean(overrides.skryty),
    skupiny: Array.isArray(overrides.skupiny)
      ? overrides.skupiny
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    tagy: Array.isArray(overrides.tagy)
      ? overrides.tagy
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    poznamka: String(overrides.poznamka || ""),
    updatedAt: String(overrides.updatedAt || ""),
  };
}

function normalizeMaterial(material) {
  const normalized = { ...material };
  for (const field of materialFields) {
    normalized[field] = String(material?.[field] ?? "").trim();
  }
  normalized.vlastnosti = defaultProperties(material?.vlastnosti);
  return normalized;
}

function normalizeDb(db) {
  const materials = Array.isArray(db.materials)
    ? db.materials.map(normalizeMaterial).filter((item) => item.interny_kod)
    : [];
  const seen = new Set();
  const deduped = [];
  for (const material of materials) {
    if (seen.has(material.interny_kod)) continue;
    seen.add(material.interny_kod);
    deduped.push(material);
  }
  return {
    schema: {
      version: 2,
      fields: materialFields,
      propertyFields,
      primaryKey: "interny_kod",
    },
    generatedAt: db.generatedAt || new Date().toISOString(),
    updatedAt: db.updatedAt || "",
    count: deduped.length,
    materials: deduped,
  };
}

function readDb() {
  return normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, "utf8")));
}

function backupCurrentDb() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "_");
  const backupPath = path.join(BACKUP_DIR, `databaza_materialov_${stamp}.json`);
  fs.copyFileSync(DB_PATH, backupPath);
  return backupPath;
}

function pushUndo(db, label) {
  undoStack.push({
    label,
    at: new Date().toISOString(),
    db: structuredClone(db),
  });
  while (undoStack.length > 10) undoStack.shift();
}

function saveDb(db) {
  const normalized = normalizeDb({
    ...db,
    updatedAt: new Date().toISOString(),
  });
  normalized.materials.sort((a, b) =>
    a.interny_kod.localeCompare(b.interny_kod, "sk"),
  );
  normalized.count = normalized.materials.length;
  backupCurrentDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function statsFor(db) {
  const counts = {
    spolu: db.materials.length,
    oblubene: 0,
    nedostupne: 0,
    vyradene: 0,
    archivovane: 0,
    skryte: 0,
    bezSkratky: 0,
  };
  for (const material of db.materials) {
    const props = defaultProperties(material.vlastnosti);
    if (props.oblubeny) counts.oblubene += 1;
    if (props.nedostupny) counts.nedostupne += 1;
    if (props.vyradeny) counts.vyradene += 1;
    if (props.archivovany) counts.archivovane += 1;
    if (props.skryty) counts.skryte += 1;
    if (!material.skratka) counts.bezSkratky += 1;
  }
  return counts;
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function textResponse(
  res,
  status,
  body,
  contentType = "text/plain; charset=utf-8",
) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function pdfResponse(res, filename, body) {
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": body.length,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function findMaterial(db, code) {
  return db.materials.find((material) => material.interny_kod === code);
}

// СТАЛО:
function bundledPythonPath() {
  // 1. Перевіряємо змінну оточення
  if (
    process.env.MATERIAL_DB_PYTHON_EXE &&
    fs.existsSync(process.env.MATERIAL_DB_PYTHON_EXE)
  ) {
    return process.env.MATERIAL_DB_PYTHON_EXE;
  }
  // 2. Якщо локальна Windows-папка Codex існує (для тестів на вашому ПК)
  const codexRuntime =
    "C:\\Users\\dtp1.FC\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  if (fs.existsSync(codexRuntime)) return codexRuntime;

  // 3. Для Linux / Docker / Render.com використовуємо системний python3
  return process.env.PYTHON_EXE || "python3";
}

function labelPdfFilename(materials) {
  const safe = (value) =>
    String(value || "stitky")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
  if (materials.length === 1)
    return `stitok_${safe(materials[0].interny_kod)}.pdf`;
  return `stitky_materialy_${materials.length}ks.pdf`;
}

function createLabelsPdf(materials) {
  const input = JSON.stringify({ materials });
  const result = spawnSync(bundledPythonPath(), [LABEL_PDF_SCRIPT], {
    input: Buffer.from(input, "utf8"),
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString("utf8") : "";
    throw new Error(
      stderr || `PDF generátor skončil s kódom ${result.status}.`,
    );
  }
  if (
    !result.stdout ||
    result.stdout.subarray(0, 4).toString("ascii") !== "%PDF"
  ) {
    throw new Error("PDF generátor nevrátil platný PDF súbor.");
  }
  return result.stdout;
}

function materialFromPayload(payload) {
  return normalizeMaterial({
    ...payload,
    vlastnosti: defaultProperties(payload.vlastnosti),
  });
}

function validateMaterial(material, db, originalCode = "") {
  const missing = materialFields.filter(
    (field) =>
      field !== "skratka" &&
      field !== "poradove_cislo" &&
      field !== "EAN_QR" &&
      !material[field],
  );
  if (missing.length) {
    return `Chýbajú povinné polia: ${missing.join(", ")}.`;
  }
  const duplicate = db.materials.find(
    (item) =>
      item.interny_kod === material.interny_kod &&
      item.interny_kod !== originalCode,
  );
  if (duplicate) {
    return `Interný kód "${material.interny_kod}" už existuje.`;
  }
  return "";
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    jsonResponse(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/db") {
    const db = readDb();
    jsonResponse(res, 200, {
      ...db,
      stats: statsFor(db),
      undoAvailable: undoStack.length > 0,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/favorites") {
    const db = readDb();
    const favorites = db.materials
      .filter((material) => defaultProperties(material.vlastnosti).oblubeny)
      .map((material) => ({
        interny_kod: material.interny_kod,
        poradove_cislo: material.poradove_cislo,
        skratka: material.skratka,
        nazov: material.nazov,
      }));
    jsonResponse(res, 200, { count: favorites.length, favorites });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const db = readDb();
    jsonResponse(res, 200, {
      ok: true,
      dbPath: DB_PATH,
      count: db.materials.length,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/labels/pdf") {
    const payload = await readBody(req);
    const codes = Array.isArray(payload.codes) ? payload.codes.map(String) : [];
    const db = readDb();
    const byCode = new Map(
      db.materials.map((material) => [material.interny_kod, material]),
    );
    const materials = codes.map((code) => byCode.get(code)).filter(Boolean);
    if (!materials.length) {
      jsonResponse(res, 400, {
        error: "Nie sú vybraté žiadne materiály pre PDF.",
      });
      return;
    }
    pdfResponse(res, labelPdfFilename(materials), createLabelsPdf(materials));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/undo") {
    const last = undoStack.pop();
    if (!last) {
      jsonResponse(res, 409, { error: "Nie je čo vrátiť späť." });
      return;
    }
    backupCurrentDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(last.db, null, 2), "utf8");
    const db = readDb();
    jsonResponse(res, 200, {
      message: `Vrátené späť: ${last.label}`,
      db,
      stats: statsFor(db),
      undoAvailable: undoStack.length > 0,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/materials") {
    const payload = await readBody(req);
    const db = readDb();
    const material = materialFromPayload(payload);
    const error = validateMaterial(material, db);
    if (error) {
      jsonResponse(res, 400, { error });
      return;
    }
    pushUndo(db, `pridanie ${material.interny_kod}`);
    db.materials.push(material);
    const saved = saveDb(db);
    jsonResponse(res, 201, {
      material: findMaterial(saved, material.interny_kod),
      stats: statsFor(saved),
      undoAvailable: true,
    });
    return;
  }

  if (url.pathname.startsWith("/api/materials/")) {
    const code = decodeURIComponent(
      url.pathname.replace("/api/materials/", ""),
    );
    const db = readDb();
    const current = findMaterial(db, code);
    if (!current) {
      jsonResponse(res, 404, { error: `Materiál "${code}" sa nenašiel.` });
      return;
    }

    if (req.method === "PUT") {
      const payload = await readBody(req);
      const incoming = materialFromPayload({
        ...current,
        ...payload,
        vlastnosti: { ...current.vlastnosti, ...(payload.vlastnosti || {}) },
      });
      const error = validateMaterial(incoming, db, code);
      if (error) {
        jsonResponse(res, 400, { error });
        return;
      }
      pushUndo(db, `úprava ${code}`);
      Object.assign(current, incoming);
      current.vlastnosti.updatedAt = new Date().toISOString();
      const saved = saveDb(db);
      jsonResponse(res, 200, {
        material: findMaterial(saved, incoming.interny_kod),
        stats: statsFor(saved),
        undoAvailable: true,
      });
      return;
    }

    if (req.method === "DELETE") {
      const payload = await readBody(req);
      if (!payload.confirm || payload.confirmText !== code) {
        jsonResponse(res, 400, {
          error: "Mazanie treba potvrdiť presným interným kódom.",
        });
        return;
      }
      pushUndo(db, `vymazanie ${code}`);
      db.materials = db.materials.filter((item) => item.interny_kod !== code);
      const saved = saveDb(db);
      jsonResponse(res, 200, {
        deleted: code,
        stats: statsFor(saved),
        undoAvailable: true,
      });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/bulk") {
    const payload = await readBody(req);
    const codes = Array.isArray(payload.codes) ? payload.codes.map(String) : [];
    const db = readDb();
    const selected = db.materials.filter((material) =>
      codes.includes(material.interny_kod),
    );
    if (!selected.length) {
      jsonResponse(res, 400, { error: "Nie sú vybraté žiadne materiály." });
      return;
    }

    if (payload.action === "delete") {
      if (!payload.confirm || payload.confirmText !== String(selected.length)) {
        jsonResponse(res, 400, {
          error: "Hromadné mazanie treba potvrdiť počtom vybratých položiek.",
        });
        return;
      }
      pushUndo(db, `hromadné vymazanie ${selected.length} položiek`);
      db.materials = db.materials.filter(
        (material) => !codes.includes(material.interny_kod),
      );
      const saved = saveDb(db);
      jsonResponse(res, 200, {
        affected: selected.length,
        stats: statsFor(saved),
        undoAvailable: true,
      });
      return;
    }

    if (payload.action === "addGroup" || payload.action === "removeGroup") {
      const group = String(payload.group || "").trim();
      if (!group) {
        jsonResponse(res, 400, { error: "Chýba názov skupiny." });
        return;
      }
      pushUndo(db, `hromadná zmena skupiny ${group}`);
      for (const material of selected) {
        material.vlastnosti = defaultProperties(material.vlastnosti);
        const set = new Set(material.vlastnosti.skupiny);
        if (payload.action === "addGroup") set.add(group);
        else set.delete(group);
        material.vlastnosti.skupiny = [...set].sort((a, b) =>
          a.localeCompare(b, "sk"),
        );
        material.vlastnosti.updatedAt = new Date().toISOString();
      }
      const saved = saveDb(db);
      jsonResponse(res, 200, {
        affected: selected.length,
        stats: statsFor(saved),
        undoAvailable: true,
      });
      return;
    }

    if (
      !["oblubeny", "nedostupny", "vyradeny", "archivovany", "skryty"].includes(
        payload.action,
      )
    ) {
      jsonResponse(res, 400, { error: "Neznáma hromadná akcia." });
      return;
    }

    pushUndo(db, `hromadná zmena ${payload.action}`);
    const value = Boolean(payload.value);
    for (const material of selected) {
      material.vlastnosti = defaultProperties(material.vlastnosti);
      material.vlastnosti[payload.action] = value;
      material.vlastnosti.updatedAt = new Date().toISOString();
    }
    const saved = saveDb(db);
    jsonResponse(res, 200, {
      affected: selected.length,
      stats: statsFor(saved),
      undoAvailable: true,
    });
    return;
  }

  jsonResponse(res, 404, { error: "API endpoint neexistuje." });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    textResponse(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    textResponse(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream";
  textResponse(res, 200, fs.readFileSync(filePath), mime);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    jsonResponse(res, 500, { error: error.message || "Neznáma chyba." });
  }
});

server.listen(PORT, () => {
  console.log(`Material DB app beží na http://localhost:${PORT}`);
  console.log(`Databáza: ${DB_PATH}`);
});
