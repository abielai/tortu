import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { comboDelta, configuredUsername, dedupeEvent, handle, handleTikTokEvent, identifyCountry, nextSavedUsername, normalizeTikTokEvent, normalizeUsername, socialEventType } from './server.js';
import voicePriority from './server/voice-priority.js';

test('live event counters count events, not weighted interaction points', () => {
  const browser = { window: {} };
  runInNewContext(readFileSync(new URL('./public/activity-policy.js', import.meta.url), 'utf8'), browser);
  const policy = browser.window.TORTUWORLD_ACTIVITY_POLICY;
  assert.equal(policy.HEART_MAX, 45);
  assert.equal(policy.HEART_START, 45);
  assert.equal(policy.HEART_STEP, 0);
  assert.equal(policy.eventCountDelta('chat', 8), 1);
  assert.equal(policy.eventCountDelta('follow', 8), 1);
  assert.equal(policy.eventCountDelta('share', 8), 1);
  assert.equal(policy.eventCountDelta('like', 8), 8);
  assert.equal(policy.eventCountDelta('gift', 3), 3);
  assert.equal(policy.eventCountDelta('unknown', 3), 0);
  assert.equal(policy.statEventDelta('chat', 8), 5);
  assert.equal(policy.statEventDelta('gift', 3), 30);
});

test('tap limit stays fixed at 45 per team despite track progress and manual adjustment commands', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const limitSource = html.match(/P\.HEART_START=[^;]+;P\.HEART_STEP=[^;]+;P\.HEART_MAX=[^;]+;/)?.[0];
  const baseSource = html.match(/const heartBase=\(\)=>[^\n]+/)?.[0];
  const syncSource = html.match(/function syncHeartLimit\(\)\{[\s\S]*?\n\}/)?.[0];
  const manualSource = html.match(/function setTurboLimit\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(limitSource);
  assert.ok(baseSource);
  assert.ok(syncSource);
  assert.ok(manualSource);

  const context = {};
  runInNewContext(`
    const P={};
    ${limitSource}
    const HEART_START=P.HEART_START, HEART_STEP=P.HEART_STEP, HEART_MAX=P.HEART_MAX;
    const S=[{p:100},{p:100}], T=[{},{}], heart=[0,0];
    let HEART_N=HEART_START, over=false;
    const renderHeart=()=>{}, heartAdd=()=>{}, messages=[], toast=message=>messages.push(message);
    ${baseSource}
    ${syncSource}
    ${manualSource}
    syncHeartLimit();
    globalThis.automaticLimit=HEART_N;
    setTurboLimit(10);
    globalThis.manualLimit=HEART_N;
    globalThis.toastMessage=messages[0];
  `, context);

  assert.equal(context.automaticLimit, 45);
  assert.equal(context.manualLimit, 45);
  assert.equal(context.toastMessage, 'Límite de turbo fijo en 45 taps');
});

test('idle visual advance waits 15 seconds, alternates teams at two meters per second, and resets per race', () => {
  const browser = { window: {} };
  runInNewContext(readFileSync(new URL('./public/activity-policy.js', import.meta.url), 'utf8'), browser);
  const advance = browser.window.TORTUWORLD_ACTIVITY_POLICY.createIdleVisualAdvance();
  advance.reset(1000);
  assert.deepEqual(Array.from(advance.update(15999, 1000, true)), [0, 0]);
  assert.deepEqual(Array.from(advance.update(16000, 1000, true)), [0, 0]);
  assert.deepEqual(Array.from(advance.update(16500, 1000, true)), [1, 0]);
  assert.deepEqual(Array.from(advance.update(17000, 1000, true)), [2, 0]);
  assert.deepEqual(Array.from(advance.update(17500, 1000, true)), [2, 1]);
  assert.deepEqual(Array.from(advance.update(18000, 1000, true)), [2, 2]);
  assert.deepEqual(Array.from(advance.update(22000, 21000, true)), [2, 2]);
  assert.deepEqual(Array.from(advance.update(36000, 21000, true)), [2, 2]);
  assert.deepEqual(Array.from(advance.update(37000, 21000, true)), [4, 2]);
  advance.reset(37000);
  assert.deepEqual(Array.from(advance.update(51999, 37000, true)), [0, 0]);
  assert.deepEqual(Array.from(advance.update(52000, 37000, true)), [0, 0]);
  assert.deepEqual(Array.from(advance.update(53000, 37000, true)), [2, 0]);
  assert.deepEqual(Array.from(advance.update(54000, 37000, true)), [2, 2]);
});

test('idle visual advance pauses the inactive team for three seconds when its rival advances', () => {
  const browser = { window: {} };
  runInNewContext(readFileSync(new URL('./public/activity-policy.js', import.meta.url), 'utf8'), browser);
  const advance = browser.window.TORTUWORLD_ACTIVITY_POLICY.createIdleVisualAdvance();
  advance.reset(0);
  assert.deepEqual(Array.from(advance.update(16000, 0, true, [0, 19000])), [2, 0]);
  assert.deepEqual(Array.from(advance.update(18000, 0, true, [0, 19000])), [4, 0]);
  assert.deepEqual(Array.from(advance.update(20000, 0, true, [0, 19000])), [6, 0]);
  assert.deepEqual(Array.from(advance.update(21000, 0, true, [0, 19000])), [6, 2]);
});

test('gift turbo distance is 10 meters plus 5 meters per diamond for each gift unit', () => {
  const browser = { window: {} };
  runInNewContext(readFileSync(new URL('./public/activity-policy.js', import.meta.url), 'utf8'), browser);
  const meters = browser.window.TORTUWORLD_ACTIVITY_POLICY.giftTurboMeters;
  const overlay = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  assert.equal(meters(1, 1), 15);
  assert.equal(meters(3, 1), 25);
  assert.equal(meters(1, 2), 30);
  assert.equal(meters(0, 1), 10);
  assert.match(overlay, /\+10 m \+ 5 m\/💎/);
});

test('voice phrase cache blocks normalized repeats until the configured minute expires', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let now = 1000;
  const spoken = [];
  const listeners = new Map();
  const legacyQueues = { voiceQueue: [], giftQueue: [], chatQueue: [], narratorQueue: [] };
  const sandbox = {
    voiceQueue: legacyQueues.voiceQueue,
    giftQueue: legacyQueues.giftQueue,
    chatQueue: legacyQueues.chatQueue,
    narratorQueue: legacyQueues.narratorQueue,
    activeVoiceRequest: { text: 'old speech' },
    giftSpeaking: true,
    giftSpeechGeneration: 0
  };
  let donTortuEnabled = true;
  const window = {
    speechSynthesis: {
      speak: utterance => spoken.push(utterance.text),
      cancel() {},
      getVoices: () => [],
      addEventListener() {}
    },
    liveEventMonitor: { receive(event) { return event; }, completeRound() { return 'completed'; } },
    I18N: { en: false },
    resolveGiftTeamFor: username => username === 'ana' ? 0 : 1,
    setDonTortuEnabled: enabled => { donTortuEnabled = enabled; },
    addEventListener: (type, listener) => listeners.set(type, listener)
  };
  class FakeDate extends Date {
    static now() { return now; }
  }
  Object.assign(sandbox, {
    window,
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    Date: FakeDate,
    performance: { now: () => now },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {}
  });
  runInNewContext(script, sandbox);
  window.vozPrioridad.clear();
  spoken.length = 0;
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'Ana', username: 'ana', giftName: 'Rosa', activityCount: 1, giftDiamonds: 1 });
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'aná', username: 'ana', giftName: 'Rosa', activityCount: 1, giftDiamonds: 1 });
  assert.deepEqual(spoken, ['Gracias Ana por enviar 1 Rosa. Tu equipo Olimpia entra en modo turbo y tu foto queda en el cuadro de honor.']);
  assert.equal(window.getVoiceMonitorState().recentPhrases.length, 1);
  now += 59999;
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'Ana', username: 'ana', giftName: 'Rosa', activityCount: 1, giftDiamonds: 1 });
  assert.equal(window.getVoiceMonitorState().queue.length, 0);
  now += 1;
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'Ana', username: 'ana', giftName: 'Rosa', activityCount: 1, giftDiamonds: 1 });
  assert.equal(window.getVoiceMonitorState().queue.length, 1);
  listeners.get('voice-config-update')({ detail: { repeatCooldownMinutes: 2, donTortuEnabled: false } });
  assert.equal(window.getVoiceMonitorState().phraseCooldownMs, 120000);
  assert.equal(donTortuEnabled, false);
  listeners.get('voice-config-update')({ detail: { enabledLevels: { gift: false } } });
  assert.equal(window.getVoiceMonitorState().levels.find(level => level.id === 'gift').enabled, false);
  const spokenBeforeDisabledGift = spoken.length;
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'Beto', username: 'beto' });
  assert.equal(spoken.length, spokenBeforeDisabledGift);
  listeners.get('voice-config-update')({ detail: { enabledLevels: { gift: true } } });
  window.liveEventMonitor.receive({ type: 'gift', displayName: 'Beto', username: 'beto' });
  window.liveEventMonitor.receive({ type: 'chat', displayName: 'Carla', username: 'carla', content: 'Hola' });
  assert.ok(window.getVoiceMonitorState().queue.some(item => item.id === 'chat'));
  legacyQueues.voiceQueue.push({ text: 'old voice' });
  legacyQueues.giftQueue.push({ text: 'old gift' });
  legacyQueues.chatQueue.push({ text: 'old chat' });
  legacyQueues.narratorQueue.push({ text: 'old narrator' });
  window.liveEventMonitor.completeRound('ol');
  assert.equal(window.getVoiceMonitorState().queue.length, 0);
  assert.match(window.getVoiceMonitorState().current, /Gracias Beto/);
  for (const queue of Object.values(legacyQueues)) assert.equal(queue.length, 0);
  assert.equal(sandbox.activeVoiceRequest, null);
  assert.equal(sandbox.giftSpeaking, false);
  assert.equal(sandbox.giftSpeechGeneration, 2);
});

test('race starts announce both teams without tap-tap support narration', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const spoken = [];
  const browser = {
    window: {
      speechSynthesis: {
        speak: utterance => spoken.push(utterance),
        cancel() {},
        getVoices: () => [],
        addEventListener() {}
      },
      liveEventMonitor: { receive(event) { return event; } },
      I18N: { en: false },
      addEventListener() {}
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  runInNewContext(script, browser);
  assert.match(spoken[0].text, /Olimpia y Cerro/);
  assert.equal(spoken.some(item => /tap[- ]tap|apoyar a tu equipo/i.test(item.text)), false);
  assert.equal(browser.window.getVoiceMonitorState().levels.some(level => level.id === 'support'), false);
});

test('last donors persist by team, render without gift details, and survive race reset', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="donor-meta-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const savedStates = {};
  const markers = [null, null];
  const lanes = { classList: { contains: () => false } };
  const sv = [0, 1].map(index => ({
    children: [],
    querySelector(selector) { return selector === '.donor-marker' ? markers[index] : null; },
    appendChild(child) { this.children.push(child); if (child.className === 'donor-marker') markers[index] = child; }
  }));
  const makeNode = tag => ({
    tagName: tag,
    children: [],
    attrs: {},
    hidden: false,
    setAttribute(name, value) { this.attrs[name] = value; },
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); }
  });
  const context = {
    window: { SRV: {
      get: key => savedStates[key],
      set: (key, value) => { savedStates[key] = value; }
    } },
    document: {
      getElementById: id => id === 'lanes' ? lanes : id === 'sv0' ? sv[0] : id === 'sv1' ? sv[1] : null,
      createElement: makeNode
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    handleLiveEntry() { context.push(0, 'gift'); },
    push() { return true; },
    reset() { return true; },
    console,
    Date,
    String,
    Number,
    Math
  };
  runInNewContext(script, context);
  context.handleLiveEntry({
    type: 'gift', username: 'ana', displayName: 'Ana', profilePictureUrl: 'https://example.test/ana.jpg',
    giftName: 'Rosa', giftDiamonds: 1, activityCount: 2, receivedAt: '2025-01-01T00:00:00.000Z'
  });
  assert.equal(savedStates['cluss.honorLastGiftTeams'].teams.ol.username, 'ana');
  assert.equal(savedStates['cluss.honorLastGiftTeams'].rightTeamId, 'cp');
  assert.equal(markers[0].children[1].textContent, '@ana');
  assert.doesNotMatch(markers[0].children.map(child => child.textContent).join(' '), /Rosa|🎁/);
  context.reset();
  assert.equal(savedStates['cluss.honorLastGiftTeams'].teams.ol.username, 'ana');
});

