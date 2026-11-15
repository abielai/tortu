========================================================================================================
 INICIO DEL BLOQUE PARA EL DESARROLLADOR DEL BACKEND   (todo lo que esta entre este 'INICIO' y el 'FIN' es solo documentacion)
========================================================================================================
 QUE ES: toda la documentacion del servidor, reunida en un solo lugar. Antes estaba repartida por el encabezado y por el bloque
         'PERSISTENCIA EN SERVIDOR'. Los textos se movieron aqui SIN cambiar su contenido; solo se reordenaron y se completaron.
 COMO LEERLO: PARTE 1 rutas · PARTE 2 checklist de funciones · PARTE 3 reglas de juego · PARTE 4 contrato de eventos ·
              PARTE 5 persistencia · PARTE 6 voz · PARTE 7 pendientes.
 REGLA DE ORO: el backend RECIBE, NORMALIZA, ENVIA y GUARDA eventos reales. El frontend CALCULA puntajes, equipos, carreras y ganadores.

 >>> INSTRUCCION PARA EL DESARROLLADOR (hacer cuando termines de leer) <<<
  1) Copia este bloque a un archivo BACKEND_README.txt en tu repositorio (mismo contenido), para conservarlo.
  2) BORRA de este HTML todo el comentario que empieza en la linea 2 (la que dice abrir-comentario) y termina en la linea que sigue a este
     'FIN DEL BLOQUE' (la que dice cerrar-comentario). Es un comentario HTML: borrarlo NO cambia el funcionamiento del overlay
     y libera espacio en el archivo. Es el PRIMER comentario del archivo, justo debajo de la declaracion doctype.
  3) Lo que queda en el HTML (las reglas del proyecto en el encabezado 'CLUSS - REGLAS DEL PROYECTO') es documentacion del frontend: no se borra.
  4) Despues de borrarlo, deja el BACKEND_README.txt del repo como unica fuente y no vuelvas a pegar esta documentacion aqui.


========================================================================================================
 PARTE 1 - INDICE DE RUTAS (todas las que usa el frontend)
