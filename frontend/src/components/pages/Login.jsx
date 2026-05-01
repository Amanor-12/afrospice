import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import API from "../../api/api";
import { getDefaultRoute } from "../../config/access";
import { isPlatformAuthenticatorAvailable, serializePasskeyCredential, toPasskeyAuthenticationOptions } from "../../utils/passkeys";
import { writeAuthSession } from "../../utils/sessionStore";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";

function Login({ onLogin, settings }) {
  const [pin, setPin] = useState("");
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [platformPasskeyAvailable, setPlatformPasskeyAvailable] = useState(false);
  const [authModeResolved, setAuthModeResolved] = useState(false);

  const navigate = useNavigate();

  const branchCode = settings?.branchCode || "AFR-MAIN-001";
  const storeName = settings?.storeName || "AfroSpice Main Branch";
  const ownerLabel = settings?.ownerName || "Store Owner";
  const ownerInitials = getIdentityInitials(ownerLabel, "SO");
  const ownerTone = getIdentityTone(ownerLabel, "blue");

  useEffect(() => {
    let cancelled = false;

    isPlatformAuthenticatorAvailable()
      .then((available) => {
        if (cancelled) return;

        const nextAvailable = Boolean(available);
        setPlatformPasskeyAvailable(nextAvailable);
        setAuthModeResolved(true);
      })
      .catch(() => {
        if (cancelled) return;

        setPlatformPasskeyAvailable(false);
        setAuthModeResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const completeLogin = useCallback((user) => {
    writeAuthSession(user || null);

    if (onLogin) {
      onLogin(user || null);
    }

    navigate(getDefaultRoute(user?.role), { replace: true, state: { rememberSession } });
  }, [navigate, onLogin, rememberSession]);

  const submitLogin = async () => {
    if (loading || passkeyLoading) {
      return;
    }

    if (!String(pin || "").trim()) {
      setError("Enter the owner PIN to continue.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await API.post("/auth/login", {
        pin: pin.trim(),
      });

      const user = res?.data?.data?.user;
      completeLogin(user);
    } catch (err) {
      console.error("Login failed:", err);
      setError(
        err?.message || err?.data?.message || "Sign-in failed. Check the owner PIN and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    await submitLogin();
  };

  const handlePasskeyLogin = useCallback(async () => {
    if (loading || passkeyLoading) {
      return;
    }

    try {
      setError("");
      setPasskeyLoading(true);

      const optionsResponse = await API.post("/auth/passkey-login/options", {});
      const publicKey = toPasskeyAuthenticationOptions(optionsResponse?.data?.data?.options || {});
      const credential = await navigator.credentials.get({
        publicKey,
      });

      if (!credential) {
        throw new Error("Passkey sign-in was cancelled.");
      }

      const response = await API.post("/auth/passkey-login/verify", {
        response: serializePasskeyCredential(credential),
      });
      const user = response?.data?.data?.user || null;
      completeLogin(user);
    } catch (err) {
      console.error("Passkey login failed:", err);
      const errorCode = String(err?.data?.code || err?.response?.data?.code || "").trim();

      if (errorCode === "PASSKEY_NOT_ENROLLED") {
        setError(
          "Biometric access is not enrolled for the owner account yet. Sign in with the PIN once, then open Settings > Account > Biometric access and enable it on this device."
        );
      } else if (err?.name === "NotAllowedError") {
        setError("Fingerprint sign-in was closed. Try again, or use the owner PIN.");
      } else {
        setError(
          err?.message || "Fingerprint or Face ID sign-in failed. Try again, or use the owner PIN."
        );
      }
    } finally {
      setPasskeyLoading(false);
    }
  }, [completeLogin, loading, passkeyLoading]);

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-stage">
          <section className="login-hero-panel" aria-label="Workspace overview">
            <div className="login-hero-brand">
              <div className="login-logo-lockup" aria-hidden="true">
                <span className="login-logo-shape login-logo-shape-top"></span>
                <span className="login-logo-shape login-logo-shape-bottom"></span>
              </div>
              <span className="login-stage-brand-name">AfroSpice</span>
            </div>

            <div className="login-hero-copy">
              <p className="login-hero-kicker">Premium retail operations</p>
              <h1>
                Run your store with a <span>smarter, cleaner control</span> surface
              </h1>
              <p>
                Inventory, checkout, reporting, suppliers, customers, and operations all in one refined business workspace.
              </p>
            </div>

            <div className="login-hero-orbit" aria-hidden="true"></div>
          </section>

          <section className="login-auth-shell" aria-label="Workspace sign in">
            <div className="login-auth-card">
              <div className="login-auth-topbar">
                <div className="login-auth-brand">
                  <div className="login-logo-lockup login-logo-lockup--compact" aria-hidden="true">
                    <span className="login-logo-shape login-logo-shape-top"></span>
                    <span className="login-logo-shape login-logo-shape-bottom"></span>
                  </div>
                  <strong>AfroSpice</strong>
                </div>

                <div className="login-auth-chip">{branchCode}</div>
              </div>

              <div className="login-auth-copy">
                <p className="login-auth-kicker">Welcome back</p>
                <h2>Sign in to your workspace</h2>
                <p>Owner-only access for inventory, checkout, reporting, suppliers, customers, and workspace controls.</p>
              </div>

              <div className="login-owner-panel">
                <div className={`login-owner-avatar login-owner-avatar--${ownerTone}`}>{ownerInitials}</div>
                <div className="login-owner-copy">
                  <strong>{ownerLabel}</strong>
                  <small>Owner access only</small>
                </div>
              </div>

              <form className="login-form" onSubmit={handleLogin}>
                {!authModeResolved ? (
                  <div className="login-auth-status" role="status" aria-live="polite">
                    Preparing secure sign-in...
                  </div>
                ) : null}

                {authModeResolved && platformPasskeyAvailable ? (
                  <button
                    type="button"
                    className="login-passkey-panel"
                    onClick={handlePasskeyLogin}
                    disabled={loading || passkeyLoading}
                  >
                    <span className="login-passkey-panel-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 12a3 3 0 1 0-3-3" />
                        <path d="M12 19v-2.5" />
                        <path d="M7 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5" />
                        <path d="M5 12.5C5 8.4 8.1 5 12 5s7 3.4 7 7.5" />
                        <path d="M9 19v-1.5" />
                        <path d="M15 19v-1.5" />
                      </svg>
                    </span>
                    <span className="login-passkey-panel-copy">
                      <strong>{passkeyLoading ? "Opening fingerprint access..." : "Use fingerprint access"}</strong>
                      <small>Windows Hello is enabled for this owner device.</small>
                    </span>
                  </button>
                ) : null}

                <div className="login-field">
                  <label className="login-label" htmlFor="pin">
                    Owner PIN
                  </label>
                  <input
                    id="pin"
                    className="login-input"
                    type="password"
                    placeholder="Enter the owner PIN"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    autoComplete="current-password"
                    inputMode="numeric"
                  />
                </div>

                <label className="login-remember">
                  <input
                    type="checkbox"
                    checked={rememberSession}
                    onChange={(event) => setRememberSession(event.target.checked)}
                  />
                  <span>Keep me signed in</span>
                </label>

                <button type="submit" className="login-submit" disabled={loading}>
                  {loading ? "Unlocking..." : "Unlock with PIN"}
                </button>

                <p className="login-passkey-note">
                  {platformPasskeyAvailable
                    ? `Fingerprint access is enabled for ${ownerLabel} on this device.`
                    : "Use the owner PIN below. Fingerprint access can be enabled again from Settings when Windows Hello is ready."}
                </p>

                {error ? <p className="login-error">{error}</p> : null}

                {!platformPasskeyAvailable && authModeResolved ? (
                  <p className="login-support-note">
                    Windows Hello is not ready on this device yet. Set it up in <span>Windows Settings &gt; Accounts &gt; Sign-in options</span>, then return here.
                  </p>
                ) : null}
              </form>

              <p className="login-auth-footnote">
                Connected to <strong>{storeName}</strong> using the live AfroSpice workspace runtime.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Login;
