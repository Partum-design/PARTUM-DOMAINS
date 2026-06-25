import type { BackupSettings } from "./types";

const BACKUP_SYNC_TAG = "partum-domains-backup";

export const registerPeriodicBackup = async (settings: BackupSettings) => {
  if (!settings.enabled || !("serviceWorker" in navigator)) {
    return false;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const periodicSync = registration && "periodicSync" in registration
    ? (registration as ServiceWorkerRegistration & {
        periodicSync: {
          register: (tag: string, options: { minInterval: number }) => Promise<void>;
        };
      }).periodicSync
    : null;

  if (!periodicSync) {
    return false;
  }

  try {
    await periodicSync.register(BACKUP_SYNC_TAG, {
      minInterval: settings.intervalDays * 24 * 60 * 60 * 1000,
    });
    return true;
  } catch {
    return false;
  }
};