========================================================================================================
 Todas las rutas que el frontend llama (o carga). METODO RUTA -> para que sirve. El detalle esta en la parte indicada.
  GET    /api/events                       SSE: event status + event update {entry}. Eventos REALES de TikTok.                 (PARTE 4)
  POST   /api/connect                      body {username}. Guarda el usuario y conecta. Responde {ok:true,username} o {ok:false,message}.
  POST   /api/reconnect                    reintenta la conexion. 200 = ok, 409 = ya conectado (tambien ok).                  (PARTE 4)
  POST   /api/round/complete               el frontend la llama al TERMINAR cada ronda, justo despues de enviar su estado (flush). Responde {ok:true,...} o {ok:false,message}; con ok:false el frontend lo muestra como error. El servidor guarda el cierre de la carrera.
  GET    /api/state.js                     JS: window.CLUSS_STATE = {...}  carga inicial sincrona (documentos chicos).        (PARTE 5)
  GET    /api/state/:clave                 devuelve el JSON guardado o 404.                                                   (PARTE 5)
  PUT    /api/state/:clave                 upsert del documento JSON (el ultimo gana).                                        (PARTE 5)
  DELETE /api/state/:clave                 borra el documento (puede ignorarse si se prefiere conservar historial).           (PARTE 5)
  POST   /api/log/:flujo                   body {"records":[...hasta 200...]}. Solo AGREGA. Flujos: chat-texts, user-events.   (PARTE 5)
  DELETE /api/log/:flujo                   vacia el flujo (solo con boton confirmado "Vaciar archivo del chat").              (PARTE 5)
  GET    /api/log/chat-texts.json | .txt   descarga del archivo del chat, con Content-Disposition: attachment.                 (PARTE 5)
  GET    /api/recent-users                 {"users":[{"username","avatar"}]} maximo 4, solo personas reales.                  (PARTE 4)
  GET    /api/voice-priority               tabla de prioridades de la voz en off.                                             (PARTE 6)
  GET    /api/deployment-signature         {"signature":"sha256-<16 hex>"}. Ver "FIRMA DE DESPLIEGUE" mas abajo.
  GET    /api/game-tools/events            SSE de herramientas del juego. Eventos: game-settings, game-tools, game-command.   (ver abajo)
  POST   /api/game-tools/overlay-heartbeat body {clientId,visible}. El overlay avisa que esta vivo y visible.                  (ver abajo)
  POST   /api/country/cup                  body {countryCode}; suma una copa solo para uno de los 21 codigos aceptados.
  POST   /api/admin/tournament-enabled     body {enabled}; habilita/deshabilita el registro de votos (admin).
  POST   /api/admin/game-settings          body {giftTurboProgress,tapTurboProgress}; ambos 0-100 (admin).
  POST   /api/admin/game-tools/reset        reinicia cronometro y contador de regalos (admin).
  POST   /api/admin/game-command           body {command}; solo refresh, turbo-down o turbo-up (admin).
  POST   /api/admin/reconnect              inicia un nuevo ciclo de reconexion (admin).
  GET    /api/admin/presence               estado de presencia (admin).
  GET    /api/admin/country-stats           conteos por pais (admin).
  GET    /api/admin/logs?limit=200         ultimos logs tecnicos de esta ejecucion (admin; maximo 200).
  GET    /activity-policy.js               script con la politica de taps (TAP_POLICY). [REVISAR: el comentario viejo decia /api/activity-policy.js]
  GET    /manifest.webmanifest y /sw.js    instalar como app.
  GET    /icons/tortu2-{192,512}.{png,svg} iconos de instalacion de la PWA Negocio.
  GET    /backend                          panel del backend (boton del overlay).

 DETALLE DE LAS RUTAS QUE NO ESTAN EN LAS OTRAS PARTES
  FIRMA DE DESPLIEGUE (anti-cache). El HTML trae en el <head> la etiqueta  <meta name="cluss-deployment-signature" content="__CLUSS_DEPLOYMENT_SIGNATURE__">.
    El servidor debe REEMPLAZAR ese marcador por una firma con formato  sha256-<16 caracteres hex en minuscula>  (hash de la version desplegada) al servir el HTML,
    y devolver ESA MISMA firma en GET /api/deployment-signature como {"signature":"sha256-..."}.
    Si no coinciden, el frontend borra la cache del overlay y recarga UNA vez con ?_cluss_deploy=<firma>; si sigue distinta no insiste (queda un error en consola).
    Si el marcador no se reemplaza o el formato no es valido, el frontend no puede verificar la version (solo avisa en consola).
  GAME-TOOLS SSE (GET /api/game-tools/events), eventos con data JSON:
    game-settings  {giftTurboProgress, tapTurboProgress}   porcentajes 0-100 del avance por regalo y por cada limite de taps (predeterminados 6 y 20).
    game-tools     {timerStartedAt}                        entero en ms: instante de inicio del cronometro del overlay.
    game-command   {command}                               valores que el frontend entiende: 'refresh' (recarga la pagina), 'turbo-down', 'turbo-up'. El servidor solo debe enviar los de su lista permitida.
  HEARTBEAT (POST /api/game-tools/overlay-heartbeat): cada 20 s, al cambiar la visibilidad de la pestana y al cerrar (visible:false, keepalive). clientId = UUID generado por el overlay. Activo = senal visible en los ultimos 90 s.

========================================================================================================
 PARTE 2 - CHECKLIST DE FUNCIONES DEL SERVIDOR (de TikTok hasta la persistencia)
