function base64urlToBuffer(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return new ArrayBuffer(0);
  }

  const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function bufferToBase64url(value) {
  if (!value) {
    return "";
  }

  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer || value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function mapCredentialDescriptors(descriptors = []) {
  if (!Array.isArray(descriptors)) {
    return [];
  }

  return descriptors.map((descriptor) => ({
    ...descriptor,
    id: base64urlToBuffer(descriptor.id),
  }));
}

export function isPasskeySupported() {
  return typeof window !== "undefined" && Boolean(window.PublicKeyCredential) && Boolean(navigator?.credentials);
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isPasskeySupported()) {
    return false;
  }

  if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return false;
  }

  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function toPasskeyRegistrationOptions(options = {}) {
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    user: {
      ...(options.user || {}),
      id: base64urlToBuffer(options?.user?.id),
    },
    excludeCredentials: mapCredentialDescriptors(options.excludeCredentials),
  };
}

export function toPasskeyAuthenticationOptions(options = {}) {
  return {
    ...options,
    challenge: base64urlToBuffer(options.challenge),
    allowCredentials: mapCredentialDescriptors(options.allowCredentials),
  };
}

export function serializePasskeyCredential(credential) {
  if (!credential) {
    return null;
  }

  const base = {
    id: String(credential.id || "").trim(),
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults:
      typeof credential.getClientExtensionResults === "function"
        ? credential.getClientExtensionResults()
        : {},
  };

  if (credential.response?.attestationObject) {
    return {
      ...base,
      response: {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        transports:
          typeof credential.response.getTransports === "function"
            ? credential.response.getTransports()
            : [],
      },
    };
  }

  return {
    ...base,
    response: {
      clientDataJSON: bufferToBase64url(credential.response?.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response?.authenticatorData),
      signature: bufferToBase64url(credential.response?.signature),
      userHandle: credential.response?.userHandle
        ? bufferToBase64url(credential.response.userHandle)
        : null,
    },
  };
}
