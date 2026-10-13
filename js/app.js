import { CONFIG } from './config.js';
import * as U from './util.js';
import { CATEGORIES, CAT_KEYS, guessCategory, icon } from './categories.js';
import * as G from './google.js';
import * as W from './weather.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = n => Math.round(n);

/* ---------- Préférences (locales uniquement) ---------- */
const prefs = (() => {
  const base = { hidden: [], calCat: {}, place: CONFIG.DEFAULT_PLACE };
  try { return { ...base, ...JSON.parse(localStorage.getItem('agenda.prefs')) }; } catch { return base; }
})();
const savePrefs = () => { try { localStorage.setItem('agenda.prefs', JSON.stringify(prefs)); } catch { /* ignoré */ } };

/* ---------- État ---------- */
const state = {
  view: 'day', date: U.startOfDay(new Date()), calendars: [],
  wx: null, wxKey: '', wxT: 0, renderId: 0, index: new Map(), searchQ: '',
};
const cache = new Map();
const clearCache = () => cache.clear();

/* ---------- Icônes d'interface ---------- */
const ic = {
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  star: '★',
};

/* ---------- Utilitaires UI ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}
function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
}
const closeSheet = () => { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; };

function setHead({ title, sub = '', nav = true, extra = '' }) {
  $('#head').innerHTML = `
    <div class="top">
      ${nav ? `<button class="ibtn" data-act="prev" aria-label="Précédent">${ic.left}</button>` : ''}
      <button class="ttl-box" ${nav ? 'data-act="goto" aria-label="Choisir une date"' : ''}><h1>${esc(title)}</h1>${nav ? `<div class="sub">${esc(sub)} ▾</div>` : ''}</button>
      ${nav ? `<button class="ibtn" data-act="next" aria-label="Suivant">${ic.right}</button>` : ''}
      <span class="sp"></span>
      <button class="ibtn" data-act="settings" aria-label="Réglages">${ic.gear}</button>
      <button class="ibtn plus" data-act="add" aria-label="Ajouter un événement">${ic.plus}</button>
    </div>${extra}`;
}

/* ---------- Calendriers et événements ---------- */
async function loadCalendars() {
  const items = await G.listCalendars();
  G.setHint(items.find(c => c.primary)?.id); // identifiant du calendrier principal = adresse Google, pour le renouvellement silencieux
  state.calendars = items.map(c => {
    const name = c.summaryOverride || c.summary;
    return {
      id: c.id, name, primary: !!c.primary,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer',
      guess: guessCategory(name) || 'autre',
      // Calendrier recevant les échéances des autres apps (abonnements, garanties…)
      echeances: name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('echeance'),
    };
  });
}
const visibleCals = () => state.calendars.filter(c => !prefs.hidden.includes(c.id));