test('main voice announces only the four milestones and names the losing team', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const spoken = [];
  const intervals = [];
  const timers = [];
  const browser = {
    window: {
      speechSynthesis: {
        speak: utterance => spoken.push(utterance),
        cancel() {},
        getVoices: () => [],
        addEventListener() {}
      },
      liveEventMonitor: { receive(event) { return event; }, completeRound() {} },
      I18N: { en: false },
      addEventListener() {}
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  runInNewContext(script, browser);
  browser.window.vozPrioridad.clear();
  spoken.length = 0;
  const announceMilestones = intervals.filter(interval => interval.ms === 1000).at(-1).callback;
  for (const [index, milestone] of [20, 50, 80, 90].entries()) {
    browser.S[0].p = milestone;
    announceMilestones();
    assert.match(spoken[index].text, new RegExp(`${milestone} metros`));
    assert.match(spoken[index].text, /Cerro va perdiendo/);
    spoken[index].onend();
    while (timers.length) timers.shift()();
  }
  browser.S[0].p = 100;
  announceMilestones();
  assert.equal(spoken.length, 4);
  assert.deepEqual(Array.from(browser.window.getVoiceMonitorState().spokenMilestones), [20, 50, 80, 90]);
});

test('high event volume lets the current main voice finish without interruption', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const intervals = [];
  let cancelCount = 0;
  const browser = {
    window: {
      speechSynthesis: {
        speak() {},
        cancel() { cancelCount++; },
        getVoices: () => [],
        addEventListener() {}
      },
      liveEventMonitor: { receive(event) { return event; } },
      I18N: { en: false },
      addEventListener() {}
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; },
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  runInNewContext(script, browser);
  browser.S[0].p = 20;
  intervals.filter(interval => interval.ms === 1000).at(-1).callback();
  assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
  for (let index = 0; index < 20; index++) {
    browser.window.liveEventMonitor.receive({ type: 'follow', username: `fan${index}` });
  }
  assert.equal(browser.window.getVoiceMonitorState().interactionCountLastMinute, 20);
  assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
  browser.window.liveEventMonitor.receive({ type: 'follow', username: 'fan20' });
  assert.equal(browser.window.getVoiceMonitorState().interactionCountLastMinute, 21);
  assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
  assert.equal(cancelCount, 0);
});

test('turbo uses the first voice, jumps the queue, and never interrupts a phrase', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const spoken = [];
  const timers = [];
  const browser = {
    window: {
      speechSynthesis: {
        speak: utterance => spoken.push(utterance),
        cancel() {},
        getVoices: () => [],
        addEventListener() {}
      },
      liveEventMonitor: { receive(event) { return event; } },
      I18N: { en: false },
      addEventListener() {}
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: () => 0,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  runInNewContext(script, browser);
  browser.window.vozPrioridad.announceTurbo('Olimpia');
  assert.equal(spoken.length, 1);
  assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
  assert.deepEqual(
    JSON.parse(JSON.stringify(browser.window.getVoiceMonitorState().queue.map(item => [item.id, item.priority, item.role]))),
    [['turbo', -1, 'commentator']]
  );
  spoken[0].onend();
  const next = timers.find(timer => timer.delay === 150);
  assert.ok(next);
  next.callback();
  assert.match(spoken[1].text, /Turbo para el equipo Olimpia/);
});

test('TikTok events flow through SSE and the voice queue in business-priority order', async () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="voz-prioridad-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const spoken = [];
  const intervals = [];
  const commentatorVoice = { name: 'Commentator ES', lang: 'es-ES' };
  const notificationVoice = { name: 'Notifications ES', lang: 'es-ES' };
  let now = Date.now();
  const browser = {
    window: {
      speechSynthesis: {
        speak: utterance => spoken.push(utterance),
        cancel() {},
        getVoices: () => [commentatorVoice, notificationVoice],
        addEventListener() {}
      },
      liveEventMonitor: { receive(event) { return event; } },
      I18N: { en: false },
      resolveGiftTeamFor: () => 1,
      addEventListener() {}
    },
    T: [{ id: 'ol', n: 'Olimpia' }, { id: 'cp', n: 'Cerro' }],
    S: [{ p: 0 }, { p: 0 }],
    P: { vo: 1 },
    over: false,
    findTeam: text => String(text).includes('Cerro') ? 1 : -1,
    fetch: () => Promise.resolve({ ok: false }),
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; },
    setTimeout,
    clearTimeout,
    Date: class extends Date { static now() { return now; } },
    addEventListener() {},
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  };
  runInNewContext(script, browser);
  browser.window.vozPrioridad.clear();
  spoken.length = 0;

  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const controller = new AbortController();
  let reader;

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const receiveEvent = async () => {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = frame.match(/^event:\s*(.+)$/m)?.[1];
          const data = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (data) return { event, payload: JSON.parse(data) };
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'SSE stream stays open');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    assert.equal((await receiveEvent()).event, 'status');
    const id = `voice-priority-${Date.now()}`;
    const emit = async (type, raw) => {
      handleTikTokEvent(type, { msgId: `${id}-${type}`, ...raw });
      const event = await receiveEvent();
      assert.equal(event.event, 'update');
      assert.equal(event.payload.entry.type, type);
      browser.window.liveEventMonitor.receive(event.payload);
    };

    const gift = normalizeTikTokEvent('gift', {
      giftName: 'Rose',
      activityCount: 1,
      diamondCount: 1,
      user: { uniqueId: `${id}-gift`, nickname: 'Gift Fan' }
    });
    browser.window.liveEventMonitor.receive({ entry: gift });
    assert.equal(spoken[0]?.text, 'Gracias Gift Fan por enviar 1 Rose. Tu equipo Cerro entra en modo turbo y tu foto queda en el cuadro de honor.');
    assert.equal(spoken[0]?.voice, notificationVoice);

    await emit('chat', {
      comment: 'Cerro vamos todos',
      user: { uniqueId: `${id}-chat`, nickname: 'Chat Fan' }
    });
    await emit('member', {
      user: { uniqueId: `${id}-member`, nickname: 'Member Fan' }
    });
    await emit('follow', {
      user: { uniqueId: `${id}-follow`, nickname: 'Follow Fan' }
    });

    assert.deepEqual(
      JSON.parse(JSON.stringify(browser.window.getVoiceMonitorState().queue.map(item => [item.id, item.priority]))),
      [['move', 1], ['chat', 2]]
    );
    const matchTicks = intervals.filter(interval => interval.ms === 1000);
    const matchTick = matchTicks[matchTicks.length - 1].callback;
    matchTick();
    assert.equal(browser.window.getVoiceMonitorState().queue.some(item => item.id === 'match'), false);

    for (const [index, expected] of [
      [1, 'Chat Fan se une a Cerro'],
      [2, 'Chat Fan dice: Cerro vamos todos']
    ]) {
      spoken[index - 1].onend();
      await new Promise(resolve => setTimeout(resolve, 275));
      assert.equal(spoken[index]?.text, expected);
    }
    spoken[2].onend();
    await new Promise(resolve => setTimeout(resolve, 275));
    now += 4000;
    browser.S[0].p = 20;
    matchTick();
    assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
    assert.equal(spoken[3]?.voice, commentatorVoice);

    browser.window.liveEventMonitor.receive({ entry: {
      type: 'chat', displayName: 'Interrupt Fan', username: 'interrupt-fan', content: 'Hola'
    } });
    assert.equal(browser.window.getVoiceMonitorState().currentRole, 'commentator');
    assert.equal(browser.window.getVoiceMonitorState().queue.some(item => item.id === 'chat' && item.role === 'notifications'), true);
    assert.equal(spoken[4], undefined);
    spoken[3].onend();
    await new Promise(resolve => setTimeout(resolve, 275));
    assert.equal(spoken[4]?.voice, notificationVoice);
    spoken[4].onend();

    assert.deepEqual(
      JSON.parse(JSON.stringify(browser.window.getVoiceMonitorState().levels
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map(level => [level.id, level.priority]))),
      [['turbo', -1], ['gift', 0], ['move', 1], ['chat', 2], ['action', 3], ['featured', 3], ['welcome', 3], ['match', 4]]
    );
    const enabled = Object.fromEntries(browser.window.getVoiceMonitorState().levels.map(level => [level.id, level.enabled]));
    assert.equal(enabled.welcome, false);
    assert.equal(enabled.action, false);
  } finally {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
});

test('right sidebar places statistics, tools, and chronometer in separate vertical sections', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const eventScript = html.match(/<script id="evs-derecha-js">([\s\S]*?)<\/script>/)?.[1];
  const toolsScript = html.match(/<script id="herramientas-derecha-js">([\s\S]*?)<\/script>/)?.[1];
  const loweredStyle = html.match(/<style id="right-sidebar-lowered">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(eventScript);
  assert.ok(toolsScript);
  assert.match(loweredStyle, /\.side>#honor,.side>#copas,.side>#evs,.side>\.foot,.side>#cronoRegalos\{transform:none!important;margin-top:8px!important\}/);
  assert.doesNotMatch(loweredStyle, /donTortuAvatar|translateY/);

  const node = id => ({
    id,
    children: [],
    parentElement: null,
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
      }
      this.children.push(child);
      child.parentElement = this;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
      }
    }
  });
  const topbar = node('topbar'), side = node('side'), evs = node('evs');
  const foot = node('foot'), clock = node('cronoRegalos');
  topbar.appendChild(evs);
  topbar.appendChild(foot);
  foot.appendChild(clock);
  const document = {
    getElementById: id => ({ evs, topbar, cronoRegalos: clock })[id] || null,
    querySelector: selector => selector === '.board .side' ? side : selector === '.foot' ? foot : null
  };
  const sandbox = { document };

  runInNewContext(eventScript, sandbox);
  runInNewContext(toolsScript, sandbox);

  assert.deepEqual(side.children.map(child => child.id), ['evs', 'foot', 'cronoRegalos']);
  assert.equal(clock.parentElement, side);
  assert.equal(foot.children.includes(clock), false);
  assert.equal(topbar.children.length, 0);
});

test('backend voice setting controls Don Tortu avatar and speech', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const setSource = html.match(/function setDonTortuEnabled\(enabled\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(setSource);
  let saved = 0, cancelled = 0, ducked = 0;
  const nameplate = { hidden: false, style: { display: '' }, classList: { contains: name => name === 'plate' } };
  const avatar = {
    hidden: false,
    style: { display: '' },
    nextElementSibling: nameplate,
    classList: { add() {}, remove() {} }
  };
  const context = {
    window: {},
    P: { vo: 1 },
    dt0: avatar,
    voiceQueue: [1],
    giftQueue: [1],
    chatQueue: [1],
    narratorQueue: [1],
    activeVoiceRequest: {},
    giftSpeaking: true,
    giftSpeechGeneration: 0,
    talkT: 1,
    SS: { cancel() { cancelled++; } },
    A: { duck(value) { ducked = value; } },
    save() { saved++; },
    clearTimeout() {},
    console
  };
  runInNewContext(`${setSource}; globalThis.toggleDonTortu=setDonTortuEnabled;`, context);
  context.toggleDonTortu(false);
  assert.equal(context.P.vo, 0);
  assert.equal(avatar.hidden, true);
  assert.equal(avatar.style.display, 'none');
  assert.equal(nameplate.hidden, true);
  assert.equal(nameplate.style.display, 'none');
  assert.equal(context.voiceQueue.length + context.giftQueue.length + context.chatQueue.length + context.narratorQueue.length, 0);
  assert.equal(context.activeVoiceRequest, null);
  assert.equal(context.giftSpeaking, false);
  assert.equal(context.giftSpeechGeneration, 1);
  assert.equal(cancelled, 1);
  assert.equal(ducked, 0);
  context.toggleDonTortu(true);
  assert.equal(context.P.vo, 1);
  assert.equal(avatar.hidden, false);
  assert.equal(avatar.style.display, '');
  assert.equal(nameplate.hidden, false);
  assert.equal(nameplate.style.display, '');
  assert.equal(saved, 2);
  assert.match(html, /id="donTortuAvatar"[^>]+aria-label="Don Tortu"/);
  assert.match(html, /document\.querySelector\('#donTortuAvatar'\)/);
  assert.match(html, /P\.vo=window\.donTortuEnabled\?1:0/);
});

test('deployment check announces a detected update after reload and reloads stale overlays once', async () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const loadCheck = (pageSignature, serverSignature, href = 'https://overlay.example/') => {
    let replacedUrl = '';
    const notices = [];
    const window = { caches: { keys: async () => [], delete: async () => true } };
    const context = {
      window,
      caches: window.caches,
      document: {
        body: { appendChild: notice => notices.push(notice.textContent) },
        createElement: () => ({ style: {}, remove() {} }),
        querySelector: () => ({ content: pageSignature }),
        addEventListener() {}
      },
      fetch: async () => ({ ok: true, json: async () => ({ signature: serverSignature }) }),
      location: { href, replace: url => { replacedUrl = url; } },
      history: { replaceState() {} },
      URL,
      Promise,
      setTimeout,
      console
    };
    runInNewContext(script, context);
    return { ready: window.clussDeploymentReady, replacedUrl: () => replacedUrl, notices };
  };
  const current = loadCheck('sha256-aaaaaaaaaaaaaaaa', 'sha256-aaaaaaaaaaaaaaaa');
  assert.equal(await current.ready, true);
  assert.equal(current.replacedUrl(), '');
  const stale = loadCheck('sha256-aaaaaaaaaaaaaaaa', 'sha256-bbbbbbbbbbbbbbbb');
  assert.equal(await stale.ready, false);
  assert.match(stale.replacedUrl(), /_cluss_deploy=sha256-bbbbbbbbbbbbbbbb/);
  const refreshed = loadCheck('sha256-bbbbbbbbbbbbbbbb', 'sha256-bbbbbbbbbbbbbbbb', 'https://overlay.example/?_cluss_deploy=sha256-bbbbbbbbbbbbbbbb');
  assert.equal(await refreshed.ready, true);
  assert.deepEqual(refreshed.notices, ['Actualización detectada']);
});

