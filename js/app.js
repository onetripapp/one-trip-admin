// OneTrip Admin — rendering. Same full-teardown-and-rebuild pattern as the
// driver app (see onetrip-driver/js/app.js): one render() call clears and
// rebuilds whatever screen is current, no diffing.

const root = document.getElementById('app');

// 'signin' | 'loading' | 'truckList' | 'inspectionHistory' | 'inspectionDetail' | 'baselineComparison' | 'noAccess' | 'error'
let currentScreen = 'signin';
let truckSummaries = [];
let selectedTruckNumber = null;
let inspectionHistory = [];
let selectedInspection = null;
let inspectionDetailData = null; // { inspectionData, folderId, fileIdByName } — see loadInspectionDetail()
let baselineData = null; // { manifest, truckNumber } — manifest is null when this truck has no baseline set at all
let loadError = null;

// Whichever load is currently in flight, so the error screen's Retry
// button re-runs the thing that actually failed instead of always
// bouncing back to the truck list.
let pendingRetry = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function render() {
  root.textContent = '';
  if (currentScreen === 'signin') root.appendChild(renderSignIn());
  else if (currentScreen === 'loading') root.appendChild(renderLoading());
  else if (currentScreen === 'error') root.appendChild(renderError());
  else if (currentScreen === 'truckList') root.appendChild(renderTruckList());
  else if (currentScreen === 'inspectionHistory') root.appendChild(renderInspectionHistory());
  else if (currentScreen === 'inspectionDetail') root.appendChild(renderInspectionDetail());
  else if (currentScreen === 'baselineComparison') root.appendChild(renderBaselineComparison());
  else if (currentScreen === 'noAccess') root.appendChild(renderNoAccess());
}

function renderSignIn() {
  return el('div', { class: 'signin-screen' }, [
    el('h1', { class: 'app-title' }, 'OneTrip Admin'),
    el('p', { class: 'app-subtitle' }, 'Sign in with a Google account that has view access to the OneTrip Uploads Drive folder.'),
    el('button', { class: 'btn-primary', onClick: handleSignIn }, 'Sign in with Google'),
  ]);
}

function renderLoading() {
  return el('div', { class: 'loading-screen' }, [el('p', {}, 'Loading inspections…')]);
}

function renderError() {
  return el('div', { class: 'error-screen' }, [
    el('p', { class: 'error-text' }, loadError || 'Something went wrong.'),
    el('button', { class: 'btn-secondary', onClick: handleRetry }, 'Retry'),
  ]);
}

// A known, specific state (see NoDriveAccessError's own comment in
// data.js) — not a generic error, so it gets its own screen rather than
// routing through renderError(): the same neutral app-title/app-subtitle
// styling the sign-in screen itself uses, not the red error-text tone,
// since nothing is actually broken here. "Retry" would be misleading (the
// same account will just fail the same way again) — the one useful action
// is switching accounts, so that's what's offered instead.
function renderNoAccess() {
  return el('div', { class: 'error-screen' }, [
    el('h1', { class: 'app-title' }, 'No Access Yet'),
    el(
      'p',
      { class: 'app-subtitle' },
      "You're signed in, but this Google account doesn't have access to OneTrip's Drive data yet. Contact Dan to get view access to the shared folder."
    ),
    el('button', { class: 'btn-primary', onClick: handleSignOut }, 'Sign Out & Try a Different Account'),
  ]);
}

function renderTruckList() {
  const header = el('header', { class: 'page-header' }, [
    el('h1', { class: 'app-title' }, 'Trucks'),
    el('button', { class: 'btn-text', onClick: handleSignOut }, 'Sign out'),
  ]);

  if (truckSummaries.length === 0) {
    return el('div', { class: 'truck-list-screen' }, [header, el('p', { class: 'empty-state' }, 'No inspections found yet.')]);
  }

  const columnHeaders = el('div', { class: 'truck-list-columns' }, [
    el('span', {}, 'Truck'),
    el('span', {}, 'Last Inspection'),
    el('span', {}, 'Driver'),
    el('span', {}, 'Status'),
  ]);

  const rows = truckSummaries.map((truck) => {
    const isClean = truck.failedCount === 0;
    return el('button', { class: 'truck-row', onClick: () => handleSelectTruck(truck.truckNumber) }, [
      el('span', { class: 'truck-row-number' }, truck.truckNumber),
      el('span', { class: 'truck-row-date' }, formatDate(truck.date)),
      el('span', { class: 'truck-row-driver' }, truck.driverName),
      el(
        'span',
        { class: `status-badge ${isClean ? 'status-clean' : 'status-defect'}` },
        isClean ? 'Clean' : `${truck.failedCount} Defect${truck.failedCount === 1 ? '' : 's'}`
      ),
    ]);
  });

  return el('div', { class: 'truck-list-screen' }, [header, columnHeaders, el('div', { class: 'truck-list' }, rows)]);
}