========================================================================================================
 11c. LISTA DE FUNCIONES QUE DEBE TENER EL SERVIDOR (de TikTok hasta la persistencia). Checklist para quien programa el BACKEND.
  F1  CUENTA TIKTOK: usuario guardado desde el panel > variable de entorno TIKTOK_USERNAME > d4n1el325. Al guardar: quitar espacios y @. Rechazar usuario vacio.
  F2  CONEXION: conectar al cargar el overlay o al pedir reconexion. Cada intento espera hasta 10 s.
  F3  REINTENTOS: cada 5 s durante un maximo de 5 min; despues queda 'failed' hasta reiniciar el ciclo.
  F4  POST /api/reconnect: inicia/reintenta la conexion. 200 = ok, 409 = ya conectado (tambien ok).
  F5  ESCUCHAR EVENTOS DE TIKTOK y normalizarlos a un formato unico (type, username, content, activityCount, giftName, giftDiamonds, profilePictureUrl).
  F6  FILTRAR: enviar SOLO member, chat, gift, like, follow y share. Descartar todo lo demas. Nunca enviar el campo 'bot'.
  F7  DEDUPLICAR por IDs de origen recientes (no enviar dos veces el mismo evento).
  F8  COMBOS DE REGALOS: calcular el delta de cada combo para no contar repetidos. Conservar tal cual los activityCount de regalos y likes.
  F9  GET /api/events (SSE): 'event: status' {connected,status} en cada cambio de conexion y 'event: update' {entry} por cada evento real.
  F10 CONFIG DE AVANCE/TURBO: guardar y entregar los porcentajes (0 a 100). Predeterminados: regalo 6 %, taps 20 %.
  F11 ESTADO DEL JUEGO: guardar los documentos de estado del overlay (juego, cuadro del torneo, votos) y servir la carga inicial de documentos pequenos (GET /api/state.js). NO calcular el cuadro ni resultados.
  F12 TORNEO LIBRE (API separada): registrar votos de comentarios mientras estaba habilitado, aceptar nombres libres de equipos y contar usuarios unicos con huellas hash (sin guardar el nombre).
  F13 COPAS: registrar la copa que comunica el frontend SOLO si el codigo de pais es valido.
  F14 ESTADISTICAS POR PAIS: conteos de comentarios y copas para 21 paises/equipos; reconocer nombre, codigo o bandera; sin coincidencia = 'sin pais'; recibir los comentarios pendientes al completar cada ronda; mostrarlos en el panel del backend.
  F15 USUARIOS RECIENTES: guardar maximo 4 usuarios de eventos reales 'member', actualizar avatares y servirlos en GET /api/recent-users. Sin ruta para reemplazar la lista por HTTP.
  F16 HERRAMIENTAS DEL JUEGO: guardar cronometro y contador de regalos; cada regalo incrementa el contador; el boton reset reinicia ambos; aceptar SOLO comandos de una lista permitida y pasarlos al overlay activo.
  F17 SENAL DEL OVERLAY: recibir la visibilidad del frontend; activo = senal visible en los ultimos 90 s; revisar cada 15 s.
  F18 WHATSAPP: avisar cuando el overlay pasa de activo a inactivo y por cada evento de regalo, solo si las alertas estan habilitadas y configuradas.
  F19 REGISTROS: recibir lotes de hasta 200; guardar los textos de chat SIN autor; retener los eventos con nombres hasta 90 dias.
  F20 RUTAS EXTRA: GET /api/voice-priority (tabla de voz; el frontend agrega los niveles que falten), GET /manifest.webmanifest, GET /sw.js y el panel en /backend.
  PROHIBIDO PARA EL SERVIDOR: inventar, duplicar o simular usuarios, comentarios, likes o regalos; decidir puntajes, ganadores o cuadro; enviar tipos de evento fuera de la lista de seis.
  [REVISAR] Falta confirmar con el codigo del servidor: el resto de 'Persistencia y registros' (la fila fuente venia cortada), el formato exacto de los documentos de estado y la lista de comandos permitidos (F16).
  F21 PERSISTENCIA POR CLAVE: GET/PUT/DELETE /api/state/:clave y GET /api/state.js (PARTE 5).
  F22 LOGS: POST/DELETE /api/log/:flujo y descargas chat-texts.json/.txt (PARTE 5).
  F23 CONECTAR: POST /api/connect {username} (guarda y conecta; respuesta {ok,username,message}).
  F24 CIERRE DE RONDA: POST /api/round/complete (responder {ok:true} o {ok:false,message}).
  F25 FIRMA DE DESPLIEGUE: reemplazar __CLUSS_DEPLOYMENT_SIGNATURE__ en el HTML y servir GET /api/deployment-signature (ver PARTE 1).
  F26 GAME-TOOLS SSE: GET /api/game-tools/events con game-settings, game-tools y game-command (ver PARTE 1).
  F27 HEARTBEAT: POST /api/game-tools/overlay-heartbeat {clientId,visible} (ver PARTE 1).
  F28 VOZ: GET /api/voice-priority (PARTE 6).

========================================================================================================
 PARTE 3 - REGLAS DE JUEGO: QUIEN HACE QUE (backend vs frontend)