test('username normalization strips leading @ and whitespace', () => {
  assert.equal(normalizeUsername('  @@ tortu  '), 'tortu');
  assert.equal(normalizeUsername('  '), '');
});

test('a username selected in the backend takes precedence over the environment default', () => {
  const previous = process.env.TIKTOK_USERNAME;
  process.env.TIKTOK_USERNAME = 'default_account';
  try {
    assert.equal(configuredUsername('  @selected_account  '), 'selected_account');
    assert.equal(configuredUsername(''), 'default_account');
  } finally {
    if (previous === undefined) delete process.env.TIKTOK_USERNAME;
    else process.env.TIKTOK_USERNAME = previous;
  }
});

test('TikTok connection defaults to tortulive when no username is configured', () => {
  const previous = process.env.TIKTOK_USERNAME;
  delete process.env.TIKTOK_USERNAME;
  try {
    assert.equal(configuredUsername(''), 'tortulive');
  } finally {
    if (previous !== undefined) process.env.TIKTOK_USERNAME = previous;
  }
});

test('saved TikTok usernames cycle to the next distinct account', () => {
  const usernames = ['radiofenica', '@reciclemaiis', 'tortulive', 'radiofenica'];
  assert.equal(nextSavedUsername('radiofenica', usernames), 'reciclemaiis');
  assert.equal(nextSavedUsername('reciclemaiis', usernames), 'tortulive');
  assert.equal(nextSavedUsername('tortulive', usernames), 'radiofenica');
  assert.equal(nextSavedUsername('unknown', []), '');
});

test('backend login protects the panel and admin APIs until a session cookie is set', async () => {
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  process.env.BACKEND_ADMIN_TOKEN = 'test-admin-token';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const lockedPage = await fetch(`${baseUrl}/backend`);
    assert.match(await lockedPage.text(), /Acceso al backend/);
    const lockedApi = await fetch(`${baseUrl}/api/admin/presence`);
    assert.equal(lockedApi.status, 401);
    const lockedVoiceConfig = await fetch(`${baseUrl}/api/admin/voice-config`);
    assert.equal(lockedVoiceConfig.status, 401);
    const lockedLogs = await fetch(`${baseUrl}/api/admin/logs`);
    assert.equal(lockedLogs.status, 401);
    const lockedDiagnostics = await fetch(`${baseUrl}/api/admin/diagnostic-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(lockedDiagnostics.status, 401);
    const lockedUsernames = await fetch(`${baseUrl}/api/admin/usernames`);
    assert.equal(lockedUsernames.status, 401);
    const lockedConnect = await fetch(`${baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'other_account' })
    });
    assert.equal(lockedConnect.status, 401);
    const lockedUserSwitch = await fetch(`${baseUrl}/api/connect/next`, { method: 'POST' });
    assert.equal(lockedUserSwitch.status, 403);

    const rejectedLogin = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' })
    });
    assert.equal(rejectedLogin.status, 401);
    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'test-admin-token' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    assert.match(cookie, /^tortu_admin_session=/);

    const unlockedPage = await fetch(`${baseUrl}/backend`, { headers: { cookie } });
    assert.match(await unlockedPage.text(), /Controla la partida/);
    const unlockedApi = await fetch(`${baseUrl}/api/admin/presence`, { headers: { cookie } });
    assert.equal(unlockedApi.status, 200);
    const unlockedLogs = await fetch(`${baseUrl}/api/admin/logs?limit=20`, { headers: { cookie } });
    assert.equal(unlockedLogs.status, 200);
    const initialLogs = await unlockedLogs.json();
    assert.deepEqual(initialLogs.logs, []);
    assert.equal(initialLogs.diagnostic.active, false);
    const enableDiagnostics = await fetch(`${baseUrl}/api/admin/diagnostic-mode`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(enableDiagnostics.status, 200);
    assert.equal((await enableDiagnostics.json()).active, true);
    const diagnosticsAfterEnable = await fetch(`${baseUrl}/api/admin/logs`, { headers: { cookie } });
    assert.equal((await diagnosticsAfterEnable.json()).diagnostic.active, true);
    const disableDiagnostics = await fetch(`${baseUrl}/api/admin/diagnostic-mode`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(disableDiagnostics.status, 200);
    assert.equal((await disableDiagnostics.json()).active, false);
    const unlockedUsernames = await fetch(`${baseUrl}/api/admin/usernames`, { headers: { cookie } });
    assert.equal(unlockedUsernames.status, 200);
    const usernameList = await unlockedUsernames.json();
    assert.equal(usernameList.selected, 'tortulive');
    assert.ok(usernameList.usernames.includes('tortulive'));

    const logout = await fetch(`${baseUrl}/api/admin/session`, { method: 'DELETE', headers: { cookie } });
    assert.equal(logout.status, 200);
    const lockedAgain = await fetch(`${baseUrl}/backend`, { headers: { cookie } });
    assert.match(await lockedAgain.text(), /Acceso al backend/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
  }
});

