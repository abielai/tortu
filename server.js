import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import voicePriority from './server/voice-priority.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || 'data');
const PUBLIC_DIR = resolve(ROOT, 'public');
const HTML_FILE = resolve(ROOT, 'overlay.html');
const PACKAGE_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 600 * 1024;
const MAX_LOG_BATCH = 200;
const MAX_TEAM_GIFT_HISTORY_ITEMS = 50;
const RETENTION_DAYS = Math.min(90, Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 90));
const EVENT_TYPES = new Set(['member', 'chat', 'gift', 'like', 'follow', 'share']);
const COMMANDS = new Set(['refresh', 'turbo-down', 'turbo-up']);
const COUNTRIES = [
  ['PY', 'Paraguay', ['paraguay', '🇵🇾', 'py']],
  ['AR', 'Argentina', ['argentina', '🇦🇷', 'ar']],
  ['BR', 'Brasil', ['brasil', 'brazil', '🇧🇷', 'br']],
  ['UY', 'Uruguay', ['uruguay', '🇺🇾', 'uy']],
  ['CL', 'Chile', ['chile', '🇨🇱', 'cl']],
  ['BO', 'Bolivia', ['bolivia', '🇧🇴', 'bo']],
  ['PE', 'Perú', ['peru', 'perú', '🇵🇪', 'pe']],
  ['CO', 'Colombia', ['colombia', '🇨🇴', 'co']],
  ['EC', 'Ecuador', ['ecuador', '🇪🇨', 'ec']],
  ['VE', 'Venezuela', ['venezuela', '🇻🇪', 've']],
  ['MX', 'México', ['mexico', 'méxico', '🇲🇽', 'mx']],
  ['US', 'Estados Unidos', ['estados unidos', 'usa', '🇺🇸', 'us']],
  ['CA', 'Canadá', ['canada', 'canadá', '🇨🇦', 'ca']],
  ['ES', 'España', ['espana', 'españa', '🇪🇸', 'es']],
  ['PT', 'Portugal', ['portugal', '🇵🇹', 'pt']],
  ['FR', 'Francia', ['francia', '🇫🇷', 'fr']],
  ['GB', 'Inglaterra', ['inglaterra', 'england', '🇬🇧', '🏴', 'gb']],
  ['DE', 'Alemania', ['alemania', 'germany', '🇩🇪', 'de']],
  ['IT', 'Italia', ['italia', '🇮🇹', 'it']],
  ['NL', 'Países Bajos', ['paises bajos', 'países bajos', 'holanda', '🇳🇱', 'nl']],
  ['JP', 'Japón', ['japon', 'japón', '🇯🇵', 'jp']]
].map(([code, name, aliases]) => ({ code, name, aliases }));
const DEFAULT_VS_CONFIG_VERSION = 6;
const DEFAULT_GIFT_CONFIG_VERSION = 2;
const DEFAULT_GIFT_TURBO_MS = 15000;
const DEFAULT_GIFT_CATALOG = [
  { key: 'rose', name: '🌹 Rosa', value: 1, enabled: true, aliases: ['rose', 'rosa', 'rosita'] },
  { key: 'tiktok', name: '⚽ Pelota / TikTok', value: 1, enabled: false, aliases: ['tiktok', 'ball', 'football', 'soccer', 'soccer ball', 'pelota'] },
  { key: 'ice-cream-cone', name: '🍦 Cono de helado', value: 1, enabled: false, aliases: ['ice cream cone', 'ice cream', 'cono de helado'] },
  { key: 'finger-heart', name: '🤏 Corazón con dedos', value: 5, enabled: false, aliases: ['finger heart', 'hand heart', 'corazon con dedos'] },
  { key: 'panda', name: '🐼 Panda', value: 5, enabled: false, aliases: ['panda'] },
  { key: 'mic', name: '🎤 Micrófono', value: 5, enabled: false, aliases: ['mic', 'microphone', 'microfono'] },
  { key: 'doughnut', name: '🍩 Dona', value: 30, enabled: false, aliases: ['doughnut', 'donut', 'dona'] },
  { key: 'toilet-paper', name: '🧻 Papel higiénico', value: 50, enabled: false, aliases: ['toilet paper', 'toilet roll', 'papel higienico'] },
  { key: 'swan', name: '🦢 Cisne', value: 99, enabled: false, aliases: ['swan', 'cisne'] },
  { key: 'heart', name: '❤️ Corazón', value: 100, enabled: false, aliases: ['heart', 'corazon'] },
  { key: 'confetti', name: '🎊 Confeti', value: 100, enabled: false, aliases: ['confetti', 'confeti'] },
  { key: 'sunglasses', name: '🕶️ Gafas de sol', value: 199, enabled: false, aliases: ['sunglasses', 'gafas de sol'] },
  { key: 'crown', name: '👑 Corona', value: 199, enabled: false, aliases: ['crown', 'corona'] },
  { key: 'boxing-gloves', name: '🥊 Guantes de boxeo', value: 299, enabled: false, aliases: ['boxing gloves', 'guantes de boxeo'] },
  { key: 'corgi', name: '🐶 Corgi', value: 299, enabled: false, aliases: ['corgi'] },
  { key: 'money-rain', name: '💰 Lluvia de dinero', value: 500, enabled: false, aliases: ['money rain', 'lluvia de dinero'] },
  { key: 'diamond', name: '💎 Diamante', value: 1000, enabled: false, aliases: ['diamond', 'diamante'] },
  { key: 'fireworks', name: '🎆 Fuegos artificiales', value: 1088, enabled: false, aliases: ['fireworks', 'fuegos artificiales'] },
  { key: 'train', name: '🚂 Tren', value: 2988, enabled: false, aliases: ['train', 'tren'] },
  { key: 'motorcycle', name: '🏍️ Motocicleta', value: 2988, enabled: false, aliases: ['motorcycle', 'motorbike', 'motocicleta'] },
  { key: 'private-jet', name: '✈️ Avión privado', value: 6000, enabled: false, aliases: ['private jet', 'avion privado'] },
  { key: 'sports-car', name: '🏎️ Auto deportivo', value: 7000, enabled: false, aliases: ['sports car', 'auto deportivo'] },
  { key: 'yacht', name: '🛥️ Yate', value: 9888, enabled: false, aliases: ['yacht', 'yate'] },
  { key: 'eagle', name: '🦅 Águila', value: 10999, enabled: false, aliases: ['eagle', 'aguila'] },
  { key: 'rocket', name: '🚀 Cohete', value: 20000, enabled: false, aliases: ['rocket', 'cohete'] },
  { key: 'fantasy-castle', name: '🏰 Castillo de fantasía', value: 20000, enabled: false, aliases: ['fantasy castle', 'castillo de fantasia'] },
  { key: 'lion', name: '🦁 León', value: 29999, enabled: false, aliases: ['lion', 'leon'] },
  { key: 'tiktok-universe', name: '🪐 Universo TikTok', value: 44999, enabled: false, aliases: ['tiktok universe', 'universo tiktok'] }
].map(item => ({
  ...item,
  icon: [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(item.name)][0]?.segment || '🎁',
  enabled: true
}));
const DEFAULT_VS = [
  { k: 'cp|ol', label: 'OLIMPIA vs CERRO', on: true, popular: true },
  { k: 'ucl-bc|ucl-rm', label: 'BARCELONA vs REAL MADRID', on: true, popular: true },
  { k: 'ca-ar|ca-py', label: 'PARAGUAY vs ARGENTINA', on: true, popular: true },
  { k: 'ca-br|ca-py', label: 'PARAGUAY vs BRASIL', on: true, popular: true }
];
const TEAM_NAMES = {
  ol: 'Olimpia', cp: 'Cerro Porteño', 'ucl-bc': 'Barcelona', 'ucl-rm': 'Real Madrid',
  'ca-ar': 'Argentina', 'ca-br': 'Brasil', 'ca-py': 'Paraguay',
  'lib-boc': 'Boca Juniors', 'lib-riv': 'River Plate', 'cl-cel': 'Celtic', 'cl-ran': 'Rangers',
  'cl-int': 'Inter de Milán', 'ucl-milan': 'Milan', 'cl-mu': 'Manchester United', 'ucl-lv': 'Liverpool',
  'cl-nau': 'Nacional (Uruguay)', 'lib-pen': 'Peñarol', 'cl-fen': 'Fenerbahçe', 'cl-gal': 'Galatasaray',
  'cl-ahl': 'Al Ahly', 'cl-zam': 'Zamalek', 'cl-ame': 'América', 'cl-chi': 'Chivas',
  'cl-flu': 'Fluminense', 'lib-fla': 'Flamengo', 'cl-gre': 'Grêmio', 'cl-sci': 'Internacional',
  'cl-aja': 'Ajax', 'cl-fey': 'Feyenoord', 'cl-crv': 'Estrella Roja', 'cl-par': 'Partizán',
  'ct-ar': 'Argentina', 'ct-br': 'Brasil', 'ct-uy': 'Uruguay', 'ct-en': 'Inglaterra',
  'ct-sc': 'Escocia', 'ct-de': 'Alemania', 'ct-nl': 'Países Bajos', 'ct-it': 'Italia'
};
const TEAM_FLAGS = {
  ol: '⚪⚫', cp: '🔵🔴', 'ucl-bc': '🔵🔴', 'ucl-rm': '⚪',
  'lib-boc': '🔵🟡', 'lib-riv': '⚪🔴', 'cl-cel': '🟢⚪', 'cl-ran': '🔵',
  'cl-int': '🔵⚫', 'ucl-milan': '🔴⚫', 'cl-mu': '🔴', 'ucl-lv': '🔴',
  'cl-nau': '⚪🔵', 'lib-pen': '🟡⚫', 'cl-fen': '🟡🔵', 'cl-gal': '🔴🟡',
  'cl-ahl': '🔴', 'cl-zam': '⚪', 'cl-ame': '🟡🔵', 'cl-chi': '🔴⚪',
  'cl-flu': '🟢🔴', 'lib-fla': '🔴⚫', 'cl-gre': '🔵⚫', 'cl-sci': '🔴',
  'cl-aja': '⚪🔴', 'cl-fey': '🔴⚪', 'cl-crv': '🔴⚪', 'cl-par': '⚫⚪',
  'ca-ar': '🇦🇷', 'ca-br': '🇧🇷', 'ca-py': '🇵🇾',
  'ct-ar': '🇦🇷', 'ct-br': '🇧🇷', 'ct-uy': '🇺🇾', 'ct-en': '🏴',
  'ct-sc': '🏴', 'ct-de': '🇩🇪', 'ct-nl': '🇳🇱', 'ct-it': '🇮🇹'
};
const DEFAULT_TEAM_CATALOG = Object.keys(TEAM_NAMES)
  .map(id => ({ id, name: TEAM_NAMES[id], flag: TEAM_FLAGS[id] || '🏳️' }));
const ALLOWED_STATE_KEY = /^cluss\.(?:v1|torneoLock|lang|crest\.[\w-]+|vs|gifts|honorLastGift|honorLastGiftTeams|voice|stats|libreVotes|chatArchive|log\.[\w.-]+)$/;

const clients = new Set();
const toolClients = new Set();
const motorClients = new Set();
const heartbeats = new Map();
const adminSessions = new Map();
const recentUsers = [];
const seenEventIds = new Map();
const comboCounts = new Map();
const acceptedTeamGifts = new Map();
const teamGiftHistory = new Map();
const technicalLogs = [];
const pendingCountryComments = Object.fromEntries([...COUNTRIES.map(country => country.code), 'sin-pais'].map(code => [code, 0]));
const connection = { connected: false, status: 'connecting', username: '' };
let diagnosticUntil = 0;
let connector = null;
let connectionAttemptId = 0;
let retryTimer = null;
let retryDeadline = 0;
let retryCount = 0;
let lastUsernameSwitchAt = 0;
let shuttingDown = false;
let adminToken = process.env.BACKEND_ADMIN_TOKEN || (process.env.NODE_ENV === 'production' ? '' : '123');
const ADMIN_SESSION_COOKIE = 'tortu_admin_session';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TECHNICAL_LOGS = 200;
const MAX_SAVED_USERNAMES = 24;
let chatMetaQueue = Promise.resolve();
let teamGiftArchiveQueue = Promise.resolve();
let settings = {
  username: '',
  savedUsernames: ['tortulive'],
  giftTurboProgress: 6,
  tapTurboProgress: 20,
  timerStartedAt: Date.now(),
  giftCount: 0,
  tournamentEnabled: false,
  recentUsers: [],
  countryStats: Object.fromEntries([...COUNTRIES.map(country => country.code), 'sin-pais'].map(code => [code, { comments: 0, cups: 0 }]))
};
let overlayActive = false;
let motorTelemetry = null;
let giftCatalogConfig = giftConfigView(null);
let latestHonorGift = null;

function normalizeUsername(value) {
  return String(value || '').trim().replace(/@/g, '').replace(/\s+/g, '');
}

function configuredUsername(savedUsername = settings.username) {
  return normalizeUsername(savedUsername || process.env.TIKTOK_USERNAME || 'tortulive');
}

function usernameHistory(saved = settings.savedUsernames, selected = configuredUsername()) {
  const usernames = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(saved) ? saved : []), selected, 'radiofenica', 'reciclemaiis', 'tortulive']) {
    if (typeof value !== 'string') continue;
    const username = normalizeUsername(value);
    const key = username.toLowerCase();
    if (!username || seen.has(key)) continue;
    seen.add(key);
    usernames.push(username);
    if (usernames.length === MAX_SAVED_USERNAMES) break;
  }
  return usernames;
}

function nextSavedUsername(current, candidates = usernameHistory()) {
  const usernames = Array.from(new Set(candidates.map(normalizeUsername).filter(Boolean)));
  if (!usernames.length) return '';
  const currentIndex = usernames.findIndex(username => username.toLowerCase() === normalizeUsername(current).toLowerCase());
  return usernames[currentIndex < 0 ? 0 : (currentIndex + 1) % usernames.length];
}

function isSameOriginRequest(req) {
  if (typeof req.headers.origin !== 'string' || typeof req.headers.host !== 'string') return false;
  try {
    return new URL(req.headers.origin).host.toLowerCase() === req.headers.host.toLowerCase();
  } catch {
    return false;
  }
}

function rememberUsername(value) {
  const username = normalizeUsername(value);
  const remaining = usernameHistory().filter(item => item.toLowerCase() !== username.toLowerCase());
  settings.username = username;
  settings.savedUsernames = [username, ...remaining].slice(0, MAX_SAVED_USERNAMES);
  return settings.savedUsernames;
}

function vsConfigView(value) {
  const current = value?.v === DEFAULT_VS_CONFIG_VERSION && Array.isArray(value.list);
  const legacy = [3, 4, 5].includes(value?.v) && Array.isArray(value.list);
  const compatible = current || legacy;
  const storedList = compatible ? value.list.filter(item => item && typeof item.k === 'string') : [];
  const enabled = new Map(storedList.map(item => [item.k, item.on !== false]));
  const popular = new Map(storedList.map(item => [item.k, item.popular === true]));
  const list = DEFAULT_VS.map(item => ({
    k: item.k,
    label: item.label,
    on: compatible ? (enabled.has(item.k) ? enabled.get(item.k) : item.on) : item.on,
    popular: current ? (popular.has(item.k) ? popular.get(item.k) : item.popular === true) : item.popular === true
  }));
  const raceList = current && Array.isArray(value.raceList)
    ? value.raceList.filter(item => item && list.some(duel => duel.k === item.k && duel.on))
      .map(item => ({ k: item.k, played: item.played === true }))
    : [];
  if (!raceList.length) {
    const popularRaces = list.filter(item => item.on && item.popular);
    const next = list.find(item => item.on && !item.popular);
    raceList.push(...popularRaces.map(item => ({ k: item.k, played: false })));
    if (next) raceList.push({ k: next.k, played: false });
  }
  return {
    v: DEFAULT_VS_CONFIG_VERSION,
    cur: compatible && list.some(item => item.k === value.cur) ? value.cur : DEFAULT_VS[0].k,
    np: (current || value?.v === 4) && list.some(item => item.k === value.np) ? value.np : '',
    raceList,
    list,
    st: value?.st && typeof value.st === 'object' && !Array.isArray(value.st) ? value.st : {}
  };
}

function giftNameKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function giftCatalogKey(name, giftId) {
  const key = giftNameKey(name);
  const known = giftCatalogConfig.catalog.find(item => item.key === key || item.aliases.includes(key));
  if (known) return known.key;
  return key || (giftId ? `id-${giftNameKey(giftId)}` : '');
}

function giftIcon(value) {
  const segment = [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(String(value || '').trim())][0]?.segment;
  return segment && /\p{Extended_Pictographic}/u.test(segment) ? segment : '🎁';
}

function giftConfigView(value) {
  const current = value?.v === DEFAULT_GIFT_CONFIG_VERSION && Array.isArray(value.catalog);
  const migrating = value?.v === 1 && Array.isArray(value.catalog);
  const stored = new Map();
  for (const item of current || migrating ? value.catalog : []) {
    if (!item || typeof item.key !== 'string' || typeof item.name !== 'string') continue;
    const key = giftNameKey(item.key);
    const name = item.name.trim().slice(0, 120);
    if (!key || !name || stored.has(key)) continue;
    const itemValue = Number(item.value);
    stored.set(key, {
      key,
      name,
      icon: giftIcon(item.icon || name),
      imageUrl: /^https:\/\//i.test(String(item.imageUrl || item.avatarUrl || ''))
        ? String(item.imageUrl || item.avatarUrl).trim()
        : '',
      value: Number.isFinite(itemValue) ? Math.min(1000000, Math.max(0, Math.floor(itemValue))) : 0,
      enabled: migrating || item.enabled === true,
      aliases: Array.isArray(item.aliases)
        ? [...new Set(item.aliases.filter(alias => typeof alias === 'string').map(giftNameKey).filter(Boolean))]
        : []
    });
  }
  const defaultKeys = new Set(DEFAULT_GIFT_CATALOG.map(item => item.key));
  const catalog = DEFAULT_GIFT_CATALOG.map(item => {
    const previous = stored.get(item.key);
    return {
      ...item,
      enabled: previous ? previous.enabled : item.enabled,
      imageUrl: previous?.imageUrl || item.imageUrl || '',
      aliases: [...new Set([...item.aliases.map(giftNameKey), ...(previous?.aliases || [])])]
    };
  });
  stored.forEach(item => {
    if (!defaultKeys.has(item.key)) catalog.push({ ...item, value: 0 });
  });
  const rotation = Number(value?.rotationSeconds);
  return {
    v: DEFAULT_GIFT_CONFIG_VERSION,
    rotationSeconds: Number.isInteger(rotation) ? Math.min(3600, Math.max(1, rotation)) : 10,
    catalog
  };
}

function honorGiftConfig(value = giftCatalogConfig) {
  return {
    rotationSeconds: value.rotationSeconds,
    catalog: value.catalog.map(item => {
      const imageUrl = item.imageUrl || '';
      return {
        key: item.key,
        name: item.name.startsWith(item.icon) ? item.name.slice(item.icon.length).trim() : item.name,
        value: item.value,
        enabled: item.enabled,
        aliases: item.aliases,
        emoji: item.icon,
        ...(imageUrl ? { imageUrl } : {})
      };
    })
  };
}

let honorGiftUpdateQueue = Promise.resolve();
function rememberLatestHonorGift(entry) {
  const gift = giftCatalogConfig.catalog.find(item => item.key === giftCatalogKey(entry.giftName, entry.giftId));
  latestHonorGift = {
    username: entry.username,
    displayName: entry.displayName,
    avatarUrl: entry.profilePictureUrl,
    giftKey: gift?.key || giftCatalogKey(entry.giftName, entry.giftId),
    giftName: entry.giftName,
    giftIcon: gift?.icon || giftIcon(entry.giftName),
    giftDiamonds: entry.giftDiamonds,
    activityCount: entry.activityCount,
    receivedAt: entry.receivedAt
  };
  const saved = latestHonorGift;
  honorGiftUpdateQueue = honorGiftUpdateQueue.catch(() => {}).then(() => setState('cluss.honorLastGift', saved));
  return honorGiftUpdateQueue;
}

const teamGiftArchivePath = resolve(DATA_DIR, 'team-gifts.jsonl');

function cacheTeamGiftRecord(record) {
  const team = teamGiftHistory.get(record.teamId) || { total: 0, records: [] };
  team.total++;
  team.records.unshift(record);
  if (team.records.length > MAX_TEAM_GIFT_HISTORY_ITEMS) team.records.length = MAX_TEAM_GIFT_HISTORY_ITEMS;
  teamGiftHistory.set(record.teamId, team);
}

function normalizeTeamGiftRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const teamId = String(value.teamId || '');
  const username = normalizeUsername(value.username);
  const receivedAt = Number(value.receivedAt);
  if (!TEAM_NAMES[teamId] || !username || !Number.isFinite(receivedAt)) return null;
  return {
    eventId: String(value.eventId || '').slice(0, 300),
    teamId,
    teamName: String(value.teamName || TEAM_NAMES[teamId]).slice(0, 80),
    username,
    displayName: String(value.displayName || username).slice(0, 100),
    avatarUrl: /^https:\/\//i.test(String(value.avatarUrl || '')) ? String(value.avatarUrl).slice(0, 2000) : '',
    giftName: String(value.giftName || 'Regalo').slice(0, 120),
    giftDiamonds: Math.max(0, Number(value.giftDiamonds) || 0),
    activityCount: Math.max(1, Math.floor(Number(value.activityCount) || 1)),
    receivedAt
  };
}