// La description Google peut contenir du HTML (créée depuis Google Agenda) : on la convertit en texte brut, sans rien exécuter
function htmlToText(h) {
  if (!h) return '';
  const src = h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  return (new DOMParser().parseFromString(src, 'text/html').body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
const linkify = s => s.replace(/(https?:\/\/[^\s<]+)/g, '<a class="lnk" href="$1" target="_blank" rel="noopener">$1</a>');

function normalize(r, cal) {
  if (r.status === 'cancelled') return null;
  const dated = !!r.start?.date;
  const start = dated ? U.parseYmd(r.start.date) : new Date(r.start.dateTime);
  const end = dated ? U.parseYmd(r.end.date) : new Date(r.end.dateTime);
  // Événement horaire posé à minuit, sans durée ou en multiples de 24 h : traité comme une journée entière
  const span = end - start;
  const allDay = dated || (start.getHours() === 0 && start.getMinutes() === 0 && (span === 0 || span % 864e5 === 0));
  const title = r.summary || '(Sans titre)';
  const p = r.extendedProperties?.private || {};
  const cat = CATEGORIES[p.cat] ? p.cat : guessCategory(title) || prefs.calCat[cal.id] || cal.guess;
  let reminder = 'default';
  if (r.reminders && !r.reminders.useDefault) {
    const list = r.reminders.overrides || [];
    const o = list.find(x => x.method === 'popup') || list[0];
    reminder = o ? String(o.minutes) : 'none';
  }
  return {
    id: r.id, calId: cal.id, calName: cal.name, writable: cal.writable, title, allDay, start, end, cat,
    rawCat: CATEGORIES[p.cat] ? p.cat : '', fav: p.fav === '1', location: r.location || '',
    recurringEventId: r.recurringEventId || '', reminder, notes: htmlToText(r.description),
  };
}
const byStart = (a, b) => a.start - b.start || a.title.localeCompare(b.title);

async function perCalendar(fetcher, key, cals = visibleCals()) {
  const lists = await Promise.all(cals.map(async cal => {
    const k = `${key}|${cal.id}`;
    const hit = cache.get(k);
    if (hit && Date.now() - hit.t < 120000) return hit.v;
    try {
      const v = (await fetcher(cal)).map(r => normalize(r, cal)).filter(Boolean);
      cache.set(k, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (e instanceof G.AuthError) throw e;
      return []; // un calendrier en échec n'empêche pas d'afficher les autres
    }
  }));
  return lists.flat().sort(byStart);
}
const fetchEvents = (from, to) =>
  perCalendar(cal => G.listEvents(cal.id, { timeMin: from.toISOString(), timeMax: to.toISOString() }), `r|${+from}|${+to}`);
const fetchFavs = () =>
  perCalendar(cal => G.listEvents(cal.id, { timeMin: new Date().toISOString(), timeMax: U.addDays(new Date(), 400).toISOString(), privateProp: 'fav=1' }), 'fav');

// Échéances des 90 prochains jours dans le(s) calendrier(s) « Échéances »
const fetchEcheances = () =>
  perCalendar(cal => G.listEvents(cal.id, { timeMin: new Date().toISOString(), timeMax: U.addDays(new Date(), 90).toISOString() }),
    'ech', visibleCals().filter(c => c.echeances));

const onDay = (events, day) => {
  const end = U.addDays(day, 1);
  return events.filter(e => (e.start < end && e.end > day) || (+e.start === +e.end && e.start >= day && e.start < end));
};
const remember = ev => { const k = String(state.index.size); state.index.set(k, ev); return k; };

/* ---------- Météo ---------- */
async function ensureWeather() {
  const p = prefs.place, key = `${p.lat},${p.lon}`;
  if (state.wx && state.wxKey === key && Date.now() - state.wxT < 18e5) return;
  try { state.wx = await W.fetchWeather(p.lat, p.lon); state.wxKey = key; state.wxT = Date.now(); }
  catch { if (state.wxKey !== key) state.wx = null; }
}
const weatherFor = d => state.wx?.[U.ymd(d)];

/* ---------- Rendu ---------- */
async function render() {
  const id = ++state.renderId;
  state.index = new Map();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  try {
    const fn = { day: renderDay, week: renderWeek, month: renderMonth, fav: renderFav, search: renderSearch }[state.view];
    await fn(id);
  } catch (e) {
    if (id !== state.renderId) return;
    if (e instanceof G.AuthError) return reconnect('Session expirée, reconnecte-toi.');
    $('#view').innerHTML = `<div class="empty">Impossible de charger l'agenda.<br>${esc(e.message)}<br><button data-act="retry">Réessayer</button></div>`;
  }
}

/* --- Jour --- */
function freeRows(day, timed) {
  const today = new Date();
  if (day < U.startOfDay(today)) return timed.map(ev => ({ ev }));
  const wk = day.getDay() === 0 || day.getDay() === 6;
  const [h0, h1] = wk ? CONFIG.FREE.weekend : CONFIG.FREE.weekday;
  const ws = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h0);
  const we = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h1);
  const min = CONFIG.FREE.minMinutes * 60000;
  let cursor = ws;
  if (U.sameDay(day, today)) {
    const q = new Date(Math.ceil(+today / 9e5) * 9e5); // prochain quart d'heure
    if (q > cursor) cursor = q;
  }
  const rows = [];
  for (const ev of timed) {
    const s = ev.start < day ? day : ev.start;
    const gapEnd = s < we ? s : we;
    if (cursor < we && gapEnd - cursor >= min) rows.push({ free: true, start: cursor, end: gapEnd });
    rows.push({ ev });
    if (ev.end > cursor) cursor = ev.end;
  }
  if (we - cursor >= min) rows.push({ free: true, start: cursor, end: we });
  return rows;
}

async function renderDay(id) {
  const day = state.date, today = new Date();
  const [events] = await Promise.all([fetchEvents(day, U.addDays(day, 1)), ensureWeather()]);
  if (id !== state.renderId) return;

  const dayEvents = onDay(events, day);
  const allDay = dayEvents.filter(e => e.allDay);
  const timed = dayEvents.filter(e => !e.allDay);
  const w = weatherFor(day);
  const delta = U.daysBetween(today, day);
  const sub = delta === 0 ? "Aujourd'hui" : delta === 1 ? 'Demain' : delta === -1 ? 'Hier' : delta > 0 ? `Dans ${delta} jours` : `Il y a ${-delta} jours`;

  const parts = w ? ['matin', 'midi', 'soir'].filter(p => w.parts[p]).map(p =>
    `<span class="part">${p[0].toUpperCase() + p.slice(1)} <span>${W.emoji(w.parts[p].code)}</span>${round(w.parts[p].t)}°</span>`).join('') : '';
  setHead({
    title: U.cap(U.fmtDayLong(day)), sub,
    extra: `<div class="wrow">
      <button class="place" data-act="place">${w ? `<span class="wi">${W.emoji(w.code)}</span><b>${round(w.max)}°</b><span class="muted">${round(w.min)}°</span>` : ''}<span class="muted">${esc(prefs.place.name)}</span></button>
      <div class="parts">${parts}</div></div>`,
  });

  const pills = allDay.map(e => {
    const k = remember(e);
    return `<button class="pill" style="--c:var(--c-${e.cat})" data-ev="${k}">${icon(e.cat)}${esc(e.title)}</button>`;
  }).join('');

  const multiCal = visibleCals().length > 1; // le nom du calendrier n'a d'intérêt que s'il y en a plusieurs
  const rows = freeRows(day, timed).map(r => {
    if (r.free) {
      const mins = Math.round((r.end - r.start) / 60000);
      return `<button class="row free" data-free="${+r.start}|${+r.end}"><span>${U.fmtDur(mins)} libre</span><span class="rng">${U.fmtTime(r.start)} – ${U.fmtTime(r.end)}</span></button>`;
    }
    const e = r.ev, k = remember(e);
    const past = e.end < today;
    return `<button class="row ev${past ? ' past' : ''}" style="--c:var(--c-${e.cat})" data-ev="${k}">
      <span class="t">${e.start < day ? '→' : U.fmtTime(e.start)}</span><span class="ttl">${esc(e.title)}</span>${multiCal ? `<span class="cal">${esc(e.calName)}</span>` : ''}${e.fav ? `<span class="fv">${ic.star}</span>` : ''}<span class="ico">${icon(e.cat)}</span></button>`;
  }).join('');

  $('#view').innerHTML = `<div class="day">
    ${pills ? `<div class="allday">${pills}</div>` : ''}
    <div class="list">${rows || '<div class="empty">Rien de prévu<br><button data-act="add">Ajouter un événement</button></div>'}</div></div>`;
}

/* --- Semaine --- */
async function renderWeek(id) {
  const ws = U.startOfWeek(state.date), we = U.addDays(ws, 7);
  const [events] = await Promise.all([fetchEvents(ws, we), ensureWeather()]);
  if (id !== state.renderId) return;
  const last = U.addDays(ws, 6);
  setHead({ title: `${ws.getDate()} – ${last.getDate()} ${U.fmtMonth(last).split(' ')[0]}`, sub: String(last.getFullYear()) });

  const rows = Array.from({ length: 7 }, (_, i) => {
    const d = U.addDays(ws, i);
    const evs = onDay(events, d).sort((a, b) => (b.allDay - a.allDay) || byStart(a, b));
    const shown = evs.slice(0, 5).map(e => {
      const k = remember(e);
      return `<span class="chip" style="--c:var(--c-${e.cat})" data-ev="${k}">${icon(e.cat)}${e.allDay ? '' : U.fmtTime(e.start) + ' '}${esc(e.title)}</span>`;
    }).join('');
    const more = evs.length > 5 ? `<span class="chip more">+${evs.length - 5}</span>` : '';
    const w = weatherFor(d);
    const cls = [U.sameDay(d, new Date()) ? 'today' : '', [0, 6].includes(d.getDay()) ? 'we' : ''].join(' ');
    return `<button class="wk-row ${cls}" data-day="${U.ymd(d)}" ${evs.length ? '' : 'data-empty="1"'}>
      <div class="wd"><span>${U.fmtWeekday3(d)}</span><b>${d.getDate()}</b></div>
      <div class="chips">${shown}${more}</div>
      <div class="wx">${w ? `${W.emoji(w.code)} ${round(w.max)}°` : ''}</div></button>`;
  }).join('');
  $('#view').innerHTML = `<div class="week">${rows}</div>`;
}

/* --- Mois --- */
async function renderMonth(id) {
  const first = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
  const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + dim) / 7);
  const gs = U.startOfWeek(first), ge = U.addDays(gs, weeks * 7);
  const events = await fetchEvents(gs, ge);
  if (id !== state.renderId) return;
  setHead({ title: U.cap(U.fmtMonth(first)) });

  const dow = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(l => `<div class="dow">${l}</div>`).join('');
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = U.addDays(gs, i);
    const cats = [...new Set(onDay(events, d).map(e => e.cat))].slice(0, 5);
    const cls = [d.getMonth() !== first.getMonth() ? 'out' : '', U.sameDay(d, new Date()) ? 'today' : ''].join(' ');
    return `<button class="cell ${cls}" data-day="${U.ymd(d)}"><span class="n">${d.getDate()}</span>
      <span class="dots">${cats.map(c => `<i style="--c:var(--c-${c})"></i>`).join('')}</span></button>`;
  }).join('');
  const v = $('#view');
  v.innerHTML = `<div class="month" style="grid-template-rows:auto repeat(${weeks},1fr)">${dow}${cells}</div>`;
}

