import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CalendarClock,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  Globe2,
  History,
  KeyRound,
  Link,
  Lock,
  LogOut,
  Mail,
  Moon,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Upload,
  User,
  WandSparkles,
  X,
} from "lucide-react";
import { getProvider, providers } from "./providers";
import {
  appendVaultEvent,
  createBackupIfDue,
  createBackupSnapshot,
  deriveRecordsFromEvents,
  exportEncryptedBackup,
  getBackupSettings,
  getVaultMetadata,
  importEncryptedBackup,
  listBackupSnapshots,
  setBackupEnabled,
  initializeVault,
  readVaultEvents,
  resetLocalVault,
  updateBackupInterval,
  unlockVault,
} from "./storage";
import type {
  DecryptedVaultEvent,
  BackupSettings,
  DomainRecord,
  EmailAccess,
  ExtraAccess,
  HostingAccess,
  ProviderId,
  VaultBackup,
  VaultBackupRecord,
  VaultSession,
  WordPressAccess,
} from "./types";
import {
  cloneRecord,
  createDomainRecord,
  createExtraAccess,
  daysUntil,
  formatDate,
  formatDateTime,
  getCriticalDate,
  getStatus,
  hostTypes,
  matchesProvider,
  normalizeTags,
  sortRecords,
  tagsToString,
  generatePassword,
  normalizeUsername,
  passwordStrength,
} from "./utils";
import {
  notifyExpiringDomains,
  registerServiceWorker,
  requestNotificationPermission,
  showLocalNotification,
} from "./notifications";
import {
  clearLoginFailures,
  getLoginLock,
  recordLoginFailure,
  requestPersistentStorage,
} from "./security";
import { registerPeriodicBackup } from "./backupScheduler";

type GateMode = "loading" | "setup" | "locked" | "unlocked";
type StatusFilter = "all" | "active" | "expiring" | "expired" | "archived";
type OwnershipFilter = "all" | "ours" | "external";

