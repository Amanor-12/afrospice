const authService = require("../services/authService");
const passkeyService = require("../services/passkeyService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");
const { clearAuthCookie, setAuthCookie } = require("../utils/authCookie");

function setSensitiveResponseHeaders(res) {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
}

const login = asyncHandler(async (req, res) => {
  const payload = await authService.login(req.body || {});
  setSensitiveResponseHeaders(res);
  setAuthCookie(res, payload.token);

  return success(
    res,
    {
      user: payload.user,
      sessionMode: "cookie",
    },
    "Login successful."
  );
});

const changePin = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.changePin(req.user, req.body || {});
  return success(res, payload, "PIN changed successfully.");
});

const logout = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.logout(req.user);
  clearAuthCookie(res);
  return success(res, payload, "Logout successful.");
});

const me = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.getAuthenticatedUser(req.user);
  return success(res, payload, "Authenticated user fetched.");
});

const getPasskeys = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  return success(
    res,
    {
      passkeys: await passkeyService.listUserPasskeys(req.user?.id),
    },
    "Passkeys fetched."
  );
});

const beginPasskeyRegistration = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  return success(
    res,
    await passkeyService.beginPasskeyRegistration(req.user, req.body || {}, req.headers.origin || ""),
    "Passkey registration options generated."
  );
});

const finishPasskeyRegistration = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  return success(
    res,
    await passkeyService.finishPasskeyRegistration(req.user, req.body || {}, req.headers.origin || ""),
    "Passkey registered."
  );
});

const beginPasskeyLogin = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  return success(
    res,
    await passkeyService.beginPasskeyAuthentication(req.body || {}, req.headers.origin || ""),
    "Passkey sign-in options generated."
  );
});

const finishPasskeyLogin = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await passkeyService.finishPasskeyAuthentication(req.body || {}, req.headers.origin || "");
  setAuthCookie(res, payload.token);

  return success(
    res,
    {
      user: payload.user,
      sessionMode: "cookie",
    },
    "Passkey sign-in successful."
  );
});

const deletePasskey = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  return success(
    res,
    await passkeyService.removePasskey(req.user, req.params.credentialId),
    "Passkey removed."
  );
});

module.exports = {
  login,
  changePin,
  logout,
  me,
  getPasskeys,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  beginPasskeyLogin,
  finishPasskeyLogin,
  deletePasskey,
};
