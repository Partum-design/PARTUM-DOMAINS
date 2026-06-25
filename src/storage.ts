import type {
  DecryptedVaultEvent,
  BackupReason,
  BackupSettings,
  DomainEventType,
  DomainRecord,
  RawVaultEvent,
  VaultBackup,
  VaultBackupRecord,
  VaultMetadata,
  VaultSession,
} from "./types";

const DB_NAME = "partum-domains-vault";
const DB_VERSION = 2;
const META_STORE = "metadata";
const EVENT_STORE = "events";
const BACKUP_STORE = "backups";
const SETTINGS_STORE = "settings";
const META_KEY = "vault";
const BACKUP_SETTINGS_KEY = "backup-settings";
const LEGACY_ITERATIONS = 250_000;
const CURRENT_ITERATIONS = 600_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }

      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        db.createObjectStore(EVENT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const getKdfIterations = (metadata: Pick<VaultMetadata, "kdf"> | null) =>
  metadata?.kdf?.iterations ?? LEGACY_ITERATIONS;

const loginSecret = (username: string | undefined, password: string) =>
  username ? `${username}:${password}` : password;

const deriveKey = async (secret: string, salt: string, iterations: number) => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

const encryptJson = async (key: CryptoKey, value: unknown) => {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );

  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
};

const decryptJson = async <T>(key: CryptoKey, payload: { iv: string; data: string }) => {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data),
  );

  return JSON.parse(decoder.decode(decrypted)) as T;
};

const putMetadata = async (metadata: VaultMetadata) => {
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(metadata, META_KEY);
  await txDone(tx);
  db.close();
};

export const getVaultMetadata = async () => {
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, "readonly");
  const metadata = await requestToPromise<VaultMetadata | undefined>(
    tx.objectStore(META_STORE).get(META_KEY),
  );
  await txDone(tx);
  db.close();
  return metadata ?? null;
};

export const resetLocalVault = async () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Cierra otras pestañas de Partum Domains e intenta otra vez."));
  });

export const initializeVault = async (
  username: string,
  password: string,
): Promise<VaultSession> => {
  const existing = await getVaultMetadata();

  if (existing) {
    throw new Error("La bóveda ya existe.");
  }

  const metadataDraft = {
    schemaVersion: 1,
    vaultId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    username,
    salt: bytesToBase64(randomBytes(16)),
    kdf: {
      name: "PBKDF2-SHA256",
      iterations: CURRENT_ITERATIONS,
    },
  } satisfies Omit<VaultMetadata, "verifier">;
  const key = await deriveKey(
    loginSecret(metadataDraft.username, password),
    metadataDraft.salt,
    metadataDraft.kdf.iterations,
  );
  const verifier = await encryptJson(key, {
    ok: true,
    vaultId: metadataDraft.vaultId,
    app: "Partum Domains",
  });
  const metadata: VaultMetadata = { ...metadataDraft, verifier };

  await putMetadata(metadata);
  return { key, metadata };
};

export const unlockVault = async (username: string, password: string): Promise<VaultSession> => {
  const metadata = await getVaultMetadata();

  if (!metadata) {
    throw new Error("Todavía no existe una bóveda.");
  }

  if (metadata.username && username !== metadata.username) {
    throw new Error("El usuario no coincide con esta bóveda.");
  }

  const key = await deriveKey(
    loginSecret(metadata.username, password),
    metadata.salt,
    getKdfIterations(metadata),
  );
  const verifier = await decryptJson<{ ok: boolean; vaultId: string }>(key, metadata.verifier);

  if (!verifier.ok || verifier.vaultId !== metadata.vaultId) {
    throw new Error("La contraseña maestra no coincide.");
  }

  return { key, metadata };
};

export const appendVaultEvent = async (
  session: VaultSession,
  type: DomainEventType,
  record: DomainRecord,
) => {
  const event: RawVaultEvent = {
    id: crypto.randomUUID(),
    domainId: record.id,
    type,
    at: new Date().toISOString(),
    payload: await encryptJson(session.key, { record }),
  };
  const db = await openDatabase();
  const tx = db.transaction(EVENT_STORE, "readwrite");
  tx.objectStore(EVENT_STORE).add(event);
  await txDone(tx);
  db.close();
};

export const readRawEvents = async () => {
  const db = await openDatabase();
  const tx = db.transaction(EVENT_STORE, "readonly");
  const events = await requestToPromise<RawVaultEvent[]>(tx.objectStore(EVENT_STORE).getAll());
  await txDone(tx);
  db.close();
  return events.sort((a, b) => a.at.localeCompare(b.at));
};

export const readVaultEvents = async (session: VaultSession) => {
  const rawEvents = await readRawEvents();
  const events: DecryptedVaultEvent[] = [];

  for (const rawEvent of rawEvents) {
    const payload = await decryptJson<{ record: DomainRecord }>(session.key, rawEvent.payload);
    events.push({
      id: rawEvent.id,
      domainId: rawEvent.domainId,
      type: rawEvent.type,
      at: rawEvent.at,
      record: payload.record,
    });
  }

  return events;
};

