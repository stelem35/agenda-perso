// 5 catégories + "autre" (gris, non proposé à la saisie). Couleurs définies en CSS (--c-<clé>).
const ICONS = {
  travail: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  famille: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  sante: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  loisirs: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  admin: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  autre: '<circle cx="12" cy="12" r="3"/>',
};

export const CATEGORIES = {
  travail: { label: 'Travail', words: ['reunion', 'meeting', 'client', 'bureau', 'projet', 'visio', 'deadline', 'boulot', 'travail', 'entretien', 'formation'] },
  famille: { label: 'Famille', words: ['anniv', 'famille', 'enfant', 'ecole', 'papa', 'maman', 'mamie', 'papi', 'parents', 'creche', 'nounou', 'grands-parents'] },
  sante: { label: 'Santé', words: ['medecin', 'docteur', 'dentiste', 'kine', 'pharmacie', 'ophtalmo', 'dermato', 'sante', 'hopital', 'analyse', 'vaccin', 'infirmi', 'osteo', 'radio'] },
  loisirs: { label: 'Loisirs', words: ['sport', 'cinema', 'restaurant', 'resto', 'soiree', 'concert', 'match', 'vacances', 'week-end', 'weekend', 'sortie', 'foot', 'tennis', 'golf', 'apero', 'theatre', 'randonnee'] },
  admin: { label: 'Admin', words: ['impot', 'facture', 'assurance', 'banque', 'mairie', 'controle technique', 'administratif', 'abonnement', 'contrat', 'garantie', 'retraite', 'notaire', 'paiement', 'echeance'] },
  autre: { label: 'Autre', words: [] },
};
export const CAT_KEYS = ['travail', 'famille', 'sante', 'loisirs', 'admin'];

export const icon = (k, cls = '') =>
  `<svg class="ci ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.autre}</svg>`;

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Déduit une catégorie d'un texte (titre d'événement, nom de calendrier) ; null si rien ne correspond.
export function guessCategory(text) {
  const t = norm(text || '');
  for (const [k, c] of Object.entries(CATEGORIES)) {
    if (c.words.some(w => t.includes(w))) return k;
  }
  return null;
}
