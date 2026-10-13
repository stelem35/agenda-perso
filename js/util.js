export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// Semaine commençant le lundi
export const startOfWeek = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);

const p2 = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const hhmm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const fr = o => new Intl.DateTimeFormat('fr-FR', o);
export const fmtDayLong = d => fr({ weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const fmtDayShort = d => fr({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
// Avec l'année : détail d'un événement, résultats de recherche, favoris et échéances (qui peuvent tomber d'une année à l'autre)
export const fmtDayLongY = d => fr({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const fmtDayShortY = d => fr({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
export const fmtMonth = d => fr({ month: 'long', year: 'numeric' }).format(d);
export const fmtWeekday3 = d => fr({ weekday: 'short' }).format(d).replace('.', '');
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const fmtTime = d => (d.getMinutes() ? `${d.getHours()}h${p2(d.getMinutes())}` : `${d.getHours()}h`);
export const fmtDur = min => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${p2(m)}` : `${h}h`;
};