test('local backend defaults to key 123 without weakening production', async () => {
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.BACKEND_ADMIN_TOKEN;

  async function loginStatus(nodeEnv, suffix) {
    if (nodeEnv) process.env.NODE_ENV = nodeEnv;
    else delete process.env.NODE_ENV;
    const { handle: isolatedHandle } = await import(new URL(`./server.js?local-key-${suffix}`, import.meta.url));
    const server = createServer((req, res) => void isolatedHandle(req, res));
    server.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '123' })
      });
      return response.status;
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  try {
    assert.equal(await loginStatus('development', 'local'), 200);
    assert.equal(await loginStatus('production', 'production'), 401);
  } finally {
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('backend VS settings rotate the four requested fixtures and validate saved selections', async () => {
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  process.env.BACKEND_ADMIN_TOKEN = 'vs-config-test-token';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let previousState;
  let hadPreviousState = false;

  try {
    const savedState = await fetch(`${baseUrl}/api/state/cluss.vs`);
    if (savedState.ok) {
      hadPreviousState = true;
      previousState = await savedState.json();
    }
    await fetch(`${baseUrl}/api/state/cluss.vs`, { method: 'DELETE' });

    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'vs-config-test-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const headers = { cookie, 'content-type': 'application/json' };

    const defaults = await fetch(`${baseUrl}/api/admin/vs-config`, { headers });
    assert.equal(defaults.status, 200);
    const defaultConfig = await defaults.json();
    const defaultList = defaultConfig.list;
    assert.equal(defaultList.length, 4);
    assert.deepEqual(defaultList.filter(item => item.on).map(item => item.k), ['cp|ol', 'ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);
    assert.deepEqual(defaultList.filter(item => item.popular).map(item => item.k), ['cp|ol', 'ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);
    assert.deepEqual(defaultConfig.raceList.map(item => [item.k, item.played]), [
      ['cp|ol', false], ['ucl-bc|ucl-rm', false], ['ca-ar|ca-py', false], ['ca-br|ca-py', false]
    ]);
    assert.ok(defaultConfig.teams.some(team => team.id === 'ct-ar' && team.flag === '🇦🇷'));
    assert.ok(defaultConfig.teams.some(team => team.id === 'ca-py' && team.flag === '🇵🇾'));
    assert.ok(defaultConfig.teams.some(team => team.id === 'ca-br' && team.flag === '🇧🇷'));
    assert.ok(defaultConfig.teams.some(team => team.id === 'cl-cel' && team.flag === '🟢⚪'));

    await fetch(`${baseUrl}/api/state/cluss.vs`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 3,
        cur: 'ucl-bc|ucl-rm',
        list: [{ k: 'cp|ol', on: false }, { k: 'ucl-bc|ucl-rm', on: true }],
        st: { 'ucl-bc|ucl-rm': { r: 2 } }
      })
    });
    const migrated = await fetch(`${baseUrl}/api/admin/vs-config`, { headers });
    const migratedList = (await migrated.json()).list;
    assert.deepEqual(migratedList.filter(item => item.on).map(item => item.k), ['ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);
    assert.deepEqual(migratedList.filter(item => item.popular).map(item => item.k), ['cp|ol', 'ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);

    const saved = await fetch(`${baseUrl}/api/admin/vs-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabledKeys: ['ucl-bc|ucl-rm'], popularKeys: [] })
    });
    assert.equal(saved.status, 200);
    const updated = await fetch(`${baseUrl}/api/admin/vs-config`, { headers });
    const updatedList = (await updated.json()).list;
    assert.deepEqual(updatedList.filter(item => item.on).map(item => item.k), ['ucl-bc|ucl-rm']);
    assert.deepEqual(updatedList.filter(item => item.popular), []);
    const reconfigured = await fetch(`${baseUrl}/api/admin/vs-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        enabledKeys: ['cp|ol', 'ucl-bc|ucl-rm'],
        popularKeys: ['cp|ol', 'ucl-bc|ucl-rm']
      })
    });
    assert.equal(reconfigured.status, 200);
    const refreshed = await fetch(`${baseUrl}/api/admin/vs-config`, { headers });
    assert.deepEqual((await refreshed.json()).raceList.map(item => [item.k, item.played]), [
      ['cp|ol', false], ['ucl-bc|ucl-rm', false]
    ]);

    const invalid = await fetch(`${baseUrl}/api/admin/vs-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabledKeys: ['lib-boc|lib-riv'], popularKeys: ['ucl-bc|ucl-rm'] })
    });
    assert.equal(invalid.status, 400);
  } finally {
    if (hadPreviousState) {
      await fetch(`${baseUrl}/api/state/cluss.vs`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previousState)
      });
    } else {
      await fetch(`${baseUrl}/api/state/cluss.vs`, { method: 'DELETE' });
    }
    await new Promise(resolve => server.close(resolve));
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
  }
});

test('gift catalog enables all gifts, migrates saved settings, and validates the rotation interval', async () => {
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  process.env.BACKEND_ADMIN_TOKEN = 'gift-config-test-token';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let previousState;
  let hadPreviousState = false;

  try {
    const savedState = await fetch(`${baseUrl}/api/state/cluss.gifts`);
    if (savedState.ok) {
      hadPreviousState = true;
      previousState = await savedState.json();
    }
    await fetch(`${baseUrl}/api/state/cluss.gifts`, { method: 'DELETE' });

    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'gift-config-test-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const headers = { cookie, 'content-type': 'application/json' };

    const defaults = await fetch(`${baseUrl}/api/admin/gifts-config`, { headers });
    assert.equal(defaults.status, 200);
    const defaultConfig = await defaults.json();
    assert.equal(defaultConfig.rotationSeconds, 10);
    assert.equal(defaultConfig.catalog.length, 28);
    assert.equal(defaultConfig.catalog.find(item => item.key === 'rose').icon, '🌹');
    assert.equal(defaultConfig.catalog.find(item => item.key === 'diamond').icon, '💎');
    assert.deepEqual(defaultConfig.catalog.map(item => [item.key, item.value]), [
      ['rose', 1], ['tiktok', 1], ['ice-cream-cone', 1], ['finger-heart', 5],
      ['panda', 5], ['mic', 5], ['doughnut', 30], ['toilet-paper', 50],
      ['swan', 99], ['heart', 100], ['confetti', 100], ['sunglasses', 199],
      ['crown', 199], ['boxing-gloves', 299], ['corgi', 299], ['money-rain', 500],
      ['diamond', 1000], ['fireworks', 1088], ['train', 2988], ['motorcycle', 2988],
      ['private-jet', 6000], ['sports-car', 7000], ['yacht', 9888], ['eagle', 10999],
      ['rocket', 20000], ['fantasy-castle', 20000], ['lion', 29999], ['tiktok-universe', 44999],
    ]);
    assert.deepEqual(defaultConfig.catalog.filter(item => item.enabled).map(item => item.key), defaultConfig.catalog.map(item => item.key));

    const publicResponse = await fetch(`${baseUrl}/api/gifts/catalog`);
    assert.equal(publicResponse.status, 200);
    const publicConfig = await publicResponse.json();
    assert.equal(publicConfig.rotationSeconds, 10);
    assert.equal(publicConfig.catalog.find(item => item.key === 'rose').name, 'Rosa');
    assert.equal(publicConfig.catalog.find(item => item.key === 'rose').emoji, '🌹');
    assert.equal(publicConfig.catalog.find(item => item.key === 'rose').enabled, true);

    await fetch(`${baseUrl}/api/state/cluss.gifts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        rotationSeconds: 14,
        catalog: [{ key: 'rose', name: 'Rose (Rosita)', value: 1, enabled: true, aliases: ['rose'], imageUrl: 'https://cdn.example.test/rose.png' }]
      })
    });
    const snapshotResponse = await fetch(`${baseUrl}/api/state.js`);
    const snapshotScript = await snapshotResponse.text();
    const snapshot = JSON.parse(snapshotScript.replace(/^window\.CLUSS_STATE = /, '').replace(/;$/, ''));
    assert.equal(snapshot['cluss.gifts'].v, 2);
    assert.deepEqual(snapshot['cluss.gifts'].catalog.filter(item => item.enabled).map(item => item.key), snapshot['cluss.gifts'].catalog.map(item => item.key));

    const migratedResponse = await fetch(`${baseUrl}/api/admin/gifts-config`, { headers });
    const migrated = await migratedResponse.json();
    assert.equal(migrated.catalog.length, 28);
    assert.equal(migrated.rotationSeconds, 14);
    assert.equal(migrated.catalog.find(item => item.key === 'tiktok-universe').value, 44999);
    assert.deepEqual(migrated.catalog.filter(item => item.enabled).map(item => item.key), migrated.catalog.map(item => item.key));
    const migratedPublic = await (await fetch(`${baseUrl}/api/gifts/catalog`)).json();
    assert.equal(migratedPublic.catalog.find(item => item.key === 'rose').imageUrl, 'https://cdn.example.test/rose.png');

    const invalid = await fetch(`${baseUrl}/api/admin/gifts-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabledKeys: ['rose'], rotationSeconds: 0 })
    });
    assert.equal(invalid.status, 400);

    const saved = await fetch(`${baseUrl}/api/admin/gifts-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabledKeys: ['rose'], rotationSeconds: 12 })
    });
    assert.equal(saved.status, 200);
    const updated = await saved.json();
    assert.equal(updated.config.rotationSeconds, 12);
    assert.deepEqual(updated.config.catalog.filter(item => item.enabled).map(item => item.key), ['rose']);
  } finally {
    if (hadPreviousState) {
      await fetch(`${baseUrl}/api/state/cluss.gifts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previousState)
      });
    } else {
      await fetch(`${baseUrl}/api/state/cluss.gifts`, { method: 'DELETE' });
    }
    await new Promise(resolve => server.close(resolve));
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
  }
});

test('honor backend keeps the latest gift sender, avatar, and gift icon', async () => {
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let previousState;
  let hadPreviousState = false;
  let previousTeamDonors;
  let hadPreviousTeamDonors = false;

  try {
    const savedState = await fetch(`${baseUrl}/api/state/cluss.honorLastGift`);
    if (savedState.ok) {
      hadPreviousState = true;
      previousState = await savedState.json();
    }
    const savedTeamDonors = await fetch(`${baseUrl}/api/state/cluss.honorLastGiftTeams`);
    if (savedTeamDonors.ok) {
      hadPreviousTeamDonors = true;
      previousTeamDonors = await savedTeamDonors.json();
    }

    const id = `honor-last-gift-${Date.now()}`;
    handleTikTokEvent('gift', {
      msgId: id,
      user: {
        uniqueId: 'honor-fan',
        nickname: 'Honor Fan',
        profilePictureUrl: 'https://example.test/honor-fan.jpg'
      },
      giftName: 'Rose',
      giftId: 'rose',
      diamondCount: 1
    });

    const latestResponse = await fetch(`${baseUrl}/api/honor/last-gift`);
    assert.equal(latestResponse.status, 200);
    const latest = (await latestResponse.json()).gift;
    assert.equal(latest.username, 'honor-fan');
    assert.equal(latest.displayName, 'Honor Fan');
    assert.equal(latest.avatarUrl, 'https://example.test/honor-fan.jpg');
    assert.equal(latest.giftName, 'Rose');
    assert.equal(latest.giftIcon, '🌹');

    let persisted;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`${baseUrl}/api/state/cluss.honorLastGift`);
      if (response.ok) {
        persisted = await response.json();
        if (persisted.username === 'honor-fan') break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(persisted?.username, 'honor-fan');

    const teams = {
      leftTeamId: 'ol',
      rightTeamId: 'cp',
      teams: {
        ol: { teamId: 'ol', username: 'left-donor', displayName: 'Left Donor' },
        cp: { teamId: 'cp', username: 'right-donor', displayName: 'Right Donor' }
      }
    };
    const savedDonors = await fetch(`${baseUrl}/api/state/cluss.honorLastGiftTeams`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(teams)
    });
    assert.equal(savedDonors.status, 200);
    const loadedDonors = await fetch(`${baseUrl}/api/state/cluss.honorLastGiftTeams`);
    assert.deepEqual(await loadedDonors.json(), teams);

  } finally {
    if (hadPreviousState) {
      await fetch(`${baseUrl}/api/state/cluss.honorLastGift`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previousState)
      });
    } else {
      await fetch(`${baseUrl}/api/state/cluss.honorLastGift`, { method: 'DELETE' });
    }
    if (hadPreviousTeamDonors) {
      await fetch(`${baseUrl}/api/state/cluss.honorLastGiftTeams`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previousTeamDonors)
      });
    } else {
      await fetch(`${baseUrl}/api/state/cluss.honorLastGiftTeams`, { method: 'DELETE' });
    }
    await new Promise(resolve => server.close(resolve));
  }
});

test('voice repeat cooldown is configurable in minutes and reaches the overlay API', async () => {
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  process.env.BACKEND_ADMIN_TOKEN = 'voice-config-test-token';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let previousState;
  let hadPreviousState = false;

  try {
    const savedState = await fetch(`${baseUrl}/api/state/cluss.voice`);
    if (savedState.ok) {
      hadPreviousState = true;
      previousState = await savedState.json();
    }
    await fetch(`${baseUrl}/api/state/cluss.voice`, { method: 'DELETE' });
    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'voice-config-test-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const headers = { cookie, 'content-type': 'application/json' };

    const defaults = await fetch(`${baseUrl}/api/admin/voice-config`, { headers });
    assert.equal(defaults.status, 200);
    const defaultConfig = await defaults.json();
    assert.equal(defaultConfig.repeatCooldownMinutes, 1);
    assert.equal(defaultConfig.donTortuEnabled, true);
    assert.ok(Object.values(defaultConfig.enabledLevels).length > 0);
    for (const level of ['gift', 'move', 'chat', 'match']) assert.equal(defaultConfig.enabledLevels[level], true);
    assert.equal(defaultConfig.enabledLevels.support, undefined);
    for (const level of ['welcome', 'action']) assert.equal(defaultConfig.enabledLevels[level], false);
    const deniedOverlayToggle = await fetch(`${baseUrl}/api/overlay/don-tortu`, {
      method: 'POST',
      headers: { Origin: baseUrl }
    });
    assert.equal(deniedOverlayToggle.status, 403);
    const overlayHeaders = { Origin: baseUrl, 'X-Overlay-Control': 'don-tortu' };
    const overlayDisabled = await fetch(`${baseUrl}/api/overlay/don-tortu`, { method: 'POST', headers: overlayHeaders });
    assert.equal(overlayDisabled.status, 200);
    assert.equal((await overlayDisabled.json()).donTortuEnabled, false);
    const overlayEnabled = await fetch(`${baseUrl}/api/overlay/don-tortu`, { method: 'POST', headers: overlayHeaders });
    assert.equal(overlayEnabled.status, 200);
    assert.equal((await overlayEnabled.json()).donTortuEnabled, true);
    const savedNames = await fetch(`${baseUrl}/api/admin/usernames`, { headers });
    const savedUsernames = (await savedNames.json()).usernames;
    for (const username of ['radiofenica', 'reciclemaiis', 'tortulive']) assert.ok(savedUsernames.includes(username));

    const invalid = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ repeatCooldownMinutes: 0 })
    });
    assert.equal(invalid.status, 400);
    const tooLong = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ repeatCooldownMinutes: 1441 })
    });
    assert.equal(tooLong.status, 400);
    const invalidToggle = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ repeatCooldownMinutes: 5, donTortuEnabled: 'false' })
    });
    assert.equal(invalidToggle.status, 400);
    const invalidVoiceLevels = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabledLevels: { gift: 'false' } })
    });
    assert.equal(invalidVoiceLevels.status, 400);

    const saved = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        repeatCooldownMinutes: 5,
        donTortuEnabled: false,
        enabledLevels: { gift: false, chat: false, welcome: true, action: true }
      })
    });
    assert.equal(saved.status, 200);
    const savedConfig = await saved.json();
    assert.equal(savedConfig.repeatCooldownMinutes, 5);
    assert.equal(savedConfig.donTortuEnabled, false);
    assert.equal(savedConfig.enabledLevels.gift, false);
    assert.equal(savedConfig.enabledLevels.chat, false);
    assert.equal(savedConfig.enabledLevels.move, true);
    assert.equal(savedConfig.enabledLevels.welcome, false);
    assert.equal(savedConfig.enabledLevels.action, false);
    const enabled = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ donTortuEnabled: true })
    });
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).donTortuEnabled, true);
    const savedCooldown = await fetch(`${baseUrl}/api/admin/voice-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ repeatCooldownMinutes: 5 })
    });
    assert.equal((await savedCooldown.json()).donTortuEnabled, true);
    const overlayConfig = await fetch(`${baseUrl}/api/voice-priority`);
    const overlayVoice = await overlayConfig.json();
    assert.equal(overlayVoice.repeatCooldownMinutes, 5);
    assert.equal(overlayVoice.donTortuEnabled, true);
    assert.equal(overlayVoice.enabledLevels.gift, false);
    const toolsResponse = await fetch(`${baseUrl}/api/game-tools/events`);
    const toolsReader = toolsResponse.body.getReader();
    const toolsDecoder = new TextDecoder();
    let toolsFrames = '';
    while (!toolsFrames.includes('event: voice-config')) {
      const { value, done } = await toolsReader.read();
      assert.equal(done, false);
      toolsFrames += toolsDecoder.decode(value, { stream: true });
    }
    assert.match(toolsFrames, /"donTortuEnabled":true/);
    assert.match(toolsFrames, /"gift":false/);
    await toolsReader.cancel();
  } finally {
    if (hadPreviousState) {
      await fetch(`${baseUrl}/api/state/cluss.voice`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previousState)
      });
    } else {
      await fetch(`${baseUrl}/api/state/cluss.voice`, { method: 'DELETE' });
    }
    await new Promise(resolve => server.close(resolve));
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
  }
});

