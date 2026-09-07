// OneTrip Admin — rendering. Same full-teardown-and-rebuild pattern as the
// driver app (see onetrip-driver/js/app.js): one render() call clears and
// rebuilds whatever screen is current, no diffing.

const root = document.getElementById('app');

let currentScreen = 'signin'; // 'signin' | 'loading' | 'truckList' | 'error'
let truckSummaries = [];
let loadError = null;

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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

async function loadTruckList() {
  currentScreen = 'loading';
  render();
  try {
    truckSummaries = await loadTruckListSummaries();
    currentScreen = 'truckList';
  } catch (err) {
    console.error('Failed to load truck list', err);
    loadError = err.message || String(err);
    currentScreen = 'error';
  }
  render();
}

function handleSignIn() {
  signIn();
}

function handleSignOut() {
  signOut();
  truckSummaries = [];
  currentScreen = 'signin';
  render();
}

function handleRetry() {
  loadTruckList();
}

function handleSelectTruck(truckNumber) {
  // Screen 2 (Inspection History) isn't built yet.
  console.log('Selected truck', truckNumber);
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