========================================================================================================
 11b. REGLAS DE JUEGO: QUIEN HACE QUE (backend vs frontend). Resumen para quien programa el SERVIDOR. Regla de oro: el backend ENVIA eventos reales y GUARDA datos; el frontend CALCULA puntajes, equipos, carreras y ganadores.
  CUENTA Y CONEXION
   - Backend: el usuario guardado desde el panel prevalece; si no hay ninguno usa TIKTOK_USERNAME y luego d4n1el325. Al guardar se quitan espacios y @; NO se acepta usuario vacio. Conecta al cargar el overlay o cuando el panel pide reconexion (POST /api/reconnect).
   - Frontend: muestra el estado recibido por SSE (event: status). Si falla la conexion puede pedir reconexion.
  REINTENTOS
   - Backend: cada intento espera hasta 10 s para conectar; reintenta cada 5 s durante un maximo de 5 min; despues queda en estado 'failed' hasta reiniciar el ciclo.
   - Frontend: solo refleja el estado; NO decide la politica de reintentos.
  EVENTOS ACEPTADOS
   - Backend: normaliza los eventos de TikTok y envia SOLO member, chat, gift, like, follow y share. Deduplica IDs de origen recientes y calcula el delta de los combos de regalos para no contar repetidos.
   - Frontend: solo procesa esos 6 tipos. Los bots estan desactivados en el juego actual; solo los eventos reales determinan la actividad.
  TAPS Y ACTIVIDAD
   - Backend: conserva tal cual los conteos de actividad (activityCount) que llegan del conector para regalos y likes.
   - Frontend: pesos por evento = ingreso (member) 1, comentario 10, like 1 por cada like, seguir 3, compartir 5. Los REGALOS NO suman taps: avanzan la pista directamente. Los comentarios repetidos del mismo usuario se limitan a uno cada 8 s. (OJO: los valores de las estadisticas por VS de la regla 18 son otra cosa: miembro 1, comentario 5, like 1, seguir 3, compartir 3, regalo 10.)
  AVANCE Y TURBO
   - Backend: guarda los avances configurables; acepta valores entre 0 y 100 %. Predeterminados en codigo: regalo 6 %, cada limite de taps 20 %.
   - Frontend: cada regalo contado da 10 % de avance directo y activa turbo 15 s por regalo. El contador de taps permanece fijo en 45 por equipo y al completarlo avanza directamente el porcentaje configurado, sin activar turbo.
  ASIGNACION AL EQUIPO
   - Backend: NO decide puntajes ni ganador.
   - Frontend: los eventos de una persona van a su equipo elegido/asignado; los eventos anonimos (sin username) usan el carril seleccionado. Un regalo toma el equipo que el usuario nombro en el chat en los ultimos 60 s, si lo hay (si no, el que tiene asignado).
  CARRERAS Y TORNEOS
   - Backend: persiste los documentos de estado del overlay, pero NO calcula el cuadro ni decide resultados.
   - Frontend: modos: Torneo Libre, Clasico, Libertadores, Champions, Copa del Mundo, Copa America y Elite Nations Cup. El Clasico empieza con Olimpia-Cerro y sus series son al mejor de 3; los demas cuadros son eliminacion directa con un partido por cruce.
  TORNEO LIBRE
   - Backend: la API separada de Torneo Libre registra los votos de comentarios recibidos mientras estaba habilitada; acepta nombres libres de equipos y cuenta usuarios UNICOS mediante huellas hash (no guarda el nombre).
   - Frontend: en este modo los comentarios reales que mencionan equipos votan por la SIGUIENTE carrera; juegan los dos mas votados y se sortean los puestos que falten. No se vota por los equipos que ya estan corriendo.
  INACTIVIDAD Y COPAS
   - Backend: puede registrar la copa comunicada por el frontend, solo si el codigo de pais es valido.
   - Frontend: la inactividad se mide desde la ultima interaccion REAL: 60 s, o 120 s si hubo mas de 1.000 interacciones. Los ingresos (member) NO reinician el reloj. Si vence, gana quien va primero y avanza, pero NO recibe copa.
  ESTADISTICAS POR PAIS
   - Backend: mantiene conteos de comentarios y copas para 21 paises/equipos. Reconoce nombre, codigo o bandera; los comentarios sin coincidencia quedan como 'sin pais'.
   - Frontend: envia los comentarios pendientes al completar la ronda. El panel del backend muestra los conteos recibidos.
  USUARIOS RECIENTES
   - Backend: conserva como maximo 4 usuarios registrados por eventos reales de ingreso (member) y puede actualizar sus avatares. NO hay una ruta actual para reemplazar la lista por HTTP.
   - Frontend: usa esos usuarios para mostrar avatares; NO debe tratarlos como eventos nuevos ni simular participantes.
  HERRAMIENTAS DEL JUEGO
   - Backend: guarda cronometro y contador de regalos; los regalos incrementan el contador y el boton de reset reinicia ambos. Acepta SOLO comandos incluidos en una lista permitida.
   - Frontend: recibe comandos del panel para aplicarlos al overlay activo.
  SENAL DEL OVERLAY Y WHATSAPP
   - Backend: considera el overlay activo si recibio una senal visible en los ultimos 90 s (revisa cada 15 s). Puede avisar por WhatsApp cuando pasa de activo a inactivo y por cada evento de regalo, si las alertas estan habilitadas y configuradas.
   - Frontend: reporta su visibilidad al servidor.
  PERSISTENCIA Y REGISTROS
   - Backend: los registros se reciben en lotes de hasta 200. Los textos de chat se guardan SIN autor; los eventos con nombres se retienen hasta 90 dias. [REVISAR: el texto fuente de esta fila venia cortado; completar con el codigo del servidor.]
   - Frontend: guarda en el servidor el estado del juego, el cuadro y los votos; el backend sirve una carga inicial de documentos pequenos.