test('overlay retains the active VS until inactivity and resets cups only on the next VS', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="vs-motor-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const fixtures = [
    ['ol', 'cp', 'Superclásico'],
    ['ucl-bc', 'ucl-rm', 'El Clásico'],
    ['ca-py', 'ca-ar', 'Paraguay vs Argentina'],
    ['ca-py', 'ca-br', 'Paraguay vs Brasil'],
  ];
  const listeners = new Map();
  const app = { appendChild() {} };
  const foot = { appendChild() {} };
  const panelBody = {};
  const panel = {
    classList: { contains: () => false, toggle() {}, add() {}, remove() {} },
    setAttribute() {},
    addEventListener() {},
    querySelector: () => panelBody,
  };
  const makeToggle = () => ({
    classList: { active: false, toggle(_name, enabled) { this.active = enabled; } },
    addEventListener(_type, handler) { this.click = handler; },
    setAttribute(name, value) { this[name] = value; },
  });
  const giftToggle = makeToggle();
  const savedStates = [];
  let storedConfig = null;
  const window = {
    liveEventMonitor: { completeRound() { return Promise.resolve(); }, receive() {} },
    __known: new Map([['fan', { t: 0 }]]),
    addEventListener(name, listener) { listeners.set(name, listener); },
    persistTournamentRound() {},
  };
  let nextMatchCalls = 0;
  const context = {
    window,
    document: {
      getElementById: id => id === 'app' ? app : id === 'honorGiftToggle' ? giftToggle : null,
      querySelector: () => foot,
      createElement: () => panel,
    },
    CLASSIC_DEFS: fixtures,
    CLASSIC_FIXTURES: fixtures.map(([a, b]) => [a, b]),
    SRV: {
      get: () => storedConfig,
      set: (key, value) => savedStates.push({ key, value }),
    },
    T: [{ id: 'ol', n: 'Olimpia', c: '#fff' }, { id: 'cp', n: 'Cerro', c: '#f00' }],
    P: { cl: { 'ucl-bc|ucl-rm': { 'ucl-bc': 4 } }, cp: { ol: 7 }, wins: [1, 0] },
    tournamentItem: id => ({ n: id }),
    tournamentMode: 'clasico',
    classicFixtureIndex: 0,
    BR: null,
    brNew() {
      const fixture = fixtures[context.classicFixtureIndex];
      return { duel: fixture.slice(0, 2), r: [] };
    },
    brCur: () => null,
    nextMatch() { nextMatchCalls++; },
    aplicarDuelo(ids) { context.T.forEach((team, index) => { team.id = ids[index]; }); },
    renderTop3() {},
    reset() {},
    lowActivityFinished: false,
  };
  runInNewContext(script, context);

  const vs = window.gamiVS;
  assert.deepEqual(Array.from(vs.data.list.filter(item => item.on), item => item.k), ['cp|ol', 'ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);
  assert.deepEqual(Array.from(vs.data.list.filter(item => item.popular), item => item.k), ['cp|ol', 'ucl-bc|ucl-rm', 'ca-ar|ca-py', 'ca-br|ca-py']);
  assert.deepEqual(Array.from(vs.data.raceList, item => [item.k, item.played]), [
    ['cp|ol', false], ['ucl-bc|ucl-rm', false], ['ca-ar|ca-py', false], ['ca-br|ca-py', false]
  ]);
  assert.equal(vs.data.loopEnabled, false);
  assert.equal(vs.data.showHonorGifts, false);
  assert.equal(giftToggle.classList.active, false);
  const currentKey = vs.data.cur;
  vs.data.loopEnabled = false;
  listeners.get('vs-config-update')({ detail: { enabledKeys: ['ucl-bc|ucl-rm'] } });
  assert.equal(vs.curVS().k, currentKey);
  assert.equal(context.P.cl['ucl-bc|ucl-rm']['ucl-bc'], 4);

  context.lowActivityFinished = true;
  window.liveEventMonitor.receive({ type: 'chat', username: 'fan' });
  window.liveEventMonitor.completeRound('ol');
  assert.equal(vs.data.cur, 'ucl-bc|ucl-rm');
  assert.equal(vs.data.st['cp|ol'].ev, 1);
  assert.equal(vs.data.st['cp|ol'].eventsByTeam.ol, 1);
  assert.equal(context.P.cl['ucl-bc|ucl-rm']['ucl-bc'], 4);
  context.nextMatch();
  assert.equal(nextMatchCalls, 1);
  assert.deepEqual(Array.from(context.P.wins), [0, 0]);
  assert.equal(Object.keys(context.P.cl['ucl-bc|ucl-rm']).length, 0);
  assert.deepEqual(context.P.cp, { ol: 7 });
  assert.equal(JSON.stringify(context.P.br.duel), JSON.stringify(['ucl-bc', 'ucl-rm']));
  assert.ok(savedStates.some(item => item.key === 'cluss.vs'));
  context.P.cl['cp|ol'] = { ol: 1 };
  vs.addCup('cp|ol', 'ol');
  assert.equal(vs.data.st['cp|ol'].cups.ol, 1);
  assert.ok(savedStates.some(item => item.key === 'cluss.vs' && item.value.st['cp|ol'].cups.ol === 1));
  vs.setLoopEnabled(true);
  assert.equal(vs.data.loopEnabled, true);
  assert.deepEqual(Array.from(context.T, team => team.id), ['ol', 'cp']);
  vs.setLoopEnabled(false);
  assert.equal(vs.data.loopEnabled, false);
  assert.deepEqual(Array.from(context.T, team => team.id), ['ucl-bc', 'ucl-rm']);
  giftToggle.click();
  assert.equal(vs.data.showHonorGifts, true);
  assert.ok(savedStates.some(item => item.key === 'cluss.vs' && item.value.showHonorGifts === true));

  listeners.get('vs-config-update')({ detail: {
    enabledKeys: ['cp|ol', 'ucl-bc|ucl-rm', 'lib-boc|lib-riv', 'cl-cel|cl-ran'],
    popularKeys: ['cp|ol', 'ucl-bc|ucl-rm']
  } });
  vs.data.cur = 'cp|ol';
  const next = () => {
    vs.data.cur = vs.advance();
    return vs.data.cur;
  };
  assert.equal(next(), 'ucl-bc|ucl-rm');
  assert.equal(next(), 'cp|ol');
  assert.equal(next(), 'ucl-bc|ucl-rm');
  assert.equal(next(), 'cp|ol');

  vs.data.np = 'lib-boc|lib-riv';
  listeners.get('vs-config-update')({ detail: {
    enabledKeys: ['cp|ol', 'ucl-bc|ucl-rm', 'lib-boc|lib-riv', 'cl-cel|cl-ran'],
    popularKeys: ['cp|ol', 'ucl-bc|ucl-rm']
  } });
  vs.data.cur = 'cp|ol';
  const finishRace = (ids, winner) => {
    context.T.forEach((team, index) => { team.id = ids[index]; });
    window.liveEventMonitor.completeRound(winner);
  };
  finishRace(['ol', 'cp'], 'ol');
  assert.equal(vs.data.raceList[0].played, true);
  finishRace(['ucl-bc', 'ucl-rm'], 'ucl-bc');
  assert.equal(vs.data.cur, 'cp|ol');
  assert.deepEqual(Array.from(vs.data.raceList, item => [item.k, item.played]), [
    ['cp|ol', false], ['ucl-bc|ucl-rm', false]
  ]);

  storedConfig = {
    v: 7,
    cur: 'cp|ol',
    np: 'lib-boc|lib-riv',
    list: [{ k: 'cp|ol', on: true, popular: true }],
    raceList: [{ k: 'cp|ol', played: true }],
    st: {},
    loopEnabled: true,
    showHonorGifts: false,
  };
  savedStates.length = 0;
  runInNewContext(script, context);
  assert.equal(window.gamiVS.data.showHonorGifts, false, 'previously saved default-on gift display migrates to hidden');
  assert.equal(window.gamiVS.data.np, '');
  assert.equal(window.gamiVS.data.loopEnabled, false, 'old saved loop mode migrates to the rotating fixtures');
  assert.deepEqual(Array.from(window.gamiVS.data.raceList, item => [item.k, item.played]), [['cp|ol', true]]);
  assert.ok(savedStates.some(item => item.key === 'cluss.vs' && item.value.v === 9 && item.value.showHonorGifts === false));
});

test('HonorBoard displays real gifts, deduplicates entries, and keeps test gifts local', async () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const marker = "const side=document.querySelector('.side');";
  const markerIndex = html.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  const scriptStart = html.lastIndexOf('<script>', markerIndex);
  const scriptEnd = html.indexOf('</script>', markerIndex);
  const script = html.slice(scriptStart + '<script>'.length, scriptEnd);
  let honorMarkup = '';
  let clickHandler;
  const count = { textContent: '' };
  const eventRate = { textContent: '', setAttribute(name, value) { this[name] = value; } };
  const counter = {
    addEventListener(_type, handler) { clickHandler = handler; },
    setAttribute() {},
    title: ''
  };
  const view = { set innerHTML(value) { honorMarkup = value; } };
  const box = {
    setAttribute() {},
    querySelector: () => view,
  };
  const side = { firstChild: {}, querySelector: () => null, insertBefore() {} };
  const intervals = [];
  let fetchCalls = 0;
  const context = {
    window: { addEventListener() {}, dispatchEvent() {} },
    CustomEvent: function CustomEvent() {},
    document: {
      querySelector: selector => selector === '.side' ? side : selector === '#giftCounter' ? counter : selector === '#giftCount' ? count : selector === '#eventRate' ? eventRate : null,
      createElement: () => box,
    },
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; },
    clearInterval() {},
    fetch: () => {
      fetchCalls++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ catalog: [] }) });
    },
    safe: callback => {
      try { return callback(); } catch { return undefined; }
    },
    SRV: { get: () => ({ catalog: [{ key: 'rose', name: '🌹 Rosa', icon: '🌹', enabled: true, aliases: ['rose'] }, { key: 'diamond', name: '💎 Diamante', icon: '💎', enabled: false, aliases: ['diamond'] }] }) },
    handleLiveEntry() {},
    reset() {},
    console,
    Date,
    Map,
    Set,
    String,
    Number,
    Math,
    JSON,
    Promise,
    URLSearchParams,
  };
  runInNewContext(script, context);

  assert.match(honorMarkup, /🌹/);
  assert.equal(context.window.HonorBoard.onGift({
    type: 'gift',
    eventId: 'gift-1',
    username: 'ana',
    giftName: 'Galaxy',
    activityCount: 3,
    profilePictureUrl: 'https://example.test/ana.jpg',
    giftImageUrl: 'https://example.test/galaxy.png'
  }), true);
  assert.match(honorMarkup, /@ana/);
  assert.match(honorMarkup, /Galaxy/);
  assert.match(honorMarkup, /×3/);
  assert.match(honorMarkup, /carrera ×3/);
  assert.match(honorMarkup, /https:\/\/example\.test\/ana\.jpg/);
  assert.match(honorMarkup, /https:\/\/example\.test\/galaxy\.png/);
  assert.match(honorMarkup, /🎖️ HONOR|🔥 FANÁTICO/);
  assert.equal(context.window.HonorBoard.onGift({
    type: 'gift', eventId: 'gift-1', username: 'ana', giftName: 'Galaxy', activityCount: 3
  }), false);
  context.window.HonorBoard.setGiftDisplay(false);
  assert.match(honorMarkup, /https:\/\/example\.test\/ana\.jpg/);
  assert.doesNotMatch(honorMarkup, /Galaxy|https:\/\/example\.test\/galaxy\.png/);
  context.window.HonorBoard.setGiftDisplay(true);
  assert.match(honorMarkup, /Galaxy/);
  assert.equal(context.window.HonorBoard.onGift({
    type: 'gift', eventId: 'gift-disabled', username: 'ana', giftName: 'Diamond', activityCount: 1
  }), false);
  assert.equal(count.textContent, '1');
  clickHandler();
  assert.equal(count.textContent, '2');
  assert.match(honorMarkup, /@prueba/);
  context.window.HonorBoard.startRace('next-race');
  assert.match(honorMarkup, /🌹/);
  assert.equal(count.textContent, '2');
  context.window.HonorBoard.setCatalog({ catalog: [
    { key: 'rose', name: 'Rosa', enabled: true, emoji: '🌹', imageUrl: 'https://cdn.example.test/rose.png' },
    { key: 'heart', name: 'Corazón', enabled: true, emoji: '💖', imageUrl: 'https://cdn.example.test/heart.png' }
  ], rotationSeconds: 10 });
  context.window.HonorBoard.setEventsPerMinute(1000);
  assert.match(honorMarkup, /cdn\.example\.test\/rose\.png/);
  const rotation = intervals.filter(item => item.ms === 10000).pop();
  assert.ok(rotation, 'enabled gifts rotate by the configured idle interval without requiring extreme event rates');
  rotation.callback();
  assert.match(honorMarkup, /cdn\.example\.test\/heart\.png/);
  context.window.HonorBoard.setEventsPerMinute(1001);
  assert.match(honorMarkup, /cdn\.example\.test\/heart\.png/);
  assert.equal(eventRate.textContent, '1001');
  context.handleLiveEntry({ type: 'chat', username: 'fan' });
  assert.equal(eventRate.textContent, '1002');
  context.handleLiveEntry({ type: 'member' });
  assert.equal(eventRate.textContent, '1003', 'real member joins count as one live event even without a username');
  context.window.HonorBoard.onGift({ type: 'gift', username: 'ana', giftName: 'Rose', eventId: 'rate-gift', profilePictureUrl: 'https://example.test/ana.jpg' });
  context.window.HonorBoard.setEventsPerMinute(0);
  assert.match(honorMarkup, /@ana/);
  assert.match(honorMarkup, /https:\/\/example\.test\/ana\.jpg/);
  context.window.HonorBoard.startRace('idle-after-gift');
  assert.match(honorMarkup, /cdn\.example\.test\/rose\.png/);
  context.window.HonorBoard.setGiftDisplay(false);
  assert.match(honorMarkup, /hn-flower/);
  assert.doesNotMatch(honorMarkup, /hn-aura/);
  assert.match(html, /#honor \.hn-flower\{[^}]*width:24px;height:24px;font:20px\/24px[^}]*translateY\(3px\)/);
  await Promise.resolve();
  assert.equal(fetchCalls, 1, 'only catalog bootstrap fetches from the server; emulated gifts stay local');
  assert.match(html, /id="giftCounter"/);
  assert.doesNotMatch(html, /<button id="giftCounter"[^>]*>\s*<b/);
  assert.match(html, /window\.HonorBoard/);
});

test('gift normalization preserves unique event ids and HTTPS gift images', () => {
  const gift = normalizeTikTokEvent('gift', {
    eventId: 'gift-event',
    user: { uniqueId: 'fan1', avatarUrl: 'https://example.test/avatar.png' },
    gift_name: 'Rose',
    giftId: 123,
    giftImageUrl: 'https://example.test/rose.png',
    diamondCount: 1
  });
  assert.equal(gift.eventId, 'gift-event');
  assert.equal(gift.giftImageUrl, 'https://example.test/rose.png');
  assert.equal(normalizeTikTokEvent('gift', {
    eventId: 'gift-event',
    user: { uniqueId: 'fan1' },
    giftName: 'Rose',
    giftImageUrl: 'http://example.test/insecure.png'
  }).giftImageUrl || '', '');
});

test('team event totals reset on each race and cup cards omit audience', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const resetCode = html.match(/function resetTeamEventTotals\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(resetCode);
  const renderedTeams = [];
  const eventTotals = new Map([['ol', 6], ['cp', 3]]);
  const resetTotals = new Function(
    'teamEventTotals', 'T', 'renderTeamEventTotal',
    `${resetCode}; return resetTeamEventTotals;`
  )(eventTotals, [{ id: 'ol' }, { id: 'cp' }], index => renderedTeams.push(index));
  resetTotals();
  assert.equal(eventTotals.size, 0);
  assert.deepEqual(renderedTeams, [0, 1]);
  assert.match(html, /resetTeamEventTotals\(\);\s*_resetTurboLimit/);
  assert.doesNotMatch(html, /class="cc-fans"|fans-copas-js|gamiFans/);
});

