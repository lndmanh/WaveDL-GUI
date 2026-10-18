// Runs inside the browser: never return untrusted storage keys/values or cookies.
export function observeCursorStorage(localStorage, sessionStorage, cookies, daemonId, runId) {
  const expected = `wavedl:cursor:v1:${encodeURIComponent(daemonId)}:${encodeURIComponent(runId)}`;
  const entries = [];
  let valid = localStorage.length <= 1;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    const raw = localStorage.getItem(key);
    try {
      if (key !== expected || typeof raw !== "string" || raw.length > 128) throw Error();
      const value = JSON.parse(raw);
      if (!value || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== "attempt,seq" ||
          !Number.isSafeInteger(value.attempt) || value.attempt < 0 ||
          !Number.isSafeInteger(value.seq) || value.seq < -1 ||
          (value.attempt === 0 && value.seq !== -1)) throw Error();
      entries.push({ key, cursor: { attempt: value.attempt, seq: value.seq } });
    } catch { valid = false; }
  }
  return { local: localStorage.length, entries, valid,
    session: sessionStorage.length, cookies: cookies ? "present" : "" };
}
