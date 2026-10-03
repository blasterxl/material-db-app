const state = {
  db: null,
  materials: [],
  filtered: [],
  selectedCode: "",
  selectedRows: loadSavedSelection(),
  lastSelectionIndex: -1,
  renderToken: 0,
  sortKey: "nazov",
  sortDir: "asc",
  filters: {
    query: "",
    visibility: localStorage.getItem("materialDb.visibility") || "active",
    group: "",
    quick: new Set(),
  },
  pendingConfirm: null,
};

const els = {
  statTotal: document.querySelector("#statTotal"),
  statFavorite: document.querySelector("#statFavorite"),
  statUnavailable: document.querySelector("#statUnavailable"),
  statArchived: document.querySelector("#statArchived"),
  searchInput: document.querySelector("#searchInput"),
  visibilityFilter: document.querySelector("#visibilityFilter"),
  groupFilter: document.querySelector("#groupFilter"),
  resultCount: document.querySelector("#resultCount"),
  selectedCount: document.querySelector("#selectedCount"),
  materialsBody: document.querySelector("#materialsBody"),
  selectVisibleCheckbox: document.querySelector("#selectVisibleCheckbox"),
  editorTitle: document.querySelector("#editorTitle"),
  materialForm: document.querySelector("#materialForm"),
  saveEditorButton: document.querySelector("#saveEditorButton"),
  undoButton: document.querySelector("#undoButton"),
  refreshButton: document.querySelector("#refreshButton"),
  newMaterialButton: document.querySelector("#newMaterialButton"),
  archiveButton: document.querySelector("#archiveButton"),
  deleteButton: document.querySelector("#deleteButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  bulkDeleteButton: document.querySelector("#bulkDeleteButton"),
  bulkPrintButton: document.querySelector("#bulkPrintButton"),
  bulkPdfButton: document.querySelector("#bulkPdfButton"),
  bulkGroupInput: document.querySelector("#bulkGroupInput"),
  bulkAddGroupButton: document.querySelector("#bulkAddGroupButton"),
  loadingLine: document.querySelector("#loadingLine"),
  multiEditPanel: document.querySelector("#multiEditPanel"),
  multiEditSummary: document.querySelector("#multiEditSummary"),
  multiGroupInput: document.querySelector("#multiGroupInput"),
  multiAddGroupButton: document.querySelector("#multiAddGroupButton"),
  multiRemoveGroupButton: document.querySelector("#multiRemoveGroupButton"),
  multiPrintButton: document.querySelector("#multiPrintButton"),
  multiDeleteButton: document.querySelector("#multiDeleteButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmText: document.querySelector("#confirmText"),
  confirmLabel: document.querySelector("#confirmLabel"),
  confirmInput: document.querySelector("#confirmInput"),
  cancelConfirm: document.querySelector("#cancelConfirm"),
  acceptConfirm: document.querySelector("#acceptConfirm"),
  toast: document.querySelector("#toast"),
  databaseView: document.querySelector("#databaseView"),
  labelsView: document.querySelector("#labelsView"),
  labelsPrintSelectedButton: document.querySelector("#labelsPrintSelectedButton"),
  labelsPdfSelectedButton: document.querySelector("#labelsPdfSelectedButton"),
  multiPdfButton: document.querySelector("#multiPdfButton"),
};

const fields = {
  nazov: document.querySelector("#fieldNazov"),
  interny_kod: document.querySelector("#fieldKod"),
  poradove_cislo: document.querySelector("#fieldId"),
  skratka: document.querySelector("#fieldSkratka"),
  EAN_QR: document.querySelector("#fieldEan"),
  merna_jednotka: document.querySelector("#fieldMj"),
  groups: document.querySelector("#fieldGroups"),
  tags: document.querySelector("#fieldTags"),
  note: document.querySelector("#fieldNote"),
  favorite: document.querySelector("#propFavorite"),
  unavailable: document.querySelector("#propUnavailable"),
  discontinued: document.querySelector("#propDiscontinued"),
  archived: document.querySelector("#propArchived"),
  hidden: document.querySelector("#propHidden"),
};

function loadSavedSelection() {
  try {
    const values = JSON.parse(localStorage.getItem("materialDb.selectedRows") || "[]");
    return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveSelection() {
  localStorage.setItem("materialDb.selectedRows", JSON.stringify([...state.selectedRows]));
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function propsFor(material) {
  return {
    oblubeny: Boolean(material?.vlastnosti?.oblubeny),
    nedostupny: Boolean(material?.vlastnosti?.nedostupny),
    vyradeny: Boolean(material?.vlastnosti?.vyradeny),
    archivovany: Boolean(material?.vlastnosti?.archivovany),
    skryty: Boolean(material?.vlastnosti?.skryty),
    skupiny: Array.isArray(material?.vlastnosti?.skupiny) ? material.vlastnosti.skupiny : [],
    tagy: Array.isArray(material?.vlastnosti?.tagy) ? material.vlastnosti.tagy : [],
    poznamka: material?.vlastnosti?.poznamka || "",
    updatedAt: material?.vlastnosti?.updatedAt || "",
  };
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Operácia zlyhala.");
  }
  return payload;
}

async function loadDb() {
  const payload = await api("/api/db");
  state.db = payload;
  state.materials = payload.materials || [];
  pruneSelection();
  els.undoButton.disabled = !payload.undoAvailable;
  els.visibilityFilter.value = state.filters.visibility;
  rebuildGroupFilter();
  applyFilters();
  fillEditor(state.selectedCode ? findByCode(state.selectedCode) : null);
  updateEditorMode();
}

function findByCode(code) {
  return state.materials.find((material) => material.interny_kod === code);
}

function pruneSelection() {
  const validCodes = new Set(state.materials.map((material) => material.interny_kod));
  let changed = false;
  for (const code of state.selectedRows) {
    if (!validCodes.has(code)) {
      state.selectedRows.delete(code);
      changed = true;
    }
  }
  if (changed) saveSelection();
}

function rebuildGroupFilter() {
  const current = els.groupFilter.value;
  const groups = new Set();
  for (const material of state.materials) {
    for (const group of propsFor(material).skupiny) groups.add(group);
  }
  const sorted = [...groups].sort((a, b) => a.localeCompare(b, "sk"));
  els.groupFilter.innerHTML = `<option value="">Všetky skupiny</option>${sorted
    .map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    .join("")}`;
  els.groupFilter.value = sorted.includes(current) ? current : "";
  state.filters.group = els.groupFilter.value;
}

function applyFilters() {
  const query = normalize(state.filters.query);
  const quick = state.filters.quick;
  const visible = state.filters.visibility;
  const group = state.filters.group;

  state.filtered = state.materials.filter((material) => {
    const props = propsFor(material);
    if (visible === "active" && (props.archivovany || props.skryty)) return false;
    if (visible === "archived" && !props.archivovany) return false;
    if (visible === "hidden" && !props.skryty) return false;
    if (group && !props.skupiny.includes(group)) return false;
    if (quick.has("oblubeny") && !props.oblubeny) return false;
    if (quick.has("nedostupny") && !props.nedostupny) return false;
    if (quick.has("vyradeny") && !props.vyradeny) return false;
    if (quick.has("bezSkratky") && material.skratka) return false;
    if (quick.has("oznacene") && !state.selectedRows.has(material.interny_kod)) return false;
    if (!query) return true;
    const haystack = normalize([
      material.nazov,
      material.interny_kod,
      material.poradove_cislo,
      material.skratka,
      material.EAN_QR,
      material.merna_jednotka,
      props.skupiny.join(" "),
      props.tagy.join(" "),
      props.poznamka,
    ].join(" "));
    return haystack.includes(query);
  });

  state.filtered.sort((a, b) => {
    const av = String(a[state.sortKey] || "");
    const bv = String(b[state.sortKey] || "");
    const result = av.localeCompare(bv, "sk", { numeric: true, sensitivity: "base" });
    return state.sortDir === "asc" ? result : -result;
  });

  renderStats();
  renderTable();
}

function renderStats() {
  const stats = state.db?.stats || {};
  if (els.statTotal) els.statTotal.textContent = stats.spolu ?? state.materials.length;
  if (els.statFavorite) els.statFavorite.textContent = stats.oblubene ?? 0;
  if (els.statUnavailable) els.statUnavailable.textContent = stats.nedostupne ?? 0;
  if (els.statArchived) els.statArchived.textContent = stats.archivovane ?? 0;
  if (els.resultCount) els.resultCount.textContent = `${state.filtered.length} zobrazených`;
  if (els.selectedCount) els.selectedCount.textContent = `${state.selectedRows.size} označených`;
  els.selectVisibleCheckbox.checked = state.filtered.length > 0 && state.filtered.every((item) => state.selectedRows.has(item.interny_kod));
  els.selectVisibleCheckbox.indeterminate =
    state.filtered.some((item) => state.selectedRows.has(item.interny_kod)) && !els.selectVisibleCheckbox.checked;
  const hasSelection = state.selectedRows.size > 0;
  els.clearSelectionButton.disabled = !hasSelection;
  els.bulkPrintButton.disabled = !hasSelection;
  els.bulkPdfButton.disabled = !hasSelection;
  els.labelsPrintSelectedButton.disabled = !hasSelection;
  els.labelsPdfSelectedButton.disabled = !hasSelection;
  els.multiPrintButton.disabled = !hasSelection;
  els.multiPdfButton.disabled = !hasSelection;
  updateEditorMode();
}

function renderTable() {
  const token = ++state.renderToken;
  setRowsLoading(false);

  if (!state.filtered.length) {
    els.materialsBody.innerHTML = `<tr><td colspan="9" class="empty-cell">Nič tu nesedí na aktuálne filtre.</td></tr>`;
    return;
  }

  els.materialsBody.innerHTML = "";
  const chunkSize = 160;
  const renderChunk = (start) => {
    if (token !== state.renderToken) return;
    els.materialsBody.insertAdjacentHTML(
      "beforeend",
      state.filtered.slice(start, start + chunkSize).map(renderRow).join("")
    );
    if (start + chunkSize < state.filtered.length) {
      setRowsLoading(true);
      requestAnimationFrame(() => renderChunk(start + chunkSize));
      return;
    }
    setRowsLoading(false);
  };
  renderChunk(0);
}

function setRowsLoading(isLoading) {
  if (els.loadingLine) els.loadingLine.hidden = !isLoading;
}

function renderRow(material) {
  const props = propsFor(material);
  const badges = [
    props.oblubeny ? `<span class="badge favorite">Obľúbený</span>` : "",
    props.nedostupny ? `<span class="badge danger">Nedostupný</span>` : "",
    props.vyradeny ? `<span class="badge danger">Vyradený</span>` : "",
    props.archivovany ? `<span class="badge archived">Archív</span>` : "",
    props.skryty ? `<span class="badge archived">Skrytý</span>` : "",
    ...props.skupiny.map((group) => `<span class="badge">${escapeHtml(group)}</span>`),
  ].filter(Boolean).join("");

  return `
    <tr data-code="${escapeHtml(material.interny_kod)}" class="${rowClass(material, props)}">
      <td class="checkbox-col"><input type="checkbox" data-select-row="${escapeHtml(material.interny_kod)}" ${state.selectedRows.has(material.interny_kod) ? "checked" : ""}></td>
      <td class="name-cell">${escapeHtml(material.nazov)}</td>
      <td class="code internal-code-cell">${escapeHtml(material.interny_kod)}</td>
      <td class="code">${escapeHtml(material.poradove_cislo)}</td>
      <td class="code">${escapeHtml(material.skratka)}</td>
      <td class="code">${escapeHtml(material.EAN_QR)}</td>
      <td>${escapeHtml(material.merna_jednotka)}</td>
      <td><div class="badge-list">${badges || `<span class="badge">Aktívny</span>`}</div></td>
      <td class="print-col">
        <button class="print-label-button" type="button" data-print-label="${escapeHtml(material.interny_kod)}" title="Tlačiť CB štítok" aria-label="Tlačiť CB štítok pre ${escapeHtml(material.nazov)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7zM8 6h8M17 12h1"/>
          </svg>
        </button>
        <button class="print-label-button pdf-button" type="button" data-pdf-label="${escapeHtml(material.interny_kod)}" title="Stiahnuť PDF štítok" aria-label="Stiahnuť PDF štítok pre ${escapeHtml(material.nazov)}">
          PDF
        </button>
      </td>
    </tr>
  `;
}

function rowClass(material, props) {
  return [
    state.selectedCode === material.interny_kod ? "is-active-row" : "",
    state.selectedRows.has(material.interny_kod) ? "is-marked" : "",
    props.oblubeny ? "is-favorite" : "",
    props.archivovany ? "is-archived" : "",
    props.skryty ? "is-hidden" : "",
  ].filter(Boolean).join(" ");
}

function renderedRows() {
  return [...els.materialsBody.querySelectorAll("tr[data-code]")];
}

function renderedRowForCode(code) {
  return renderedRows().find((row) => row.dataset.code === code);
}

function syncRenderedRow(code) {
  const row = renderedRowForCode(code);
  const material = findByCode(code);
  if (!row || !material) return;
  row.className = rowClass(material, propsFor(material));
  const checkbox = row.querySelector("[data-select-row]");
  if (checkbox) checkbox.checked = state.selectedRows.has(code);
}

function syncRenderedSelection() {
  for (const row of renderedRows()) {
    const material = findByCode(row.dataset.code);
    if (!material) continue;
    row.className = rowClass(material, propsFor(material));
    const checkbox = row.querySelector("[data-select-row]");
    if (checkbox) checkbox.checked = state.selectedRows.has(row.dataset.code);
  }
}

function visibleIndexByCode(code) {
  return state.filtered.findIndex((material) => material.interny_kod === code);
}

function rememberSelectionAnchor(code) {
  const index = visibleIndexByCode(code);
  if (index >= 0) state.lastSelectionIndex = index;
}

function toggleRowSelection(code, force) {
  if (force === true) state.selectedRows.add(code);
  else if (force === false) state.selectedRows.delete(code);
  else if (state.selectedRows.has(code)) state.selectedRows.delete(code);
  else state.selectedRows.add(code);
  rememberSelectionAnchor(code);
  saveSelection();
  return [code];
}

function selectRangeTo(code) {
  const to = visibleIndexByCode(code);
  if (to < 0) return [];
  const from = state.lastSelectionIndex >= 0 ? state.lastSelectionIndex : to;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const changed = [];
  for (let index = start; index <= end; index += 1) {
    const selectedCode = state.filtered[index].interny_kod;
    state.selectedRows.add(selectedCode);
    changed.push(selectedCode);
  }
  state.lastSelectionIndex = to;
  saveSelection();
  return changed;
}

function refreshAfterSelectionChange(changedCodes = []) {
  if (state.filters.quick.has("oznacene")) {
    applyFilters();
    return;
  }
  renderStats();
  if (changedCodes.length) {
    for (const code of changedCodes) syncRenderedRow(code);
    return;
  }
  syncRenderedSelection();
}

function clearSelectionState() {
  state.selectedRows.clear();
  state.lastSelectionIndex = -1;
  state.selectedCode = "";
  saveSelection();
}

function setIndividualEditorDisabled(disabled) {
  for (const field of Object.values(fields)) {
    field.disabled = disabled;
  }
  for (const button of els.materialForm.querySelectorAll("button[type='submit']")) {
    button.disabled = disabled;
  }
  els.saveEditorButton.disabled = disabled;
  els.archiveButton.disabled = disabled || !state.selectedCode;
  els.deleteButton.disabled = disabled || !state.selectedCode;
  els.materialForm.classList.toggle("is-disabled", disabled);
  els.materialForm.setAttribute("aria-disabled", String(disabled));
}

function updateEditorMode() {
  const multiMode = state.selectedRows.size > 1;
  els.materialForm.hidden = false;
  els.multiEditPanel.hidden = !multiMode;
  setIndividualEditorDisabled(multiMode);

  if (!multiMode) return;

  const visibleSelected = state.filtered.filter((material) => state.selectedRows.has(material.interny_kod)).length;
  els.editorTitle.textContent = "Skupinové úpravy";
  els.multiEditSummary.textContent =
    `Označené: ${state.selectedRows.size}. V aktuálnom filtri vidíš ${visibleSelected} z nich. ` +
    "Jednotlivé polia sú zamknuté, aby sa hromadne nemenili omylom.";
}

function fillEditor(material) {
  if (!material) {
    state.selectedCode = "";
    els.editorTitle.textContent = "Nový materiál";
    fields.nazov.value = "";
    fields.interny_kod.value = "";
    fields.poradove_cislo.value = "";
    fields.skratka.value = "";
    fields.EAN_QR.value = "";
    fields.merna_jednotka.value = "";
    fields.groups.value = "";
    fields.tags.value = "";
    fields.note.value = "";
    fields.favorite.checked = false;
    fields.unavailable.checked = false;
    fields.discontinued.checked = false;
    fields.archived.checked = false;
    fields.hidden.checked = false;
    els.archiveButton.disabled = true;
    els.deleteButton.disabled = true;
    updateEditorMode();
    return;
  }

  const props = propsFor(material);
  state.selectedCode = material.interny_kod;
  els.editorTitle.textContent = material.interny_kod;
  fields.nazov.value = material.nazov || "";
  fields.interny_kod.value = material.interny_kod || "";
  fields.poradove_cislo.value = material.poradove_cislo || "";
  fields.skratka.value = material.skratka || "";
  fields.EAN_QR.value = material.EAN_QR || "";
  fields.merna_jednotka.value = material.merna_jednotka || "";
  fields.groups.value = props.skupiny.join(", ");
  fields.tags.value = props.tagy.join(", ");
  fields.note.value = props.poznamka;
  fields.favorite.checked = props.oblubeny;
  fields.unavailable.checked = props.nedostupny;
  fields.discontinued.checked = props.vyradeny;
  fields.archived.checked = props.archivovany;
  fields.hidden.checked = props.skryty;
  els.archiveButton.disabled = false;
  els.deleteButton.disabled = false;
  updateEditorMode();
}

function collectForm() {
  return {
    nazov: fields.nazov.value.trim(),
    interny_kod: fields.interny_kod.value.trim(),
    poradove_cislo: fields.poradove_cislo.value.trim(),
    skratka: fields.skratka.value.trim(),
    EAN_QR: fields.EAN_QR.value.trim(),
    merna_jednotka: fields.merna_jednotka.value.trim(),
    vlastnosti: {
      oblubeny: fields.favorite.checked,
      nedostupny: fields.unavailable.checked,
      vyradeny: fields.discontinued.checked,
      archivovany: fields.archived.checked,
      skryty: fields.hidden.checked,
      skupiny: splitList(fields.groups.value),
      tagy: splitList(fields.tags.value),
      poznamka: fields.note.value.trim(),
    },
  };
}

async function saveForm(event) {
  event.preventDefault();
  if (state.selectedRows.size > 1) {
    showToast("Pri skupinovom výbere sú individuálne polia zamknuté.");
    return;
  }
  const material = collectForm();
  if (!material.interny_kod || !material.nazov || !material.merna_jednotka) {
    showToast("Názov, interný kód a MJ sú povinné.");
    return;
  }

  if (state.selectedCode) {
    const payload = await api(`/api/materials/${encodeURIComponent(state.selectedCode)}`, {
      method: "PUT",
      body: JSON.stringify(material),
    });
    state.selectedCode = payload.material.interny_kod;
    showToast("Materiál je uložený.");
  } else {
    const payload = await api("/api/materials", {
      method: "POST",
      body: JSON.stringify(material),
    });
    state.selectedCode = payload.material.interny_kod;
    showToast("Materiál je pridaný.");
  }
  await loadDb();
}

async function toggleArchive() {
  const material = findByCode(state.selectedCode);
  if (!material) return;
  const props = propsFor(material);
  await api(`/api/materials/${encodeURIComponent(material.interny_kod)}`, {
    method: "PUT",
    body: JSON.stringify({ vlastnosti: { ...props, archivovany: !props.archivovany } }),
  });
  showToast(props.archivovany ? "Materiál je späť z archívu." : "Materiál je archivovaný.");
  await loadDb();
}

function askConfirm({ title, text, label, expected, onAccept }) {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmLabel.firstChild.textContent = label;
  els.confirmInput.value = "";
  state.pendingConfirm = { expected, onAccept };
  els.confirmDialog.showModal();
  setTimeout(() => els.confirmInput.focus(), 50);
}

async function deleteSelectedMaterial() {
  const material = findByCode(state.selectedCode);
  if (!material) return;
  askConfirm({
    title: "Vymazať materiál?",
    text: `Toto fyzicky odstráni "${material.nazov}". Pre istotu napíš presný interný kód.`,
    label: `Napíš ${material.interny_kod}`,
    expected: material.interny_kod,
    onAccept: async () => {
      await api(`/api/materials/${encodeURIComponent(material.interny_kod)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: true, confirmText: material.interny_kod }),
      });
      state.selectedCode = "";
      showToast("Materiál je vymazaný. Undo je ešte dostupné.");
      await loadDb();
    },
  });
}

async function runBulk(action, value) {
  const codes = [...state.selectedRows];
  if (!codes.length) {
    showToast("Najprv označ materiály.");
    return;
  }
  await api("/api/bulk", {
    method: "POST",
    body: JSON.stringify({ codes, action, value }),
  });
  clearSelectionState();
  showToast(`Hromadná akcia hotová (${codes.length}).`);
  await loadDb();
}

async function addBulkGroup() {
  const group = els.bulkGroupInput.value.trim();
  await changeBulkGroup(group, "addGroup");
  els.bulkGroupInput.value = "";
}

async function changeBulkGroup(group, action) {
  if (!group) {
    showToast("Napíš názov skupiny.");
    return;
  }
  const codes = [...state.selectedRows];
  if (!codes.length) {
    showToast("Najprv označ materiály.");
    return;
  }
  await api("/api/bulk", {
    method: "POST",
    body: JSON.stringify({ codes, action, group }),
  });
  clearSelectionState();
  showToast(action === "addGroup" ? `Skupina "${group}" pridaná označeným.` : `Skupina "${group}" odobratá označeným.`);
  await loadDb();
}

async function bulkDelete() {
  const codes = [...state.selectedRows];
  if (!codes.length) {
    showToast("Najprv označ materiály.");
    return;
  }
  askConfirm({
    title: "Vymazať označené?",
    text: `Toto fyzicky odstráni ${codes.length} materiálov. Pre istotu napíš počet označených položiek.`,
    label: `Napíš ${codes.length}`,
    expected: String(codes.length),
    onAccept: async () => {
      await api("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ codes, action: "delete", confirm: true, confirmText: String(codes.length) }),
      });
      clearSelectionState();
      showToast("Označené materiály sú vymazané. Undo je ešte dostupné.");
      await loadDb();
    },
  });
}

function selectedMaterialsInCurrentOrder() {
  const visibleSelected = state.filtered.filter((material) => state.selectedRows.has(material.interny_kod));
  const visibleCodes = new Set(visibleSelected.map((material) => material.interny_kod));
  const remainingSelected = state.materials.filter(
    (material) => state.selectedRows.has(material.interny_kod) && !visibleCodes.has(material.interny_kod)
  );
  return [...visibleSelected, ...remainingSelected];
}

function labelValue(material, key, fallback = "") {
  return String(material?.[key] || fallback || "").trim();
}

function labelBarcodeText(material) {
  return labelValue(material, "EAN_QR");
}

function labelMainCode(material) {
  return labelValue(material, "skratka");
}

function printMaterialLabel(code) {
  const material = findByCode(code);
  if (!material) {
    showToast("Materiál sa nenašiel.");
    return;
  }
  openLabelPrintWindow([material], "mono");
}

function printSelectedLabels() {
  const materials = selectedMaterialsInCurrentOrder();
  if (!materials.length) {
    showToast("Najprv označ materiály.");
    return;
  }
  openLabelPrintWindow(materials, "mono");
}

function filenameFromDisposition(disposition, fallback) {
  const match = String(disposition || "").match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

async function downloadLabelPdf(codes) {
  const response = await fetch("/api/labels/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "PDF export zlyhal.");
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), "stitky_materialy.pdf");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadMaterialLabelPdf(code) {
  try {
    await downloadLabelPdf([code]);
    showToast("PDF štítok je pripravený na stiahnutie.");
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadSelectedLabelsPdf() {
  const codes = selectedMaterialsInCurrentOrder().map((material) => material.interny_kod);
  if (!codes.length) {
    showToast("Najprv označ materiály.");
    return;
  }
  try {
    await downloadLabelPdf(codes);
    showToast(`PDF štítky sú pripravené (${codes.length} strán).`);
  } catch (error) {
    showToast(error.message);
  }
}

function openLabelPrintWindow(materials, mode) {
  const printWindow = window.open("", "_blank", "width=760,height=680");
  if (!printWindow) {
    showToast("Prehliadač zablokoval tlačové okno.");
    return;
  }

  const title = mode === "mono" ? "CB štítky materiálov" : "Farebné štítky materiálov";
  const labels = materials.map((material) => renderLabel(material, mode)).join("");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: 62mm 45mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: "Arial Narrow", "Bahnschrift Condensed", Arial, sans-serif; color: #1f1f1f; }
    .label-page {
      width: 62mm;
      height: 45mm;
      display: grid;
      place-items: center;
      background: #fff;
      overflow: hidden;
    }
    .material-label {
      --label-accent: #17b3a2;
      position: relative;
      width: 58mm;
      height: 40mm;
      border: 2.4mm solid var(--label-accent);
      display: block;
      background: #fff;
      overflow: hidden;
    }
    .material-label.mono { --label-accent: #1f1f1f; }
    .label-head {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      height: 11.5mm;
      display: grid;
      grid-template-columns: 0.55fr 1.45fr;
      align-items: center;
      padding: 1.4mm 1.8mm 1.1mm 1.2mm;
      color: #fff;
      background: var(--label-accent);
    }
    .label-type {
      font-family: Impact, "Arial Black", "Bahnschrift Condensed", sans-serif;
      font-size: 12pt;
      line-height: 0.9;
      letter-spacing: -0.04em;
      text-transform: uppercase;
      text-align: left;
      justify-self: stretch;
    }
    .label-meta {
      min-width: 0;
      text-align: right;
      font-family: "Arial Narrow", "Bahnschrift Condensed", "Aptos Narrow", Arial, sans-serif;
      line-height: 1.05;
      white-space: nowrap;
    }
    .label-order {
      display: block;
      font-size: 8.8pt;
      font-weight: 400;
    }
    .label-internal-code {
      display: block;
      font-size: 8.8pt;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .label-body {
      position: absolute;
      inset: 11.5mm 0 0;
      display: block;
      padding: 0;
    }
    .label-name {
      position: absolute;
      top: 1mm;
      right: 1.7mm;
      left: 1.7mm;
      height: 10.7mm;
      max-height: 10.7mm;
      min-height: 0;
      padding: 0.55mm 0.2mm;
      font-family: "Arial Narrow", "Bahnschrift Condensed", "Aptos Narrow", Arial, sans-serif;
      font-size: 10.1pt;
      font-weight: 700;
      line-height: 0.96;
      overflow: hidden;
      word-break: break-word;
    }
    .label-bottom {
      display: block;
    }
    .label-qr {
      position: absolute;
      left: -0.4mm;
      bottom: -0.45mm;
      width: 13.3mm;
      height: 13.3mm;
    }
    .label-mj {
      position: absolute;
      left: 13.7mm;
      bottom: 1.7mm;
      font-family: Arial, sans-serif;
      font-size: 9pt;
      font-weight: 700;
    }
    .label-code {
      position: absolute;
      right: 1.7mm;
      bottom: 1.4mm;
      max-width: 27mm;
      text-align: right;
      font-family: Arial, sans-serif;
      font-size: 14.6pt;
      line-height: 1;
      font-weight: 900;
      letter-spacing: -0.04em;
      overflow: hidden;
      white-space: nowrap;
    }
    .qr-fallback {
      position: absolute;
      left: -0.4mm;
      bottom: -0.45mm;
      width: 13.3mm;
      height: 13.3mm;
      border: 0.3mm solid #111;
      display: grid;
      place-items: center;
      font: 5pt Arial, sans-serif;
      word-break: break-all;
      overflow: hidden;
    }
    @media screen {
      body { padding: 22px 12px 120px; background: #e8e8e8; }
      .print-hint {
        position: fixed;
        top: 10px;
        left: 50%;
        z-index: 10;
        transform: translateX(-50%);
        border: 1px solid #cfcfcf;
        border-radius: 999px;
        padding: 7px 13px;
        background: #fff;
        font: 700 12px Arial, sans-serif;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
      }
      .label-page {
        margin: 0 auto 105px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
        transform: scale(1.65);
        transform-origin: top center;
      }
    }
    @media print {
      html,
      body {
        width: 62mm;
        height: auto;
        min-height: 0;
        margin: 0;
        padding: 0;
        overflow: visible;
        background: #fff;
      }
      .print-hint { display: none; }
      .label-page {
        margin: 0;
        width: 62mm;
        height: 45mm;
        min-height: 0;
        box-shadow: none;
        transform: none;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        page-break-inside: avoid;
        overflow: hidden;
      }
      .label-page:last-of-type {
        break-after: auto;
        page-break-after: auto;
      }
      .material-label {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="print-hint">Tlač spustíš klávesou Enter alebo P</div>
  ${labels}
  <script>
    document.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "enter" || key === "p") {
        event.preventDefault();
        window.print();
      }
    });
  </script>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
}

function renderLabel(material, mode) {
  const name = labelValue(material, "nazov");
  const code = labelValue(material, "interny_kod");
  const order = labelValue(material, "poradove_cislo");
  const unit = labelValue(material, "merna_jednotka");
  const mainCode = labelMainCode(material);
  const barcodeText = labelBarcodeText(material);
  const qr = renderStoredQrSvg(material) || renderQrSvg(barcodeText);
  const heading = "MATERIÁL";

  return `<section class="label-page">
    <article class="material-label ${mode === "mono" ? "mono" : "color"}">
      <header class="label-head">
        <div class="label-type">${heading}</div>
        <div class="label-meta">
          <span class="label-order">${escapeHtml(order)}</span>
          <span class="label-internal-code">${escapeHtml(code)}</span>
        </div>
      </header>
      <div class="label-body">
        <div class="label-name">${escapeHtml(name)}</div>
        <div class="label-bottom">
          ${qr || ""}
          <div class="label-mj">${escapeHtml(unit)}</div>
          <div class="label-code">${escapeHtml(mainCode)}</div>
        </div>
      </div>
    </article>
  </section>`;
}

function renderQrSvg(text) {
  if (!text) return "";
  try {
    const matrix = makeQrMatrix(String(text || ""));
    const quiet = 3;
    const size = matrix.length + quiet * 2;
    const cells = [];
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix.length; x += 1) {
        if (matrix[y][x]) cells.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
      }
    }
    return `<svg class="label-qr" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-label="QR ${escapeHtml(text)}"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#111">${cells.join("")}</g></svg>`;
  } catch {
    return "";
  }
}

function renderStoredQrSvg(material) {
  const rows = material?.qr_pdf?.matrix;
  if (!Array.isArray(rows) || !rows.length) return "";
  const size = Number(material.qr_pdf.matrix_size || rows.length);
  if (!size || rows.length !== size || rows.some((row) => typeof row !== "string" || row.length !== size)) return "";
  const quiet = 3;
  const viewSize = size + quiet * 2;
  const cells = [];
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] === "1") cells.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
    }
  }
  const label = labelValue(material, "EAN_QR");
  return `<svg class="label-qr" viewBox="0 0 ${viewSize} ${viewSize}" xmlns="http://www.w3.org/2000/svg" aria-label="QR ${escapeHtml(label)}"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/><g fill="#111">${cells.join("")}</g></svg>`;
}

function makeQrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const versions = [
    { version: 1, data: 19, ecc: 7, alignment: [] },
    { version: 2, data: 34, ecc: 10, alignment: [6, 18] },
    { version: 3, data: 55, ecc: 15, alignment: [6, 22] },
    { version: 4, data: 80, ecc: 20, alignment: [6, 26] },
  ];
  const config = versions.find((item) => bytes.length <= item.data - 3);
  if (!config) throw new Error("QR text je príliš dlhý.");
  const data = makeQrData(bytes, config.data);
  const ecc = reedSolomonRemainder(data, config.ecc);
  return drawQr(config, [...data, ...ecc]);
}

function makeQrData(bytes, dataCodewords) {
  const bits = [];
  const pushBits = (value, length) => {
    for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((value >>> shift) & 1);
  };
  pushBits(4, 4);
  pushBits(bytes.length, 8);
  for (const byte of bytes) pushBits(byte, 8);
  const capacity = dataCodewords * 8;
  pushBits(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < dataCodewords; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  return data;
}

const QR_GF = (() => {
  const exp = new Array(512);
  const log = new Array(256);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255];
  return { exp, log };
})();

function gfMul(left, right) {
  if (!left || !right) return 0;
  return QR_GF.exp[QR_GF.log[left] + QR_GF.log[right]];
}

function reedSolomonGenerator(degree) {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let pos = 0; pos < poly.length; pos += 1) {
      next[pos] ^= poly[pos];
      next[pos + 1] ^= gfMul(poly[pos], QR_GF.exp[index]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= gfMul(generator[index + 1], factor);
    }
  }
  return result;
}

function drawQr(config, codewords) {
  const size = 17 + config.version * 4;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark, keep = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = Boolean(dark);
    if (keep) reserved[y][x] = true;
  };

  const finder = (left, top) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const dark = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(xx, yy, dark);
      }
    }
  };

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0;
    set(index, 6, dark);
    set(6, index, dark);
  }

  for (const centerY of config.alignment) {
    for (const centerX of config.alignment) {
      const touchesTopLeft = centerX === 6 && centerY === 6;
      const touchesTopRight = centerX === size - 7 && centerY === 6;
      const touchesBottomLeft = centerX === 6 && centerY === size - 7;
      if (touchesTopLeft || touchesTopRight || touchesBottomLeft) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          set(centerX + x, centerY + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }

  set(8, size - 8, true);
  reserveFormatAreas(reserved, size);
  placeQrData(modules, reserved, size, codewords);
  writeFormatBits(modules, reserved, size);
  return modules;
}

function reserveFormatAreas(reserved, size) {
  for (let index = 0; index <= 8; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][size - 1 - index] = true;
    reserved[size - 1 - index][8] = true;
  }
}