test('cup board renders both countries in one Honor-height box', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const marker = '<!-- ===== COPAS: una sola caja compacta con bandera y total de cada rival. ===== -->';
  const start = html.indexOf('<script>', html.indexOf(marker));
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start);
  const box = { classList: { add() {} }, setAttribute() {}, innerHTML: '' };
  const side = { insertBefore(item) { this.item = item; } };
  runInNewContext(html.slice(start + 8, end), {
    document: {
      querySelector: () => side,
      createElement: () => box,
      getElementById: () => ({ nextSibling: null })
    },
    window: { gamiVS: { data: { st: {} } }, I18N: { en: false } },
    T: [{ id: 'ol' }, { id: 'cp' }],
    SRV: { get: () => ({ cl: { 'cp|ol': { ol: 2, cp: 5 } } }) },
    CLASSIC_FIXTURES: [['ol', 'cp']],
    CLASSIC_NAMES: ['Superclásico'],
    tournamentItem: id => ({ n: id === 'ol' ? 'OLIMPIA' : 'CERRO' }),
    flag: id => `<rect id="${id}"/>`,
    setInterval() {}
  });
  assert.equal(side.item, box);
  assert.equal((box.innerHTML.match(/class="cup-entry"/g) || []).length, 2);
  assert.match(box.innerHTML, /class="cup-flag"><svg[^>]*><rect id="cp"/);
  assert.match(box.innerHTML, /class="cup-count">5<\/b>/);
  assert.match(box.innerHTML, /class="cup-count">2<\/b>/);
  assert.doesNotMatch(box.innerHTML, /class="cc\b|PRIMER PUESTO|SEGUNDO PUESTO/);
  assert.match(html, /#copas\.cp2\{[^}]*height:var\(--honor-panel-height,auto\)!important/);
});