const App = () => {
  const [gateMode, setGateMode] = useState<GateMode>("loading");
  const [session, setSession] = useState<VaultSession | null>(null);
  const [records, setRecords] = useState<DomainRecord[]>([]);
  const [events, setEvents] = useState<DecryptedVaultEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DomainRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backupPanelOpen, setBackupPanelOpen] = useState(false);
  const [credentialReminder, setCredentialReminder] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [toast, setToast] = useState("");
  const [keepSessionOpen, setKeepSessionOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("partum-theme") || "light");
  const [largeText, setLargeText] = useState(() => localStorage.getItem("partum-large-text") === "1");
  const [highContrast, setHighContrast] = useState(
    () => localStorage.getItem("partum-high-contrast") === "1",
  );
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(null);
  const [backupSnapshots, setBackupSnapshots] = useState<VaultBackupRecord[]>([]);
  const [backgroundBackups, setBackgroundBackups] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const refreshBackups = async () => {
    const settings = await getBackupSettings();
    setBackupSettings(settings);
    setBackupSnapshots(await listBackupSnapshots());
    setBackgroundBackups(await registerPeriodicBackup(settings));
  };

  const loadData = async (activeSession = session) => {
    if (!activeSession) {
      return;
    }

    const vaultEvents = await readVaultEvents(activeSession);
    const nextRecords = sortRecords(deriveRecordsFromEvents(vaultEvents));
    setEvents(vaultEvents);
    setRecords(nextRecords);

    if (!selectedId && nextRecords[0]) {
      setSelectedId(nextRecords[0].id);
    }

    if ("Notification" in window && Notification.permission === "granted") {
      await notifyExpiringDomains(nextRecords);
    }

    const backupResult = await createBackupIfDue();
    await refreshBackups();

    if (backupResult.created) {
      await showLocalNotification(
        "Partum Domains",
        "Backup cifrado automático creado. Exporta una copia externa cuando puedas.",
        "partum-domains-auto-backup",
      );
      showToast("Backup automático creado.");
    }
  };

  useEffect(() => {
    const boot = async () => {
      await registerServiceWorker();
      const metadata = await getVaultMetadata();
      setPersistentStorage(await requestPersistentStorage());
      await refreshBackups();
      setGateMode(metadata ? "locked" : "setup");
    };

    boot().catch((error) => {
      console.error(error);
      setGateMode("setup");
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.largeText = largeText ? "true" : "false";
    document.documentElement.dataset.contrast = highContrast ? "high" : "normal";
    localStorage.setItem("partum-theme", theme);
    localStorage.setItem("partum-large-text", largeText ? "1" : "0");
    localStorage.setItem("partum-high-contrast", highContrast ? "1" : "0");
  }, [highContrast, largeText, theme]);

  useEffect(() => {
    if (gateMode !== "unlocked" || keepSessionOpen) {
      return undefined;
    }

    let timeoutId = window.setTimeout(lockSession, 15 * 60 * 1000);
    const resetTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(lockSession, 15 * 60 * 1000);
    };
    const events = ["click", "keydown", "pointermove", "touchstart"];

    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));

    return () => {
      window.clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [gateMode, keepSessionOpen]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase();

    return records.filter((record) => {
      const status = getStatus(record);
      const text = [
        record.domain,
        record.clientName,
        record.projectName,
        record.contactName,
        record.contactRole,
        record.contactEmail,
        record.contactPhone,
        record.notes,
        record.registrarAccountEmail,
        record.registrarUsername,
        record.hosting.accountEmail,
        record.hosting.username,
        record.wordpress.username,
        record.wordpress.codeEmail,
        record.emailAccess.address,
        record.tags.join(" "),
        getProvider(record.providerId).label,
        getProvider(record.hosting.providerId).label,
      ]
        .join(" ")
        .toLowerCase();

      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "archived" && record.archived) ||
        (statusFilter === "expired" && !record.archived && (status.days ?? 1) < 0) ||
        (statusFilter === "expiring" &&
          !record.archived &&
          status.days !== null &&
          status.days >= 0 &&
          status.days <= 45) ||
        (statusFilter === "active" && status.tone === "success");

      const ownershipMatches =
        ownershipFilter === "all" ||
        (ownershipFilter === "ours" && (record.domainOwnedByUs || record.hosting.ownedByUs)) ||
        (ownershipFilter === "external" && !record.domainOwnedByUs && !record.hosting.ownedByUs);

      return (
        (!search || text.includes(search)) &&
        matchesProvider(record, providerFilter) &&
        statusMatches &&
        ownershipMatches
      );
    });
  }, [ownershipFilter, providerFilter, query, records, statusFilter]);

  const stats = useMemo(() => {
    const visible = records.filter((record) => !record.archived);
    const expired = visible.filter((record) => (daysUntil(getCriticalDate(record)) ?? 1) < 0);
    const expiring = visible.filter((record) => {
      const days = daysUntil(getCriticalDate(record));
      return days !== null && days >= 0 && days <= 45;
    });
    const secured = visible.filter(
      (record) =>
        record.registrarPassword ||
        record.hosting.password ||
        record.wordpress.password ||
        record.emailAccess.password ||
        record.extraAccesses.some((access) => access.password),
    );

    return {
      total: visible.length,
      expiring: expiring.length,
      expired: expired.length,
      secured: secured.length,
      archived: records.length - visible.length,
    };
  }, [records]);

  const lockSession = () => {
    setSession(null);
    setRecords([]);
    setEvents([]);
    setSelectedId(null);
    setDraft(null);
    setIsFormOpen(false);
    setHistoryOpen(false);
    setBackupPanelOpen(false);
    setGateMode("locked");
    showToast("Sesión cerrada.");
  };

  const handleSetup = async (username: string, password: string, shouldKeepOpen: boolean) => {
    const nextSession = await initializeVault(username, password);
    setSession(nextSession);
    setKeepSessionOpen(shouldKeepOpen);
    setCredentialReminder({ username, password });
    setGateMode("unlocked");
    setPersistentStorage(await requestPersistentStorage());
    await loadData(nextSession);
    clearLoginFailures();
    showToast("Bóveda creada y cifrada.");
  };

  const handleUnlock = async (username: string, password: string, shouldKeepOpen: boolean) => {
    const nextSession = await unlockVault(username, password);
    setSession(nextSession);
    setKeepSessionOpen(shouldKeepOpen);
    setGateMode("unlocked");
    setPersistentStorage(await requestPersistentStorage());
    await loadData(nextSession);
    clearLoginFailures();
    showToast("Bóveda desbloqueada.");
  };

  const handleImportBackup = async (backup: VaultBackup) => {
    await importEncryptedBackup(backup);

    if (session) {
      await loadData(session);
      showToast("Respaldo importado.");
      return;
    }

    setGateMode("locked");
    showToast("Respaldo importado. Desbloquea con su contraseña maestra.");
  };

  const handleResetVault = async () => {
    await resetLocalVault();
    clearLoginFailures();
    setSession(null);
    setRecords([]);
    setEvents([]);
    setSelectedId(null);
    setBackupSnapshots([]);
    setBackupSettings(await getBackupSettings());
    setGateMode("setup");
    showToast("Bóveda local reiniciada.");
  };

  const handleExport = async () => {
    const backup = await exportEncryptedBackup();
    downloadBackupFile(backup, `partum-domains-backup-${new Date().toISOString().slice(0, 10)}.json`);
    showToast("Respaldo cifrado exportado.");
  };

  const downloadBackupFile = (backup: VaultBackup, filename: string) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const linkElement = document.createElement("a");
    linkElement.href = url;
    linkElement.download = filename;
    linkElement.click();
    URL.revokeObjectURL(url);
  };

  const handleManualBackup = async () => {
    const record = await createBackupSnapshot("manual");
    await refreshBackups();
    showToast("Backup cifrado creado.");
    return record;
  };

  const handleDownloadSnapshot = (record: VaultBackupRecord) => {
    downloadBackupFile(
      record.backup,
      `partum-domains-auto-backup-${record.createdAt.slice(0, 10)}.json`,
    );
    showToast("Backup cifrado descargado.");
  };

  const handleBackupInterval = async (intervalDays: BackupSettings["intervalDays"]) => {
    setBackupSettings(await updateBackupInterval(intervalDays));
    await refreshBackups();
    showToast("Frecuencia de backups actualizada.");
  };

  const handleBackupEnabled = async (enabled: boolean) => {
    setBackupSettings(await setBackupEnabled(enabled));
    await refreshBackups();
    showToast(enabled ? "Backups automáticos activados." : "Backups automáticos pausados.");
  };

  const handleNotify = async () => {
    const permission = await requestNotificationPermission();

    if (permission === "granted") {
      await showLocalNotification(
        "Partum Domains",
        "Las notificaciones de vencimiento quedaron activas.",
        "partum-domains-enabled",
      );
      await notifyExpiringDomains(records);
      showToast("Notificaciones activadas.");
      return;
    }

    showToast("El navegador no permitió notificaciones.");
  };

  const openNewRecord = () => {
    setDraft(createDomainRecord());
    setIsFormOpen(true);
  };

  const openEditRecord = (record: DomainRecord) => {
    setDraft(cloneRecord(record));
    setIsFormOpen(true);
  };

  const saveRecord = async () => {
    if (!session || !draft) {
      return;
    }

    if (!draft.domain.trim()) {
      showToast("El dominio es obligatorio.");
      return;
    }

    const cleanRecord = {
      ...draft,
      domain: draft.domain.trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    };

    await appendVaultEvent(session, cleanRecord.archived ? "restore" : "upsert", cleanRecord);
    setSelectedId(cleanRecord.id);
    setIsFormOpen(false);
    setDraft(null);
    await loadData(session);
    showToast("Dominio guardado en historial cifrado.");
  };

  const archiveRecord = async (record: DomainRecord) => {
    if (!session) {
      return;
    }

    const archived = { ...record, archived: true, updatedAt: new Date().toISOString() };
    await appendVaultEvent(session, "archive", archived);
    await loadData(session);
    showToast("Dominio archivado sin borrar historial.");
  };

  const restoreRecord = async (record: DomainRecord) => {
    if (!session) {
      return;
    }

    const restored = { ...record, archived: false, updatedAt: new Date().toISOString() };
    await appendVaultEvent(session, "restore", restored);
    setSelectedId(restored.id);
    await loadData(session);
    showToast("Dominio restaurado.");
  };

  const restoreHistoricalRecord = async (record: DomainRecord) => {
    if (!session) {
      return;
    }

    const restored = { ...record, archived: false, updatedAt: new Date().toISOString() };
    await appendVaultEvent(session, "restore", restored);
    setSelectedId(restored.id);
    await loadData(session);
    setHistoryOpen(false);
    showToast("Versión restaurada como nuevo evento.");
  };

  if (gateMode !== "unlocked") {
    return (
      <VaultGate
        mode={gateMode}
        onSetup={handleSetup}
        onUnlock={handleUnlock}
        onImportBackup={handleImportBackup}
        onResetVault={handleResetVault}
        keepSessionOpen={keepSessionOpen}
        onKeepSessionOpenChange={setKeepSessionOpen}
        toast={toast}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <img src="/icons/partum-icon.svg" alt="" />
        </div>
        <div className="brand-copy">
          <span>Partum Domains</span>
          <strong>Bóveda cifrada de dominios</strong>
        </div>
        <div className="topbar-actions">
          <IconButton label="Importar respaldo" icon={<Upload size={18} />} onClick={() => {}} asFile onFile={handleImportBackup} />
          <IconButton label="Exportar respaldo" icon={<Download size={18} />} onClick={handleExport} />
          <IconButton label="Backups automáticos" icon={<Database size={18} />} onClick={() => setBackupPanelOpen(true)} />
          <IconButton label="Notificaciones" icon={<Bell size={18} />} onClick={handleNotify} />
          <IconButton
            label={theme === "dark" ? "Modo claro" : "Modo oscuro"}
            icon={theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          />
          <IconButton label="Cerrar sesión" icon={<LogOut size={18} />} onClick={lockSession} />
          <button className="primary-button" type="button" onClick={openNewRecord}>
            <Plus size={18} />
            Nuevo dominio
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar dominio, cliente, proveedor..."
            />
          </div>

          <div className="security-strip">
            <span>
              <Database size={16} />
              {persistentStorage ? "Persistencia activa" : "Persistencia estándar"}
            </span>
            <span>
              <ShieldCheck size={16} />
              Cifrado local
            </span>
          </div>

          <div className="filter-block">
            <span className="filter-title">
              <Filter size={16} />
              Estado
            </span>
            <SegmentedControl
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                ["all", "Todos"],
                ["active", "Activos"],
                ["expiring", "Por vencer"],
                ["expired", "Vencidos"],
                ["archived", "Archivados"],
              ]}
            />
          </div>

          <div className="field">
            <label htmlFor="providerFilter">Proveedor</label>
            <select
              id="providerFilter"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value as ProviderId | "all")}
            >
              <option value="all">Todos</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ownershipFilter">Propiedad</label>
            <select
              id="ownershipFilter"
              value={ownershipFilter}
              onChange={(event) => setOwnershipFilter(event.target.value as OwnershipFilter)}
            >
              <option value="all">Todos</option>
              <option value="ours">Partum lo administra</option>
              <option value="external">Externo</option>
            </select>
          </div>

          <div className="filter-block">
            <span className="filter-title">Tema y accesibilidad</span>
            <div className="accessibility-controls">
              <button
                className={theme === "dark" ? "active" : ""}
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                {theme === "dark" ? "Claro" : "Oscuro"}
              </button>
              <button
                className={largeText ? "active" : ""}
                type="button"
                onClick={() => setLargeText((current) => !current)}
              >
                <Accessibility size={16} />
                Texto
              </button>
              <button
                className={highContrast ? "active" : ""}
                type="button"
                onClick={() => setHighContrast((current) => !current)}
              >
                <ShieldCheck size={16} />
                Contraste
              </button>
            </div>
          </div>

          <ProviderStrip
            selected={providerFilter}
            onSelect={(providerId) =>
              setProviderFilter((current) => (current === providerId ? "all" : providerId))
            }
          />
        </aside>

        <section className="content">
          <StatsGrid stats={stats} />
          <section className="domain-board">
            <div className="section-heading">
              <div>
                <span>{filteredRecords.length} resultados</span>
                <h1>Dominios y accesos</h1>
              </div>
              <ShieldCheck size={24} />
            </div>

            <div className="domain-grid">
              {filteredRecords.map((record) => (
                <DomainCard
                  key={record.id}
                  record={record}
                  active={record.id === selectedId}
                  onSelect={() => setSelectedId(record.id)}
                />
              ))}
              {filteredRecords.length === 0 && (
                <div className="empty-state">
                  <Globe2 size={36} />
                  <strong>No hay dominios con esos filtros.</strong>
                  <button className="ghost-button" type="button" onClick={openNewRecord}>
                    <Plus size={16} />
                    Capturar el primero
                  </button>
                </div>
              )}
            </div>
          </section>
        </section>

        <DetailPanel
          record={selectedRecord}
          events={events.filter((event) => event.domainId === selectedRecord?.id)}
          onEdit={openEditRecord}
          onArchive={archiveRecord}
          onRestore={restoreRecord}
          onOpenHistory={() => setHistoryOpen(true)}
          onCopy={showToast}
        />
      </main>

      {isFormOpen && draft && (
        <DomainForm
          draft={draft}
          setDraft={setDraft}
          onClose={() => {
            setIsFormOpen(false);
            setDraft(null);
          }}
          onSave={saveRecord}
        />
      )}

      {historyOpen && selectedRecord && (
        <HistoryPanel
          record={selectedRecord}
          events={events.filter((event) => event.domainId === selectedRecord.id)}
          onClose={() => setHistoryOpen(false)}
          onRestore={restoreHistoricalRecord}
        />
      )}

      {backupPanelOpen && backupSettings && (
        <BackupPanel
          settings={backupSettings}
          snapshots={backupSnapshots}
          backgroundBackups={backgroundBackups}
          onClose={() => setBackupPanelOpen(false)}
          onCreateNow={handleManualBackup}
          onDownload={handleDownloadSnapshot}
          onIntervalChange={handleBackupInterval}
          onEnabledChange={handleBackupEnabled}
        />
      )}

      {credentialReminder && (
        <CredentialReminder
          username={credentialReminder.username}
          password={credentialReminder.password}
          onClose={() => setCredentialReminder(null)}
          onToast={showToast}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

interface VaultGateProps {
  mode: GateMode;
  toast: string;
  onSetup: (username: string, password: string, keepSessionOpen: boolean) => Promise<void>;
  onUnlock: (username: string, password: string, keepSessionOpen: boolean) => Promise<void>;
  onImportBackup: (backup: VaultBackup) => Promise<void>;
  onResetVault: () => Promise<void>;
  keepSessionOpen: boolean;
  onKeepSessionOpenChange: (value: boolean) => void;
}

const VaultGate = ({
  mode,
  toast,
  onSetup,
  onUnlock,
  onImportBackup,
  onResetVault,
  keepSessionOpen,
  onKeepSessionOpenChange,
}: VaultGateProps) => {
  const [username, setUsername] = useState("Partum Design");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockState, setLockState] = useState(getLoginLock);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!lockState.locked) {
      return undefined;
    }

    const timer = window.setInterval(() => setLockState(getLoginLock()), 1000);
    return () => window.clearInterval(timer);
  }, [lockState.locked]);

  const submit = async () => {
    setError("");

    if (mode === "loading") {
      return;
    }

    const cleanUsername = normalizeUsername(username);

    if (lockState.locked) {
      setError(`Login bloqueado por ${lockState.remainingSeconds}s.`);
      return;
    }

    if (cleanUsername.length < 3) {
      setError("Usa un usuario de mínimo 3 caracteres.");
      return;
    }

    if (password.length < 14) {
      setError("Usa una contraseña maestra de mínimo 14 caracteres.");
      return;
    }

    if (mode === "setup" && password !== confirmPassword) {
      setError("La confirmación no coincide.");
      return;
    }

    setBusy(true);

    try {
      if (mode === "setup") {
        await onSetup(cleanUsername, password, keepSessionOpen);
      } else {
        await onUnlock(cleanUsername, password, keepSessionOpen);
      }
    } catch (caughtError) {
      setLockState(recordLoginFailure());
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo abrir la bóveda.");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const backup = JSON.parse(await file.text()) as VaultBackup;
      await onImportBackup(backup);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "No se pudo importar el respaldo.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resetVault = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onResetVault();
      setPassword("");
      setConfirmPassword("");
      setConfirmReset(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo reiniciar.");
    } finally {
      setBusy(false);
    }
  };

  const generateMasterPassword = () => {
    const nextPassword = generatePassword(24);
    setPassword(nextPassword);
    setConfirmPassword(nextPassword);
  };

  return (
    <main className="vault-gate">
      <section className="gate-panel">
        <div className="brand-mark large" aria-hidden="true">
          <img src="/icons/partum-icon.svg" alt="" />
        </div>
        <span className="eyebrow">Partum Domains</span>
        <h1>{mode === "setup" ? "Crear bóveda cifrada" : "Desbloquear bóveda"}</h1>
        <p>
          Tu contraseña maestra cifra los dominios, accesos y respaldos locales. Guárdala en un
          lugar seguro: no se puede recuperar desde la app.
        </p>
        <div className="gate-note">
          {mode === "setup"
            ? "Primera entrada: crea un usuario y una contraseña maestra de mínimo 14 caracteres."
            : "Esta computadora ya tiene una bóveda. Debes usar el usuario y la contraseña maestra exactos con los que fue creada."}
        </div>

        <div className="gate-fields">
          <label htmlFor="vaultUsername">Usuario</label>
          <input
            id="vaultUsername"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy || mode === "loading"}
          />
          <div className="label-row">
            <label htmlFor="masterPassword">Contraseña maestra</label>
            {mode === "setup" && (
              <button type="button" onClick={generateMasterPassword} disabled={busy}>
                <WandSparkles size={15} />
                Generar
              </button>
            )}
          </div>
          <input
            id="masterPassword"
            type="password"
            autoComplete={mode === "setup" ? "new-password" : "current-password"}
            placeholder="Mínimo 14 caracteres"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submit();
              }
            }}
            disabled={busy || mode === "loading"}
          />

          {mode === "setup" && (
            <>
              <label htmlFor="confirmPassword">Confirmar contraseña</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submit();
                  }
                }}
                disabled={busy}
            />
          </>
          )}
          {mode === "setup" && password && (
            <span className={`strength ${passwordStrength(password).tone}`}>
              {passwordStrength(password).label}
            </span>
          )}
        </div>

        <Checkbox
          label="Mantener sesión abierta en esta pestaña"
          checked={keepSessionOpen}
          onChange={onKeepSessionOpenChange}
        />

        {error && (
          <div className="inline-alert">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <div className="gate-actions">
          <button className="primary-button wide" type="button" onClick={() => void submit()} disabled={busy || lockState.locked}>
            <Lock size={18} />
            {lockState.locked
              ? `Bloqueado ${lockState.remainingSeconds}s`
              : mode === "setup"
                ? "Crear bóveda"
                : "Desbloquear"}
          </button>
          <label className="secondary-upload">
            <Upload size={17} />
            Importar respaldo
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </label>
          {mode === "locked" && (
            <button
              className={`reset-vault-button ${confirmReset ? "danger" : ""}`}
              type="button"
              onClick={() => void resetVault()}
              disabled={busy}
            >
              <AlertTriangle size={16} />
              {confirmReset ? "Confirmar reinicio local" : "Reiniciar bóveda local"}
            </button>
          )}
        </div>
      </section>
      <section className="gate-visual">
        <div className="orb-card">
          <ShieldCheck size={28} />
          <strong>Historial append-only</strong>
          <span>Cada guardado agrega una versión cifrada.</span>
        </div>
        <div className="orb-card accent">
          <Bell size={28} />
          <strong>Alertas de vencimiento</strong>
          <span>Recordatorios locales para dominios críticos.</span>
        </div>
        <div className="orb-card warm">
          <Download size={28} />
          <strong>Respaldos portables</strong>
          <span>Exportación cifrada para conservar copias externas.</span>
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
};

interface IconButtonProps {
  label: string;
  icon: JSX.Element;
  onClick: () => void | Promise<void>;
  asFile?: boolean;
  onFile?: (backup: VaultBackup) => Promise<void>;
}

const IconButton = ({ label, icon, onClick, asFile = false, onFile }: IconButtonProps) => {
  const handleFile = async (file: File | null) => {
    if (!file || !onFile) {
      return;
    }

    const backup = JSON.parse(await file.text()) as VaultBackup;
    await onFile(backup);
  };

  if (asFile) {
    return (
      <label className="icon-button" title={label} aria-label={label}>
        {icon}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
        />
      </label>
    );
  }

  return (
    <button className="icon-button" type="button" title={label} aria-label={label} onClick={() => void onClick()}>
      {icon}
    </button>
  );
};

const ProviderStrip = ({
  selected,
  onSelect,
}: {
  selected: ProviderId | "all";
  onSelect: (providerId: ProviderId) => void;
}) => (
  <div className="provider-strip">
    {providers
      .filter((provider) => provider.id !== "other")
      .map((provider) => (
        <button
          className={`provider-chip ${selected === provider.id ? "active" : ""}`}
          data-tooltip={provider.label}
          key={provider.id}
          title={provider.label}
          type="button"
          onClick={() => onSelect(provider.id)}
          aria-label={`Filtrar por ${provider.label}`}
        >
          <ProviderLogo providerId={provider.id} />
        </button>
      ))}
  </div>
);

interface StatsGridProps {
  stats: {
    total: number;
    expiring: number;
    expired: number;
    secured: number;
    archived: number;
  };
}

const StatsGrid = ({ stats }: StatsGridProps) => (
  <div className="stats-grid">
    <StatCard icon={<Globe2 size={22} />} label="Activos" value={stats.total} tone="green" />
    <StatCard icon={<CalendarClock size={22} />} label="Por vencer" value={stats.expiring} tone="amber" />
    <StatCard icon={<AlertTriangle size={22} />} label="Vencidos" value={stats.expired} tone="red" />
    <StatCard icon={<KeyRound size={22} />} label="Con accesos" value={stats.secured} tone="blue" />
    <StatCard icon={<Archive size={22} />} label="Archivados" value={stats.archived} tone="ink" />
  </div>
);

const StatCard = ({
  icon,
  label,
  value,
  tone,
}: {
  icon: JSX.Element;
  label: string;
  value: number;
  tone: string;
}) => (
  <article className={`stat-card ${tone}`}>
    <span>{icon}</span>
    <div>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  </article>
);

interface SegmentedControlProps {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}

const SegmentedControl = ({ value, options, onChange }: SegmentedControlProps) => (
  <div className="segmented-control">
    {options.map(([optionValue, label]) => (
      <button
        key={optionValue}
        type="button"
        className={value === optionValue ? "active" : ""}
        onClick={() => onChange(optionValue)}
      >
        {label}
      </button>
    ))}
  </div>
);

interface DomainCardProps {
  record: DomainRecord;
  active: boolean;
  onSelect: () => void;
}

const DomainCard = ({ record, active, onSelect }: DomainCardProps) => {
  const provider = getProvider(record.providerId);
  const status = getStatus(record);
  const criticalDate = getCriticalDate(record);

  return (
    <button className={`domain-card ${active ? "selected" : ""}`} type="button" onClick={onSelect}>
      <span className={`status-pill ${status.tone}`}>{status.label}</span>
      <div className="domain-card-head">
        <ProviderLogo providerId={record.providerId} />
        <div>
          <strong>{record.domain || "Sin dominio"}</strong>
          <small>{[record.clientName, record.projectName].filter(Boolean).join(" · ") || provider.label}</small>
        </div>
      </div>
      <div className="domain-card-meta">
        <span>
          <CalendarClock size={15} />
          {formatDate(criticalDate)}
        </span>
        <span>
          <Server size={15} />
          {getProvider(record.hosting.providerId).label}
        </span>
      </div>
      <div className="domain-card-foot">
        {record.domainOwnedByUs && <span>Dominio</span>}
        {record.hosting.ownedByUs && <span>Host</span>}
        {record.wordpress.enabled && <span>WP</span>}
        {record.emailAccess.enabled && <span>Correo</span>}
      </div>
    </button>
  );
};

const ProviderLogo = ({ providerId }: { providerId: ProviderId }) => {
  const provider = getProvider(providerId);

  if (!provider.logo) {
    return (
      <span className="provider-logo fallback" style={{ "--provider-color": provider.color } as React.CSSProperties}>
        {provider.label.slice(0, 2)}
      </span>
    );
  }

  return (
    <span className="provider-logo" style={{ "--provider-color": provider.color } as React.CSSProperties}>
      <img src={provider.logo} alt={provider.label} />
    </span>
  );
};

interface DetailPanelProps {
  record: DomainRecord | null;
  events: DecryptedVaultEvent[];
  onEdit: (record: DomainRecord) => void;
  onArchive: (record: DomainRecord) => void;
  onRestore: (record: DomainRecord) => void;
  onOpenHistory: () => void;
  onCopy: (message: string) => void;
}

const DetailPanel = ({
  record,
  events,
  onEdit,
  onArchive,
  onRestore,
  onOpenHistory,
  onCopy,
}: DetailPanelProps) => {
  if (!record) {
    return (
      <aside className="detail-panel empty">
        <Globe2 size={38} />
        <strong>Selecciona un dominio</strong>
      </aside>
    );
  }

  const status = getStatus(record);

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div className="detail-title">
          <ProviderLogo providerId={record.providerId} />
          <div>
            <span className={`status-pill ${status.tone}`}>{status.label}</span>
            <h2>{record.domain}</h2>
            <small>{[record.clientName, record.projectName].filter(Boolean).join(" · ") || "Sin cliente asignado"}</small>
          </div>
        </div>
        <div className="detail-actions">
          <IconButton label="Editar" icon={<Pencil size={17} />} onClick={() => onEdit(record)} />
          <IconButton label="Historial" icon={<History size={17} />} onClick={onOpenHistory} />
          {record.archived ? (
            <IconButton label="Restaurar" icon={<ArchiveRestore size={17} />} onClick={() => onRestore(record)} />
          ) : (
            <IconButton label="Archivar" icon={<Archive size={17} />} onClick={() => onArchive(record)} />
          )}
        </div>
      </div>

      <div className="quick-facts">
        <Fact icon={<CalendarClock size={17} />} label="Dominio" value={formatDate(record.domainExpiration)} />
        <Fact icon={<Server size={17} />} label="Hosting" value={formatDate(record.hosting.expirationDate)} />
        <Fact icon={<History size={17} />} label="Versiones" value={String(events.length)} />
      </div>

      {(record.clientName || record.projectName || record.contactName || record.contactEmail || record.contactPhone) && (
        <AccessGroup title="Cliente y contacto" icon={<User size={18} />}>
          <InfoLine label="Cliente" value={record.clientName} />
          <InfoLine label="Proyecto" value={record.projectName} />
          <InfoLine label="Contacto" value={record.contactName} />
          <InfoLine label="Rol" value={record.contactRole} />
          <SecretLine label="Correo" value={record.contactEmail} onCopy={onCopy} />
          <SecretLine label="Teléfono" value={record.contactPhone} onCopy={onCopy} />
        </AccessGroup>
      )}

      <AccessGroup title="Dominio / registrador" icon={<Globe2 size={18} />}>
        <InfoLine label="Proveedor" value={getProvider(record.providerId).label} />
        <SecretLine label="URL" value={record.registrarUrl} url onCopy={onCopy} />
        <SecretLine label="Usuario" value={record.registrarUsername} onCopy={onCopy} />
        <SecretLine label="Correo" value={record.registrarAccountEmail} onCopy={onCopy} />
        <SecretLine label="Contraseña" value={record.registrarPassword} secret onCopy={onCopy} />
      </AccessGroup>

      {record.hosting.enabled && (
        <AccessGroup title="Hosting" icon={<Server size={18} />}>
          <InfoLine label="Proveedor" value={getProvider(record.hosting.providerId).label} />
          <InfoLine label="Tipo" value={record.hosting.hostType} />
          <InfoLine label="Servidor" value={record.hosting.serverType} />
          <SecretLine label="Panel" value={record.hosting.panelUrl} url onCopy={onCopy} />
          <SecretLine label="Usuario" value={record.hosting.username} onCopy={onCopy} />
          <SecretLine label="Correo" value={record.hosting.accountEmail} onCopy={onCopy} />
          <SecretLine label="Contraseña" value={record.hosting.password} secret onCopy={onCopy} />
        </AccessGroup>
      )}

      {record.wordpress.enabled && (
        <AccessGroup title="WordPress" icon={<KeyRound size={18} />}>
          <SecretLine label="Admin" value={record.wordpress.adminUrl} url onCopy={onCopy} />
          <SecretLine label="Usuario" value={record.wordpress.username} onCopy={onCopy} />
          <SecretLine label="Correo código" value={record.wordpress.codeEmail} onCopy={onCopy} />
          <SecretLine label="Contraseña" value={record.wordpress.password} secret onCopy={onCopy} />
        </AccessGroup>
      )}

      {record.emailAccess.enabled && (
        <AccessGroup title="Correo principal" icon={<Mail size={18} />}>
          <SecretLine label="Panel" value={record.emailAccess.panelUrl} url onCopy={onCopy} />
          <SecretLine label="Correo" value={record.emailAccess.address} onCopy={onCopy} />
          <SecretLine label="Recuperación" value={record.emailAccess.recoveryEmail} onCopy={onCopy} />
          <SecretLine label="Contraseña" value={record.emailAccess.password} secret onCopy={onCopy} />
        </AccessGroup>
      )}

      {record.extraAccesses.map((access) => (
        <AccessGroup key={access.id} title={access.label || "Acceso adicional"} icon={<Link size={18} />}>
          <InfoLine label="Tipo" value={access.type} />
          <SecretLine label="URL" value={access.url} url onCopy={onCopy} />
          <SecretLine label="Usuario" value={access.username} onCopy={onCopy} />
          <SecretLine label="Correo" value={access.email} onCopy={onCopy} />
          <SecretLine label="Contraseña" value={access.password} secret onCopy={onCopy} />
        </AccessGroup>
      ))}

      {record.notes && (
        <div className="notes-box">
          <strong>Notas</strong>
          <p>{record.notes}</p>
        </div>
      )}
    </aside>
  );
};