function placeQrData(modules, reserved, size, codewords) {
  const bits = codewords.flatMap((byte) => {
    const result = [];
    for (let shift = 7; shift >= 0; shift -= 1) result.push((byte >>> shift) & 1);
    return result;
  });
  let bitIndex = 0;
  let direction = -1;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let row = 0; row < size; row += 1) {
      const y = direction === -1 ? size - 1 - row : row;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const masked = Boolean((bits[bitIndex] || 0) ^ ((x + y) % 2 === 0 ? 1 : 0));
        modules[y][x] = masked;
        bitIndex += 1;
      }
    }
    direction *= -1;
  }
}

function writeFormatBits(modules, reserved, size) {
  const bits = 0b111011111000100; // ECC L, mask 0.
  const set = (x, y, bit) => {
    modules[y][x] = Boolean(bit);
    reserved[y][x] = true;
  };
  for (let index = 0; index < 6; index += 1) set(index, 8, (bits >>> index) & 1);
  set(7, 8, (bits >>> 6) & 1);
  set(8, 8, (bits >>> 7) & 1);
  set(8, 7, (bits >>> 8) & 1);
  for (let index = 9; index < 15; index += 1) set(8, 14 - index, (bits >>> index) & 1);
  for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, (bits >>> index) & 1);
  for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, (bits >>> index) & 1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.searchInput.addEventListener("input", () => {
  state.filters.query = els.searchInput.value;
  applyFilters();
});

