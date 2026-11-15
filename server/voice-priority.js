export default {
  trackMeters: 100,
  repeatCooldownMinutes: 1,
  levels: [
    {
      id: 'move',
      priority: 1,
      ttlMs: 20000,
      max: 8,
      say: { to: '{user} se une a {team}', from: '{user} cambió de {from} a {team}' }
    },
    {
      id: 'gift',
      priority: 0,
      ttlMs: 0,
      max: 0,
      say: 'Gracias {user} por enviar {count} {gift}.'
    },
    { id: 'chat', priority: 2, ttlMs: 20000, max: 3, maxChars: 140, say: '{user} dice: {text}' },
    { id: 'welcome', priority: 3, ttlMs: 25000, max: 6, say: 'Bienvenido {user}' },
    {
      id: 'action',
      priority: 3,
      ttlMs: 12000,
      max: 3,
      coalesceMs: 8000,
      say: {
        like: '{user}, gracias por tus likes',
        follow: 'Gracias {user} por seguirnos',
        share: 'Gracias {user} por compartir'
      }
    },
    {
      id: 'match',
      priority: 4,
      ttlMs: 8000,
      max: 1,
      say: { start: 'Se enfrentan {teamA} y {teamB}.' }
    }
  ]
};
