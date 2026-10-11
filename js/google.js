// Connexion Google (Google Identity Services, 100 % côté navigateur) + API Google Calendar
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'agenda.token';
const SEEN_KEY = 'agenda.signedin';

export class AuthError extends Error {}

let tokenClient = null;
let token = null;
let expires = 0;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

export const isConfigured = () => !CONFIG.GOOGLE_CLIENT_ID.startsWith('COLLER_ICI');
export const isSignedIn = () => !!token && expires > Date.now() + 30000;
export const wasSignedIn = () => store.get(SEEN_KEY) === '1';

export function loadStoredToken() {
  try {
    const t = JSON.parse(store.get(TOKEN_KEY));
    if (t && t.exp > Date.now() + 60000) { token = t.token; expires = t.exp; return true; }
  } catch { /* pas de jeton */ }
  return false;
}

function whenGIS() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function check() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - t0 > 10000) return reject(new AuthError('Google indisponible'));
      setTimeout(check, 100);
    })();
  });
}

// silent=true : tentative sans interface (renouvellement) ; peut échouer, l'app affiche alors le bouton de connexion.
export async function signIn(silent = false) {
  if (!isConfigured()) throw new AuthError('Client ID Google non configuré');
  await whenGIS();
  return new Promise((resolve, reject) => {
    tokenClient ||= google.accounts.oauth2.initTokenClient({ client_id: CONFIG.GOOGLE_CLIENT_ID, scope: SCOPE, callback: () => {} });
    tokenClient.callback = r => {
      if (r.error) return reject(new AuthError(r.error));
      token = r.access_token;
      expires = Date.now() + r.expires_in * 1000;
      store.set(TOKEN_KEY, JSON.stringify({ token, exp: expires }));
      store.set(SEEN_KEY, '1');
      resolve();
    };
    tokenClient.error_callback = e => reject(new AuthError(e.type || 'auth'));
    tokenClient.requestAccessToken({ prompt: silent ? 'none' : '' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; expires = 0;
  store.del(TOKEN_KEY); store.del(SEEN_KEY);
}

async function api(path, { method = 'GET', params = {}, body } = {}) {
  if (!isSignedIn()) await signIn(true);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { token = null; throw new AuthError('Session expirée'); }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Erreur Google (${res.status})`);
  return json;
}

const enc = encodeURIComponent;

export const insertCalendar = body => api('/calendars', { method: 'POST', body });

export async function listCalendars() {
  const r = await api('/users/me/calendarList', { params: { minAccessRole: 'reader', maxResults: 100 } });
  return r.items || [];
}

// Récupère tous les événements d'un calendrier sur une période (récurrences dépliées)
export async function listEvents(calId, { timeMin, timeMax, q, privateProp, max = 500 } = {}) {
  const items = [];
  let pageToken;
  do {
    const r = await api(`/calendars/${enc(calId)}/events`, {
      params: {
        timeMin, timeMax, q, pageToken,
        singleEvents: 'true', orderBy: 'startTime', maxResults: 250,
        privateExtendedProperty: privateProp,
      },
    });
    items.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken && items.length < max);
  return items;
}

export const insertEvent = (calId, body) => api(`/calendars/${enc(calId)}/events`, { method: 'POST', body });
export const patchEvent = (calId, id, body) => api(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'PATCH', body });
export const moveEvent = (calId, id, destination) => api(`/calendars/${enc(calId)}/events/${enc(id)}/move`, { method: 'POST', params: { destination } });
export const deleteEvent = (calId, id) => api(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'DELETE' });