const Fact = ({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) => (
  <div className="fact">
    {icon}
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const AccessGroup = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: JSX.Element;
  children: React.ReactNode;
}) => (
  <section className="access-group">
    <h3>
      {icon}
      {title}
    </h3>
    <div className="access-lines">{children}</div>
  </section>
);

const InfoLine = ({ label, value }: { label: string; value: string }) => {
  if (!value) {
    return null;
  }

  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
};

const SecretLine = ({
  label,
  value,
  secret = false,
  url = false,
  onCopy,
}: {
  label: string;
  value: string;
  secret?: boolean;
  url?: boolean;
  onCopy: (message: string) => void;
}) => {
  const [visible, setVisible] = useState(!secret);

  if (!value) {
    return null;
  }

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    onCopy(`${label} copiado.`);
  };

  return (
    <div className="info-line secret-line">
      <span>{label}</span>
      <strong>{visible ? value : "••••••••••••"}</strong>
      <div className="line-actions">
        {secret && (
          <button type="button" onClick={() => setVisible((current) => !current)} title={visible ? "Ocultar" : "Mostrar"}>
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        {url && (
          <a href={value} target="_blank" rel="noreferrer" title="Abrir">
            <ExternalLink size={15} />
          </a>
        )}
        <button type="button" onClick={() => void copy()} title="Copiar">
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
};

interface DomainFormProps {
  draft: DomainRecord;
  setDraft: React.Dispatch<React.SetStateAction<DomainRecord | null>>;
  onSave: () => Promise<void>;
  onClose: () => void;
}

const DomainForm = ({ draft, setDraft, onSave, onClose }: DomainFormProps) => {
  const patch = (updates: Partial<DomainRecord>) =>
    setDraft((current) =>
      current ? { ...current, ...updates, updatedAt: new Date().toISOString() } : current,
    );

  const patchHosting = (updates: Partial<HostingAccess>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            hosting: { ...current.hosting, ...updates },
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

  const patchWordPress = (updates: Partial<WordPressAccess>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            wordpress: { ...current.wordpress, ...updates },
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

  const patchEmail = (updates: Partial<EmailAccess>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            emailAccess: { ...current.emailAccess, ...updates },
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

  const patchExtra = (id: string, updates: Partial<ExtraAccess>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            extraAccesses: current.extraAccesses.map((access) =>
              access.id === id ? { ...access, ...updates } : access,
            ),
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

  const removeExtra = (id: string) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            extraAccesses: current.extraAccesses.filter((access) => access.id !== id),
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="domain-form">
        <header className="form-header">
          <div>
            <span>Partum Domains</span>
            <h2>{draft.domain ? `Editar ${draft.domain}` : "Nuevo dominio"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </header>

        <div className="form-body">
          <FormSection title="Dominio / registrador" icon={<Globe2 size={18} />}>
            <div className="form-grid two">
              <Field label="Dominio">
                <input value={draft.domain} onChange={(event) => patch({ domain: event.target.value })} placeholder="ejemplo.com" />
              </Field>
              <Field label="Cliente">
                <input value={draft.clientName} onChange={(event) => patch({ clientName: event.target.value })} placeholder="Nombre del cliente" />
              </Field>
              <Field label="Proyecto">
                <input value={draft.projectName} onChange={(event) => patch({ projectName: event.target.value })} placeholder="Nombre del proyecto" />
              </Field>
              <Field label="Contacto">
                <input value={draft.contactName} onChange={(event) => patch({ contactName: event.target.value })} placeholder="Persona responsable" />
              </Field>
              <Field label="Rol del contacto">
                <input value={draft.contactRole} onChange={(event) => patch({ contactRole: event.target.value })} placeholder="Dueño, marketing, sistemas..." />
              </Field>
              <Field label="Correo contacto">
                <input value={draft.contactEmail} onChange={(event) => patch({ contactEmail: event.target.value })} placeholder="contacto@cliente.com" />
              </Field>
              <Field label="Teléfono contacto">
                <input value={draft.contactPhone} onChange={(event) => patch({ contactPhone: event.target.value })} placeholder="+52..." />
              </Field>
              <Field label="Proveedor del dominio">
                <ProviderSelect value={draft.providerId} onChange={(providerId) => patch({ providerId })} />
              </Field>
              <Field label="Vence dominio">
                <input type="date" value={draft.domainExpiration} onChange={(event) => patch({ domainExpiration: event.target.value })} />
              </Field>
              <Field label="URL de acceso">
                <input value={draft.registrarUrl} onChange={(event) => patch({ registrarUrl: event.target.value })} placeholder="https://..." />
              </Field>
              <Field label="Correo de cuenta">
                <input value={draft.registrarAccountEmail} onChange={(event) => patch({ registrarAccountEmail: event.target.value })} placeholder="correo@dominio.com" />
              </Field>
              <Field label="Usuario">
                <input value={draft.registrarUsername} onChange={(event) => patch({ registrarUsername: event.target.value })} />
              </Field>
              <Field label="Contraseña">
                <PasswordInput value={draft.registrarPassword} onChange={(value) => patch({ registrarPassword: value })} />
              </Field>
              <Field label="Costo de renovación">
                <input value={draft.renewalCost} onChange={(event) => patch({ renewalCost: event.target.value })} placeholder="$0.00 MXN" />
              </Field>
              <Field label="Etiquetas">
                <input value={tagsToString(draft.tags)} onChange={(event) => patch({ tags: normalizeTags(event.target.value) })} placeholder="cliente, prioridad, mx" />
              </Field>
            </div>
            <div className="checkbox-grid">
              <Checkbox label="Dominio administrado por Partum" checked={draft.domainOwnedByUs} onChange={(value) => patch({ domainOwnedByUs: value })} />
              <Checkbox label="Renovación automática" checked={draft.autoRenew} onChange={(value) => patch({ autoRenew: value })} />
            </div>
          </FormSection>

          <FormSection title="Hosting" icon={<Server size={18} />}>
            <div className="checkbox-grid">
              <Checkbox label="Tiene hosting" checked={draft.hosting.enabled} onChange={(value) => patchHosting({ enabled: value })} />
              <Checkbox label="Host administrado por Partum" checked={draft.hosting.ownedByUs} onChange={(value) => patchHosting({ ownedByUs: value })} />
            </div>
            <div className="form-grid two">
              <Field label="Proveedor de hosting">
                <ProviderSelect value={draft.hosting.providerId} onChange={(providerId) => patchHosting({ providerId })} />
              </Field>
              <Field label="Tipo de host">
                <select value={draft.hosting.hostType} onChange={(event) => patchHosting({ hostType: event.target.value as HostingAccess["hostType"] })}>
                  {hostTypes.map((hostType) => (
                    <option key={hostType} value={hostType}>
                      {hostType}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo de servidor">
                <input value={draft.hosting.serverType} onChange={(event) => patchHosting({ serverType: event.target.value })} placeholder="Linux, LiteSpeed, Apache..." />
              </Field>
              <Field label="Vence hosting">
                <input type="date" value={draft.hosting.expirationDate} onChange={(event) => patchHosting({ expirationDate: event.target.value })} />
              </Field>
              <Field label="Panel / URL">
                <input value={draft.hosting.panelUrl} onChange={(event) => patchHosting({ panelUrl: event.target.value })} placeholder="https://..." />
              </Field>
              <Field label="Correo de acceso">
                <input value={draft.hosting.accountEmail} onChange={(event) => patchHosting({ accountEmail: event.target.value })} />
              </Field>
              <Field label="Usuario">
                <input value={draft.hosting.username} onChange={(event) => patchHosting({ username: event.target.value })} />
              </Field>
              <Field label="Contraseña">
                <PasswordInput value={draft.hosting.password} onChange={(value) => patchHosting({ password: value })} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="WordPress" icon={<KeyRound size={18} />}>
            <Checkbox label="Tiene acceso administrador de WordPress" checked={draft.wordpress.enabled} onChange={(value) => patchWordPress({ enabled: value })} />
            <div className="form-grid two">
              <Field label="URL admin">
                <input value={draft.wordpress.adminUrl} onChange={(event) => patchWordPress({ adminUrl: event.target.value })} placeholder="https://dominio.com/wp-admin" />
              </Field>
              <Field label="Correo para código">
                <input value={draft.wordpress.codeEmail} onChange={(event) => patchWordPress({ codeEmail: event.target.value })} />
              </Field>
              <Field label="Usuario">
                <input value={draft.wordpress.username} onChange={(event) => patchWordPress({ username: event.target.value })} />
              </Field>
              <Field label="Contraseña">
                <PasswordInput value={draft.wordpress.password} onChange={(value) => patchWordPress({ password: value })} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Correo principal" icon={<Mail size={18} />}>
            <Checkbox label="Tiene acceso al correo principal" checked={draft.emailAccess.enabled} onChange={(value) => patchEmail({ enabled: value })} />
            <div className="form-grid two">
              <Field label="Panel / webmail">
                <input value={draft.emailAccess.panelUrl} onChange={(event) => patchEmail({ panelUrl: event.target.value })} placeholder="https://..." />
              </Field>
              <Field label="Correo principal">
                <input value={draft.emailAccess.address} onChange={(event) => patchEmail({ address: event.target.value })} />
              </Field>
              <Field label="Correo recuperación">
                <input value={draft.emailAccess.recoveryEmail} onChange={(event) => patchEmail({ recoveryEmail: event.target.value })} />
              </Field>
              <Field label="Contraseña">
                <PasswordInput value={draft.emailAccess.password} onChange={(value) => patchEmail({ password: value })} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Accesos adicionales" icon={<Link size={18} />}>
            <div className="extra-access-list">
              {draft.extraAccesses.map((access) => (
                <div className="extra-access" key={access.id}>
                  <button className="mini-close" type="button" onClick={() => removeExtra(access.id)} aria-label="Quitar acceso">
                    <X size={15} />
                  </button>
                  <div className="form-grid two">
                    <Field label="Nombre">
                      <input value={access.label} onChange={(event) => patchExtra(access.id, { label: event.target.value })} placeholder="FTP, SSH, Analytics..." />
                    </Field>
                    <Field label="Tipo">
                      <input value={access.type} onChange={(event) => patchExtra(access.id, { type: event.target.value })} />
                    </Field>
                    <Field label="URL">
                      <input value={access.url} onChange={(event) => patchExtra(access.id, { url: event.target.value })} />
                    </Field>
                    <Field label="Correo">
                      <input value={access.email} onChange={(event) => patchExtra(access.id, { email: event.target.value })} />
                    </Field>
                    <Field label="Usuario">
                      <input value={access.username} onChange={(event) => patchExtra(access.id, { username: event.target.value })} />
                    </Field>
                    <Field label="Contraseña">
                      <PasswordInput value={access.password} onChange={(value) => patchExtra(access.id, { password: value })} />
                    </Field>
                  </div>
                  <Field label="Notas">
                    <textarea value={access.notes} onChange={(event) => patchExtra(access.id, { notes: event.target.value })} />
                  </Field>
                </div>
              ))}
            </div>
            <button className="ghost-button" type="button" onClick={() => patch({ extraAccesses: [...draft.extraAccesses, createExtraAccess()] })}>
              <Plus size={16} />
              Agregar acceso
            </button>
          </FormSection>

          <FormSection title="Notas" icon={<Pencil size={18} />}>
            <textarea className="notes-input" value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} placeholder="Notas internas, instrucciones de renovación, DNS, aclaraciones..." />
          </FormSection>
        </div>

        <footer className="form-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            <X size={16} />
            Cancelar
          </button>
          <button className="primary-button" type="button" onClick={() => void onSave()}>
            <Save size={17} />
            Guardar
          </button>
        </footer>
      </section>
    </div>
  );
};

const FormSection = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: JSX.Element;
  children: React.ReactNode;
}) => (
  <section className="form-section">
    <h3>
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const Checkbox = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label className="checkbox">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>
);

const PasswordInput = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        title={visible ? "Ocultar" : "Mostrar"}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button
        type="button"
        onClick={() => onChange(generatePassword())}
        title="Generar contraseña"
        aria-label="Generar contraseña"
      >
        <WandSparkles size={16} />
      </button>
    </div>
  );
};

const ProviderSelect = ({
  value,
  onChange,
}: {
  value: ProviderId;
  onChange: (providerId: ProviderId) => void;
}) => (
  <select value={value} onChange={(event) => onChange(event.target.value as ProviderId)}>
    {providers.map((provider) => (
      <option key={provider.id} value={provider.id}>
        {provider.label}
      </option>
    ))}
  </select>
);

interface HistoryPanelProps {
  record: DomainRecord;
  events: DecryptedVaultEvent[];
  onClose: () => void;
  onRestore: (record: DomainRecord) => Promise<void>;
}

const HistoryPanel = ({ record, events, onClose, onRestore }: HistoryPanelProps) => (
  <div className="modal-backdrop" role="dialog" aria-modal="true">
    <section className="history-panel">
      <header className="form-header">
        <div>
          <span>Historial inmutable</span>
          <h2>{record.domain}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={19} />
        </button>
      </header>
      <div className="history-list">
        {[...events].reverse().map((event, index) => (
          <article className="history-item" key={event.id}>
            <div>
              <span className={`status-pill ${event.type === "archive" ? "muted" : "success"}`}>
                {event.type === "upsert" ? "Guardado" : event.type === "archive" ? "Archivado" : "Restaurado"}
              </span>
              <strong>{formatDateTime(event.at)}</strong>
              <small>
                {event.record.providerId} · {event.record.hosting.providerId}
              </small>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void onRestore(event.record)}
              disabled={index === 0}
            >
              <RotateCcw size={16} />
              Restaurar
            </button>
          </article>
        ))}
      </div>
    </section>
  </div>
);

interface BackupPanelProps {
  settings: BackupSettings;
  snapshots: VaultBackupRecord[];
  backgroundBackups: boolean;
  onClose: () => void;
  onCreateNow: () => Promise<VaultBackupRecord>;
  onDownload: (record: VaultBackupRecord) => void;
  onIntervalChange: (intervalDays: BackupSettings["intervalDays"]) => Promise<void>;
  onEnabledChange: (enabled: boolean) => Promise<void>;
}

const BackupPanel = ({
  settings,
  snapshots,
  backgroundBackups,
  onClose,
  onCreateNow,
  onDownload,
  onIntervalChange,
  onEnabledChange,
}: BackupPanelProps) => (
  <div className="modal-backdrop" role="dialog" aria-modal="true">
    <section className="history-panel backup-panel">
      <header className="form-header">
        <div>
          <span>Respaldos cifrados</span>
          <h2>Backups automáticos</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
          <X size={19} />
        </button>
      </header>

      <div className="backup-body">
        <div className="backup-summary">
          <div>
            <strong>{settings.enabled ? "Activo" : "Pausado"}</strong>
            <span>Cada {settings.intervalDays} días</span>
          </div>
          <div>
            <strong>{settings.nextRunAt ? formatDateTime(settings.nextRunAt) : "Pendiente"}</strong>
            <span>Próximo intento</span>
          </div>
        </div>

        <div className="inline-alert info">
          <ShieldCheck size={16} />
          {backgroundBackups
            ? "El navegador aceptó background sync periódico. También se revisa al abrir la app."
            : "Este navegador no garantiza tareas con la app cerrada. Se hará al abrir la PWA y cuando el navegador lo permita."}
        </div>

        <div className="backup-controls">
          <Checkbox
            label="Crear backups automáticos"
            checked={settings.enabled}
            onChange={(value) => void onEnabledChange(value)}
          />
          <label className="field">
            <span>Frecuencia</span>
            <select
              value={settings.intervalDays}
              onChange={(event) =>
                void onIntervalChange(Number(event.target.value) as BackupSettings["intervalDays"])
              }
            >
              <option value={7}>Cada semana</option>
              <option value={15}>Cada 15 días</option>
              <option value={30}>Cada mes</option>
            </select>
          </label>
          <button className="primary-button" type="button" onClick={() => void onCreateNow()}>
            <Database size={17} />
            Crear backup ahora
          </button>
        </div>

        <div className="history-list compact">
          {snapshots.map((record) => (
            <article className="history-item" key={record.id}>
              <div>
                <span className="status-pill success">
                  {record.reason === "manual"
                    ? "Manual"
                    : record.reason === "periodic-sync"
                      ? "Background"
                      : "Automático"}
                </span>
                <strong>{formatDateTime(record.createdAt)}</strong>
                <small>
                  {record.eventCount} eventos · {(record.sizeBytes / 1024).toFixed(1)} KB
                </small>
              </div>
              <button className="ghost-button" type="button" onClick={() => onDownload(record)}>
                <Download size={16} />
                Descargar
              </button>
            </article>
          ))}
          {snapshots.length === 0 && (
            <div className="empty-state slim">
              <Database size={28} />
              <strong>Aún no hay backups guardados.</strong>
            </div>
          )}
        </div>
      </div>
    </section>
  </div>
);

interface CredentialReminderProps {
  username: string;
  password: string;
  onClose: () => void;
  onToast: (message: string) => void;
}

const CredentialReminder = ({
  username,
  password,
  onClose,
  onToast,
}: CredentialReminderProps) => {
  const content = [
    "Partum Domains - acceso de bóveda",
    "",
    `Usuario: ${username}`,
    `Contraseña maestra: ${password}`,
    "",
    "Guarda esta información en un lugar seguro.",
    "Si pierdes el usuario o la contraseña maestra, por seguridad tendrás que reiniciar la bóveda local.",
    "Partum Domains no puede recuperar contraseñas maestras.",
  ].join("\n");

  const copyCredentials = async () => {
    await navigator.clipboard.writeText(content);
    onToast("Usuario y contraseña copiados.");
  };

  const downloadCredentials = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const linkElement = document.createElement("a");
    linkElement.href = url;
    linkElement.download = `partum-domains-acceso-${new Date().toISOString().slice(0, 10)}.txt`;
    linkElement.click();
    URL.revokeObjectURL(url);
    onToast("TXT de acceso descargado.");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="credential-reminder">
        <div className="credential-icon">
          <ShieldCheck size={30} />
        </div>
        <span>Guarda tu acceso</span>
        <h2>Esta es tu llave de bóveda</h2>
        <p>
          Guarda tu usuario y contraseña maestra ahora. Si los pierdes, tendrás que reiniciar la
          bóveda local por seguridad.
        </p>

        <div className="credential-display">
          <div>
            <small>Usuario</small>
            <strong>{username}</strong>
          </div>
          <div>
            <small>Contraseña maestra</small>
            <strong>{password}</strong>
          </div>
        </div>

        <div className="credential-actions">
          <button className="ghost-button" type="button" onClick={() => void copyCredentials()}>
            <Copy size={16} />
            Copiar
          </button>
          <button className="ghost-button" type="button" onClick={downloadCredentials}>
            <Download size={16} />
            Descargar TXT
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            <ShieldCheck size={17} />
            Ya lo guardé
          </button>
        </div>
      </section>
    </div>
  );
};

export default App;
