export type ProviderId =
  | "hostgator"
  | "godaddy"
  | "hostinger"
  | "siteground"
  | "namecheap"
  | "cloudflare"
  | "bluehost"
  | "ionos"
  | "wix"
  | "squarespace"
  | "wordpress"
  | "cpanel"
  | "kinsta"
  | "digitalocean"
  | "aws"
  | "shopify"
  | "webflow"
  | "vercel"
  | "netlify"
  | "render"
  | "firebase"
  | "other";

export type HostType =
  | "Compartido"
  | "WordPress"
  | "Cloud"
  | "VPS"
  | "Dedicado"
  | "Reseller"
  | "Correo"
  | "Otro";

export type DomainEventType = "upsert" | "archive" | "restore";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  logo?: string;
  color: string;
  category: "registrar" | "hosting" | "cms" | "panel" | "multi";
}

export interface ExtraAccess {
  id: string;
  label: string;
  type: string;
  url: string;
  username: string;
  password: string;
  email: string;
  notes: string;
}

export interface HostingAccess {
  enabled: boolean;
  ownedByUs: boolean;
  providerId: ProviderId;
  hostType: HostType;
  serverType: string;
  panelUrl: string;
  username: string;
  password: string;
  accountEmail: string;
  expirationDate: string;
  notes: string;
}

export interface WordPressAccess {
  enabled: boolean;
  adminUrl: string;
  username: string;
  password: string;
  codeEmail: string;
  notes: string;
}

export interface EmailAccess {
  enabled: boolean;
  panelUrl: string;
  address: string;
  password: string;
  recoveryEmail: string;
  notes: string;
}

export interface DomainRecord {
  id: string;
  domain: string;
  clientName: string;
  projectName: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  providerId: ProviderId;
  registrarUrl: string;
  registrarUsername: string;
  registrarPassword: string;
  registrarAccountEmail: string;
  domainExpiration: string;
  domainOwnedByUs: boolean;
  autoRenew: boolean;
  renewalCost: string;
  tags: string[];
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  hosting: HostingAccess;
  wordpress: WordPressAccess;
  emailAccess: EmailAccess;
  extraAccesses: ExtraAccess[];
}

export interface EncryptedPayload {
  iv: string;
  data: string;
}

export interface RawVaultEvent {
  id: string;
  domainId: string;
  type: DomainEventType;
  at: string;
  payload: EncryptedPayload;
}

export interface DecryptedVaultEvent {
  id: string;
  domainId: string;
  type: DomainEventType;
  at: string;
  record: DomainRecord;
}

export interface VaultMetadata {
  schemaVersion: 1;
  vaultId: string;
  createdAt: string;
  username?: string;
  salt: string;
  kdf?: {
    name: "PBKDF2-SHA256";
    iterations: number;
  };
  verifier: EncryptedPayload;
}

export interface VaultBackup {
  app: "Partum Domains";
  schemaVersion: 1;
  exportedAt: string;
  metadata: VaultMetadata;
  events: RawVaultEvent[];
}

export type BackupReason = "auto" | "manual" | "periodic-sync";

export interface VaultBackupRecord {
  id: string;
  createdAt: string;
  reason: BackupReason;
  eventCount: number;
  sizeBytes: number;
  backup: VaultBackup;
}

export interface BackupSettings {
  enabled: boolean;
  intervalDays: 7 | 15 | 30;
  lastRunAt: string;
  nextRunAt: string;
}

export interface VaultSession {
  key: CryptoKey;
  metadata: VaultMetadata;
}
