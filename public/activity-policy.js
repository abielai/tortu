(function () {
  'use strict';
  var count = function (value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  };
  var weights = {
    member: 1,
    chat: 10,
    like: 1,
    follow: 3,
    share: 5,
    gift: 0
  };
  var statWeights = {
    member: 1,
    chat: 5,
    like: 1,
    follow: 3,
    share: 3,
    gift: 10
  };
  var policy = {
    HEART_START: 50,
    HEART_STEP: 10,
    HEART_MAX: 60,
    HEART_TURBO_MS: 7000,
    GIFT_TURBO_MS: 15000,
    GIFT_TURBO_PROGRESS: 6,
    HEART_TURBO_PROGRESS: 20,
    isInteractionEvent: function (type) {
      return type === 'chat' || type === 'like' || type === 'gift' || type === 'follow' || type === 'share';
    },
    tapEventDelta: function (type, activityCount) {
      if (!(type in weights)) return 0;
      return weights[type] * (type === 'like' ? count(activityCount) : 1);
    },
    statEventDelta: function (type, activityCount) {
      if (!(type in statWeights)) return 0;
      return statWeights[type] * ((type === 'like' || type === 'gift') ? count(activityCount) : 1);
    },
    eventCountDelta: function (type, activityCount) {
      if (!(type in statWeights)) return 0;
      return (type === 'like' || type === 'gift') ? count(activityCount) : 1;
    },
    consumeTapCount: function (current, delta, limit) {
      var cap = Math.max(1, Math.floor(Number(limit) || 1));
      var total = Math.max(0, Math.floor(Number(current) || 0)) + Math.max(0, Math.floor(Number(delta) || 0));
      return { remaining: total % cap, activations: Math.floor(total / cap) };
    },
    giftProgress: function (countValue, progress) {
      return Math.max(0, Number(countValue) || 0) * Math.max(0, Number(progress) || 0);
    },
    giftTurboMeters: function (value, units) {
      var diamonds = Number(value);
      var countValue = Number(units);
      var giftCount = Number.isFinite(countValue) && countValue > 0 ? Math.floor(countValue) : 0;
      var diamondValue = Number.isFinite(diamonds) && diamonds > 0 ? diamonds : 0;
      return giftCount * (10 + 5 * diamondValue);
    },
    giftTurboDuration: function (countValue, duration) {
      return Math.max(0, Math.floor(Number(countValue) || 0)) * Math.max(0, Number(duration) || 0);
    },
    resolveSupportSide: function (username, teamCount, assignedSide, configuredSide) {
      if (!Number.isInteger(teamCount) || teamCount < 1) return -1;
      var valid = function (side) {
        return Number.isInteger(side) && side >= 0 && side < teamCount;
      };
      if (valid(assignedSide)) return assignedSide;
      if (valid(configuredSide)) return configuredSide;
      var name = String(username || '').trim().toLowerCase();
      if (!name) return 0;
      var hash = 0;
      for (var i = 0; i < name.length; i++) hash += name.charCodeAt(i);
      return hash % teamCount;
    },
    createIdleVisualAdvance: function () {
      var meters = [0, 0];
      var idleMs = 0;
      var lastAt = null;
      var interactionAt = null;
      return {
        reset: function (now) {
          meters = [0, 0];
          idleMs = 0;
          lastAt = Number(now);
          if (!Number.isFinite(lastAt)) lastAt = Date.now();
          interactionAt = lastAt;
          return meters.slice();
        },
        update: function (now, lastInteractionAt, enabled) {
          var current = Number(now);
          if (!Number.isFinite(current)) return meters.slice();
          var interaction = Number(lastInteractionAt);
          if (Number.isFinite(interaction) && interactionAt !== null && interaction > interactionAt) {
            idleMs = 0;
            interactionAt = interaction;
          }
          var idleStart = Number.isFinite(interaction) ? interaction + 15000 : current;
          var start = lastAt === null
            ? current
            : Math.max(lastAt, idleStart);
          var remaining = enabled && lastAt !== null ? Math.max(0, current - start) : 0;
          while (remaining > 0) {
            var turnPosition = idleMs % 1000;
            var elapsed = Math.min(remaining, 1000 - turnPosition);
            var movingTeam = Math.floor(idleMs / 1000) % 2;
            meters[movingTeam] += elapsed * 2 / 1000;
            idleMs += elapsed;
            remaining -= elapsed;
          }
          lastAt = current;
          return meters.slice();
        }
      };
    }
  };
  window.TORTUWORLD_ACTIVITY_POLICY = Object.freeze(policy);
})();