========================================================================================================
 PARTE 4 - CONTRATO DE EVENTOS Y RUTAS DEL LIVE
========================================================================================================
11. CONTRATO CON EL BACKEND - LEER SI TOCAS EL SERVIDOR
 El frontend es UN SOLO HTML. Habla con el backend solo por estas rutas:
  GET  /api/events          Server-Sent Events (SSE) con DOS tipos de mensaje:
       event: status  data: {"connected":true|false,"status":"connecting|reconnecting|failed|..."}   (tambien acepta "isConnected")
       event: update  data: {"entry":{...}}  -> UN evento REAL del live. Campos de entry:
          type            OBLIGATORIO: 'member' | 'chat' | 'gift' | 'like' | 'follow' | 'share' (otro valor se ignora)
          username        id del usuario de TikTok (sin @). Sin username el evento no se asigna a nadie.
          content         texto del comentario (solo chat). El frontend detecta el equipo en el texto.
          activityCount   cantidad de likes o de regalos de ese evento (entero >= 1)
          giftName        nombre del regalo (tambien se leen gift_name / gift / giftId)
          giftDiamonds    diamantes totales del regalo/combo; la alerta alegre suena desde 1 diamante.
          profilePictureUrl  foto https del usuario (tambien se leen profilePicture / avatarUrl / avatar / userImage / imageUrl)
          bot             NUNCA lo envia el backend. Solo lo usa el frontend para sus eventos automaticos.
  POST /api/reconnect       inicia/reintenta la conexion con TikTok. 200 = ok, 409 = ya conectado (tambien ok). Otro error: JSON {"message":"..."}.
  GET  /api/recent-users    {"users":[{"username":"...","avatar":"https://..."}]}  SOLO personas reales (alimenta los huevos grandes mientras no hay eventos).
  GET  /manifest.webmanifest y /sw.js   para instalar como app.
 LO QUE EL BACKEND DEBE RESPETAR (reglas 1 y 11):
  - Enviar SOLO eventos reales de TikTok. PROHIBIDO inventar, duplicar o simular usuarios, comentarios, likes, regalos, seguidores o compartidos.
  - PROHIBIDO que el backend (o el JSON de usuarios) se haga pasar por personas con nombres inventados. Los bots viven solo en el frontend y se llaman tortubot_N.
  - El backend no decide puntajes ni ganadores: eso lo hace el frontend (reglas 3 y 5).
  - /api/recent-users solo debe devolver usuarios que de verdad participaron en el live.

========================================================================================================
 PARTE 5 - CONTRATO DE PERSISTENCIA (claves, logs, concurrencia, privacidad)
