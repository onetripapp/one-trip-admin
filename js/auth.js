// OneTrip Admin — Google sign-in via Google Identity Services (GIS).
//
// Unlike the driver app (which never lets the browser touch Drive directly
// — every upload goes through a Cloud Run backend holding a company-
// controlled credential, see onetrip-driver/js/drive.js), this dashboard is
// pure read-only and talks to Drive straight from the signed-in reviewer's
// own Google account. That account needs to actually have view access to
// the "OneTrip Uploads" folder in Drive for any of this to return data —
// that's a one-time share done in Drive itself, not something this code
// can grant.

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const OAUTH_CLIENT_ID = '106361031303-a6k1h3mm7ua2iq1mhqg8j5l7bkqsjbgi.apps.googleusercontent.com';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

function getAccessToken() {
  return accessToken;
}

function initAuth(onSignedIn) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope: DRIVE_READONLY_SCOPE,
    callback: (response) => {
      if (response.error) {
        console.error('Google sign-in failed', response);
        showAuthError(response.error_description || response.error);
        return;
      }
      accessToken = response.access_token;
      // expires_in is seconds from now; back off 60s early so an in-flight
      // Drive call can't get rejected mid-request right at the boundary.
      tokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
      onSignedIn();
    },
  });
}

function signIn() {
  tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
}