function renderInspectionHistory() {
  const header = el('header', { class: 'page-header' }, [
    el('div', { class: 'header-titles' }, [
      el('button', { class: 'btn-text back-link', onClick: handleBackToTruckList }, '← Trucks'),
      el('h1', { class: 'app-title' }, `Truck ${selectedTruckNumber}`),
    ]),
    el('button', { class: 'btn-text', onClick: handleSignOut }, 'Sign out'),
  ]);

  if (inspectionHistory.length === 0) {
    return el('div', { class: 'truck-list-screen' }, [header, el('p', { class: 'empty-state' }, 'No inspections found for this truck.')]);
  }

  const columnHeaders = el('div', { class: 'history-columns' }, [
    el('span', {}, 'Date'),
    el('span', {}, 'Driver'),
    el('span', {}, 'Certified'),
    el('span', {}, 'Checked'),
    el('span', {}, 'Status'),
  ]);

  const rows = inspectionHistory.map((inspection) => {
    const isClean = inspection.failedCount === 0;
    return el('button', { class: 'history-row', onClick: () => handleSelectInspection(inspection) }, [
      el('span', { class: 'history-row-date' }, formatDate(inspection.date)),
      el('span', { class: 'history-row-driver' }, inspection.driverName),
      el('span', { class: 'history-row-certified' }, formatCertifiedAt(inspection.certifiedAt)),
      el('span', { class: 'history-row-checked' }, `${inspection.doneCount} / ${inspection.totalCount}`),
      el(
        'span',
        { class: `status-badge ${isClean ? 'status-clean' : 'status-defect'}` },
        isClean ? 'Clean' : `${inspection.failedCount} Defect${inspection.failedCount === 1 ? '' : 's'}`
      ),
    ]);
  });

  return el('div', { class: 'truck-list-screen' }, [header, columnHeaders, el('div', { class: 'truck-list' }, rows)]);
}

function renderInspectionDetail() {
  const { inspectionData, fileIdByName } = inspectionDetailData;
  const failedItems = Array.isArray(inspectionData.failedItems) ? inspectionData.failedItems : [];
  const summary = inspectionData.summary || {};

  const header = el('header', { class: 'page-header' }, [
    el('div', { class: 'header-titles' }, [
      el('button', { class: 'btn-text back-link', onClick: handleBackToHistory }, `← Truck ${selectedTruckNumber}`),
      el('h1', { class: 'app-title' }, formatDate(inspectionData.date)),
    ]),
    el('button', { class: 'btn-text', onClick: handleSignOut }, 'Sign out'),
  ]);

  const meta = el(
    'p',
    { class: 'app-subtitle' },
    `${inspectionData.driverName} — certified ${formatCertifiedAt(inspectionData.certifiedAt)}`
  );

  // "Defects Found" means still-open defects, not the raw historical
  // failedItems count — onetrip-mechanic can resolve a failed sub-item
  // since this inspection was certified, and a fully-repaired truck should
  // read as caught-up here too, consistent with the same still-open count
  // the Truck List and Inspection History screens now use (see
  // countUnresolvedFailures in data.js). The full historical list — open
  // AND resolved — still renders below in renderFailedItemsSummary; this
  // stat is deliberately just the at-a-glance "is there still something to
  // do" number.
  const openDefectCount = countUnresolvedFailures(inspectionData);

  const statsRow = el('div', { class: 'detail-stats-row' }, [
    el('div', { class: 'detail-stat' }, [
      el('span', { class: 'detail-stat-value' }, `${summary.done ?? 0} / ${summary.total ?? 0}`),
      el('span', { class: 'detail-stat-label' }, 'Items Checked'),
    ]),
    el('div', { class: 'detail-stat' }, [
      el(
        'span',
        { class: `detail-stat-value${openDefectCount > 0 ? ' detail-stat-value-defect' : ''}` },
        String(openDefectCount)
      ),
      el('span', { class: 'detail-stat-label' }, 'Defects Found'),
    ]),
  ]);

  const actionsRow = el('div', { class: 'detail-actions-row' }, [
    el('button', { class: 'btn-secondary', onClick: handleOpenSummaryFile }, 'View Raw Summary (.txt)'),
    el('button', { class: 'btn-secondary', onClick: handleCompareToBaseline }, 'Compare to Baseline'),
  ]);

  const sections = [header, meta, statsRow, actionsRow];

  // Flagged items surface at the very top, same as inspection-summary.txt's
  // own defect list — nobody should have to scroll a 20+ station breakdown
  // to find out what actually failed.
  if (failedItems.length > 0) {
    sections.push(renderFailedItemsSummary(failedItems, inspectionData));
  } else {
    sections.push(el('p', { class: 'detail-clean-banner' }, `No defects found — ${summary.done ?? 0}/${summary.total ?? 0} passed`));
  }

  for (const group of groupStationsByZone(inspectionData.stations)) {
    sections.push(renderZoneSection(group, fileIdByName));
  }

  return el('div', { class: 'truck-list-screen' }, sections);
}