export const deriveRecordsFromEvents = (events: DecryptedVaultEvent[]) => {
  const records = new Map<string, DomainRecord>();

  events.forEach((event) => {
    records.set(event.domainId, event.record);
  });

  return Array.from(records.values());
};

export const exportEncryptedBackup = async (): Promise<VaultBackup> => {
  const metadata = await getVaultMetadata();

  if (!metadata) {
    throw new Error("No hay bóveda para respaldar.");
  }

  return {
    app: "Partum Domains",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    metadata,
    events: await readRawEvents(),
  };
};

export const importEncryptedBackup = async (backup: VaultBackup) => {
  if (backup.app !== "Partum Domains" || backup.schemaVersion !== 1) {
    throw new Error("El respaldo no pertenece a Partum Domains.");
  }

  const existing = await getVaultMetadata();

  if (existing && existing.vaultId !== backup.metadata.vaultId) {
    throw new Error("Este respaldo pertenece a otra bóveda.");
  }

  if (!existing) {
    await putMetadata(backup.metadata);
  }

  const db = await openDatabase();
  const tx = db.transaction(EVENT_STORE, "readwrite");
  const store = tx.objectStore(EVENT_STORE);

  backup.events.forEach((event) => {
    store.put(event);
  });

  await txDone(tx);
  db.close();
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const backupSize = (backup: VaultBackup) => encoder.encode(JSON.stringify(backup)).byteLength;

const defaultBackupSettings = (): BackupSettings => ({
  enabled: true,
  intervalDays: 15,
  lastRunAt: "",
  nextRunAt: new Date().toISOString(),
});

export const getBackupSettings = async () => {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS_STORE, "readonly");
  const settings = await requestToPromise<BackupSettings | undefined>(
    tx.objectStore(SETTINGS_STORE).get(BACKUP_SETTINGS_KEY),
  );
  await txDone(tx);
  db.close();
  return settings ?? defaultBackupSettings();
};

export const saveBackupSettings = async (settings: BackupSettings) => {
  const db = await openDatabase();
  const tx = db.transaction(SETTINGS_STORE, "readwrite");
  tx.objectStore(SETTINGS_STORE).put(settings, BACKUP_SETTINGS_KEY);
  await txDone(tx);
  db.close();
};

export const listBackupSnapshots = async () => {
  const db = await openDatabase();
  const tx = db.transaction(BACKUP_STORE, "readonly");
  const records = await requestToPromise<VaultBackupRecord[]>(
    tx.objectStore(BACKUP_STORE).getAll(),
  );
  await txDone(tx);
  db.close();
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const createBackupSnapshot = async (reason: BackupReason) => {
  const backup = await exportEncryptedBackup();
  const record: VaultBackupRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    reason,
    eventCount: backup.events.length,
    sizeBytes: backupSize(backup),
    backup,
  };
  const db = await openDatabase();
  const tx = db.transaction(BACKUP_STORE, "readwrite");
  tx.objectStore(BACKUP_STORE).add(record);
  await txDone(tx);
  db.close();
  return record;
};

export const createBackupIfDue = async () => {
  const settings = await getBackupSettings();

  if (!settings.enabled) {
    return { created: false as const, settings };
  }

  const metadata = await getVaultMetadata();
  const events = await readRawEvents();

  if (!metadata || events.length === 0) {
    return { created: false as const, settings };
  }

  const now = new Date();
  const dueAt = settings.nextRunAt ? new Date(settings.nextRunAt) : now;

  if (Number.isFinite(dueAt.getTime()) && dueAt.getTime() > now.getTime()) {
    return { created: false as const, settings };
  }

  const record = await createBackupSnapshot("auto");
  const nextSettings: BackupSettings = {
    ...settings,
    lastRunAt: record.createdAt,
    nextRunAt: addDays(new Date(record.createdAt), settings.intervalDays).toISOString(),
  };
  await saveBackupSettings(nextSettings);
  return { created: true as const, settings: nextSettings, record };
};

export const updateBackupInterval = async (intervalDays: BackupSettings["intervalDays"]) => {
  const settings = await getBackupSettings();
  const baseDate = settings.lastRunAt ? new Date(settings.lastRunAt) : new Date();
  const nextSettings: BackupSettings = {
    ...settings,
    intervalDays,
    nextRunAt: addDays(baseDate, intervalDays).toISOString(),
  };
  await saveBackupSettings(nextSettings);
  return nextSettings;
};

export const setBackupEnabled = async (enabled: boolean) => {
  const settings = await getBackupSettings();
  const nextSettings: BackupSettings = {
    ...settings,
    enabled,
    nextRunAt: settings.nextRunAt || new Date().toISOString(),
  };
  await saveBackupSettings(nextSettings);
  return nextSettings;
};
