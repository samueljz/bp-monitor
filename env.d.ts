/// <reference types="vite/client" />
/// <reference types="gapi" />
/// <reference types="gapi.client.drive-v3" />
/// <reference types="google.accounts" />

interface Window {
  gapi: typeof gapi;
  google: typeof google;
}
