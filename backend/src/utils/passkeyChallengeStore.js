const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challengeStore = new Map();

function pruneExpiredChallenges() {
  const now = Date.now();

  for (const [key, value] of challengeStore.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) {
      challengeStore.delete(key);
    }
  }
}

function setChallenge(key, payload = {}) {
  pruneExpiredChallenges();
  challengeStore.set(String(key || "").trim(), {
    ...payload,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

function consumeChallenge(key, kind) {
  pruneExpiredChallenges();

  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return null;
  }

  const value = challengeStore.get(normalizedKey) || null;
  challengeStore.delete(normalizedKey);

  if (!value) {
    return null;
  }

  if (kind && String(value.kind || "").trim() !== String(kind || "").trim()) {
    return null;
  }

  if (!value.expiresAt || value.expiresAt <= Date.now()) {
    return null;
  }

  return value;
}

module.exports = {
  setChallenge,
  consumeChallenge,
};
