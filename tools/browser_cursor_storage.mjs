// Runs inside the browser: never return untrusted storage keys/values or cookies.
// The browser may retain one bounded session envelope in sessionStorage (or,
// only after the explicit Keep-me-signed-in choice, localStorage). Cursor
// watermarks remain the only other accepted storage records.
export const SESSION_CREDENTIAL_KEY = "wavedl.session.v1";

export function observeCursorStorage(localStorage, sessionStorage, cookies, daemonId, runId, options = {}) {
  const sessionCredentialKey = "wavedl.session.v1";
  // The app records the Keep-me-signed-in choice itself; its value must agree
  // with the storage area that holds the credential.
  const keepSignedInKey = "wavedl.keep-signed-in.v1";
  const envelopeKeys = ["daemonId", "expiresAt", "origin", "token", "version"];
  const expected = `wavedl:cursor:v1:${encodeURIComponent(daemonId)}:${encodeURIComponent(runId)}`;
  const credentialArea = options.credentialArea === "local" ? "local" : "session";
  const forbiddenTokens = Array.isArray(options.forbiddenTokens)
    ? options.forbiddenTokens
    : [options.forbiddenToken];

  function inspectCredential(raw) {
    let value;
    try {
      if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 16 * 1024) {
        throw new Error();
      }
      value = JSON.parse(raw);
      if (!value || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== envelopeKeys.join(",") ||
          value.version !== 1 || typeof value.daemonId !== "string" ||
          value.daemonId.length < 1 || value.daemonId.length > 256 ||
          typeof value.origin !== "string" || value.origin.length < 1 ||
          value.origin.length > 512 || typeof value.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
          !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) {
        throw new Error();
      }
      const origin = new URL(value.origin);
      if (origin.origin !== value.origin || !["http:", "https:"].includes(origin.protocol)) {
        throw new Error();
      }
      const daemonIdMatches = !daemonId || value.daemonId === daemonId;
      const originMatches = !options.origin || value.origin === options.origin;
      const masterTokenPresent = forbiddenTokens.some((token) =>
        typeof token === "string" && token.length > 0 && value.token === token);
      const href = globalThis.location?.href ?? "";
      return {
        present: true,
        key: sessionCredentialKey,
        valid: daemonIdMatches && originMatches && !masterTokenPresent,
        daemonIdMatches,
        originMatches,
        expiresAtValid: true,
        masterTokenPresent,
        tokenInUrl: href.includes(value.token),
      };
    } catch {
      return {
        present: true,
        key: sessionCredentialKey,
        valid: false,
        daemonIdMatches: false,
        originMatches: false,
        expiresAtValid: false,
        masterTokenPresent: false,
        tokenInUrl: false,
      };
    }
  }

  function inspectStorage(storage, area, credential) {
    const entries = [];
    let valid = true;
    let credentialObservation = credential;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      const raw = storage.getItem(key);
      if (key === sessionCredentialKey && area === credentialArea) {
        if (credentialObservation.present) valid = false;
        credentialObservation = inspectCredential(raw);
        if (!credentialObservation.valid) valid = false;
        continue;
      }
      if (area === "local" && key === keepSignedInKey) {
        if (raw !== (credentialArea === "local" ? "true" : "false")) valid = false;
        continue;
      }
      if (area !== "local" || key !== expected || typeof raw !== "string" || raw.length > 128) {
        valid = false;
        continue;
      }
      try {
        const value = JSON.parse(raw);
        if (!value || Array.isArray(value) ||
            Object.keys(value).sort().join(",") !== "attempt,seq" ||
            !Number.isSafeInteger(value.attempt) || value.attempt < 0 ||
            !Number.isSafeInteger(value.seq) || value.seq < -1 ||
            (value.attempt === 0 && value.seq !== -1)) throw new Error();
        entries.push({ key, cursor: { attempt: value.attempt, seq: value.seq } });
      } catch {
        valid = false;
      }
    }
    return { entries, valid, credential: credentialObservation };
  }

  const emptyCredential = {
    present: false,
    key: sessionCredentialKey,
    valid: true,
    daemonIdMatches: true,
    originMatches: true,
    expiresAtValid: false,
    masterTokenPresent: false,
    tokenInUrl: false,
  };
  const local = inspectStorage(localStorage, "local", emptyCredential);
  const session = inspectStorage(sessionStorage, "session", local.credential);
  const credential = credentialArea === "local" ? local.credential : session.credential;
  const href = typeof location === "undefined" ? "" : location.href;
  const credentialInUrl = forbiddenTokens.some((token) =>
    typeof token === "string" && token.length > 0 && href.includes(token)) ||
    credential.tokenInUrl === true;
  let bootstrapInUrl = false;
  try {
    bootstrapInUrl = new URL(href).searchParams.has("bootstrap");
  } catch {
    bootstrapInUrl = false;
  }
  return {
    local: localStorage.length,
    entries: local.entries,
    session: sessionStorage.length,
    credential,
    credentialStorage: credential.present ? credentialArea : null,
    credentialInUrl,
    bootstrapInUrl,
    valid: local.valid && session.valid &&
      localStorage.length <=
        1 + (credentialArea === "local" ? 1 : 0) + (localStorage.getItem(keepSignedInKey) === null ? 0 : 1) &&
      sessionStorage.length <= (credentialArea === "session" ? 1 : 0),
    cookies: cookies ? "present" : "",
  };
}
