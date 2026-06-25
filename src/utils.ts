import type { DomainRecord, ExtraAccess, HostType, ProviderId } from "./types";

export const hostTypes: HostType[] = [
  "Compartido",
  "WordPress",
  "Cloud",
  "VPS",
  "Dedicado",
  "Reseller",
  "Correo",
  "Otro",
];

export const createExtraAccess = (): ExtraAccess => ({
  id: crypto.randomUUID(),
  label: "",
  type: "",
  url: "",
  username: "",
  password: "",
  email: "",
  notes: "",
});

export const createDomainRecord = (): DomainRecord => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    domain: "",
    clientName: "",
    projectName: "",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",
    providerId: "hostgator",
    registrarUrl: "",
    registrarUsername: "",
    registrarPassword: "",
    registrarAccountEmail: "",
    domainExpiration: "",
    domainOwnedByUs: true,
    autoRenew: false,
    renewalCost: "",
    tags: [],
    notes: "",
    archived: false,
    createdAt: now,
    updatedAt: now,
    hosting: {
      enabled: true,
      ownedByUs: true,
      providerId: "hostgator",
      hostType: "Compartido",
      serverType: "",
      panelUrl: "",
      username: "",
      password: "",
      accountEmail: "",
      expirationDate: "",
      notes: "",
    },
    wordpress: {
      enabled: false,
      adminUrl: "",
      username: "",
      password: "",
      codeEmail: "",
      notes: "",
    },
    emailAccess: {
      enabled: false,
      panelUrl: "",
      address: "",
      password: "",
      recoveryEmail: "",
      notes: "",
    },
    extraAccesses: [],
  };
};

export const normalizeUsername = (value: string) => value.trim();

export const passwordStrength = (value: string) => {
  let score = 0;

  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score >= 5) return { label: "Muy fuerte", tone: "success" };
  if (score >= 4) return { label: "Fuerte", tone: "success" };
  if (score >= 3) return { label: "Media", tone: "warning" };
  return { label: "Débil", tone: "danger" };
};

export const generatePassword = (length = 22) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+=?";
  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

export const cloneRecord = (record: DomainRecord): DomainRecord =>
  structuredClone(record) as DomainRecord;

export const formatDate = (value: string) => {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00`));
};

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export const daysUntil = (value: string) => {
  if (!value) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(`${value}T12:00:00`);
  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();

  return Math.ceil((targetDay - today) / 86_400_000);
};

export const getCriticalDate = (record: DomainRecord) => {
  const dates = [record.domainExpiration, record.hosting.expirationDate].filter(Boolean);

  if (dates.length === 0) {
    return "";
  }

  return dates.sort()[0];
};

export const getStatus = (record: DomainRecord) => {
  if (record.archived) {
    return { label: "Archivado", tone: "muted", days: null };
  }

  const days = daysUntil(getCriticalDate(record));

  if (days === null) {
    return { label: "Sin vencimiento", tone: "neutral", days };
  }

  if (days < 0) {
    return { label: "Vencido", tone: "danger", days };
  }

  if (days <= 15) {
    return { label: "Urgente", tone: "danger", days };
  }

  if (days <= 45) {
    return { label: "Por vencer", tone: "warning", days };
  }

  return { label: "Activo", tone: "success", days };
};

export const matchesProvider = (record: DomainRecord, providerId: ProviderId | "all") => {
  if (providerId === "all") {
    return true;
  }

  return record.providerId === providerId || record.hosting.providerId === providerId;
};

export const normalizeTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

export const tagsToString = (tags: string[]) => tags.join(", ");

export const sortRecords = (records: DomainRecord[]) =>
  [...records].sort((a, b) => {
    if (a.archived !== b.archived) {
      return a.archived ? 1 : -1;
    }

    return (daysUntil(getCriticalDate(a)) ?? 99999) - (daysUntil(getCriticalDate(b)) ?? 99999);
  });
