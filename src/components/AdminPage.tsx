import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Flame,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlink,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useApp } from '../context/AppContext';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  APPS_SCRIPT_TEMPLATE,
  SheetsAuthError,
  createUtilitySpreadsheet,
  extractSpreadsheetId,
  fetchSpreadsheetMetadata,
  isValidAppsScriptUrl,
  readSheetPreview,
  syncViaAppsScriptWebhook,
} from '../services/googleSheets';
import {
  type CompanyItem,
  type UserProfile,
  type UserRole,
  type UserStatus,
} from '../types';
import { formatEquipmentSummary } from '../utils/equipment';
import { formatDateTime, formatNumber, toSafeFirestoreId } from '../utils/formatters';
import { CompanyEquipmentEditor } from './CompanyEquipmentEditor';
import { GoogleSignInButton } from './GoogleSignInButton';
import { GoogleSheetsSyncModal } from './GoogleSheetsSyncModal';

type AdminTab = 'users' | 'companies' | 'utilities' | 'sheets';

const STATUS_LABELS: Record<UserStatus, { text: string; className: string }> = {
  pending: { text: 'Pending', className: 'text-amber-700 font-semibold' },
  approved: { text: 'Approved', className: 'text-emerald-700 font-semibold' },
  rejected: { text: 'Rejected', className: 'text-rose-700 font-semibold' },
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  entry: 'Data Entry',
  viewer: 'Viewer',
};