/* --- Favoris --- */
function countdown(d) {
  const n = U.daysBetween(new Date(), d);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n < 60) return `dans ${n} jours`;
  return `dans ${Math.round(n / 30)} mois`;
}
function itemHtml(e, right) {
  const k = remember(e);
  return `<button class="item" style="--c:var(--c-${e.cat})" data-ev="${k}">
    <span class="main"><b>${esc(e.title)}</b><small>${U.cap(U.fmtDayShortY(e.start))}${e.allDay ? '' : ' · ' + U.fmtTime(e.start)} · ${esc(e.calName)}</small></span>${right}</button>`;
}
const cdHtml = e => `<span class="cd${U.daysBetween(new Date(), e.start) <= 7 ? ' urgent' : ''}">${countdown(e.start)}</span>`;
async function renderFav(id) {
  const [favs, ech] = await Promise.all([fetchFavs(), fetchEcheances()]);
  if (id !== state.renderId) return;
  setHead({ title: 'À suivre', nav: false });
  const hasCal = state.calendars.some(c => c.echeances);
  const echBlock = hasCal
    ? `<div class="sec">Échéances · 90 jours</div>${ech.length ? ech.map(e => itemHtml(e, cdHtml(e))).join('') : '<div class="kv" style="padding:8px 0">Aucune échéance à venir.</div>'}`
    : `<div class="sec">Échéances</div><div class="kv" style="padding:8px 0">Aucun calendrier « Échéances ». Les autres apps (abonnements, garanties…) y déposeront leurs dates limites.<br><button class="lnk" data-act="mkcal">Créer le calendrier « Échéances »</button></div>`;
  const favBlock = `<div class="sec">Favoris</div>${favs.length ? favs.map(e => itemHtml(e, cdHtml(e))).join('') : '<div class="kv" style="padding:8px 0">Aucun favori. Ouvre un événement et touche ☆ pour le suivre ici.</div>'}`;
  $('#view').innerHTML = `<div class="stack">${echBlock}${favBlock}</div>`;
}