========================================================================================================
 ===== PERSISTENCIA EN SERVIDOR ================================================================
 DECISION DEL AUTOR: NADA se guarda en el navegador (ni localStorage ni sessionStorage ni IndexedDB). El overlay corre en un
 celular de gama media y cada JSON.stringify + escritura sincronica local le quita CPU y memoria al render. Todo lo que debe
 sobrevivir a un reinicio vive en el SERVIDOR; el cliente solo guarda en RAM lo imprescindible para dibujar.

 >>> PARA EL DESARROLLADOR DEL BACKEND: CONTRATO QUE DEBE IMPLEMENTAR <<<
 Mismo origen que /api/events y /api/activity-policy.js. Sin cookies ni login nuevos. Si un endpoint no existe o falla, el juego
 sigue funcionando con los valores por defecto y reintenta con espera creciente (2 s, 4 s ... tope 60 s); en ese caso lo que
 no llego se pierde al cerrar la pagina, y NO se cae a localStorage a proposito.

 1) GET /api/state.js   (Content-Type: application/javascript, sin cache)
    Se carga con una etiqueta script con src, ANTES que el resto, asi el estado inicial esta disponible de forma sincrona (sin XHR bloqueante).
    Debe responder:  window.CLUSS_STATE = { "<clave>": <JSON>, ... };
    Si no hay nada guardado: window.CLUSS_STATE = {};
    Incluir SOLO documentos chicos (ver tabla). NO incluir logs de ronda ni historial por usuario (son pesados y se piden aparte).
 2) PUT    /api/state/:clave     body = JSON del valor (cualquier JSON: objeto, string, numero). Upsert, el ultimo gana.
    DELETE /api/state/:clave     borra el documento (el servidor puede ignorarlo si prefiere conservar historial).
    GET    /api/state/:clave     devuelve el JSON guardado o 404. Solo lo usa el panel de estadisticas al tocar "Ver" / "⬇" en un log de ronda.
    El cliente junta cambios: como mucho 1 PUT por clave cada 1 s (cada 5 s en las claves pesadas) y manda el ultimo valor, no cada cambio.
 3) POST   /api/log/:flujo       body = {"records":[ ... hasta 200 registros ... ]}  Solo AGREGA (append-only). Lote cada ~5 s.
    DELETE /api/log/:flujo       vacia el flujo (solo lo dispara el boton confirmado "Vaciar archivo del chat").
    GET    /api/log/chat-texts.json  y  /api/log/chat-texts.txt   descargas del archivo del chat (ver abajo). Enviar Content-Disposition: attachment.

 TABLA DE CLAVES Y FLUJOS
  clave / flujo            tipo       tamano aprox.   en state.js   contenido
  cluss.v1                 PUT        chico (<20 KB)  SI            progreso del juego: copas por club (cp), victorias, torneo activo, votos del chat, popularidad de paises, etc.
  cluss.torneoLock         PUT        string          SI            "libre" | "auto" | id de torneo fijo elegido con el boton 🔒
  cluss.lang               PUT        chico           SI            idioma del relator por torneo {libre:"es",champions:"en",...}
  cluss.crest.<id>         PUT        string (URL)    SI            cache de la URL del escudo encontrada en Wikipedia
  cluss.vs                 PUT        mediano         SI            LISTA DE VS (habilitar y marcar populares: [{k,on,popular}]), VS en curso (cur), siguiente no popular (np) y ESTADISTICAS por VS. Clave pesada: 1 PUT / 5 s
  cluss.gifts              PUT        mediano         SI            catalogo de regalos con nombre, valor en monedas, habilitados y tiempo de rotacion.
  cluss.stats              PUT        mediano         SI            torneos, rondas, menciones de clubes y indice de logs. Clave pesada: 1 PUT / 5 s
  cluss.libreVotes         PUT        mediano         SI            votos del Torneo Libre: sal, totales, ronda actual, historial (max 500 rondas) y huellas de usuarios unicos. Clave pesada: 1 PUT / 5 s
  cluss.log.<idRonda>      PUT        hasta ~300 KB   NO            log completo de UNA ronda con regalos (regalos + hasta 1500 mensajes). Se escribe y se libera de RAM. El cliente pide DELETE de los logs viejos (quedan los ultimos 15); el servidor puede conservarlos igual.
  cluss.chatArchive        (meta)     chico           SI (opcional) {"v":1,"created":ms,"updated":ms,"trimmed":0,"count":N}. SOLO lo LEE el cliente; lo mantiene el servidor a partir de /api/log/chat-texts. Si falta, el cliente cuenta desde 0.
  log  chat-texts          append     1 registro/comentario  --   [timestamp_ms, "texto"] (sin autor, sin bots). Sin tope en el cliente: el servidor decide la retencion.
  log  user-events         append     1 registro/evento real --   {u:"usuario en minusculas", name:"Usuario", t:ms, type:"chat|like|gift|follow|share|member", n:numero, text?:"...", gift?:"..."}
                                                                   Historial completo por usuario. El cliente solo conserva en RAM una ventana corta (60 usuarios x 60 eventos) para el panel 📊.
 Privacidad: chat-texts no lleva autor; cluss.libreVotes guarda huellas con sal, no nombres. user-events SI lleva el nombre: tratarlo como dato personal (retencion limitada, acceso restringido).
 Concurrencia: hay UN solo overlay escribiendo; el ultimo PUT gana. Si hubiera varios overlays a la vez, el servidor debe fusionar o rechazar.
  Los calculos de taps, turbos, regalos y estadisticas se hacen en el navegador; el servidor solo persiste/entrega los documentos JSON y registra eventos recibidos.
 =================================================================================================================== 

