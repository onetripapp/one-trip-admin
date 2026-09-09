// OneTrip Admin — builds screen data by walking the Drive folder tree the
// driver app writes (see onetrip-drive-function/index.js):
//   "OneTrip Uploads" / "Trucks" / <TruckNumber> / <YYYY-MM> / <YYYY-MM-DD>_<DriverName> / inspection-data.json
//
// inspection-data.json field names (confirmed against onetrip-driver/js/
// state.js's buildInspectionExport, not guessed): truckNumber, driverName,
// date, certifiedAt, summary: { done, total }, failedItems: [...], stations.

const UPLOAD_ROOT_FOLDER_NAME = 'OneTrip Uploads';
const TRUCKS_FOLDER_NAME = 'Trucks';

// Folder names are YYYY-MM or YYYY-MM-DD_DriverName — the fixed-width date
// prefix means plain string sort already puts the most recent one first.
function mostRecentByName(folders) {
  if (folders.length === 0) return null;
  return folders.slice().sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))[0];
}

async function findTrucksFolderId() {
  const rootId = await findFolder(UPLOAD_ROOT_FOLDER_NAME);
  if (!rootId) {
    throw new Error(
      `Could not find the "${UPLOAD_ROOT_FOLDER_NAME}" folder in Drive — check that this Google account has been shared view access to it.`
    );
  }
  const trucksFolderId = await findFolder(TRUCKS_FOLDER_NAME, rootId);
  if (!trucksFolderId) {
    throw new Error(`Could not find the "${TRUCKS_FOLDER_NAME}" folder inside "${UPLOAD_ROOT_FOLDER_NAME}".`);
  }
  return trucksFolderId;
}

// Walks one truck folder down to its single most recent inspection and
// returns the parsed inspection-data.json for it, or null if the truck
// folder is empty/malformed (e.g. a stray folder with no inspections yet).
async function loadMostRecentInspectionForTruck(truckFolderId) {
  const monthFolders = await listChildFolders(truckFolderId);
  const latestMonth = mostRecentByName(monthFolders);
  if (!latestMonth) return null;

  const dayFolders = await listChildFolders(latestMonth.id);
  const latestDay = mostRecentByName(dayFolders);
  if (!latestDay) return null;

  const dataFile = await findFileInFolder(latestDay.id, 'inspection-data.json');
  if (!dataFile) return null;

  const inspectionData = await fetchFileJson(dataFile.id);
  return { inspectionData, folderId: latestDay.id };
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
