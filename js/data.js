// OneTrip Admin — builds screen data by walking the Drive folder tree the
// driver app writes (see onetrip-drive-function/index.js):
//   <root> / "Trucks" / <TruckNumber> / <YYYY-MM> / <YYYY-MM-DD>_<DriverName> / inspection-data.json
//
// inspection-data.json field names (confirmed against onetrip-driver/js/
// state.js's buildInspectionExport, not guessed): truckNumber, driverName,
// date, certifiedAt, summary: { done, total }, failedItems: [...], stations.
//
// The root is a literal folder ID, not a name lookup, and it must stay in
// sync with UPLOAD_ROOT_FOLDER_ID in onetrip-drive-function/index.js — this
// dashboard only ever reads what the backend writes. This is the backend's
// second root: it narrowed its own Drive OAuth scope to `drive.file`, which
// can only see folders it created itself, so it created a fresh root rather
// than reusing the old one a human had made by hand. The old root (still
// named "OneTrip Uploads", same as this one was before this change) still
// exists in Drive with all of Dan's pre-2026-09-11 history — untouched, but
// deliberately not read by this app anymore. That's a data continuity
// tradeoff made on purpose (beta data only, not worth a migration), not an
// oversight — a human can still open it directly in Drive if ever needed.
// Note the name collision this creates: a Drive account with view access
// to both roots would see two folders both named "OneTrip Uploads" — this
// hardcoded ID is exactly what keeps that ambiguity from ever mattering
// here, so don't revert to a by-name lookup without re-solving that.
const UPLOAD_ROOT_FOLDER_ID = '1bYVmVsOJU7Rb12akZwSQlEk-YZyFcpfV';
const TRUCKS_FOLDER_NAME = 'Trucks';

