import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  type User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { ADMIN_EMAIL, DEFAULT_COMPANIES, DEFAULT_UTILITIES } from '../config';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  OperationType,
  auth,
  authorizeGoogleSheetsForCurrentUser,
  changeCurrentUserPassword,
  clearCachedGoogleAccessToken,
  db,
  getCachedGoogleAccessToken,
  handleFirestoreError,
  linkPasswordToCurrentUser,
  signInWithGoogleAccount,
  verifyCurrentAccountWithGoogle,
} from '../firebase';
import {
  MASTER_BACKUP_TAB_NAME,
  type ReconciliationPlan,
  SheetsAuthError,
  clearSheetsBaseline,
  computeRecordHashSnapshot,
  fetchWorkbookTabsFromAppsScript,
  fetchWorkbookTabsFromGoogleSheet,
  loadSheetsBaseline,
  makeGenerationCompositeKey,
  makeUtilityCompositeKey,
  reconcileWorkbookWithApp,
  saveSheetsBaseline,
  syncEntriesToGoogleSheet,
  syncViaAppsScriptWebhook,
} from '../services/googleSheets';
import type {
  AdminUserUpdates,
  AutoSyncState,
  CompanyItem,
  FactoryBudget,
  FactoryBudgetInput,
  GenerationEntry,
  GoogleSheetsConfig,
  GoogleSheetsSyncDirection,
  GoogleSheetsSyncMode,
  OwnProfileUpdates,
  TwoWaySyncResult,
  UserDirectoryEntry,
  UserProfile,
  UserUnitRate,
  UtilityEntry,
  UtilityItem,
} from '../types';
import { toSafeFirestoreId } from '../utils/formatters';

const PENDING_SIGNUP_ORG_PREFIX = 'utility_hub_pending_org_';

function savePendingSignupOrg(email: string, organization: string) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOrg = organization.trim().slice(0, 100);
    if (!cleanEmail || !cleanOrg || typeof window === 'undefined') return;
    window.localStorage.setItem(`${PENDING_SIGNUP_ORG_PREFIX}${cleanEmail}`, cleanOrg);
  } catch {
    // Ignore storage errors
  }
}

function consumePendingSignupOrg(email: string): string {
  try {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || typeof window === 'undefined') return '';
    const key = `${PENDING_SIGNUP_ORG_PREFIX}${cleanEmail}`;
    const value = window.localStorage.getItem(key) || '';
    if (value) window.localStorage.removeItem(key);
    return value.trim().slice(0, 100);
  } catch {
    return '';
  }
}

function mapUserProfileDoc(
  uid: string,
  data: Record<string, unknown>,
  fallbackName = 'User',
  fallbackEmail = ''
): UserProfile {
  return {
    uid,
    name: String(data.name || fallbackName || 'User'),
    email: String(data.email || fallbackEmail || ''),
    status: data.status as UserProfile['status'],
    role: data.role as UserProfile['role'],
    companies: Array.isArray(data.companies) ? data.companies.map(String) : [],
    viewCompanies: Array.isArray(data.viewCompanies) ? data.viewCompanies.map(String) : [],
    allowedUtilities: Array.isArray(data.allowedUtilities)
      ? data.allowedUtilities.map(String)
      : [],
    organization: typeof data.organization === 'string' ? data.organization : '',
    department: typeof data.department === 'string' ? data.department : '',
    designation: typeof data.designation === 'string' ? data.designation : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    employeeId: typeof data.employeeId === 'string' ? data.employeeId : '',
    dailyMailEnabled: Boolean(data.dailyMailEnabled),
    dailyMailEmail:
      typeof data.dailyMailEmail === 'string' ? data.dailyMailEmail : '',
    dailyMailTime:
      typeof data.dailyMailTime === 'string' ? data.dailyMailTime : '',
    lastDailyMailSentDate:
      typeof data.lastDailyMailSentDate === 'string'
        ? data.lastDailyMailSentDate
        : '',
    createdAt: (data.createdAt as UserProfile['createdAt']) ?? null,
  };
}

