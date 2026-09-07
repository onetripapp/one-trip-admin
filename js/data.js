// OneTrip Admin — builds the Truck List screen's data by walking the Drive
// folder tree the driver app writes (see onetrip-drive-function/index.js):
//   "OneTrip Uploads" / "Trucks" / <TruckNumber> / <YYYY-MM> / <YYYY-MM-DD>_<DriverName> / inspection-data.json

const UPLOAD_ROOT_FOLDER_NAME = 'OneTrip Uploads';
const TRUCKS_FOLDER_NAME = 'Trucks';

// Folder names are YYYY-MM or YYYY-MM-DD_DriverName — the fixed-width date
// prefix means plain string sort already puts the most recent one first.
function mostRecentByName(folders) {
  if (folders.length === 0) return null;
  return folders.slice().sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))[0];
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