els.visibilityFilter.addEventListener("change", () => {
  state.filters.visibility = els.visibilityFilter.value;
  localStorage.setItem("materialDb.visibility", state.filters.visibility);
  applyFilters();
});

els.groupFilter.addEventListener("change", () => {
  state.filters.group = els.groupFilter.value;
  applyFilters();
});

document.querySelectorAll(".quick-filter").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.filters.quick.add(checkbox.value);
    else state.filters.quick.delete(checkbox.value);
    applyFilters();
  });
});

document.querySelectorAll("th[data-sort]").forEach((header) => {
  header.addEventListener("click", () => {
    const key = header.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    applyFilters();
  });
});

els.materialsBody.addEventListener("click", (event) => {
  const printButton = event.target.closest("[data-print-label]");
  if (printButton) {
    event.preventDefault();
    event.stopPropagation();
    printMaterialLabel(printButton.dataset.printLabel);
    return;
  }

  const pdfButton = event.target.closest("[data-pdf-label]");
  if (pdfButton) {
    event.preventDefault();
    event.stopPropagation();
    downloadMaterialLabelPdf(pdfButton.dataset.pdfLabel);
    return;
  }

  const checkbox = event.target.closest("[data-select-row]");
  if (checkbox) {
    const code = checkbox.dataset.selectRow;
    const changedCodes = event.shiftKey ? selectRangeTo(code) : toggleRowSelection(code, checkbox.checked);
    refreshAfterSelectionChange(changedCodes);
    return;
  }

  const row = event.target.closest("tr[data-code]");
  if (!row) return;
  const previousCode = state.selectedCode;
  const material = findByCode(row.dataset.code);
  fillEditor(material);

  if (event.shiftKey) {
    const changedCodes = selectRangeTo(row.dataset.code);
    refreshAfterSelectionChange([previousCode, row.dataset.code, ...changedCodes].filter(Boolean));
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    const changedCodes = toggleRowSelection(row.dataset.code);
    refreshAfterSelectionChange([previousCode, ...changedCodes].filter(Boolean));
    return;
  }

  for (const code of [previousCode, row.dataset.code].filter(Boolean)) syncRenderedRow(code);
});