async function loadTeamGiftArchive() {
  if (!existsSync(teamGiftArchivePath)) {
    const saved = await getState('cluss.honorLastGiftTeams');
    const records = { ...saved.value?.teams, ...saved.value?.byTeam };
    const legacy = Object.entries(records)
      .map(([teamId, value]) => normalizeTeamGiftRecord({
        ...value,
        teamId,
        eventId: `legacy:${teamId}:${value?.receivedAt || 0}:${value?.username || ''}`
      }))
      .filter(Boolean);
    if (legacy.length) {
      await mkdir(dirname(teamGiftArchivePath), { recursive: true });
      await writeFile(teamGiftArchivePath, `${legacy.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8');
      legacy.forEach(cacheTeamGiftRecord);
    }
    return;
  }

  const lines = createInterface({ input: createReadStream(teamGiftArchivePath), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (!line) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      recordTechnicalLog('error', `Registro ${lineNumber} inválido en el historial de regalos por equipo: ${error.message}`);
      continue;
    }
    const record = normalizeTeamGiftRecord(value);
    if (!record) {
      recordTechnicalLog('error', `Registro ${lineNumber} inválido en el historial de regalos por equipo.`);
      continue;
    }
    cacheTeamGiftRecord(record);
  }
}

function persistTeamGiftRecord(record) {
  const write = teamGiftArchiveQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(teamGiftArchivePath), { recursive: true });
    await appendFile(teamGiftArchivePath, `${JSON.stringify(record)}\n`, 'utf8');
    cacheTeamGiftRecord(record);
  });
  teamGiftArchiveQueue = write;
  return write;
}

function eventUser(data) {
  return data?.user || data?.author || data?.member || {};
}

function eventId(data) {
  return String(data?.msgId || data?.messageId || data?.eventId || data?.common?.msgId || '');
}

function eventUsername(data) {
  const user = eventUser(data);
  return normalizeUsername(user.uniqueId || user.unique_id || user.username || user.displayId || data?.uniqueId || data?.unique_id || '');
}

function eventDisplayName(data) {
  const user = eventUser(data);
  return String(user.nickname || user.displayName || user.name || data?.nickname || data?.displayName || '').trim().slice(0, 100);
}

function eventAvatar(data) {
  const user = eventUser(data);
  const findUrl = (value, depth = 0) => {
    if (depth > 5) return '';
    if (typeof value === 'string') return /^https:\/\//i.test(value.trim()) ? value.trim() : '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = findUrl(item, depth + 1);
        if (url) return url;
      }
      return '';
    }
    if (!value || typeof value !== 'object') return '';
    for (const key of ['url', 'uri', 'urlList', 'urls', 'profilePictureUrl', 'profilePictureUrls']) {
      const url = findUrl(value[key], depth + 1);
      if (url) return url;
    }
    return '';
  };
  const candidates = [
    user.profilePictureUrl, user.profilePicture, user.profilePictureMedium, user.profilePictureLarge,
    user.userDetails?.profilePictureUrls, user.avatarUrl, user.avatarLarge, user.avatarLarger, user.avatarMedium,
    user.avatarThumb, user.avatar, user.userImage, user.imageUrl,
    data?.profilePictureUrl, data?.profilePicture, data?.profilePictureMedium, data?.profilePictureLarge,
    data?.userDetails?.profilePictureUrls, data?.avatarUrl, data?.avatarLarge, data?.avatarLarger,
    data?.avatarMedium, data?.avatarThumb, data?.avatar, data?.userImage, data?.imageUrl
  ];
  for (const candidate of candidates) {
    const url = findUrl(candidate);
    if (url) return url;
  }
  return '';
}

function eventGiftImage(data) {
  const candidates = [
    data?.giftImageUrl, data?.gift_image_url, data?.giftDetails?.giftImageUrl,
    data?.giftDetails?.imageUrl, data?.giftDetails?.image, data?.gift?.imageUrl, data?.gift?.image
  ];
  const findImageUrl = (value, depth = 0) => {
    if (depth > 5) return '';
    if (typeof value === 'string') return /^https:\/\//i.test(value.trim()) ? value.trim() : '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = findImageUrl(item, depth + 1);
        if (url) return url;
      }
      return '';
    }
    if (!value || typeof value !== 'object') return '';
    for (const key of ['url', 'uri', 'urlList', 'urls', 'imageUrl', 'giftImageUrl']) {
      const url = findImageUrl(value[key], depth + 1);
      if (url) return url;
    }
    return '';
  };
  for (const candidate of candidates) {
    const url = findImageUrl(candidate);
    if (url) return url;
  }
  return '';
}

function dedupeEvent(data, type) {
  const id = eventId(data);
  if (!id) return false;
  const now = Date.now();
  for (const [key, seenAt] of seenEventIds) {
    if (now - seenAt > 10 * 60 * 1000) seenEventIds.delete(key);
  }
  const key = `${type}:${id}:${type === 'gift' ? data.repeatCount ?? data.giftDetails?.repeatCount ?? '' : ''}`;
  if (seenEventIds.has(key)) return true;
  seenEventIds.set(key, now);
  return false;
}

function normalizeTikTokEvent(type, data) {
  if (!EVENT_TYPES.has(type) || !data || typeof data !== 'object') return null;
  const username = eventUsername(data);
  const entry = {
    type,
    username,
    displayName: eventDisplayName(data),
    content: type === 'chat' ? String(data.comment ?? data.content ?? '').slice(0, 500) : '',
    activityCount: 1,
    giftName: '',
    profilePictureUrl: eventAvatar(data)
  };
  if (type === 'like') {
    entry.activityCount = Math.max(1, Math.floor(Number(data.activityCount ?? data.likeCount ?? data.count ?? 1) || 1));
  } else if (type === 'gift') {
    entry.activityCount = Math.max(1, Math.floor(Number(data.activityCount ?? data.repeatCount ?? data.giftDetails?.repeatCount ?? data.count ?? 1) || 1));
    entry.giftName = String(data.giftName || data.gift_name || data.giftDetails?.giftName || data.gift?.name || data.gift || data.giftId || '').slice(0, 120);
    entry.giftId = String(data.giftId ?? data.gift_id ?? data.giftDetails?.giftId ?? data.giftDetails?.gift_id ?? data.gift?.id ?? '').slice(0, 80);
    entry.eventId = eventId(data);
    const giftImageUrl = eventGiftImage(data);
    if (giftImageUrl) entry.giftImageUrl = giftImageUrl;
    const diamonds = Number(data.diamondCount ?? data.diamond_count ?? data.giftDetails?.diamondCount ?? data.giftDetails?.diamond_count ?? data.gift?.diamondCount ?? data.gift?.diamond_count ?? 0);
    entry.giftValue = Number.isFinite(diamonds) && diamonds > 0 ? Math.floor(diamonds) : 0;
    entry.giftDiamonds = entry.giftValue;
  }
  if (!entry.username && !entry.displayName && type !== 'chat') return null;
  if (type === 'chat' && !entry.content) return null;
  return entry;
}

function comboDelta(data) {
  const giftType = Number(data.giftType ?? data.giftDetails?.giftType ?? 0);
  const repeatCount = Math.max(1, Math.floor(Number(data.repeatCount ?? data.giftDetails?.repeatCount ?? 1) || 1));
  if (giftType !== 1) return repeatCount;
  const user = eventUsername(data);
  const giftId = String(data.giftId || data.giftDetails?.giftId || 'unknown');
  const groupId = String(data.groupId || data.comboId || data.msgId || `${user}:${giftId}`);
  const key = `${user}:${giftId}:${groupId}`;
  const previous = comboCounts.get(key) || 0;
  const delta = Math.max(0, repeatCount - previous);
  if (data.repeatEnd === true || data.streaking === false) comboCounts.delete(key);
  else comboCounts.set(key, repeatCount);
  return delta;
}

function socialEventType(data) {
  const action = String(
    data?.action || data?.displayType || data?.label ||
    data?.common?.displayText?.key || data?.common?.displayText?.defaultPattern ||
    data?.common?.displayText?.text || ''
  ).toLowerCase();
  if (data?.follow === true || /follow|seguir/.test(action)) return 'follow';
  if (data?.share === true || data?.shareType || data?.shareTarget || /share|compart/.test(action)) return 'share';
  return '';
}

function identifyCountry(text) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return COUNTRIES.find(country => country.aliases.some(alias => {
    const needle = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return needle.startsWith('🇵') || needle.startsWith('🇦') || needle.startsWith('🇧') ||
      needle.startsWith('🇺') || needle.startsWith('🇨') || needle.startsWith('🇲') ||
      needle.startsWith('🇪') || needle.startsWith('🇫') || needle.startsWith('🇬') ||
      needle.startsWith('🇮') || needle.startsWith('🇳') || needle.startsWith('🇯')
      ? String(text || '').includes(alias)
      : new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, 'iu').test(value);
  })) || null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeLogMessage(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redactado]')
    .replace(/\b(token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redactado]')
    .slice(0, 500);
}

function recordTechnicalLog(level, message) {
  const entry = { timestamp: Date.now(), level, message: safeLogMessage(message) };
  technicalLogs.unshift(entry);
  if (technicalLogs.length > MAX_TECHNICAL_LOGS) technicalLogs.length = MAX_TECHNICAL_LOGS;
  if (level === 'error') console.error(entry.message);
  else console.log(entry.message);
}

function diagnosticModeState() {
  const active = diagnosticUntil > Date.now();
  return { active, expiresAt: active ? new Date(diagnosticUntil).toISOString() : null };
}

function setDiagnosticMode(enabled) {
  diagnosticUntil = enabled ? Date.now() + 10 * 60 * 1000 : 0;
  const state = diagnosticModeState();
  broadcastSse(clients, 'diagnostic-mode', state);
  recordTechnicalLog('info', `Registro detallado ${state.active ? 'activado durante 10 minutos' : 'desactivado'} en los overlays`);
  return state;
}

function setStatus(status, connected) {
  connection.status = status;
  connection.connected = connected;
  recordTechnicalLog('info', `TikTok: ${status}${connection.username ? ` · @${connection.username}` : ''}`);
  broadcastSse(clients, 'status', { connected, status, username: connection.username });
}

function broadcastSse(pool, event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of pool) {
    if (!response.write(frame)) pool.delete(response);
  }
}

function broadcastTool(event, data) {
  broadcastSse(toolClients, event, data);
}

function normalizeMotorTelemetry(value) {
  const phases = new Set(['starting', 'running', 'finished', 'waiting']);
  const types = ['member', 'chat', 'gift', 'like', 'follow', 'share'];
  if (!value || typeof value !== 'object' || !phases.has(value.phase) || !Array.isArray(value.teams) || value.teams.length !== 2) {
    return null;
  }
  const teams = value.teams.map(team => {
    if (!team || typeof team.id !== 'string' || typeof team.name !== 'string') return null;
    const number = (input, max) => {
      const result = Number(input);
      return Number.isFinite(result) ? Math.min(max, Math.max(0, result)) : null;
    };
    const progress = number(team.progress, 100);
    const taps = number(team.taps, 1000000);
    const tapLimit = number(team.tapLimit, 100);
    const eventTotal = number(team.eventTotal, 100000000);
    const turboMs = number(team.turboMs, 60000);
    const giftTurboMs = number(team.giftTurboMs, 60000);
    if ([progress, taps, tapLimit, eventTotal, turboMs, giftTurboMs].some(item => item === null) || tapLimit < 1) return null;
    return {
      id: team.id.slice(0, 40),
      name: team.name.slice(0, 80),
      progress,
      taps,
      tapLimit,
      eventTotal,
      turboMs,
      giftTurboMs
    };
  });
  if (teams.some(team => team === null)) return null;
  const stats = {};
  for (const type of types) {
    const count = Number(value.stats?.[type]);
    stats[type] = Number.isFinite(count) ? Math.min(100000000, Math.max(0, Math.floor(count))) : 0;
  }
  const elapsedMs = Number(value.elapsedMs);
  const idleSeconds = Number(value.idleSeconds);
  const turboValue = (input, max) => {
    const result = Number(input);
    return Number.isFinite(result) ? Math.min(max, Math.max(0, result)) : 0;
  };
  return {
    updatedAt: Date.now(),
    phase: value.phase,
    elapsedMs: Number.isFinite(elapsedMs) ? Math.min(86400000, Math.max(0, elapsedMs)) : 0,
    idleSeconds: Number.isFinite(idleSeconds) ? Math.min(86400, Math.max(0, idleSeconds)) : 0,
    winner: typeof value.winner === 'string' ? value.winner.slice(0, 80) : '',
    stats,
    teams,
    turbo: {
      tapProgress: turboValue(value.turbo?.tapProgress, 100),
      tapDurationMs: turboValue(value.turbo?.tapDurationMs, 60000),
      giftProgress: turboValue(value.turbo?.giftProgress, 100),
      giftDurationMs: turboValue(value.turbo?.giftDurationMs, 60000)
    }
  };
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 25 * (attempt + 1)));
      }
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function statePath(key) {
  if (!ALLOWED_STATE_KEY.test(key)) return null;
  return resolve(DATA_DIR, 'state', `${Buffer.from(key).toString('base64url')}.json`);
}

function logPath(flow) {
  if (flow !== 'chat-texts' && flow !== 'user-events') return null;
  return resolve(DATA_DIR, 'logs', `${flow}.jsonl`);
}

async function readLog(flow) {
  const path = logPath(flow);
  if (!path) return [];
  try {
    const text = await readFile(path, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendRecords(flow, records) {
  const path = logPath(flow);
  if (!path || !Array.isArray(records) || records.length > MAX_LOG_BATCH) {
    throw new Error('Flujo o lote inválido.');
  }
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const clean = [];
  for (const record of records) {
    if (flow === 'chat-texts') {
      if (!Array.isArray(record) || record.length < 2) continue;
      const timestamp = Number(record[0]);
      const text = String(record[1] || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (Number.isFinite(timestamp) && timestamp >= cutoff && text) clean.push([timestamp, text]);
    } else {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const timestamp = Number(record.t);
      const username = normalizeUsername(record.u).toLowerCase();
      const type = String(record.type || '');
      if (!Number.isFinite(timestamp) || timestamp < cutoff || !username || !EVENT_TYPES.has(type)) continue;
      const item = { u: username, name: String(record.name || username).slice(0, 100), t: timestamp, type };
      if (Number.isFinite(Number(record.n))) item.n = Math.max(1, Math.floor(Number(record.n)));
      if (typeof record.text === 'string') item.text = record.text.slice(0, 500);
      if (typeof record.gift === 'string') item.gift = record.gift.slice(0, 120);
      clean.push(item);
    }
  }
  if (clean.length) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, clean.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    if (flow === 'chat-texts') {
      chatMetaQueue = chatMetaQueue.catch(error => {
        recordTechnicalLog('error', `Falló la actualización del índice del chat: ${error.message}`);
      }).then(async () => {
        const metaPath = resolve(DATA_DIR, 'chat-archive-meta.json');
        const meta = await loadJson(metaPath, { v: 1, created: clean[0][0], updated: clean[0][0], trimmed: 0, count: 0 });
        const times = clean.map(record => record[0]);
        meta.created = meta.count ? Math.min(meta.created, ...times) : times.reduce((min, time) => Math.min(min, time), Infinity);
        meta.updated = times.reduce((max, time) => Math.max(max, time), meta.updated);
        meta.count += clean.length;
        await writeJsonAtomic(metaPath, meta);
      });
      await chatMetaQueue;
    }
  }
  return clean.length;
}

async function pruneLogs() {
  for (const flow of ['chat-texts', 'user-events']) {
    const path = logPath(flow);
    if (!existsSync(path)) continue;
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    const records = (await readLog(flow)).filter(record => {
      const timestamp = Array.isArray(record) ? Number(record[0]) : Number(record.t);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    const temp = path.replace(/\.jsonl$/, '.prune.tmp');
    await writeFile(temp, records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
    await rename(temp, path);
    if (flow === 'chat-texts') {
      const metaPath = resolve(DATA_DIR, 'chat-archive-meta.json');
      const meta = await loadJson(metaPath, { v: 1, created: Date.now(), updated: Date.now(), trimmed: 0, count: 0 });
      const oldCount = meta.count || 0;
      const times = records.map(record => Number(record[0])).filter(Number.isFinite);
      meta.trimmed = (meta.trimmed || 0) + Math.max(0, oldCount - records.length);
      meta.count = records.length;
      if (times.length) {
        meta.created = times.reduce((min, time) => Math.min(min, time), Infinity);
        meta.updated = times.reduce((max, time) => Math.max(max, time), -Infinity);
      }
      await writeJsonAtomic(metaPath, meta);
    }
  }
}

function refreshOverlayPresence() {
  const cutoff = Date.now() - 90000;
  for (const [id, at] of heartbeats) if (at < cutoff) heartbeats.delete(id);
  const active = heartbeats.size > 0;
  if (overlayActive && !active) void sendWhatsApp({ type: 'overlay-inactive', at: Date.now() });
  overlayActive = active;
}

async function getState(key) {
  const path = statePath(key);
  if (!path) return { found: false };
  try {
    return { found: true, value: JSON.parse(await readFile(path, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { found: false };
    throw error;
  }
}

async function loadGiftConfig() {
  const stored = await getState('cluss.gifts');
  giftCatalogConfig = giftConfigView(stored.value);
  if (!stored.found || stored.value?.v !== DEFAULT_GIFT_CONFIG_VERSION) {
    await setState('cluss.gifts', giftCatalogConfig);
  }
  return giftCatalogConfig;
}

function voiceConfigView(value) {
  const minutes = Number(value?.repeatCooldownMinutes);
  return {
    repeatCooldownMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440
      ? minutes
      : voicePriority.repeatCooldownMinutes,
    donTortuEnabled: value?.donTortuEnabled !== false,
    enabledLevels: Object.fromEntries(voicePriority.levels.map(level => [level.id, true]))
  };
}

async function loadVoiceConfig() {
  const stored = await getState('cluss.voice');
  return voiceConfigView(stored.value);
}

async function setState(key, value) {
  const path = statePath(key);
  if (!path) throw new Error('Clave de estado no permitida.');
  await writeJsonAtomic(path, value);
}

let giftCatalogUpdateQueue = Promise.resolve();
function rememberGiftCatalogEntry(entry) {
  const key = giftCatalogKey(entry.giftName, entry.giftId);
  if (!key) return Promise.resolve();
  giftCatalogUpdateQueue = giftCatalogUpdateQueue.catch(() => {}).then(async () => {
    const item = giftCatalogConfig.catalog.find(gift => gift.key === key);
    if (item) return;
    giftCatalogConfig.catalog.push({
      key,
      name: String(entry.giftName || `Regalo ${entry.giftId}`).trim().slice(0, 120),
      value: 0,
      enabled: false,
      aliases: [giftNameKey(entry.giftName)].filter(Boolean)
    });
    await setState('cluss.gifts', giftCatalogConfig);
    broadcastTool('gift-config', honorGiftConfig());
  });
  return giftCatalogUpdateQueue;
}

async function deleteState(key) {
  const path = statePath(key);
  if (!path) throw new Error('Clave de estado no permitida.');
  await rm(path, { force: true });
}

async function stateSnapshot() {
  const dir = resolve(DATA_DIR, 'state');
  let names = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const state = {};
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let key;
    try {
      key = Buffer.from(name.slice(0, -5), 'base64url').toString('utf8');
    } catch {
      continue;
    }
    if (!ALLOWED_STATE_KEY.test(key) || key.startsWith('cluss.log.')) continue;
    const item = await getState(key);
    if (!item.found) continue;
    if (key === 'cluss.gifts') {
      state[key] = giftConfigView(item.value);
      if (item.value?.v !== DEFAULT_GIFT_CONFIG_VERSION) {
        await setState(key, state[key]);
      }
    } else {
      state[key] = item.value;
    }
  }
  if (!state['cluss.gifts']) {
    state['cluss.gifts'] = giftConfigView(null);
    await setState('cluss.gifts', state['cluss.gifts']);
  }
  if (!state['cluss.chatArchive']) {
    const meta = await loadJson(resolve(DATA_DIR, 'chat-archive-meta.json'), null);
    state['cluss.chatArchive'] = {
      v: 1,
      created: meta?.created || Date.now(),
      updated: meta?.updated || Date.now(),
      trimmed: meta?.trimmed || 0,
      count: meta?.count || 0
    };
  }
  return state;
}

async function persistSettings() {
  await writeJsonAtomic(resolve(DATA_DIR, 'settings.json'), settings);
}

async function createConnection(username) {
  const requestedUsername = normalizeUsername(username);
  if (!requestedUsername || (connection.connected && connection.username === requestedUsername)) return;
  const attemptId = ++connectionAttemptId;
  const previousConnection = connector;
  connector = null;
  connection.username = requestedUsername;
  setStatus(retryCount ? 'reconnecting' : 'connecting', false);
  let attemptConnection = null;
  try {
    if (previousConnection?.disconnect) {
      try {
        await previousConnection.disconnect();
      } catch (error) {
        recordTechnicalLog('error', `No se pudo cerrar la conexión anterior de TikTok: ${error.message}`);
      }
    }
    if (attemptId !== connectionAttemptId) return;
    const module = await import('tiktok-live-connector');
    const Connector = module.TikTokLiveConnection || module.WebcastPushConnection ||
      module.default?.TikTokLiveConnection || module.default?.WebcastPushConnection;
    if (typeof Connector !== 'function') throw new Error('No se encontró el conector de TikTok compatible.');
    if (attemptId !== connectionAttemptId) return;
    const instance = new Connector(requestedUsername, { processInitialData: false });
    attemptConnection = instance;
    connector = instance;
    const eventTypes = ['member', 'chat', 'gift', 'like', 'follow', 'share', 'social'];
    for (const type of eventTypes) {
      instance.on(type, raw => {
        if (connector === instance) handleTikTokEvent(type, raw);
      });
    }
    instance.on('disconnected', () => {
      if (!shuttingDown && connector === instance && connection.connected) {
        scheduleReconnect(new Error('TikTok desconectó el live.'));
      }
    });
    instance.on('error', error => {
      if (!shuttingDown && connector === instance && connection.connected) {
        scheduleReconnect(error instanceof Error ? error : new Error(String(error)));
      }
    });
    let timeout;
    try {
      await Promise.race([
        instance.connect(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Tiempo de conexión agotado (10 s).')), 10000);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if (attemptId !== connectionAttemptId) return;
    setStatus('connected', true);
    retryCount = 0;
    retryDeadline = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  } catch (error) {
    if (attemptId !== connectionAttemptId) return;
    if (connector === attemptConnection) connector = null;
    if (attemptConnection?.disconnect) {
      try {
        await attemptConnection.disconnect();
      } catch (disconnectError) {
        recordTechnicalLog('error', `No se pudo cerrar el intento de TikTok: ${disconnectError.message}`);
      }
    }
    if (attemptId !== connectionAttemptId) return;
    setStatus('reconnecting', false);
    scheduleReconnect(error);
  }
}

function scheduleReconnect(error) {
  if (shuttingDown || retryTimer) return;
  const now = Date.now();
  if (!retryDeadline) {
    retryDeadline = now + 5 * 60 * 1000;
    retryCount = 0;
  }
  if (now >= retryDeadline) {
    setStatus('failed', false);
    retryDeadline = 0;
    recordTechnicalLog('error', `TikTok: ciclo de reconexión agotado: ${error.message}`);
    return;
  }
  retryCount++;
  setStatus('reconnecting', false);
  const remaining = retryDeadline - now;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    createConnection(configuredUsername());
  }, Math.min(5000, remaining));
}

function handleTikTokEvent(type, raw) {
  if (type === 'social') {
    type = socialEventType(raw);
    if (!type) return;
  }
  if (!EVENT_TYPES.has(type) || (type === 'gift' && (raw?.bot || raw?.emulated)) || dedupeEvent(raw, type)) return;
  const entry = normalizeTikTokEvent(type, raw);
  if (!entry) return;
  if (type === 'gift') {
    entry.activityCount = comboDelta(raw);
    if (entry.activityCount < 1) return;
    const sourceId = eventId(raw), repeatCount = raw.repeatCount ?? raw.giftDetails?.repeatCount ?? 1;
    entry.eventId = sourceId
      ? `${sourceId}${Number(raw.giftType ?? raw.giftDetails?.giftType) === 1 ? `:${repeatCount}` : ''}`
      : randomUUID();
    entry.giftDiamonds *= entry.activityCount;
    void rememberGiftCatalogEntry(entry).catch(error => recordTechnicalLog('error', `No se pudo actualizar el catálogo de regalos: ${error.message}`));
    settings.giftCount += entry.activityCount;
    void persistSettings().catch(error => recordTechnicalLog('error', `No se pudo guardar el contador de regalos: ${error.message}`));
    broadcastTool('game-tools', { timerStartedAt: settings.timerStartedAt, giftCount: settings.giftCount });
    sendWhatsApp({ type: 'gift', username: entry.username, giftName: entry.giftName, activityCount: entry.activityCount, giftDiamonds: entry.giftDiamonds });
  }
  if (type === 'member' && entry.username) {
    const existing = recentUsers.findIndex(user => user.username.toLowerCase() === entry.username.toLowerCase());
    if (existing >= 0) recentUsers.splice(existing, 1);
    recentUsers.unshift({ username: entry.username, avatar: entry.profilePictureUrl });
    recentUsers.splice(4);
    settings.recentUsers = recentUsers.slice();
    void persistSettings().catch(error => recordTechnicalLog('error', `No se pudo guardar la lista de usuarios recientes: ${error.message}`));
  } else if (entry.username) {
    const user = recentUsers.find(item => item.username.toLowerCase() === entry.username.toLowerCase());
    if (user && entry.profilePictureUrl) {
      user.avatar = entry.profilePictureUrl;
      settings.recentUsers = recentUsers.slice();
      void persistSettings().catch(error => recordTechnicalLog('error', `No se pudo guardar el avatar del usuario: ${error.message}`));
    }
  }
  if (type === 'chat') {
    const country = identifyCountry(entry.content);
    pendingCountryComments[country ? country.code : 'sin-pais']++;
    if (settings.tournamentEnabled && entry.username) void registerTournamentVote(entry.username, entry.content);
  }
  const receivedAt = Date.now();
  entry.receivedAt = receivedAt;
  if (type === 'gift') {
    acceptedTeamGifts.set(entry.eventId, entry);
    if (acceptedTeamGifts.size > 5000) acceptedTeamGifts.delete(acceptedTeamGifts.keys().next().value);
    void rememberLatestHonorGift(entry).catch(error => recordTechnicalLog('error', `No se pudo guardar el último regalo del cuadro de honor: ${error.message}`));
  }
  broadcastSse(clients, 'update', { entry });
  void appendRecords('user-events', [{
    u: entry.username,
    name: entry.username,
    t: receivedAt,
    type,
    n: entry.activityCount,
    ...(entry.content ? { text: entry.content } : {}),
    ...(entry.giftName ? { gift: entry.giftName } : {}),
    ...(type === 'gift' ? { giftDiamonds: entry.giftDiamonds } : {})
  }]).catch(error => recordTechnicalLog('error', `No se pudo guardar el evento de usuario: ${error.message}`));
}

async function sendWhatsApp(event) {
  if (process.env.WHATSAPP_ALERTS_ENABLED !== 'true' || !process.env.WHATSAPP_WEBHOOK_URL) return;
  try {
    const headers = { 'content-type': 'application/json' };
    if (process.env.WHATSAPP_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.WHATSAPP_WEBHOOK_TOKEN}`;
    const response = await fetch(process.env.WHATSAPP_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`webhook respondió ${response.status}`);
  } catch (error) {
    recordTechnicalLog('error', `No se pudo enviar la alerta de WhatsApp: ${error.message}`);
  }
}

async function registerTournamentVote(username, text) {
  const state = await getState('cluss.libreVotes');
  const document = state.found && state.value && typeof state.value === 'object'
    ? state.value
    : { v: 1, salt: randomBytes(16).toString('hex'), total: {}, round: {}, all: [], rounds: [] };
  if (!document.salt) document.salt = randomBytes(16).toString('hex');
  const voteKey = createHmac('sha256', document.salt).update(username.trim().toLowerCase()).digest('hex');
  const team = text.trim().slice(0, 80);
  if (!team) return;
  const row = document.round[team] || (document.round[team] = { votes: 0, u: [] });
  if (row.u.includes(voteKey)) return;
  row.votes++;
  row.u.push(voteKey);
  const total = document.total[team] || (document.total[team] = { votes: 0, u: [] });
  total.votes++;
  if (!total.u.includes(voteKey)) total.u.push(voteKey);
  if (!document.all.includes(voteKey)) document.all.push(voteKey);
  document.updated = Date.now();
  await setState('cluss.libreVotes', document);
}

function safeJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === req.headers.host &&
      (url.protocol === 'https:' || url.protocol === 'http:');
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  const configuredToken = process.env.BACKEND_ADMIN_TOKEN || adminToken;
  const providedToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = Buffer.from(configuredToken);
  const provided = Buffer.from(providedToken);
  const validToken = Boolean(configuredToken) && expected.length === provided.length && timingSafeEqual(expected, provided);
  if (!hasAdminSession(req) && !validToken) {
    safeJson(res, 401, { message: 'Se requiere el token de administración configurado en BACKEND_ADMIN_TOKEN.' });
    return false;
  }
  return true;
}

function adminSessionId(req) {
  const prefix = `${ADMIN_SESSION_COOKIE}=`;
  const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : '';
}

function hasAdminSession(req) {
  const id = adminSessionId(req);
  const expiresAt = adminSessions.get(id);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(id);
    return false;
  }
  return true;
}