export function AdminPage() {
  const {
    user,
    allUsers,
    companies,
    utilities,
    entries,
    sheetsConfig,
    googleAccessToken,
    adminUpdateUser,
    syncPublicCompanies,
    connectGoogleSheets,
    clearGoogleToken,
    saveSheetsConfig,
    removeSheetsConfig,
    syncEntriesToConnectedSheet,
    importEntriesFromConnectedSheet,
    seedDefaultsIfNeeded,
  } = useApp();

  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [expandedUserUids, setExpandedUserUids] = useState<Record<string, boolean>>({});
  const [editingProfileUid, setEditingProfileUid] = useState<string | null>(null);
  const [userProfileDraft, setUserProfileDraft] = useState<{
    name: string;
    organizationSelect: string;
    customOrganization: string;
    department: string;
    designation: string;
    phone: string;
    employeeId: string;
  }>({
    name: '',
    organizationSelect: '',
    customOrganization: '',
    department: '',
    designation: '',
    phone: '',
    employeeId: '',
  });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Company management state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState('');
  const [confirmDeleteCompanyId, setConfirmDeleteCompanyId] = useState<string | null>(null);
  const [confirmPurgeOrphan, setConfirmPurgeOrphan] = useState<string | null>(null);
  const [migrateTargets, setMigrateTargets] = useState<Record<string, string>>({});
  const [companyBusy, setCompanyBusy] = useState(false);

  // Plant equipment & grid power editor state (keyed by `${scopeKey}::${companyId}`)
  const [openEquipKey, setOpenEquipKey] = useState<string | null>(null);

  // Utility management state
  const [newUtilName, setNewUtilName] = useState('');
  const [newUtilUnit, setNewUtilUnit] = useState('');
  const [newUtilColor, setNewUtilColor] = useState('#0F766E');
  const [editingUtilId, setEditingUtilId] = useState<string | null>(null);
  const [editUtilName, setEditUtilName] = useState('');
  const [editUtilUnit, setEditUtilUnit] = useState('');
  const [editUtilColor, setEditUtilColor] = useState('#0F766E');
  const [confirmDeleteUtilId, setConfirmDeleteUtilId] = useState<string | null>(null);
  const [utilBusy, setUtilBusy] = useState(false);

  // Google Sheets state
  const [sheetsBusy, setSheetsBusy] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState('Utility Hub — Daily Utility Records');
  const [existingSheetInput, setExistingSheetInput] = useState('');
  const [discoveredMeta, setDiscoveredMeta] = useState<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    spreadsheetTitle: string;
    sheetNames: string[];
  } | null>(null);
  const [selectedTabName, setSelectedTabName] = useState('');
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [importingSheets, setImportingSheets] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[][] | null>(null);
  const [appsScriptUrl, setAppsScriptUrl] = useState('');
  const [appsScriptSheetUrl, setAppsScriptSheetUrl] = useState('');
  const [appsScriptTitle, setAppsScriptTitle] = useState('Utility Hub — Google Sheet');
  const [appsScriptTab, setAppsScriptTab] = useState('Master_Backup');
  const [copiedScript, setCopiedScript] = useState(false);
  const [showAppsScriptUpgrade, setShowAppsScriptUpgrade] = useState(false);

  const sortedUsers = useMemo(() => {
    const rank: Record<UserStatus, number> = {
      pending: 0,
      approved: 1,
      rejected: 2,
    };
    return [...allUsers].sort((a, b) => {
      const rDiff = rank[a.status] - rank[b.status];
      if (rDiff !== 0) return rDiff;
      const tA = a.createdAt?.toMillis() ?? 0;
      const tB = b.createdAt?.toMillis() ?? 0;
      return tB - tA;
    });
  }, [allUsers]);

  const pendingCount = useMemo(
    () => allUsers.filter((u) => u.status === 'pending').length,
    [allUsers]
  );

  const utilityEntryCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.utilityId, (map.get(e.utilityId) || 0) + 1);
    }
    return map;
  }, [entries]);

  const orphanedCompanyStats = useMemo(() => {
    const activeNames = new Set(companies.map((c) => c.name));
    const entryCountMap = new Map<string, number>();

    for (const e of entries) {
      if (e.company && !activeNames.has(e.company)) {
        entryCountMap.set(e.company, (entryCountMap.get(e.company) || 0) + 1);
      }
    }
    for (const u of allUsers) {
      for (const name of [...u.companies, ...u.viewCompanies]) {
        if (name && !activeNames.has(name) && !entryCountMap.has(name)) {
          entryCountMap.set(name, 0);
        }
      }
    }

    return Array.from(entryCountMap.entries())
      .map(([name, entryCount]) => ({ name, entryCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, entries, allUsers]);

  const updateUserRecord = async (
    target: UserProfile,
    updates: Partial<
      Pick<
        UserProfile,
        | 'status'
        | 'role'
        | 'companies'
        | 'viewCompanies'
        | 'allowedUtilities'
        | 'name'
        | 'organization'
        | 'department'
        | 'designation'
        | 'phone'
        | 'employeeId'
      >
    >,
    successText: string
  ) => {
    if (
      target.uid === user?.uid &&
      (updates.status !== undefined || updates.role !== undefined)
    ) {
      setToast({
        type: 'error',
        text: 'You cannot demote or reject your own account.',
      });
      return;
    }

    setBusyUid(target.uid);
    setToast(null);
    try {
      await adminUpdateUser(target, updates);
      setToast({ type: 'success', text: successText });
    } catch (error) {
      setToast({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update user.',
      });
    } finally {
      setBusyUid(null);
    }
  };

  const handleOpenUserProfileEditor = (target: UserProfile) => {
    if (editingProfileUid === target.uid) {
      setEditingProfileUid(null);
      return;
    }
    const org = (target.organization || '').trim();
    const companyNames = companies.map((c) => c.name);
    setEditingProfileUid(target.uid);
    setUserProfileDraft({
      name: target.name || '',
      organizationSelect:
        !org || companyNames.includes(org) ? org : '__other__',
      customOrganization:
        !org || companyNames.includes(org) ? '' : org,
      department: target.department || '',
      designation: target.designation || '',
      phone: target.phone || '',
      employeeId: target.employeeId || '',
    });
  };

  const handleSaveUserProfileDetails = async (target: UserProfile) => {
    const cleanName = userProfileDraft.name.trim();
    if (!cleanName) {
      setToast({ type: 'error', text: 'User name cannot be empty.' });
      return;
    }
    const resolvedOrg =
      userProfileDraft.organizationSelect === '__other__'
        ? userProfileDraft.customOrganization.trim()
        : userProfileDraft.organizationSelect.trim();

    await updateUserRecord(
      target,
      {
        name: cleanName,
        organization: resolvedOrg,
        department: userProfileDraft.department.trim(),
        designation: userProfileDraft.designation.trim(),
        phone: userProfileDraft.phone.trim(),
        employeeId: userProfileDraft.employeeId.trim(),
      },
      `Updated profile information for ${cleanName}.`
    );
    setEditingProfileUid(null);
  };

  const handleToggleAllowedUtility = async (
    target: UserProfile,
    utilityId: string
  ) => {
    const raw = target.allowedUtilities || [];
    const allIds = utilities.map((u) => u.id);
    // [] means all utilities allowed; ['__none__'] means explicitly 0 utilities allowed.
    const baseList =
      raw.length === 0
        ? allIds
        : raw.filter((id) => id !== '__none__');
    const exists = baseList.includes(utilityId);
    const nextList = exists
      ? baseList.filter((id) => id !== utilityId)
      : [...baseList, utilityId];

    // If all utilities are selected again, store [] to mean "All utilities";
    // if 0 utilities remain selected, store ['__none__'] so dashboard stays restricted.
    const normalized =
      nextList.length === 0
        ? ['__none__']
        : nextList.length === allIds.length &&
          allIds.every((id) => nextList.includes(id))
        ? []
        : nextList;

    await updateUserRecord(
      target,
      { allowedUtilities: normalized },
      `Updated visible utilities for ${target.name}.`
    );
  };

  const handleSetAllowedUtilities = async (
    target: UserProfile,
    nextIds: string[],
    label: string
  ) => {
    await updateUserRecord(
      target,
      { allowedUtilities: nextIds },
      `${label} for ${target.name}.`
    );
  };

  const handleOpenEquipmentEditor = (scopeKey: string, company: CompanyItem) => {
    const fullKey = `${scopeKey}::${company.id}`;
    setOpenEquipKey((prev) => (prev === fullKey ? null : fullKey));
  };

  const handleToggleEntryCompany = async (target: UserProfile, companyName: string) => {
    const exists = target.companies.includes(companyName);
    const nextCompanies = exists
      ? target.companies.filter((c) => c !== companyName)
      : [...target.companies, companyName];

    const nextViewCompanies =
      !exists && !target.viewCompanies.includes(companyName)
        ? [...target.viewCompanies, companyName]
        : target.viewCompanies;

    await updateUserRecord(
      target,
      { companies: nextCompanies, viewCompanies: nextViewCompanies },
      `Updated entry factory permissions for ${target.name}.`
    );
  };

  const handleToggleViewCompany = async (target: UserProfile, companyName: string) => {
    const exists = target.viewCompanies.includes(companyName);
    const nextView = exists
      ? target.viewCompanies.filter((c) => c !== companyName)
      : [...target.viewCompanies, companyName];

    await updateUserRecord(
      target,
      { viewCompanies: nextView },
      `Updated view factory permissions for ${target.name}.`
    );
  };

  const handleSetViewCompanies = async (
    target: UserProfile,
    nextView: string[],
    label: string
  ) => {
    await updateUserRecord(
      target,
      { viewCompanies: nextView },
      `${label} for ${target.name}.`
    );
  };

  const handleSetEntryCompanies = async (
    target: UserProfile,
    nextCompanies: string[],
    label: string
  ) => {
    const mergedView = Array.from(
      new Set([...target.viewCompanies, ...nextCompanies])
    );
    await updateUserRecord(
      target,
      { companies: nextCompanies, viewCompanies: mergedView },
      `${label} for ${target.name}.`
    );
  };

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCompanyName.trim();
    if (!trimmed || !user) return;
    if (companies.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setToast({ type: 'error', text: 'A company with this name already exists.' });
      return;
    }

    setCompanyBusy(true);
    setToast(null);
    const id = toSafeFirestoreId('comp', `${trimmed}_${Date.now()}`);
    try {
      await setDoc(doc(db, 'companies', id), {
        name: trimmed.slice(0, 100),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await syncPublicCompanies([...companies.map((c) => c.name), trimmed.slice(0, 100)]);
      setNewCompanyName('');
      setToast({ type: 'success', text: `Added company "${trimmed}".` });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `companies/${id}`);
    } finally {
      setCompanyBusy(false);
    }
  };

  const migrateCompanyReferences = async (oldName: string, newName: string) => {
    // 1. Migrate all historical utilityEntries from oldName -> newName
    const entriesSnap = await getDocs(
      query(collection(db, 'utilityEntries'), where('company', '==', oldName))
    );
    let migratedEntriesCount = 0;
    for (let i = 0; i < entriesSnap.docs.length; i += 400) {
      const chunk = entriesSnap.docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const entryDoc of chunk) {
        batch.update(entryDoc.ref, {
          company: newName,
          updatedAt: serverTimestamp(),
        });
        migratedEntriesCount += 1;
      }
      await batch.commit();
    }

    // 1b. Migrate historical generationEntries from oldName -> newName
    const genSnap = await getDocs(
      query(collection(db, 'generationEntries'), where('company', '==', oldName))
    );
    for (let i = 0; i < genSnap.docs.length; i += 400) {
      const chunk = genSnap.docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const genDoc of chunk) {
        batch.update(genDoc.ref, {
          company: newName,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    // 2. Migrate user entry, view, and organization references containing oldName
    let updatedUsersCount = 0;
    for (const u of allUsers) {
      const hasEntry = u.companies.includes(oldName);
      const hasView = u.viewCompanies.includes(oldName);
      const hasOrg = (u.organization || '') === oldName;
      if (!hasEntry && !hasView && !hasOrg) continue;

      const nextCompanies = hasEntry
        ? Array.from(new Set(u.companies.map((c) => (c === oldName ? newName : c))))
        : u.companies;
      const nextView = hasView
        ? Array.from(new Set(u.viewCompanies.map((c) => (c === oldName ? newName : c))))
        : u.viewCompanies;

      await adminUpdateUser(u, {
        ...(hasEntry ? { companies: nextCompanies } : {}),
        ...(hasView ? { viewCompanies: nextView } : {}),
        ...(hasOrg ? { organization: newName } : {}),
      });
      updatedUsersCount += 1;
    }

    // 3. Migrate saved per-user unit rates from oldName -> newName (deduplicating conflicts)
    let updatedRatesCount = 0;
    for (const u of allUsers) {
      const allUserRatesSnap = await getDocs(
        collection(db, 'users', u.uid, 'unitRates')
      );
      if (allUserRatesSnap.empty) continue;

      const existingTargetUtils = new Set<string>();
      const oldRateDocs: typeof allUserRatesSnap.docs = [];
      for (const rateDoc of allUserRatesSnap.docs) {
        const data = rateDoc.data() as { company?: string; utilityId?: string };
        if (data.company === newName && data.utilityId) {
          existingTargetUtils.add(data.utilityId);
        } else if (data.company === oldName) {
          oldRateDocs.push(rateDoc);
        }
      }

      for (let i = 0; i < oldRateDocs.length; i += 400) {
        const chunk = oldRateDocs.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const rateDoc of chunk) {
          const data = rateDoc.data() as { utilityId?: string };
          if (data.utilityId && existingTargetUtils.has(data.utilityId)) {
            batch.delete(rateDoc.ref);
          } else {
            if (data.utilityId) existingTargetUtils.add(data.utilityId);
            batch.update(rateDoc.ref, {
              company: newName,
              updatedAt: serverTimestamp(),
            });
          }
          updatedRatesCount += 1;
        }
        await batch.commit();
      }
    }

    // 4. Sync renamed entries to Google Sheets and prune old factory-month tabs
    let sheetSuffix = '';
    if (
      sheetsConfig &&
      (sheetsConfig.syncMode === 'appsScript' || Boolean(googleAccessToken))
    ) {
      try {
        const updatedEntries = entries.map((e) =>
          e.company === oldName ? { ...e, company: newName } : e
        );
        await syncEntriesToConnectedSheet(updatedEntries, undefined, true);
        sheetSuffix = ' Google Sheets updated.';
      } catch (sheetErr) {
        const msg =
          sheetErr instanceof Error ? sheetErr.message : 'Google Sheets sync failed.';
        sheetSuffix = ` (Note: Google Sheets sync skipped: ${msg})`;
      }
    } else if (sheetsConfig) {
      sheetSuffix = ' Click "Sync All Entries" in Google Sheets tab to update sheet tabs.';
    }

    return {
      migratedEntriesCount,
      updatedUsersCount,
      updatedRatesCount,
      sheetSuffix,
    };
  };

  const purgeCompanyReferences = async (companyName: string) => {
    // 1. Delete all historical utilityEntries belonging to companyName
    const entriesSnap = await getDocs(
      query(collection(db, 'utilityEntries'), where('company', '==', companyName))
    );
    let deletedEntriesCount = 0;
    for (let i = 0; i < entriesSnap.docs.length; i += 400) {
      const chunk = entriesSnap.docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const entryDoc of chunk) {
        batch.delete(entryDoc.ref);
        deletedEntriesCount += 1;
      }
      await batch.commit();
    }

    // 1b. Delete historical generationEntries belonging to companyName
    const genSnap = await getDocs(
      query(collection(db, 'generationEntries'), where('company', '==', companyName))
    );
    for (let i = 0; i < genSnap.docs.length; i += 400) {
      const chunk = genSnap.docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const genDoc of chunk) {
        batch.delete(genDoc.ref);
      }
      await batch.commit();
    }

    // 2. Remove companyName from every user's entry & view permissions
    let updatedUsersCount = 0;
    for (const u of allUsers) {
      if (
        !u.companies.includes(companyName) &&
        !u.viewCompanies.includes(companyName)
      ) {
        continue;
      }
      await adminUpdateUser(u, {
        companies: u.companies.filter((c) => c !== companyName),
        viewCompanies: u.viewCompanies.filter((c) => c !== companyName),
      });
      updatedUsersCount += 1;
    }

    // 3. Delete saved per-user unitRates for companyName
    let deletedRatesCount = 0;
    for (const u of allUsers) {
      const ratesSnap = await getDocs(
        query(collection(db, 'users', u.uid, 'unitRates'), where('company', '==', companyName))
      );
      if (ratesSnap.empty) continue;
      for (let i = 0; i < ratesSnap.docs.length; i += 400) {
        const chunk = ratesSnap.docs.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const rateDoc of chunk) {
          batch.delete(rateDoc.ref);
          deletedRatesCount += 1;
        }
        await batch.commit();
      }
    }

    // 4. Prune removed factory rows and monthly tabs from connected Google Sheet
    let sheetSuffix = '';
    if (
      sheetsConfig &&
      (sheetsConfig.syncMode === 'appsScript' || Boolean(googleAccessToken))
    ) {
      try {
        const remainingEntries = entries.filter((e) => e.company !== companyName);
        await syncEntriesToConnectedSheet(remainingEntries, undefined, true);
        sheetSuffix = ' Google Sheets updated.';
      } catch (sheetErr) {
        const msg =
          sheetErr instanceof Error ? sheetErr.message : 'Google Sheets sync failed.';
        sheetSuffix = ` (Note: Google Sheets sync skipped: ${msg})`;
      }
    } else if (sheetsConfig) {
      sheetSuffix = ' Click "Sync All Entries" in Google Sheets tab to remove its old sheet tabs.';
    }

    return {
      deletedEntriesCount,
      updatedUsersCount,
      deletedRatesCount,
      sheetSuffix,
    };
  };

  const handleSaveCompanyEdit = async (companyId: string) => {
    const targetCompany = companies.find((c) => c.id === companyId);
    if (!targetCompany) return;

    const oldName = targetCompany.name;
    const newName = editingCompanyName.trim().slice(0, 100);
    if (!newName) return;

    if (
      companies.some(
        (c) => c.id !== companyId && c.name.toLowerCase() === newName.toLowerCase()
      )
    ) {
      setToast({ type: 'error', text: 'A company with this name already exists.' });
      return;
    }

    if (oldName === newName) {
      setEditingCompanyId(null);
      return;
    }

    setCompanyBusy(true);
    setToast(null);
    try {
      await updateDoc(doc(db, 'companies', companyId), {
        name: newName,
      });
      await syncPublicCompanies(
        companies.map((c) => (c.id === companyId ? newName : c.name))
      );

      const res = await migrateCompanyReferences(oldName, newName);
      setEditingCompanyId(null);
      setToast({
        type: 'success',
        text: `Renamed "${oldName}" to "${newName}" (${formatNumber(
          res.migratedEntriesCount,
          0
        )} entries, ${formatNumber(res.updatedUsersCount, 0)} users, ${formatNumber(
          res.updatedRatesCount,
          0
        )} saved rates updated).${res.sheetSuffix}`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `companies/${companyId}`);
    } finally {
      setCompanyBusy(false);
    }
  };

  const handleMergeOrphanedCompany = async (oldName: string) => {
    const targetName = migrateTargets[oldName] || companies[0]?.name || '';
    if (!targetName || targetName === oldName) return;

    setCompanyBusy(true);
    setToast(null);
    try {
      const res = await migrateCompanyReferences(oldName, targetName);
      setToast({
        type: 'success',
        text: `Migrated "${oldName}" into "${targetName}" (${formatNumber(
          res.migratedEntriesCount,
          0
        )} entries, ${formatNumber(res.updatedUsersCount, 0)} users, ${formatNumber(
          res.updatedRatesCount,
          0
        )} saved rates updated).${res.sheetSuffix}`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'utilityEntries');
    } finally {
      setCompanyBusy(false);
    }
  };

  const handlePurgeOrphanedCompany = async (companyName: string) => {
    setCompanyBusy(true);
    setToast(null);
    try {
      const res = await purgeCompanyReferences(companyName);
      setConfirmPurgeOrphan(null);
      setToast({
        type: 'success',
        text: `Permanently removed "${companyName}" (${formatNumber(
          res.deletedEntriesCount,
          0
        )} entries, ${formatNumber(res.deletedRatesCount, 0)} saved rates deleted, ${formatNumber(
          res.updatedUsersCount,
          0
        )} users updated).${res.sheetSuffix}`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'utilityEntries');
    } finally {
      setCompanyBusy(false);
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    const targetCompany = companies.find((c) => c.id === companyId);
    const deletedName = targetCompany?.name || '';
    setCompanyBusy(true);
    setToast(null);
    try {
      await deleteDoc(doc(db, 'companies', companyId));
      await syncPublicCompanies(
        companies.filter((c) => c.id !== companyId).map((c) => c.name)
      );
      let purgeSummary = '';
      if (deletedName) {
        const res = await purgeCompanyReferences(deletedName);
        purgeSummary = ` (${formatNumber(
          res.deletedEntriesCount,
          0
        )} historical entries & ${formatNumber(
          res.deletedRatesCount,
          0
        )} saved rates purged).${res.sheetSuffix}`;
      }
      setConfirmDeleteCompanyId(null);
      setToast({
        type: 'success',
        text: `Deleted "${deletedName || 'Company'}"${purgeSummary}`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `companies/${companyId}`);
    } finally {
      setCompanyBusy(false);
    }
  };

  const handleAddUtility = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newUtilName.trim();
    const unit = newUtilUnit.trim();
    const color = newUtilColor.trim();
    if (!name || !unit || !user) return;

    if (utilities.some((u) => u.name.trim().toLowerCase() === name.toLowerCase())) {
      setToast({
        type: 'error',
        text: 'A utility with this name already exists.',
      });
      return;
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      setToast({
        type: 'error',
        text: 'Please enter a valid 6-digit hex color (e.g. #E0A100).',
      });
      return;
    }

    setUtilBusy(true);
    setToast(null);
    const id = toSafeFirestoreId('util', `${name}_${Date.now()}`);
    const nextOrder =
      utilities.reduce((max, u) => Math.max(max, u.order), 0) + 1;

    try {
      await setDoc(doc(db, 'utilities', id), {
        name: name.slice(0, 80),
        unit: unit.slice(0, 30),
        color: color.toUpperCase(),
        order: nextOrder,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setNewUtilName('');
      setNewUtilUnit('');
      setNewUtilColor('#0F766E');
      setToast({ type: 'success', text: `Added utility "${name}".` });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `utilities/${id}`);
    } finally {
      setUtilBusy(false);
    }
  };

  const handleSaveUtilEdit = async (utilId: string) => {
    const name = editUtilName.trim().slice(0, 80);
    const unit = editUtilUnit.trim().slice(0, 30);
    const color = editUtilColor.trim();
    if (!name || !unit) return;

    if (
      utilities.some(
        (u) => u.id !== utilId && u.name.trim().toLowerCase() === name.toLowerCase()
      )
    ) {
      setToast({
        type: 'error',
        text: 'A utility with this name already exists.',
      });
      return;
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      setToast({
        type: 'error',
        text: 'Please enter a valid 6-digit hex color (e.g. #2F6FDE).',
      });
      return;
    }

    const existingUtil = utilities.find((u) => u.id === utilId);
    const metadataChanged =
      !existingUtil || existingUtil.name !== name || existingUtil.unit !== unit;

    setUtilBusy(true);
    setToast(null);
    try {
      await updateDoc(doc(db, 'utilities', utilId), {
        name,
        unit,
        color: color.toUpperCase(),
      });

      let updatedEntriesCount = 0;
      if (metadataChanged) {
        const entriesSnap = await getDocs(
          query(collection(db, 'utilityEntries'), where('utilityId', '==', utilId))
        );
        for (let i = 0; i < entriesSnap.docs.length; i += 400) {
          const chunk = entriesSnap.docs.slice(i, i + 400);
          const batch = writeBatch(db);
          for (const entryDoc of chunk) {
            batch.update(entryDoc.ref, {
              utilityName: name,
              unit,
              updatedAt: serverTimestamp(),
            });
            updatedEntriesCount += 1;
          }
          await batch.commit();
        }
      }

      let sheetSuffix = '';
      if (
        metadataChanged &&
        sheetsConfig &&
        (sheetsConfig.syncMode === 'appsScript' || Boolean(googleAccessToken))
      ) {
        try {
          const updatedUtilities = utilities.map((u) =>
            u.id === utilId ? { ...u, name, unit, color: color.toUpperCase() } : u
          );
          const updatedEntries = entries.map((e) =>
            e.utilityId === utilId ? { ...e, utilityName: name, unit } : e
          );
          await syncEntriesToConnectedSheet(
            updatedEntries,
            undefined,
            false,
            updatedUtilities
          );
          sheetSuffix = ' Google Sheets updated.';
        } catch (sheetErr) {
          const msg =
            sheetErr instanceof Error ? sheetErr.message : 'Google Sheets sync failed.';
          sheetSuffix = ` (Note: Google Sheets sync skipped: ${msg})`;
        }
      }

      setEditingUtilId(null);
      setToast({
        type: 'success',
        text:
          (updatedEntriesCount > 0
            ? `Utility updated (${formatNumber(updatedEntriesCount, 0)} entries updated).`
            : 'Utility updated.') + sheetSuffix,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `utilities/${utilId}`);
    } finally {
      setUtilBusy(false);
    }
  };

  const handleDeleteUtility = async (utilId: string) => {
    const targetUtil = utilities.find((u) => u.id === utilId);
    setUtilBusy(true);
    setToast(null);
    try {
      await deleteDoc(doc(db, 'utilities', utilId));

      // Purge all historical utilityEntries referencing this deleted utility
      const entriesSnap = await getDocs(
        query(collection(db, 'utilityEntries'), where('utilityId', '==', utilId))
      );
      let deletedEntriesCount = 0;
      for (let i = 0; i < entriesSnap.docs.length; i += 400) {
        const chunk = entriesSnap.docs.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const entryDoc of chunk) {
          batch.delete(entryDoc.ref);
          deletedEntriesCount += 1;
        }
        await batch.commit();
      }

      // Delete saved per-user unitRates referencing this utility
      let deletedRatesCount = 0;
      for (const u of allUsers) {
        const ratesSnap = await getDocs(
          query(collection(db, 'users', u.uid, 'unitRates'), where('utilityId', '==', utilId))
        );
        if (ratesSnap.empty) continue;
        for (let i = 0; i < ratesSnap.docs.length; i += 400) {
          const chunk = ratesSnap.docs.slice(i, i + 400);
          const batch = writeBatch(db);
          for (const rateDoc of chunk) {
            batch.delete(rateDoc.ref);
            deletedRatesCount += 1;
          }
          await batch.commit();
        }
      }

      let sheetSuffix = '';
      if (
        sheetsConfig &&
        (sheetsConfig.syncMode === 'appsScript' || Boolean(googleAccessToken))
      ) {
        try {
          const remainingUtilities = utilities.filter((u) => u.id !== utilId);
          const remainingEntries = entries.filter((e) => e.utilityId !== utilId);
          await syncEntriesToConnectedSheet(
            remainingEntries,
            undefined,
            true,
            remainingUtilities
          );
          sheetSuffix = ' Google Sheets updated.';
        } catch (sheetErr) {
          const msg =
            sheetErr instanceof Error ? sheetErr.message : 'Google Sheets sync failed.';
          sheetSuffix = ` (Note: Google Sheets sync skipped: ${msg})`;
        }
      } else if (sheetsConfig && deletedEntriesCount > 0) {
        sheetSuffix = ' Click "Sync All Entries" in Google Sheets tab to update sheet tabs.';
      }

      setConfirmDeleteUtilId(null);
      setToast({
        type: 'success',
        text: `Deleted "${targetUtil?.name || 'Utility'}"${
          deletedEntriesCount > 0 || deletedRatesCount > 0
            ? ` (${formatNumber(deletedEntriesCount, 0)} entries & ${formatNumber(
                deletedRatesCount,
                0
              )} saved rates purged)`
            : ''
        }.${sheetSuffix}`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `utilities/${utilId}`);
    } finally {
      setUtilBusy(false);
    }
  };

  const handleSeedDefaults = async (label: string) => {
    setCompanyBusy(true);
    setUtilBusy(true);
    setToast(null);
    try {
      await seedDefaultsIfNeeded(true);
      setToast({ type: 'success', text: `Seeded default ${label}.` });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : `Failed to seed default ${label}.`,
      });
    } finally {
      setCompanyBusy(false);
      setUtilBusy(false);
    }
  };

  // Google Sheets Handlers
  const ensureToken = async (): Promise<string> => {
    if (googleAccessToken) return googleAccessToken;
    return connectGoogleSheets();
  };

  const handleAuthorizeGoogle = async () => {
    setSheetsBusy(true);
    setToast(null);
    try {
      await connectGoogleSheets();
      setToast({ type: 'success', text: 'Google Sheets authorization connected.' });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to connect Google Sheets.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleCreateSpreadsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSheetTitle.trim() || 'Utility Hub — Daily Utility Records';
    setSheetsBusy(true);
    setToast(null);
    try {
      const token = await ensureToken();
      const created = await createUtilitySpreadsheet(token, title);
      await saveSheetsConfig({
        spreadsheetId: created.spreadsheetId,
        spreadsheetUrl: created.spreadsheetUrl,
        spreadsheetTitle: created.spreadsheetTitle,
        sheetName: created.sheetName,
        lastSyncedCount: 0,
      });
      setPreviewRows(null);
      setToast({
        type: 'success',
        text: `Created and connected "${created.spreadsheetTitle}".`,
      });
    } catch (err) {
      if (err instanceof SheetsAuthError) clearGoogleToken();
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create spreadsheet.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleLookupExistingSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetId(existingSheetInput);
    if (!id) {
      setToast({
        type: 'error',
        text: 'Please paste a valid Google Sheets URL or Spreadsheet ID.',
      });
      return;
    }
    setSheetsBusy(true);
    setToast(null);
    try {
      const token = await ensureToken();
      const meta = await fetchSpreadsheetMetadata(token, id);
      if (meta.sheetNames.length === 0) {
        setToast({ type: 'error', text: 'No sheet tabs found in this spreadsheet.' });
        return;
      }
      setDiscoveredMeta(meta);
      setSelectedTabName(meta.sheetNames[0]);
    } catch (err) {
      if (err instanceof SheetsAuthError) clearGoogleToken();
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not load spreadsheet details.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleLinkDiscoveredSheet = async () => {
    if (!discoveredMeta || !selectedTabName) return;
    setSheetsBusy(true);
    setToast(null);
    try {
      await saveSheetsConfig({
        spreadsheetId: discoveredMeta.spreadsheetId,
        spreadsheetUrl: discoveredMeta.spreadsheetUrl,
        spreadsheetTitle: discoveredMeta.spreadsheetTitle,
        sheetName: selectedTabName,
        lastSyncedCount: 0,
      });
      setDiscoveredMeta(null);
      setExistingSheetInput('');
      setPreviewRows(null);
      setToast({
        type: 'success',
        text: `Connected "${discoveredMeta.spreadsheetTitle}" (${selectedTabName}).`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save spreadsheet configuration.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleConfirmSync = async () => {
    setSyncingNow(true);
    setToast(null);
    try {
      const count = await syncEntriesToConnectedSheet(undefined, undefined, true);
      setSyncModalOpen(false);
      setPreviewRows(null);
      setToast({
        type: 'success',
        text: `Synced ${formatNumber(count, 0)} entries to Google Sheets.`,
      });
    } catch (err) {
      setSyncModalOpen(false);
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google Sheets sync failed.',
      });
    } finally {
      setSyncingNow(false);
    }
  };

  const handlePreviewSheet = async () => {
    if (!sheetsConfig) return;
    setSheetsBusy(true);
    setToast(null);
    try {
      const token = await ensureToken();
      const rows = await readSheetPreview(
        token,
        sheetsConfig.spreadsheetId,
        sheetsConfig.sheetName
      );
      setPreviewRows(rows);
    } catch (err) {
      if (err instanceof SheetsAuthError) clearGoogleToken();
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to read sheet preview.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleDisconnectSheet = async () => {
    setSheetsBusy(true);
    setToast(null);
    try {
      await removeSheetsConfig();
      setConfirmDisconnect(false);
      setPreviewRows(null);
      setToast({ type: 'success', text: 'Disconnected Google Sheet.' });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to disconnect Google Sheet.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleCopyAppsScript = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2500);
    } catch {
      setToast({
        type: 'error',
        text: 'Could not copy to clipboard automatically. Please select and copy the script manually.',
      });
    }
  };

  const handleConnectAppsScript = async (e: React.FormEvent) => {
    e.preventDefault();
    setToast(null);

    const trimmedWebhook = appsScriptUrl.trim();
    if (!isValidAppsScriptUrl(trimmedWebhook)) {
      setToast({
        type: 'error',
        text: 'Please paste a valid Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec).',
      });
      return;
    }

    const trimmedSheetUrl = appsScriptSheetUrl.trim();
    if (
      trimmedSheetUrl &&
      !trimmedSheetUrl.startsWith('https://docs.google.com/spreadsheets/')
    ) {
      setToast({
        type: 'error',
        text: 'Google Sheet URL must start with https://docs.google.com/spreadsheets/',
      });
      return;
    }

    const extractedId = trimmedSheetUrl
      ? extractSpreadsheetId(trimmedSheetUrl) || 'apps-script'
      : 'apps-script';
    const tabName = appsScriptTab.trim() || 'UtilityEntries';
    const title = appsScriptTitle.trim() || 'Utility Hub — Google Sheet';

    setSheetsBusy(true);
    try {
      const syncedCount = await syncViaAppsScriptWebhook(
        trimmedWebhook,
        tabName,
        entries,
        utilities
      );

      await saveSheetsConfig({
        spreadsheetId: extractedId,
        spreadsheetUrl: trimmedSheetUrl,
        spreadsheetTitle: title,
        sheetName: tabName,
        syncMode: 'appsScript',
        webhookUrl: trimmedWebhook,
        lastSyncedCount: syncedCount,
      });

      setAppsScriptUrl('');
      setAppsScriptSheetUrl('');
      setToast({
        type: 'success',
        text: `Auto-Sync connected and synced ${formatNumber(syncedCount, 0)} rows to Google Sheets!`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to test Apps Script Web App URL.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleSyncAppsScriptNow = async () => {
    setSheetsBusy(true);
    setToast(null);
    try {
      const count = await syncEntriesToConnectedSheet(undefined, undefined, true);
      setToast({
        type: 'success',
        text: `Synced ${formatNumber(count, 0)} entries to Google Sheets.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Google Sheets sync failed.',
      });
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleImportFromSheet = async () => {
    if (!sheetsConfig) return;
    setImportingSheets(true);
    setToast(null);
    try {
      if (sheetsConfig.syncMode !== 'appsScript' && !googleAccessToken) {
        await ensureToken();
      }
      const res = await importEntriesFromConnectedSheet();
      if (res.created === 0 && res.updated === 0) {
        setToast({
          type: res.skipped > 0 ? 'error' : 'success',
          text:
            res.skipped > 0
              ? `No entries imported (${formatNumber(res.skipped, 0)} rows skipped due to unknown utility or invalid date).`
              : 'No entry rows found in the connected Google Sheet.',
        });
      } else {
        const parts: string[] = [
          `${formatNumber(res.created, 0)} added`,
          `${formatNumber(res.updated, 0)} updated`,
        ];
        if (res.createdCompanies > 0) {
          parts.push(`${formatNumber(res.createdCompanies, 0)} new factories added`);
        }
        if (res.skipped > 0) {
          parts.push(`${formatNumber(res.skipped, 0)} skipped`);
        }
        setToast({
          type: 'success',
          text: `Imported from Google Sheets: ${parts.join(', ')}.`,
        });
      }
    } catch (err) {
      if (err instanceof SheetsAuthError) clearGoogleToken();
      setToast({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to import entries from Google Sheets.',
      });
    } finally {
      setImportingSheets(false);
    }
  };

  const renderEquipmentEditor = (company: CompanyItem) => (
    <CompanyEquipmentEditor
      company={company}
      canEdit={true}
      onClose={() => setOpenEquipKey(null)}
      onSaved={(msg) => {
        setOpenEquipKey(null);
        setToast({ type: 'success', text: msg });
      }}
      onError={(msg) => setToast({ type: 'error', text: msg })}
    />
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation Tabs + Toast */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'users'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            Users ({formatNumber(allUsers.length, 0)})
            {pendingCount > 0 && (
              <span className="text-amber-700 font-bold">
                · {formatNumber(pendingCount, 0)} Pending
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('companies')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'companies'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Companies ({formatNumber(companies.length, 0)})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('utilities')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'utilities'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4" />
            Utilities ({formatNumber(utilities.length, 0)})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('sheets')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'sheets'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Google Sheets
          </button>
        </div>

        {toast && (
          <div
            className={`px-3.5 py-2 rounded-lg border text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* TAB 1: USERS */}
      {activeTab === 'users' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              User Approval & Role Management
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pending users appear first. Only approved users can access dashboards or log data.
            </p>
          </div>

          {sortedUsers.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No registered users yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {sortedUsers.map((u) => {
                const isSelf = u.uid === user?.uid;
                const isBusy = busyUid === u.uid;
                const statusMeta = STATUS_LABELS[u.status];

                return (
                  <div
                    key={u.uid}
                    className={`p-5 sm:p-6 transition-colors ${
                      u.status === 'pending' ? 'bg-amber-50/40' : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-slate-900">
                            {u.name}
                          </span>
                          {isSelf && (
                            <span className="text-xs font-medium text-teal-700">
                              (You)
                            </span>
                          )}
                          <span className="text-slate-300" aria-hidden="true">
                            ·
                          </span>
                          <span className={`text-xs ${statusMeta.className}`}>
                            {statusMeta.text}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{u.email}</span>
                          {u.organization && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-teal-800">
                                {u.organization}
                              </span>
                            </>
                          )}
                          {(u.designation || u.department) && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {[u.designation, u.department].filter(Boolean).join(' / ')}
                              </span>
                            </>
                          )}
                          {u.employeeId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono-num">ID: {u.employeeId}</span>
                            </>
                          )}
                          {u.phone && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{u.phone}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>
                            Registered: {formatDateTime(u.createdAt?.toDate())}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenUserProfileEditor(u)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                            editingProfileUid === u.uid
                              ? 'bg-slate-900 border-slate-900 text-white'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          {editingProfileUid === u.uid ? 'Close Info' : 'Edit Info'}
                        </button>

                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`role-${u.uid}`}
                            className="text-xs text-slate-600"
                          >
                            Role:
                          </label>
                          <select
                            id={`role-${u.uid}`}
                            value={u.role}
                            disabled={isSelf || isBusy}
                            onChange={(e) => {
                              const nextRole = e.target.value as UserRole;
                              const updates: Partial<
                                Pick<UserProfile, 'role' | 'viewCompanies'>
                              > = { role: nextRole };
                              if (
                                nextRole === 'entry' &&
                                u.companies.length > 0 &&
                                u.viewCompanies.length === 0
                              ) {
                                updates.viewCompanies = [...u.companies];
                              }
                              void updateUserRecord(
                                u,
                                updates,
                                `Changed ${u.name}'s role to ${ROLE_LABELS[nextRole]}.`
                              );
                            }}
                            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-100 disabled:text-slate-500"
                          >
                            <option value="admin">Admin</option>
                            <option value="entry">Data Entry</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </div>

                        {u.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={isSelf || isBusy}
                            onClick={() =>
                              void updateUserRecord(
                                u,
                                { status: 'approved' },
                                `Approved ${u.name}.`
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}

                        {u.status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={isSelf || isBusy}
                            onClick={() =>
                              void updateUserRecord(
                                u,
                                { status: 'rejected' },
                                `Rejected ${u.name}.`
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white border border-rose-300 text-rose-700 text-xs font-semibold rounded-lg hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        )}
                      </div>
                    </div>

                    {editingProfileUid === u.uid && (
                      <div className="mt-3 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                        <div className="text-xs font-bold text-slate-800">
                          Edit User Profile Information (Email locked: {u.email})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Full Name
                            </label>
                            <input
                              type="text"
                              value={userProfileDraft.name}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  name: e.target.value,
                                }))
                              }
                              maxLength={100}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Organization / Company
                            </label>
                            <select
                              value={userProfileDraft.organizationSelect}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  organizationSelect: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            >
                              <option value="">Not assigned</option>
                              {companies.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                              <option value="__other__">Other / Custom</option>
                            </select>
                          </div>

                          {userProfileDraft.organizationSelect === '__other__' && (
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                Custom Organization
                              </label>
                              <input
                                type="text"
                                value={userProfileDraft.customOrganization}
                                onChange={(e) =>
                                  setUserProfileDraft((prev) => ({
                                    ...prev,
                                    customOrganization: e.target.value,
                                  }))
                                }
                                maxLength={100}
                                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Department
                            </label>
                            <input
                              type="text"
                              value={userProfileDraft.department}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  department: e.target.value,
                                }))
                              }
                              maxLength={80}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Designation
                            </label>
                            <input
                              type="text"
                              value={userProfileDraft.designation}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  designation: e.target.value,
                                }))
                              }
                              maxLength={80}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Employee ID
                            </label>
                            <input
                              type="text"
                              value={userProfileDraft.employeeId}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  employeeId: e.target.value,
                                }))
                              }
                              maxLength={40}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Phone Number
                            </label>
                            <input
                              type="text"
                              value={userProfileDraft.phone}
                              onChange={(e) =>
                                setUserProfileDraft((prev) => ({
                                  ...prev,
                                  phone: e.target.value,
                                }))
                              }
                              maxLength={30}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingProfileUid(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSaveUserProfileDetails(u)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {isBusy ? 'Saving...' : 'Save Info'}
                          </button>
                        </div>
                      </div>
                    )}

                    {isSelf && (
                      <p className="mt-2 text-xs text-slate-500">
                        You cannot demote or reject your own administrator account.
                      </p>
                    )}

                    {u.role === 'admin' && !isSelf && (
                      <p className="mt-3 text-xs text-slate-500">
                        Administrators can enter and view utility records across all factories.
                      </p>
                    )}

                    {(u.role === 'entry' || u.role === 'viewer') && (() => {
                      const isExpanded =
                        expandedUserUids[u.uid] ?? u.status === 'pending';
                      const rawAllowed = u.allowedUtilities || [];
                      const isNoneSelected =
                        rawAllowed.length === 1 && rawAllowed[0] === '__none__';
                      const allowedUtilCount =
                        rawAllowed.length === 0
                          ? null
                          : rawAllowed.filter((id) => id !== '__none__').length;

                      return (
                        <div className="mt-3 pt-3 border-t border-slate-200/80">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              {u.role === 'entry' && (
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                                  Entry:{' '}
                                  {u.companies.length > 0
                                    ? u.companies.join(', ')
                                    : 'None'}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded ${
                                  isNoneSelected
                                    ? 'bg-amber-100 text-amber-800 font-medium'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                Utilities:{' '}
                                {allowedUtilCount === null
                                  ? 'All'
                                  : isNoneSelected || allowedUtilCount === 0
                                  ? 'None'
                                  : `${formatNumber(allowedUtilCount, 0)} selected`}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded ${
                                  u.status === 'approved' &&
                                  u.viewCompanies.length === 0
                                    ? 'bg-amber-100 text-amber-800 font-medium'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                View:{' '}
                                {u.viewCompanies.length > 0
                                  ? u.viewCompanies.join(', ')
                                  : 'None'}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                setExpandedUserUids((prev) => ({
                                  ...prev,
                                  [u.uid]: !isExpanded,
                                }))
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg cursor-pointer shrink-0"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              {isExpanded
                                ? 'Hide Access'
                                : 'Access & Equipment'}
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="mt-4 space-y-4">
                        {u.role === 'entry' && (
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div>
                                <div className="text-xs font-semibold text-slate-800">
                                  Entry Factories (Can Add, Edit & Delete Data)
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Only checked factories appear in this user's Daily Data Entry form.
                                </div>
                              </div>
                              {companies.length > 0 && (
                                <div className="flex items-center gap-2 text-xs">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleSetEntryCompanies(
                                        u,
                                        companies.map((c) => c.name),
                                        'Enabled entry for all factories'
                                      )
                                    }
                                    className="text-teal-700 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                  >
                                    Select All
                                  </button>
                                  <span className="text-slate-300">·</span>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void updateUserRecord(
                                        u,
                                        { companies: [] },
                                        `Cleared entry factories for ${u.name}.`
                                      )
                                    }
                                    className="text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-50"
                                  >
                                    Clear
                                  </button>
                                </div>
                              )}
                            </div>

                            {companies.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No factories available. Add factories in the Companies tab first.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2.5">
                                {companies.map((c) => {
                                  const checked = u.companies.includes(c.name);
                                  return (
                                    <label
                                      key={`entry-${c.id}`}
                                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                                        checked
                                          ? 'bg-teal-50 border-teal-300 text-teal-900 font-medium'
                                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isBusy}
                                        onChange={() =>
                                          void handleToggleEntryCompany(u, c.name)
                                        }
                                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                                      />
                                      <span>{c.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {u.companies.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                                <div>
                                  <div className="text-xs font-semibold text-slate-800">
                                    Plant Equipment &amp; Grid Setup (Boilers · Diesel/Gas Gen · Solar · PDB/DESCO/REB)
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    Define equipment counts &amp; power providers for this user&apos;s assigned factories.
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  {u.companies.map((compName) => {
                                    const compObj = companies.find(
                                      (c) => c.name === compName
                                    );
                                    if (!compObj) return null;
                                    const scopeKey = `user-${u.uid}`;
                                    const isOpen =
                                      openEquipKey === `${scopeKey}::${compObj.id}`;
                                    return (
                                      <div
                                        key={`user-equip-${u.uid}-${compObj.id}`}
                                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="min-w-0">
                                            <span className="text-xs font-bold text-slate-900">
                                              {compObj.name}
                                            </span>
                                            <span className="text-slate-300 mx-2">·</span>
                                            <span className="text-xs text-slate-600">
                                              {formatEquipmentSummary(compObj)}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenEquipmentEditor(
                                                scopeKey,
                                                compObj
                                              )
                                            }
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md cursor-pointer shrink-0"
                                          >
                                            <SlidersHorizontal className="w-3.5 h-3.5" />
                                            {isOpen ? 'Hide Setup' : 'Configure Equipment'}
                                          </button>
                                        </div>
                                        {isOpen && renderEquipmentEditor(compObj)}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {utilities.length > 0 && (
                          <div className="pt-2 border-t border-slate-100">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div>
                                <div className="text-xs font-semibold text-slate-800">
                                  Allowed Utilities (Dashboard{u.role === 'entry' ? ' & Entry Form' : ''})
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Only checked utilities are visible to this user. (All checked by default.)
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleSetAllowedUtilities(
                                      u,
                                      [],
                                      'Enabled all utilities'
                                    )
                                  }
                                  className="text-teal-700 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleSetAllowedUtilities(
                                      u,
                                      ['__none__'],
                                      'Hidden all utilities'
                                    )
                                  }
                                  className="text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-50"
                                >
                                  Clear (None)
                                </button>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {utilities.map((util) => {
                                const raw = u.allowedUtilities || [];
                                const isAll = raw.length === 0;
                                const checked = isAll || raw.includes(util.id);
                                return (
                                  <label
                                    key={`util-${u.uid}-${util.id}`}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                      checked
                                        ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 font-medium'
                                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isBusy}
                                      onChange={() =>
                                        void handleToggleAllowedUtility(u, util.id)
                                      }
                                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                                    />
                                    <span
                                      className="w-2 h-2 rounded-sm shrink-0"
                                      style={{ backgroundColor: util.color }}
                                    />
                                    <span>
                                      {util.name} ({util.unit})
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <div>
                              <div className="text-xs font-semibold text-slate-800">
                                View Factories (Dashboard, Analytics & Reports)
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Controls which factories this user can inspect on the Dashboard.
                              </div>
                            </div>
                            {companies.length > 0 && (
                              <div className="flex items-center gap-2 text-xs">
                                {u.role === 'entry' && u.companies.length > 0 && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        void handleSetViewCompanies(
                                          u,
                                          [...u.companies],
                                          'Matched view factories to entry factories'
                                        )
                                      }
                                      className="text-indigo-700 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                    >
                                      Same as Entry
                                    </button>
                                    <span className="text-slate-300">·</span>
                                  </>
                                )}
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleSetViewCompanies(
                                      u,
                                      companies.map((c) => c.name),
                                      'Enabled view access for all factories'
                                    )
                                  }
                                  className="text-teal-700 hover:underline font-medium cursor-pointer disabled:opacity-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleSetViewCompanies(
                                      u,
                                      [],
                                      'Cleared view factories'
                                    )
                                  }
                                  className="text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-50"
                                >
                                  Clear
                                </button>
                              </div>
                            )}
                          </div>

                          {companies.length === 0 ? (
                            <p className="text-xs text-slate-500">
                              No factories available. Add factories in the Companies tab first.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2.5">
                              {companies.map((c) => {
                                const checked = u.viewCompanies.includes(c.name);
                                return (
                                  <label
                                    key={`view-${c.id}`}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                                      checked
                                        ? 'bg-indigo-50 border-indigo-300 text-indigo-950 font-medium'
                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isBusy}
                                      onChange={() =>
                                        void handleToggleViewCompany(u, c.name)
                                      }
                                      className="rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                                    />
                                    <span>{c.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          {u.status === 'approved' && u.viewCompanies.length === 0 && (
                            <p className="mt-2 text-xs text-amber-700">
                              No view factories assigned — this user&apos;s Dashboard will stay empty until at least one factory is checked above.
                            </p>
                          )}
                        </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: COMPANIES */}
      {activeTab === 'companies' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Manage Companies
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Add, rename, or remove companies in your group.
              </p>
            </div>

            {companies.length === 0 && (
              <button
                type="button"
                disabled={companyBusy}
                onClick={() => void handleSeedDefaults('companies')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Seed Default Companies
              </button>
            )}
          </div>

          <form
            onSubmit={handleAddCompany}
            className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3"
          >
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Enter new company name (e.g. Company D)"
              maxLength={100}
              required
              className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <button
              type="submit"
              disabled={companyBusy}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Company
            </button>
          </form>

          {companies.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No companies configured yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {companies.map((c) => {
                const compScopeKey = 'company-tab';
                const isEquipOpen = openEquipKey === `${compScopeKey}::${c.id}`;
                return (
                  <div key={c.id} className="px-5 sm:px-6 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {editingCompanyId === c.id ? (
                        <div className="flex items-center gap-2 flex-1 max-w-md">
                          <input
                            type="text"
                            value={editingCompanyName}
                            onChange={(e) => setEditingCompanyName(e.target.value)}
                            maxLength={100}
                            className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                          <button
                            type="button"
                            disabled={companyBusy}
                            onClick={() => void handleSaveCompanyEdit(c.id)}
                            className="px-3 py-1.5 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCompanyId(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">
                            {c.name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1">
                              <Flame className="w-3 h-3 text-orange-500" />
                              <Zap className="w-3 h-3 text-teal-600" />
                              <Sun className="w-3 h-3 text-amber-500" />
                              {formatEquipmentSummary(c)}
                            </span>
                          </div>
                        </div>
                      )}

                      {editingCompanyId !== c.id && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenEquipmentEditor(compScopeKey, c)
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded cursor-pointer ${
                              isEquipOpen
                                ? 'bg-teal-700 text-white'
                                : 'bg-teal-50 text-teal-800 hover:bg-teal-100'
                            }`}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            Equipment Setup
                          </button>

                          {confirmDeleteCompanyId === c.id ? (
                            <>
                              <button
                                type="button"
                                disabled={companyBusy}
                                onClick={() => void handleDeleteCompany(c.id)}
                                className="px-2.5 py-1 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 cursor-pointer disabled:opacity-60"
                              >
                                Confirm Delete &amp; Purge Data
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCompanyId(null)}
                                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCompanyId(c.id);
                                  setEditingCompanyName(c.name);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCompanyId(c.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {isEquipOpen && renderEquipmentEditor(c)}
                  </div>
                );
              })}
            </div>
          )}

          {orphanedCompanyStats.length > 0 && (
            <div className="p-5 sm:p-6 bg-amber-50/70 border-t border-amber-200 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Legacy / Unlisted Factory Names in Historical Data
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  These removed or legacy names still exist in older database entries or permissions. Merge them into an active factory or permanently delete their historical data.
                </p>
              </div>
              <div className="space-y-2.5">
                {orphanedCompanyStats.map((item) => {
                  const selectedTarget =
                    migrateTargets[item.name] || companies[0]?.name || '';
                  const isConfirmingPurge = confirmPurgeOrphan === item.name;
                  return (
                    <div
                      key={item.name}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-amber-200 rounded-lg px-4 py-3"
                    >
                      <div className="text-sm">
                        <span className="font-semibold text-slate-900">{item.name}</span>
                        <span className="text-xs text-slate-500 ml-2 tabular-nums">
                          ({formatNumber(item.entryCount, 0)} entries)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {companies.length > 0 && (
                          <>
                            <span className="text-xs text-slate-500">Merge into:</span>
                            <select
                              value={selectedTarget}
                              onChange={(e) =>
                                setMigrateTargets((prev) => ({
                                  ...prev,
                                  [item.name]: e.target.value,
                                }))
                              }
                              aria-label={`Select target factory for ${item.name}`}
                              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            >
                              {companies.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={companyBusy}
                              onClick={() => void handleMergeOrphanedCompany(item.name)}
                              className="px-3 py-1.5 text-xs font-semibold bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:opacity-60 cursor-pointer"
                            >
                              Migrate Entries
                            </button>
                          </>
                        )}
                        {isConfirmingPurge ? (
                          <>
                            <button
                              type="button"
                              disabled={companyBusy}
                              onClick={() => void handlePurgeOrphanedCompany(item.name)}
                              className="px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
                            >
                              Confirm Delete Data
                            </button>
                            <button
                              type="button"
                              disabled={companyBusy}
                              onClick={() => setConfirmPurgeOrphan(null)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={companyBusy}
                            onClick={() => setConfirmPurgeOrphan(item.name)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-rose-300 text-rose-700 rounded-lg hover:bg-rose-50 disabled:opacity-60 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Data
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: UTILITIES */}
      {activeTab === 'utilities' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Manage Utilities
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure utility names, measurement units, and chart hex colors.
              </p>
            </div>

            {utilities.length === 0 && (
              <button
                type="button"
                disabled={utilBusy}
                onClick={() => void handleSeedDefaults('utilities')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Seed Default Utilities
              </button>
            )}
          </div>

          <form
            onSubmit={handleAddUtility}
            className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <div className="sm:col-span-4">
              <label
                htmlFor="util-name"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Utility Name
              </label>
              <input
                id="util-name"
                type="text"
                value={newUtilName}
                onChange={(e) => setNewUtilName(e.target.value)}
                placeholder="e.g. Solar Power"
                maxLength={80}
                required
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="util-unit"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Unit
              </label>
              <input
                id="util-unit"
                type="text"
                value={newUtilUnit}
                onChange={(e) => setNewUtilUnit(e.target.value)}
                placeholder="e.g. kWh / Liters"
                maxLength={30}
                required
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="util-color"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Chart Color (Hex)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(newUtilColor) ? newUtilColor : '#0F766E'}
                  onChange={(e) => setNewUtilColor(e.target.value.toUpperCase())}
                  aria-label="Pick chart color"
                  className="w-10 h-9 p-0.5 bg-white border border-slate-300 rounded cursor-pointer shrink-0"
                />
                <input
                  id="util-color"
                  type="text"
                  value={newUtilColor}
                  onChange={(e) => setNewUtilColor(e.target.value)}
                  maxLength={7}
                  required
                  className="w-full px-3 py-2 text-sm font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={utilBusy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </form>

          {utilities.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No utilities configured yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-5">Utility Name</th>
                    <th className="py-3 px-4">Unit</th>
                    <th className="py-3 px-4">Chart Color</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {utilities.map((u) => {
                    const isEditing = editingUtilId === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-5">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editUtilName}
                              onChange={(e) => setEditUtilName(e.target.value)}
                              maxLength={80}
                              className="w-full max-w-[180px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                            />
                          ) : (
                            <div className="flex items-center gap-2.5 font-semibold text-slate-900">
                              <span
                                className="w-3.5 h-3.5 rounded-sm shrink-0"
                                style={{ backgroundColor: u.color }}
                              />
                              {u.name}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-slate-700">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editUtilUnit}
                              onChange={(e) => setEditUtilUnit(e.target.value)}
                              maxLength={30}
                              className="w-full max-w-[120px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                            />
                          ) : (
                            u.unit
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={
                                  /^#[0-9A-Fa-f]{6}$/.test(editUtilColor)
                                    ? editUtilColor
                                    : '#0F766E'
                                }
                                onChange={(e) =>
                                  setEditUtilColor(e.target.value.toUpperCase())
                                }
                                className="w-8 h-8 p-0.5 bg-white border border-slate-300 rounded cursor-pointer"
                              />
                              <input
                                type="text"
                                value={editUtilColor}
                                onChange={(e) => setEditUtilColor(e.target.value)}
                                maxLength={7}
                                className="w-24 px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded-lg"
                              />
                            </div>
                          ) : (
                            <span className="font-mono-num text-xs text-slate-600">
                              {u.color}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={utilBusy}
                                onClick={() => void handleSaveUtilEdit(u.id)}
                                className="px-3 py-1 text-xs font-semibold bg-teal-700 text-white rounded hover:bg-teal-800 cursor-pointer"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingUtilId(null)}
                                className="px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : confirmDeleteUtilId === u.id ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={utilBusy}
                                onClick={() => void handleDeleteUtility(u.id)}
                                className="px-2.5 py-1 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 cursor-pointer disabled:opacity-60"
                              >
                                {(() => {
                                  const count = utilityEntryCountMap.get(u.id) || 0;
                                  return count > 0
                                    ? `Confirm Delete & Purge (${formatNumber(count, 0)} entries)`
                                    : 'Confirm Delete';
                                })()}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUtilId(null)}
                                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingUtilId(u.id);
                                  setEditUtilName(u.name);
                                  setEditUtilUnit(u.unit);
                                  setEditUtilColor(u.color);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUtilId(u.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: GOOGLE SHEETS */}
      {activeTab === 'sheets' && (
        <div className="space-y-6">
          {/* Active Spreadsheet Status */}
          {sheetsConfig ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {sheetsConfig.spreadsheetTitle}
                    </h3>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-xs font-medium text-slate-600">
                      Tab: {sheetsConfig.sheetName}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        sheetsConfig.syncMode === 'appsScript'
                          ? 'text-emerald-700'
                          : 'text-teal-700'
                      }`}
                    >
                      {sheetsConfig.syncMode === 'appsScript'
                        ? 'Auto-Sync Active (Apps Script)'
                        : 'OAuth Manual Sync'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                    <span>
                      Last Synced: {formatDateTime(sheetsConfig.lastSyncedAt?.toDate())}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {formatNumber(sheetsConfig.lastSyncedCount, 0)} rows synced
                    </span>
                  </div>
                  {sheetsConfig.syncMode === 'appsScript' && (
                    <div className="pt-1 space-y-2">
                      <p className="text-xs text-emerald-700">
                        Every save, update, or deletion automatically keeps <span className="font-mono-num">Master_Backup</span> (Tab 1), <span className="font-mono-num">Monthly_Summary</span> (Tab 2), and separate monthly tabs per factory (e.g., <span className="font-mono-num">Factory - Nov 2026</span>, <span className="font-mono-num">Factory - Jan 2027</span>) organized and up to date.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAppsScriptUpgrade((prev) => !prev)}
                        className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                      >
                        {showAppsScriptUpgrade
                          ? 'Hide Multi-Tab Apps Script Code'
                          : 'View / Update Apps Script Code (v3: Import + Rename Tab Cleanup)'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {sheetsConfig.spreadsheetUrl && (
                    <a
                      href={sheetsConfig.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open in Google Sheets
                    </a>
                  )}

                  {sheetsConfig.syncMode !== 'appsScript' && (
                    <button
                      type="button"
                      disabled={sheetsBusy || importingSheets}
                      onClick={() => void handlePreviewSheet()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                    >
                      Preview Rows
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={sheetsBusy || importingSheets}
                    onClick={() => void handleImportFromSheet()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {importingSheets ? 'Importing...' : 'Import from Sheet'}
                  </button>

                  <button
                    type="button"
                    disabled={sheetsBusy || importingSheets}
                    onClick={async () => {
                      if (sheetsConfig.syncMode === 'appsScript') {
                        await handleSyncAppsScriptNow();
                        return;
                      }
                      if (!googleAccessToken) {
                        setSheetsBusy(true);
                        setToast(null);
                        try {
                          await ensureToken();
                        } catch (err) {
                          setToast({
                            type: 'error',
                            text:
                              err instanceof Error
                                ? err.message
                                : 'Google authorization is required to sync.',
                          });
                          return;
                        } finally {
                          setSheetsBusy(false);
                        }
                      }
                      setSyncModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Sync All Entries ({formatNumber(entries.length, 0)})
                  </button>

                  {confirmDisconnect ? (
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        disabled={sheetsBusy || importingSheets}
                        onClick={() => void handleDisconnectSheet()}
                        className="px-3 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 cursor-pointer"
                      >
                        Confirm Disconnect
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  )}
                </div>
              </div>

              {sheetsConfig.syncMode === 'appsScript' && showAppsScriptUpgrade && (
                <div className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        Two-Way Factory × Month × Year Apps Script (v3)
                      </h4>
                      <p className="text-xs text-slate-600">
                        Adds two-way import (doGet) and automatic cleanup of old tabs after factory renames. Replace your Apps Script with this code and deploy a New Version (Deploy → Manage deployments → Edit → New version → Deploy).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyAppsScript()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-md cursor-pointer"
                    >
                      {copiedScript ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Script
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3.5 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono-num overflow-x-auto max-h-64 leading-relaxed">
                    {APPS_SCRIPT_TEMPLATE}
                  </pre>
                </div>
              )}

              {previewRows && (
                <div className="p-5 sm:p-6 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-700">
                      Live Google Sheet Preview (First {formatNumber(previewRows.length, 0)} rows)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setPreviewRows(null)}
                      className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                    >
                      Hide Preview
                    </button>
                  </div>
                  {previewRows.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      This sheet tab is currently empty. Click &quot;Sync All Entries&quot; to populate it.
                    </p>
                  ) : (
                    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <tbody>
                          {previewRows.map((row, idx) => (
                            <tr
                              key={idx}
                              className={
                                idx === 0
                                  ? 'bg-slate-100 font-semibold text-slate-800 border-b border-slate-200'
                                  : 'border-b border-slate-100 text-slate-700'
                              }
                            >
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="py-2 px-3 whitespace-nowrap">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Recommended: Automatic Sync via Google Apps Script */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Automatic Sync via Google Apps Script
                    </h2>
                    <span className="text-xs font-semibold text-emerald-700">
                      Recommended · Auto-creates Factory × Month × Year tabs on Save / Edit / Delete
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Connect any Google Sheet so every entry maintains a formatted <span className="font-mono-num">Master_Backup</span> main tab, a <span className="font-mono-num">Monthly_Summary</span> tab, and separate monthly tabs per factory (e.g., <span className="font-mono-num">Company A - Nov 2026</span>, <span className="font-mono-num">Company A - Jan 2027</span>).
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Step 1: Paste this script into Extensions → Apps Script
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopyAppsScript()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer"
                      >
                        {copiedScript ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Script
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-3.5 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono-num overflow-x-auto leading-relaxed">
                      {APPS_SCRIPT_TEMPLATE}
                    </pre>
                    <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside">
                      <li>Open your Google Sheet and go to Extensions → Apps Script.</li>
                      <li>Replace the default code with the script above and Save.</li>
                      <li>
                        Click <strong>Deploy → New deployment</strong> → Select type <strong>Web app</strong> → Set <em>Execute as: Me</em> and <em>Who has access: Anyone</em> → Deploy and copy the <span className="font-mono-num">/exec</span> URL.
                      </li>
                    </ol>
                  </div>

                  <form onSubmit={handleConnectAppsScript} className="space-y-4">
                    <div className="text-xs font-semibold text-slate-700">
                      Step 2: Connect Web App URL
                    </div>

                    <div>
                      <label
                        htmlFor="apps-script-url"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Apps Script Web App URL (/exec) *
                      </label>
                      <input
                        id="apps-script-url"
                        type="url"
                        value={appsScriptUrl}
                        onChange={(e) => setAppsScriptUrl(e.target.value)}
                        placeholder="https://script.google.com/macros/s/.../exec"
                        required
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="apps-script-sheet-url"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Google Sheet URL (Optional, for quick open link)
                      </label>
                      <input
                        id="apps-script-sheet-url"
                        type="url"
                        value={appsScriptSheetUrl}
                        onChange={(e) => setAppsScriptSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="apps-script-title"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Display Title
                        </label>
                        <input
                          id="apps-script-title"
                          type="text"
                          value={appsScriptTitle}
                          onChange={(e) => setAppsScriptTitle(e.target.value)}
                          maxLength={150}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="apps-script-tab"
                          className="block text-xs font-medium text-slate-600 mb-1"
                        >
                          Target Tab Name
                        </label>
                        <input
                          id="apps-script-tab"
                          type="text"
                          value={appsScriptTab}
                          onChange={(e) => setAppsScriptTab(e.target.value)}
                          maxLength={100}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={sheetsBusy}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      {sheetsBusy ? 'Testing & Syncing...' : 'Enable Auto-Sync & Sync Now'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Alternative: Direct OAuth Connection */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900">
                      Alternative: Direct Google Account OAuth Sync
                    </h2>
                    <p className="text-xs text-slate-500">
                      {googleAccessToken
                        ? 'Google Sheets OAuth access is active for this session.'
                        : 'Sign in with Google to authorize creating, reading, and manually syncing spreadsheets via Google Sheets API.'}
                    </p>
                  </div>

                  <div className="w-full sm:w-64 shrink-0">
                    {googleAccessToken ? (
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs font-semibold text-emerald-700">
                          Authorized
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleAuthorizeGoogle()}
                          disabled={sheetsBusy}
                          className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
                        >
                          Reconnect
                        </button>
                      </div>
                    ) : (
                      <GoogleSignInButton
                        onClick={() => void handleAuthorizeGoogle()}
                        disabled={sheetsBusy}
                        label={sheetsBusy ? 'Connecting...' : 'Sign in with Google'}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <form onSubmit={handleCreateSpreadsheet} className="space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Create a New Google Sheet
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Creates a formatted spreadsheet in your Google Drive with the UtilityEntries tab.
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="new-sheet-title"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Spreadsheet Title
                      </label>
                      <input
                        id="new-sheet-title"
                        type="text"
                        value={newSheetTitle}
                        onChange={(e) => setNewSheetTitle(e.target.value)}
                        maxLength={150}
                        required
                        className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={sheetsBusy}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Create & Connect Sheet
                    </button>
                  </form>

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Connect an Existing Google Sheet
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Paste your Google Sheets link or Spreadsheet ID, then select which tab receives synced records.
                      </p>
                    </div>

                    <form onSubmit={handleLookupExistingSheet} className="flex gap-2">
                      <input
                        type="text"
                        value={existingSheetInput}
                        onChange={(e) => setExistingSheetInput(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        required
                        className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                      <button
                        type="submit"
                        disabled={sheetsBusy}
                        className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                      >
                        Load Tabs
                      </button>
                    </form>

                    {discoveredMeta && (
                      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                        <div className="text-xs text-slate-600">
                          Found:{' '}
                          <span className="font-semibold text-slate-900">
                            {discoveredMeta.spreadsheetTitle}
                          </span>
                        </div>

                        <div>
                          <label
                            htmlFor="existing-tab-select"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Select Target Tab
                          </label>
                          <select
                            id="existing-tab-select"
                            value={selectedTabName}
                            onChange={(e) => setSelectedTabName(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                          >
                            {discoveredMeta.sheetNames.map((tab) => (
                              <option key={tab} value={tab}>
                                {tab}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          disabled={sheetsBusy}
                          onClick={() => void handleLinkDiscoveredSheet()}
                          className="px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                        >
                          Save & Connect Tab
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {sheetsConfig && (
        <GoogleSheetsSyncModal
          open={syncModalOpen}
          spreadsheetTitle={sheetsConfig.spreadsheetTitle}
          sheetName={sheetsConfig.sheetName}
          recordCount={entries.length}
          syncing={syncingNow}
          onConfirm={() => void handleConfirmSync()}
          onCancel={() => setSyncModalOpen(false)}
        />
      )}
    </div>
  );
}