========================================================================================================
 PARTE 6 - VOZ EN COLA
========================================================================================================
 El frontend reproduce una sola frase a la vez: comentarios e interacciones reales de usuarios, más un anuncio inicial de los equipos enfrentados. No narra el progreso, los turbos ni los logros. El botón del overlay habilita o silencia todas las voces.
 La tabla del backend (GET /api/voice-priority) contiene las plantillas y prioridades de cola. El backend NO habla ni decide qué se dice.

========================================================================================================
 PARTE 7 - PENDIENTES POR CONFIRMAR
========================================================================================================
 El HTML no define ciertos detalles operativos; las decisiones concretas de este repositorio quedan fijadas en la PARTE 8:
  1) Los documentos de estado son JSON opaco, definido por el frontend; el servidor limita claves y los guarda sin modificarlos.
  2) El cierre de ronda guarda un recibo y los conteos de paises pendientes, sin calcular resultados.
  3) Los comandos permitidos son refresh, turbo-down y turbo-up.
  4) El panel y los controles administrativos usan Bearer token; las escrituras del overlay no habilitan CORS.
  5) La politica se sirve en /activity-policy.js.
  6) La tabla exacta de paises, retencion y despliegue tambien se fija en la PARTE 8.

========================================================================================================
 PARTE 8 - CONTRATO IMPLEMENTADO EN Negocio (v1)