interface AppContextValue {
  user: User | null;
  emailVerified: boolean;
  authReady: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  profileError: string | null;
  dataLoading: boolean;
  publicCompanies: string[];
  companies: CompanyItem[];
  utilities: UtilityItem[];
  entries: UtilityEntry[];
  generationEntries: GenerationEntry[];
  budgets: FactoryBudget[];
  userUnitRates: UserUnitRate[];
  allUsers: UserProfile[];
  directoryUsers: UserDirectoryEntry[];
  sheetsConfig: GoogleSheetsConfig | null;
  googleAccessToken: string | null;
  autoSyncState: AutoSyncState;
  signUpWithEmail: (
    name: string,
    email: string,
    password: string,
    organization?: string
  ) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  updateOwnProfile: (updates: OwnProfileUpdates) => Promise<void>;
  adminUpdateUser: (target: UserProfile, updates: AdminUserUpdates) => Promise<void>;
  saveFactoryBudget: (input: FactoryBudgetInput) => Promise<void>;
  deleteFactoryBudget: (budgetId: string) => Promise<void>;
  syncPublicCompanies: (namesOverride?: string[]) => Promise<void>;
  connectGoogleSheets: () => Promise<string>;
  clearGoogleToken: () => void;
  saveSheetsConfig: (config: {
    spreadsheetId: string;
    spreadsheetUrl: string;
    spreadsheetTitle: string;
    sheetName: string;
    syncMode?: GoogleSheetsSyncMode;
    webhookUrl?: string;
    autoSyncEnabled?: boolean;
    autoSyncIntervalSec?: number;
    lastSyncedCount?: number;
  }) => Promise<void>;
  toggleAutoSync: (enabled: boolean, intervalSec?: number) => Promise<void>;
  removeSheetsConfig: () => Promise<void>;
  syncEntriesToConnectedSheet: (
    entriesOverride?: UtilityEntry[],
    ensureTabKeys?: Array<{ company: string; monthKey: string }>,
    pruneStaleTabs?: boolean,
    utilitiesOverride?: UtilityItem[],
    generationEntriesOverride?: GenerationEntry[]
  ) => Promise<number>;
  importEntriesFromConnectedSheet: () => Promise<{
    created: number;
    updated: number;
    generationUpdated: number;
    skipped: number;
    createdCompanies: number;
  }>;
  runTwoWaySyncNow: (options?: {
    forceDirection?: 'bidirectional' | 'push' | 'pull';
    entriesOverride?: UtilityEntry[];
    generationEntriesOverride?: GenerationEntry[];
    utilitiesOverride?: UtilityItem[];
    companiesOverride?: CompanyItem[];
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
    pruneStaleTabs?: boolean;
    silent?: boolean;
  }) => Promise<TwoWaySyncResult>;
  resetPassword: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  linkPassword: (newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  checkEmailVerified: () => Promise<boolean>;
  verifyWithGoogle: () => Promise<boolean>;
  resendVerification: () => Promise<void>;
  checkApprovalStatus: () => Promise<'pending' | 'approved' | 'rejected' | 'unknown'>;
  retryProfileLoad: () => Promise<void>;
  seedDefaultsIfNeeded: (force?: boolean) => Promise<void>;
}

const DEFAULT_AUTO_SYNC_STATE: AutoSyncState = {
  status: 'idle',
  lastResultText: '',
  lastSyncedAt: null,
  lastDirection: 'none',
  lastPulledCreated: 0,
  lastPulledUpdated: 0,
  lastPushedRows: 0,
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [, setAuthTick] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  const [publicCompanies, setPublicCompanies] = useState<string[]>([...DEFAULT_COMPANIES]);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [utilities, setUtilities] = useState<UtilityItem[]>([]);
  const [entries, setEntries] = useState<UtilityEntry[]>([]);
  const [generationEntries, setGenerationEntries] = useState<GenerationEntry[]>([]);
  const [budgets, setBudgets] = useState<FactoryBudget[]>([]);
  const [userUnitRates, setUserUnitRates] = useState<UserUnitRate[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [viewerDirectoryUsers, setViewerDirectoryUsers] = useState<UserDirectoryEntry[]>([]);
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(
    () => getCachedGoogleAccessToken()
  );
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState>(DEFAULT_AUTO_SYNC_STATE);

  const seededRef = useRef(false);
  const directoryBackfilledRef = useRef(false);
  const syncInFlightRef = useRef<Promise<TwoWaySyncResult> | null>(null);
  const lastCompletedSyncHashRef = useRef<string>('');
  const lastFocusPollAtRef = useRef<number>(0);

  // Fetch non-PII company names for unauthenticated Sign Up selector
  useEffect(() => {
    let active = true;
    const loadPublicCompanies = async () => {
      try {
        const snap = await getDoc(doc(db, 'publicConfig', 'companies'));
        if (!active) return;
        if (snap.exists()) {
          const raw = snap.data()?.names;
          if (Array.isArray(raw) && raw.length > 0) {
            const clean = Array.from(
              new Set(raw.map((n) => String(n).trim()).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b));
            if (clean.length > 0) {
              setPublicCompanies(clean);
            }
          }
        }
      } catch {
        // Keep DEFAULT_COMPANIES fallback silently before auth/seed
      }
    };
    void loadPublicCompanies();
    return () => {
      active = false;
    };
  }, []);

  const syncPublicCompanies = useCallback(
    async (namesOverride?: string[]) => {
      const source = namesOverride ?? companies.map((c) => c.name);
      const cleanNames = Array.from(
        new Set(source.map((n) => n.trim().slice(0, 100)).filter(Boolean))
      )
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 100);
      setPublicCompanies(cleanNames.length > 0 ? cleanNames : [...DEFAULT_COMPANIES]);
      try {
        await setDoc(doc(db, 'publicConfig', 'companies'), {
          names: cleanNames,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Could not sync publicConfig/companies:', err);
      }
    },
    [companies]
  );

  const ensureUserProfile = useCallback(async (firebaseUser: User): Promise<UserProfile | null> => {
    if (!firebaseUser.emailVerified) return null;

    const userPath = `users/${firebaseUser.uid}`;
    const userRef = doc(db, 'users', firebaseUser.uid);
    const dirRef = doc(db, 'userDirectory', firebaseUser.uid);

    let snap;
    try {
      try {
        snap = await getDocFromServer(userRef);
      } catch (serverErr) {
        const msg =
          serverErr instanceof Error ? serverErr.message : String(serverErr);
        if (
          msg.includes('permission-denied') ||
          msg.includes('Missing or insufficient permissions')
        ) {
          throw serverErr;
        }
        snap = await getDoc(userRef);
      }
    } catch (readError) {
      handleFirestoreError(readError, OperationType.GET, userPath);
    }

    if (snap.exists()) {
      const mapped = mapUserProfileDoc(
        firebaseUser.uid,
        snap.data() as Record<string, unknown>,
        firebaseUser.displayName || 'User',
        firebaseUser.email || ''
      );

      // Non-blocking best-effort sync of non-PII userDirectory/{uid} if missing
      if (mapped.createdAt) {
        void (async () => {
          try {
            const dirSnap = await getDoc(dirRef);
            if (!dirSnap.exists()) {
              await setDoc(dirRef, {
                name: mapped.name.slice(0, 100),
                organization: (mapped.organization || '').slice(0, 100),
                department: (mapped.department || '').slice(0, 80),
                designation: (mapped.designation || '').slice(0, 80),
                employeeId: (mapped.employeeId || '').slice(0, 40),
                status: mapped.status,
                role: mapped.role,
                companies: mapped.companies,
                viewCompanies: mapped.viewCompanies,
                allowedUtilities: mapped.allowedUtilities || [],
                createdAt: mapped.createdAt,
                updatedAt: serverTimestamp(),
              });
            }
          } catch (dirErr) {
            console.warn('Non-fatal userDirectory ensure error:', dirErr);
          }
        })();
      }

      return mapped;
    }

    const email = firebaseUser.email || '';
    const isFirstAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const displayName =
      firebaseUser.displayName?.trim() ||
      email.split('@')[0] ||
      'User';
    const pendingOrg = consumePendingSignupOrg(email);

    const payload = {
      name: displayName.slice(0, 100),
      email: email.slice(0, 150),
      status: isFirstAdmin ? 'approved' : 'pending',
      role: isFirstAdmin ? 'admin' : 'viewer',
      companies: [] as string[],
      viewCompanies: [] as string[],
      ...(pendingOrg ? { organization: pendingOrg } : {}),
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(userRef, payload);
      const mapped = mapUserProfileDoc(
        firebaseUser.uid,
        payload,
        payload.name,
        payload.email
      );

      void (async () => {
        try {
          await setDoc(dirRef, {
            name: mapped.name.slice(0, 100),
            organization: (mapped.organization || '').slice(0, 100),
            department: '',
            designation: '',
            employeeId: '',
            status: mapped.status,
            role: mapped.role,
            companies: mapped.companies,
            viewCompanies: mapped.viewCompanies,
            allowedUtilities: mapped.allowedUtilities || [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (dirErr) {
          console.warn('Non-fatal userDirectory create error:', dirErr);
        }
      })();

      return mapped;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  }, []);

  const seedDefaultsIfNeeded = useCallback(async (force = false) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.emailVerified) return;

    try {
      const [compSnap, utilSnap] = await Promise.all([
        getDocs(collection(db, 'companies')),
        getDocs(collection(db, 'utilities')),
      ]);

      const batch = writeBatch(db);
      let hasWrites = false;

      // Only auto-seed default companies on a brand-new empty workspace (when utilities
      // are also empty) unless explicitly triggered via the Admin "Seed Default" button.
      if (compSnap.empty && (force || utilSnap.empty)) {
        for (const companyName of DEFAULT_COMPANIES) {
          const id = toSafeFirestoreId('comp', companyName);
          batch.set(doc(db, 'companies', id), {
            name: companyName,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
          });
          hasWrites = true;
        }
      }

      if (utilSnap.empty) {
        for (const util of DEFAULT_UTILITIES) {
          batch.set(doc(db, 'utilities', util.id), {
            name: util.name,
            unit: util.unit,
            color: util.color,
            order: util.order,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
          });
          hasWrites = true;
        }
      }

      if (hasWrites) {
        await batch.commit();
      }

      // Ensure publicConfig/companies is populated for the sign-up organization selector
      const latestCompSnap = compSnap.empty
        ? await getDocs(collection(db, 'companies'))
        : compSnap;
      const compNames = Array.from(
        new Set(
          latestCompSnap.docs
            .map((d) => String(d.data().name || '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      await setDoc(doc(db, 'publicConfig', 'companies'), {
        names: compNames,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'companies/utilities');
    }
  }, []);

  const formatProfileErrorMessage = useCallback((err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    if (
      raw.includes('the client is offline') ||
      raw.includes('unavailable') ||
      raw.includes('NOT_FOUND') ||
      raw.includes('timed out')
    ) {
      return `Unable to connect to Cloud Firestore. Ensure Cloud Firestore (${(firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)'} database) is enabled and Firestore rules are published in Firebase Console for this project.`;
    }
    if (raw.includes('Missing or insufficient permissions')) {
      return 'Firestore permission denied while loading your profile. Verify that firestore.rules are published in Firebase Console.';
    }
    return 'Unable to load your user profile from Firestore. Please check your Firebase configuration and try again.';
  }, []);

  const withTimeout = useCallback(
    async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timerId = setTimeout(() => {
              reject(new Error(`${label} timed out after ${ms}ms`));
            }, ms);
          }),
        ]);
      } finally {
        if (timerId !== undefined) clearTimeout(timerId);
      }
    },
    []
  );

  // Auth listener
  useEffect(() => {
    let active = true;
    const authSafetyTimer = setTimeout(() => {
      if (active) {
        setAuthReady(true);
      }
    }, 4000);

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(authSafetyTimer);
      if (!active) return;

      setUser(firebaseUser);
      setEmailVerified(Boolean(firebaseUser?.emailVerified));
      setProfile(null);
      setProfileError(null);
      seededRef.current = false;
      setAuthReady(true);

      if (!firebaseUser) {
        clearCachedGoogleAccessToken();
        setGoogleAccessToken(null);
        setProfileLoading(false);
        return;
      }

      if (firebaseUser.emailVerified) {
        setProfileLoading(true);
        try {
          await withTimeout(firebaseUser.getIdToken(false), 6000, 'Auth token check').catch(
            () => firebaseUser.getIdToken(true)
          );
          const ensured = await withTimeout(
            ensureUserProfile(firebaseUser),
            15000,
            'Firestore profile lookup'
          );
          if (active) {
            setProfile(ensured);
            setProfileError(null);
          }
        } catch (err) {
          console.error('Error ensuring profile:', err);
          if (active) {
            setProfileError(formatProfileErrorMessage(err));
          }
        } finally {
          if (active) {
            setProfileLoading(false);
          }
        }
      } else {
        setProfileLoading(false);
      }
    });

    const unsubToken = onIdTokenChanged(auth, (firebaseUser) => {
      if (!active) return;
      const verified = Boolean(firebaseUser?.emailVerified);
      setEmailVerified(verified);
      if (!firebaseUser || !verified) {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      clearTimeout(authSafetyTimer);
      unsub();
      unsubToken();
    };
  }, [ensureUserProfile, formatProfileErrorMessage, withTimeout]);

  // Real-time listener on own user profile once verified and loaded
  useEffect(() => {
    if (!authReady || !user || !emailVerified || !profile) return;

    const userPath = `users/${user.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(
            mapUserProfileDoc(
              user.uid,
              snap.data() as Record<string, unknown>,
              user.displayName || 'User',
              user.email || ''
            )
          );
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, userPath);
      }
    );

    return () => unsub();
  }, [authReady, user, emailVerified, profile?.uid]);

  // Seed default companies & utilities once when an approved admin logs in
  useEffect(() => {
    if (
      authReady &&
      emailVerified &&
      profile?.status === 'approved' &&
      profile?.role === 'admin' &&
      !seededRef.current
    ) {
      seededRef.current = true;
      void seedDefaultsIfNeeded();
    }
  }, [authReady, emailVerified, profile, seedDefaultsIfNeeded]);

  const viewCompaniesKey = (profile?.viewCompanies || []).join('|||');

  // Real-time data listeners only when approved
  useEffect(() => {
    if (!authReady || !user || !emailVerified || profile?.status !== 'approved') {
      setCompanies([]);
      setUtilities([]);
      setEntries([]);
      setGenerationEntries([]);
      setBudgets([]);
      setUserUnitRates([]);
      setAllUsers([]);
      setViewerDirectoryUsers([]);
      setSheetsConfig(null);
      setDataLoading(false);
      directoryBackfilledRef.current = false;
      return;
    }

    setDataLoading(true);
    let companiesLoaded = false;
    let utilitiesLoaded = false;
    let entriesLoaded = false;
    let generationLoaded = false;
    const markReady = () => {
      if (companiesLoaded && utilitiesLoaded && entriesLoaded && generationLoaded) {
        setDataLoading(false);
      }
    };

    const unsubCompanies = onSnapshot(
      query(collection(db, 'companies'), orderBy('name', 'asc')),
      (snap) => {
        const mappedCompanies = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name || ''),
            equipmentConfigured: Boolean(data.equipmentConfigured),
            boilerCount:
              typeof data.boilerCount === 'number' ? data.boilerCount : undefined,
            boilerFuelUnit:
              typeof data.boilerFuelUnit === 'string' ? data.boilerFuelUnit : 'm³',
            dieselGeneratorCount:
              typeof data.dieselGeneratorCount === 'number'
                ? data.dieselGeneratorCount
                : undefined,
            gasGeneratorCount:
              typeof data.gasGeneratorCount === 'number'
                ? data.gasGeneratorCount
                : undefined,
            solarCount:
              typeof data.solarCount === 'number' ? data.solarCount : undefined,
            gridProviders: Array.isArray(data.gridProviders)
              ? data.gridProviders.map(String)
              : [],
            gridHasPeakOffPeak: Boolean(data.gridHasPeakOffPeak),
            deviceConfigs:
              typeof data.deviceConfigs === 'string' ? data.deviceConfigs : undefined,
            createdBy: String(data.createdBy || ''),
            createdAt: data.createdAt ?? null,
          };
        });
        setCompanies(mappedCompanies);
        const liveNames = mappedCompanies.map((c) => c.name).filter(Boolean);
        if (liveNames.length > 0) {
          setPublicCompanies(liveNames);
        }
        companiesLoaded = true;
        markReady();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'companies');
      }
    );

    const unsubUtilities = onSnapshot(
      query(collection(db, 'utilities'), orderBy('order', 'asc')),
      (snap) => {
        setUtilities(
          snap.docs.map((d) => ({
            id: d.id,
            name: String(d.data().name || ''),
            unit: String(d.data().unit || ''),
            color: String(d.data().color || '#0F766E'),
            order: Number(d.data().order ?? 0),
            createdBy: String(d.data().createdBy || ''),
            createdAt: d.data().createdAt ?? null,
          }))
        );
        utilitiesLoaded = true;
        markReady();
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'utilities');
      }
    );

    const mapEntryDoc = (
      id: string,
      data: Record<string, unknown>
    ): UtilityEntry => ({
      id,
      date: String(data.date || ''),
      company: String(data.company || ''),
      utilityId: String(data.utilityId || ''),
      utilityName: String(data.utilityName || ''),
      unit: String(data.unit || ''),
      consumption: Number(data.consumption ?? 0),
      cost: Number(data.cost ?? 0),
      operatingHours:
        typeof data.operatingHours === 'number' ? data.operatingHours : 0,
      note: String(data.note || ''),
      enteredBy: String(data.enteredBy || ''),
      enteredByName: String(data.enteredByName || ''),
      createdAt: (data.createdAt as UtilityEntry['createdAt']) ?? null,
      updatedAt: (data.updatedAt as UtilityEntry['updatedAt']) ?? null,
    });

    let unsubEntries = () => {};
    if (profile.role === 'admin') {
      unsubEntries = onSnapshot(
        query(collection(db, 'utilityEntries'), orderBy('date', 'desc')),
        (snap) => {
          setEntries(
            snap.docs.map((d) => mapEntryDoc(d.id, d.data() as Record<string, unknown>))
          );
          entriesLoaded = true;
          markReady();
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'utilityEntries');
        }
      );
    } else {
      const allowedView = Array.from(
        new Set(
          (profile.viewCompanies || []).map((c) => c.trim()).filter(Boolean)
        )
      );

      if (allowedView.length === 0) {
        setEntries([]);
        entriesLoaded = true;
        markReady();
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < allowedView.length; i += 30) {
          chunks.push(allowedView.slice(i, i + 30));
        }

        const chunkMap = new Map<number, UtilityEntry[]>();
        const loadedChunks = new Set<number>();

        const chunkUnsubs = chunks.map((chunk, chunkIdx) =>
          onSnapshot(
            query(
              collection(db, 'utilityEntries'),
              where('company', 'in', chunk)
            ),
            (snap) => {
              chunkMap.set(
                chunkIdx,
                snap.docs.map((d) =>
                  mapEntryDoc(d.id, d.data() as Record<string, unknown>)
                )
              );
              loadedChunks.add(chunkIdx);

              const deduped = new Map<string, UtilityEntry>();
              for (const list of chunkMap.values()) {
                for (const item of list) {
                  deduped.set(item.id, item);
                }
              }
              const sorted = Array.from(deduped.values()).sort((a, b) =>
                b.date.localeCompare(a.date)
              );
              setEntries(sorted);

              if (loadedChunks.size === chunks.length) {
                entriesLoaded = true;
                markReady();
              }
            },
            (error) => {
              handleFirestoreError(error, OperationType.LIST, 'utilityEntries');
            }
          )
        );

        unsubEntries = () => {
          for (const fn of chunkUnsubs) fn();
        };
      }
    }

    const mapGenerationDoc = (
      id: string,
      data: Record<string, unknown>
    ): GenerationEntry => ({
      id,
      date: String(data.date || ''),
      company: String(data.company || ''),
      boilerCount: Number(data.boilerCount ?? 0),
      steamKg: Number(data.steamKg ?? 0),
      boilerFuelQty: Number(data.boilerFuelQty ?? 0),
      boilerFuelUnit: String(data.boilerFuelUnit || 'm³'),
      boilerFuelCost: Number(data.boilerFuelCost ?? 0),
      boilerOperatingHours:
        typeof data.boilerOperatingHours === 'number'
          ? data.boilerOperatingHours
          : undefined,
      generatorCount: Number(data.generatorCount ?? 0),
      generatorKwh: Number(data.generatorKwh ?? 0),
      generatorFuelQty: Number(data.generatorFuelQty ?? 0),
      generatorFuelUnit: String(data.generatorFuelUnit || 'm³'),
      generatorFuelCost: Number(data.generatorFuelCost ?? 0),
      generatorOperatingHours:
        typeof data.generatorOperatingHours === 'number'
          ? data.generatorOperatingHours
          : undefined,
      dieselGeneratorCount:
        typeof data.dieselGeneratorCount === 'number'
          ? data.dieselGeneratorCount
          : undefined,
      dieselGenKwh:
        typeof data.dieselGenKwh === 'number' ? data.dieselGenKwh : undefined,
      dieselFuelQty:
        typeof data.dieselFuelQty === 'number' ? data.dieselFuelQty : undefined,
      dieselFuelCost:
        typeof data.dieselFuelCost === 'number' ? data.dieselFuelCost : undefined,
      gasGeneratorCount:
        typeof data.gasGeneratorCount === 'number'
          ? data.gasGeneratorCount
          : undefined,
      gasGenKwh: typeof data.gasGenKwh === 'number' ? data.gasGenKwh : undefined,
      gasFuelQty: typeof data.gasFuelQty === 'number' ? data.gasFuelQty : undefined,
      gasFuelCost:
        typeof data.gasFuelCost === 'number' ? data.gasFuelCost : undefined,
      solarSystemCount: Number(data.solarSystemCount ?? 0),
      solarKwh: Number(data.solarKwh ?? 0),
      solarSavings: Number(data.solarSavings ?? 0),
      solarOperatingHours:
        typeof data.solarOperatingHours === 'number'
          ? data.solarOperatingHours
          : undefined,
      gridProviderBreakdown:
        typeof data.gridProviderBreakdown === 'string'
          ? data.gridProviderBreakdown
          : undefined,
      unitReadings:
        typeof data.unitReadings === 'string' ? data.unitReadings : undefined,
      note: String(data.note || ''),
      enteredBy: String(data.enteredBy || ''),
      enteredByName: String(data.enteredByName || ''),
      createdAt: (data.createdAt as GenerationEntry['createdAt']) ?? null,
      updatedAt: (data.updatedAt as GenerationEntry['updatedAt']) ?? null,
    });

    let unsubGeneration = () => {};
    if (profile.role === 'admin') {
      unsubGeneration = onSnapshot(
        query(collection(db, 'generationEntries'), orderBy('date', 'desc')),
        (snap) => {
          setGenerationEntries(
            snap.docs.map((d) => mapGenerationDoc(d.id, d.data() as Record<string, unknown>))
          );
          generationLoaded = true;
          markReady();
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'generationEntries');
        }
      );
    } else {
      const allowedView = Array.from(
        new Set(
          (profile.viewCompanies || []).map((c) => c.trim()).filter(Boolean)
        )
      );

      if (allowedView.length === 0) {
        setGenerationEntries([]);
        generationLoaded = true;
        markReady();
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < allowedView.length; i += 30) {
          chunks.push(allowedView.slice(i, i + 30));
        }

        const genChunkMap = new Map<number, GenerationEntry[]>();
        const genLoadedChunks = new Set<number>();

        const genChunkUnsubs = chunks.map((chunk, chunkIdx) =>
          onSnapshot(
            query(
              collection(db, 'generationEntries'),
              where('company', 'in', chunk)
            ),
            (snap) => {
              genChunkMap.set(
                chunkIdx,
                snap.docs.map((d) =>
                  mapGenerationDoc(d.id, d.data() as Record<string, unknown>)
                )
              );
              genLoadedChunks.add(chunkIdx);

              const deduped = new Map<string, GenerationEntry>();
              for (const list of genChunkMap.values()) {
                for (const item of list) {
                  deduped.set(item.id, item);
                }
              }
              const sorted = Array.from(deduped.values()).sort((a, b) =>
                b.date.localeCompare(a.date)
              );
              setGenerationEntries(sorted);

              if (genLoadedChunks.size === chunks.length) {
                generationLoaded = true;
                markReady();
              }
            },
            (error) => {
              handleFirestoreError(error, OperationType.LIST, 'generationEntries');
            }
          )
        );

        unsubGeneration = () => {
          for (const fn of genChunkUnsubs) fn();
        };
      }
    }

    const mapBudgetDoc = (
      id: string,
      data: Record<string, unknown>
    ): FactoryBudget => ({
      id,
      companyId: String(data.companyId || ''),
      companyName: String(data.companyName || ''),
      month: String(data.month || ''),
      monthlySpendLimit: Number(data.monthlySpendLimit ?? 0),
      monthlyCarbonCapKg:
        typeof data.monthlyCarbonCapKg === 'number'
          ? data.monthlyCarbonCapKg
          : undefined,
      targetSolarSharePct:
        typeof data.targetSolarSharePct === 'number'
          ? data.targetSolarSharePct
          : undefined,
      alertThresholdPct: Number(data.alertThresholdPct ?? 85),
      notes: typeof data.notes === 'string' ? data.notes : undefined,
      updatedBy: String(data.updatedBy || ''),
      updatedByName: String(data.updatedByName || ''),
      createdAt: (data.createdAt as FactoryBudget['createdAt']) ?? null,
      updatedAt: (data.updatedAt as FactoryBudget['updatedAt']) ?? null,
    });

    let unsubBudgets = () => {};
    if (profile.role === 'admin') {
      unsubBudgets = onSnapshot(
        query(collection(db, 'budgets'), orderBy('month', 'desc')),
        (snap) => {
          setBudgets(
            snap.docs.map((d) => mapBudgetDoc(d.id, d.data() as Record<string, unknown>))
          );
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'budgets');
        }
      );
    } else {
      const allowedView = Array.from(
        new Set(
          (profile.viewCompanies || []).map((c) => c.trim()).filter(Boolean)
        )
      );
      if (allowedView.length === 0) {
        setBudgets([]);
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < allowedView.length; i += 30) {
          chunks.push(allowedView.slice(i, i + 30));
        }
        const budgetChunkMap = new Map<number, FactoryBudget[]>();
        const budgetUnsubs = chunks.map((chunk, chunkIdx) =>
          onSnapshot(
            query(collection(db, 'budgets'), where('companyName', 'in', chunk)),
            (snap) => {
              budgetChunkMap.set(
                chunkIdx,
                snap.docs.map((d) =>
                  mapBudgetDoc(d.id, d.data() as Record<string, unknown>)
                )
              );
              const deduped = new Map<string, FactoryBudget>();
              for (const list of budgetChunkMap.values()) {
                for (const item of list) deduped.set(item.id, item);
              }
              setBudgets(
                Array.from(deduped.values()).sort((a, b) =>
                  b.month.localeCompare(a.month)
                )
              );
            },
            (error) => {
              handleFirestoreError(error, OperationType.LIST, 'budgets');
            }
          )
        );
        unsubBudgets = () => {
          for (const fn of budgetUnsubs) fn();
        };
      }
    }

    let unsubSheetsConfig = () => {};
    if (profile.role === 'admin') {
      unsubSheetsConfig = onSnapshot(
        doc(db, 'integrations', 'googleSheets'),
        (snap) => {
          if (!snap.exists()) {
            setSheetsConfig(null);
            return;
          }
          const data = snap.data();
          const autoEnabled =
            data.autoSyncEnabled !== undefined ? Boolean(data.autoSyncEnabled) : true;
          const rawInterval = Number(data.autoSyncIntervalSec ?? 30);
          const intervalSec =
            Number.isFinite(rawInterval) && rawInterval >= 15 && rawInterval <= 3600
              ? Math.round(rawInterval)
              : 30;
          const rawDir = String(data.lastSyncDirection || 'none');
          const lastSyncDirection: GoogleSheetsSyncDirection =
            rawDir === 'push' || rawDir === 'pull' || rawDir === 'bidirectional'
              ? rawDir
              : 'none';
          const cfg: GoogleSheetsConfig = {
            spreadsheetId: String(data.spreadsheetId || ''),
            spreadsheetUrl: String(data.spreadsheetUrl || ''),
            spreadsheetTitle: String(data.spreadsheetTitle || ''),
            sheetName: String(data.sheetName || ''),
            syncMode:
              data.syncMode === 'appsScript' ? 'appsScript' : 'oauth',
            webhookUrl: String(data.webhookUrl || ''),
            autoSyncEnabled: autoEnabled,
            autoSyncIntervalSec: intervalSec,
            lastSyncedHash: String(data.lastSyncedHash || ''),
            lastSyncDirection,
            lastSyncSummary: String(data.lastSyncSummary || ''),
            lastSyncedCount: Number(data.lastSyncedCount ?? 0),
            lastSyncedAt: data.lastSyncedAt ?? null,
            updatedBy: String(data.updatedBy || ''),
            updatedAt: data.updatedAt ?? null,
          };
          if (cfg.lastSyncedHash && !lastCompletedSyncHashRef.current) {
            lastCompletedSyncHashRef.current = cfg.lastSyncedHash;
          }
          setSheetsConfig(cfg);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, 'integrations/googleSheets');
        }
      );
    } else {
      setSheetsConfig(null);
    }

    let unsubUsers = () => {};
    if (profile.role === 'admin') {
      unsubUsers = onSnapshot(
        query(collection(db, 'users'), orderBy('createdAt', 'desc')),
        (snap) => {
          const mappedUsers = snap.docs.map((d) =>
            mapUserProfileDoc(d.id, d.data() as Record<string, unknown>, '', '')
          );
          setAllUsers(mappedUsers);

          if (!directoryBackfilledRef.current && mappedUsers.length > 0) {
            directoryBackfilledRef.current = true;
            void (async () => {
              try {
                const dirSnap = await getDocs(collection(db, 'userDirectory'));
                const existingDirIds = new Set(dirSnap.docs.map((docItem) => docItem.id));
                const missingUsers = mappedUsers.filter(
                  (u) => !existingDirIds.has(u.uid) && u.createdAt
                );
                if (missingUsers.length > 0) {
                  for (let i = 0; i < missingUsers.length; i += 400) {
                    const chunk = missingUsers.slice(i, i + 400);
                    const batch = writeBatch(db);
                    for (const u of chunk) {
                      batch.set(doc(db, 'userDirectory', u.uid), {
                        name: (u.name || 'User').slice(0, 100),
                        organization: (u.organization || '').slice(0, 100),
                        department: (u.department || '').slice(0, 80),
                        designation: (u.designation || '').slice(0, 80),
                        employeeId: (u.employeeId || '').slice(0, 40),
                        status: u.status,
                        role: u.role,
                        companies: u.companies,
                        viewCompanies: u.viewCompanies,
                        allowedUtilities: u.allowedUtilities || [],
                        createdAt: u.createdAt,
                        updatedAt: serverTimestamp(),
                      });
                    }
                    await batch.commit();
                  }
                }
              } catch (err) {
                console.warn('Non-fatal userDirectory backfill warning:', err);
              }
            })();
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'users');
        }
      );
    } else {
      setAllUsers([]);
    }

    let unsubDirectory = () => {};
    if (profile.role === 'viewer') {
      unsubDirectory = onSnapshot(
        collection(db, 'userDirectory'),
        (snap) => {
          const list: UserDirectoryEntry[] = snap.docs.map((d) => {
            const data = d.data();
            return {
              uid: d.id,
              name: String(data.name || 'User'),
              organization: String(data.organization || ''),
              department: String(data.department || ''),
              designation: String(data.designation || ''),
              employeeId: String(data.employeeId || ''),
              status: data.status as UserDirectoryEntry['status'],
              role: data.role as UserDirectoryEntry['role'],
              companies: Array.isArray(data.companies) ? data.companies.map(String) : [],
              viewCompanies: Array.isArray(data.viewCompanies)
                ? data.viewCompanies.map(String)
                : [],
              allowedUtilities: Array.isArray(data.allowedUtilities)
                ? data.allowedUtilities.map(String)
                : [],
              createdAt: data.createdAt ?? null,
              updatedAt: data.updatedAt ?? null,
            };
          });
          list.sort((a, b) => a.name.localeCompare(b.name));
          setViewerDirectoryUsers(list);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'userDirectory');
        }
      );
    } else {
      setViewerDirectoryUsers([]);
    }

    const unsubUserUnitRates = onSnapshot(
      collection(db, 'users', user.uid, 'unitRates'),
      (snap) => {
        setUserUnitRates(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              company: String(data.company || ''),
              utilityId: String(data.utilityId || ''),
              unitCost: Number(data.unitCost ?? 0),
              updatedAt: data.updatedAt ?? null,
            };
          })
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/unitRates`);
      }
    );

    return () => {
      unsubCompanies();
      unsubUtilities();
      unsubEntries();
      unsubGeneration();
      unsubBudgets();
      unsubSheetsConfig();
      unsubUsers();
      unsubDirectory();
      unsubUserUnitRates();
    };
  }, [authReady, user, emailVerified, profile?.status, profile?.role, viewCompaniesKey]);

