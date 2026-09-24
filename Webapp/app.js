const STORAGE_KEY = "kontaktbuch-settings-v1";
const DEFAULT_SERVER = "https://dav.zp1.net/";
const CACHE_DB_NAME = "kontaktbuch-cache-v1";
const CACHE_DB_VERSION = 1;
const CONTACT_BATCH_SIZE = 40;

const state = {
  settings: loadSettings(),
  books: [],
  contacts: [],
  connected: false,
  choosingBook: false,
  hasLoaded: false,
  loading: false,
  syncing: false,
  visibleStart: 0,
  visibleCount: CONTACT_BATCH_SIZE,
  syncProgress: { current: 0, total: 0, label: "" },
  query: "",
  filter: "all",
  alphabetLetter: "",
  expandedContacts: new Set(),
  selectedContactId: "",
  editingContactId: "",
  mergeContactId: "",
  lastUpdated: null,
  installPrompt: null
};

const dom = {
  installButton: document.querySelector("#installButton"),
  refreshButton: document.querySelector("#refreshButton"),
  settingsButton: document.querySelector("#settingsButton"),
  logoutButton: document.querySelector("#logoutButton"),
  connectButton: document.querySelector("#connectButton"),
  searchTools: document.querySelector("#searchTools"),
  searchInput: document.querySelector("#searchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  alphabetNav: document.querySelector("#alphabetNav"),
  filterSelect: document.querySelector("#filterSelect"),
  contactCount: document.querySelector("#contactCount"),
  booksButton: document.querySelector("#booksButton"),
  contactControls: document.querySelector("#contactControls"),
  contactListHeading: document.querySelector("#contactListHeading"),
  booksPanel: document.querySelector("#booksPanel"),
  booksCount: document.querySelector("#booksCount"),
  booksList: document.querySelector("#booksList"),
  notice: document.querySelector("#notice"),
  noticeText: document.querySelector("#noticeText"),
  noticeCloseButton: document.querySelector("#noticeCloseButton"),
  welcomeState: document.querySelector("#welcomeState"),
  loadingState: document.querySelector("#loadingState"),
  loadingText: document.querySelector("#loadingText"),
  syncProgressTrack: document.querySelector("#syncProgressTrack"),
  syncProgressBar: document.querySelector("#syncProgressBar"),
  emptyState: document.querySelector("#emptyState"),
  contactsList: document.querySelector("#contactsList"),
  loadMoreSentinel: document.querySelector("#loadMoreSentinel"),
  loadMoreText: document.querySelector("#loadMoreText"),
  contactDetailPane: document.querySelector("#contactDetailPane"),
  detailPaneAvatar: document.querySelector("#detailPaneAvatar"),
  detailPaneTitle: document.querySelector("#detailPaneTitle"),
  detailPaneSubtitle: document.querySelector("#detailPaneSubtitle"),
  detailPaneContent: document.querySelector("#detailPaneContent"),
  detailSaveButton: document.querySelector("#detailSaveButton"),
  detailEditButton: document.querySelector("#detailEditButton"),
  detailMergeButton: document.querySelector("#detailMergeButton"),
  detailDeleteButton: document.querySelector("#detailDeleteButton"),
  detailPaneCloseButton: document.querySelector("#detailPaneCloseButton"),
  lastUpdated: document.querySelector("#lastUpdated"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  settingsCancelButton: document.querySelector("#settingsCancelButton"),
  settingsSaveButton: document.querySelector("#settingsSaveButton"),
  serverInput: document.querySelector("#serverInput"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  rememberInput: document.querySelector("#rememberInput"),
  bookField: document.querySelector("#bookField"),
  bookSelect: document.querySelector("#bookSelect"),
  installDialog: document.querySelector("#installDialog"),
  installCloseButton: document.querySelector("#installCloseButton"),
  booksDialog: document.querySelector("#booksDialog"),
  booksForm: document.querySelector("#booksForm"),
  booksDialogSelect: document.querySelector("#booksDialogSelect"),
  booksCloseButton: document.querySelector("#booksCloseButton"),
  booksCancelButton: document.querySelector("#booksCancelButton"),
  mergeDialog: document.querySelector("#mergeDialog"),
  mergeForm: document.querySelector("#mergeForm"),
  mergeCloseButton: document.querySelector("#mergeCloseButton"),
  mergeCancelButton: document.querySelector("#mergeCancelButton"),
  mergeSearchInput: document.querySelector("#mergeSearchInput"),
  mergeResults: document.querySelector("#mergeResults"),
  mergeResultsEmpty: document.querySelector("#mergeResultsEmpty"),
  mergeSummary: document.querySelector("#mergeSummary"),
  mergePrimaryName: document.querySelector("#mergePrimaryName"),
  mergeSubmitButton: document.querySelector("#mergeSubmitButton")
};

function loadSettings() {
  const defaults = {
    serverUrl: DEFAULT_SERVER,
    username: "",
    password: "",
    remember: true,
    collection: ""
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved ? { ...defaults, ...saved } : defaults;
  } catch (_error) {
    return defaults;
  }
}

function persistSettings() {
  const saved = { ...state.settings };
  if (!saved.remember) {
    delete saved.password;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (_error) {
    // Private browsing can disable local storage; the session still works.
  }
}

let cacheDbPromise;
let duplicateCacheContacts = null;
let duplicateCacheIds = new Set();
let duplicateCacheMatches = new Map();

function cacheContextAvailable() {
  try {
    return Boolean(window.indexedDB)
      && (typeof window.isSecureContext !== "boolean" || window.isSecureContext);
  } catch (_error) {
    return false;
  }
}

function openCacheDb() {
  if (!cacheContextAvailable()) return Promise.resolve(null);
  if (!cacheDbPromise) {
    cacheDbPromise = new Promise((resolve) => {
      let request;
      try {
        request = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      } catch (_error) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("books")) database.createObjectStore("books", { keyPath: "key" });
        if (!database.objectStoreNames.contains("contacts")) database.createObjectStore("contacts", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  return cacheDbPromise;
}

async function readCache(storeName, key) {
  try {
    const database = await openCacheDb();
    if (!database) return null;
    return await new Promise((resolve) => {
      let request;
      try {
        request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      } catch (_error) {
        resolve(null);
        return;
      }
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (_error) {
    return null;
  }
}

async function writeCache(storeName, value) {
  try {
    const database = await openCacheDb();
    if (!database) return;
    await new Promise((resolve) => {
      let request;
      try {
        request = database.transaction(storeName, "readwrite").objectStore(storeName).put(value);
      } catch (_error) {
        resolve();
        return;
      }
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  } catch (_error) {
    // The CardDAV session remains usable when Safari denies local storage.
  }
}

async function deleteCache(storeName, key) {
  try {
    const database = await openCacheDb();
    if (!database) return;
    await new Promise((resolve) => {
      let request;
      try {
        request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
      } catch (_error) {
        resolve();
        return;
      }
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  } catch (_error) {
    // Nothing to remove when Safari has disabled local storage.
  }
}

async function clearCache() {
  try {
    const database = await openCacheDb();
    if (!database) return;
    await new Promise((resolve) => {
      let transaction;
      try {
        transaction = database.transaction(["books", "contacts"], "readwrite");
        transaction.objectStore("books").clear();
        transaction.objectStore("contacts").clear();
      } catch (_error) {
        resolve();
        return;
      }
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    });
  } catch (_error) {
    // Logout must also work when Safari has disabled IndexedDB.
  }
}

function accountCacheKey() {
  return `${state.settings.serverUrl}|${state.settings.username}`;
}

function contactsCacheKey(collection) {
  return `${accountCacheKey()}|${collection}`;
}

async function readCachedBooks() {
  return readCache("books", accountCacheKey());
}

async function readCachedContacts(collection) {
  return readCache("contacts", contactsCacheKey(collection));
}

function openDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      dialog.classList.remove("dialog-fallback-open");
      return;
    }
  } catch (_error) {
    // Use the compact fallback only when the browser rejects showModal().
  }
  dialog.setAttribute("open", "");
  dialog.classList.add("dialog-fallback-open");
}

function closeDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
      dialog.classList.remove("dialog-fallback-open");
      return;
    }
  } catch (_error) {
    // Fall back to removing the open attribute below.
  }
  dialog.removeAttribute("open");
  dialog.classList.remove("dialog-fallback-open");
}

function populateSettingsForm() {
  dom.serverInput.value = state.settings.serverUrl;
  dom.usernameInput.value = state.settings.username;
  dom.passwordInput.value = state.settings.password;
  dom.rememberInput.checked = state.settings.remember;
  populateBookSelect(dom.bookSelect, state.settings.collection);
}

function populateBookSelect(select, selectedValue) {
  if (!state.books.length) {
    select.innerHTML = "<option value=\"\">Beim Verbinden automatisch erkennen</option>";
    select.disabled = true;
    if (select === dom.bookSelect) dom.bookField.hidden = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = state.books.map((book) => (
    `<option value="${escapeAttribute(book.href)}">${escapeHtml(book.name)}</option>`
  )).join("");
  select.value = state.books.some((book) => book.href === selectedValue)
    ? selectedValue
    : state.books[0].href;
  if (select === dom.bookSelect) dom.bookField.hidden = false;
}

function readSettingsForm() {
  return {
    serverUrl: normalizeServerUrl(dom.serverInput.value.trim()),
    username: dom.usernameInput.value.trim(),
    password: dom.passwordInput.value,
    remember: dom.rememberInput.checked,
    collection: dom.bookSelect.value || ""
  };
}

function normalizeServerUrl(value) {
  const parsed = new URL(value || DEFAULT_SERVER);
  const localTest = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(localTest && parsed.protocol === "http:")) {
    throw new Error("Die Server-Adresse muss mit https:// beginnen.");
  }
  parsed.hash = "";
  parsed.search = "";
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}

function setSyncProgress(current, total, label) {
  state.syncProgress = {
    current: Math.max(0, Number(current) || 0),
    total: Math.max(0, Number(total) || 0),
    label: label || ""
  };
  renderSyncProgress();
}

function renderSyncProgress() {
  if (!dom.syncProgressTrack || !dom.syncProgressBar) return;
  const { current, total, label } = state.syncProgress;
  const determinate = total > 0;
  const safeCurrent = determinate ? Math.min(current, total) : 0;
  dom.syncProgressTrack.dataset.mode = determinate ? "determinate" : "indeterminate";
  dom.syncProgressTrack.setAttribute("aria-valuemax", String(determinate ? total : 1));
  if (determinate) {
    dom.syncProgressTrack.setAttribute("aria-valuenow", String(safeCurrent));
    dom.syncProgressBar.style.width = `${Math.round((safeCurrent / total) * 100)}%`;
  } else {
    dom.syncProgressTrack.removeAttribute("aria-valuenow");
    dom.syncProgressBar.style.width = "35%";
  }
  if (label) dom.loadingText.textContent = label;
}

async function requestCardDav(action, extra = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35000);

  const target = action === "discover"
    ? extra.collection || state.settings.serverUrl
    : action === "get" || action === "put" || action === "delete"
      ? extra.resource
      : extra.collection;
  const request = cardDavRequest(action, extra);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok && response.status !== 207) {
      const error = new Error("Die CardDAV-Anfrage ist fehlgeschlagen.");
      error.status = response.status;
      throw error;
    }
    return {
      status: response.status,
      body,
      etag: response.headers.get("ETag") || ""
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function cardDavRequest(action, extra = {}) {
  const headers = {
    Authorization: `Basic ${basicAuth(state.settings.username, state.settings.password)}`,
    Accept: "application/xml, text/vcard, text/plain"
  };

  if (action === "discover") {
    return {
      method: "PROPFIND",
      headers: { ...headers, Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
      <d:prop><d:current-user-principal/><d:principal-URL/><d:displayname/><d:resourcetype/><card:supported-address-data/></d:prop>
</d:propfind>`
    };
  }

  if (action === "report") {
    return {
      method: "REPORT",
      headers: { ...headers, Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data content-type="text/vcard" version="3.0"/></d:prop>
</card:addressbook-query>`
    };
  }

  if (action === "resources") {
    return {
      method: "PROPFIND",
      headers: { ...headers, Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`
    };
  }

  if (action === "put") {
    return {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "text/vcard; charset=utf-8",
        ...(extra.etag ? { "If-Match": extra.etag } : {})
      },
      body: extra.body
    };
  }

  if (action === "delete") {
    return {
      method: "DELETE",
      headers: {
        ...headers,
        ...(extra.etag ? { "If-Match": extra.etag } : {})
      }
    };
  }

  return { method: "GET", headers };
}

function basicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function connect({ showBookSelection = false, silent = false } = {}) {
  if (!state.settings.username || !state.settings.password) {
    showNotice("Bitte hinterlege zuerst Server-Adresse, Benutzername und Passwort.", "warning");
    openSettings();
    return;
  }

  const keepVisible = silent || (state.hasLoaded && !showBookSelection);
  state.loading = !keepVisible;
  state.syncing = keepVisible;
  if (!keepVisible) state.connected = false;
  setSyncProgress(0, 0, "Adressbücher werden synchronisiert ...");
  render();

  try {
    const discovery = await requestCardDav("discover");
    let books = parseAddressBooks(discovery.body, state.settings.serverUrl);
    if (!books.length) {
      books = await discoverUserAddressBooks(discovery.body);
    }
    state.books = books;
    await writeCache("books", {
      key: accountCacheKey(),
      books,
      syncedAt: new Date().toISOString()
    });
    populateBookSelect(dom.bookSelect, state.settings.collection);

    if (books.length) {
      const savedBook = books.find((book) => book.href === state.settings.collection);
      if (showBookSelection || !state.hasLoaded) {
        state.connected = true;
        state.choosingBook = true;
        hideNotice();
        return;
      }

      const selected = savedBook || books[0];
      state.choosingBook = false;
      state.settings.collection = selected.href;
      populateBookSelect(dom.bookSelect, selected.href);
      setSyncProgress(0, 0, `${selected.name} wird synchronisiert ...`);
      await loadContacts(selected.href, { forceSync: keepVisible && !showBookSelection });
    } else {
      throw new Error("Keine Adressbücher gefunden. Bitte prüfe die Server-Adresse und die Berechtigungen.");
    }

    state.connected = true;
    state.hasLoaded = true;
    state.lastUpdated = new Date();
    persistSettings();
    hideNotice();
  } catch (error) {
    if (!state.hasLoaded && !state.books.length) state.connected = false;
    showNotice(messageForError(error), "error");
  } finally {
    state.loading = false;
    state.syncing = false;
    render();
  }
}

async function discoverUserAddressBooks(rootResponse) {
  const candidates = parseDiscoveryCandidates(rootResponse, state.settings.serverUrl);
  const books = [];

  for (const candidate of candidates.slice(0, 10)) {
    try {
      const response = await requestCardDav("discover", { collection: candidate });
      books.push(...parseAddressBooks(response.body, candidate));
    } catch (_error) {
      // A shared or inaccessible collection should not stop discovery.
    }
  }

  return books.filter((book, index, allBooks) => (
    allBooks.findIndex((candidate) => candidate.href === book.href) === index
  ));
}

function parseDiscoveryCandidates(xmlText, baseUrl) {
  const document = parseXml(xmlText);
  const candidates = [];
  const addCandidate = (href) => {
    const absoluteHref = resolveHref(href, baseUrl);
    if (!absoluteHref || absoluteHref === baseUrl) return;
    if (!candidates.includes(absoluteHref)) candidates.push(absoluteHref);
  };

  for (const response of responseElements(document)) {
    const href = textOf(response, "href");
    const resourceType = firstDescendant(response, "resourcetype");
    if (href && resourceType && firstDescendant(resourceType, "collection")) addCandidate(href);
  }

  for (const propertyName of ["current-user-principal", "principal-URL", "owner"]) {
    for (const property of allElements(document, propertyName)) {
      const href = textOf(property, "href");
      if (href) addCandidate(href);
    }
  }

  return candidates;
}

async function loadContacts(collection, { forceSync = false } = {}) {
  const cached = await readCachedContacts(collection);
  if (cached) {
    state.contacts = uniqueContacts((cached.contacts || []).map(refreshCachedContact)).sort(compareContacts);
    state.alphabetLetter = "";
    state.visibleStart = 0;
    state.visibleCount = CONTACT_BATCH_SIZE;
    state.hasLoaded = true;
    state.connected = true;
    state.choosingBook = false;
    state.lastUpdated = cached.syncedAt ? new Date(cached.syncedAt) : null;
    state.loading = false;
    if (!forceSync) {
      state.syncing = false;
      render();
      return;
    }
    state.syncing = true;
    render();
  }

  await synchronizeContacts(collection);
}

async function synchronizeContacts(collection) {
  const cacheKey = contactsCacheKey(collection);
  const cachedByHref = new Map(state.contacts.map((contact) => [contact.sourceHref, contact]));

  if (!cachedByHref.size) {
    await synchronizeWithReport(collection, cacheKey);
    return;
  }

  setSyncProgress(0, 0, "Kontakte werden synchronisiert ...");

  try {
    const resourcesResponse = await requestCardDav("resources", { collection });
    const resources = parseResources(resourcesResponse.body, collection);
    const changedResources = resources.filter((resource) => {
      const cachedContact = cachedByHref.get(resource.href);
      return !cachedContact || !resource.etag || cachedContact.etag !== resource.etag;
    });
    const progressTotal = changedResources.length || 1;
    setSyncProgress(0, progressTotal, changedResources.length
      ? `${changedResources.length} Kontakte werden geladen ...`
      : "Kontakte sind aktuell");
    let lastProgressUpdate = 0;
    const changedContacts = await fetchResourcesInBatches(changedResources, (current, total) => {
      const now = performance.now();
      if (current !== total && now - lastProgressUpdate < 120) return;
      lastProgressUpdate = now;
      setSyncProgress(current, total, `${current} von ${total} Kontakten geladen ...`);
    });
    const updatedByHref = new Map(changedContacts.map((contact) => [contact.sourceHref, contact]));
    const contacts = resources.map((resource) => updatedByHref.get(resource.href) || cachedByHref.get(resource.href)).filter(Boolean);
    state.contacts = uniqueContacts(contacts).sort(compareContacts);
    state.alphabetLetter = "";
    state.visibleStart = 0;
    state.visibleCount = CONTACT_BATCH_SIZE;
    state.hasLoaded = true;
    setSyncProgress(progressTotal, progressTotal, changedResources.length
      ? `${changedResources.length} Kontakte synchronisiert`
      : "Kontakte sind aktuell");
    await writeCache("contacts", {
      key: cacheKey,
      contacts: state.contacts,
      syncedAt: new Date().toISOString()
    });
    state.lastUpdated = new Date();
    return;
  } catch (error) {
    // Older CardDAV servers may not expose etags through PROPFIND.
    if (!error.status || error.status < 400) throw error;
  }

  await synchronizeWithReport(collection, cacheKey);
}

async function synchronizeWithReport(collection, cacheKey) {
  setSyncProgress(0, 0, "Kontakte werden synchronisiert ...");
  const report = await requestCardDav("report", { collection });
  const contacts = parseReportContacts(report.body, collection);
  state.contacts = uniqueContacts(contacts).sort(compareContacts);
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  state.hasLoaded = true;
  setSyncProgress(1, 1, `${contacts.length} Kontakte synchronisiert`);
  state.lastUpdated = new Date();
  await writeCache("contacts", {
    key: cacheKey,
    contacts: state.contacts,
    syncedAt: new Date().toISOString()
  });
}

async function fetchResourcesInBatches(resources, onProgress = () => {}) {
  const contacts = [];
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < resources.length) {
      const resource = resources[nextIndex++];
      try {
        const response = await requestCardDav("get", { resource: resource.href });
        const contact = parseVCard(response.body, resource.href);
        if (contact) {
          contact.etag = resource.etag;
          contacts.push(contact);
        }
      } catch (_error) {
        // One malformed or deleted card should not block the rest of the book.
      } finally {
        completed += 1;
        onProgress(completed, resources.length);
      }
    }
  }

  const workerCount = Math.min(4, resources.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return contacts;
}

function parseAddressBooks(xmlText, baseUrl) {
  const document = parseXml(xmlText);
  return responseElements(document).map((response) => {
    const href = textOf(response, "href");
    const resourceType = firstDescendant(response, "resourcetype");
    const isAddressBook = resourceType && Boolean(firstDescendant(resourceType, "addressbook"));
    if (!href || !isAddressBook) return null;

    const absoluteHref = resolveHref(href, baseUrl);
    return {
      href: absoluteHref,
      name: textOf(response, "displayname") || displayNameFromUrl(absoluteHref)
    };
  }).filter(Boolean).filter((book, index, books) => (
    books.findIndex((candidate) => candidate.href === book.href) === index
  ));
}

function parseResources(xmlText, collection) {
  const document = parseXml(xmlText);
  return responseElements(document).map((response) => {
    const href = textOf(response, "href");
    if (!href) return null;
    const resourceType = firstDescendant(response, "resourcetype");
    const isCollection = resourceType && Boolean(firstDescendant(resourceType, "collection"));
    if (isCollection) return null;
    return {
      href: resolveHref(href, collection),
      etag: textOf(response, "getetag")
    };
  }).filter(Boolean).filter((resource, index, resources) => (
    resources.findIndex((candidate) => candidate.href === resource.href) === index
  ));
}

function parseReportContacts(xmlText, collection) {
  const document = parseXml(xmlText);
  return responseElements(document).map((response) => {
    const addressData = firstDescendant(response, "address-data");
    if (!addressData || !addressData.textContent.trim()) return null;
    const contact = parseVCard(addressData.textContent, resolveHref(textOf(response, "href"), collection));
    if (contact) contact.etag = textOf(response, "getetag");
    return contact;
  }).filter(Boolean);
}

function parseVCard(rawText, sourceHref = "") {
  if (!rawText || !/BEGIN:VCARD/i.test(rawText)) return null;

  const lines = rawText
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
  const fields = { phones: [], emails: [], urls: [], addresses: [], notes: [] };
  let formattedName = "";
  let structuredName = [];
  let organization = "";
  let title = "";

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const rawKey = line.slice(0, separator);
    const value = unescapeVCard(line.slice(separator + 1));
    const keyParts = rawKey.split(";");
    const key = keyParts[0].split(".").pop().toUpperCase();
    const params = keyParts.slice(1).join(";").toUpperCase();

    switch (key) {
      case "FN":
        formattedName = value.trim();
        break;
      case "N":
        structuredName = splitVCardValue(value);
        break;
      case "TEL":
        if (value.trim()) fields.phones.push({ value: value.trim(), label: labelFor(params, "Telefon") });
        break;
      case "EMAIL":
        if (value.trim()) fields.emails.push({ value: value.trim(), label: labelFor(params, "E-Mail") });
        break;
      case "URL":
        if (/^https?:\/\//i.test(value.trim())) fields.urls.push({ value: value.trim(), label: "Website" });
        break;
      case "ORG":
        organization = value.split(";").filter(Boolean).join(" · ").trim();
        break;
      case "TITLE":
        title = value.trim();
        break;
      case "ADR": {
        const addressParts = [...splitVCardValue(value), "", "", "", "", "", "", ""].slice(0, 7);
        const address = addressParts.filter(Boolean).join(", ");
        if (address) {
          fields.addresses.push({
            value: address,
            label: labelFor(params, "Adresse"),
            parts: addressParts,
            poBox: addressParts[0],
            extended: addressParts[1],
            street: addressParts[2],
            city: addressParts[3],
            region: addressParts[4],
            postalCode: addressParts[5],
            country: addressParts[6]
          });
        }
        break;
      }
      case "NOTE":
        if (value.trim()) fields.notes.push(value.trim());
        break;
      default:
        break;
    }
  }

  const nameFromN = [structuredName[3], structuredName[1], structuredName[2], structuredName[0], structuredName[4]]
    .filter(Boolean).join(" ").trim();
  const name = formattedName || nameFromN || fields.emails[0]?.value || "Unbekannter Kontakt";
  return {
    id: `${sourceHref}|${name}`,
    name,
    organization,
    title,
    phones: fields.phones,
    emails: fields.emails,
    urls: fields.urls,
    addresses: fields.addresses,
    notes: fields.notes,
    sourceHref,
    rawVCard: rawText
  };
}

function refreshCachedContact(contact) {
  if (!contact || !contact.rawVCard) return contact;
  const refreshed = parseVCard(contact.rawVCard, contact.sourceHref);
  return refreshed ? { ...refreshed, etag: contact.etag } : contact;
}

function parseXml(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Der Server hat eine ungültige CardDAV-Antwort gesendet.");
  }
  return document;
}

function responseElements(root) {
  return allElements(root, "response");
}

function allElements(root, localName) {
  return Array.from(root.getElementsByTagName("*")).filter((element) => (
    (element.localName || element.nodeName.split(":").pop()).toLowerCase() === localName.toLowerCase()
  ));
}

function firstDescendant(root, localName) {
  return allElements(root, localName)[0] || null;
}

function textOf(root, localName) {
  return firstDescendant(root, localName)?.textContent.trim() || "";
}

function resolveHref(href, baseUrl) {
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).href;
  } catch (_error) {
    return baseUrl;
  }
}

function displayNameFromUrl(url) {
  try {
    const path = new URL(url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(path[path.length - 1] || "Adressbuch");
  } catch (_error) {
    return "Adressbuch";
  }
}

function splitVCardValue(value) {
  return value.split(";").map((part) => part.trim());
}

function unescapeVCard(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function labelFor(params, fallback) {
  const tokens = String(params || "")
    .replace(/[\"']/g, "")
    .split(/[;,=]/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  const labels = [
    ["FAX", "fax"],
    ["CELL", "cell"],
    ["MOBILE", "mobile"],
    ["PAGER", "pager"],
    ["WORK", "work"],
    ["HOME", "home"]
  ];
  const match = labels.find(([type]) => tokens.includes(type));
  return match ? match[1] : fallback;
}

function uniqueContacts(contacts) {
  const seen = new Map();
  for (const contact of contacts) {
    const key = [
      contact.sourceHref,
      contact.name,
      contact.emails[0]?.value || "",
      contact.phones[0]?.value || ""
    ].join("|");
    if (!seen.has(key)) seen.set(key, contact);
  }
  return [...seen.values()];
}

function compareContacts(a, b) {
  return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
}

function normalizeDuplicateName(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function duplicateNameBlocks(name) {
  const normalized = normalizeDuplicateName(name);
  const tokens = normalized.split(" ").filter(Boolean);
  if (!normalized || normalized === "unbekannter kontakt") return [];
  const first = tokens[0] || "";
  const last = tokens[tokens.length - 1] || first;
  const prefix = (value) => value.slice(0, 2);
  const compact = normalized.replace(/ /g, "");
  return [
    `${prefix(first)}|${prefix(last)}`,
    `${prefix(last)}|${prefix(first)}`,
    `sorted:${[...tokens].sort().join("").slice(0, 7)}`,
    `compact:${compact.slice(0, 5)}`
  ];
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

function duplicateNameSimilarity(leftName, rightName) {
  const left = normalizeDuplicateName(leftName);
  const right = normalizeDuplicateName(rightName);
  if (!left || !right || left === "unbekannter kontakt" || right === "unbekannter kontakt") return 0;
  if (left === right) return 1;
  const leftCompact = left.replace(/ /g, "");
  const rightCompact = right.replace(/ /g, "");
  const sortedLeft = left.split(" ").sort().join("");
  const sortedRight = right.split(" ").sort().join("");
  const compactLength = Math.max(leftCompact.length, rightCompact.length);
  const sortedLength = Math.max(sortedLeft.length, sortedRight.length);
  if (Math.min(compactLength, sortedLength) < 4) return 0;
  return Math.max(
    1 - levenshteinDistance(leftCompact, rightCompact) / compactLength,
    1 - levenshteinDistance(sortedLeft, sortedRight) / sortedLength
  );
}

function duplicateContactIds() {
  buildDuplicateCache();
  return duplicateCacheIds;
}

function duplicateContactMatches(contactId) {
  buildDuplicateCache();
  return (duplicateCacheMatches.get(contactId) || [])
    .slice()
    .sort((left, right) => right.score - left.score || compareContacts(left.contact, right.contact));
}

function buildDuplicateCache() {
  if (duplicateCacheContacts === state.contacts) return;

  const buckets = new Map();
  for (const contact of state.contacts) {
    for (const block of duplicateNameBlocks(contact.name)) {
      if (!buckets.has(block)) buckets.set(block, []);
      buckets.get(block).push(contact);
    }
  }

  const duplicateIds = new Set();
  const duplicateMatches = new Map();
  const checkedPairs = new Set();
  for (const bucket of buckets.values()) {
    const contacts = [...new Map(bucket.map((contact) => [contact.id, contact])).values()];
    for (let leftIndex = 0; leftIndex < contacts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < contacts.length; rightIndex += 1) {
        const left = contacts[leftIndex];
        const right = contacts[rightIndex];
        const pairKey = [left.id, right.id].sort().join("\u0000");
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);
        const score = duplicateNameSimilarity(left.name, right.name);
        if (score >= .84) {
          duplicateIds.add(left.id);
          duplicateIds.add(right.id);
          if (!duplicateMatches.has(left.id)) duplicateMatches.set(left.id, []);
          if (!duplicateMatches.has(right.id)) duplicateMatches.set(right.id, []);
          duplicateMatches.get(left.id).push({ contact: right, score });
          duplicateMatches.get(right.id).push({ contact: left, score });
        }
      }
    }
  }

  duplicateCacheContacts = state.contacts;
  duplicateCacheIds = duplicateIds;
  duplicateCacheMatches = duplicateMatches;
}

function filteredContacts() {
  const query = state.query.trim().toLocaleLowerCase("de-DE");
  const duplicateIds = state.filter === "duplicates" ? duplicateContactIds() : null;
  const contacts = state.contacts.filter((contact) => {
    if (duplicateIds && !duplicateIds.has(contact.id)) return false;
    if (!query || query.length < 3) return true;
    const filterKey = state.filter === "duplicates" ? "all" : state.filter;
    const values = {
      all: [
        contact.name,
        contact.organization,
        contact.title,
        ...contact.phones.map((field) => field.value),
        ...contact.emails.map((field) => field.value),
        ...contact.urls.map((field) => field.value),
        ...contact.addresses.map((field) => field.value)
      ],
      name: [contact.name, contact.title],
      phone: contact.phones.map((field) => field.value),
      email: contact.emails.map((field) => field.value),
      organization: [contact.organization]
    };
    return values[filterKey].join(" ").toLocaleLowerCase("de-DE").includes(query);
  });
  return contacts.sort(compareContacts);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function contactInitial(contact) {
  const initial = String(contact.name || "").trim().charAt(0).toLocaleUpperCase("de-DE");
  return initial.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0);
}

function renderAlphabetNav(contacts) {
  const availableLetters = new Set(contacts.map(contactInitial));
  const letters = ALPHABET.filter((letter) => availableLetters.has(letter));
  dom.alphabetNav.hidden = !letters.length;
  dom.alphabetNav.setAttribute("aria-hidden", String(!letters.length));
  if (!letters.length) {
    dom.alphabetNav.innerHTML = "";
    return;
  }

  dom.alphabetNav.innerHTML = letters.map((letter) => (
    `<button class="alphabet-letter${state.alphabetLetter === letter ? " is-current" : ""}" id="alphabetLetter-${letter}" type="button" data-letter="${letter}" aria-label="Zum Buchstaben ${letter} springen" aria-current="${state.alphabetLetter === letter ? "true" : "false"}">${letter}</button>`
  )).join("");
}

function jumpToLetter(letter) {
  const contacts = filteredContacts();
  const targetIndex = contacts.findIndex((contact) => contactInitial(contact) === letter);
  if (targetIndex < 0) return;

  state.visibleStart = targetIndex;
  state.visibleCount = CONTACT_BATCH_SIZE;
  state.alphabetLetter = letter;
  state.expandedContacts.clear();
  state.selectedContactId = "";
  state.editingContactId = "";
  render();

  window.requestAnimationFrame(() => {
    const firstCard = dom.contactsList.querySelector(".contact-card");
    if (!firstCard) return;
    const stickyOffset = dom.contactControls.getBoundingClientRect().height + 18;
    const targetTop = firstCard.getBoundingClientRect().top + window.scrollY - stickyOffset;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  });
}

function isDesktopLayout() {
  return window.matchMedia("(min-width: 701px)").matches;
}

function render() {
  const contacts = filteredContacts();
  const total = state.contacts.length;
  if (state.visibleStart >= contacts.length && contacts.length) state.visibleStart = 0;
  const visibleContacts = contacts.slice(state.visibleStart, state.visibleStart + state.visibleCount);
  const visibleEnd = state.visibleStart + visibleContacts.length;
  dom.contactCount.textContent = visibleContacts.length < contacts.length || state.visibleStart > 0
    ? `${state.visibleStart + 1}–${visibleEnd} von ${contacts.length}`
    : state.query.length >= 3 && total !== contacts.length
      ? `${contacts.length} von ${total}`
      : `${total} ${total === 1 ? "Kontakt" : "Kontakte"}`;
  dom.clearSearchButton.hidden = !dom.searchInput.value;
  dom.refreshButton.disabled = state.loading || state.syncing || !state.settings.username || !state.settings.password;
  dom.logoutButton.hidden = !state.connected;
  dom.booksButton.hidden = state.books.length < 2 || !state.hasLoaded;

  dom.contactControls.dataset.connection = state.syncing ? "syncing" : state.connected ? "connected" : "idle";
  dom.lastUpdated.textContent = state.lastUpdated
    ? `Zuletzt ${state.lastUpdated.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
    : "Noch keine Synchronisation";

  dom.loadingState.hidden = !state.loading;
  dom.welcomeState.hidden = state.loading || state.hasLoaded || state.choosingBook;
  dom.contactControls.hidden = state.loading || !state.hasLoaded || state.choosingBook;
  dom.contactListHeading.hidden = state.loading || !state.hasLoaded || state.choosingBook;
  dom.booksPanel.hidden = state.loading || !state.choosingBook;
  dom.emptyState.hidden = state.loading || !state.hasLoaded || state.choosingBook || contacts.length > 0;
  dom.contactsList.hidden = state.loading || !state.hasLoaded || state.choosingBook || contacts.length === 0;
  renderAlphabetNav(contacts);
  dom.contactsList.innerHTML = visibleContacts.map(renderContact).join("");
  dom.loadMoreSentinel.hidden = state.loading || !state.hasLoaded || state.choosingBook || visibleEnd >= contacts.length;
  dom.loadMoreText.textContent = `${Math.max(0, contacts.length - visibleEnd)} weitere Kontakte`;
  renderDetailPane(contacts.find((contact) => contact.id === state.selectedContactId));
  renderSyncProgress();
  renderBooks();
}

function loadMoreContacts() {
  if (state.loading || state.syncing || state.choosingBook || !state.hasLoaded) return;
  const contacts = filteredContacts();
  if (state.visibleStart + state.visibleCount >= contacts.length) return;
  state.visibleCount = Math.min(state.visibleCount + CONTACT_BATCH_SIZE, contacts.length - state.visibleStart);
  render();
}

function renderBooks() {
  dom.booksCount.textContent = `${state.books.length} ${state.books.length === 1 ? "Adressbuch" : "Adressbücher"}`;
  dom.booksList.innerHTML = state.books.map((book, index) => (
    `<button class="book-option" type="button" data-book-href="${escapeAttribute(book.href)}">
      <span class="book-badge book-tone-${index % 4}" aria-hidden="true">${escapeHtml(initialsFor(book.name))}</span>
      <span class="book-copy"><strong>${escapeHtml(book.name)}</strong><small>CardDAV-Adressbuch</small></span>
      <span class="book-arrow" aria-hidden="true">›</span>
    </button>`
  )).join("");
}

function renderContactDetails(contact) {
  const details = [];
  for (const phone of contact.phones) {
    details.push(`<a class="contact-action" href="tel:${phoneHref(phone.value)}"><span class="action-icon phone-icon" aria-hidden="true"></span><span><small>${escapeHtml(phone.label)}</small>${escapeHtml(phone.value)}</span></a>`);
  }
  for (const email of contact.emails) {
    details.push(`<a class="contact-action" href="mailto:${encodeURIComponent(email.value)}"><span class="action-icon email-icon" aria-hidden="true"></span><span><small>${escapeHtml(email.label)}</small>${escapeHtml(email.value)}</span></a>`);
  }
  for (const url of contact.urls) {
    details.push(`<a class="contact-action" href="${escapeAttribute(url.value)}" target="_blank" rel="noreferrer"><span class="action-icon web-icon" aria-hidden="true"></span><span><small>${escapeHtml(url.label)}</small>${escapeHtml(shortUrl(url.value))}</span></a>`);
  }
  for (const address of contact.addresses) {
    details.push(`<a class="contact-action" href="https://maps.apple.com/?address=${encodeURIComponent(address.value)}" target="_blank" rel="noreferrer"><span class="action-icon pin-icon" aria-hidden="true"></span><span><small>${escapeHtml(address.label)}</small>${escapeHtml(address.value)}</span></a>`);
  }
  if (contact.notes.length) {
    details.push(`<div class="contact-note"><span class="action-icon note-icon" aria-hidden="true"></span><span>${escapeHtml(contact.notes.join(" · "))}</span></div>`);
  }
  return details.length ? details.join("") : "<p class=\"no-details\">Keine Kontaktdaten hinterlegt</p>";
}

function renderDetailPane(contact) {
  const visible = isDesktopLayout() && contact && state.hasLoaded && !state.loading && !state.choosingBook;
  dom.contactDetailPane.hidden = !visible;
  if (!visible) return;

  const contactIndex = state.contacts.findIndex((candidate) => candidate.id === contact.id);
  const subtitle = [contact.title, contact.organization].filter(Boolean).join(" · ");
  dom.detailPaneAvatar.className = `avatar avatar-tone-${Math.max(0, contactIndex) % 5}`;
  dom.detailPaneAvatar.textContent = initialsFor(contact.name);
  dom.detailPaneTitle.textContent = contact.name;
  dom.detailPaneSubtitle.textContent = subtitle;
  dom.detailPaneSubtitle.hidden = !subtitle;
  const editing = state.editingContactId === contact.id;
  dom.detailSaveButton.hidden = !editing;
  dom.detailSaveButton.disabled = state.syncing;
  dom.detailEditButton.textContent = editing ? "Abbrechen" : "Bearbeiten";
  dom.detailEditButton.disabled = state.syncing;
  dom.detailEditButton.setAttribute("aria-label", editing ? "Bearbeitung abbrechen" : `Kontakt ${contact.name} bearbeiten`);
  dom.detailMergeButton.hidden = editing;
  dom.detailMergeButton.disabled = state.syncing || state.contacts.length < 2;
  dom.detailDeleteButton.hidden = editing;
  dom.detailDeleteButton.disabled = state.syncing;
  dom.detailPaneContent.innerHTML = editing ? renderContactEditForm(contact) : renderContactDetails(contact);
}

function updateDesktopSelection() {
  for (const card of dom.contactsList.querySelectorAll(".contact-card")) {
    const header = card.querySelector(".contact-card-header");
    const selected = header && header.dataset.contactId === state.selectedContactId;
    card.classList.toggle("is-expanded", selected);
    if (header) header.setAttribute("aria-expanded", String(Boolean(selected)));
  }

  renderDetailPane(state.contacts.find((contact) => contact.id === state.selectedContactId));
}

const EDIT_TYPE_OPTIONS = {
  phone: [
    ["work", "Dienstlich"],
    ["home", "Privat"],
    ["cell", "Mobil"],
    ["fax", "Fax"],
    ["pager", "Pager"],
    ["unknown", "Unbekannt"]
  ],
  email: [
    ["unknown", "Unbekannt"],
    ["home", "Privat"],
    ["work", "Dienstlich"]
  ],
  address: [
    ["work", "Dienstlich"],
    ["home", "Privat"],
    ["unknown", "Unbekannt"]
  ]
};

function editTypeForLabel(label, kind) {
  const normalized = String(label || "").trim().toLocaleLowerCase("de-DE");
  if (kind === "phone" && ["cell", "mobile", "mobil"].includes(normalized)) return "cell";
  if (kind === "phone" && ["fax"].includes(normalized)) return "fax";
  if (kind === "phone" && ["pager"].includes(normalized)) return "pager";
  if (["work", "arbeit", "dienstlich"].includes(normalized)) return "work";
  if (["home", "privat"].includes(normalized)) return "home";
  return "unknown";
}

function renderEditTypeOptions(kind, selectedType) {
  return EDIT_TYPE_OPTIONS[kind].map(([value, label]) => (
    `<option value="${value}"${value === selectedType ? " selected" : ""}>${label}</option>`
  )).join("");
}

function renderTypedEditRow(kind, field, index) {
  const value = typeof field === "string" ? field : field?.value || "";
  const selectedType = editTypeForLabel(typeof field === "string" ? "" : field?.label, kind);
  const label = kind === "phone" ? "Telefonnummer" : "E-Mail-Adresse";
  const prefix = kind === "phone" ? "Phone" : "Email";
  return `<div class="edit-contact-row" id="edit${prefix}Row-${index}" data-edit-row="${kind}">
    <select class="edit-contact-type" id="edit${prefix}Type-${index}" data-edit-type aria-label="${label} Typ">
      ${renderEditTypeOptions(kind, selectedType)}
    </select>
    <input class="edit-contact-value" id="edit${prefix}Value-${index}" data-edit-value type="${kind === "email" ? "text" : "tel"}"${kind === "email" ? " inputmode=\"email\"" : ""} value="${escapeAttribute(value)}" aria-label="${label}">
    <button class="edit-remove-button" id="remove${prefix}Button-${index}" type="button" data-remove-edit-row aria-label="${label} entfernen" title="${label} entfernen">&minus;</button>
  </div>`;
}

function renderTypedEditRows(kind, fields) {
  const visibleFields = fields.length ? fields : [{ value: "", label: "" }];
  const prefix = kind === "phone" ? "Phone" : "Email";
  return `<div class="edit-contact-rows" id="edit${prefix}Rows" data-edit-group="${kind}" data-next-row-id="${visibleFields.length}">
    ${visibleFields.map((field, index) => renderTypedEditRow(kind, field, index)).join("")}
  </div>`;
}

function renderEditRow(kind, field, index) {
  return kind === "address" ? renderAddressEditRow(field, index) : renderTypedEditRow(kind, field, index);
}

function addressComponents(address) {
  if (typeof address === "string") {
    return {
      poBox: "",
      extended: "",
      street: address,
      city: "",
      region: "",
      postalCode: "",
      country: ""
    };
  }
  const parts = Array.isArray(address?.parts) ? address.parts : [];
  const fallbackStreet = address?.value || "";
  return {
    poBox: address?.poBox ?? parts[0] ?? "",
    extended: address?.extended ?? parts[1] ?? "",
    street: address?.street ?? parts[2] ?? fallbackStreet,
    city: address?.city ?? parts[3] ?? "",
    region: address?.region ?? parts[4] ?? "",
    postalCode: address?.postalCode ?? parts[5] ?? "",
    country: address?.country ?? parts[6] ?? ""
  };
}

function renderAddressEditRow(address, index) {
  const parts = addressComponents(address);
  const selectedType = editTypeForLabel(address?.label, "address");
  const fields = [
    ["street", "Straße"],
    ["city", "Stadt"],
    ["region", "Provinz"],
    ["postalCode", "Postleitzahl"],
    ["country", "Staat"]
  ];
  return `<div class="edit-address-row" id="editAddressRow-${index}" data-edit-row="address" data-address-po-box="${escapeAttribute(parts.poBox)}" data-address-extended="${escapeAttribute(parts.extended)}">
    <div class="edit-address-row-header" id="editAddressRowHeader-${index}">
      <select class="edit-contact-type" id="editAddressType-${index}" data-edit-type aria-label="Adresse Typ">
        ${renderEditTypeOptions("address", selectedType)}
      </select>
      <button class="edit-remove-button" id="removeAddressButton-${index}" type="button" data-remove-edit-row aria-label="Adresse entfernen" title="Adresse entfernen">&minus;</button>
    </div>
    <div class="edit-address-grid" id="editAddressFields-${index}">
      ${fields.map(([property, label], fieldIndex) => `<label class="edit-address-field${fieldIndex === 0 ? " edit-address-street" : ""}" id="editAddress${property}-${index}-field">
        <span>${label}</span>
        <input id="editAddress${property}-${index}" data-address-part="${property}" type="text" value="${escapeAttribute(parts[property])}" aria-label="${label}">
      </label>`).join("")}
    </div>
  </div>`;
}

function renderAddressEditRows(fields) {
  const visibleFields = fields.length ? fields : [{ label: "", parts: [] }];
  return `<div class="edit-address-rows" id="editAddressRows" data-edit-group="address" data-next-row-id="${visibleFields.length}">
    ${visibleFields.map((field, index) => renderAddressEditRow(field, index)).join("")}
  </div>`;
}

function renderContactEditForm(contact) {
  return `<form class="contact-edit-form" id="contactEditForm">
    <div class="edit-form-fields">
      <label class="field" id="editNameField">
        <span>Name</span>
        <input id="editNameInput" name="name" type="text" value="${escapeAttribute(contact.name)}" required>
      </label>
      <label class="field" id="editOrganizationField">
        <span>Organisation</span>
        <input id="editOrganizationInput" name="organization" type="text" value="${escapeAttribute(contact.organization)}">
      </label>
      <label class="field" id="editTitleField">
        <span>Position</span>
        <input id="editTitleInput" name="title" type="text" value="${escapeAttribute(contact.title)}">
      </label>
      <div class="field" id="editPhonesField" data-edit-section="phone">
        <span>Telefonnummern</span>
        ${renderTypedEditRows("phone", contact.phones)}
        <button class="edit-add-button" id="addPhoneButton" type="button" data-add-edit-row="phone">+ Telefonnummer hinzufügen</button>
      </div>
      <div class="field" id="editEmailsField" data-edit-section="email">
        <span>E-Mail-Adressen</span>
        ${renderTypedEditRows("email", contact.emails)}
        <button class="edit-add-button" id="addEmailButton" type="button" data-add-edit-row="email">+ E-Mail-Adresse hinzufügen</button>
      </div>
      <div class="field" id="editAddressesField" data-edit-section="address">
        <span>Adressen</span>
        ${renderAddressEditRows(contact.addresses)}
        <button class="edit-add-button" id="addAddressButton" type="button" data-add-edit-row="address">+ Adresse hinzufügen</button>
      </div>
      <label class="field" id="editNotesField">
        <span>Notizen</span>
        <textarea id="editNotesInput" name="notes" rows="2" placeholder="Eine Notiz pro Zeile">${escapeHtml(contact.notes.join("\n"))}</textarea>
      </label>
    </div>
    <div class="edit-form-actions" id="editFormActions">
      <button class="primary-button" id="saveContactButton" type="submit">Speichern</button>
      <span class="edit-form-hint" id="editFormHint">Wird direkt in CardDAV gespeichert.</span>
    </div>
  </form>`;
}

function renderContact(contact, index) {
  const avatarClass = `avatar-tone-${index % 5}`;
  const detailsId = `contactDetails-${index}`;
  const isExpanded = isDesktopLayout()
    ? state.selectedContactId === contact.id
    : state.expandedContacts.has(contact.id);
  const subtitle = [contact.title, contact.organization].filter(Boolean).join(" · ");
  const detailMarkup = renderContactDetails(contact);
  return `<article class="contact-card${isExpanded ? " is-expanded" : ""}">
    <button class="contact-card-header" id="contactCardHeader-${index}" type="button" data-contact-id="${escapeAttribute(contact.id)}" aria-expanded="${isExpanded}" aria-controls="${detailsId}">
      <div class="contact-topline">
        <div class="avatar ${avatarClass}">${escapeHtml(initialsFor(contact.name))}</div>
        <div class="contact-heading">
          <h2>${escapeHtml(contact.name)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
        </div>
      </div>
      <span class="contact-expand-icon" aria-hidden="true"></span>
    </button>
    <div class="contact-details" id="${detailsId}"${isExpanded ? "" : " hidden"}>${detailMarkup}</div>
  </article>`;
}

function editLines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function escapeVCardText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function vCardPropertyName(line) {
  const separator = line.indexOf(":");
  return separator < 1 ? "" : line.slice(0, separator).split(";")[0].split(".").pop().toUpperCase();
}

function vCardTypeForLabel(label) {
  const normalized = String(label || "").trim().toLocaleLowerCase("de-DE");
  if (["fax"].includes(normalized)) return "FAX";
  if (["cell", "mobile", "mobil"].includes(normalized)) return "CELL";
  if (["work", "arbeit", "dienstlich"].includes(normalized)) return "WORK";
  if (["home", "privat"].includes(normalized)) return "HOME";
  if (["pager"].includes(normalized)) return "PAGER";
  return "";
}

function serializeVCardProperty(property, field, fallbackLabel = "") {
  const value = typeof field === "string" ? field : field?.value;
  if (!String(value || "").trim()) return "";
  const label = typeof field === "string" ? fallbackLabel : field?.label || fallbackLabel;
  const type = vCardTypeForLabel(label);
  return `${property}${type ? `;TYPE=${type}` : ""}:${escapeVCardText(value)}`;
}

function serializeVCardAddress(address) {
  const parts = addressComponents(address);
  const values = [parts.poBox, parts.extended, parts.street, parts.city, parts.region, parts.postalCode, parts.country];
  if (!values.some((value) => String(value || "").trim())) return "";
  const label = typeof address === "string" ? "Adresse" : address?.label || "Adresse";
  const type = vCardTypeForLabel(label);
  return `ADR${type ? `;TYPE=${type}` : ""}:${values.map(escapeVCardText).join(";")}`;
}

function serializeEditedVCard(contact, values) {
  const editableProperties = new Set(["FN", "N", "ORG", "TITLE", "TEL", "EMAIL", "ADR", "NOTE"]);
  if (Array.isArray(values.urls)) editableProperties.add("URL");
  const originalLines = (contact.rawVCard || "")
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const lines = originalLines.length ? originalLines : ["BEGIN:VCARD", "VERSION:3.0", "END:VCARD"];
  const keptLines = lines.filter((line) => !editableProperties.has(vCardPropertyName(line)));
  const endIndex = keptLines.findIndex((line) => vCardPropertyName(line) === "END");
  const insertAt = endIndex === -1 ? keptLines.length : endIndex;
  const nameParts = values.name.split(/\s+/).filter(Boolean);
  const familyName = nameParts.length > 1 ? nameParts.pop() : "";
  const givenName = nameParts.join(" ") || values.name;
  const fields = [
    `FN:${escapeVCardText(values.name)}`,
    `N:${escapeVCardText(familyName)};${escapeVCardText(givenName)};;;`
  ];

  if (values.organization) fields.push(`ORG:${escapeVCardText(values.organization)}`);
  if (values.title) fields.push(`TITLE:${escapeVCardText(values.title)}`);
  values.phones.forEach((phone) => fields.push(serializeVCardProperty("TEL", phone, "Telefon")));
  values.emails.forEach((email) => fields.push(serializeVCardProperty("EMAIL", email, "E-Mail")));
  values.addresses.forEach((address) => {
    const serialized = serializeVCardAddress(address);
    if (serialized) fields.push(serialized);
  });
  values.notes.forEach((note) => fields.push(serializeVCardProperty("NOTE", note)));
  if (Array.isArray(values.urls)) values.urls.forEach((url) => fields.push(serializeVCardProperty("URL", url, "Website")));

  if (!keptLines.some((line) => vCardPropertyName(line) === "UID")) {
    keptLines.splice(insertAt, 0, `UID:${escapeVCardText(contact.sourceHref)}`);
  }
  keptLines.splice(insertAt, 0, ...fields);
  if (!keptLines.some((line) => vCardPropertyName(line) === "BEGIN")) keptLines.unshift("BEGIN:VCARD");
  if (!keptLines.some((line) => vCardPropertyName(line) === "VERSION")) keptLines.splice(1, 0, "VERSION:3.0");
  if (!keptLines.some((line) => vCardPropertyName(line) === "END")) keptLines.push("END:VCARD");
  return `${keptLines.join("\r\n")}\r\n`;
}

function readEditedFields(value, originalFields = [], fallbackLabel) {
  return editLines(value).map((fieldValue, index) => ({
    value: fieldValue,
    label: originalFields[index]?.label || fallbackLabel
  }));
}

function readTypedEditFields(form, kind) {
  return Array.from(form.querySelectorAll(`[data-edit-row="${kind}"]`)).map((row) => ({
    value: row.querySelector("[data-edit-value]").value.trim(),
    label: row.querySelector("[data-edit-type]").value
  })).filter((field) => field.value);
}

function readAddressEditFields(form) {
  return Array.from(form.querySelectorAll('[data-edit-row="address"]')).map((row) => {
    const getPart = (part) => row.querySelector(`[data-address-part="${part}"]`)?.value.trim() || "";
    const parts = [
      row.dataset.addressPoBox || "",
      row.dataset.addressExtended || "",
      getPart("street"),
      getPart("city"),
      getPart("region"),
      getPart("postalCode"),
      getPart("country")
    ];
    return {
      value: parts.filter(Boolean).join(", "),
      label: row.querySelector("[data-edit-type]").value,
      parts,
      poBox: parts[0],
      extended: parts[1],
      street: parts[2],
      city: parts[3],
      region: parts[4],
      postalCode: parts[5],
      country: parts[6]
    };
  }).filter((address) => address.value);
}

function readContactEditValues(form, contact) {
  return {
    name: form.elements.name.value.trim(),
    organization: form.elements.organization.value.trim(),
    title: form.elements.title.value.trim(),
    phones: readTypedEditFields(form, "phone"),
    emails: readTypedEditFields(form, "email"),
    addresses: readAddressEditFields(form),
    notes: editLines(form.elements.notes.value)
  };
}

function normalizeMergedValue(value, kind) {
  const normalized = String(value || "").trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
  if (kind === "phone") {
    const digits = normalized.replace(/\D/g, "");
    return digits || normalized;
  }
  return normalized;
}

function uniqueMergedValues(values, kind) {
  const seen = new Set();
  return values.filter((field) => {
    const value = typeof field === "string" ? field : field?.value;
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return false;
    const key = normalizeMergedValue(normalizedValue, kind);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergedFieldValues(primary, secondary, property, kind) {
  return uniqueMergedValues([
    ...primary[property],
    ...secondary[property]
  ], kind);
}

function mergeTextValues(primaryValue, secondaryValue) {
  const primaryText = String(primaryValue || "").trim();
  const secondaryText = String(secondaryValue || "").trim();
  if (!primaryText) return secondaryText;
  if (!secondaryText || normalizeMergedValue(primaryText) === normalizeMergedValue(secondaryText)) return primaryText;
  return `${primaryText} · ${secondaryText}`;
}

function mergeContactValues(primary, secondary) {
  const primaryName = primary.name && primary.name !== "Unbekannter Kontakt" ? primary.name : "";
  return {
    name: primaryName || secondary.name || "Unbekannter Kontakt",
    organization: mergeTextValues(primary.organization, secondary.organization),
    title: mergeTextValues(primary.title, secondary.title),
    phones: mergedFieldValues(primary, secondary, "phones", "phone"),
    emails: mergedFieldValues(primary, secondary, "emails", "email"),
    urls: mergedFieldValues(primary, secondary, "urls", "url"),
    addresses: mergedFieldValues(primary, secondary, "addresses", "address"),
    notes: mergedFieldValues(primary, secondary, "notes", "note")
  };
}

async function fetchFreshContact(contact) {
  const response = await requestCardDav("get", { resource: contact.sourceHref });
  const freshContact = parseVCard(response.body, contact.sourceHref);
  if (!freshContact) throw new Error("Die aktuelle Kontaktkarte konnte nicht gelesen werden.");
  freshContact.etag = response.etag || contact.etag;
  return freshContact;
}

function setContactOperationBusy(busy) {
  state.syncing = busy;
  dom.contactControls.dataset.connection = busy ? "syncing" : state.connected ? "connected" : "idle";
  dom.refreshButton.disabled = busy || state.loading || !state.settings.username || !state.settings.password;
  dom.detailSaveButton.disabled = busy;
  dom.detailEditButton.disabled = busy;
  dom.detailMergeButton.disabled = busy || state.contacts.length < 2;
  dom.detailDeleteButton.disabled = busy;
}

function mergeSearchText(contact) {
  return [
    contact.name,
    contact.organization,
    contact.title,
    ...contact.phones.map((field) => field.value),
    ...contact.emails.map((field) => field.value)
  ].join(" ").toLocaleLowerCase("de-DE");
}

function updateMergeSummary() {
  const primary = state.contacts.find((contact) => contact.id === state.selectedContactId);
  const secondary = state.contacts.find((contact) => contact.id === state.mergeContactId);
  if (!primary) return;
  dom.mergeSummary.innerHTML = secondary
    ? `Der geöffnete Kontakt <strong>${escapeHtml(primary.name)}</strong> bleibt erhalten und wird mit <strong>${escapeHtml(secondary.name)}</strong> ergänzt.`
    : `Der geöffnete Kontakt <strong>${escapeHtml(primary.name)}</strong> bleibt erhalten.`;
}

function renderMergeResultButtons(candidates) {
  return candidates.map((contact, index) => {
    const selected = contact.id === state.mergeContactId;
    const subtitle = [contact.title, contact.organization].filter(Boolean).join(" · ");
    return `<button class="merge-result${selected ? " is-selected" : ""}" id="mergeResult-${index}" type="button" role="option" aria-selected="${selected}" data-merge-contact-id="${escapeAttribute(contact.id)}">
      <span class="avatar avatar-tone-${index % 5}" aria-hidden="true">${escapeHtml(initialsFor(contact.name))}</span>
      <span class="merge-result-copy"><strong>${escapeHtml(contact.name)}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}</span>
    </button>`;
  }).join("");
}

function renderMergeCandidates() {
  const query = dom.mergeSearchInput.value.trim().toLocaleLowerCase("de-DE");
  updateMergeSummary();
  let candidates;
  let suggestionHeading = "";

  if (query.length < 3) {
    if (query) {
      dom.mergeResults.innerHTML = `<p class="merge-results-empty">Mindestens drei Zeichen eingeben.</p>`;
      dom.mergeSubmitButton.disabled = true;
      return;
    }
    const suggestions = duplicateContactMatches(state.selectedContactId);
    candidates = suggestions.map((match) => match.contact).slice(0, 24);
    suggestionHeading = candidates.length ? "Vermutete Doubletten" : "";
  } else {
    candidates = state.contacts
      .filter((contact) => contact.id !== state.selectedContactId && mergeSearchText(contact).includes(query))
      .sort(compareContacts)
      .slice(0, 24);
  }

  if (!candidates.length) {
    dom.mergeResults.innerHTML = `<p class="merge-results-empty">${suggestionHeading ? "Keine Vorschläge gefunden." : query ? "Keine passenden Kontakte gefunden." : "Keine ähnlichen Namen erkannt. Mindestens drei Zeichen eingeben."}</p>`;
    dom.mergeSubmitButton.disabled = true;
    return;
  }

  dom.mergeResults.innerHTML = `${suggestionHeading ? `<p class="merge-results-label">${suggestionHeading}</p>` : ""}${renderMergeResultButtons(candidates)}`;
  dom.mergeSubmitButton.disabled = !state.mergeContactId || !state.contacts.some((contact) => contact.id === state.mergeContactId);
}

function openMergeDialog() {
  if (!isDesktopLayout() || !state.selectedContactId || state.contacts.length < 2) return;
  state.mergeContactId = "";
  dom.mergeSearchInput.value = "";
  renderMergeCandidates();
  openDialog(dom.mergeDialog);
  window.setTimeout(() => dom.mergeSearchInput.focus(), 50);
}

function closeMergeDialog() {
  state.mergeContactId = "";
  closeDialog(dom.mergeDialog);
}

async function deleteSelectedContact() {
  const contact = state.contacts.find((candidate) => candidate.id === state.selectedContactId);
  if (!contact || !window.confirm(`\"${contact.name}\" wirklich löschen?`)) return;

  const sourceHref = contact.sourceHref;
  let deleted = false;
  setContactOperationBusy(true);
  setSyncProgress(0, 0, "Kontakt wird gelöscht ...");
  try {
    const latestContact = await fetchFreshContact(contact);
    await requestCardDav("delete", { resource: sourceHref, etag: latestContact.etag });
    deleted = true;
    await synchronizeContacts(state.settings.collection);
    state.selectedContactId = "";
    state.editingContactId = "";
    setContactOperationBusy(false);
    showNotice(`Kontakt „${contact.name}“ gelöscht.`, "success");
    render();
  } catch (error) {
    if (deleted) {
      state.contacts = state.contacts.filter((candidate) => candidate.sourceHref !== sourceHref);
      state.alphabetLetter = "";
      state.visibleStart = 0;
      state.visibleCount = CONTACT_BATCH_SIZE;
      state.lastUpdated = new Date();
      await writeCache("contacts", {
        key: contactsCacheKey(state.settings.collection),
        contacts: state.contacts,
        syncedAt: state.lastUpdated.toISOString()
      });
      state.selectedContactId = "";
      state.editingContactId = "";
      setContactOperationBusy(false);
      showNotice(`Kontakt „${contact.name}“ gelöscht. Der nächste Sync aktualisiert den Serverstand.`, "warning");
      render();
      return;
    }
    setContactOperationBusy(false);
    showNotice(messageForError(error), "error");
  }
}

async function mergeContacts(primary, secondary) {
  let primarySaved = false;
  let secondaryDeleted = false;
  let mergedContact = null;
  setContactOperationBusy(true);
  setSyncProgress(0, 0, "Kontakte werden zusammengeführt ...");

  try {
    const [latestPrimary, latestSecondary] = await Promise.all([
      fetchFreshContact(primary),
      fetchFreshContact(secondary)
    ]);
    const values = mergeContactValues(latestPrimary, latestSecondary);
    const mergedBody = serializeEditedVCard(latestPrimary, values);
    mergedContact = parseVCard(mergedBody, primary.sourceHref);
    if (!mergedContact) throw new Error("Die zusammengeführte Kontaktkarte konnte nicht erstellt werden.");
    mergedContact.etag = latestPrimary.etag;

    await requestCardDav("put", {
      resource: primary.sourceHref,
      etag: latestPrimary.etag,
      body: mergedBody
    });
    primarySaved = true;
    await requestCardDav("delete", {
      resource: secondary.sourceHref,
      etag: latestSecondary.etag
    });
    secondaryDeleted = true;
    await synchronizeContacts(state.settings.collection);

    const updated = state.contacts.find((contact) => contact.sourceHref === primary.sourceHref);
    state.selectedContactId = updated ? updated.id : mergedContact.id;
    state.editingContactId = "";
    setContactOperationBusy(false);
    showNotice(`„${secondary.name}“ wurde mit „${primary.name}“ zusammengeführt.`, "success");
    render();
  } catch (error) {
    if (primarySaved && mergedContact) {
      state.contacts = uniqueContacts([
        ...state.contacts.filter((contact) => contact.sourceHref !== primary.sourceHref && (!secondaryDeleted || contact.sourceHref !== secondary.sourceHref)),
        mergedContact
      ]).sort(compareContacts);
      state.alphabetLetter = "";
      state.visibleStart = 0;
      state.visibleCount = CONTACT_BATCH_SIZE;
      state.lastUpdated = new Date();
      await writeCache("contacts", {
        key: contactsCacheKey(state.settings.collection),
        contacts: state.contacts,
        syncedAt: state.lastUpdated.toISOString()
      });
      state.selectedContactId = mergedContact.id;
      state.editingContactId = "";
      setContactOperationBusy(false);
      showNotice(
        secondaryDeleted
          ? "Zusammengeführt. Die Anzeige wurde lokal aktualisiert; der nächste Sync gleicht den Server ab."
          : "Der erste Kontakt wurde aktualisiert, aber der zweite konnte nicht gelöscht werden.",
        "warning"
      );
      render();
      return;
    }
    setContactOperationBusy(false);
    showNotice(messageForError(error), "error");
  }
}

async function saveEditedContact(form) {
  const contact = state.contacts.find((candidate) => candidate.id === state.editingContactId);
  if (!contact) return;
  const values = readContactEditValues(form, contact);
  if (!values.name) {
    showNotice("Der Kontakt braucht einen Namen.", "warning");
    return;
  }

  const saveButton = form.querySelector("#saveContactButton");
  const sourceHref = contact.sourceHref;
  saveButton.disabled = true;
  dom.detailSaveButton.disabled = true;
  dom.detailEditButton.disabled = true;
  state.syncing = true;
  dom.contactControls.dataset.connection = "syncing";
  dom.refreshButton.disabled = true;
  const hint = form.querySelector("#editFormHint");
  if (hint) hint.textContent = "Wird in CardDAV gespeichert ...";
  setSyncProgress(0, 0, "Kontakt wird gespeichert ...");

  try {
    const latestContact = await fetchFreshContact(contact);
    await requestCardDav("put", {
      resource: sourceHref,
      etag: latestContact.etag,
      body: serializeEditedVCard(latestContact, values)
    });
    await synchronizeContacts(state.settings.collection);
    const updated = state.contacts.find((candidate) => candidate.sourceHref === sourceHref);
    state.editingContactId = "";
    state.selectedContactId = updated ? updated.id : contact.id;
    state.syncing = false;
    hideNotice();
    render();
  } catch (error) {
    state.syncing = false;
    saveButton.disabled = false;
    dom.detailSaveButton.disabled = false;
    dom.detailEditButton.disabled = false;
    if (hint) hint.textContent = "Speichern fehlgeschlagen. Änderungen prüfen und erneut versuchen.";
    dom.refreshButton.disabled = state.loading || !state.settings.username || !state.settings.password;
    dom.contactControls.dataset.connection = state.connected ? "connected" : "idle";
    showNotice(messageForError(error), "error");
  }
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0][0] || ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
}

function phoneHref(value) {
  return value.replace(/[^0-9+*#,;pw]/gi, "");
}

function shortUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (_error) {
    return value;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function openSettings() {
  populateSettingsForm();
  openDialog(dom.settingsDialog);
  window.setTimeout(() => dom.serverInput.focus(), 50);
}

function showNotice(message, tone = "error") {
  dom.notice.dataset.tone = tone;
  dom.noticeText.textContent = message;
  dom.notice.hidden = false;
}

function hideNotice() {
  dom.notice.hidden = true;
}

function messageForError(error) {
  if (error.name === "AbortError") return "Der Server antwortet gerade nicht. Bitte versuche es erneut.";
  if (error.status === 401 || error.status === 403) return "Anmeldung abgelehnt. Bitte prüfe Benutzername und Passwort.";
  if (error.status === 404) return "CardDAV-Adresse nicht gefunden. Bitte prüfe die Server-Adresse.";
  if (error.status === 409 || error.status === 412) return "Der Kontakt wurde inzwischen auf dem Server geändert. Bitte zuerst synchronisieren.";
  if (error.message.includes("Failed to fetch")) return "Der Server ist nicht erreichbar. Prüfe die Verbindung und die HTTPS-Adresse.";
  return error.message || "Die Kontakte konnten nicht geladen werden.";
}

async function chooseBook(href) {
  const selected = state.books.find((book) => book.href === href);
  if (!selected) return;
  state.settings.collection = selected.href;
  persistSettings();
  state.choosingBook = false;
  state.loading = true;
  state.hasLoaded = false;
  state.contacts = [];
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  state.expandedContacts.clear();
  state.selectedContactId = "";
  state.editingContactId = "";
  state.mergeContactId = "";
  setSyncProgress(0, 0, `${selected.name} wird synchronisiert ...`);
  render();
  try {
    await loadContacts(selected.href);
    state.connected = true;
    state.hasLoaded = true;
    state.lastUpdated = new Date();
  } catch (error) {
    state.choosingBook = true;
    showNotice(messageForError(error), "error");
  } finally {
    state.loading = false;
    render();
  }
}

function showBooks() {
  if (state.books.length < 2) return;
  state.choosingBook = true;
  state.hasLoaded = false;
  state.contacts = [];
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  state.expandedContacts.clear();
  state.selectedContactId = "";
  state.editingContactId = "";
  state.mergeContactId = "";
  state.query = "";
  dom.searchInput.value = "";
  render();
}

async function logout() {
  await clearCache();
  localStorage.removeItem(STORAGE_KEY);
  state.settings = loadSettings();
  state.books = [];
  state.contacts = [];
  state.connected = false;
  state.choosingBook = false;
  state.hasLoaded = false;
  state.loading = false;
  state.query = "";
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  state.expandedContacts.clear();
  state.selectedContactId = "";
  state.editingContactId = "";
  state.mergeContactId = "";
  dom.searchInput.value = "";
  populateSettingsForm();
  showNotice("Abgemeldet. Die Zugangsdaten wurden von diesem Gerät entfernt.", "warning");
  render();
}

dom.settingsButton.addEventListener("click", openSettings);
dom.connectButton.addEventListener("click", openSettings);
dom.refreshButton.addEventListener("click", connect);
dom.logoutButton.addEventListener("click", logout);
dom.noticeCloseButton.addEventListener("click", hideNotice);
dom.searchTools.addEventListener("pointerenter", () => {
  dom.searchTools.classList.remove("is-dismissed");
});
dom.searchTools.addEventListener("pointerdown", () => {
  dom.searchTools.classList.remove("is-dismissed");
});
dom.searchTools.addEventListener("focusin", () => {
  dom.searchTools.classList.remove("is-dismissed");
});
dom.alphabetNav.addEventListener("pointerenter", () => {
  dom.searchTools.classList.remove("is-dismissed");
});
document.addEventListener("pointerdown", (event) => {
  if (!dom.searchTools.contains(event.target)) dom.searchTools.classList.add("is-dismissed");
});
dom.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.length >= 3 ? event.target.value : "";
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  render();
});
dom.clearSearchButton.addEventListener("click", () => {
  dom.searchInput.value = "";
  state.query = "";
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  dom.searchInput.focus();
  render();
});
dom.filterSelect.addEventListener("change", (event) => {
  state.filter = event.target.value;
  state.alphabetLetter = "";
  state.visibleStart = 0;
  state.visibleCount = CONTACT_BATCH_SIZE;
  render();
});
dom.alphabetNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-letter]");
  if (!button) return;
  dom.searchTools.classList.add("is-dismissed");
  jumpToLetter(button.dataset.letter);
});
dom.booksButton.addEventListener("click", showBooks);
dom.contactsList.addEventListener("click", (event) => {
  const header = event.target.closest(".contact-card-header");
  if (!header) return;
  const contactId = header.dataset.contactId;
  if (isDesktopLayout()) {
    state.selectedContactId = state.selectedContactId === contactId ? "" : contactId;
    state.editingContactId = "";
    updateDesktopSelection();
    return;
  } else {
    if (state.expandedContacts.has(contactId)) {
      state.expandedContacts.delete(contactId);
    } else {
      state.expandedContacts.add(contactId);
    }
  }
  render();
});
dom.detailEditButton.addEventListener("click", () => {
  const contact = state.contacts.find((candidate) => candidate.id === state.selectedContactId);
  if (!contact) return;
  state.editingContactId = state.editingContactId === contact.id ? "" : contact.id;
  renderDetailPane(contact);
});
dom.detailMergeButton.addEventListener("click", openMergeDialog);
dom.detailDeleteButton.addEventListener("click", () => void deleteSelectedContact());
dom.detailPaneContent.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-edit-row]");
  if (addButton) {
    const kind = addButton.dataset.addEditRow;
    const rows = dom.detailPaneContent.querySelector(`[data-edit-group="${kind}"]`);
    if (!rows) return;
    const index = Number(rows.dataset.nextRowId || rows.querySelectorAll("[data-edit-row]").length);
    rows.dataset.nextRowId = String(index + 1);
    rows.insertAdjacentHTML("beforeend", renderEditRow(kind, { value: "", label: "", parts: [] }, index));
    rows.lastElementChild.querySelector("[data-edit-value], [data-address-part=\"street\"]")?.focus();
    return;
  }

  const removeButton = event.target.closest("[data-remove-edit-row]");
  if (!removeButton) return;
  const row = removeButton.closest("[data-edit-row]");
  const rows = row?.parentElement;
  if (!row || !rows) return;
  if (rows.querySelectorAll("[data-edit-row]").length === 1) {
    row.querySelector("[data-edit-type]").value = "unknown";
    const valueInput = row.querySelector("[data-edit-value]");
    if (valueInput) {
      valueInput.value = "";
    } else {
      row.querySelectorAll("[data-address-part]").forEach((input) => {
        input.value = "";
      });
    }
    return;
  }
  row.remove();
});
dom.detailPaneContent.addEventListener("submit", (event) => {
  const form = event.target.closest("#contactEditForm");
  if (!form) return;
  event.preventDefault();
  void saveEditedContact(form);
});
dom.detailPaneCloseButton.addEventListener("click", () => {
  state.selectedContactId = "";
  state.editingContactId = "";
  updateDesktopSelection();
});
dom.mergeSearchInput.addEventListener("input", renderMergeCandidates);
dom.mergeResults.addEventListener("click", (event) => {
  const result = event.target.closest("[data-merge-contact-id]");
  if (!result) return;
  state.mergeContactId = result.dataset.mergeContactId;
  renderMergeCandidates();
});
dom.mergeCloseButton.addEventListener("click", closeMergeDialog);
dom.mergeCancelButton.addEventListener("click", closeMergeDialog);
dom.mergeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const primary = state.contacts.find((contact) => contact.id === state.selectedContactId);
  const secondary = state.contacts.find((contact) => contact.id === state.mergeContactId);
  if (!primary || !secondary) return;
  if (!window.confirm(`„${secondary.name}“ mit „${primary.name}“ zusammenführen und den zweiten Eintrag löschen?`)) return;
  closeMergeDialog();
  void mergeContacts(primary, secondary);
});
dom.booksList.addEventListener("click", (event) => {
  const bookButton = event.target.closest("[data-book-href]");
  if (bookButton) chooseBook(bookButton.dataset.bookHref);
});

dom.settingsCloseButton.addEventListener("click", () => closeDialog(dom.settingsDialog));
dom.settingsCancelButton.addEventListener("click", () => closeDialog(dom.settingsDialog));
dom.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const nextSettings = readSettingsForm();
    if (!nextSettings.username || !nextSettings.password) {
      throw new Error("Benutzername und Passwort werden benötigt.");
    }
    state.settings = nextSettings;
    persistSettings();
    state.books = [];
    state.contacts = [];
    state.connected = false;
    state.choosingBook = false;
    state.hasLoaded = false;
    state.lastUpdated = null;
    state.alphabetLetter = "";
    state.visibleStart = 0;
    state.visibleCount = CONTACT_BATCH_SIZE;
    state.expandedContacts.clear();
    state.selectedContactId = "";
    state.editingContactId = "";
    state.mergeContactId = "";
    closeDialog(dom.settingsDialog);
    await connect({ showBookSelection: true });
  } catch (error) {
    showNotice(error.message, "warning");
  }
});

dom.booksCloseButton.addEventListener("click", () => closeDialog(dom.booksDialog));
dom.booksCancelButton.addEventListener("click", () => closeDialog(dom.booksDialog));
dom.booksForm.addEventListener("submit", (event) => {
  event.preventDefault();
  chooseBook(dom.booksDialogSelect.value);
});

dom.installButton.addEventListener("click", async () => {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    dom.installButton.hidden = true;
    return;
  }
  openDialog(dom.installDialog);
});
dom.installCloseButton.addEventListener("click", () => closeDialog(dom.installDialog));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  dom.installButton.hidden = false;
});

function shouldShowIosInstall() {
  const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const standalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

function setupLoadMoreObserver() {
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreContacts();
    }, { rootMargin: "320px 0px" });
    observer.observe(dom.loadMoreSentinel);
    return;
  }

  window.addEventListener("scroll", () => {
    if (dom.loadMoreSentinel.hidden) return;
    if (dom.loadMoreSentinel.getBoundingClientRect().top <= window.innerHeight + 320) {
      loadMoreContacts();
    }
  }, { passive: true });
}

if (shouldShowIosInstall()) dom.installButton.hidden = false;

setupLoadMoreObserver();

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || (location.protocol !== "https:" && location.hostname !== "localhost")) return;

  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    await registration.update();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
    window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
  } catch (_error) {
    // The app remains usable when Safari temporarily denies service-worker updates.
  }
}

registerServiceWorker();

async function boot() {
  populateSettingsForm();
  render();

  if (!state.settings.username || !state.settings.password) {
    window.setTimeout(openSettings, 250);
    return;
  }

  const cachedBooks = await readCachedBooks();
  if (cachedBooks && cachedBooks.books && cachedBooks.books.length) {
    state.books = cachedBooks.books;
    state.connected = true;
    state.choosingBook = true;
    state.lastUpdated = cachedBooks.syncedAt ? new Date(cachedBooks.syncedAt) : null;
    populateBookSelect(dom.bookSelect, state.settings.collection);
    render();
    return;
  }

  await connect({ showBookSelection: true });
}

boot();