========================================================================================================
 El backend de este repositorio implementa los contratos anteriores con estas decisiones concretas:
  - Runtime: Node.js 20 o posterior. El HTML se sirve en / y /index.html; recursos PWA desde /manifest.webmanifest y /sw.js.
  - TikTok: usuario guardado por POST /api/connect > TIKTOK_USERNAME > d4n1el325. Se usa tiktok-live-connector; solo los seis tipos
    permitidos se emiten. Los regalos en combo emiten el delta nuevo de repeatCount y el cliente no recibe el campo bot.
  - Estado: archivos JSON atomicos bajo data/state; las claves aceptadas son cluss.v1, cluss.torneoLock, cluss.lang,
    cluss.crest.<id>, cluss.vs, cluss.gifts, cluss.stats, cluss.libreVotes, cluss.chatArchive y cluss.log.<id>.
    GET /api/state.js incluye todos salvo cluss.log.*; cada valor se guarda tal cual y GET individual responde 404 si no existe.
  - Logs: data/logs/<flujo>.jsonl, append-only y lotes de maximo 200. chat-texts conserva solo [timestamp_ms,texto], sin autor.
    user-events conserva u, name, t, type y los campos n/text/gift permitidos; ambos flujos tienen retencion configurable de 1 a 90 dias
    (LOG_RETENTION_DAYS, predeterminado 90). Las descargas de chat son adjuntos JSON o TXT.
    Los logs tecnicos del servidor viven en un buffer de memoria de hasta 200 entradas y se reinician al reiniciar el proceso.
  - Ronda: POST /api/round/complete cierra comentarios pendientes por pais y escribe un recibo bajo data/rounds; no calcula ganador,
    cuadro ni puntajes.
  - Paises: los 21 codigos ISO configurados son PY, AR, BR, UY, CL, BO, PE, CO, EC, VE, MX, US, CA, ES, PT, FR, GB, DE, IT, NL y JP;
    comentarios se atribuyen al primer alias reconocido, de lo contrario a "sin pais". POST /api/country/cup acepta {countryCode}
    solo para esos codigos.
  - Voz y politica: /api/voice-priority y /activity-policy.js devuelven las tablas/funciones que usa el HTML.
  - PWA: el nombre instalable es Negocio, el manifiesto declara display fullscreen con fallback standalone y orientacion portrait,
    e incluye iconos PNG de 192 y 512 px. El service worker guarda el shell para abrirlo sin conexion, actualiza navegaciones por red
    y excluye /api/*, /backend y los eventos SSE de la cache. La instalacion requiere HTTPS o localhost.
  - Firma: SHA-256 de 16 hexadecimales del HTML fuente; la firma se sustituye en el meta al servir / y es igual a la respuesta JSON.
  - Herramientas: /api/game-tools/events emite primero ajustes y estado. POST /api/game-tools/overlay-heartbeat recibe
    {clientId,visible}; la presencia expira a los 90 s y se revisa cada 15 s. Un regalo aumenta el contador; reset vuelve a cero
    el contador y cronometro. La lista permitida de comandos es exactamente refresh, turbo-down y turbo-up.
  - Operacion del panel: /backend y POST /api/connect requieren iniciar sesion con BACKEND_ADMIN_TOKEN; crea una cookie HttpOnly/SameSite valida por 12 horas
    para que el token se ingrese una sola vez. POST /api/admin/session inicia la sesion, DELETE la cierra y /api/admin/* acepta la cookie
    o Authorization: Bearer <BACKEND_ADMIN_TOKEN>. Sin clave configurada, en desarrollo el token local es 123; en producción
    se genera al iniciar y se muestra en consola.
    Las mutaciones del contrato del overlay son same-origin; no se habilita CORS.
  - WhatsApp: solo envia avisos si WHATSAPP_ALERTS_ENABLED=true y WHATSAPP_WEBHOOK_URL esta configurado; regalos y transicion a
    overlay inactivo generan POST JSON. WHATSAPP_WEBHOOK_TOKEN, si existe, se envia como Bearer.
  - Torneo Libre: el overlay ya persiste cluss.libreVotes con huellas con sal. El servidor tambien registra menciones recibidas
    durante la habilitacion administrada, usando el texto normalizado como nombre libre y HMAC con sal; no conserva el autor.
    POST /api/admin/tournament-enabled habilita el registro; cada comentario real del chat aporta un voto unico por usuario y nombre.
  Variables opcionales: PORT (3000), HOST (127.0.0.1; use 0.0.0.0 al desplegar), DATA_DIR (data), LOG_RETENTION_DAYS (90), TIKTOK_USERNAME,
  BACKEND_ADMIN_TOKEN, WHATSAPP_ALERTS_ENABLED, WHATSAPP_WEBHOOK_URL y WHATSAPP_WEBHOOK_TOKEN.

========================================================================================================
 FIN DEL BLOQUE PARA EL DESARROLLADOR DEL BACKEND   (aqui termina lo que se borra; luego sigue el encabezado de reglas del frontend)
========================================================================================================

INICIO RAPIDO DEL REPOSITORIO
  Requiere Node.js 20 o posterior. Ejecutar `npm install` y luego `npm start`.
  Abrir http://127.0.0.1:3000/ para el overlay o /backend para las herramientas.
  Copiar .env.example a .env y configurar BACKEND_ADMIN_TOKEN antes de exponer el servicio.
  Sin clave explícita, el backend local usa 123; en producción configura BACKEND_ADMIN_TOKEN.
  Si no hay usuario guardado, el backend usa TIKTOK_USERNAME o tortulive.
  `npm test` ejecuta las pruebas del backend.

HISTORIAL DE REGALOS POR EQUIPO
  POST /api/honor/team-gifts recibe eventId y teamId desde el overlay; solo acepta regalos reales que el servidor haya emitido por SSE.
  GET /api/honor/team-gifts devuelve el historial por equipo, los ultimos 50 primero y el total persistido. El archivo completo se conserva
  sin caducidad en DATA_DIR/team-gifts.jsonl.
