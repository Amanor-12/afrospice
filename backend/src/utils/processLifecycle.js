const lifecycleState = {
  startedAt: new Date().toISOString(),
  ready: false,
  shuttingDown: false,
  shutdownReason: "",
  shutdownStartedAt: "",
};

function markReady() {
  lifecycleState.ready = true;
}

function beginShutdown(reason = "shutdown") {
  if (lifecycleState.shuttingDown) {
    return false;
  }

  lifecycleState.shuttingDown = true;
  lifecycleState.shutdownReason = String(reason || "shutdown");
  lifecycleState.shutdownStartedAt = new Date().toISOString();
  return true;
}

function getLifecycleState() {
  return {
    ...lifecycleState,
  };
}

module.exports = {
  markReady,
  beginShutdown,
  getLifecycleState,
};