async function createEcheancesCalendar() {
  try {
    await G.insertCalendar({ summary: 'Échéances', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    await loadCalendars();
    clearCache(); closeSheet(); render();
    toast('Calendrier « Échéances » créé');
  } catch (e) { toast(e.message); }
}

/* --- Recherche --- */
async function renderSearch(id) {
  if (id !== state.renderId) return;
  setHead({ title: 'Recherche', nav: false, extra: `<input class="search" id="q" type="search" placeholder="Rechercher un événement" value="${esc(state.searchQ)}" autocomplete="off">` });
  $('#view').innerHTML = `<div class="stack" id="results"></div>`;
  if (state.searchQ) await runSearch(state.searchQ);
  else $('#results').innerHTML = '<div class="empty">Tape un mot du titre pour chercher dans tous tes calendriers.</div>';
}
async function runSearch(q) {
  const id = state.renderId;
  const box = $('#results');
  if (!box) return;
  const now = new Date();
  try {
    const events = await perCalendar(cal => G.listEvents(cal.id, {
      q, timeMin: U.addDays(now, -365).toISOString(), timeMax: U.addDays(now, 730).toISOString(), max: 100,
    }), `q|${q}`);
    if (id !== state.renderId || state.searchQ !== q) return;
    const upcoming = events.filter(e => e.end >= now), past = events.filter(e => e.end < now).reverse();
    const all = [...upcoming, ...past];
    box.innerHTML = all.length ? all.map(e => itemHtml(e, '')).join('') : '<div class="empty">Aucun résultat.</div>';
  } catch (e) {
    if (e instanceof G.AuthError) return reconnect('Session expirée, reconnecte-toi.');
    box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

/* ---------- Feuilles : détail, ajout, réglages, lieu ---------- */
const mapsLink = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const routeLink = q => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

// Rappels (notification) : minutes avant le début. Pour une journée entière, Google compte depuis minuit du jour J.
const REMINDERS_TIMED = [['default', 'Par défaut du calendrier'], ['none', 'Aucun'], ['0', "À l'heure de l'événement"], ['10', '10 min avant'], ['30', '30 min avant'], ['60', '1 h avant'], ['120', '2 h avant'], ['1440', '1 jour avant'], ['10080', '1 semaine avant']];
const REMINDERS_ALLDAY = [['default', 'Par défaut du calendrier'], ['none', 'Aucun'], ['900', 'La veille à 9h'], ['2340', '2 jours avant, à 9h'], ['9540', '1 semaine avant, à 9h']];
const reminderList = allDay => (allDay ? REMINDERS_ALLDAY : REMINDERS_TIMED);
function reminderLabel(v, allDay) {
  const hit = reminderList(allDay).find(([k]) => k === String(v));
  if (hit) return hit[0] === 'default' ? 'Par défaut' : hit[1];
  const m = +v;
  return m >= 1440 ? `${Math.round(m / 1440)} j avant` : `${U.fmtDur(m)} avant`;
}
function reminderOptions(allDay, current) {
  const list = [...reminderList(allDay)];
  if (!list.some(([k]) => k === String(current))) list.push([String(current), reminderLabel(current, allDay)]);
  return list.map(([k, l]) => `<option value="${k}" ${String(current) === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
const reminderBody = v => v === 'default' ? { useDefault: true }
  : v === 'none' ? { useDefault: false, overrides: [] }
  : { useDefault: false, overrides: [{ method: 'popup', minutes: +v }] };

const RECURRENCES = [
  ['', 'Ne se répète pas'], ['FREQ=DAILY', 'Tous les jours'], ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Du lundi au vendredi'],
  ['FREQ=WEEKLY', 'Toutes les semaines'], ['FREQ=WEEKLY;INTERVAL=2', 'Toutes les 2 semaines'],
  ['FREQ=MONTHLY', 'Tous les mois'], ['FREQ=YEARLY', 'Tous les ans'],
];
// Fin de récurrence au format RRULE : date seule (journée entière) ou fin de journée en UTC
function untilValue(dateStr, allDay) {
  if (allDay) return dateStr.replace(/-/g, '');
  return new Date(`${dateStr}T23:59:59`).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function openDetail(ev) {
  const when = ev.allDay
    ? U.cap(U.fmtDayLongY(ev.start))
    : `${U.cap(U.fmtDayLongY(ev.start))}<br>${U.fmtTime(ev.start)} – ${U.fmtTime(ev.end)}`;
  const addr = ev.location.replace(/\s+/g, ' ').trim();
  // Le lieu peut être un lien Maps déjà prêt (partage depuis l'app Maps) : on l'ouvre tel quel, sans le chercher comme une adresse
  const isUrl = /^https?:\/\/\S+$/i.test(addr);
  const place = addr ? `<br>📍 ${isUrl ? 'Lieu (lien Maps)' : esc(addr)}` : '';
  const mapBtns = !addr ? ''
    : isUrl ? `<div class="btns"><a class="secondary" href="${esc(addr)}" target="_blank" rel="noopener">Ouvrir dans Maps</a></div>`
    : `<div class="btns"><a class="secondary" href="${mapsLink(addr)}" target="_blank" rel="noopener">Voir sur Maps</a><a class="secondary" href="${routeLink(addr)}" target="_blank" rel="noopener">Itinéraire</a></div>`;
  openSheet(`<h2 style="color:var(--c-${ev.cat})">${icon(ev.cat)} <span style="color:var(--text)">${esc(ev.title)}</span></h2>
    <div class="kv"><b>${when}</b>${ev.recurringEventId ? '<br>↻ Événement récurrent' : ''}${place}
      <br>Calendrier : <b>${esc(ev.calName)}</b> · ${CATEGORIES[ev.cat].label}
      <br>Rappel : ${esc(reminderLabel(ev.reminder, ev.allDay))}</div>
    ${ev.notes ? `<div class="notes">${linkify(esc(ev.notes))}</div>` : ''}
    ${mapBtns}
    <div class="btns">
      <button class="secondary" id="d-fav" ${ev.writable ? '' : 'disabled'}>${ev.fav ? '★ Retirer des favoris' : '☆ Favori'}</button>
      <button class="secondary" id="d-edit" ${ev.writable ? '' : 'disabled'}>Modifier</button>
    </div>
    <div class="btns">
      <button class="secondary danger" id="d-del" ${ev.writable ? '' : 'disabled'}>Supprimer</button>
      <button class="secondary" data-act="close">Fermer</button>
    </div>`);
  $('#d-edit').onclick = () => {
    if (!ev.allDay && U.ymd(ev.start) !== U.ymd(ev.end)) return toast('Événement sur plusieurs jours : à modifier dans Google Agenda');
    openAdd({ ev });
  };
  $('#d-fav').onclick = async () => {
    try {
      await G.patchEvent(ev.calId, ev.id, { extendedProperties: { private: { fav: ev.fav ? '0' : '1' } } });
      clearCache(); closeSheet(); render();
      toast(ev.fav ? 'Retiré des favoris' : 'Ajouté aux favoris');
    } catch (e) { toast(e.message); }
  };
  const doDelete = async id => {
    try { await G.deleteEvent(ev.calId, id); clearCache(); closeSheet(); render(); toast('Événement supprimé'); }
    catch (e) { toast(e.message); }
  };
  const del = $('#d-del');
  del.onclick = () => {
    if (ev.recurringEventId) { // récurrent : on demande ce qu'il faut supprimer
      del.parentElement.innerHTML = '<button class="secondary danger" id="d-one">Cette occurrence</button><button class="secondary danger" id="d-all">Toute la série</button>';
      $('#d-one').onclick = () => doDelete(ev.id);
      $('#d-all').onclick = () => doDelete(ev.recurringEventId);
      return;
    }
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Confirmer la suppression'; return; }
    doDelete(ev.id);
  };
}

// Sans `ev` : création. Avec `ev` : modification.
function openAdd({ date = state.date, start = null, end = null, ev: editing = null } = {}) {
  const writable = state.calendars.filter(c => c.writable);
  const cals = editing && !writable.some(c => c.id === editing.calId) ? state.calendars.filter(c => c.id === editing.calId) : writable;
  if (!cals.length) return toast('Aucun calendrier modifiable');
  const now = new Date();
  let s = start;
  if (editing) s = editing.allDay ? new Date(editing.start.getFullYear(), editing.start.getMonth(), editing.start.getDate(), 9) : editing.start;
  if (!s) s = U.sameDay(date, now)
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
  let e = end ? new Date(Math.min(+end, +s + 36e5)) : new Date(+s + 36e5);
  if (editing && !editing.allDay) e = editing.end;
  const nDays = editing?.allDay ? Math.max(1, Math.round((editing.end - editing.start) / 864e5)) : 1;
  const isInstance = !!editing?.recurringEventId; // occurrence d'une série
  cals.sort((a, b) => b.primary - a.primary);
  const selCal = editing?.calId || (cals.some(c => c.id === prefs.lastCal) ? prefs.lastCal : cals[0].id);

  const cats = ['', ...CAT_KEYS].map(k => `<label class="cc"><input type="radio" name="cat" value="${k}" ${k === (editing?.rawCat || '') ? 'checked' : ''}>
    <span ${k ? `style="--c:var(--c-${k})"` : ''}>${k ? icon(k) + CATEGORIES[k].label : 'Auto'}</span></label>`).join('');
  const scope = isInstance ? `<div class="cats">
    <label class="cc"><input type="radio" name="scope" value="one" checked><span>Cette occurrence</span></label>
    <label class="cc"><input type="radio" name="scope" value="all"><span>Toute la série</span></label></div>
    <div class="kv">Pour « toute la série », seuls titre, lieu, rappel et catégorie sont modifiés.</div>` : '';
  const recurrence = editing ? '' : `<label>Répétition<select name="rec">${RECURRENCES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label id="untilrow" hidden>Jusqu'au (facultatif)<input type="date" name="until"></label>`;

  openSheet(`<form class="form" id="addf">
    <h2>${editing ? "Modifier l'événement" : 'Nouvel événement'}</h2>
    ${scope}
    <input name="title" placeholder="Titre" required autocomplete="off" value="${esc(editing?.title || '')}">
    <label>Calendrier${isInstance ? ' (non modifiable pour une série)' : ''}<select name="cal" ${isInstance ? 'disabled' : ''}>${cals.map(c => `<option value="${esc(c.id)}" ${c.id === selCal ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="frow"><label>Date<input type="date" name="date" value="${U.ymd(s)}" required></label></div>
    <label class="chk"><input type="checkbox" name="allday" ${editing?.allDay ? 'checked' : ''}> Journée entière</label>
    <div class="frow" id="times" ${editing?.allDay ? 'hidden' : ''}><label>Début<input type="time" name="st" value="${U.hhmm(s)}"></label><label>Fin<input type="time" name="et" value="${U.hhmm(e)}"></label></div>
    ${recurrence}
    <label>Lieu<input name="loc" placeholder="Adresse (lien Google Maps)" autocomplete="off" value="${esc(editing?.location || '')}"></label>
    <label>Commentaire<textarea name="notes" rows="3" placeholder="Notes, adresse précise si Maps ne connaît pas le lieu…">${esc(editing?.notes || '')}</textarea></label>
    <label>Rappel<select name="rem">${reminderOptions(!!editing?.allDay, editing?.reminder || 'default')}</select></label>
    <div class="cats">${cats}</div>
    <button class="primary" type="submit">${editing ? 'Enregistrer' : 'Ajouter'}</button>
  </form>`);
  const f = $('#addf');
  const label = editing ? 'Enregistrer' : 'Ajouter';
  f.allday.onchange = () => {
    $('#times').hidden = f.allday.checked;
    f.rem.innerHTML = reminderOptions(f.allday.checked, 'default'); // les choix diffèrent pour une journée entière
  };
  if (f.rec) f.rec.onchange = () => { $('#untilrow').hidden = !f.rec.value; };
  f.st.onchange = () => { // la fin suit le début en conservant la durée
    const dur = (new Date(`2000-01-01T${f.et.value}`) - new Date(`2000-01-01T${U.hhmm(s)}`)) || 36e5;
    s = new Date(`2000-01-01T${f.st.value}`);
    const ne = new Date(+s + Math.max(dur, 9e5));
    f.et.value = U.hhmm(ne);
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const d = f.date.value, cat = f.cat.value, loc = f.loc.value.trim();
    const scopeAll = isInstance && f.scope.value === 'all';
    const body = { summary: f.title.value.trim(), reminders: reminderBody(f.rem.value) };
    if (editing) body.location = loc || null; else if (loc) body.location = loc;
    // Commentaire : en modification, on ne réécrit la description que si le texte a changé (préserve la mise en forme d'origine)
    const notes = f.notes.value.trim();
    if (editing) { if (notes !== (editing.notes || '')) body.description = notes || null; } else if (notes) body.description = notes;
    // En modification, "Auto" supprime la catégorie forcée (null) ; en création, on n'écrit rien.
    if (cat) body.extendedProperties = { private: { cat } };
    else if (editing) body.extendedProperties = { private: { cat: null } };
    if (!scopeAll) {
      if (f.allday.checked) {
        body.start = { date: d, dateTime: null, timeZone: null };
        body.end = { date: U.ymd(U.addDays(U.parseYmd(d), nDays)), dateTime: null, timeZone: null };
      } else {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const a = new Date(`${d}T${f.st.value}`);
        let b = new Date(`${d}T${f.et.value}`);
        if (b <= a) b = new Date(+a + 36e5);
        body.start = { dateTime: a.toISOString(), timeZone: tz, date: null };
        body.end = { dateTime: b.toISOString(), timeZone: tz, date: null };
      }
    }
    if (f.rec?.value) {
      const until = f.until.value;
      if (until && until < d) return toast('La fin de répétition est avant le début');
      body.recurrence = [`RRULE:${f.rec.value}${until ? ';UNTIL=' + untilValue(until, f.allday.checked) : ''}`];
    }
    const btn = f.querySelector('.primary');
    btn.disabled = true; btn.textContent = editing ? 'Enregistrement…' : 'Ajout…';
    try {
      if (editing) {
        let calId = editing.calId;
        if (!isInstance && f.cal.value !== editing.calId) { // changement de calendrier
          await G.moveEvent(editing.calId, editing.id, f.cal.value);
          calId = f.cal.value;
        }
        await G.patchEvent(calId, scopeAll ? editing.recurringEventId : editing.id, body);
      } else {
        prefs.lastCal = f.cal.value; savePrefs();
        await G.insertEvent(f.cal.value, body);
      }
      clearCache(); closeSheet();
      if (!scopeAll) state.date = U.startOfDay(U.parseYmd(d));
      if (state.view === 'fav' || state.view === 'search') state.view = 'day';
      render(); toast(editing ? 'Événement modifié' : 'Événement ajouté');
    } catch (err) { btn.disabled = false; btn.textContent = label; toast(err.message); }
  };
  if (!editing) f.title.focus();
}

// Aller directement à une date (année, mois, jour) via le sélecteur natif du téléphone
function openGoto() {
  openSheet(`<h2>Aller à une date</h2>
    <div class="form"><label>Date<input type="date" id="g-date" value="${U.ymd(state.date)}"></label></div>
    <div class="btns">
      <button class="secondary" id="g-prev">− 1 an</button>
      <button class="secondary" id="g-today">Aujourd'hui</button>
      <button class="secondary" id="g-next">+ 1 an</button>
    </div>
    <button class="primary" id="g-go">Afficher</button>`);
  const input = $('#g-date');
  const go = d => {
    state.date = state.view === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1) : U.startOfDay(d);
    if (state.view === 'fav' || state.view === 'search') state.view = 'day';
    closeSheet(); render();
  };
  const shiftYear = n => { const d = U.parseYmd(input.value || U.ymd(state.date)); input.value = U.ymd(new Date(d.getFullYear() + n, d.getMonth(), d.getDate())); };
  $('#g-prev').onclick = () => shiftYear(-1);
  $('#g-next').onclick = () => shiftYear(1);
  $('#g-today').onclick = () => go(new Date());
  $('#g-go').onclick = () => input.value && go(U.parseYmd(input.value));
}

function openSettings() {
  const rows = state.calendars.map((c, i) => {
    const cur = prefs.calCat[c.id] || '';
    return `<div class="calrow"><input type="checkbox" data-cal="${i}" ${prefs.hidden.includes(c.id) ? '' : 'checked'}><span>${esc(c.name)}</span>
      <select data-calcat="${i}"><option value="">Auto</option>${CAT_KEYS.map(k => `<option value="${k}" ${cur === k ? 'selected' : ''}>${CATEGORIES[k].label}</option>`).join('')}</select></div>`;
  }).join('');
  openSheet(`<h2>Réglages</h2>
    <div class="sec">Calendriers affichés</div>${rows}
    <div class="sec">Lieu de la météo</div>
    <button class="secondary" data-act="place">${esc(prefs.place.name)} — changer</button>
    <div class="sec">Compte</div>
    <button class="secondary danger" id="s-out">Se déconnecter</button>
    <button class="secondary" data-act="close">Fermer</button>`);
  const sheet = $('#sheet-body');
  sheet.onchange = e => {
    const t = e.target;
    if (t.dataset.cal != null) {
      const id = state.calendars[t.dataset.cal].id;
      prefs.hidden = t.checked ? prefs.hidden.filter(x => x !== id) : [...prefs.hidden, id];
    } else if (t.dataset.calcat != null) {
      const id = state.calendars[t.dataset.calcat].id;
      if (t.value) prefs.calCat[id] = t.value; else delete prefs.calCat[id];
    } else return;
    savePrefs(); clearCache(); render();
  };
  $('#s-out').onclick = () => { G.signOut(); closeSheet(); showLogin(); };
}

function openPlace() {
  openSheet(`<h2>Lieu de la météo</h2>
    <button class="secondary" id="p-geo">📍 Utiliser ma position</button>
    <form class="form" id="p-form"><input id="p-q" type="search" placeholder="Rechercher une ville" autocomplete="off"></form>
    <div id="p-res"></div>
    <button class="secondary" data-act="close">Fermer</button>`);
  const setPlace = p => { prefs.place = p; savePrefs(); closeSheet(); render(); toast(`Météo : ${p.name}`); };
  $('#p-geo').onclick = async () => {
    try { setPlace(await W.currentPosition()); } catch (e) { toast(e.message); }
  };
  $('#p-form').onsubmit = async ev => {
    ev.preventDefault();
    const res = await W.searchPlaces($('#p-q').value.trim());
    const box = $('#p-res');
    box.innerHTML = res.length ? res.map((p, i) => `<button class="res" data-pi="${i}">${esc(p.name)}</button>`).join('') : '<div class="kv">Aucun résultat</div>';
    box.onclick = e => { const b = e.target.closest('[data-pi]'); if (b) setPlace(res[b.dataset.pi]); };
  };
}

/* ---------- Navigation ---------- */
function shift(dir) {
  const d = state.date;
  if (state.view === 'day') state.date = U.addDays(d, dir);
  else if (state.view === 'week') state.date = U.addDays(d, 7 * dir);
  else if (state.view === 'month') state.date = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  else return;
  render();
}

document.addEventListener('click', e => {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  if (act) {
    if (act === 'prev') shift(-1);
    else if (act === 'next') shift(1);
    else if (act === 'goto') openGoto();
    else if (act === 'mkcal') createEcheancesCalendar();
    else if (act === 'add') openAdd();
    else if (act === 'settings') openSettings();
    else if (act === 'place') openPlace();
    else if (act === 'close') closeSheet();
    else if (act === 'retry') render();
    return;
  }
  if (t.id === 'sheet') return closeSheet();
  const tab = t.closest('[data-view]');
  if (tab) {
    const same = state.view === tab.dataset.view;
    state.view = tab.dataset.view;
    if (same && ['day', 'week', 'month'].includes(state.view)) state.date = U.startOfDay(new Date()); // re-toucher l'onglet actif ramène à aujourd'hui
    if (state.view === 'month') state.date = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    render(); return;
  }
  const ev = t.closest('[data-ev]');
  if (ev) return openDetail(state.index.get(ev.dataset.ev));
  const free = t.closest('[data-free]');
  if (free) { const [a, b] = free.dataset.free.split('|').map(Number); return openAdd({ date: state.date, start: new Date(a), end: new Date(b) }); }
  const day = t.closest('[data-day]');
  if (day) {
    state.date = U.parseYmd(day.dataset.day);
    // Semaine : un jour vide ouvre directement l'ajout, un jour rempli ouvre la vue Jour
    if (state.view === 'week' && day.dataset.empty) return openAdd({ date: state.date });
    state.view = 'day'; render();
  }
});

let searchTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQ = e.target.value.trim();
    if (state.searchQ) runSearch(state.searchQ);
    else $('#results').innerHTML = '<div class="empty">Tape un mot du titre pour chercher dans tous tes calendriers.</div>';
  }, 350);
});

// Balayage gauche/droite pour changer de jour, semaine ou mois
let tx = 0, ty = 0;
$('#view').addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$('#view').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 45) shift(dx < 0 ? 1 : -1);
}, { passive: true });

// Session expirée : renouvellement silencieux (redirection Google) si possible, sinon bouton de connexion
function reconnect(msg) {
  if (G.wasSignedIn() && G.canTrySilent()) { G.markSilentTry(); G.redirectSignIn(); return; }
  showLogin(msg);
}

// Au retour sur l'app, on rafraîchit (ou on renouvelle la connexion si le jeton a expiré entre-temps)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !$('#sheet').hidden || !$('#login').hidden) return;
  if (!G.isSignedIn()) { if (G.wasSignedIn()) reconnect('Session expirée, reconnecte-toi.'); return; }
  clearCache();
  if (U.sameDay(state.date, new Date(Date.now() - 864e5))) state.date = U.startOfDay(new Date());
  render();
});

/* ---------- Connexion et démarrage ---------- */
function showLogin(msg) {
  $('#login').hidden = false;
  closeSheet();
  if (!G.isConfigured()) $('#login-msg').textContent = "Client ID Google non configuré : voir README.md (js/config.js).";
  else if (msg) $('#login-msg').textContent = msg;
}

async function start() {
  await loadCalendars();
  $('#login').hidden = true;
  render();
}

$('#login-btn').onclick = async () => {
  try { await G.signIn(false); await start(); }
  catch (e) { $('#login-msg').textContent = e.message === 'popup_closed' ? 'Connexion annulée.' : `Connexion impossible (${e.message}).`; }
};

(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!G.isConfigured()) return showLogin();
  const back = G.consumeRedirect(); // retour de la page Google après un renouvellement silencieux
  if (G.loadStoredToken()) {
    try { return await start(); } catch { /* retombe sur l'écran de connexion */ }
  } else if (G.wasSignedIn() && !back) {
    return reconnect(); // jeton expiré : on tente de le renouveler sans rien demander
  }
  showLogin(back?.error ? 'Connexion à renouveler : appuie sur le bouton.' : undefined);
})();