test('backend exposes business-unit buttons, renders TikTok avatar URLs, and shows live motor telemetry', async () => {
  const overlay = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const previousToken = process.env.BACKEND_ADMIN_TOKEN;
  process.env.BACKEND_ADMIN_TOKEN = 'motor-test-token';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'motor-test-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const page = await fetch(`${baseUrl}/backend`, { headers: { cookie } });
    const html = await page.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    assert.match(html, /id="eventList"/);
    assert.match(html, /id="clearEvents"/);
    assert.match(html, /id="donTortuToggle"/);
    assert.match(html, /\$\('#voiceToggle'\)\.onclick=.*?;\s*loadVoice\(\);/);
    assert.doesNotMatch(overlay, /tortuToggle\.id='donTortuOverlayToggle'/);
    assert.match(overlay, /function setDonTortuEnabled\(enabled\)/);
    assert.match(html, /id="applyEventFilters"/);
    assert.match(html, /\.event-row\[hidden\]\{display:none\}/);
    assert.match(html, /id="copyEvents"/);
    assert.match(html, /id="copyLeftDonor"/);
    assert.match(html, /id="copyRightDonor"/);
    assert.match(html, /id="copyTeamDonors"/);
    assert.match(html, /ÚLTIMOS 50/);
    assert.match(html, /<aside class="event-filters" aria-label="Filtrar eventos">/);
    for (const type of ['member', 'chat', 'like', 'follow', 'share', 'gift']) {
      assert.match(html, new RegExp(`data-event-filter="${type}"`));
    }
    assert.match(script, /while\(list\.children\.length>50\)/);
    assert.match(script, /navigator\.clipboard\.writeText\(text\)/);
    assert.match(script, /row\.dataset\.eventType=entry\.type/);
    const renderEventCode = script.match(/function renderLiveEvent\(entry\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(renderEventCode);
    const eventRowsForRender = [];
    const createElement = tagName => ({
      tagName: tagName.toUpperCase(),
      dataset: {},
      children: [],
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this[name] = value; }
    });
    const eventListForRender = {
      children: eventRowsForRender,
      prepend(row) { eventRowsForRender.unshift(row); },
      get lastElementChild() { return eventRowsForRender[eventRowsForRender.length - 1]; }
    };
    const renderEvent = new Function(
      'document', '$', 'eventLabels', 'eventDetail', 'applyEventFilters',
      `${renderEventCode}; return renderLiveEvent;`
    )(
      { createElement },
      selector => selector === '#eventList' ? eventListForRender : null,
      { gift: 'Regalo', chat: 'Comentario' },
      () => 'Detalle',
      () => {}
    );
    const avatarEntry = normalizeTikTokEvent('gift', {
      user: {
        uniqueId: 'ana',
        nickname: 'Ana',
        userDetails: { profilePictureUrls: { urlList: ['https://example.test/ana.jpg'] } }
      }
    });
    renderEvent({ ...avatarEntry, receivedAt: Date.now() });
    const photoUser = eventRowsForRender[0].children[2];
    assert.equal(photoUser.children[0].tagName, 'IMG');
    assert.equal(photoUser.children[0].src, 'https://example.test/ana.jpg');
    assert.equal(photoUser.children[0].loading, 'eager');
    assert.equal(photoUser.children[0].referrerPolicy, 'strict-origin-when-cross-origin');
    assert.equal(photoUser.children[1].textContent, '@ana');
    renderEvent({ type: 'chat', username: 'luz', displayName: 'Luz', profilePictureUrl: 'javascript:alert(1)' });
    const fallbackUser = eventRowsForRender[0].children[2];
    assert.equal(fallbackUser.children[0].className, 'event-avatar event-avatar-fallback');
    assert.equal(fallbackUser.children[0].dataset.initial, 'L');
    const submitCode = script.match(/\$\('#eventFilterForm'\)\.addEventListener\('submit',event=>\{[^}]*\}\);/)?.[0];
    assert.ok(submitCode);
    let submitHandler, filtersApplied = false, submitPrevented = false;
    new Function('applyEventFilters', '$', submitCode)(
      () => { filtersApplied = true; },
      () => ({ addEventListener(_type, handler) { submitHandler = handler; } })
    );
    submitHandler({ preventDefault() { submitPrevented = true; } });
    assert.equal(submitPrevented, true);
    assert.equal(filtersApplied, true);
    const clearCode = script.match(/\$\('#clearEvents'\)\.addEventListener\('click',\(\)=>\{[\s\S]*?\}\);/)?.[0];
    assert.ok(clearCode);
    let clearHandler, eventListCleared = false;
    const clearTargets = {
      '#eventList': { replaceChildren() { eventListCleared = true; } },
      '#eventEmpty': { hidden: true, textContent: '' },
      '#eventMessage': { textContent: '' }
    };
    new Function('$', clearCode)(selector => selector === '#clearEvents'
      ? { addEventListener(_type, handler) { clearHandler = handler; } }
      : clearTargets[selector]);
    clearHandler();
    assert.equal(eventListCleared, true);
    assert.equal(clearTargets['#eventEmpty'].hidden, false);
    assert.match(clearTargets['#eventMessage'].textContent, /limpiada/);
    const filterCode = script.match(/function applyEventFilters\(\)\{[\s\S]*?\n\}/)?.[0];
    assert.ok(filterCode);
    const filterInputs = ['all', 'member', 'chat', 'like', 'follow', 'share', 'gift'].map(type => ({
      dataset: { eventFilter: type },
      checked: true
    }));
    const eventRows = ['chat', 'like'].map(type => ({ dataset: { eventType: type }, hidden: false }));
    const eventList = { children: eventRows };
    const eventEmpty = { hidden: true, textContent: '' };
    const filter = new Function(
      'eventFilterInputs',
      'eventTypeFilters',
      '$',
      `${filterCode}; return applyEventFilters;`
    )(
      filterInputs,
      filterInputs.filter(input => input.dataset.eventFilter !== 'all'),
      selector => selector === '#eventList' ? eventList : eventEmpty
    );
    filter();
    filterInputs.find(input => input.dataset.eventFilter === 'chat').checked = false;
    filter();
    assert.equal(eventRows[0].hidden, true);
    assert.equal(eventRows[1].hidden, false);
    assert.equal(filterInputs[0].checked, false);
    filterInputs.find(input => input.dataset.eventFilter === 'like').checked = false;
    filter();
    assert.equal(eventEmpty.hidden, false);
    assert.match(eventEmpty.textContent, /No hay eventos/);
    assert.match(html, /<button type="button" class="active" data-unit="usuarios">Usuarios<\/button><button type="button" data-unit="voz">Voz en off<\/button><button type="button" data-unit="honor">Honor<\/button><button type="button" data-unit="eventos">Eventos<\/button>/);
    const userPanelIndex = html.indexOf('<section class="panel business-panel" data-units="usuarios">');
    const honorPanelIndex = html.indexOf('<section class="panel business-panel" data-units="honor">');
    const eventsPanelIndex = html.indexOf('<section class="panel business-panel" data-units="eventos">');
    assert.ok(userPanelIndex < honorPanelIndex && honorPanelIndex < eventsPanelIndex);
    const userPanel = html.match(/<section class="panel business-panel" data-units="usuarios">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(userPanel);
    assert.match(userPanel, /id="currentUsername"/);
    assert.match(userPanel, /id="status"/);
    assert.match(userPanel, /<form id="connect"/);
    assert.match(userPanel, /name="username"/);
    assert.match(userPanel, /id="savedUsername"/);
    assert.match(userPanel, /Usuarios guardados/);
    assert.match(script, /fetch\('\/api\/admin\/usernames'/);
    assert.match(script, /renderSavedUsernames\(j\.usernames,j\.username\)/);
    assert.match(script, /if\(selected\)usernameInput\.value=selected/);
    assert.match(script, /savedUsernameSelect\.addEventListener\('change',fillUsernameFromSaved\)/);
    assert.match(script, /savedUsernameSelect\.addEventListener\('input',fillUsernameFromSaved\)/);
    for (const unit of ['eventos', 'usuarios', 'regalos', 'torneos', 'estadisticas', 'motor', 'turbo-regalos', 'voz', 'honor', 'acciones', 'logs']) {
      assert.match(html, new RegExp(`data-unit="${unit}"`));
    }
    assert.doesNotMatch(html, /data-unit="(?:equipos|turbo-equipos)"/);
    assert.match(html, /id="serverLogs"/);
    assert.match(html, /Logs técnicos/);
    assert.match(html, /id="copyTechnicalLogs"/);
    assert.match(html, /id="toggleAllLogs"/);
    assert.match(script, /\/api\/admin\/diagnostic-mode/);
    const usersPanel = html.match(/<section class="panel business-panel" data-units="usuarios">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(usersPanel);
    assert.match(usersPanel, /id="donTortuToggle"[^>]+class="don-tortu-toggle off"/);
    assert.match(usersPanel, /aria-pressed="false" aria-label="Don Tortu desactivado" disabled>Don Tortu: DESACTIVADO/);
    assert.match(script, /admin\('\/api\/admin\/voice-config',\{donTortuEnabled:!donTortuEnabled\}\)/);
    assert.match(script, /classList\.toggle\('on',donTortuEnabled\)/);
    assert.match(script, /classList\.toggle\('off',!donTortuEnabled\)/);
    assert.match(html, /don-tortu-toggle\.off\{background:#a8323c\}/);
    assert.match(html, /don-tortu-toggle\.on\{background:#238447\}/);
    assert.match(readFileSync(new URL('./server.js', import.meta.url), 'utf8'), /TortuWorld v\$\{PACKAGE_VERSION\} escuchando/);
    const voicePanel = html.match(/<section class="panel business-panel" data-units="voz">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(voicePanel);
    assert.doesNotMatch(voicePanel, /donTortuEnabled/);
    assert.match(overlay, /id="donTortuAvatar"[^>]+hidden/);
    assert.match(overlay, /source\.addEventListener\('diagnostic-mode'/);
    const vsPanel = [...html.matchAll(/<section class="panel business-panel" data-units="torneos">([\s\S]*?)<\/section>/g)]
      .map(match => match[1]).find(panel => panel.includes('Lista de carreras'));
    assert.ok(vsPanel);
    assert.match(vsPanel, /Lista de carreras/);
    assert.match(vsPanel, /id="raceList"/);
    const teamsPanel = [...html.matchAll(/<section class="panel business-panel" data-units="torneos">([\s\S]*?)<\/section>/g)]
      .map(match => match[1]).find(panel => panel.includes('catálogo de equipos'));
    assert.ok(teamsPanel);
    assert.match(teamsPanel, /Banderas de los equipos/);
    const teamTurboPanel = [...html.matchAll(/<section class="panel business-panel" data-units="torneos">([\s\S]*?)<\/section>/g)]
      .map(match => match[1]).find(panel => panel.includes('id="teamTelemetry"'));
    assert.ok(teamTurboPanel);
    assert.match(teamTurboPanel, /Avance del turbo por taps/);
    assert.match(script, /dataset\.vsPopularKey=duel\.k/);
    assert.match(script, /unit==='torneos'\)\{loadVsConfig\(\);loadTeamCatalog\(\)\}/);
    assert.doesNotMatch(script, /unit==='equipos'/);
    const navigationStart = script.indexOf('const unitButtons=');
    const navigationEnd = script.indexOf("$('#clock').textContent");
    const navigationCode = script.slice(navigationStart, navigationEnd);
    const buttons = ['usuarios', 'eventos'].map(unit => ({
      dataset: { unit },
      classList: { active: false, toggle(name, force) { if (name === 'active') this.active = force; } },
      setAttribute(name, value) { this[name] = value; }
    }));
    const panels = ['eventos', 'usuarios'].map(units => ({
      dataset: { units },
      hidden: false,
      scrolled: false,
      scrollIntoView() { this.scrolled = true; }
    }));
    let navigationClick;
    const navigation = { addEventListener(_type, listener) { navigationClick = listener; } };
    const mockDocument = {
      querySelectorAll(selector) { return selector === '[data-unit]' ? buttons : panels; },
      querySelector(selector) { return selector === '#businessUnits' ? navigation : null; }
    };
    new Function('document', '$', 'loadTechnicalLogs', 'loadVoice', navigationCode)(
      mockDocument,
      selector => mockDocument.querySelector(selector),
      () => {},
      () => {}
    );
    const clickUnit = unit => navigationClick({
      target: { closest: () => buttons.find(button => button.dataset.unit === unit) },
      preventDefault() {}
    });
    clickUnit('usuarios');
    assert.equal(panels[0].hidden, true);
    assert.equal(panels[1].hidden, false);
    assert.equal(buttons[0].classList.active, true);
    assert.equal(panels[1].scrolled, true);
    clickUnit('eventos');
    assert.equal(panels[0].hidden, false);
    assert.equal(panels[1].hidden, true);
    assert.equal(buttons[1].classList.active, true);

    const invalid = await fetch(`${baseUrl}/api/motor/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'running', teams: [] })
    });
    assert.equal(invalid.status, 400);

    const telemetry = {
      phase: 'running',
      elapsedMs: 12000,
      idleSeconds: 47,
      winner: '',
      stats: { like: 24, chat: 2 },
      turbo: { tapProgress: 20, tapDurationMs: 7000, giftProgress: 6, giftDurationMs: 15000 },
      teams: [
        { id: 'ol', name: 'Olimpia', progress: 12.5, taps: 4, tapLimit: 45, eventTotal: 7, turboMs: 3000, giftTurboMs: 0 },
        { id: 'cp', name: 'Cerro Porteño', progress: 9, taps: 0, tapLimit: 45, eventTotal: 2, turboMs: 0, giftTurboMs: 1000 }
      ]
    };
    const overlayStream = await fetch(`${baseUrl}/api/events`);
    const overlayReader = overlayStream.body.getReader();
    await overlayReader.read();
    const published = await fetch(`${baseUrl}/api/motor/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(telemetry)
    });
    assert.equal(published.status, 200);
    try {
      const relayed = await overlayReader.read();
      assert.match(new TextDecoder().decode(relayed.value), /event: motor-state[\s\S]*"phase":"running"/);
    } finally {
      await overlayReader.cancel();
    }

    const stream = await fetch(`${baseUrl}/api/admin/motor/events`, { headers: { cookie } });
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    try {
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /event: motor-state[\s\S]*"phase":"running"/);
    } finally {
      await reader.cancel();
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousToken === undefined) delete process.env.BACKEND_ADMIN_TOKEN;
    else process.env.BACKEND_ADMIN_TOKEN = previousToken;
  }
});

test('overlay keeps its race design and opens monitor tabs matching the backend units', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  assert.match(html, /<main id="app">/);
  assert.match(html, /id="bMonitor"/);
  assert.match(html, /aria-label="Monitor por unidad de negocio"/);
  for (const unit of ['eventos', 'usuarios', 'regalos', 'equipos', 'torneos', 'estadisticas', 'motor', 'turbo-equipos', 'turbo-regalos', 'voz', 'honor', 'acciones']) {
    assert.match(html, new RegExp(`data-tab="${unit}"`));
  }
  assert.doesNotMatch(html, /data-tab="narrador"/);
  assert.match(html, /data-tab="usuarios"[^>]*>👤 Usuarios<\/button><button data-tab="voz"[^>]*>♫ Voz/);
  assert.match(html, /<button class="live connecting" id="connection" type="button"[^>]*>conectando<\/button>/);
  assert.match(html, /connectionButton\.addEventListener\('click',async\(\)=>/);
  assert.doesNotMatch(html, /switchUserButton\.id='switchTikTokUser'/);
  assert.doesNotMatch(html, /switchUserButton\.textContent='👤'/);
  assert.match(html, /fetch\('\/api\/connect\/next',\{method:'POST',headers:\{'X-Overlay-Control':'switch-user'\}\}\)/);
  assert.match(server, /path === '\/api\/connect\/next' && req\.method === 'POST'/);
  assert.match(html, /addEventListener\('motor-state'/);
});

test('overlay displays package.json version and uses it in deployment signature', async () => {
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
    const pageResponse = await fetch(`${baseUrl}/`);
    const page = await pageResponse.text();
    assert.match(page, new RegExp(`aria-label="Versión ${packageVersion}">${packageVersion}`));

    const source = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8')
      .replaceAll('__TORTUWORLD_PACKAGE_VERSION__', packageVersion);
    const expectedSignature = `sha256-${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
    const signatureResponse = await fetch(`${baseUrl}/api/deployment-signature`);
    const { signature } = await signatureResponse.json();
    assert.equal(pageResponse.headers.get('x-cluss-deployment-signature'), expectedSignature);
    assert.equal(signature, expectedSignature);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('gift counter emulates a rose locally and HonorBoard receives live catalog settings', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /@keyframes\s+(?:gmHeart|hbp)\b/);
  assert.doesNotMatch(html, /\.hb(?:\.bump|\.full)?\s+\.hi\s*\{[^}]*animation/s);
  assert.match(html, /counter\.addEventListener\('click',\(\)=>HB\.onGift/);
  assert.match(html, /emulated:true/);
  assert.match(html, /gift-config-update/);
  assert.match(html, /window\.HonorBoard\.setTurbo\(settings\)/);
  assert.match(html, /<span class="overlay-version"[^>]*>__TORTUWORLD_PACKAGE_VERSION__<\/span><span class="event-rate" id="eventRate"/);
  assert.match(html, /const version=document\.querySelector\('\.overlay-version'\);if\(version&&clock\)clock\.appendChild\(version\)/);
  assert.match(html, /#cronoRegalos \.overlay-version\{[^}]*position:static[^}]*display:inline-flex/);
  assert.match(html, /\.event-rate\{[^}]*bottom:calc\(var\(--sb,0px\) \+ 4px\)/);
  assert.match(html, /window\.vozPrioridad\.clearLegacy\(\)/);
});

test('honor panel height aligns with the bottom of the team tap counters', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  assert.match(html, /#honor\{flex:0 0 var\(--honor-panel-height,auto\)!important;height:var\(--honor-panel-height,auto\)!important/);
  assert.match(html, /#copas\.cp2\{[^}]*height:var\(--honor-panel-height,auto\)!important/);
  const script = html.match(/<script id="honor-height-to-taps-js">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const styles = new Map();
  const counters = [
    { getBoundingClientRect: () => ({ bottom: 170 }) },
    { getBoundingClientRect: () => ({ bottom: 180 }) },
  ];
  const honor = {
    parentElement: {
      style: {
        getPropertyValue: key => styles.get(key) || '',
        setProperty: (key, value) => styles.set(key, value),
      },
    },
    style: {
      getPropertyValue: key => styles.get(key) || '',
      setProperty: (key, value) => styles.set(key, value),
    },
    getBoundingClientRect: () => ({ top: 100 }),
  };
  runInNewContext(script, {
    document: {
      getElementById: id => id === 'honor' ? honor : { offsetWidth: 416, getBoundingClientRect: () => ({ width: 208 }) },
      querySelectorAll: selector => selector === '.lane .hb' ? counters : [],
    },
    window: { addEventListener() {} },
    requestAnimationFrame: callback => callback(),
  });
  assert.equal(styles.get('--honor-panel-height'), '168px');
});

test('honor panel image is smaller and does not pulse', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  assert.match(html, /const rose=\{key:'rose'/);
  assert.match(html, /#honor \.hn-aura \.hn-gicon\{[^}]*width:40px;height:40px/);
  assert.match(html, /#honor \.hn-avatar\{width:44px;height:44px/);
  assert.doesNotMatch(html, /honorRoseBeat/);
  assert.doesNotMatch(html, /hn-burst|hnPop/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{#honor,#honor \*\{animation:none!important\}\}/);
});

test('HonorBoard keeps the rose on race start and rotates enabled gifts only while idle', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  assert.match(html, /function paintIdle\(gift\)\{[\s\S]*?catalog\.find\(item=>item\.key==='rose'\)/);
  assert.match(html, /entry\.enabled===false\|\|\(gift&&gift\.enabled===false\)/);
  assert.match(html, /giftName\|\|entry\.gift_name\|\|entry\.gift/);
  assert.match(html, /rotationTimer=setInterval\(rotateIdle,rotationSeconds\*1000\)/);
  assert.doesNotMatch(html, /eventsThisMinute>1000/);
});
test('TikTok events are normalized to the six allowed types without forwarding bot', () => {
  const entry = normalizeTikTokEvent('chat', {
    user: { uniqueId: 'fan1', profilePictureUrl: 'https://example.test/avatar.jpg' },
    comment: 'Hola',
    bot: true
  });
  assert.deepEqual(entry, {
    type: 'chat',
    username: 'fan1',
    displayName: '',
    content: 'Hola',
    activityCount: 1,
    giftName: '',
    profilePictureUrl: 'https://example.test/avatar.jpg'
  });
  assert.equal(normalizeTikTokEvent('emote', { comment: 'ignored' }), null);
  const gift = normalizeTikTokEvent('gift', {
    user: { uniqueId: 'fan1', avatarUrl: 'https://example.test/avatar.png' },
    gift_name: 'Rose',
    giftId: 123,
    diamondCount: 1,
    repeatCount: 2
  });
  assert.equal(gift?.giftName, 'Rose');
  assert.equal(gift?.giftId, '123');
  assert.equal(gift?.giftValue, 1);
  assert.equal(gift?.giftDiamonds, 1);
  assert.equal(normalizeTikTokEvent('gift', {
    user: { uniqueId: 'fan1' },
    gift_name: 'Rose',
    diamondCount: 1,
    repeatCount: 2
  })?.giftDiamonds, 1);
  const member = normalizeTikTokEvent('member', { user: { nickname: 'Fan nickname' } });
  assert.equal(member.username, '');
  assert.equal(member.displayName, 'Fan nickname');
  assert.equal(normalizeTikTokEvent('member', {
    user: {
      nickname: 'Fan nickname',
      profilePicture: { urlList: ['https://example.test/member.jpg'] }
    }
  })?.profilePictureUrl, 'https://example.test/member.jpg');
  assert.equal(normalizeTikTokEvent('follow', {
    user: { displayName: 'Fan Display', avatarLarge: 'https://example.test/fan.jpg' }
  })?.profilePictureUrl, 'https://example.test/fan.jpg');
  assert.equal(normalizeTikTokEvent('member', {
    user: { uniqueId: 'fan1', userDetails: { profilePictureUrls: 'https://example.test/late-avatar.jpg' } }
  })?.profilePictureUrl, 'https://example.test/late-avatar.jpg');
  assert.equal(normalizeTikTokEvent('member', {
    user: {
      uniqueId: 'fan1',
      userDetails: { profilePictureUrls: { urlList: ['https://example.test/nested-avatar.jpg'] } }
    }
  })?.profilePictureUrl, 'https://example.test/nested-avatar.jpg');
  assert.equal(normalizeTikTokEvent('share', { user: { displayId: 'fan2' } })?.username, 'fan2');
});

test('a late TikTok avatar travels through SSE and appears on the existing overlay alert after decoding', async () => {
  const server = createServer((req, res) => void handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const controller = new AbortController();
  let reader;

  class TestElement {
    constructor(tagName, root = false) {
      this.tagName = tagName.toUpperCase();
      this.root = root;
      this.parentElement = null;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = { opacity: '0', setProperty() {} };
      this.className = '';
      this.textContent = '';
    }
    get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); }
    get firstElementChild() { return this.children[0] || null; }
    append(...elements) {
      elements.forEach(element => {
        element.parentElement = this;
        this.children.push(element);
      });
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name === 'src' && this.src ? this.src : this.attributes[name] || null; }
    querySelector(selector) {
      if (selector === 'img') return this.querySelectorAll('img')[0] || null;
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      const expected = selector.startsWith('.') ? selector.slice(1).split('.') : null;
      const matches = element => expected
        ? expected.every(className => element.className.split(/\s+/).includes(className))
        : element.tagName.toLowerCase() === selector;
      return this.children.flatMap(child => [
        ...(matches(child) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }
  }
  class TestImage extends TestElement {
    constructor() {
      super('img');
      this.naturalWidth = 0;
      this.src = '';
    }
    decode() { return new Promise(resolve => { this.resolveDecode = resolve; }); }
  }

  const eventLayer = new TestElement('div', true);
  const lane = { getBoundingClientRect: () => ({ left: 0, width: 180 }) };
  const board = { getBoundingClientRect: () => ({ left: 0, width: 380 }) };
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const extract = (pattern, name) => {
    const source = html.match(pattern)?.[0];
    assert.ok(source, `overlay function ${name} exists`);
    return source;
  };
  const processSource = extract(/function processLiveEvent\(item\)\{[\s\S]*?\n\}(?=\nfunction receiveLiveEvent)/, 'processLiveEvent');
  const receiveSource = extract(/function receiveLiveEvent\(payload\)\{[\s\S]*?\n\}(?=\nwindow\.liveEventMonitor)/, 'receiveLiveEvent');
  const showSource = extract(/function showEv\(t,type,n,u\)\{[\s\S]*?\n\}/, 'showEv');
  const imageSource = extract(/function setAvatarImage\(el,url,userKey\)\{[\s\S]*?\n\}/, 'setAvatarImage');
  const cachedImageSource = extract(/function appendCachedAvatar\(el,cached\)\{[\s\S]*?\n\}/, 'appendCachedAvatar');
  const avatarSource = extract(/function avatar\(e\)\{[\s\S]*?\n\}/, 'avatar');
  const context = {
    document: {
      createElement: tagName => new TestElement(tagName),
      querySelector: selector => selector === '#event-alerts' ? eventLayer
        : selector === '#ln0' ? lane
          : selector === '.board' ? board : null
    },
    Image: TestImage,
    setTimeout: () => 1,
    console,
    window: {}
  };
  runInNewContext(`
    const $ = selector => document.querySelector(selector);
    const supportedLiveTypes = new Set(['member','chat','gift','like','follow','share']);
    const liveEventIds = new Set(), pendingLiveEvents = [], receivedEvents = [], eventTimers = new Set();
    const LIVE_EVENT_ID_CACHE_LIMIT = 64;
    let localEventNumber = 0, liveEventProcessor = entry => avatar(entry);
    const EI = {chat:['💬','#888'],like:['❤️','#f57'],follow:['➕','#29d'],share:['↗️','#29d'],member:['👋','#2a5']};
    const T = [{id:'ol',n:'OLIMPIA',c:'#fff'},{id:'cp',n:'CERRO',c:'#38f'}];
    const known = new Map(), userScore = new Map(), greeted = new Set(), seen = new Set(), recent = [[],[]];
    const avatarImageCache = new Map(), avatarUrlCache = new Map();
    const SCORE = {member:1,chat:5,like:1,follow:3,share:3,gift:0};
    let over = false;
    const supportTeamFor = () => 0, grow = () => {}, greet = () => {}, trimNest = () => {};
    const renderNest = () => {}, renderPod = () => {}, toast = () => {}, who = value => value;
    const A = {sfx(){}};
    const recordReceivedEvent = (type,payload) => {
      const item = {type,payload};
      receivedEvents.push(item);
      return item;
    };
    const addLiveEventStage = () => {}, trimReceivedEvents = () => {}, notifyReceivedEvents = () => {};
    const recordLiveDiagnostic = () => {}, isLiveDiagnosticActive = () => false, snapshotLiveState = () => null;
    ${processSource}
    ${receiveSource}
    ${showSource}
    ${imageSource}
    ${cachedImageSource}
    ${avatarSource}
    globalThis.receiveEvent = receiveLiveEvent;
    globalThis.avatarCache = avatarImageCache;
  `, context);

  const decoder = new TextDecoder();
  let buffer = '';
  async function readFrame() {
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.startsWith('event:')) return frame;
        continue;
      }
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'SSE stream stays open');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  async function receiveSseEvent() {
    const frame = await readFrame();
    const event = frame.match(/^event:\s*(.+)$/m)?.[1];
    const data = frame.match(/^data:\s*(.+)$/m)?.[1];
    assert.ok(data, `SSE ${event} frame contains data`);
    return { event, payload: JSON.parse(data) };
  }

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    assert.equal((await receiveSseEvent()).event, 'status');

    const id = `avatar-test-${Date.now()}`;
    handleTikTokEvent('member', { msgId: `${id}-member`, user: { nickname: 'Avatar Fan' } });
    const first = await receiveSseEvent();
    assert.equal(first.event, 'update');
    const firstResult = context.receiveEvent(first.payload);
    assert.equal(firstResult.state, 'processed', firstResult.error);
    const existingAlert = eventLayer.querySelector('.fan-alert');
    const existingAvatar = existingAlert.querySelector('.ua.hero');
    assert.equal(existingAvatar.textContent, 'A');
    assert.equal(existingAvatar.querySelector('img'), null);

    handleTikTokEvent('follow', {
      msgId: `${id}-follow`,
      user: { nickname: 'Avatar Fan', profilePictureUrl: 'https://example.test/avatar.jpg' }
    });
    const second = await receiveSseEvent();
    assert.equal(second.event, 'update');
    assert.equal(second.payload.entry.profilePictureUrl, 'https://example.test/avatar.jpg');
    assert.equal(context.receiveEvent(second.payload).state, 'processed');

    const cache = context.avatarCache.get('display:avatar fan');
    assert.ok(cache, 'the avatar is cached by the user identity');
    assert.equal(cache.image.src, 'https://example.test/avatar.jpg');
    assert.equal(existingAvatar.querySelector('img'), null, 'the initial remains while the shared image is loading');
    cache.image.naturalWidth = 64;
    cache.image.onload();
    cache.image.resolveDecode();
    await new Promise(resolve => setImmediate(resolve));
    const image = existingAvatar.querySelector('img');
    assert.ok(image, 'late avatar URL is attached to the already visible alert');
    assert.equal(image.src, 'https://example.test/avatar.jpg');
    assert.equal(image.style.opacity, '1', 'loaded avatar is revealed after decoding');

  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
});

test('raw TikTok likes pass the frontend statistics and per-team tap counter', () => {
  const browser = { window: {} };
  runInNewContext(readFileSync(new URL('./public/activity-policy.js', import.meta.url), 'utf8'), browser);
  const policy = browser.window.TORTUWORLD_ACTIVITY_POLICY;
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const entryHandler = html.match(/function handleLiveEntry\(entry\)\{[\s\S]*?\n\}(?=\n\/\* Pinta el estado de conexion)/)?.[0];
  const tapHandler = html.match(/function heartAdd\(t,n\)\{[\s\S]*?\n\}/)?.[0];
  const statisticsHandler = html.match(/const _hleSt=handleLiveEntry;\nhandleLiveEntry=function\(e\)\{[\s\S]*?\n\};(?=\n\/\* ===== MEDICIÓN DE ACTIVIDAD)/)?.[0];
  assert.ok(entryHandler);
  assert.ok(tapHandler);
  assert.ok(statisticsHandler);

  const context = {
    window: { TORTUWORLD_ACTIVITY_POLICY: policy },
    document: { querySelector: () => null },
    console,
    Date,
    setTimeout,
    clearTimeout
  };
  runInNewContext(`
    const TAP_POLICY = window.TORTUWORLD_ACTIVITY_POLICY;
    const T = [{id:'team-0'}, {id:'team-1'}];
    let HEART_N = 45;
    const HEART_TURBO_MS = 7000, HEART_TURBO_PROGRESS = 20, HEART_TURBO_PPS = 20 / 7;
    const heart = [0, 0];
    const ST = {member:0, chat:0, gift:0, like:0, follow:0, share:0};
    const teamStatistics = [0, 0], activations = [0, 0], lastChat = new Map(), picks = new Map();
    let sel = 0, over = false, lead = -1, lastInteractionAt = 0, matchInteractionCount = 0;
    const heartElement = {classList:{remove(){},add(){}}, offsetWidth:0};
    const $ = () => heartElement, tapStep = () => {}, renderHeart = () => {}, tapPop = () => {};
    const update = () => 0, turboOn = team => { activations[team]++ }, float = () => {}, hype = () => {}, A = {sfx(){}};
    const noteTeamAdvance = () => {};
    const recentChatTeam = () => -1, trackTournamentMentions = () => false, trackLaneInteraction = () => {};
    const push = () => {}, stUser = () => {}, saveTournamentProgress = () => {}, logStat = () => {}, stFmt = String;
    const DUELO = [];
    window.addTeamEventTotal = (team, count) => { if(Number.isInteger(team)) teamStatistics[team] += count };
    window.resolveSupportTeamFor = username => username === 'fan1' ? 0 : 1;
    ${tapHandler}
    window.recordLiveTap=(team,count)=>heartAdd(team,count);
    ${entryHandler}
    ${statisticsHandler}
    globalThis.processEvent = entry => handleLiveEntry(entry);
    globalThis.snapshot = () => ({heart, teamStatistics, activations, liveStatistics:ST});
  `, context);

  const events = [
    { id: 'user-id-42', user: { uniqueId: 'fan1' }, likeCount: 3 },
    { id: 'user-id-42', user: { uniqueId: 'fan1' }, likeCount: 2 },
    { id: 'user-id-73', user: { uniqueId: 'fan2' }, likeCount: 4 },
    { id: 'user-id-42', user: { uniqueId: 'fan1' }, likeCount: 45 }
  ];
  events.forEach(event => {
    if (!dedupeEvent(event, 'like')) context.processEvent(normalizeTikTokEvent('like', event));
  });
  const result = JSON.parse(JSON.stringify(context.snapshot()));
  assert.deepEqual(result.heart, [5, 4]);
  assert.deepEqual(result.activations, [1, 0]);
  assert.deepEqual(result.teamStatistics, [50, 4]);
  assert.equal(result.liveStatistics.like, 54);
  assert.equal(dedupeEvent({ msgId: 'like-event-1' }, 'like'), false);
  assert.equal(dedupeEvent({ msgId: 'like-event-1' }, 'like'), true);
});

test('gift combos emit only the new repeat-count delta', () => {
  const item = count => ({
    user: { uniqueId: 'fan2' },
    giftId: 7,
    groupId: 'combo-a',
    giftType: 1,
    repeatCount: count
  });
  assert.equal(comboDelta(item(1)), 1);
  assert.equal(comboDelta(item(3)), 2);
  assert.equal(comboDelta(item(3)), 0);
});

test('social event actions classify follows and shares for live counters', () => {
  assert.equal(socialEventType({ action: 'follow' }), 'follow');
  assert.equal(socialEventType({ action: 'share' }), 'share');
  assert.equal(socialEventType({ common: { displayText: { key: 'follow' } } }), 'follow');
  assert.equal(socialEventType({ common: { displayText: { key: 'share' } } }), 'share');
  assert.equal(socialEventType({ shareTarget: 'chat' }), 'share');
  assert.equal(socialEventType({ action: 'like' }), '');
});

test('country recognition accepts names and ISO codes', () => {
  assert.equal(identifyCountry('Vamos Paraguay')?.code, 'PY');
  assert.equal(identifyCountry('🇨🇱 Chile')?.code, 'CL');
  assert.equal(identifyCountry('🇬🇧')?.code, 'GB');
});

test('PWA manifest is named Negocio and requests fullscreen with install icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'Negocio');
  assert.equal(manifest.short_name, 'Negocio');
  assert.equal(manifest.display, 'fullscreen');
  assert.deepEqual(manifest.icons.filter(icon => icon.type === 'image/png').map(icon => icon.sizes), ['192x192', '512x512']);
  for (const size of [192, 512]) {
    const icon = readFileSync(new URL(`./public/icons/tortu2-${size}.png`, import.meta.url));
    assert.equal(icon.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
});

test('service worker caches only the shell and bypasses live API responses', () => {
  const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8');
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /tortu2-shell-/);
  assert.match(worker, /CACHE_PREFIX \+ 'v4'/);
});

test('voice-priority response matches the overlay speech template contract', () => {
  assert.equal(voicePriority.repeatCooldownMinutes, 1);
  const levels = Object.fromEntries(voicePriority.levels.map(level => [level.id, level]));
  assert.match(levels.gift.say, /\{team\}/);
  assert.match(levels.gift.say, /cuadro de honor/);
  assert.deepEqual(Object.keys(levels.move.say).sort(), ['from', 'to']);
  assert.match(levels.chat.say, /\{text\}/);
  assert.deepEqual(Object.keys(levels.action.say).sort(), ['follow', 'like', 'share']);
  assert.deepEqual(Object.keys(levels.match.say).sort(), ['final', 'normal', 'start', 'win']);
  assert.match(levels.match.say.start, /\{teamA\}/);
  assert.match(levels.match.say.start, /\{teamB\}/);
  assert.equal(levels.support, undefined);
  assert.equal(levels.turbo.priority, -1);
  assert.match(levels.match.say.normal, /\{leadM\}/);
  assert.match(levels.match.say.normal, /\{otherM\}/);
  assert.match(levels.welcome.say, /\{user\}/);
  assert.deepEqual(['turbo', 'gift', 'move', 'chat', 'welcome', 'action', 'match'].map(id => levels[id].priority), [-1, 0, 1, 2, 3, 3, 4]);
  assert.equal(levels.gift.ttlMs, 0);
  assert.equal(levels.gift.max, 0);
});

test('race lanes alternate sides and draw translucent guides each meter', () => {
  const html = readFileSync(new URL('./overlay.html', import.meta.url), 'utf8');
  const laneSvg = html.match(/function laneSVG\(i,t\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(laneSvg);
  const markup = runInNewContext(`(${laneSvg})(0,{id:'ol',n:'Olimpia'})`, {
    tournamentItem: () => ({ emoji: '🏳️' }),
    flag: () => ''
  });
  const meters = Array.from(markup.matchAll(/class="distance-tick" data-meter="(\d+)"/g), match => Number(match[1]));
  assert.deepEqual(meters, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const guides = Array.from(markup.matchAll(/class="route-guide(?: route-guide-major)?" data-meter="(\d+)"/g), match => Number(match[1]));
  assert.deepEqual(guides, Array.from({ length: 100 }, (_, index) => index + 1));
  assert.match(markup, /route-guide-major" data-meter="10"[^>]+stroke="#fff"[^>]+opacity="\.3"/);
  assert.match(markup, /route-guide" data-meter="1"[^>]+stroke="#fff"[^>]+opacity="\.3"/);
  assert.match(html, /classList\.toggle\('swapped'\)/);
  assert.match(html, /#lanes\.swapped\{flex-direction:row-reverse\}/);
});