function startAdminSession(req, res) {
  const now = Date.now();
  for (const [id, expiresAt] of adminSessions) {
    if (expiresAt <= now) adminSessions.delete(id);
  }
  const id = randomBytes(32).toString('base64url');
  adminSessions.set(id, now + ADMIN_SESSION_TTL_MS);
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('set-cookie', `${ADMIN_SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`);
}

function endAdminSession(req, res) {
  adminSessions.delete(adminSessionId(req));
  res.setHeader('set-cookie', `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function sse(req, res, pool, initialEvents = []) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  for (const [event, data] of initialEvents) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  pool.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  heartbeat.unref();
  const cleanup = () => {
    clearInterval(heartbeat);
    pool.delete(res);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  })[extname(path)] || 'application/octet-stream';
}

  function deploymentSignature(body) {
    const html = body.toString('utf8').replaceAll('__TORTUWORLD_PACKAGE_VERSION__', PACKAGE_VERSION);
    return `sha256-${createHash('sha256').update(html).digest('hex').slice(0, 16)}`;
  }

async function serveFile(req, res, path, options = {}) {
  try {
    let body = await readFile(path);
    if (options.deploymentSignature) {
        const signature = deploymentSignature(body);
        body = Buffer.from(body.toString('utf8')
          .replaceAll('__TORTUWORLD_PACKAGE_VERSION__', PACKAGE_VERSION)
          .replaceAll('__CLUSS_DEPLOYMENT_SIGNATURE__', signature));
      res.setHeader('x-cluss-deployment-signature', signature);
    }
    res.writeHead(200, {
      'content-type': options.contentType || contentType(path),
      'cache-control': options.cache || 'no-cache',
      'content-length': body.length,
      'x-content-type-options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') safeJson(res, 404, { message: 'No encontrado.' });
    else throw error;
  }
}

const backendPage = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#090e18"><title>Negocio · Game Server</title>
<style>
:root{color-scheme:dark;--bg:#090e18;--panel:#111a29;--panel2:#0d1523;--line:#24364b;--text:#eaf3ff;--muted:#91a4bc;--cyan:#62e6ff;--lime:#a4f36d;--amber:#ffc86b;--red:#ff7189}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 75% -15%,#18314a 0,transparent 42%),var(--bg);color:var(--text);font:14px/1.5 Inter,Segoe UI,system-ui,sans-serif;min-height:100vh}
button,input{font:inherit}button{border:1px solid #33516c;background:#18283b;color:var(--text);border-radius:9px;padding:.7rem 1rem;cursor:pointer;transition:.18s}button:hover{border-color:var(--cyan);transform:translateY(-1px);box-shadow:0 5px 22px #36c5e622}button.primary{background:linear-gradient(120deg,#1d7884,#27604a);border-color:#57d3ce;font-weight:750}
input,select{border:1px solid #31435a;background:#0a1220;color:var(--text);padding:.65rem .8rem;border-radius:8px;outline:none}input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #62e6ff1b}
.shell{max-width:1240px;margin:auto;padding:0 28px 42px}.topbar{height:82px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #203044}
.brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}.brandmark{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#8ff3c0,#54d8ee);color:#08202a;font-size:17px;font-weight:950;box-shadow:0 0 26px #62e6ff30}.brand b{letter-spacing:.13em;font-size:13px}.brand small{display:block;color:var(--muted);font-size:10px;letter-spacing:.18em}
.topmeta{display:flex;align-items:center;gap:18px;color:var(--muted);font-size:12px}.live-tag,.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid #29465b;border-radius:999px;padding:6px 11px;background:#0d1a26;color:#b9d1e6;font-size:10px;font-weight:800;letter-spacing:.1em}.dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 12px var(--lime)}
.hero{padding:42px 0 22px;display:grid;grid-template-columns:1fr;gap:36px;align-items:end}.eyebrow{color:var(--cyan);font-size:10px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}.hero h1{font-size:clamp(34px,5vw,56px);line-height:1.03;letter-spacing:-.05em;margin:12px 0}.hero h1 em{font-style:normal;color:var(--lime)}.hero p{color:var(--muted);max-width:570px;margin:0}.hero-actions{display:flex;gap:10px;align-items:center;margin-top:22px}.hero-actions a{color:var(--cyan);text-decoration:none;font-weight:700;padding:10px 12px}
.connection-card,.panel,.stat{border:1px solid var(--line);border-radius:15px;background:linear-gradient(145deg,#142033,#0f1725);box-shadow:0 16px 40px #0002}.connection-card{padding:18px}.connection-card header,.panel header{display:flex;align-items:center;justify-content:space-between;gap:12px}.connection-card h2,.panel h2{margin:0;font-size:14px;letter-spacing:.02em}.status-pill{color:var(--amber);font-size:11px;font-weight:800}.status-pill.online{color:var(--lime)}.subtle{font-size:12px;color:var(--muted)}.user-connection{margin-top:16px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0 14px}.stat{padding:15px 17px}.stat-label{display:block;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.stat strong{display:block;font-size:22px;margin-top:7px;letter-spacing:-.03em}.stat small{color:var(--muted)}
.unit-nav{display:flex;gap:8px;overflow-x:auto;padding:7px 2px 14px;margin:4px 0 8px;scrollbar-width:thin}.unit-nav button{flex:0 0 auto;padding:.58rem .85rem;font-size:12px}.unit-nav button.active{border-color:var(--cyan);background:#173449;color:#fff;box-shadow:0 0 0 2px #62e6ff18}
.layout{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}.panel{padding:19px;margin-bottom:14px}.panel header{margin-bottom:16px}.panel h2{display:flex;align-items:center;gap:9px}.icon{width:30px;height:30px;border-radius:9px;display:inline-grid;place-items:center;background:#1b3341;color:var(--cyan)}
.voice-panel{border-color:#355654;background:linear-gradient(140deg,#13231f,#101827)}.voice-order{list-style:none;padding:0;margin:15px 0 0;display:grid;gap:9px}.voice-card{display:grid;grid-template-columns:39px minmax(0,1fr) auto auto;gap:12px;align-items:start;padding:13px;border:1px solid #294237;border-radius:11px;background:#0d191b}.voice-rank{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;color:#0a1a1b;background:var(--lime);font-weight:950}.voice-copy b{font-size:13px}.voice-copy p{margin:3px 0;color:var(--muted);font-size:12px}.voice-copy small{display:block;color:#a8c0bd;overflow-wrap:anywhere;font-size:11px}.voice-level{color:#8da69e;font-size:9px;letter-spacing:.08em;font-weight:800}.voice-enabled{display:flex;align-items:center;gap:5px;color:#c4e7c4;font-size:10px;white-space:nowrap}.voice-enabled input{width:auto;margin:0;accent-color:var(--lime)}.voice-hint{margin:12px 0 0;padding:10px 12px;background:#152b24;border-radius:9px;color:#c4e7c4;font-size:12px}
.form-row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.field{display:grid;gap:5px;color:var(--muted);font-size:11px}.field input{width:130px}.field.token{min-width:min(100%,340px);flex:1}.field.token input{width:100%}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.toolbar p{display:flex;gap:8px;margin:0;flex-wrap:wrap}.checkrow{display:flex;align-items:center;gap:9px;color:#c9d6e5}.checkrow input{accent-color:var(--lime)}.don-tortu-toggle{min-width:210px;color:#fff;font-weight:800;border-color:transparent}.don-tortu-toggle.off{background:#a8323c}.don-tortu-toggle.on{background:#238447}.vs-config-list,.gift-catalog-list,.race-list,.team-catalog-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px;margin-top:12px;max-height:320px;overflow:auto;padding-right:4px}.vs-config-list .checkrow,.gift-catalog-list .checkrow,.race-row,.team-row{padding:9px 10px;border:1px solid #25374a;border-radius:8px;background:#0a111c;font-size:12px}.vs-config-list .vs-checkrow{justify-content:space-between;gap:8px}.vs-checkrow label{display:flex;align-items:center;gap:5px;white-space:nowrap}.race-row,.team-row{display:flex;align-items:center;gap:9px}.race-row input{accent-color:var(--lime)}.team-flag{min-width:42px;text-align:center;font-size:18px}.message{min-height:24px;color:var(--cyan);font-size:12px;margin:14px 0 0}.pre{padding:11px;border:1px solid #25374a;border-radius:9px;background:#0a111c;color:#b9c9dc;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,Consolas,monospace;max-height:230px;overflow:auto}.country-box{margin-top:12px}.motor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.motor-card{border:1px solid #25374a;border-radius:11px;background:#0a111c;padding:12px}.motor-card h3{margin:0 0 8px;font-size:13px}.motor-card .meter{height:8px;background:#1a2938;border-radius:8px;overflow:hidden;margin:8px 0}.motor-card .meter i{display:block;height:100%;background:linear-gradient(90deg,#62e6ff,#a4f36d)}.motor-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;color:var(--muted);font-size:11px}.motor-values b{color:var(--text);font-weight:700}.unit-empty{padding:14px;border:1px dashed #29465b;border-radius:10px;color:var(--muted)}.server-footer{display:flex;justify-content:space-between;gap:12px;color:#657b94;font-size:10px;padding:18px 0}
.event-list{list-style:none;padding:0;margin:0;display:grid;gap:8px;max-height:430px;overflow-y:auto}.event-row{display:grid;grid-template-columns:72px 100px minmax(100px,.55fr) minmax(0,1.45fr);gap:10px;align-items:start;padding:10px 12px;border:1px solid #25374a;border-radius:9px;background:#0a111c;font-size:12px}.event-row time,.event-user{color:var(--muted)}.event-user{display:flex;align-items:center;gap:8px;min-width:0}.event-user-label{min-width:0;overflow-wrap:anywhere}.event-avatar{flex:none;width:32px;height:32px;border:1px solid #456079;border-radius:50%;object-fit:cover;background:#25374a}.event-avatar-fallback{display:grid;place-items:center;color:#e4edf7;font-size:13px;font-weight:800}.event-avatar-fallback::before{content:attr(data-initial)}.event-kind{color:var(--cyan);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.event-detail{overflow-wrap:anywhere;white-space:pre-wrap}.log-row{display:grid;grid-template-columns:78px 70px minmax(0,1fr);gap:10px;align-items:start;padding:10px 12px;border:1px solid #25374a;border-radius:9px;background:#0a111c;font-size:12px}.log-row time{color:var(--muted)}.log-level{font-size:10px;font-weight:800;letter-spacing:.05em}.log-level.error{color:var(--red)}.log-level.info{color:var(--cyan)}.log-message{overflow-wrap:anywhere;white-space:pre-wrap}
.event-layout{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:14px;align-items:start}.event-filters{padding:12px;border:1px solid var(--line);border-radius:11px;background:#0c1522}.event-filters h3{margin:0 0 10px;font-size:12px}.event-filter{display:flex;align-items:center;gap:8px;padding:5px 0;color:#c9d6e5;font-size:12px}.event-filter input{width:auto;margin:0;accent-color:var(--cyan)}.event-toolbar{display:flex;justify-content:flex-end;margin-bottom:10px}.event-toolbar button{padding:.5rem .75rem;font-size:12px}
@media(max-width:850px){.hero,.layout{grid-template-columns:1fr}.hero{gap:20px;padding-top:30px}.connection-card{max-width:none}}@media(max-width:560px){.shell{padding:0 14px 28px}.topbar{height:68px}.topmeta{gap:8px}.live-tag{font-size:9px}.hero h1{font-size:37px}.stats{gap:7px}.stat{padding:12px 10px}.panel{padding:15px}.voice-card{grid-template-columns:34px minmax(0,1fr)}.voice-level,.voice-enabled{grid-column:2}.field.token{min-width:100%}.event-layout{grid-template-columns:1fr}.event-filters{order:-1}.event-filters form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px}.event-row{grid-template-columns:60px 1fr;gap:6px}.event-user,.event-detail{grid-column:2}.event-kind{grid-column:1;grid-row:2}.log-row{grid-template-columns:60px 1fr;gap:6px}.log-message{grid-column:2}}
.event-row[hidden]{display:none}</style></head>
<body><div class="shell">
<header class="topbar"><a class="brand" href="/backend"><span class="brandmark">NG</span><span><b>NEGOCIO</b><small>GAME SERVER · CONTROL ROOM</small></span></a><div class="topmeta"><span class="live-tag"><i class="dot"></i> LIVE OPS</span><span id="clock">--:--:--</span></div></header>
<main>
<section class="hero"><div><span class="eyebrow">Game operations / servidor 01</span><h1>Controla la partida.<br><em>Domina el live.</em></h1><p>Centro de mando organizado por unidades de negocio de TortuWorld.</p><div class="hero-actions"><a href="/">Abrir overlay ↗</a></div></div></section>
<section class="stats"><article class="stat"><span class="stat-label">Eventos recibidos</span><strong id="eventCount">0</strong><small>En esta sesión</small></article><article class="stat"><span class="stat-label">Regalos recibidos</span><strong id="giftCount">0</strong><small>Contador del servidor</small></article><article class="stat"><span class="stat-label">Overlay</span><strong id="overlayState">Verificando</strong><small id="overlayClients">Buscando clientes activos</small></article></section>
<nav class="unit-nav" id="businessUnits" aria-label="Unidades de negocio">
<button type="button" class="active" data-unit="usuarios">Usuarios</button><button type="button" data-unit="honor">Honor</button><button type="button" data-unit="eventos">Eventos</button><button type="button" data-unit="regalos">Regalos</button><button type="button" data-unit="torneos">Torneos</button><button type="button" data-unit="estadisticas">Estadísticas</button><button type="button" data-unit="motor">Motor tiempo real</button><button type="button" data-unit="turbo-regalos">Turbo regalos</button><button type="button" data-unit="acciones">CTAs / Acciones</button><button type="button" data-unit="logs">Logs</button>
</nav>
<section class="panel business-panel" data-units="usuarios"><header><h2><span class="icon">👤</span> Usuarios</h2><span class="pill">LIVE</span></header><pre class="pre" id="recentUsers">Cargando usuarios…</pre><article class="connection-card user-connection"><header><h2>Conexión TikTok</h2><span class="status-pill" id="status">CONECTANDO</span></header><p class="subtle">Usuario actual: <b id="currentUsername">Sin usuario</b></p><p class="subtle" id="statusDetail">Esperando estado del servidor…</p><form id="connect" class="form-row"><label class="field">Usuarios guardados<select id="savedUsername"><option value="">Cargando usuarios guardados…</option></select></label><label class="field">Usuario del live<input name="username" placeholder="Ingresa el usuario sin @" required></label><button class="primary">Conectar</button><button type="button" id="reconnect">Reintentar</button></form><p class="message" id="savedUsernameMessage" role="status"></p></article></section>
<section class="panel business-panel" data-units="honor"><header><h2><span class="icon">🥇</span> Negocio Honor · Cuadro de honor</h2><span class="pill">HONOR</span></header><article class="connection-card"><header><h2>Último usuario que envió un regalo</h2></header><div class="form-row"><img id="honorLastGiftAvatar" alt="" width="56" height="56" hidden><pre class="pre" id="honorLastGift">Cargando último regalo…</pre></div></article><article class="connection-card"><header><h2>Últimos donadores por equipo</h2></header><p class="subtle">El último usuario que donó a cada equipo se conserva entre carreras.</p><div class="toolbar"><button type="button" id="copyLeftDonor">Copiar equipo izquierdo</button><button type="button" id="copyRightDonor">Copiar equipo derecho</button><button type="button" id="copyTeamDonors">Copiar ambos equipos</button></div><p class="message" id="donorCopyMessage" role="status"></p><pre class="pre" id="teamDonors">Cargando donadores…</pre></article><pre class="pre" id="honorBoard">Cargando resultados guardados…</pre></section>
<section class="panel business-panel" data-units="eventos"><header><h2><span class="icon">⚡</span> Eventos LIVE</h2><span class="pill">ÚLTIMOS 50</span></header><p class="subtle">Eventos recibidos en esta sesión: <b id="eventUnitCount">0</b>. Los más recientes aparecen primero.</p><div class="event-layout"><div><div class="event-toolbar"><button type="button" id="copyEvents">Copiar eventos visibles</button><button type="button" id="clearEvents">Limpiar eventos</button></div><p class="message" id="eventMessage" role="status"></p><p class="unit-empty" id="eventEmpty">Esperando eventos de TikTok…</p><ol class="event-list" id="eventList" aria-live="polite"></ol></div><aside class="event-filters" aria-label="Filtrar eventos"><h3>Mostrar eventos</h3><form id="eventFilterForm"><label class="event-filter"><input type="checkbox" data-event-filter="all" checked> Todos</label><label class="event-filter"><input type="checkbox" data-event-filter="member" checked> Se unieron</label><label class="event-filter"><input type="checkbox" data-event-filter="chat" checked> Comentarios</label><label class="event-filter"><input type="checkbox" data-event-filter="like" checked> Me gusta / taps</label><label class="event-filter"><input type="checkbox" data-event-filter="follow" checked> Seguidores</label><label class="event-filter"><input type="checkbox" data-event-filter="share" checked> Compartidos</label><label class="event-filter"><input type="checkbox" data-event-filter="gift" checked> Regalos</label><button type="submit" class="primary" id="applyEventFilters" style="width:100%;margin-top:8px">Aplicar filtros</button></form></aside></div><pre class="pre" id="tools" hidden></pre></section>
<section class="panel business-panel" data-units="logs" id="logsPanel"><header><h2><span class="icon">📜</span> Logs técnicos</h2><span class="pill" id="logsCount">SESIÓN ACTUAL</span></header><p class="subtle">Avisos y errores recientes del servidor. El diagnóstico detallado se activa durante 10 minutos en los overlays conectados.</p><div class="toolbar"><button id="toggleAllLogs" type="button" aria-pressed="false">Activar logs en todos los negocios (10 min)</button><button id="copyTechnicalLogs" type="button">Copiar logs</button><button id="refreshLogs" type="button">Actualizar</button></div><p class="message" id="logsMessage" role="status"></p><p class="unit-empty" id="logsEmpty">Sin registros técnicos todavía.</p><ol class="event-list" id="serverLogs" aria-live="polite"></ol><p class="message" id="logsError" role="status"></p></section>
<section class="panel business-panel" data-units="regalos turbo-regalos"><header><h2><span class="icon">🎁</span> Negocio de regalos</h2><span class="pill">CATÁLOGO Y ROTACIÓN</span></header><p class="subtle">Total recibidos: <b id="giftUnitCount">0</b></p><p class="subtle">Turbo por unidad: 10 m de base + 5 m por cada diamante. Se recorre durante 15 segundos; un regalo de 1 diamante avanza 15 m.</p><input id="gift" type="hidden" value="6"><h3>Catálogo de regalos · monedas</h3><p class="subtle">Rosita empieza habilitada. El catálogo incluye los regalos y valores en monedas indicados; los regalos no catalogados aparecen con valor sin informar y deshabilitados.</p><div class="form-row"><label class="field">Rotar en el cuadro de honor cada (segundos)<input id="giftRotation" type="number" min="1" max="3600" value="10"></label></div><div id="giftCatalogList" class="gift-catalog-list"><div class="unit-empty">Cargando catálogo…</div></div><div class="toolbar"><button class="primary" id="saveGiftCatalog">Guardar catálogo y rotación</button></div><p class="message" id="giftConfigMessage" role="status"></p></section>
<section class="panel business-panel" data-units="torneos"><header><h2><span class="icon">🚩</span> Torneos · catálogo de equipos</h2><span class="pill">TORNEOS</span></header><p class="subtle">Banderas de los equipos disponibles en los VS configurables.</p><div id="teamCatalogList" class="team-catalog-list"><div class="unit-empty">Cargando banderas…</div></div></section>
<section class="panel business-panel" data-units="torneos"><header><h2><span class="icon">🐢</span> Torneos · contador de equipos</h2><span class="pill">TORNEOS</span></header><div class="form-row"><label class="field">Avance por cada límite de taps (%)<input id="tap" type="number" min="0" max="100" value="20"></label><button class="primary" id="saveTapTurbo">Guardar ajustes de equipos</button><button data-command="turbo-down">Turbo −</button><button data-command="turbo-up">Turbo +</button></div><div class="motor-grid" id="teamTelemetry"><div class="unit-empty">Esperando valores del motor…</div></div></section>
<section class="panel business-panel" data-units="motor"><header><h2><span class="icon">⚙</span> Motor en tiempo real</h2><span class="pill" id="motorStatus">SIN TELEMETRÍA</span></header><p class="subtle">Valores actuales reportados por el overlay y retransmitidos por el servidor.</p><div class="stats"><article class="stat"><span class="stat-label">Fase</span><strong id="motorPhase">—</strong><small id="motorUpdated">Esperando al overlay</small></article><article class="stat"><span class="stat-label">Duración</span><strong id="motorElapsed">—</strong><small>Tiempo de carrera</small></article><article class="stat"><span class="stat-label">Inactividad</span><strong id="motorIdle">—</strong><small>Cuenta regresiva</small></article></div><p class="subtle">Ganador: <b id="motorWinner">—</b> · Eventos procesados: <b id="motorEvents">0</b></p><div class="motor-grid" id="motorTeams"><div class="unit-empty">El overlay debe estar abierto para publicar telemetría.</div></div><pre class="pre" id="motorStats">Estadísticas del motor: esperando datos…</pre></section>
<section class="panel business-panel" data-units="torneos"><header><h2><span class="icon">🏆</span> Torneos</h2><span class="pill">VOTACIÓN</span></header><label class="checkrow"><input id="tournamentEnabled" type="checkbox"> Registrar votos de comentarios reales</label><div class="toolbar"><button class="primary" id="saveTournament">Guardar configuración</button></div></section>
<section class="panel business-panel" data-units="torneos"><header><h2><span class="icon">🏆</span> Torneos · crear lista de carreras</h2><span class="pill">CUATRO DUELOS EN ROTACIÓN</span></header><p class="subtle">Olimpia–Cerro, Barcelona–Real Madrid, Paraguay–Argentina y Paraguay–Brasil se habilitan en la rotación; se alternan al terminar cada carrera por inactividad.</p><div id="vsConfigList" class="vs-config-list"><div class="unit-empty">Cargando VS…</div></div><div class="toolbar"><button class="primary" id="saveVsConfig">Guardar VS y popularidad</button></div><h3>Lista de carreras</h3><div id="raceList" class="race-list"><div class="unit-empty">Cargando lista…</div></div><p class="message" id="vsConfigMessage" role="status"></p></section>
<section class="panel business-panel" data-units="estadisticas"><header><h2><span class="icon">📊</span> Estadísticas por país y presencia</h2><span class="pill">LIVE DATA</span></header><pre class="pre" id="countries">Esperando datos…</pre><div class="country-box"><span class="subtle">Estado del overlay</span><pre class="pre" id="presence">Verificando clientes…</pre></div></section>
<section class="panel business-panel" data-units="acciones"><header><h2><span class="icon">🛠</span> CTAs / Acciones</h2><span class="pill">OPERADOR</span></header><p class="subtle">Herramientas de operación del live y la sesión.</p><div class="toolbar"><button id="reset">Reiniciar cronómetro y regalos</button><button data-command="refresh">Recargar overlay</button><button id="logout">Cerrar sesión protegida</button></div></section>
<p class="message" id="message" role="status"></p>
</main><footer class="server-footer"><span>NEGOCIO GAME SERVER</span><span>Control local · datos en tiempo real</span></footer></div>
<script>
const $=s=>document.querySelector(s),headers=()=>({'content-type':'application/json'}),msg=t=>$('#message').textContent=t;
async function admin(path,body){const r=await fetch(path,{method:'POST',headers:headers(),credentials:'same-origin',body:JSON.stringify(body||{})});const j=await r.json();if(!r.ok)throw Error(j.message||r.status);return j}
function renderGiftConfig(config){
 const list=$('#giftCatalogList');if(!list)return;
 list.replaceChildren();
 config.catalog.forEach(gift=>{
  const label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');
  label.className='checkrow';input.type='checkbox';input.dataset.giftKey=gift.key;input.checked=gift.enabled;
  const icon=gift.emoji||gift.icon||'🎁',giftName=gift.name.startsWith(icon)?gift.name.slice(icon.length).trim():gift.name;
  name.textContent=icon+' '+giftName+' · '+(gift.value?gift.value.toLocaleString('es')+' monedas':'valor sin informar');
  label.append(input,name);list.append(label);
 });
 $('#giftRotation').value=config.rotationSeconds;
}
async function loadGiftConfig(){
 const status=$('#giftConfigMessage');status.textContent='';
 try{
  const response=await fetch('/api/admin/gifts-config',{credentials:'same-origin',cache:'no-store'}),config=await response.json();
  if(!response.ok)throw Error(config.message||response.status);
  renderGiftConfig(config);
 }catch(error){$('#giftCatalogList').textContent=error.message;status.textContent='No se pudo cargar el catálogo de regalos.'}
}
async function loadVsConfig(raceListOnly=false){
 const list=$('#vsConfigList'),status=$('#vsConfigMessage');
 if(!raceListOnly){list.textContent='Cargando VS…';status.textContent=''}
 try{
  const response=await fetch('/api/admin/vs-config',{credentials:'same-origin',cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.message||response.status);
  if(!raceListOnly){
   list.replaceChildren();
   data.list.forEach(duel=>{
    const row=document.createElement('div'),enabledLabel=document.createElement('label'),popularLabel=document.createElement('label');
    const enabled=document.createElement('input'),popular=document.createElement('input'),name=document.createElement('span');
    row.className='checkrow vs-checkrow';
    enabled.type='checkbox';enabled.dataset.vsKey=duel.k;enabled.checked=!!duel.on;
    name.textContent=duel.label;enabledLabel.append(enabled,name);
    popular.type='checkbox';popular.dataset.vsPopularKey=duel.k;popular.checked=!!duel.popular;
    popularLabel.append(popular,document.createTextNode('Popular'));
    row.append(enabledLabel,popularLabel);list.append(row);
   });
  }
  renderRaceList(data.raceList||[]);
 }catch(error){if(!raceListOnly)list.textContent=error.message;status.textContent='No se pudo cargar la configuración de VS.'}
}
function renderRaceList(races){
 const target=$('#raceList');target.replaceChildren();
 if(!races.length){const empty=document.createElement('div');empty.className='unit-empty';empty.textContent='No hay carreras en la lista. Habilita al menos un VS.';target.append(empty);return}
 races.forEach((race,index)=>{
  const row=document.createElement('label'),check=document.createElement('input'),name=document.createElement('span');
  row.className='race-row';check.type='checkbox';check.checked=!!race.played;check.disabled=true;
  const duel=$('#vsConfigList').querySelector('[data-vs-key="'+race.k+'"]');
  name.textContent=(index+1)+'. '+(duel?duel.closest('.vs-checkrow').querySelector('span').textContent:race.k);
  row.append(check,name);target.append(row);
 });
}
async function loadTeamCatalog(){
 const target=$('#teamCatalogList');
 try{
  const response=await fetch('/api/admin/vs-config',{credentials:'same-origin',cache:'no-store'}),data=await response.json();
  if(!response.ok)throw Error(data.message||response.status);
  target.replaceChildren();
  data.teams.forEach(team=>{
   const row=document.createElement('div'),flag=document.createElement('span'),name=document.createElement('span');
   row.className='team-row';flag.className='team-flag';flag.textContent=team.flag;name.textContent=team.name;
   row.append(flag,name);target.append(row);
  });
 }catch(error){target.textContent='No se pudo cargar el catálogo de banderas: '+error.message}
}
$('#logout').onclick=async()=>{await fetch('/api/admin/session',{method:'DELETE',credentials:'same-origin'});location.replace('/backend')};
const unitButtons=[...document.querySelectorAll('[data-unit]')];
function showUnit(unit,scrollToPanel=false){
 unitButtons.forEach(button=>{const active=button.dataset.unit===unit;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
 const panels=[...document.querySelectorAll('[data-units]')];
 panels.forEach(panel=>{panel.hidden=!panel.dataset.units.split(/\\s+/).includes(unit)});
 if(scrollToPanel)panels.find(panel=>panel.dataset.units.split(/\\s+/).includes(unit))?.scrollIntoView({behavior:'smooth',block:'start'});
 if(unit==='logs')loadTechnicalLogs();
 if(unit==='regalos'||unit==='turbo-regalos')loadGiftConfig();
 if(unit==='torneos'){loadVsConfig();loadTeamCatalog()}
}
$('#businessUnits').addEventListener('click',event=>{
 const button=event.target.closest('button[data-unit]');
 if(!button)return;
 event.preventDefault();
 const unit=button.dataset.unit;
 showUnit(unit,true);
 if(unit==='honor')loadHonorBoard();
});
showUnit('usuarios');
$('#clock').textContent=new Date().toLocaleTimeString('es');
setInterval(()=>$('#clock').textContent=new Date().toLocaleTimeString('es'),1000);
$('#refreshLogs').onclick=loadTechnicalLogs;
$('#copyTechnicalLogs').onclick=copyTechnicalLogs;
$('#toggleAllLogs').onclick=async()=>{
 try{
  diagnosticState=await admin('/api/admin/diagnostic-mode',{enabled:!diagnosticState.active});
  updateDiagnosticButton();
  $('#logsMessage').textContent=diagnosticState.active?'Registro detallado activado en los overlays conectados durante 10 minutos.':'Registro detallado desactivado.';
  await loadTechnicalLogs();
 }catch(error){$('#logsError').textContent=error.message}
};
setInterval(()=>{const panel=document.querySelector('[data-units="torneos"]');if(panel&&!panel.hidden)loadVsConfig(true)},3000);
$('#connect').onsubmit=async e=>{e.preventDefault();try{const r=await fetch('/api/connect',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:e.target.elements.namedItem('username').value})});const j=await r.json();if(!r.ok)throw Error(j.message);renderSavedUsernames(j.usernames,j.username);msg('Conectando con @'+j.username)}catch(x){msg(x.message)}};
$('#reconnect').onclick=async()=>{try{await admin('/api/admin/reconnect');msg('Reconexión solicitada')}catch(e){msg(e.message)}};
$('#saveGiftCatalog').onclick=async()=>{
 const enabledKeys=Array.from(document.querySelectorAll('#giftCatalogList input[type="checkbox"]:checked')).map(input=>input.dataset.giftKey);
 const rotationSeconds=Number($('#giftRotation').value);
 try{
  const result=await admin('/api/admin/gifts-config',{enabledKeys,rotationSeconds});
  renderGiftConfig(result.config);$('#giftConfigMessage').textContent='Catálogo guardado. Los regalos habilitados rotarán en el cuadro de honor.';
 }catch(error){$('#giftConfigMessage').textContent=error.message}
};
$('#saveTapTurbo').onclick=async()=>{try{await admin('/api/admin/game-settings',{giftTurboProgress:+$('#gift').value,tapTurboProgress:+$('#tap').value});msg('Turbo del contador de equipos guardado')}catch(e){msg(e.message)}};
$('#saveTournament').onclick=async()=>{try{await admin('/api/admin/tournament-enabled',{enabled:$('#tournamentEnabled').checked});msg('Configuración de Torneo Libre guardada')}catch(e){msg(e.message)}};
$('#saveVsConfig').onclick=async()=>{
 const enabledKeys=Array.from(document.querySelectorAll('#vsConfigList input[data-vs-key]:checked')).map(input=>input.dataset.vsKey);
 const popularKeys=Array.from(document.querySelectorAll('#vsConfigList input[data-vs-popular-key]:checked')).map(input=>input.dataset.vsPopularKey);
 try{await admin('/api/admin/vs-config',{enabledKeys,popularKeys});await loadVsConfig();$('#vsConfigMessage').textContent='Configuración guardada. La lista se actualiza al terminar cada carrera por inactividad.'}
 catch(error){$('#vsConfigMessage').textContent=error.message}
};
$('#reset').onclick=async()=>{if(!confirm('¿Reiniciar el cronómetro y el contador de regalos?'))return;try{await admin('/api/admin/game-tools/reset');msg('Cronómetro reiniciado')}catch(e){msg(e.message)}};
document.querySelectorAll('[data-command]').forEach(b=>b.onclick=async()=>{try{await admin('/api/admin/game-command',{command:b.dataset.command});msg('Comando enviado')}catch(e){msg(e.message)}});
async function loadHonorBoard(){
 try{
  const [resultsResponse,giftResponse,donorsResponse]=await Promise.all([
   fetch('/api/state/cluss.v1',{cache:'no-store'}),
   fetch('/api/honor/last-gift',{cache:'no-store'}),
   fetch('/api/state/cluss.honorLastGiftTeams',{cache:'no-store'})
  ]);
  const historyResponse=await fetch('/api/honor/team-gifts',{cache:'no-store'});
  const giftHistory=await historyResponse.json();
  if(!historyResponse.ok)throw Error(giftHistory.message||historyResponse.status);
  const donorData=donorsResponse.status===404?{}:await donorsResponse.json();
  if(donorsResponse.status!==404&&!donorsResponse.ok)throw Error(donorData.message||donorsResponse.status);
  const savedTeams=donorData.teams&&typeof donorData.teams==='object'?donorData.teams:donorData.byTeam&&typeof donorData.byTeam==='object'?donorData.byTeam:{};
  const donors={
   leftTeamId:donorData.leftTeamId||'',
   rightTeamId:donorData.rightTeamId||'',
   left:savedTeams[donorData.leftTeamId]||null,
   right:savedTeams[donorData.rightTeamId]||null,
   byTeam:savedTeams,
   giftCountsByTeam:giftHistory.countsByTeam||{},
   giftsByTeam:giftHistory.giftsByTeam||{}
  };
  const donorPanel=$('#teamDonors').closest('.connection-card');
  if(donorPanel){
   donorPanel.querySelector('h2').textContent='Regalos persistidos por equipo';
   donorPanel.querySelector('.subtle').textContent='Historial completo en servidor; los últimos 50 de cada equipo aparecen primero.';
  }
  $('#teamDonors').textContent=JSON.stringify(donors,null,2);
  window.honorTeamDonors=donors;
  const giftResult=await giftResponse.json();if(!giftResponse.ok)throw Error(giftResult.message||giftResponse.status);
  const gift=giftResult.gift,avatar=$('#honorLastGiftAvatar');
  if(gift){
   $('#honorLastGift').textContent=JSON.stringify({username:gift.username,displayName:gift.displayName,giftName:gift.giftName,giftIcon:gift.giftIcon,giftDiamonds:gift.giftDiamonds,activityCount:gift.activityCount,receivedAt:gift.receivedAt},null,2);
   if(typeof gift.avatarUrl==='string'&&gift.avatarUrl.toLowerCase().startsWith('https://')){avatar.src=gift.avatarUrl;avatar.hidden=false}else{avatar.removeAttribute('src');avatar.hidden=true}
  }else{$('#honorLastGift').textContent='Todavía no se recibió ningún regalo.';avatar.hidden=true}
  if(resultsResponse.status===404){$('#honorBoard').textContent='Todavía no hay resultados guardados.';return}
  const result=await resultsResponse.json();if(!resultsResponse.ok)throw Error(result.message||resultsResponse.status);
  $('#honorBoard').textContent=JSON.stringify({wins:result.wins||[],cups:result.cp||{},races:result.races||0,tournamentMode:result.tournamentMode||'clasico'},null,2)
 }
 catch(error){$('#honorLastGift').textContent=error.message;$('#honorBoard').textContent=error.message}
}
function formatTime(ms){const seconds=Math.floor(Math.max(0,ms)/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')}
function renderMotorTeams(teams,target){
 target.replaceChildren();
 if(!Array.isArray(teams)||!teams.length){const empty=document.createElement('div');empty.className='unit-empty';empty.textContent='Esperando valores del motor…';target.append(empty);return}
 teams.forEach(team=>{
  const card=document.createElement('article'),title=document.createElement('h3'),meter=document.createElement('div'),fill=document.createElement('i'),values=document.createElement('div');
  card.className='motor-card';title.textContent=team.name;meter.className='meter';fill.style.width=Math.max(0,Math.min(100,team.progress))+'%';meter.append(fill);values.className='motor-values';
  [['Avance',team.progress.toFixed(1)+'%'],['Taps',Math.floor(team.taps)+' / '+team.tapLimit],['Eventos',Math.floor(team.eventTotal)],['Turbo inactividad',Math.ceil(team.turboMs/1000)+' s'],['Turbo regalos',Math.ceil(team.giftTurboMs/1000)+' s']].forEach(([label,value])=>{const cell=document.createElement('span');cell.textContent=label+': ';const strong=document.createElement('b');strong.textContent=value;cell.append(strong);values.append(cell)});
  card.append(title,meter,values);target.append(card);
 });
}
let lastMotorUpdate=0;
function renderMotor(state){
 if(!state)return;
 lastMotorUpdate=state.updatedAt||Date.now();$('#motorStatus').textContent=state.phase.toUpperCase();$('#motorStatus').classList.toggle('online',state.phase==='running');
 $('#motorPhase').textContent=state.phase.toUpperCase();$('#motorUpdated').textContent='Actualizado '+new Date(lastMotorUpdate).toLocaleTimeString('es');
 $('#motorElapsed').textContent=formatTime(state.elapsedMs);$('#motorIdle').textContent=state.idleSeconds+' s';$('#motorWinner').textContent=state.winner||'—';
 $('#motorEvents').textContent=String(Object.values(state.stats||{}).reduce((sum,value)=>sum+(Number(value)||0),0));
 $('#motorStats').textContent=JSON.stringify(state.stats,null,2);renderMotorTeams(state.teams,$('#motorTeams'));renderMotorTeams(state.teams,$('#teamTelemetry'));
}
let currentTechnicalLogs=[],diagnosticState={active:false,expiresAt:null};
function updateDiagnosticButton(){
 const button=$('#toggleAllLogs');
 button.setAttribute('aria-pressed',String(diagnosticState.active));
 button.textContent=diagnosticState.active?'Desactivar logs detallados':'Activar logs en todos los negocios (10 min)';
}
function renderTechnicalLogs(logs){
 currentTechnicalLogs=logs;
 const list=$('#serverLogs');list.replaceChildren();$('#logsCount').textContent=logs.length+' REGISTROS';$('#logsEmpty').hidden=logs.length>0;
 logs.forEach(log=>{
  const row=document.createElement('li'),time=document.createElement('time'),level=document.createElement('span'),message=document.createElement('span'),timestamp=Number(log.timestamp);
  const date=new Date(Number.isFinite(timestamp)?timestamp:Date.now());
  row.className='log-row';time.dateTime=date.toISOString();time.textContent=date.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  level.className='log-level '+(log.level==='error'?'error':'info');level.textContent=String(log.level||'info').toUpperCase();
  message.className='log-message';message.textContent=String(log.message||'');row.append(time,level,message);list.append(row);
 });
}
async function loadTechnicalLogs(){
 try{
  const response=await fetch('/api/admin/logs?limit=200',{credentials:'same-origin',cache:'no-store'}),result=await response.json();
  if(!response.ok)throw Error(result.message||response.status);
  if(!Array.isArray(result.logs))throw Error('El servidor devolvió logs inválidos.');
  diagnosticState=result.diagnostic||diagnosticState;updateDiagnosticButton();
  renderTechnicalLogs(result.logs);$('#logsError').textContent='';
 }catch(error){$('#logsError').textContent=error.message}
}
function copyText(text){
const textarea=document.createElement('textarea');textarea.value=text;textarea.setAttribute('readonly','');textarea.style.position='fixed';textarea.style.opacity='0';document.body.appendChild(textarea);textarea.select();
const copied=typeof document.execCommand==='function'&&document.execCommand('copy');textarea.remove();
if(!copied)throw Error('El navegador no permitió copiar al portapapeles.');
}
async function copyHonorDonor(side){
 try{
  const data=window.honorTeamDonors||{left:null,right:null,byTeam:{}};
  const value=side==='both'?data:data[side];
  const text=JSON.stringify(value,null,2);
  if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
   try{await navigator.clipboard.writeText(text)}catch(error){copyText(text)}
  }else copyText(text);
  $('#donorCopyMessage').textContent=(side==='left'?'Donador del equipo izquierdo':side==='right'?'Donador del equipo derecho':'Datos de ambos equipos')+' copiados.';
 }catch(error){$('#donorCopyMessage').textContent='No se pudieron copiar los datos: '+error.message}
}
$('#copyLeftDonor').addEventListener('click',()=>copyHonorDonor('left'));
$('#copyRightDonor').addEventListener('click',()=>copyHonorDonor('right'));
$('#copyTeamDonors').addEventListener('click',()=>copyHonorDonor('both'));
async function copyTechnicalLogs(){
try{
 const text=JSON.stringify({copiedAt:new Date().toISOString(),diagnostic:diagnosticState,logs:currentTechnicalLogs},null,2);
 if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
  try{await navigator.clipboard.writeText(text)}catch(error){copyText(text)}
 }else copyText(text);
 $('#logsMessage').textContent='Logs copiados ('+currentTechnicalLogs.length+' registros).';
}catch(error){$('#logsMessage').textContent='No se pudieron copiar los logs: '+error.message}
}
const eventLabels={member:'Se unió',chat:'Comentario',gift:'Regalo',like:'Me gusta',follow:'Seguidor',share:'Compartido'};
const eventFilterInputs=[...document.querySelectorAll('[data-event-filter]')];
const eventTypeFilters=eventFilterInputs.filter(input=>input.dataset.eventFilter!=='all');
function applyEventFilters(){
 const allFilter=eventFilterInputs.find(input=>input.dataset.eventFilter==='all');
 if(allFilter)allFilter.checked=eventTypeFilters.every(input=>input.checked);
 const selected=new Set(eventTypeFilters.filter(input=>input.checked).map(input=>input.dataset.eventFilter));
 const rows=[...$('#eventList').children];
 rows.forEach(row=>{row.hidden=!selected.has(row.dataset.eventType)});
 const empty=$('#eventEmpty');
 const hasVisibleRows=rows.some(row=>!row.hidden);
 empty.hidden=hasVisibleRows;
 if(rows.length&&!hasVisibleRows)empty.textContent='No hay eventos con los filtros seleccionados.';
 else empty.textContent='Esperando eventos de TikTok…';
}
$('#eventFilterForm').addEventListener('change',event=>{
 const input=event.target.closest('input[data-event-filter]');
 if(!input)return;
 if(input.dataset.eventFilter==='all')eventTypeFilters.forEach(filter=>{filter.checked=input.checked});
 const allFilter=eventFilterInputs.find(item=>item.dataset.eventFilter==='all');
 if(allFilter)allFilter.checked=eventTypeFilters.every(filter=>filter.checked);
});
$('#eventFilterForm').addEventListener('submit',event=>{event.preventDefault();applyEventFilters()});
$('#copyEvents').addEventListener('click',async()=>{
 const rows=[...$('#eventList').querySelectorAll('li:not([hidden])')];
 if(!rows.length){$('#eventMessage').textContent='No hay eventos visibles para copiar.';return}
 const text=rows.map(row=>[...row.children].map(cell=>cell.textContent.trim()).join('\\t')).join('\\n');
 try{
  await navigator.clipboard.writeText(text);
  $('#eventMessage').textContent=rows.length+' evento(s) copiados.';
 }catch(error){$('#eventMessage').textContent='No se pudieron copiar los eventos: '+error.message}
});
$('#clearEvents').addEventListener('click',()=>{
 const list=$('#eventList'),empty=$('#eventEmpty');
 list.replaceChildren();empty.hidden=false;empty.textContent='Lista de eventos limpiada. Esperando nuevos eventos de TikTok…';
 $('#eventMessage').textContent='Lista de eventos limpiada.';
});
function eventDetail(entry){
 const count=Math.max(1,Math.floor(Number(entry.activityCount)||1));
 if(entry.type==='chat')return entry.content||'Comentario';
 if(entry.type==='gift')return (entry.giftName||'Regalo')+(count>1?' × '+count:'');
 if(entry.type==='like')return count+' me gusta';
 if(entry.type==='follow')return 'Empezó a seguir';
 if(entry.type==='share')return 'Compartió el live';
 return 'Se unió al live';
}
function renderLiveEvent(entry){
 const list=$('#eventList'),row=document.createElement('li'),time=document.createElement('time'),kind=document.createElement('span'),user=document.createElement('span'),detail=document.createElement('span');
 const receivedAt=Number(entry.receivedAt)||Date.now();
 row.className='event-row';row.dataset.eventType=entry.type;time.dateTime=new Date(receivedAt).toISOString();time.textContent=new Date(receivedAt).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 kind.className='event-kind';kind.textContent=eventLabels[entry.type]||'Evento';
 user.className='event-user';
 const userLabel=document.createElement('span'),fallback=document.createElement('span'),avatarUrl=String(entry.profilePictureUrl||'');
 userLabel.className='event-user-label';userLabel.textContent=entry.username?'@'+entry.username:(entry.displayName||'—');
 if(entry.username&&entry.displayName&&entry.displayName.toLowerCase()!==entry.username.toLowerCase())userLabel.textContent+=' · '+entry.displayName;
 fallback.className='event-avatar event-avatar-fallback';fallback.dataset.initial=String(entry.displayName||entry.username||'?').trim().slice(0,1).toUpperCase()||'?';fallback.setAttribute('aria-hidden','true');
 if(avatarUrl.toLowerCase().startsWith('https://')){
  const photo=document.createElement('img');photo.className='event-avatar';photo.alt='';photo.loading='eager';photo.referrerPolicy='strict-origin-when-cross-origin';photo.onerror=()=>photo.replaceWith(fallback);photo.src=avatarUrl;user.append(photo);
 }else user.append(fallback);
 user.append(userLabel);
 detail.className='event-detail';detail.textContent=eventDetail(entry);row.append(time,kind,user,detail);list.prepend(row);applyEventFilters();
 while(list.children.length>50)list.lastElementChild.remove();
}
let received=0;const source=new EventSource('/api/events');
source.addEventListener('status',e=>{const s=JSON.parse(e.data),online=!!s.connected;$('#status').textContent=online?'ONLINE':String(s.status||'DESCONECTADO').toUpperCase();$('#status').classList.toggle('online',online);$('#currentUsername').textContent=s.username?'@'+s.username:'Sin usuario';$('#statusDetail').textContent=online?'Conectado a @'+(s.username||'TikTok'):'Estado del conector: '+(s.status||'sin conexión')+(s.username?' · @'+s.username:'')});
source.addEventListener('update',e=>{const payload=JSON.parse(e.data),entry=payload.entry||{};received++;$('#eventCount').textContent=String(received);$('#eventUnitCount').textContent=String(received);renderLiveEvent(entry)});
setInterval(()=>{if(!$('#logsPanel').hidden)loadTechnicalLogs()},5000);
setInterval(()=>{const panel=document.querySelector('[data-units="honor"]');if(panel&&!panel.hidden)loadHonorBoard()},5000);
const motorSource=new EventSource('/api/admin/motor/events');
motorSource.addEventListener('motor-state',event=>renderMotor(JSON.parse(event.data)));
setInterval(()=>{if(lastMotorUpdate&&Date.now()-lastMotorUpdate>2500){$('#motorStatus').textContent='TELEMETRÍA ATRASADA';$('#motorStatus').classList.remove('online')}},1000);
const tools=new EventSource('/api/game-tools/events');
tools.addEventListener('game-tools',e=>{const x=JSON.parse(e.data);$('#tools').textContent=JSON.stringify(x,null,2);$('#giftCount').textContent=String(x.giftCount||0);$('#giftUnitCount').textContent=String(x.giftCount||0)});
tools.addEventListener('game-settings',e=>{const x=JSON.parse(e.data);$('#gift').value=x.giftTurboProgress;$('#tap').value=x.tapTurboProgress});
tools.addEventListener('gift-config',e=>{try{renderGiftConfig(JSON.parse(e.data))}catch(error){$('#giftConfigMessage').textContent='No se pudo actualizar el catálogo: '+error.message}});
fetch('/api/recent-users',{cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.message||response.status);$('#recentUsers').textContent=JSON.stringify(result.users||[],null,2)}).catch(error=>{$('#recentUsers').textContent=error.message});
const savedUsernameSelect=$('#savedUsername');
const usernameInput=$('#connect').elements.namedItem('username');
function renderSavedUsernames(usernames,selected){
 const options=Array.isArray(usernames)?usernames:[];
 savedUsernameSelect.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Selecciona un usuario guardado';savedUsernameSelect.append(placeholder);
 options.forEach(username=>{const option=document.createElement('option');option.value=username;option.textContent='@'+username;savedUsernameSelect.append(option)});
 if(selected&&!options.some(username=>username.toLowerCase()===selected.toLowerCase())){const option=document.createElement('option');option.value=selected;option.textContent='@'+selected;savedUsernameSelect.append(option)}
 savedUsernameSelect.value=selected||'';
 if(selected)usernameInput.value=selected;
}
const fillUsernameFromSaved=()=>{if(savedUsernameSelect.value)usernameInput.value=savedUsernameSelect.value};
savedUsernameSelect.addEventListener('change',fillUsernameFromSaved);
savedUsernameSelect.addEventListener('input',fillUsernameFromSaved);
fetch('/api/admin/usernames',{credentials:'same-origin',cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.message||response.status);renderSavedUsernames(result.usernames,result.selected)}).catch(error=>{$('#savedUsernameMessage').textContent='No se pudieron cargar los usuarios guardados: '+error.message});
fetch('/api/admin/tournament-enabled',{credentials:'same-origin',cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.message||response.status);$('#tournamentEnabled').checked=!!result.enabled}).catch(error=>msg(error.message));
async function refresh(){
 try{
  const [p,c]=await Promise.all([fetch('/api/admin/presence',{credentials:'same-origin'}),fetch('/api/admin/country-stats',{credentials:'same-origin'})]);
  const presence=await p.json(),countries=await c.json();if(!p.ok)throw Error(presence.message||p.status);if(!c.ok)throw Error(countries.message||c.status);
  $('#presence').textContent=JSON.stringify(presence,null,2);$('#countries').textContent=JSON.stringify(countries,null,2);
  $('#overlayState').textContent=presence.active?'ACTIVO':'OFFLINE';$('#overlayClients').textContent=presence.clients+' cliente(s) conectado(s)';
 }catch(e){msg(e.message)}
}
setInterval(refresh,15000);refresh();
</script></body></html>`;

const backendLoginPage = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090e18"><title>Acceso · TortuWorld</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090e18;color:#eaf3ff;font:15px/1.5 Segoe UI,system-ui,sans-serif}.card{width:min(420px,calc(100% - 32px));padding:28px;border:1px solid #29465b;border-radius:16px;background:#111a29;box-shadow:0 16px 40px #0005}h1{font-size:21px;margin:0 0 8px}p{color:#91a4bc;margin:0 0 20px}label{display:grid;gap:7px;color:#91a4bc;font-size:12px}input,button{font:inherit;border-radius:8px;padding:11px 13px}input{width:100%;border:1px solid #31435a;background:#0a1220;color:#eaf3ff}button{margin-top:14px;border:1px solid #57d3ce;background:#1d7884;color:#fff;font-weight:700;cursor:pointer}.error{min-height:22px;margin-top:12px;color:#ff7189;font-size:13px}</style>
<main class="card"><h1>Acceso al backend</h1><p>Ingresa el token de administración para iniciar una sesión protegida de 12 horas.</p><form id="login"><label>Token de administración<input name="token" type="password" autocomplete="current-password" required autofocus></label><button>Iniciar sesión</button></form><div class="error" id="error" role="status"></div></main>
<script>document.getElementById('login').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,error=document.getElementById('error');error.textContent='';try{const response=await fetch('/api/admin/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:form.token.value})});const result=await response.json();if(!response.ok)throw new Error(result.message||'No se pudo iniciar sesión.');location.replace('/backend')}catch(e){error.textContent=e.message;form.token.select()}});</script></html>`;

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = decodeURIComponent(url.pathname);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' }).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    safeJson(res, 403, { message: 'Origen no permitido.' });
    return;
  }

  if (path === '/api/admin/session' && req.method === 'POST') {
    const body = await readBody(req);
    const provided = Buffer.from(typeof body.token === 'string' ? body.token : '');
    const configuredToken = process.env.BACKEND_ADMIN_TOKEN || adminToken;
    const expected = Buffer.from(configuredToken);
    if (!configuredToken || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      safeJson(res, 401, { message: 'Token de administración incorrecto.' });
      return;
    }
    startAdminSession(req, res);
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/session' && req.method === 'DELETE') {
    endAdminSession(req, res);
    safeJson(res, 200, { ok: true });
    return;
  }
  if ((path === '/' || path === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
    await serveFile(req, res, HTML_FILE, { deploymentSignature: true });
    return;
  }
  if (path === '/backend' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      .end(req.method === 'HEAD' ? undefined : hasAdminSession(req) ? backendPage : backendLoginPage);
    return;
  }
  if (path === '/manifest.webmanifest' || path === '/sw.js' || path === '/activity-policy.js') {
    const filename = path === '/activity-policy.js' ? 'activity-policy.js' : path.slice(1);
    await serveFile(req, res, resolve(PUBLIC_DIR, filename));
    return;
  }
  if (/^\/icons\/tortu2-(?:192|512)\.(?:png|svg)$/.test(path) && (req.method === 'GET' || req.method === 'HEAD')) {
    await serveFile(req, res, resolve(PUBLIC_DIR, path.slice(1)));
    return;
  }
  if (path === '/api/events' && req.method === 'GET') {
    const initialEvents = [['status', {
      connected: connection.connected,
      status: connection.status,
      username: connection.username
    }]];
    const diagnostic = diagnosticModeState();
    if (diagnostic.active) initialEvents.push(['diagnostic-mode', diagnostic]);
    sse(req, res, clients, initialEvents);
    return;
  }
  if (path === '/api/motor/telemetry' && req.method === 'POST') {
    const telemetry = normalizeMotorTelemetry(await readBody(req));
    if (!telemetry) {
      safeJson(res, 400, { message: 'Telemetría del motor inválida.' });
      return;
    }
    motorTelemetry = telemetry;
    broadcastSse(motorClients, 'motor-state', motorTelemetry);
    broadcastSse(clients, 'motor-state', motorTelemetry);
    safeJson(res, 200, { ok: true, updatedAt: motorTelemetry.updatedAt });
    return;
  }
  if (path === '/api/admin/motor/events' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    sse(req, res, motorClients, [['motor-state', motorTelemetry]]);
    return;
  }
  if (path === '/api/admin/logs' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const limitParam = url.searchParams.get('limit');
    const requestedLimit = limitParam === null ? 100 : Number(limitParam);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_TECHNICAL_LOGS, Math.max(1, Math.floor(requestedLimit)))
      : 100;
    safeJson(res, 200, { logs: technicalLogs.slice(0, limit), diagnostic: diagnosticModeState() });
    return;
  }
  if (path === '/api/admin/diagnostic-mode' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    if (typeof body.enabled !== 'boolean') {
      safeJson(res, 400, { message: 'El estado del diagnóstico debe ser verdadero o falso.' });
      return;
    }
    safeJson(res, 200, setDiagnosticMode(body.enabled));
    return;
  }
  if (path === '/api/game-tools/events' && req.method === 'GET') {
    const config = await loadGiftConfig();
    const voiceConfig = await loadVoiceConfig();
    sse(req, res, toolClients, [
      ['game-settings', { giftTurboProgress: settings.giftTurboProgress, tapTurboProgress: settings.tapTurboProgress, giftTurboMs: DEFAULT_GIFT_TURBO_MS }],
      ['game-tools', { timerStartedAt: settings.timerStartedAt, giftCount: settings.giftCount }],
      ['gift-config', honorGiftConfig(config)],
      ['voice-config', voiceConfig]
    ]);
    return;
  }
  if (path === '/api/state.js' && req.method === 'GET') {
    const state = await stateSnapshot();
    const js = `window.CLUSS_STATE = ${JSON.stringify(state).replace(/</g, '\\u003c')};`;
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(js);
    return;
  }
  if (path === '/api/deployment-signature' && req.method === 'GET') {
    const html = await readFile(HTML_FILE);
    safeJson(res, 200, { signature: deploymentSignature(html) });
    return;
  }
  if (path === '/api/voice-priority' && req.method === 'GET') {
    safeJson(res, 200, { ...voicePriority, ...await loadVoiceConfig() });
    return;
  }
  if (path === '/api/recent-users' && req.method === 'GET') {
    safeJson(res, 200, { users: recentUsers.slice(0, 4) });
    return;
  }
  if (path === '/api/admin/usernames' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    safeJson(res, 200, { selected: configuredUsername(), usernames: usernameHistory() });
    return;
  }
  if (path === '/api/honor/last-gift' && req.method === 'GET') {
    safeJson(res, 200, { gift: latestHonorGift });
    return;
  }
  if (path === '/api/honor/team-gifts' && req.method === 'GET') {
    safeJson(res, 200, {
      giftsByTeam: Object.fromEntries([...teamGiftHistory].map(([teamId, history]) => [teamId, history.records])),
      countsByTeam: Object.fromEntries([...teamGiftHistory].map(([teamId, history]) => [teamId, history.total]))
    });
    return;
  }
  if (path === '/api/honor/team-gifts' && req.method === 'POST') {
    if (req.headers['x-overlay-control'] !== 'gift-attribution' || !isSameOriginRequest(req)) {
      safeJson(res, 403, { message: 'La atribución del regalo solo está disponible desde el overlay.' });
      return;
    }
    const body = await readBody(req);
    const eventId = typeof body.eventId === 'string' ? body.eventId.slice(0, 300) : '';
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    const entry = acceptedTeamGifts.get(eventId);
    if (!entry || !TEAM_NAMES[teamId] || !entry.username) {
      safeJson(res, 400, { message: 'El regalo o el equipo no son válidos.' });
      return;
    }
    if (entry.attributedTeamId) {
      if (entry.attributedTeamId !== teamId) {
        safeJson(res, 409, { message: 'Este regalo ya fue atribuido a otro equipo.' });
        return;
      }
      safeJson(res, 200, { ok: true, duplicate: true });
      return;
    }
    const record = normalizeTeamGiftRecord({
      eventId,
      teamId,
      teamName: TEAM_NAMES[teamId],
      username: entry.username,
      displayName: entry.displayName,
      avatarUrl: entry.profilePictureUrl,
      giftName: entry.giftName,
      giftDiamonds: entry.giftDiamonds,
      activityCount: entry.activityCount,
      receivedAt: entry.receivedAt
    });
    if (!record) {
      safeJson(res, 400, { message: 'No se pudo normalizar el regalo.' });
      return;
    }
    await persistTeamGiftRecord(record);
    entry.attributedTeamId = teamId;
    safeJson(res, 200, { ok: true, record });
    return;
  }
  if (path === '/api/reconnect' && req.method === 'POST') {
    if (connection.connected) {
      safeJson(res, 409, { ok: true, username: connection.username, message: 'Ya está conectado.' });
      return;
    }
    const username = configuredUsername();
    if (!username) {
      safeJson(res, 400, { message: 'El usuario de TikTok no puede estar vacío.' });
      return;
    }
    retryDeadline = Date.now() + 5 * 60 * 1000;
    retryCount = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    void createConnection(username);
    safeJson(res, 200, { ok: true, username });
    return;
  }
  if (path === '/api/connect' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const requested = normalizeUsername(body.username);
    if (!requested) {
      safeJson(res, 400, { ok: false, message: 'El usuario de TikTok no puede estar vacío.' });
      return;
    }
    rememberUsername(requested);
    await persistSettings();
    const username = requested;
    retryDeadline = Date.now() + 5 * 60 * 1000;
    retryCount = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    void createConnection(username);
    safeJson(res, 200, { ok: true, username, usernames: usernameHistory(), message: 'Conexión iniciada.' });
    return;
  }
  if (path === '/api/connect/next' && req.method === 'POST') {
    if (req.headers['x-overlay-control'] !== 'switch-user' || !isSameOriginRequest(req)) {
      safeJson(res, 403, { ok: false, message: 'El cambio de usuario solo está disponible desde el overlay.' });
      return;
    }
    const now = Date.now();
    if (now - lastUsernameSwitchAt < 1500) {
      safeJson(res, 429, { ok: false, message: 'Espera un momento antes de cambiar otra vez de usuario.' });
      return;
    }
    const currentUsername = configuredUsername();
    const username = nextSavedUsername(currentUsername);
    if (!username || username.toLowerCase() === currentUsername.toLowerCase()) {
      safeJson(res, 409, { ok: false, message: 'No hay otro usuario guardado para conectar.' });
      return;
    }
    lastUsernameSwitchAt = now;
    rememberUsername(username);
    await persistSettings();
    retryDeadline = Date.now() + 5 * 60 * 1000;
    retryCount = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    void createConnection(username);
    safeJson(res, 200, { ok: true, username, message: `Conectando a @${username}.` });
    return;
  }
  if (path === '/api/overlay/don-tortu' && req.method === 'POST') {
    if (req.headers['x-overlay-control'] !== 'don-tortu' || !isSameOriginRequest(req)) {
      safeJson(res, 403, { ok: false, message: 'El control de Don Tortu solo está disponible desde el overlay.' });
      return;
    }
    const config = await loadVoiceConfig();
    config.donTortuEnabled = !config.donTortuEnabled;
    await setState('cluss.voice', config);
    broadcastTool('voice-config', config);
    safeJson(res, 200, { ok: true, donTortuEnabled: config.donTortuEnabled });
    return;
  }
  if (path === '/api/game-tools/overlay-heartbeat' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.clientId !== 'string' || body.clientId.length > 100 || typeof body.visible !== 'boolean') {
      safeJson(res, 400, { message: 'Heartbeat inválido.' });
      return;
    }
    if (body.visible) heartbeats.set(body.clientId, Date.now());
    else heartbeats.delete(body.clientId);
    refreshOverlayPresence();
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/round/complete' && req.method === 'POST') {
    await readBody(req);
    for (const [code, count] of Object.entries(pendingCountryComments)) {
      if (count > 0) settings.countryStats[code].comments += count;
      pendingCountryComments[code] = 0;
    }
    await persistSettings();
    const round = { completedAt: Date.now(), countryComments: { ...settings.countryStats } };
    await writeJsonAtomic(resolve(DATA_DIR, 'rounds', `${round.completedAt}.json`), round);
    safeJson(res, 200, { ok: true, completedAt: round.completedAt });
    return;
  }
  if (path === '/api/tournament/vote' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    if (!settings.tournamentEnabled || !username || typeof body.team !== 'string' || !body.team.trim()) {
      safeJson(res, 400, { ok: false, message: 'Voto inválido o Torneo Libre deshabilitado.' });
      return;
    }
    await registerTournamentVote(username, body.team.trim().slice(0, 80));
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/country/cup' && req.method === 'POST') {
    const body = await readBody(req);
    const country = COUNTRIES.find(item => item.code === String(body.countryCode || '').toUpperCase());
    if (!country) {
      safeJson(res, 400, { ok: false, message: 'Código de país no válido.' });
      return;
    }
    settings.countryStats[country.code].cups++;
    await persistSettings();
    safeJson(res, 200, { ok: true });
    return;
  }

  const stateMatch = path.match(/^\/api\/state\/(.+)$/);
  if (stateMatch && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
    const key = stateMatch[1];
    if (!statePath(key)) {
      safeJson(res, 400, { message: 'Clave de estado no permitida.' });
      return;
    }
    if (req.method === 'GET') {
      const result = await getState(key);
      if (!result.found) safeJson(res, 404, { message: 'Estado no encontrado.' });
      else safeJson(res, 200, result.value);
    } else if (req.method === 'PUT') {
      const value = await readBody(req);
      await setState(key, value);
      safeJson(res, 200, { ok: true });
    } else {
      await deleteState(key);
      safeJson(res, 200, { ok: true });
    }
    return;
  }
  const logMatch = path.match(/^\/api\/log\/([^/]+)$/);
  if (logMatch && ['POST', 'DELETE'].includes(req.method)) {
    const flow = logMatch[1];
    if (!logPath(flow)) {
      safeJson(res, 404, { message: 'Flujo de log no permitido.' });
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.records) || body.records.length > MAX_LOG_BATCH) {
        safeJson(res, 400, { message: `records debe contener como máximo ${MAX_LOG_BATCH} elementos.` });
        return;
      }
      const saved = await appendRecords(flow, body.records);
      safeJson(res, 200, { ok: true, saved });
    } else {
      await rm(logPath(flow), { force: true });
      if (flow === 'chat-texts') {
        await writeJsonAtomic(resolve(DATA_DIR, 'chat-archive-meta.json'), {
          v: 1, created: Date.now(), updated: Date.now(), trimmed: 0, count: 0
        });
        const path = statePath('cluss.chatArchive');
        if (path) await rm(path, { force: true });
      }
      safeJson(res, 200, { ok: true });
    }
    return;
  }
  if (path === '/api/log/chat-texts.json' && req.method === 'GET') {
    const records = await readLog('chat-texts');
    const body = JSON.stringify(records);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="chat-texts.json"',
      'cache-control': 'no-store'
    }).end(body);
    return;
  }
  if (path === '/api/log/chat-texts.txt' && req.method === 'GET') {
    const records = await readLog('chat-texts');
    const body = records.map(record => `${new Date(Number(record[0])).toISOString()}\t${record[1]}`).join('\n');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="chat-texts.txt"',
      'cache-control': 'no-store'
    }).end(body);
    return;
  }
  if (path === '/api/admin/reconnect' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    retryDeadline = Date.now() + 5 * 60 * 1000;
    retryCount = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (connector?.disconnect) await connector.disconnect().catch(() => {});
    connector = null;
    void createConnection(configuredUsername());
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/game-settings' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const gift = Number(body.giftTurboProgress);
    const tap = Number(body.tapTurboProgress);
    if (![gift, tap].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) {
      safeJson(res, 400, { message: 'Los valores deben estar entre 0 y 100.' });
      return;
    }
    settings.giftTurboProgress = gift;
    settings.tapTurboProgress = tap;
    await persistSettings();
    broadcastTool('game-settings', { giftTurboProgress: gift, tapTurboProgress: tap, giftTurboMs: DEFAULT_GIFT_TURBO_MS });
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/voice-config' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    safeJson(res, 200, await loadVoiceConfig());
    return;
  }
  if (path === '/api/admin/voice-config' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const repeatCooldownMinutes = body.repeatCooldownMinutes === undefined
      ? null
      : Number(body.repeatCooldownMinutes);
    if (body.donTortuEnabled !== undefined && typeof body.donTortuEnabled !== 'boolean') {
      safeJson(res, 400, { message: 'donTortuEnabled debe ser booleano.' });
      return;
    }
    if (body.enabledLevels !== undefined && (!body.enabledLevels || typeof body.enabledLevels !== 'object' || Array.isArray(body.enabledLevels))) {
      safeJson(res, 400, { message: 'enabledLevels debe ser un objeto de niveles booleanos.' });
      return;
    }
    if (body.enabledLevels !== undefined && Object.entries(body.enabledLevels).some(([id, enabled]) =>
      !voicePriority.levels.some(level => level.id === id) || typeof enabled !== 'boolean'
    )) {
      safeJson(res, 400, { message: 'enabledLevels contiene un nivel desconocido o un estado inválido.' });
      return;
    }
    if (repeatCooldownMinutes !== null && (!Number.isInteger(repeatCooldownMinutes) || repeatCooldownMinutes < 1 || repeatCooldownMinutes > 1440)) {
      safeJson(res, 400, { message: 'El tiempo debe ser un número entero entre 1 y 1440 minutos.' });
      return;
    }
    const currentConfig = await loadVoiceConfig();
    const config = {
      repeatCooldownMinutes: repeatCooldownMinutes ?? currentConfig.repeatCooldownMinutes,
      donTortuEnabled: body.donTortuEnabled ?? currentConfig.donTortuEnabled,
      enabledLevels: voiceConfigView({
        enabledLevels: { ...currentConfig.enabledLevels, ...(body.enabledLevels || {}) }
      }).enabledLevels
    };
    await setState('cluss.voice', config);
    broadcastTool('voice-config', config);
    safeJson(res, 200, config);
    return;
  }
  if (path === '/api/admin/game-tools/reset' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    await readBody(req);
    settings.timerStartedAt = Date.now();
    settings.giftCount = 0;
    await persistSettings();
    broadcastTool('game-tools', { timerStartedAt: settings.timerStartedAt, giftCount: 0 });
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/game-command' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    if (!COMMANDS.has(body.command)) {
      safeJson(res, 400, { message: 'Comando no permitido.' });
      return;
    }
    broadcastTool('game-command', { command: body.command });
    safeJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/tournament-enabled' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    safeJson(res, 200, { enabled: settings.tournamentEnabled });
    return;
  }
  if (path === '/api/admin/vs-config' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const stored = await getState('cluss.vs');
    const config = vsConfigView(stored.value);
    safeJson(res, 200, { list: config.list, raceList: config.raceList, teams: DEFAULT_TEAM_CATALOG });
    return;
  }
  if (path === '/api/admin/vs-config' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const allowed = new Set(DEFAULT_VS.map(item => item.k));
    const enabledKeys = body.enabledKeys;
    const stored = await getState('cluss.vs');
    const previous = vsConfigView(stored.value);
    const popularKeys = body.popularKeys === undefined
      ? previous.list.filter(item => item.popular).map(item => item.k)
      : body.popularKeys;
    const validKeys = keys => Array.isArray(keys) && keys.length <= DEFAULT_VS.length &&
      keys.every(key => typeof key === 'string' && allowed.has(key)) &&
      new Set(keys).size === keys.length;
    if (!validKeys(enabledKeys) || !validKeys(popularKeys)) {
      safeJson(res, 400, { message: 'La selección de VS habilitados o populares no es válida.' });
      return;
    }
    const enabled = new Set(enabledKeys);
    const popular = new Set(popularKeys);
    const popularRaces = DEFAULT_VS.filter(item => enabled.has(item.k) && popular.has(item.k));
    const nonPopularRaces = DEFAULT_VS.filter(item => enabled.has(item.k) && !popular.has(item.k));
    const nextNonPopular = nonPopularRaces.find(item => item.k === previous.np) ||
      nonPopularRaces.find(item => item.k === previous.cur) || nonPopularRaces[0];
    await setState('cluss.vs', {
      v: DEFAULT_VS_CONFIG_VERSION,
      cur: previous.cur,
      np: previous.np,
      list: DEFAULT_VS.map(item => ({
        k: item.k,
        on: enabled.has(item.k),
        popular: popular.has(item.k)
      })),
      raceList: [
        ...popularRaces,
        ...(nextNonPopular ? [nextNonPopular] : [])
      ].map(item => ({ k: item.k, played: false })),
      st: previous.st
    });
    broadcastTool('vs-config', { enabledKeys, popularKeys });
    safeJson(res, 200, { ok: true, enabledKeys, popularKeys });
    return;
  }
  if (path === '/api/admin/gifts-config' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    safeJson(res, 200, await loadGiftConfig());
    return;
  }
  if (path === '/api/gifts/catalog' && req.method === 'GET') {
    safeJson(res, 200, honorGiftConfig(await loadGiftConfig()));
    return;
  }
  if (path === '/api/admin/gifts-config' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const config = await loadGiftConfig();
    const rotationSeconds = Number(body.rotationSeconds);
    const enabledKeys = body.enabledKeys;
    const knownKeys = new Set(config.catalog.map(item => item.key));
    if (!Number.isInteger(rotationSeconds) || rotationSeconds < 1 || rotationSeconds > 3600 ||
        !Array.isArray(enabledKeys) || enabledKeys.length > config.catalog.length ||
        enabledKeys.some(key => typeof key !== 'string' || !knownKeys.has(key)) ||
        new Set(enabledKeys).size !== enabledKeys.length) {
      safeJson(res, 400, { message: 'Revisa la rotación y la selección del catálogo de regalos.' });
      return;
    }
    const enabled = new Set(enabledKeys);
    giftCatalogConfig = {
      ...config,
      rotationSeconds,
      catalog: config.catalog.map(item => ({ ...item, enabled: enabled.has(item.key) }))
    };
    await setState('cluss.gifts', giftCatalogConfig);
    broadcastTool('gift-config', honorGiftConfig());
    safeJson(res, 200, { ok: true, config: giftCatalogConfig });
    return;
  }
  if (path === '/api/admin/tournament-enabled' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    if (typeof body.enabled !== 'boolean') {
      safeJson(res, 400, { message: 'enabled debe ser booleano.' });
      return;
    }
    settings.tournamentEnabled = body.enabled;
    await persistSettings();
    safeJson(res, 200, { ok: true, enabled: settings.tournamentEnabled });
    return;
  }
  if (path === '/api/admin/presence' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const cutoff = Date.now() - 90000;
    for (const [id, at] of heartbeats) if (at < cutoff) heartbeats.delete(id);
    safeJson(res, 200, { active: heartbeats.size > 0, clients: heartbeats.size });
    return;
  }
  if (path === '/api/admin/country-stats' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    safeJson(res, 200, {
      countries: [
        ...COUNTRIES.map(country => ({ code: country.code, name: country.name, ...settings.countryStats[country.code] })),
        { code: 'sin-pais', name: 'Sin país', ...settings.countryStats['sin-pais'] }
      ]
    });
    return;
  }

  safeJson(res, 404, { message: 'No encontrado.' });
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  settings = { ...settings, ...(await loadJson(resolve(DATA_DIR, 'settings.json'), {})) };
  settings.username = configuredUsername();
  settings.savedUsernames = usernameHistory();
  await loadGiftConfig();
  const storedHonorGift = await getState('cluss.honorLastGift');
  latestHonorGift = storedHonorGift.found ? storedHonorGift.value : null;
  if (Array.isArray(settings.recentUsers)) recentUsers.push(...settings.recentUsers.slice(0, 4));
  settings.countryStats ||= Object.fromEntries([...COUNTRIES.map(country => country.code), 'sin-pais'].map(code => [code, { comments: 0, cups: 0 }]));
  for (const country of COUNTRIES) {
    settings.countryStats[country.code] ||= { comments: 0, cups: 0 };
  }
  settings.countryStats['sin-pais'] ||= { comments: 0, cups: 0 };
  await persistSettings();
  if (!adminToken) {
    adminToken = randomBytes(24).toString('base64url');
    console.log(`Token BACKEND_ADMIN_TOKEN generado para esta sesión: ${adminToken}`);
  }
  await loadTeamGiftArchive();
  await pruneLogs();
  setInterval(refreshOverlayPresence, 15000).unref();
  setInterval(() => {
    void pruneLogs().catch(error => recordTechnicalLog('error', `No se pudieron depurar logs: ${error.message}`));
  }, 15 * 60 * 1000).unref();
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, seenAt] of seenEventIds) if (seenAt < cutoff) seenEventIds.delete(id);
  }, 60000).unref();
  const server = createServer((req, res) => {
    void handle(req, res).catch(error => {
      recordTechnicalLog('error', `Error de solicitud: ${error.message}`);
      if (!res.headersSent) safeJson(res, error.status || 500, { message: error.status ? error.message : 'Error interno del servidor.' });
      else res.destroy();
    });
  });
  server.listen(PORT, HOST, () => {
    recordTechnicalLog('info', `TortuWorld v${PACKAGE_VERSION} escuchando en http://${HOST}:${PORT}`);
    const username = configuredUsername();
    if (username) void createConnection(username);
  });
  const shutdown = async () => {
    shuttingDown = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      if (connector?.disconnect) await connector.disconnect();
    } catch (error) {
      recordTechnicalLog('error', `Error al cerrar TikTok: ${error.message}`);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export {
  normalizeUsername,
  configuredUsername,
  usernameHistory,
  nextSavedUsername,
  normalizeTikTokEvent,
  comboDelta,
  dedupeEvent,
  identifyCountry,
  socialEventType,
  handleTikTokEvent,
  appendRecords,
  stateSnapshot,
  handle,
  main
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
