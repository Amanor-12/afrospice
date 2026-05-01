const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const runtime = require("../config/runtime");
const {
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
} = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: runtime.authLoginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many login attempts. Please wait before trying again.",
    code: "AUTH_LOGIN_RATE_LIMITED",
  },
});

const changePinRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: runtime.authChangePinRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many PIN change attempts. Please wait before trying again.",
    code: "AUTH_PIN_CHANGE_RATE_LIMITED",
  },
});

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
});

router.post("/login", loginRateLimiter, login);
router.post("/passkey-login/options", loginRateLimiter, beginPasskeyLogin);
router.post("/passkey-login/verify", loginRateLimiter, finishPasskeyLogin);
router.post("/change-pin", authMiddleware, changePinRateLimiter, changePin);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.get("/passkeys", authMiddleware, getPasskeys);
router.post("/passkeys/options", authMiddleware, beginPasskeyRegistration);
router.post("/passkeys/verify", authMiddleware, finishPasskeyRegistration);
router.delete("/passkeys/:credentialId", authMiddleware, deletePasskey);

module.exports = router;
