function normalizeMetadata(meta = {}) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }

  return Object.entries(meta).reduce((accumulator, [key, value]) => {
    if (value === undefined) {
      return accumulator;
    }

    accumulator[key] = value;
    return accumulator;
  }, {});
}

function write(level, event, meta = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...normalizeMetadata(meta),
  };
  const serializedPayload = JSON.stringify(payload);

  if (level === "error") {
    console.error(serializedPayload);
    return;
  }

  if (level === "warn") {
    console.warn(serializedPayload);
    return;
  }

  console.log(serializedPayload);
}

function info(event, meta = {}) {
  write("info", event, meta);
}

function warn(event, meta = {}) {
  write("warn", event, meta);
}

function error(event, meta = {}) {
  write("error", event, meta);
}

module.exports = {
  info,
  warn,
  error,
};