// `failedItems` is the driver app's own snapshot from certification time —
// preserved and shown in full here regardless of what's since been
// resolved (the point is a complete history, not just "what's still
// wrong"). Each entry is checked against its live `stations[].subItems[]`
// counterpart (via findResolutionForFailedItem in data.js) to see whether
// onetrip-mechanic has since certified it fixed.
function renderFailedItemsSummary(failedItems, inspectionData) {
  const rows = failedItems.map((item) => ({ item, resolution: findResolutionForFailedItem(inspectionData, item) }));
  const openCount = rows.filter((r) => !r.resolution).length;
  const allResolved = openCount === 0;

  const wrap = el('div', { class: `fail-summary${allResolved ? ' fail-summary-all-resolved' : ''}` });

  let heading;
  if (allResolved) {
    heading = `${failedItems.length} Item${failedItems.length === 1 ? '' : 's'} Flagged — All Resolved`;
  } else if (openCount === failedItems.length) {
    heading = `${failedItems.length} Item${failedItems.length === 1 ? '' : 's'} Flagged`;
  } else {
    heading = `${openCount} of ${failedItems.length} Flagged Item${failedItems.length === 1 ? '' : 's'} Still Open`;
  }
  wrap.appendChild(el('h2', { class: 'fail-summary-title' }, heading));

  const list = el('div', { class: 'fail-summary-list' });
  for (const { item, resolution } of rows) {
    const hasValue = item.value !== null && item.value !== undefined && item.value !== '';
    const valueText = hasValue ? ` (${formatValueWithUnit(item.value, item.unit)})` : '';
    const row = el('div', { class: `fail-summary-row${resolution ? ' fail-summary-row-resolved' : ''}` }, [
      el('span', { class: 'fail-summary-station' }, `Station ${item.stationId} — ${item.zoneName}`),
      el('span', { class: 'fail-summary-label' }, `${item.label}${valueText}`),
    ]);
    if (resolution) row.appendChild(renderResolutionNote(resolution));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

// Shared by both the top-of-page fail-summary and the full per-station
// breakdown below — same resolution object shape either way (see
// countUnresolvedFailures/findResolutionForFailedItem's own comments in
// data.js for where it comes from).
function renderResolutionNote(resolution) {
  const detailParts = [`Fixed by ${resolution.fixedBy || 'unknown'} on ${formatDate(resolution.fixedDate)}`];
  if (resolution.repairNotes) detailParts.push(resolution.repairNotes);
  return el('div', { class: 'resolution-note' }, [
    el('span', { class: 'status-badge status-clean' }, 'RESOLVED'),
    el('span', { class: 'resolution-note-text' }, detailParts.join(' — ')),
  ]);
}

function renderZoneSection(group, fileIdByName) {
  const section = el('section', { class: 'zone-section' });
  section.appendChild(el('h2', { class: 'zone-heading' }, group.zoneName));
  for (const station of group.stations) {
    section.appendChild(renderStationDetail(station, fileIdByName));
  }
  return section;
}

function renderStationDetail(station, fileIdByName) {
  const card = el('div', { class: 'station-detail-card' });
  card.appendChild(el('div', { class: 'station-detail-label' }, `Station ${station.id} — ${station.label}`));

  if (station.photoCaptured && station.photoFilename) {
    card.appendChild(renderStationPhoto(fileIdByName, station.photoFilename));
  }

  const subList = el('div', { class: 'station-detail-subitems' });
  for (const si of station.subItems || []) {
    subList.appendChild(renderSubItemDetail(si));
  }
  card.appendChild(subList);

  return card;
}

const SUBITEM_STATUS_BADGE_CLASS = { pass: 'status-clean', fail: 'status-defect', na: 'status-na' };

function renderSubItemDetail(subItem) {
  const isFail = subItem.status === 'fail';
  const isResolved = isFail && !!subItem.resolution;
  const rowModifierClass = isResolved ? 'subitem-detail-resolved' : isFail ? 'subitem-detail-fail' : '';

  // Station 11's air-brake readings are the clearest case (the number IS
  // the finding — "40 sec", "130 psi"), but any sub-item with a recorded
  // value gets the same treatment, not just Station 11 — tread depth, PSI,
  // and the DOT-number text value all carry a value worth showing too.
  const hasValue = subItem.value !== null && subItem.value !== undefined && subItem.value !== '';
  const valueText = hasValue ? `: ${formatValueWithUnit(subItem.value, subItem.unit)}` : '';

  const badgeClass = isResolved ? 'status-clean' : SUBITEM_STATUS_BADGE_CLASS[subItem.status] || 'status-na';
  const badgeText = isResolved ? 'RESOLVED' : subItem.status ? subItem.status.toUpperCase() : 'N/R';

  const main = el('div', { class: 'subitem-detail-main' }, [
    el('span', { class: 'subitem-detail-label' }, `${subItem.label}${valueText}`),
    el('span', { class: `status-badge ${badgeClass}` }, badgeText),
  ]);

  const children = isResolved ? [main, renderResolutionNote(subItem.resolution)] : [main];
  return el('div', { class: `subitem-detail-row${rowModifierClass ? ' ' + rowModifierClass : ''}` }, children);
}

// Looked up synchronously (fileIdByName came from one listFilesInFolder
// call for the whole inspection, made once in loadInspectionDetail — not a
// separate Drive query per station); only the actual byte fetch is async,
// filled in after the placeholder renders, same lazy-load pattern the
// driver app itself uses for its own stored photos.
function renderStationPhoto(fileIdByName, photoFilename) {
  const fileId = fileIdByName[photoFilename];
  const wrap = el('div', { class: 'station-photo-wrap' });

  if (!fileId) {
    wrap.appendChild(el('div', { class: 'station-photo-unavailable' }, 'Photo unavailable'));
    return wrap;
  }

  const img = el('img', { class: 'station-photo', alt: 'Station photo' });
  wrap.appendChild(img);

  fetchFileBlob(fileId)
    .then((blob) => {
      img.src = URL.createObjectURL(blob);
    })
    .catch((err) => {
      console.error('Failed to load station photo', photoFilename, err);
      wrap.textContent = '';
      wrap.appendChild(el('div', { class: 'station-photo-unavailable' }, 'Photo unavailable'));
    });

  return wrap;
}

// Screen 4: Baseline Comparison. Baseline photos are zone-level (one wide
// shot per zone, not per station — see fetchBaselineManifest's own comment
// in data.js), so each zone section shows its one baseline photo ONCE,
// alongside every station photo from that zone stacked next to it — not a
// baseline repeated per station, which would misrepresent a single
// zone-wide shot as if it were several different per-station baselines.
function renderBaselineComparison() {
  const { inspectionData, fileIdByName } = inspectionDetailData;
  const { manifest, truckNumber } = baselineData;

  const header = el('header', { class: 'page-header' }, [
    el('div', { class: 'header-titles' }, [
      el('button', { class: 'btn-text back-link', onClick: handleBackToDetailFromBaseline }, `← ${formatDate(inspectionData.date)}`),
      el('h1', { class: 'app-title' }, 'Baseline Comparison'),
    ]),
    el('button', { class: 'btn-text', onClick: handleSignOut }, 'Sign out'),
  ]);

  const meta = el(
    'p',
    { class: 'app-subtitle' },
    `Truck ${truckNumber} — ${inspectionData.driverName} — This inspection: ${formatDate(inspectionData.date)}`
  );

  const sections = [header, meta];

  if (!manifest) {
    sections.push(
      el(
        'p',
        { class: 'empty-state' },
        `No baseline photo set on file for truck ${truckNumber} yet — showing this inspection's photos with nothing to compare them against.`
      )
    );
  }

  // Phase 3's "In-Cab" stations were never part of the baseline system to
  // begin with (see ZONE_NAME_TO_NUMBER's comment in data.js) — that's not
  // a "missing baseline" case the way a truck with no manifest is, so it's
  // excluded entirely here rather than showing a permanent, never-
  // resolvable "no baseline" note for stations that were never going to
  // have one.
  const zoneGroups = groupStationsByZone(inspectionData.stations).filter((g) => g.zoneName !== 'In-Cab');

  let anyZoneShown = false;
  for (const group of zoneGroups) {
    const stationsWithPhotos = group.stations.filter((s) => s.photoCaptured && s.photoFilename);
    if (stationsWithPhotos.length === 0) continue;
    anyZoneShown = true;
    sections.push(renderBaselineZoneSection(group, stationsWithPhotos, truckNumber, manifest, fileIdByName, inspectionData));
  }

  if (!anyZoneShown) {
    sections.push(el('p', { class: 'empty-state' }, 'No exterior station photos to compare for this inspection.'));
  }

  return el('div', { class: 'truck-list-screen' }, sections);
}

function renderBaselineZoneSection(group, stationsWithPhotos, truckNumber, manifest, fileIdByName, inspectionData) {
  const section = el('section', { class: 'zone-section' });
  section.appendChild(el('h2', { class: 'zone-heading' }, group.zoneName));

  const grid = el('div', { class: 'baseline-zone-grid' });

  const zoneNumber = ZONE_NAME_TO_NUMBER[group.zoneName];
  const baselineFilename = zoneNumber && manifest && manifest.zones ? manifest.zones[String(zoneNumber)] : null;

  const baselineCol = el('div', { class: 'baseline-photo-col' });
  baselineCol.appendChild(el('div', { class: 'baseline-photo-label' }, 'Baseline'));
  if (baselineFilename) {
    baselineCol.appendChild(
      el('img', {
        class: 'station-photo',
        src: baselineImageUrl(truckNumber, baselineFilename),
        alt: `${group.zoneName} baseline`,
      })
    );
  } else {
    baselineCol.appendChild(el('div', { class: 'station-photo-unavailable' }, 'No baseline photo for this zone'));
  }
  grid.appendChild(baselineCol);

  const inspectionCol = el('div', { class: 'inspection-photo-col' });
  for (const station of stationsWithPhotos) {
    const photoBlock = el('div', { class: 'baseline-inspection-photo' });
    photoBlock.appendChild(
      el('div', { class: 'baseline-photo-label' }, `Station ${station.id} — This Inspection (${formatDate(inspectionData.date)})`)
    );
    photoBlock.appendChild(renderStationPhoto(fileIdByName, station.photoFilename));
    inspectionCol.appendChild(photoBlock);
  }
  grid.appendChild(inspectionCol);

  section.appendChild(grid);
  return section;
}

// Opens inspection-summary.txt in a new tab. The window has to open
// synchronously, right here in the click handler — opening it only after
// the file has been fetched (i.e. after an await) is exactly the pattern
// browsers' popup blockers target, since by then the click that authorized
// it has already finished.
async function handleOpenSummaryFile() {
  const folderId = inspectionDetailData.folderId;
  const win = window.open('', '_blank');
  const setContent = (text) => {
    if (!win) return;
    win.document.title = 'Inspection Summary';
    win.document.body.style.margin = '0';
    win.document.body.style.padding = '24px';
    win.document.body.style.fontFamily = 'monospace';
    win.document.body.style.whiteSpace = 'pre-wrap';
    win.document.body.textContent = text;
  };

  setContent('Loading summary…');
  try {
    const file = await findFileInFolder(folderId, 'inspection-summary.txt');
    if (!file) throw new Error("inspection-summary.txt was not found in this inspection's folder.");
    const text = await fetchFileText(file.id);
    setContent(text);
  } catch (err) {
    console.error('Failed to load summary file', err);
    const message = `Could not load the summary file: ${err.message || err}`;
    if (win) setContent(message);
    else alert(message);
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

// Same rule onetrip-driver's own formatValueWithUnit uses (js/state.js) —
// "40 sec"/"120 psi" read better with a space, but a symbol-led unit like
// the tread-depth `/32"` reads better without one ("4/32""). Matching it
// here keeps a value's on-screen formatting identical to how the same
// number was already written in the source app and in inspection-
// summary.txt, rather than introducing a second, slightly different style.
function formatValueWithUnit(value, unit) {
  if (!unit) return String(value);
  return /^[a-zA-Z]/.test(unit) ? `${value} ${unit}` : `${value}${unit}`;
}

function formatCertifiedAt(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Runs an async load, showing the loading screen while it's in flight and
// the error screen (with a working Retry) if it throws. `onSuccess` only
// runs when the load actually succeeds, and is responsible for setting
// `currentScreen` to wherever the data should land.
async function runLoad(loadFn, onSuccess) {
  pendingRetry = () => runLoad(loadFn, onSuccess);
  currentScreen = 'loading';
  render();
  try {
    const result = await loadFn();
    onSuccess(result);
  } catch (err) {
    console.error('Load failed', err);
    // NoDriveAccessError is the one failure this app can confidently
    // explain in plain language (see its own comment in data.js) — every
    // other failure (network errors, a since-deleted truck folder,
    // malformed JSON, Drive being temporarily down) stays on the existing
    // generic error screen with Retry, rather than guessing at a more
    // specific message than the code can actually back up.
    if (err instanceof NoDriveAccessError) {
      currentScreen = 'noAccess';
    } else {
      loadError = err.message || String(err);
      currentScreen = 'error';
    }
  }
  render();
}

function loadTruckList() {
  runLoad(loadTruckListSummaries, (result) => {
    truckSummaries = result;
    currentScreen = 'truckList';
  });
}

function handleSignIn() {
  signIn();
}

function handleSignOut() {
  signOut();
  truckSummaries = [];
  selectedTruckNumber = null;
  inspectionHistory = [];
  selectedInspection = null;
  inspectionDetailData = null;
  baselineData = null;
  currentScreen = 'signin';
  render();
}

function handleRetry() {
  if (pendingRetry) pendingRetry();
}

function handleSelectTruck(truckNumber) {
  selectedTruckNumber = truckNumber;
  runLoad(
    () => loadInspectionHistoryForTruck(truckNumber),
    (result) => {
      inspectionHistory = result;
      currentScreen = 'inspectionHistory';
    }
  );
}

function handleBackToTruckList() {
  currentScreen = 'truckList';
  render();
}

function handleBackToHistory() {
  currentScreen = 'inspectionHistory';
  render();
}

function handleSelectInspection(inspection) {
  selectedInspection = inspection;
  runLoad(
    () => loadInspectionDetail(inspection.folderId),
    (result) => {
      inspectionDetailData = result;
      currentScreen = 'inspectionDetail';
    }
  );
}

function handleCompareToBaseline() {
  runLoad(
    () => fetchBaselineManifest(selectedTruckNumber),
    (manifest) => {
      baselineData = { manifest, truckNumber: selectedTruckNumber };
      currentScreen = 'baselineComparison';
    }
  );
}

function handleBackToDetailFromBaseline() {
  currentScreen = 'inspectionDetail';
  render();
}

function showAuthError(message) {
  loadError = message;
  currentScreen = 'error';
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  initAuth(loadTruckList);
  render();
});
