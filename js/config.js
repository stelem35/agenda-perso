export const CONFIG = {
  // À remplacer par l'ID client OAuth créé dans Google Cloud (voir README.md)
  GOOGLE_CLIENT_ID: '145540817012-58tgrr7d2q357i9ejqu7gjg1imqkch9q.apps.googleusercontent.com',

  // Lieu par défaut de la météo (modifiable dans l'app)
  DEFAULT_PLACE: { name: 'Châteaugiron', lat: 48.0469, lon: -1.5036 },

  // Créneaux libres : plage affichée [heure début, heure fin] et durée minimale
  FREE: { minMinutes: 30, weekday: [8, 18], weekend: [8, 20] },
};