// Folder names are YYYY-MM or YYYY-MM-DD_DriverName — the fixed-width date
// prefix means plain string sort already puts the most recent one first.
function sortFoldersByNameDesc(folders) {
  return folders.slice().sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

// A parsed inspection-data.json only counts as a real, certified inspection
// if it actually has these — guards against stray/malformed test artifacts
// left over in Drive from earlier backend testing (e.g. an empty or
// partial JSON file that isn't a real inspection at all).
function looksLikeRealInspection(inspectionData) {
  return !!(inspectionData && inspectionData.date && inspectionData.driverName && inspectionData.certifiedAt);
}

async function findTrucksFolderId() {
  const trucksFolderId = await findFolder(TRUCKS_FOLDER_NAME, UPLOAD_ROOT_FOLDER_ID);
  if (!trucksFolderId) {
    throw new Error(
      `Could not find the "${TRUCKS_FOLDER_NAME}" folder inside the OneTrip Uploads root — check that this Google account has been shared view access to it (folder ID ${UPLOAD_ROOT_FOLDER_ID}).`
    );
  }
  return trucksFolderId;
}

// Walks one truck folder down to its single most recent REAL inspection,
// skipping past any malformed/stray folder along the way (falls back to
// the next most recent day, then the next most recent month) rather than
// surfacing garbage just because it happened to sort first by name.
async function loadMostRecentInspectionForTruck(truckFolderId) {
  const monthFolders = sortFoldersByNameDesc(await listChildFolders(truckFolderId));

  for (const monthFolder of monthFolders) {
    const dayFolders = sortFoldersByNameDesc(await listChildFolders(monthFolder.id));

    for (const dayFolder of dayFolders) {
      const dataFile = await findFileInFolder(dayFolder.id, 'inspection-data.json');
      if (!dataFile) continue;

      const inspectionData = await fetchFileJson(dataFile.id);
      if (!looksLikeRealInspection(inspectionData)) continue;

      return { inspectionData, folderId: dayFolder.id };
    }
  }

  return null;
}

// Fetches every truck's most recent inspection and returns a flat, sorted
// summary list for the Truck List screen.
//
// Sort rule: trucks whose most recent inspection has open defects come
// first (most recently-dated defect first), then clean trucks (most recent
// first) — so a truck with a fresh defect never gets buried under an
// alphabetically-earlier truck number that happens to be clean.
async function loadTruckListSummaries() {
  const trucksFolderId = await findTrucksFolderId();
  const truckFolders = await listChildFolders(trucksFolderId);

  const summaries = [];
  for (const truckFolder of truckFolders) {
    const result = await loadMostRecentInspectionForTruck(truckFolder.id);
    if (!result) continue;
    const { inspectionData } = result;
    const failedCount = Array.isArray(inspectionData.failedItems) ? inspectionData.failedItems.length : 0;
    summaries.push({
      truckNumber: inspectionData.truckNumber || truckFolder.name,
      date: inspectionData.date,
      driverName: inspectionData.driverName,
      failedCount,
    });
  }

  summaries.sort((a, b) => {
    const aHasDefect = a.failedCount > 0;
    const bHasDefect = b.failedCount > 0;
    if (aHasDefect !== bHasDefect) return aHasDefect ? -1 : 1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  return summaries;
}

// Finds one truck's own folder under Trucks — needed to walk every
// inspection it has ever had, not just the most recent one (which is all
// the Truck List screen needs).
async function findTruckFolderId(truckNumber) {
  const trucksFolderId = await findTrucksFolderId();
  const truckFolderId = await findFolder(truckNumber, trucksFolderId);
  if (!truckFolderId) {
    throw new Error(`Could not find a Drive folder for truck "${truckNumber}".`);
  }
  return truckFolderId;
}

// A single inspection's sort key — certifiedAt is a full ISO timestamp
// (more precise than date alone, which matters if a truck were ever
// inspected twice in the same day), falling back to date for the
// vanishingly unlikely case of a record with no certifiedAt at all.
function inspectionSortKey(inspection) {
  return inspection.certifiedAt || inspection.date || '';
}

// Fetches every inspection ever recorded for one truck, most recent first.
async function loadInspectionHistoryForTruck(truckNumber) {
  const truckFolderId = await findTruckFolderId(truckNumber);
  const monthFolders = await listChildFolders(truckFolderId);

  const inspections = [];
  for (const monthFolder of monthFolders) {
    const dayFolders = await listChildFolders(monthFolder.id);
    for (const dayFolder of dayFolders) {
      const dataFile = await findFileInFolder(dayFolder.id, 'inspection-data.json');
      if (!dataFile) continue;

      const inspectionData = await fetchFileJson(dataFile.id);
      if (!looksLikeRealInspection(inspectionData)) continue;

      inspections.push({
        date: inspectionData.date,
        driverName: inspectionData.driverName,
        certifiedAt: inspectionData.certifiedAt,
        doneCount: inspectionData.summary ? inspectionData.summary.done : 0,
        totalCount: inspectionData.summary ? inspectionData.summary.total : 0,
        failedCount: Array.isArray(inspectionData.failedItems) ? inspectionData.failedItems.length : 0,
        folderId: dayFolder.id,
      });
    }
  }

  inspections.sort((a, b) => {
    const ak = inspectionSortKey(a);
    const bk = inspectionSortKey(b);
    return ak < bk ? 1 : ak > bk ? -1 : 0;
  });

  return inspections;
}

// inspection-data.json's `stations` object is keyed by station ID ("1a",
// "1-door", "10", "11", ...) — but plain object/JSON key order can NOT be
// trusted to reflect the real walk order: JS enumerates any key that looks
// like a plain integer ("10", "11", "12") before any non-integer string key
// ("1a", "1-door"), regardless of insertion order. Left uncorrected, Phase
// 3's stations 10/11/12 would render before Phase 1 even starts. Parsing
// each ID's own leading number (matching this app's own "3b" / "11-air-
// build-rate" station-ID convention — see onetrip-driver/js/data.js) and
// sorting on [number, suffix] sidesteps that entirely, without needing to
// duplicate the driver app's actual zone/station table over here.
function stationSortKey(stationId) {
  const match = /^(\d+)(.*)$/.exec(stationId);
  if (!match) return [Infinity, stationId];
  return [parseInt(match[1], 10), match[2]];
}

function sortedStationEntries(stationsObj) {
  return Object.entries(stationsObj).sort((a, b) => {
    const [aNum, aSuffix] = stationSortKey(a[0]);
    const [bNum, bSuffix] = stationSortKey(b[0]);
    if (aNum !== bNum) return aNum - bNum;
    return aSuffix < bSuffix ? -1 : aSuffix > bSuffix ? 1 : 0;
  });
}

// Groups stations into zones in true walk order, using each station's own
// `zoneName` field (already in the JSON) to detect where one zone's run of
// stations ends and the next begins — no separate zone-order table needed.
function groupStationsByZone(stationsObj) {
  const entries = sortedStationEntries(stationsObj || {});
  const groups = [];
  let current = null;
  for (const [stationId, station] of entries) {
    if (!current || current.zoneName !== station.zoneName) {
      current = { zoneName: station.zoneName, stations: [] };
      groups.push(current);
    }
    current.stations.push({ id: stationId, ...station });
  }
  return groups;
}

// Fetches one specific inspection's full detail record — the data Screen 2
// doesn't carry (per-station zone/subitem breakdown, plus every filename
// actually sitting in that inspection's Drive folder, needed for the
// station photos). `listFilesInFolder` was already built for exactly this
// second part (see its own comment in driveApi.js) — one call up front,
// then a plain name lookup per station, instead of a separate Drive query
// per photo.
async function loadInspectionDetail(folderId) {
  const dataFile = await findFileInFolder(folderId, 'inspection-data.json');
  if (!dataFile) {
    throw new Error("inspection-data.json was not found in this inspection's folder — the record may be incomplete.");
  }

  const inspectionData = await fetchFileJson(dataFile.id);
  if (!looksLikeRealInspection(inspectionData)) {
    throw new Error('This inspection record looks incomplete or corrupted (missing date, driver, or certification info).');
  }

  const folderFiles = await listFilesInFolder(folderId);
  const fileIdByName = {};
  for (const f of folderFiles) fileIdByName[f.name] = f.id;

  return { inspectionData, folderId, fileIdByName };
}

// Baseline reference photos live as static files in the DRIVER app's own
// public repo — NOT in Drive at all (the original spec assumed Drive; that
// was confirmed wrong before building this). Confirmed directly against
// onetrip-driver/js/baselineReference.js and assets/baseline-photos/
// <truck>/manifest.json: one wide-angle "gold standard" photo per ZONE
// (not per station — a zone with several stations shares a single
// baseline shot), named "<truck>-zone<N>-<slug>.jpg" and keyed by zone
// number in manifest.json. Fetched via GitHub's raw-content CDN since the
// repo is public — no auth, no Drive involvement for these specifically,
// and no new exposure (the photos are already public on GitHub regardless
// of what this app does).
//
// Cross-repo coupling risk, called out explicitly rather than left
// implicit: if onetrip-driver ever renames/moves assets/baseline-photos/
// or changes its manifest.json shape, this breaks silently until someone
// updates both repos together. There is no way to avoid that risk
// entirely without duplicating driver-repo logic here in a way that could
// ALSO drift — fetching the manifest at runtime (rather than hardcoding a
// copy of its contents) at least means a baseline-photo *update* on the
// driver side shows up here automatically, with no redeploy needed.
const BASELINE_PHOTOS_REPO_RAW_BASE = 'https://raw.githubusercontent.com/onetripapp/onetrip-driver/main/assets/baseline-photos';

// MUST MATCH onetrip-driver/js/data.js's own PHASE1_ZONES/PHASE2_ZONES
// zoneName strings exactly, and the zone numbering onetrip-driver/js/
// baselineReference.js + each truck's manifest.json use. The baseline
// system only ever covers these 9 exterior/engine-bay zones by design
// (confirmed in that file's own comment) — Phase 3's "In-Cab" zoneName has
// no zone number and is deliberately absent here; callers should treat
// "In-Cab" as categorically excluded from baseline comparison, not as a
// "baseline missing" case.
const ZONE_NAME_TO_NUMBER = {
  'Driver-Side Engine Bay': 1,
  'Passenger-Side Engine Bay': 2,
  'Front of Truck': 3,
  'Back Half Truck / Front Trailer, Driver Side': 4,
  'Rear of Truck (Fifth Wheel / Truck Rear Lights)': 5,
  'Passenger Side': 6,
  'Driver-Side Rear of Trailer': 7,
  'Absolute Rear of Trailer': 8,
  'Passenger-Side Rear of Trailer': 9,
};

// Returns null when this truck simply has no baseline set at all yet
// (manifest.json 404s — true for every truck except 826016 today). Callers
// should treat that the same as "no baseline for any zone" — a real,
// expected state, not an error. Any other fetch failure (network error,
// non-404 failure) propagates normally so runLoad()'s existing error
// screen handles it.
async function fetchBaselineManifest(truckNumber) {
  const url = `${BASELINE_PHOTOS_REPO_RAW_BASE}/${encodeURIComponent(truckNumber)}/manifest.json`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load the baseline photo manifest for truck ${truckNumber} (${res.status}).`);
  return res.json();
}

function baselineImageUrl(truckNumber, filename) {
  return `${BASELINE_PHOTOS_REPO_RAW_BASE}/${encodeURIComponent(truckNumber)}/${encodeURIComponent(filename)}`;
}
