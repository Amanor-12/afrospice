function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executeWithRetry({
  operation,
  maxAttempts = 3,
  delayMs = 1000,
  onAttemptError = null,
}) {
  const normalizedAttempts = Math.max(1, Math.min(10, Number(maxAttempts || 3)));
  const normalizedDelay = Math.max(0, Number(delayMs || 0));
  let lastError = null;

  for (let attempt = 1; attempt <= normalizedAttempts; attempt += 1) {
    try {
      return await operation({
        attempt,
        maxAttempts: normalizedAttempts,
      });
    } catch (error) {
      lastError = error;

      if (typeof onAttemptError === "function") {
        await onAttemptError({
          attempt,
          maxAttempts: normalizedAttempts,
          delayMs: normalizedDelay,
          error,
          willRetry: attempt < normalizedAttempts,
        });
      }

      if (attempt < normalizedAttempts && normalizedDelay > 0) {
        await wait(normalizedDelay);
      }
    }
  }

  throw lastError;
}

module.exports = {
  executeWithRetry,
};
