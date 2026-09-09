// OneTrip Admin — rendering. Same full-teardown-and-rebuild pattern as the
// driver app (see onetrip-driver/js/app.js): one render() call clears and
// rebuilds whatever screen is current, no diffing.

const root = document.getElementById('app');

// 'signin' | 'loading' | 'truckList' | 'inspectionHistory' | 'error'
let currentScreen = 'signin';
let truckSummaries = [];
let selectedTruckNumber = null;
let inspectionHistory = [];
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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
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
    loadError = err.message || String(err);
    currentScreen = 'error';
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

function handleSelectInspection(inspection) {
  // Screen 3 (Inspection Detail) isn't built yet.
  console.log('Selected inspection', inspection);
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