  const signUpWithEmail = useCallback(
    async (name: string, email: string, password: string, organization?: string) => {
      if (organization) {
        savePendingSignupOrg(email, organization);
      }
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await sendEmailVerification(cred.user);
      setUser(cred.user);
      setAuthTick((t) => t + 1);
    },
    []
  );

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithGoogleAccount();
  }, []);

  const updateOwnProfile = useCallback(
    async (updates: OwnProfileUpdates) => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');
      if (!profile) throw new Error('User profile is not loaded yet.');

      const cleanName = updates.name.trim().slice(0, 100);
      if (!cleanName) throw new Error('Full name is required.');

      const cleanOrg = updates.organization.trim().slice(0, 100);
      const cleanDept = updates.department.trim().slice(0, 80);
      const cleanDesig = updates.designation.trim().slice(0, 80);
      const cleanPhone = updates.phone.trim().slice(0, 30);
      const cleanEmpId = updates.employeeId.trim().slice(0, 40);

      const userPath = `users/${current.uid}`;
      const dirPath = `userDirectory/${current.uid}`;
      try {
        await updateDoc(doc(db, 'users', current.uid), {
          name: cleanName,
          organization: cleanOrg,
          department: cleanDept,
          designation: cleanDesig,
          phone: cleanPhone,
          employeeId: cleanEmpId,
        });

        if (cleanName !== (current.displayName || '').trim()) {
          try {
            await updateProfile(current, { displayName: cleanName });
          } catch {
            // Non-fatal auth displayName sync
          }
        }

        const dirRef = doc(db, 'userDirectory', current.uid);
        const dirSnap = await getDoc(dirRef);
        if (dirSnap.exists()) {
          await updateDoc(dirRef, {
            name: cleanName,
            organization: cleanOrg,
            department: cleanDept,
            designation: cleanDesig,
            employeeId: cleanEmpId,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(dirRef, {
            name: cleanName,
            organization: cleanOrg,
            department: cleanDept,
            designation: cleanDesig,
            employeeId: cleanEmpId,
            status: profile.status,
            role: profile.role,
            companies: profile.companies || [],
            viewCompanies: profile.viewCompanies || [],
            allowedUtilities: profile.allowedUtilities || [],
            createdAt: profile.createdAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `${userPath} / ${dirPath}`);
      }
    },
    [profile]
  );

  const adminUpdateUser = useCallback(
    async (target: UserProfile, updates: AdminUserUpdates) => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');

      const isSelf = target.uid === current.uid;
      if (isSelf && (updates.status !== undefined || updates.role !== undefined)) {
        throw new Error('You cannot demote or reject your own administrator account.');
      }

      const sanitizedUserUpdates: Record<string, unknown> = {};
      const sanitizedDirUpdates: Record<string, unknown> = {};

      if (updates.status !== undefined) {
        sanitizedUserUpdates.status = updates.status;
        sanitizedDirUpdates.status = updates.status;
      }
      if (updates.role !== undefined) {
        sanitizedUserUpdates.role = updates.role;
        sanitizedDirUpdates.role = updates.role;
      }
      if (updates.companies !== undefined) {
        sanitizedUserUpdates.companies = updates.companies;
        sanitizedDirUpdates.companies = updates.companies;
      }
      if (updates.viewCompanies !== undefined) {
        sanitizedUserUpdates.viewCompanies = updates.viewCompanies;
        sanitizedDirUpdates.viewCompanies = updates.viewCompanies;
      }
      if (updates.allowedUtilities !== undefined) {
        sanitizedUserUpdates.allowedUtilities = updates.allowedUtilities;
        sanitizedDirUpdates.allowedUtilities = updates.allowedUtilities;
      }
      if (updates.name !== undefined) {
        const cleanName = updates.name.trim().slice(0, 100) || target.name;
        sanitizedUserUpdates.name = cleanName;
        sanitizedDirUpdates.name = cleanName;
      }
      if (updates.organization !== undefined) {
        const cleanOrg = updates.organization.trim().slice(0, 100);
        sanitizedUserUpdates.organization = cleanOrg;
        sanitizedDirUpdates.organization = cleanOrg;
      }
      if (updates.department !== undefined) {
        const cleanDept = updates.department.trim().slice(0, 80);
        sanitizedUserUpdates.department = cleanDept;
        sanitizedDirUpdates.department = cleanDept;
      }
      if (updates.designation !== undefined) {
        const cleanDesig = updates.designation.trim().slice(0, 80);
        sanitizedUserUpdates.designation = cleanDesig;
        sanitizedDirUpdates.designation = cleanDesig;
      }
      if (updates.phone !== undefined) {
        sanitizedUserUpdates.phone = updates.phone.trim().slice(0, 30);
      }
      if (updates.employeeId !== undefined) {
        const cleanEmpId = updates.employeeId.trim().slice(0, 40);
        sanitizedUserUpdates.employeeId = cleanEmpId;
        sanitizedDirUpdates.employeeId = cleanEmpId;
      }
      if (updates.dailyMailEnabled !== undefined) {
        sanitizedUserUpdates.dailyMailEnabled = Boolean(updates.dailyMailEnabled);
      }
      if (updates.dailyMailEmail !== undefined) {
        sanitizedUserUpdates.dailyMailEmail = updates.dailyMailEmail
          .trim()
          .slice(0, 150);
      }
      if (updates.dailyMailTime !== undefined) {
        const rawTime = updates.dailyMailTime.trim();
        sanitizedUserUpdates.dailyMailTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(
          rawTime
        )
          ? rawTime
          : '';
      }
      if (updates.lastDailyMailSentDate !== undefined) {
        const rawSentDate = updates.lastDailyMailSentDate.trim();
        sanitizedUserUpdates.lastDailyMailSentDate = /^\d{4}-\d{2}-\d{2}$/.test(
          rawSentDate
        )
          ? rawSentDate
          : '';
      }

      if (Object.keys(sanitizedUserUpdates).length === 0) return;

      const userPath = `users/${target.uid}`;
      try {
        await updateDoc(doc(db, 'users', target.uid), sanitizedUserUpdates);

        const dirRef = doc(db, 'userDirectory', target.uid);
        const dirSnap = await getDoc(dirRef);
        if (dirSnap.exists()) {
          if (Object.keys(sanitizedDirUpdates).length > 0) {
            await updateDoc(dirRef, {
              ...sanitizedDirUpdates,
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          await setDoc(dirRef, {
            name: String(sanitizedDirUpdates.name ?? target.name).slice(0, 100),
            organization: String(
              sanitizedDirUpdates.organization ?? target.organization ?? ''
            ).slice(0, 100),
            department: String(
              sanitizedDirUpdates.department ?? target.department ?? ''
            ).slice(0, 80),
            designation: String(
              sanitizedDirUpdates.designation ?? target.designation ?? ''
            ).slice(0, 80),
            employeeId: String(
              sanitizedDirUpdates.employeeId ?? target.employeeId ?? ''
            ).slice(0, 40),
            status: (sanitizedDirUpdates.status ?? target.status) as UserProfile['status'],
            role: (sanitizedDirUpdates.role ?? target.role) as UserProfile['role'],
            companies: (sanitizedDirUpdates.companies ?? target.companies) as string[],
            viewCompanies: (sanitizedDirUpdates.viewCompanies ?? target.viewCompanies) as string[],
            allowedUtilities: (sanitizedDirUpdates.allowedUtilities ??
              target.allowedUtilities ??
              []) as string[],
            createdAt: target.createdAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    },
    []
  );

  const connectGoogleSheets = useCallback(async (): Promise<string> => {
    const token = await authorizeGoogleSheetsForCurrentUser();
    setGoogleAccessToken(token);
    return token;
  }, []);

  const clearGoogleToken = useCallback(() => {
    clearCachedGoogleAccessToken();
    setGoogleAccessToken(null);
  }, []);

  const saveSheetsConfig = useCallback(
    async (config: {
      spreadsheetId: string;
      spreadsheetUrl: string;
      spreadsheetTitle: string;
      sheetName: string;
      syncMode?: GoogleSheetsSyncMode;
      webhookUrl?: string;
      autoSyncEnabled?: boolean;
      autoSyncIntervalSec?: number;
      lastSyncedCount?: number;
    }) => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');
      const path = 'integrations/googleSheets';
      const snap = computeRecordHashSnapshot(entries, generationEntries, utilities, companies);
      const rawInterval = Number(config.autoSyncIntervalSec ?? 30);
      const safeInterval =
        Number.isFinite(rawInterval) && rawInterval >= 15 && rawInterval <= 3600
          ? Math.round(rawInterval)
          : 30;
      const autoSyncEnabled =
        config.autoSyncEnabled !== undefined ? Boolean(config.autoSyncEnabled) : true;
      const count = config.lastSyncedCount ?? 0;

      try {
        await setDoc(doc(db, 'integrations', 'googleSheets'), {
          spreadsheetId: config.spreadsheetId.slice(0, 128),
          spreadsheetUrl: config.spreadsheetUrl.slice(0, 300),
          spreadsheetTitle: config.spreadsheetTitle.slice(0, 150),
          sheetName: config.sheetName.slice(0, 100),
          syncMode: config.syncMode || 'oauth',
          webhookUrl: (config.webhookUrl || '').slice(0, 300),
          autoSyncEnabled,
          autoSyncIntervalSec: safeInterval,
          lastSyncedHash: snap.overallHash,
          lastSyncDirection: count > 0 ? 'push' : 'none',
          lastSyncSummary: count > 0 ? `Connected & synced ${count} rows` : 'Connected',
          lastSyncedCount: count,
          lastSyncedAt: serverTimestamp(),
          updatedBy: current.uid,
          updatedAt: serverTimestamp(),
        });
        lastCompletedSyncHashRef.current = snap.overallHash;
        saveSheetsBaseline(config.spreadsheetId.slice(0, 128), snap);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [entries, generationEntries, utilities, companies]
  );

  const toggleAutoSync = useCallback(
    async (enabled: boolean, intervalSec?: number) => {
      const current = auth.currentUser;
      if (!current || !profile || profile.role !== 'admin') {
        throw new Error('Only administrators can configure Google Sheets auto-sync.');
      }
      if (!sheetsConfig) throw new Error('No Google Sheet connected.');
      const nextIntervalRaw = intervalSec ?? sheetsConfig.autoSyncIntervalSec ?? 30;
      const safeInterval = Math.min(3600, Math.max(15, Math.round(nextIntervalRaw)));

      try {
        await updateDoc(doc(db, 'integrations', 'googleSheets'), {
          autoSyncEnabled: enabled,
          autoSyncIntervalSec: safeInterval,
          updatedBy: current.uid,
          updatedAt: serverTimestamp(),
        });
        setAutoSyncState((prev) => ({
          ...prev,
          status: enabled ? 'idle' : 'disabled',
          lastResultText: enabled
            ? `Automatic two-way sync enabled (every ${safeInterval}s)`
            : 'Automatic sync paused',
        }));
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'integrations/googleSheets');
      }
    },
    [profile, sheetsConfig]
  );

  const removeSheetsConfig = useCallback(async () => {
    const path = 'integrations/googleSheets';
    const prevId = sheetsConfig?.spreadsheetId || '';
    try {
      await deleteDoc(doc(db, 'integrations', 'googleSheets'));
      if (prevId) clearSheetsBaseline(prevId);
      lastCompletedSyncHashRef.current = '';
      setAutoSyncState(DEFAULT_AUTO_SYNC_STATE);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }, [sheetsConfig?.spreadsheetId]);

  const applyPulledChangesToFirestore = useCallback(
    async (params: {
      plan: ReconciliationPlan;
      currentUserUid: string;
      actorName: string;
      baseEntries: UtilityEntry[];
      baseGeneration: GenerationEntry[];
      baseCompanies: CompanyItem[];
    }): Promise<{
      created: number;
      updated: number;
      generationUpdated: number;
      createdCompanies: number;
      nextEntries: UtilityEntry[];
      nextGeneration: GenerationEntry[];
      nextCompanies: CompanyItem[];
    }> => {
      const {
        plan,
        currentUserUid,
        actorName,
        baseEntries,
        baseGeneration,
        baseCompanies,
      } = params;

      const nextCompanies = [...baseCompanies];
      let createdCompanies = 0;

      if (plan.newCompanies.length > 0) {
        const compBatch = writeBatch(db);
        const existingLower = new Set(baseCompanies.map((c) => c.name.trim().toLowerCase()));
        let addedAny = false;
        plan.newCompanies.forEach((companyName, idx) => {
          const cleanName = companyName.trim().slice(0, 100);
          if (!cleanName || existingLower.has(cleanName.toLowerCase())) return;
          existingLower.add(cleanName.toLowerCase());
          const compId = toSafeFirestoreId('comp', `${cleanName}_${Date.now()}_${idx}`);
          compBatch.set(doc(db, 'companies', compId), {
            name: cleanName,
            createdBy: currentUserUid,
            createdAt: serverTimestamp(),
          });
          nextCompanies.push({
            id: compId,
            name: cleanName,
            createdBy: currentUserUid,
            createdAt: null,
          });
          createdCompanies += 1;
          addedAny = true;
        });
        if (addedAny) {
          await compBatch.commit();
          await syncPublicCompanies(nextCompanies.map((c) => c.name));
        }
      }

      const nextEntryMap = new Map<string, UtilityEntry>();
      const entryByCompMap = new Map<string, string>();
      for (const e of baseEntries) {
        nextEntryMap.set(e.id, e);
        entryByCompMap.set(makeUtilityCompositeKey(e.date, e.company, e.utilityId), e.id);
      }

      const validIdRe = /^[a-zA-Z0-9_-]{1,128}$/;
      const dedupedUtilOps = new Map<
        string,
        {
          mode: 'create' | 'update';
          targetId: string;
          existingEnteredBy?: string;
          item: (typeof plan.utilityOps)[number]['item'];
        }
      >();

      for (const op of plan.utilityOps) {
        const compKey = makeUtilityCompositeKey(
          op.item.date,
          op.item.company,
          op.item.utilityId
        );
        const existingId =
          (op.targetId && nextEntryMap.has(op.targetId) ? op.targetId : undefined) ||
          entryByCompMap.get(compKey);
        if (existingId) {
          const existingRec = nextEntryMap.get(existingId);
          dedupedUtilOps.set(existingId, {
            mode: 'update',
            targetId: existingId,
            existingEnteredBy: op.existingEnteredBy || existingRec?.enteredBy,
            item: op.item,
          });
        } else {
          const newId =
            op.targetId && validIdRe.test(op.targetId) && !nextEntryMap.has(op.targetId)
              ? op.targetId
              : toSafeFirestoreId('entry', compKey);
          dedupedUtilOps.set(newId, {
            mode: 'create',
            targetId: newId,
            item: op.item,
          });
        }
      }

      let created = 0;
      let updated = 0;
      const utilOpsList = Array.from(dedupedUtilOps.values());
      for (let i = 0; i < utilOpsList.length; i += 400) {
        const chunk = utilOpsList.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const op of chunk) {
          const ref = doc(db, 'utilityEntries', op.targetId);
          const safeEnteredByName =
            (op.item.enteredByName || actorName || 'Sheet Sync')
              .trim()
              .slice(0, 100) || 'Sheet Sync';
          const safeConsumption = Math.min(1000000000, Math.max(0, op.item.consumption));
          const safeOperatingHours = Math.min(24, Math.max(0, op.item.operatingHours || 0));
          const safeCost = Math.min(100000000000, Math.max(0, op.item.cost));
          const safeNote = (op.item.note || '').slice(0, 300);

          if (op.mode === 'update') {
            const existingRec = nextEntryMap.get(op.targetId);
            const enteredByUid = op.existingEnteredBy || currentUserUid;
            batch.update(ref, {
              company: op.item.company.slice(0, 100),
              utilityName: op.item.utilityName.slice(0, 80),
              unit: op.item.unit.slice(0, 30),
              consumption: safeConsumption,
              cost: safeCost,
              operatingHours: safeOperatingHours,
              note: safeNote,
              enteredBy: enteredByUid,
              enteredByName: safeEnteredByName,
              updatedAt: serverTimestamp(),
            });
            nextEntryMap.set(op.targetId, {
              id: op.targetId,
              date: op.item.date,
              company: op.item.company.slice(0, 100),
              utilityId: op.item.utilityId,
              utilityName: op.item.utilityName.slice(0, 80),
              unit: op.item.unit.slice(0, 30),
              consumption: safeConsumption,
              cost: safeCost,
              operatingHours: safeOperatingHours,
              note: safeNote,
              enteredBy: enteredByUid,
              enteredByName: safeEnteredByName,
              createdAt: existingRec?.createdAt ?? null,
              updatedAt: existingRec?.updatedAt ?? null,
            });
            updated += 1;
          } else {
            batch.set(ref, {
              date: op.item.date,
              company: op.item.company.slice(0, 100),
              utilityId: op.item.utilityId,
              utilityName: op.item.utilityName.slice(0, 80),
              unit: op.item.unit.slice(0, 30),
              consumption: safeConsumption,
              cost: safeCost,
              operatingHours: safeOperatingHours,
              note: safeNote,
              enteredBy: currentUserUid,
              enteredByName: safeEnteredByName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            nextEntryMap.set(op.targetId, {
              id: op.targetId,
              date: op.item.date,
              company: op.item.company.slice(0, 100),
              utilityId: op.item.utilityId,
              utilityName: op.item.utilityName.slice(0, 80),
              unit: op.item.unit.slice(0, 30),
              consumption: safeConsumption,
              cost: safeCost,
              operatingHours: safeOperatingHours,
              note: safeNote,
              enteredBy: currentUserUid,
              enteredByName: safeEnteredByName,
              createdAt: null,
              updatedAt: null,
            });
            created += 1;
          }
        }
        await batch.commit();
      }

      // Apply generationEntries creates/updates from Factory - YYYY tabs
      const nextGenMap = new Map<string, GenerationEntry>();
      const genByCompMap = new Map<string, string>();
      for (const g of baseGeneration) {
        nextGenMap.set(g.id, g);
        genByCompMap.set(makeGenerationCompositeKey(g.date, g.company), g.id);
      }

      let generationUpdated = 0;
      for (let i = 0; i < plan.generationOps.length; i += 400) {
        const chunk = plan.generationOps.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const op of chunk) {
          const gKey = makeGenerationCompositeKey(op.item.date, op.item.company);
          const existingId =
            (op.targetId && nextGenMap.has(op.targetId) ? op.targetId : undefined) ||
            genByCompMap.get(gKey);
          const targetId = existingId || toSafeFirestoreId('gen', gKey);
          const ref = doc(db, 'generationEntries', targetId);
          const safeEnteredByName =
            (op.item.enteredByName || actorName || 'Sheet Sync')
              .trim()
              .slice(0, 100) || 'Sheet Sync';

          const clampNum = (v: number, max: number) =>
            Math.min(max, Math.max(0, Number(v) || 0));

          if (existingId && op.existingEntry) {
            const prev = op.existingEntry;
            const nextBoilerHours = op.item.hasBoilerData
              ? clampNum(op.item.boilerOperatingHours, 1000)
              : prev.boilerOperatingHours ?? 0;
            const nextSteamKg = op.item.hasBoilerData
              ? clampNum(op.item.steamKg, 1000000000)
              : prev.steamKg;
            const nextBoilerFuelQty = op.item.hasBoilerData
              ? clampNum(op.item.boilerFuelQty, 1000000000)
              : prev.boilerFuelQty;
            const nextBoilerFuelCost = op.item.hasBoilerData
              ? clampNum(op.item.boilerFuelCost, 100000000000)
              : prev.boilerFuelCost;
            const nextBoilerCount =
              op.item.hasBoilerData && prev.boilerCount === 0 && nextSteamKg + nextBoilerFuelQty + nextBoilerFuelCost > 0
                ? 1
                : prev.boilerCount;

            const nextGenHours = op.item.hasGeneratorData
              ? clampNum(op.item.generatorOperatingHours, 1000)
              : prev.generatorOperatingHours ?? 0;
            const nextGenKwh = op.item.hasGeneratorData
              ? clampNum(op.item.generatorKwh, 1000000000)
              : prev.generatorKwh;
            const nextGenFuelQty = op.item.hasGeneratorData
              ? clampNum(op.item.generatorFuelQty, 1000000000)
              : prev.generatorFuelQty;
            const nextGenFuelCost = op.item.hasGeneratorData
              ? clampNum(op.item.generatorFuelCost, 100000000000)
              : prev.generatorFuelCost;
            const nextGenCount =
              op.item.hasGeneratorData && prev.generatorCount === 0 && nextGenKwh + nextGenFuelQty + nextGenFuelCost > 0
                ? 1
                : prev.generatorCount;

            const nextSolarHours = op.item.hasSolarData
              ? clampNum(op.item.solarOperatingHours, 1000)
              : prev.solarOperatingHours ?? 0;
            const nextSolarKwh = op.item.hasSolarData
              ? clampNum(op.item.solarKwh, 1000000000)
              : prev.solarKwh;
            const nextSolarSavings = op.item.hasSolarData
              ? clampNum(op.item.solarSavings, 100000000000)
              : prev.solarSavings;
            const nextSolarCount =
              op.item.hasSolarData && prev.solarSystemCount === 0 && nextSolarKwh + nextSolarSavings > 0
                ? 1
                : prev.solarSystemCount;

            const enteredByUid = op.existingEnteredBy || prev.enteredBy || currentUserUid;
            const nextEnteredByName = prev.enteredByName || safeEnteredByName;

            batch.update(ref, {
              company: op.item.company.slice(0, 100),
              boilerCount: nextBoilerCount,
              steamKg: nextSteamKg,
              boilerFuelQty: nextBoilerFuelQty,
              boilerFuelUnit: (prev.boilerFuelUnit || 'm³').slice(0, 30),
              boilerFuelCost: nextBoilerFuelCost,
              boilerOperatingHours: nextBoilerHours,
              generatorCount: nextGenCount,
              generatorKwh: nextGenKwh,
              generatorFuelQty: nextGenFuelQty,
              generatorFuelUnit: (prev.generatorFuelUnit || 'm³').slice(0, 30),
              generatorFuelCost: nextGenFuelCost,
              generatorOperatingHours: nextGenHours,
              solarSystemCount: nextSolarCount,
              solarKwh: nextSolarKwh,
              solarSavings: nextSolarSavings,
              solarOperatingHours: nextSolarHours,
              enteredBy: enteredByUid,
              enteredByName: nextEnteredByName,
              updatedAt: serverTimestamp(),
            });

            nextGenMap.set(targetId, {
              ...prev,
              company: op.item.company.slice(0, 100),
              boilerCount: nextBoilerCount,
              steamKg: nextSteamKg,
              boilerFuelQty: nextBoilerFuelQty,
              boilerFuelCost: nextBoilerFuelCost,
              boilerOperatingHours: nextBoilerHours,
              generatorCount: nextGenCount,
              generatorKwh: nextGenKwh,
              generatorFuelQty: nextGenFuelQty,
              generatorFuelCost: nextGenFuelCost,
              generatorOperatingHours: nextGenHours,
              solarSystemCount: nextSolarCount,
              solarKwh: nextSolarKwh,
              solarSavings: nextSolarSavings,
              solarOperatingHours: nextSolarHours,
              enteredBy: enteredByUid,
              enteredByName: nextEnteredByName,
            });
            generationUpdated += 1;
          } else {
            const boilerCount =
              op.item.steamKg + op.item.boilerFuelQty + op.item.boilerFuelCost + op.item.boilerOperatingHours > 0
                ? 1
                : 0;
            const generatorCount =
              op.item.generatorKwh + op.item.generatorFuelQty + op.item.generatorFuelCost + op.item.generatorOperatingHours > 0
                ? 1
                : 0;
            const solarSystemCount =
              op.item.solarKwh + op.item.solarSavings + op.item.solarOperatingHours > 0
                ? 1
                : 0;

            const newGen: Omit<GenerationEntry, 'id' | 'createdAt' | 'updatedAt'> = {
              date: op.item.date,
              company: op.item.company.slice(0, 100),
              boilerCount,
              steamKg: clampNum(op.item.steamKg, 1000000000),
              boilerFuelQty: clampNum(op.item.boilerFuelQty, 1000000000),
              boilerFuelUnit: 'm³',
              boilerFuelCost: clampNum(op.item.boilerFuelCost, 100000000000),
              boilerOperatingHours: clampNum(op.item.boilerOperatingHours, 1000),
              generatorCount,
              generatorKwh: clampNum(op.item.generatorKwh, 1000000000),
              generatorFuelQty: clampNum(op.item.generatorFuelQty, 1000000000),
              generatorFuelUnit: 'm³',
              generatorFuelCost: clampNum(op.item.generatorFuelCost, 100000000000),
              generatorOperatingHours: clampNum(op.item.generatorOperatingHours, 1000),
              solarSystemCount,
              solarKwh: clampNum(op.item.solarKwh, 1000000000),
              solarSavings: clampNum(op.item.solarSavings, 100000000000),
              solarOperatingHours: clampNum(op.item.solarOperatingHours, 1000),
              note: op.item.note.slice(0, 300),
              enteredBy: currentUserUid,
              enteredByName: safeEnteredByName,
            };

            batch.set(ref, {
              ...newGen,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            nextGenMap.set(targetId, {
              id: targetId,
              ...newGen,
              createdAt: null,
              updatedAt: null,
            });
            generationUpdated += 1;
          }
        }
        await batch.commit();
      }

      const nextEntries = Array.from(nextEntryMap.values()).sort((a, b) =>
        b.date.localeCompare(a.date)
      );
      const nextGeneration = Array.from(nextGenMap.values()).sort((a, b) =>
        b.date.localeCompare(a.date)
      );

      return {
        created,
        updated,
        generationUpdated,
        createdCompanies,
        nextEntries,
        nextGeneration,
        nextCompanies,
      };
    },
    [syncPublicCompanies]
  );

  const runTwoWaySyncNow = useCallback(
    async (options?: {
      forceDirection?: 'bidirectional' | 'push' | 'pull';
      entriesOverride?: UtilityEntry[];
      generationEntriesOverride?: GenerationEntry[];
      utilitiesOverride?: UtilityItem[];
      companiesOverride?: CompanyItem[];
      ensureTabKeys?: Array<{ company: string; monthKey: string }>;
      pruneStaleTabs?: boolean;
      silent?: boolean;
    }): Promise<TwoWaySyncResult> => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');
      if (!profile || profile.role !== 'admin') {
        throw new Error('Only administrators can sync with Google Sheets.');
      }
      if (!sheetsConfig) throw new Error('No Google Sheet connected.');

      const hasOverrides = Boolean(
        options?.entriesOverride ||
          options?.generationEntriesOverride ||
          options?.utilitiesOverride ||
          options?.companiesOverride ||
          options?.forceDirection
      );

      if (syncInFlightRef.current) {
        if (!hasOverrides) {
          return syncInFlightRef.current;
        }
        await syncInFlightRef.current.catch(() => null);
      }

      const execute = async (): Promise<TwoWaySyncResult> => {
        const directionMode = options?.forceDirection || 'bidirectional';
        let workingEntries = options?.entriesOverride ?? entries;
        let workingGen = options?.generationEntriesOverride ?? generationEntries;
        const workingUtilities = options?.utilitiesOverride ?? utilities;
        let workingCompanies = options?.companiesOverride ?? companies;

        const isAppsScript = sheetsConfig.syncMode === 'appsScript';
        const token = isAppsScript
          ? null
          : googleAccessToken || getCachedGoogleAccessToken();

        if (!isAppsScript && !token) {
          setAutoSyncState((prev) => ({
            ...prev,
            status: 'needsAuth',
            lastResultText: 'Google authorization needed for OAuth auto-sync',
          }));
          throw new SheetsAuthError('Google authorization required.');
        }

        setAutoSyncState((prev) => ({
          ...prev,
          status: 'syncing',
        }));

        try {
          const actorName =
            (profile.name || current.displayName || current.email || 'Admin')
              .trim()
              .slice(0, 100) || 'Admin';

          let pulledCreated = 0;
          let pulledUpdated = 0;
          let pulledGenerationUpdated = 0;
          let createdCompanies = 0;
          let skipped = 0;
          let shouldPush = directionMode === 'push';

          if (directionMode !== 'push') {
            const workbook = isAppsScript
              ? await fetchWorkbookTabsFromAppsScript(
                  sheetsConfig.webhookUrl || '',
                  sheetsConfig.sheetName
                )
              : await fetchWorkbookTabsFromGoogleSheet(
                  token!,
                  sheetsConfig.spreadsheetId,
                  sheetsConfig.sheetName
                );

            const baseline = loadSheetsBaseline(sheetsConfig.spreadsheetId);
            const plan = reconcileWorkbookWithApp({
              workbook,
              entries: workingEntries,
              generationEntries: workingGen,
              companies: workingCompanies,
              utilities: workingUtilities,
              lastSyncedHash: sheetsConfig.lastSyncedHash || lastCompletedSyncHashRef.current,
              baseline,
              preferSheetOnPullOnly: directionMode === 'pull',
            });

            skipped = plan.skipped;

            if (
              plan.utilityOps.length > 0 ||
              plan.generationOps.length > 0 ||
              plan.newCompanies.length > 0
            ) {
              const applied = await applyPulledChangesToFirestore({
                plan,
                currentUserUid: current.uid,
                actorName,
                baseEntries: workingEntries,
                baseGeneration: workingGen,
                baseCompanies: workingCompanies,
              });
              pulledCreated = applied.created;
              pulledUpdated = applied.updated;
              pulledGenerationUpdated = applied.generationUpdated;
              createdCompanies = applied.createdCompanies;
              workingEntries = applied.nextEntries;
              workingGen = applied.nextGeneration;
              workingCompanies = applied.nextCompanies;
            }

            if (directionMode === 'bidirectional') {
              shouldPush = plan.needsPushToSheet;
            } else {
              shouldPush = false;
            }
          }

          let pushedRows = 0;
          if (shouldPush) {
            if (isAppsScript) {
              pushedRows = await syncViaAppsScriptWebhook(
                sheetsConfig.webhookUrl || '',
                sheetsConfig.sheetName,
                workingEntries,
                workingUtilities,
                {
                  generationEntries: workingGen,
                  companies: workingCompanies,
                  ensureTabKeys: options?.ensureTabKeys,
                  pruneStaleTabs: options?.pruneStaleTabs ?? true,
                }
              );
            } else {
              pushedRows = await syncEntriesToGoogleSheet(
                token!,
                sheetsConfig.spreadsheetId,
                sheetsConfig.sheetName,
                workingEntries,
                workingUtilities,
                {
                  generationEntries: workingGen,
                  companies: workingCompanies,
                  ensureTabKeys: options?.ensureTabKeys,
                  pruneStaleTabs: options?.pruneStaleTabs ?? true,
                }
              );
            }
          }

          const hasPulled =
            pulledCreated > 0 ||
            pulledUpdated > 0 ||
            pulledGenerationUpdated > 0 ||
            createdCompanies > 0;
          const direction: GoogleSheetsSyncDirection =
            hasPulled && shouldPush
              ? 'bidirectional'
              : hasPulled
              ? 'pull'
              : shouldPush
              ? 'push'
              : 'none';

          const finalSnap = computeRecordHashSnapshot(
            workingEntries,
            workingGen,
            workingUtilities,
            workingCompanies
          );

          const summaryParts: string[] = [];
          if (pulledCreated > 0) summaryParts.push(`${pulledCreated} added from Sheet`);
          if (pulledUpdated > 0) summaryParts.push(`${pulledUpdated} edited from Sheet`);
          if (pulledGenerationUpdated > 0) {
            summaryParts.push(`${pulledGenerationUpdated} plant logs from Sheet`);
          }
          if (createdCompanies > 0) {
            summaryParts.push(`${createdCompanies} factories added`);
          }
          if (shouldPush) summaryParts.push(`${pushedRows} rows synced to Sheet`);
          if (summaryParts.length === 0) summaryParts.push('In sync (no changes)');

          const summary = summaryParts.join(' · ').slice(0, 240);
          const changed = hasPulled || shouldPush;

          if (changed || !sheetsConfig.lastSyncedHash) {
            lastCompletedSyncHashRef.current = finalSnap.overallHash;
            saveSheetsBaseline(sheetsConfig.spreadsheetId, finalSnap);
            await updateDoc(doc(db, 'integrations', 'googleSheets'), {
              lastSyncedHash: finalSnap.overallHash,
              lastSyncDirection: direction,
              lastSyncSummary: summary,
              lastSyncedCount: workingEntries.length + workingGen.length,
              lastSyncedAt: serverTimestamp(),
              updatedBy: current.uid,
              updatedAt: serverTimestamp(),
            });
          } else {
            lastCompletedSyncHashRef.current = finalSnap.overallHash;
            saveSheetsBaseline(sheetsConfig.spreadsheetId, finalSnap);
          }

          const nowDate = new Date();
          setAutoSyncState({
            status: sheetsConfig.autoSyncEnabled === false ? 'disabled' : 'synced',
            lastResultText: summary,
            lastSyncedAt: nowDate,
            lastDirection: direction,
            lastPulledCreated: pulledCreated,
            lastPulledUpdated: pulledUpdated + pulledGenerationUpdated,
            lastPushedRows: pushedRows,
          });

          return {
            direction,
            pushedRows,
            pulledCreated,
            pulledUpdated,
            pulledGenerationUpdated,
            createdCompanies,
            skipped,
            summary,
            changed,
          };
        } catch (err) {
          if (err instanceof SheetsAuthError) {
            clearCachedGoogleAccessToken();
            setGoogleAccessToken(null);
            setAutoSyncState((prev) => ({
              ...prev,
              status: 'needsAuth',
              lastResultText: 'Google authorization expired — click Reconnect',
            }));
          } else {
            const msg = err instanceof Error ? err.message : 'Google Sheets sync error';
            setAutoSyncState((prev) => ({
              ...prev,
              status: 'error',
              lastResultText: msg.slice(0, 180),
            }));
          }
          throw err;
        }
      };

      const promise = execute().finally(() => {
        if (syncInFlightRef.current === promise) {
          syncInFlightRef.current = null;
        }
      });
      syncInFlightRef.current = promise;
      return promise;
    },
    [
      profile,
      sheetsConfig,
      entries,
      generationEntries,
      utilities,
      companies,
      googleAccessToken,
      applyPulledChangesToFirestore,
    ]
  );

  const syncEntriesToConnectedSheet = useCallback(
    async (
      entriesOverride?: UtilityEntry[],
      ensureTabKeys?: Array<{ company: string; monthKey: string }>,
      pruneStaleTabs?: boolean,
      utilitiesOverride?: UtilityItem[],
      generationEntriesOverride?: GenerationEntry[]
    ): Promise<number> => {
      const targetEntries = entriesOverride ?? entries;
      const targetGen = generationEntriesOverride ?? generationEntries;
      const res = await runTwoWaySyncNow({
        forceDirection: 'push',
        entriesOverride: targetEntries,
        generationEntriesOverride: targetGen,
        utilitiesOverride,
        ensureTabKeys,
        pruneStaleTabs: pruneStaleTabs ?? true,
      });
      return res.pushedRows;
    },
    [runTwoWaySyncNow, entries, generationEntries]
  );

  const importEntriesFromConnectedSheet = useCallback(async (): Promise<{
    created: number;
    updated: number;
    generationUpdated: number;
    skipped: number;
    createdCompanies: number;
  }> => {
    const res = await runTwoWaySyncNow({
      forceDirection: 'pull',
    });
    return {
      created: res.pulledCreated,
      updated: res.pulledUpdated,
      generationUpdated: res.pulledGenerationUpdated,
      skipped: res.skipped,
      createdCompanies: res.createdCompanies,
    };
  }, [runTwoWaySyncNow]);

  // Keep latest state ref for automatic background polling & visibility checks
  const autoSyncDepsRef = useRef({
    profile,
    sheetsConfig,
    googleAccessToken,
    dataLoading,
    entries,
    generationEntries,
    utilities,
    companies,
    runTwoWaySyncNow,
  });
  useEffect(() => {
    autoSyncDepsRef.current = {
      profile,
      sheetsConfig,
      googleAccessToken,
      dataLoading,
      entries,
      generationEntries,
      utilities,
      companies,
      runTwoWaySyncNow,
    };
  }, [
    profile,
    sheetsConfig,
    googleAccessToken,
    dataLoading,
    entries,
    generationEntries,
    utilities,
    companies,
    runTwoWaySyncNow,
  ]);

  // Automatic trigger 1: Debounced watcher whenever App records change (even from approved Data Entry users)
  useEffect(() => {
    if (!authReady || !user || !emailVerified || dataLoading) return;
    if (!profile || profile.status !== 'approved' || profile.role !== 'admin') return;
    if (!sheetsConfig) {
      setAutoSyncState(DEFAULT_AUTO_SYNC_STATE);
      return;
    }
    if (sheetsConfig.autoSyncEnabled === false) {
      setAutoSyncState((prev) => ({
        ...prev,
        status: 'disabled',
        lastResultText: 'Automatic sync is paused',
      }));
      return;
    }
    if (sheetsConfig.syncMode !== 'appsScript' && !googleAccessToken) {
      setAutoSyncState((prev) => ({
        ...prev,
        status: 'needsAuth',
        lastResultText: 'Authorize Google Sheets to enable live two-way sync',
      }));
      return;
    }

    const snap = computeRecordHashSnapshot(entries, generationEntries, utilities, companies);
    const knownSyncedHash =
      lastCompletedSyncHashRef.current || sheetsConfig.lastSyncedHash || '';

    if (knownSyncedHash && snap.overallHash === knownSyncedHash) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void autoSyncDepsRef.current.runTwoWaySyncNow({ silent: true }).catch(() => {
        // Error state already stored in autoSyncState
      });
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [
    authReady,
    user,
    emailVerified,
    dataLoading,
    profile?.status,
    profile?.role,
    sheetsConfig,
    googleAccessToken,
    entries,
    generationEntries,
    utilities,
    companies,
  ]);

  // Automatic trigger 2: Periodic polling + window focus / visibility change to pull manual Sheet edits automatically
  useEffect(() => {
    if (!authReady || !user || !emailVerified || dataLoading) return;
    if (!profile || profile.status !== 'approved' || profile.role !== 'admin') return;
    if (!sheetsConfig || sheetsConfig.autoSyncEnabled === false) return;
    if (sheetsConfig.syncMode !== 'appsScript' && !googleAccessToken) return;

    const intervalMs = Math.max(15000, (sheetsConfig.autoSyncIntervalSec || 30) * 1000);

    const runBackgroundCheck = (minSpacingMs = 8000) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusPollAtRef.current < minSpacingMs) return;
      lastFocusPollAtRef.current = now;
      void autoSyncDepsRef.current.runTwoWaySyncNow({ silent: true }).catch(() => {
        // Error state handled inside runTwoWaySyncNow
      });
    };

    // Initial two-way check shortly after session / sheet becomes active
    const initTimer = window.setTimeout(() => {
      runBackgroundCheck(3000);
    }, 1500);

    const pollTimer = window.setInterval(() => {
      runBackgroundCheck(10000);
    }, intervalMs);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        runBackgroundCheck(10000);
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [
    authReady,
    user,
    emailVerified,
    dataLoading,
    profile?.status,
    profile?.role,
    sheetsConfig?.spreadsheetId,
    sheetsConfig?.syncMode,
    sheetsConfig?.webhookUrl,
    sheetsConfig?.autoSyncEnabled,
    sheetsConfig?.autoSyncIntervalSec,
    googleAccessToken,
  ]);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changeCurrentUserPassword(currentPassword, newPassword);
    },
    []
  );

  const linkPassword = useCallback(async (newPassword: string) => {
    await linkPasswordToCurrentUser(newPassword);
    if (auth.currentUser) {
      setUser(auth.currentUser);
      setEmailVerified(Boolean(auth.currentUser.emailVerified));
    }
    setAuthTick((t) => t + 1);
  }, []);

  const logout = useCallback(async () => {
    clearCachedGoogleAccessToken();
    setGoogleAccessToken(null);
    await signOut(auth);
    setEmailVerified(false);
    setProfile(null);
    setProfileError(null);
    setCompanies([]);
    setUtilities([]);
    setEntries([]);
    setGenerationEntries([]);
    setUserUnitRates([]);
    setAllUsers([]);
    setViewerDirectoryUsers([]);
    setSheetsConfig(null);
  }, []);

  const checkEmailVerified = useCallback(async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await withTimeout(reload(current), 5000, 'Reload user');
    setEmailVerified(Boolean(current.emailVerified));
    if (current.emailVerified) {
      await withTimeout(current.getIdToken(true), 6000, 'Auth token refresh').catch(() =>
        current.getIdToken(false)
      );
      setProfileLoading(true);
      setProfileError(null);
      try {
        const ensured = await withTimeout(
          ensureUserProfile(current),
          15000,
          'Firestore profile lookup'
        );
        setProfile(ensured);
      } catch (err) {
        console.error('Error ensuring profile:', err);
        setProfileError(formatProfileErrorMessage(err));
      } finally {
        setProfileLoading(false);
      }
      setUser(current);
      setAuthTick((t) => t + 1);
      return true;
    }
    return false;
  }, [ensureUserProfile, formatProfileErrorMessage, withTimeout]);

  const verifyWithGoogle = useCallback(async (): Promise<boolean> => {
    const verified = await verifyCurrentAccountWithGoogle();
    const current = auth.currentUser;
    if (current) {
      setUser(current);
      setEmailVerified(Boolean(current.emailVerified));
      if (current.emailVerified) {
        setProfileLoading(true);
        setProfileError(null);
        try {
          const ensured = await withTimeout(
            ensureUserProfile(current),
            15000,
            'Firestore profile lookup'
          );
          setProfile(ensured);
        } catch (err) {
          console.error('Error ensuring profile:', err);
          setProfileError(formatProfileErrorMessage(err));
        } finally {
          setProfileLoading(false);
        }
      }
      setAuthTick((t) => t + 1);
    }
    return verified;
  }, [ensureUserProfile, formatProfileErrorMessage, withTimeout]);

  const resendVerification = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    await sendEmailVerification(current);
  }, []);

  const checkApprovalStatus = useCallback(async (): Promise<
    'pending' | 'approved' | 'rejected' | 'unknown'
  > => {
    const current = auth.currentUser;
    if (!current) return 'unknown';
    const userPath = `users/${current.uid}`;
    try {
      const snap = await withTimeout(
        getDocFromServer(doc(db, 'users', current.uid)).catch(() =>
          getDoc(doc(db, 'users', current.uid))
        ),
        15000,
        'Firestore status check'
      );
      if (!snap.exists()) {
        const ensured = await withTimeout(
          ensureUserProfile(current),
          15000,
          'Firestore profile lookup'
        );
        if (ensured) {
          setProfile(ensured);
          setProfileError(null);
          return ensured.status;
        }
        return 'unknown';
      }
      const updated = mapUserProfileDoc(
        current.uid,
        snap.data() as Record<string, unknown>,
        current.displayName || 'User',
        current.email || ''
      );
      setProfile(updated);
      setProfileError(null);
      return updated.status;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, userPath);
    }
  }, [ensureUserProfile, withTimeout]);

  const retryProfileLoad = useCallback(async () => {
    const current = auth.currentUser;
    if (!current || !current.emailVerified) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      await withTimeout(current.getIdToken(true), 6000, 'Auth token refresh').catch(() =>
        current.getIdToken(false)
      );
      const ensured = await withTimeout(
        ensureUserProfile(current),
        15000,
        'Firestore profile lookup'
      );
      setProfile(ensured);
    } catch (err) {
      console.error('Error retrying profile load:', err);
      setProfileError(formatProfileErrorMessage(err));
    } finally {
      setProfileLoading(false);
    }
  }, [ensureUserProfile, formatProfileErrorMessage, withTimeout]);

  const saveFactoryBudget = useCallback(
    async (input: FactoryBudgetInput) => {
      const current = auth.currentUser;
      if (!current || !profile || profile.role !== 'admin') {
        throw new Error('Only administrators can configure factory monthly budgets.');
      }
      const cleanMonth = input.month.trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonth)) {
        throw new Error('Invalid billing month format (expected YYYY-MM).');
      }
      const cleanCompanyId = input.companyId.trim();
      const cleanCompanyName = input.companyName.trim().slice(0, 100);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanCompanyId) || !cleanCompanyName) {
        throw new Error('Invalid factory reference.');
      }
      const budgetId = toSafeFirestoreId('budget', `${cleanCompanyId}_${cleanMonth}`);
      const monthlySpendLimit = Math.max(
        0,
        Math.min(100_000_000_000, Number(input.monthlySpendLimit) || 0)
      );
      const alertThresholdPct = Math.max(
        50,
        Math.min(100, Number(input.alertThresholdPct) || 85)
      );
      const cleanNotes = (input.notes || '').trim().slice(0, 300);

      const budgetRef = doc(db, 'budgets', budgetId);
      const existingSnap = await getDoc(budgetRef);
      const actorName = (profile.name || current.displayName || 'Admin')
        .trim()
        .slice(0, 100);

      const optionalFields: Record<string, unknown> = {};
      if (
        input.monthlyCarbonCapKg !== undefined &&
        Number.isFinite(input.monthlyCarbonCapKg) &&
        input.monthlyCarbonCapKg >= 0
      ) {
        optionalFields.monthlyCarbonCapKg = Math.min(
          1_000_000_000,
          Number(input.monthlyCarbonCapKg)
        );
      }
      if (
        input.targetSolarSharePct !== undefined &&
        Number.isFinite(input.targetSolarSharePct) &&
        input.targetSolarSharePct >= 0
      ) {
        optionalFields.targetSolarSharePct = Math.max(
          0,
          Math.min(100, Number(input.targetSolarSharePct))
        );
      }
      if (cleanNotes) {
        optionalFields.notes = cleanNotes;
      }

      try {
        if (existingSnap.exists()) {
          const updatePayload: Record<string, unknown> = {
            monthlySpendLimit,
            alertThresholdPct,
            updatedBy: current.uid,
            updatedByName: actorName,
            updatedAt: serverTimestamp(),
            ...optionalFields,
          };
          if (optionalFields.notes === undefined && existingSnap.data()?.notes !== undefined) {
            updatePayload.notes = '';
          }
          await updateDoc(budgetRef, updatePayload);
        } else {
          await setDoc(budgetRef, {
            companyId: cleanCompanyId,
            companyName: cleanCompanyName,
            month: cleanMonth,
            monthlySpendLimit,
            alertThresholdPct,
            ...optionalFields,
            updatedBy: current.uid,
            updatedByName: actorName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `budgets/${budgetId}`);
      }
    },
    [profile]
  );

  const deleteFactoryBudget = useCallback(
    async (budgetId: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Only administrators can remove budgets.');
      }
      const cleanId = budgetId.trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return;
      try {
        await deleteDoc(doc(db, 'budgets', cleanId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `budgets/${cleanId}`);
      }
    },
    [profile]
  );

  const scopedEntries = React.useMemo(() => {
    if (!profile || profile.role === 'admin') return entries;
    const allowed = profile.allowedUtilities || [];
    if (allowed.length === 0) return entries;
    const allowSet = new Set(allowed);
    return entries.filter((item) => allowSet.has(item.utilityId));
  }, [entries, profile]);

  const directoryUsers = React.useMemo<UserDirectoryEntry[]>(() => {
    if (profile?.role === 'admin') {
      return allUsers
        .map((u) => ({
          uid: u.uid,
          name: u.name,
          organization: u.organization || '',
          department: u.department || '',
          designation: u.designation || '',
          employeeId: u.employeeId || '',
          status: u.status,
          role: u.role,
          companies: u.companies,
          viewCompanies: u.viewCompanies,
          allowedUtilities: u.allowedUtilities || [],
          createdAt: u.createdAt,
          updatedAt: u.createdAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return viewerDirectoryUsers;
  }, [profile?.role, allUsers, viewerDirectoryUsers]);

  return (
    <AppContext.Provider
      value={{
        user,
        emailVerified,
        authReady,
        profile,
        profileLoading,
        profileError,
        dataLoading,
        publicCompanies,
        companies,
        utilities,
        entries: scopedEntries,
        generationEntries,
        budgets,
        userUnitRates,
        allUsers,
        directoryUsers,
        sheetsConfig,
        googleAccessToken,
        autoSyncState,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        updateOwnProfile,
        adminUpdateUser,
        saveFactoryBudget,
        deleteFactoryBudget,
        syncPublicCompanies,
        connectGoogleSheets,
        clearGoogleToken,
        saveSheetsConfig,
        toggleAutoSync,
        removeSheetsConfig,
        syncEntriesToConnectedSheet,
        importEntriesFromConnectedSheet,
        runTwoWaySyncNow,
        resetPassword,
        changePassword,
        linkPassword,
        logout,
        checkEmailVerified,
        verifyWithGoogle,
        resendVerification,
        checkApprovalStatus,
        retryProfileLoad,
        seedDefaultsIfNeeded,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
