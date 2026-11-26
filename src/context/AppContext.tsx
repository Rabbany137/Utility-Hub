import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  type User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
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
} from '../firebase';
import {
  MASTER_BACKUP_TAB_NAME,
  SheetsAuthError,
  fetchRowsFromAppsScriptWebhook,
  fetchSpreadsheetMetadata,
  parseImportedSheetRows,
  readAllRowsFromGoogleSheet,
  syncEntriesToGoogleSheet,
  syncViaAppsScriptWebhook,
} from '../services/googleSheets';
import type {
  AdminUserUpdates,
  CompanyItem,
  GenerationEntry,
  GoogleSheetsConfig,
  GoogleSheetsSyncMode,
  OwnProfileUpdates,
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
    createdAt: (data.createdAt as UserProfile['createdAt']) ?? null,
  };
}

interface AppContextValue {
  user: User | null;
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
  userUnitRates: UserUnitRate[];
  allUsers: UserProfile[];
  directoryUsers: UserDirectoryEntry[];
  sheetsConfig: GoogleSheetsConfig | null;
  googleAccessToken: string | null;
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
    lastSyncedCount?: number;
  }) => Promise<void>;
  removeSheetsConfig: () => Promise<void>;
  syncEntriesToConnectedSheet: (
    entriesOverride?: UtilityEntry[],
    ensureTabKeys?: Array<{ company: string; monthKey: string }>,
    pruneStaleTabs?: boolean,
    utilitiesOverride?: UtilityItem[]
  ) => Promise<number>;
  importEntriesFromConnectedSheet: () => Promise<{
    created: number;
    updated: number;
    skipped: number;
    createdCompanies: number;
  }>;
  resetPassword: (email: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  linkPassword: (newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  checkEmailVerified: () => Promise<boolean>;
  resendVerification: () => Promise<void>;
  checkApprovalStatus: () => Promise<'pending' | 'approved' | 'rejected' | 'unknown'>;
  retryProfileLoad: () => Promise<void>;
  seedDefaultsIfNeeded: (force?: boolean) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
  const [userUnitRates, setUserUnitRates] = useState<UserUnitRate[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [viewerDirectoryUsers, setViewerDirectoryUsers] = useState<UserDirectoryEntry[]>([]);
  const [sheetsConfig, setSheetsConfig] = useState<GoogleSheetsConfig | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(
    () => getCachedGoogleAccessToken()
  );

  const seededRef = useRef(false);
  const directoryBackfilledRef = useRef(false);

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

    try {
      const snap = await getDocFromServer(userRef);
      if (snap.exists()) {
        const mapped = mapUserProfileDoc(
          firebaseUser.uid,
          snap.data() as Record<string, unknown>,
          firebaseUser.displayName || 'User',
          firebaseUser.email || ''
        );

        // Best-effort sync of non-PII userDirectory/{uid} if missing
        try {
          const dirSnap = await getDocFromServer(dirRef);
          if (!dirSnap.exists() && mapped.createdAt) {
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

      await setDoc(userRef, payload);
      const createdSnap = await getDocFromServer(userRef);
      const createdData = createdSnap.data() as Record<string, unknown> | undefined;
      const mapped = mapUserProfileDoc(
        firebaseUser.uid,
        createdData || payload,
        payload.name,
        payload.email
      );

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
          createdAt: mapped.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (dirErr) {
        console.warn('Non-fatal userDirectory create error:', dirErr);
      }

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
      return `Unable to connect to Cloud Firestore. Ensure Cloud Firestore (${firebaseConfig.firestoreDatabaseId || '(default)'} database) is enabled and Firestore rules are published in Firebase Console for this project.`;
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
          await withTimeout(firebaseUser.getIdToken(true), 5000, 'Auth token refresh');
          const ensured = await withTimeout(
            ensureUserProfile(firebaseUser),
            6000,
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

    return () => {
      active = false;
      clearTimeout(authSafetyTimer);
      unsub();
    };
  }, [ensureUserProfile, formatProfileErrorMessage, withTimeout]);

  // Real-time listener on own user profile once verified and loaded
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified || !profile) return;

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
  }, [authReady, user, profile?.uid]);

  // Seed default companies & utilities once when an approved admin logs in
  useEffect(() => {
    if (
      authReady &&
      user?.emailVerified &&
      profile?.status === 'approved' &&
      profile?.role === 'admin' &&
      !seededRef.current
    ) {
      seededRef.current = true;
      void seedDefaultsIfNeeded();
    }
  }, [authReady, user, profile, seedDefaultsIfNeeded]);

  const viewCompaniesKey = (profile?.viewCompanies || []).join('|||');

  // Real-time data listeners only when approved
  useEffect(() => {
    if (!authReady || !user?.emailVerified || profile?.status !== 'approved') {
      setCompanies([]);
      setUtilities([]);
      setEntries([]);
      setGenerationEntries([]);
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
      generatorCount: Number(data.generatorCount ?? 0),
      generatorKwh: Number(data.generatorKwh ?? 0),
      generatorFuelQty: Number(data.generatorFuelQty ?? 0),
      generatorFuelUnit: String(data.generatorFuelUnit || 'm³'),
      generatorFuelCost: Number(data.generatorFuelCost ?? 0),
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
          setSheetsConfig({
            spreadsheetId: String(data.spreadsheetId || ''),
            spreadsheetUrl: String(data.spreadsheetUrl || ''),
            spreadsheetTitle: String(data.spreadsheetTitle || ''),
            sheetName: String(data.sheetName || ''),
            syncMode:
              data.syncMode === 'appsScript' ? 'appsScript' : 'oauth',
            webhookUrl: String(data.webhookUrl || ''),
            lastSyncedCount: Number(data.lastSyncedCount ?? 0),
            lastSyncedAt: data.lastSyncedAt ?? null,
            updatedBy: String(data.updatedBy || ''),
            updatedAt: data.updatedAt ?? null,
          });
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
      unsubSheetsConfig();
      unsubUsers();
      unsubDirectory();
      unsubUserUnitRates();
    };
  }, [authReady, user, profile?.status, profile?.role, viewCompaniesKey]);

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

      if (Object.keys(sanitizedUserUpdates).length === 0) return;

      const userPath = `users/${target.uid}`;
      try {
        await updateDoc(doc(db, 'users', target.uid), sanitizedUserUpdates);

        const dirRef = doc(db, 'userDirectory', target.uid);
        const dirSnap = await getDoc(dirRef);
        if (dirSnap.exists()) {
          await updateDoc(dirRef, {
            ...sanitizedDirUpdates,
            updatedAt: serverTimestamp(),
          });
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
      lastSyncedCount?: number;
    }) => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');
      const path = 'integrations/googleSheets';
      try {
        await setDoc(doc(db, 'integrations', 'googleSheets'), {
          spreadsheetId: config.spreadsheetId.slice(0, 128),
          spreadsheetUrl: config.spreadsheetUrl.slice(0, 300),
          spreadsheetTitle: config.spreadsheetTitle.slice(0, 150),
          sheetName: config.sheetName.slice(0, 100),
          syncMode: config.syncMode || 'oauth',
          webhookUrl: (config.webhookUrl || '').slice(0, 300),
          lastSyncedCount: config.lastSyncedCount ?? 0,
          lastSyncedAt: serverTimestamp(),
          updatedBy: current.uid,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    []
  );

  const removeSheetsConfig = useCallback(async () => {
    const path = 'integrations/googleSheets';
    try {
      await deleteDoc(doc(db, 'integrations', 'googleSheets'));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }, []);

  const syncEntriesToConnectedSheet = useCallback(
    async (
      entriesOverride?: UtilityEntry[],
      ensureTabKeys?: Array<{ company: string; monthKey: string }>,
      pruneStaleTabs?: boolean,
      utilitiesOverride?: UtilityItem[]
    ): Promise<number> => {
      const current = auth.currentUser;
      if (!current) throw new Error('Not signed in.');
      if (!profile || profile.role !== 'admin') {
        throw new Error('Only administrators can sync with Google Sheets.');
      }
      if (!sheetsConfig) throw new Error('No Google Sheet connected.');

      const targetEntries = entriesOverride ?? entries;
      const targetUtilities = utilitiesOverride ?? utilities;

      if (sheetsConfig.syncMode === 'appsScript') {
        const count = await syncViaAppsScriptWebhook(
          sheetsConfig.webhookUrl || '',
          sheetsConfig.sheetName,
          targetEntries,
          targetUtilities,
          { ensureTabKeys, pruneStaleTabs }
        );

        await updateDoc(doc(db, 'integrations', 'googleSheets'), {
          lastSyncedCount: count,
          lastSyncedAt: serverTimestamp(),
          updatedBy: current.uid,
          updatedAt: serverTimestamp(),
        });

        return count;
      }

      const token = googleAccessToken || getCachedGoogleAccessToken();
      if (!token) {
        throw new SheetsAuthError('Google authorization required.');
      }

      try {
        const count = await syncEntriesToGoogleSheet(
          token,
          sheetsConfig.spreadsheetId,
          sheetsConfig.sheetName,
          targetEntries,
          targetUtilities,
          { ensureTabKeys, pruneStaleTabs }
        );

        await updateDoc(doc(db, 'integrations', 'googleSheets'), {
          lastSyncedCount: count,
          lastSyncedAt: serverTimestamp(),
          updatedBy: current.uid,
          updatedAt: serverTimestamp(),
        });

        return count;
      } catch (err) {
        if (err instanceof SheetsAuthError) {
          clearCachedGoogleAccessToken();
          setGoogleAccessToken(null);
        }
        throw err;
      }
    },
    [profile, sheetsConfig, googleAccessToken, entries, utilities]
  );

  const importEntriesFromConnectedSheet = useCallback(async (): Promise<{
    created: number;
    updated: number;
    skipped: number;
    createdCompanies: number;
  }> => {
    const current = auth.currentUser;
    if (!current) throw new Error('Not signed in.');
    if (!profile || profile.role !== 'admin') {
      throw new Error('Only administrators can import entries from Google Sheets.');
    }
    if (!sheetsConfig) throw new Error('No Google Sheet connected.');

    let rawRows: string[][] = [];

    if (sheetsConfig.syncMode === 'appsScript') {
      const fetched = await fetchRowsFromAppsScriptWebhook(
        sheetsConfig.webhookUrl || '',
        MASTER_BACKUP_TAB_NAME
      );
      rawRows = fetched.rows;
    } else {
      const token = googleAccessToken || getCachedGoogleAccessToken();
      if (!token) {
        throw new SheetsAuthError('Google authorization required.');
      }
      try {
        const meta = await fetchSpreadsheetMetadata(token, sheetsConfig.spreadsheetId);
        const tabToRead = meta.sheetNames.includes(MASTER_BACKUP_TAB_NAME)
          ? MASTER_BACKUP_TAB_NAME
          : meta.sheetNames.includes(sheetsConfig.sheetName)
          ? sheetsConfig.sheetName
          : meta.sheetNames[0];
        if (!tabToRead) {
          throw new Error('No tabs found in the connected spreadsheet.');
        }
        rawRows = await readAllRowsFromGoogleSheet(
          token,
          sheetsConfig.spreadsheetId,
          tabToRead
        );
      } catch (err) {
        if (err instanceof SheetsAuthError) {
          clearCachedGoogleAccessToken();
          setGoogleAccessToken(null);
        }
        throw err;
      }
    }

    const parsed = parseImportedSheetRows(rawRows, companies, utilities);
    if (parsed.items.length === 0) {
      return {
        created: 0,
        updated: 0,
        skipped: parsed.skipped,
        createdCompanies: 0,
      };
    }

    let createdCompanies = 0;
    if (parsed.newCompanies.length > 0) {
      const compBatch = writeBatch(db);
      parsed.newCompanies.forEach((companyName, idx) => {
        const compId = toSafeFirestoreId('comp', `${companyName}_${Date.now()}_${idx}`);
        compBatch.set(doc(db, 'companies', compId), {
          name: companyName.slice(0, 100),
          createdBy: current.uid,
          createdAt: serverTimestamp(),
        });
        createdCompanies += 1;
      });
      await compBatch.commit();
      await syncPublicCompanies([
        ...companies.map((c) => c.name),
        ...parsed.newCompanies,
      ]);
    }

    const existingSnap = await getDocs(collection(db, 'utilityEntries'));
    const existingById = new Map<
      string,
      { id: string; date: string; company: string; utilityId: string; enteredBy: string }
    >();
    const existingByComposite = new Map<
      string,
      { id: string; date: string; company: string; utilityId: string; enteredBy: string }
    >();

    for (const d of existingSnap.docs) {
      const data = d.data();
      const rec = {
        id: d.id,
        date: String(data.date || ''),
        company: String(data.company || ''),
        utilityId: String(data.utilityId || ''),
        enteredBy: String(data.enteredBy || ''),
      };
      existingById.set(d.id, rec);
      existingByComposite.set(`${rec.date}__${rec.company}__${rec.utilityId}`, rec);
    }

    const validFirestoreIdRe = /^[a-zA-Z0-9_-]{1,128}$/;
    const dedupedOps = new Map<
      string,
      {
        mode: 'create' | 'update';
        targetId: string;
        existingEnteredBy?: string;
        item: (typeof parsed.items)[number];
      }
    >();

    for (const item of parsed.items) {
      const compositeKey = `${item.date}__${item.company}__${item.utilityId}`;
      const byIdMatch =
        item.entryId && validFirestoreIdRe.test(item.entryId)
          ? existingById.get(item.entryId)
          : undefined;
      const validIdMatch =
        byIdMatch &&
        byIdMatch.date === item.date &&
        byIdMatch.utilityId === item.utilityId
          ? byIdMatch
          : undefined;
      const compositeMatch = existingByComposite.get(compositeKey);
      const matched = validIdMatch || compositeMatch;

      if (matched) {
        dedupedOps.set(matched.id, {
          mode: 'update',
          targetId: matched.id,
          existingEnteredBy: matched.enteredBy,
          item,
        });
      } else {
        const preferredId =
          item.entryId &&
          validFirestoreIdRe.test(item.entryId) &&
          !existingById.has(item.entryId)
            ? item.entryId
            : toSafeFirestoreId('entry', compositeKey);

        dedupedOps.set(preferredId, {
          mode: 'create',
          targetId: preferredId,
          item,
        });
      }
    }

    const opsList = Array.from(dedupedOps.values());
    let created = 0;
    let updated = 0;

    for (let i = 0; i < opsList.length; i += 400) {
      const chunk = opsList.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const ref = doc(db, 'utilityEntries', op.targetId);
        const safeEnteredByName = (
          op.item.enteredByName ||
          profile.name ||
          current.email ||
          'Imported'
        )
          .trim()
          .slice(0, 100) || 'Imported';
        const safeConsumption = Math.min(1000000000, Math.max(0, op.item.consumption));
        const safeCost = Math.min(100000000000, Math.max(0, op.item.cost));

        if (op.mode === 'update') {
          batch.update(ref, {
            company: op.item.company.slice(0, 100),
            utilityName: op.item.utilityName.slice(0, 80),
            unit: op.item.unit.slice(0, 30),
            consumption: safeConsumption,
            cost: safeCost,
            note: op.item.note.slice(0, 300),
            enteredBy: op.existingEnteredBy || current.uid,
            enteredByName: safeEnteredByName,
            updatedAt: serverTimestamp(),
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
            note: op.item.note.slice(0, 300),
            enteredBy: current.uid,
            enteredByName: safeEnteredByName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          created += 1;
        }
      }
      await batch.commit();
    }

    return {
      created,
      updated,
      skipped: parsed.skipped,
      createdCompanies,
    };
  }, [profile, sheetsConfig, googleAccessToken, companies, utilities, syncPublicCompanies]);

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
    }
    setAuthTick((t) => t + 1);
  }, []);

  const logout = useCallback(async () => {
    clearCachedGoogleAccessToken();
    setGoogleAccessToken(null);
    await signOut(auth);
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
    if (current.emailVerified) {
      await withTimeout(current.getIdToken(true), 5000, 'Auth token refresh');
      setProfileLoading(true);
      setProfileError(null);
      try {
        const ensured = await withTimeout(
          ensureUserProfile(current),
          6000,
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
        getDocFromServer(doc(db, 'users', current.uid)),
        6000,
        'Firestore status check'
      );
      if (!snap.exists()) {
        const ensured = await withTimeout(
          ensureUserProfile(current),
          6000,
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
      await withTimeout(current.getIdToken(true), 5000, 'Auth token refresh');
      const ensured = await withTimeout(
        ensureUserProfile(current),
        6000,
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
        userUnitRates,
        allUsers,
        directoryUsers,
        sheetsConfig,
        googleAccessToken,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        updateOwnProfile,
        adminUpdateUser,
        syncPublicCompanies,
        connectGoogleSheets,
        clearGoogleToken,
        saveSheetsConfig,
        removeSheetsConfig,
        syncEntriesToConnectedSheet,
        importEntriesFromConnectedSheet,
        resetPassword,
        changePassword,
        linkPassword,
        logout,
        checkEmailVerified,
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
