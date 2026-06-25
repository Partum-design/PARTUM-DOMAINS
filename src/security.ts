const LOCK_KEY = "partum-domains-login-lock";
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

interface LoginLockState {
  attempts: number;
  lockedUntil: number;
}

const readLockState = (): LoginLockState => {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) ?? "") as LoginLockState;
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
};

const writeLockState = (state: LoginLockState) => {
  localStorage.setItem(LOCK_KEY, JSON.stringify(state));
};

export const getLoginLock = () => {
  const state = readLockState();
  const remainingMs = Math.max(0, state.lockedUntil - Date.now());

  if (remainingMs === 0 && state.lockedUntil > 0) {
    writeLockState({ attempts: 0, lockedUntil: 0 });
  }

  return {
    attempts: remainingMs > 0 ? state.attempts : Math.min(state.attempts, MAX_ATTEMPTS),
    locked: remainingMs > 0,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
};

export const recordLoginFailure = () => {
  const state = readLockState();
  const attempts = state.attempts + 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0;
  writeLockState({ attempts, lockedUntil });
  return getLoginLock();
};

export const clearLoginFailures = () => {
  writeLockState({ attempts: 0, lockedUntil: 0 });
};

export const requestPersistentStorage = async () => {
  if (!navigator.storage?.persist) {
    return false;
  }

  try {
    return navigator.storage.persist();
  } catch {
    return false;
  }
};
