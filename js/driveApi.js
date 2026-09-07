// OneTrip Admin — thin wrapper over the Drive v3 REST API.
//
// Deliberately plain fetch() against the REST endpoints rather than the
// `googleapis` npm client the backend uses (see onetrip-drive-function/
// index.js) — this is a static site with no build step, so no npm
// dependency can exist here at all.

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

class DriveApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

async function driveFetch(path, params = {}) {
  const url = new URL(`${DRIVE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveApiError(`Drive API ${path} failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }
  return res;
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Finds a folder by name, optionally scoped to a parent. When parentId is
// omitted this searches anywhere the signed-in account can see (owned or
// shared with it) — that's how the "OneTrip Uploads" root gets found even
// though it lives in a different Google account and was only ever shared
// with the reviewer, never placed under their own Drive root.
async function findFolder(name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name = '${escapeDriveQueryValue(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  const res = await driveFetch('/files', { q, fields: 'files(id, name)', spaces: 'drive', pageSize: 10 });
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  return data.files[0].id;
}

// Lists every immediate child folder of a parent (used to enumerate truck
// folders, then month folders, then date_driver folders).
async function listChildFolders(parentId) {
  const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  let files = [];
  let pageToken;
  do {
    const res = await driveFetch('/files', {
      q,
      fields: 'nextPageToken, files(id, name)',
      spaces: 'drive',
      pageSize: 200,
      pageToken,
    });
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

// Finds a single named file inside a folder (used for inspection-data.json
// and inspection-summary.txt).
async function findFileInFolder(parentId, name) {
  const q = `'${parentId}' in parents and name = '${escapeDriveQueryValue(name)}' and trashed = false`;
  const res = await driveFetch('/files', { q, fields: 'files(id, name)', spaces: 'drive', pageSize: 1 });
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  return data.files[0];
}

// Lists every non-folder file inside a folder — used for station photos on
// the detail screen later.
async function listFilesInFolder(parentId) {
  const q = `'${parentId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
  let files = [];
  let pageToken;
  do {
    const res = await driveFetch('/files', {
      q,
      fields: 'nextPageToken, files(id, name, mimeType)',
      spaces: 'drive',
      pageSize: 200,
      pageToken,
    });
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

async function fetchFileText(fileId) {
  const res = await driveFetch(`/files/${fileId}`, { alt: 'media' });
  return res.text();
}

async function fetchFileJson(fileId) {
  const text = await fetchFileText(fileId);
  return JSON.parse(text);
}
