export default {
  trackMeters: 100,
  repeatCooldownMinutes: 1,
  levels: [
    {
      id: 'move',
      priority: 1,
      ttlMs: 20000,
      max: 8,
      interrupt: true,
      say: { to: '{user} se une a {team}', from: '{user} cambió de {from} a {team}' }
    },
    {
      id: 'gift',
      priority: 0,
      ttlMs: 0,
      max: 0,
      interrupt: true,
      say: 'Gracias {user} por enviar {count} {gift}. Tu equipo {team} entra en modo turbo y tu foto queda en el cuadro de honor.'
    },
    { id: 'chat', priority: 2, ttlMs: 20000, max: 3, maxChars: 140, interrupt: true, say: '{user} dice: {text}' },
    { id: 'welcome', priority: 3, ttlMs: 25000, max: 6, say: 'Bienvenido {user}' },
    { id: 'turbo', priority: 3, ttlMs: 12000, max: 1, say: '¡Turbo para el equipo {team}!' },
    {
      id: 'featured',
      priority: 3,
      ttlMs: 30000,
      max: 1,
      say: 'Damos la bienvenida al hincha destacado del club {team}, usuario {user}. {leader}'
    },
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
      everyMs: 14000,
      quietMs: 3500,
      say: {
        start: 'Arranca la carrera entre {teamA} y {teamB}. La meta está a {track} metros.',
        normal: '{lead} va a {leadM} metros y {other} a {otherM}. Faltan {left} metros para la meta.',
        final: '¡{lead} está a {left} metros de la meta!',
        win: '¡Gana {lead}! Llegó a los {track} metros.'
      }
    },
    { id: 'support', priority: 5, ttlMs: 30000, max: 1, say: 'Envía tap tap para apoyar a tu equipo.' }
  ]
};