els.selectVisibleCheckbox.addEventListener("change", () => {
  for (const material of state.filtered) {
    if (els.selectVisibleCheckbox.checked) state.selectedRows.add(material.interny_kod);
    else state.selectedRows.delete(material.interny_kod);
  }
  state.lastSelectionIndex = state.filtered.length ? 0 : -1;
  saveSelection();
  applyFilters();
});

els.clearSelectionButton.addEventListener("click", () => {
  clearSelectionState();
  refreshAfterSelectionChange();
  showToast("Výber je zrušený.");
});

document.querySelectorAll("[data-bulk-action]").forEach((button) => {
  button.addEventListener("click", () => runBulk(button.dataset.bulkAction, button.dataset.bulkValue === "true"));
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-active", item === tab));
    const labels = tab.dataset.view === "labels";
    els.labelsView.hidden = !labels;
    els.databaseView.hidden = labels;
  });
});

els.materialForm.addEventListener("submit", saveForm);
els.refreshButton.addEventListener("click", () => loadDb().then(() => showToast("JSON načítaný nanovo.")));
els.newMaterialButton.addEventListener("click", () => {
  clearSelectionState();
  fillEditor(null);
  refreshAfterSelectionChange();
});
els.archiveButton.addEventListener("click", toggleArchive);
els.deleteButton.addEventListener("click", deleteSelectedMaterial);
els.bulkDeleteButton.addEventListener("click", bulkDelete);
els.bulkPrintButton.addEventListener("click", printSelectedLabels);
els.bulkPdfButton.addEventListener("click", downloadSelectedLabelsPdf);
els.labelsPrintSelectedButton.addEventListener("click", printSelectedLabels);
els.labelsPdfSelectedButton.addEventListener("click", downloadSelectedLabelsPdf);
els.bulkAddGroupButton.addEventListener("click", addBulkGroup);
els.multiAddGroupButton.addEventListener("click", () => {
  const group = els.multiGroupInput.value.trim();
  changeBulkGroup(group, "addGroup").then(() => {
    els.multiGroupInput.value = "";
  });
});
els.multiRemoveGroupButton.addEventListener("click", () => {
  const group = els.multiGroupInput.value.trim();
  changeBulkGroup(group, "removeGroup").then(() => {
    els.multiGroupInput.value = "";
  });
});
els.multiDeleteButton.addEventListener("click", bulkDelete);
els.multiPrintButton.addEventListener("click", printSelectedLabels);
els.multiPdfButton.addEventListener("click", downloadSelectedLabelsPdf);

els.undoButton.addEventListener("click", async () => {
  const payload = await api("/api/undo", { method: "POST", body: "{}" });
  state.db = payload.db;
  state.materials = payload.db.materials || [];
  pruneSelection();
  els.undoButton.disabled = !payload.undoAvailable;
  showToast(payload.message || "Undo hotové.");
  rebuildGroupFilter();
  applyFilters();
});

els.cancelConfirm.addEventListener("click", () => {
  els.confirmDialog.close();
  state.pendingConfirm = null;
});

els.acceptConfirm.addEventListener("click", async () => {
  if (!state.pendingConfirm) return;
  if (els.confirmInput.value.trim() !== state.pendingConfirm.expected) {
    showToast("Potvrdenie nesedí, mazanie som nepustil.");
    return;
  }
  const action = state.pendingConfirm.onAccept;
  state.pendingConfirm = null;
  els.confirmDialog.close();
  await action();
});

loadDb().catch((error) => {
  els.materialsBody.innerHTML = `<tr><td colspan="9" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
  showToast(error.message);
});
