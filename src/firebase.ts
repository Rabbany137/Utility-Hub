import { initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getAuth,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithPopup,
  updatePassword,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId = (
  firebaseConfig as { firestoreDatabaseId?: string }
).firestoreDatabaseId;

export const db = firestoreDatabaseId
  ? initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      firestoreDatabaseId
    )
  : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const auth = getAuth(app);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];

export const GOOGLE_WORKSPACE_SCOPES = GOOGLE_SHEETS_SCOPES;

const authGoogleProvider = new GoogleAuthProvider();
authGoogleProvider.setCustomParameters({
  prompt: 'select_account',
});

const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_SHEETS_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'consent',
});

// In-memory cache only (never store OAuth access tokens in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;

export function getCachedGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export function clearCachedGoogleAccessToken(): void {
  cachedGoogleAccessToken = null;
}

export function hasPasswordProvider(targetUser?: User | null): boolean {
  const current = targetUser ?? auth.currentUser;
  if (!current) return false;
  return current.providerData.some((p) => p.providerId === 'password');
}

export function hasGoogleProvider(targetUser?: User | null): boolean {
  const current = targetUser ?? auth.currentUser;
  if (!current) return false;
  return current.providerData.some((p) => p.providerId === 'google.com');
}

export async function verifyCurrentUserPassword(password: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.email) {
    throw new Error('No signed-in email account found.');
  }
  const credential = EmailAuthProvider.credential(current.email, password);
  await reauthenticateWithCredential(current, credential);
}

export async function reauthenticateCurrentUserWithGoogle(): Promise<void> {
  const current = auth.currentUser;
  if (!current) {
    throw new Error('No signed-in account found.');
  }
  await reauthenticateWithPopup(current, authGoogleProvider);
}

export async function changeCurrentUserPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.email) {
    throw new Error('No signed-in email account found.');
  }
  if (!currentPassword) {
    throw new Error('Current password is required.');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }
  await verifyCurrentUserPassword(currentPassword);
  await updatePassword(current, newPassword);
}

export async function linkPasswordToCurrentUser(newPassword: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.email) {
    throw new Error('No signed-in email account found.');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }
  await reauthenticateCurrentUserWithGoogle();
  const hasPass = current.providerData.some((p) => p.providerId === 'password');
  if (hasPass) {
    await updatePassword(current, newPassword);
  } else {
    const credential = EmailAuthProvider.credential(current.email, newPassword);
    await linkWithCredential(current, credential);
  }
  await current.reload();
  if (!current.emailVerified && hasGoogleProvider(current)) {
    await reauthenticateWithPopup(current, authGoogleProvider);
    await current.reload();
  }
  await current.getIdToken(true);
}

export async function verifyCurrentAccountWithGoogle(): Promise<boolean> {
  const current = auth.currentUser;
  if (!current) {
    const user = await signInWithGoogleAccount();
    await user.getIdToken(true);
    return Boolean(user.emailVerified);
  }

  if (hasGoogleProvider(current)) {
    await reauthenticateWithPopup(current, authGoogleProvider);
  } else {
    try {
      await linkWithPopup(current, authGoogleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (
        code === 'auth/credential-already-in-use' ||
        code === 'auth/provider-already-linked' ||
        code === 'auth/email-already-in-use'
      ) {
        await signInWithPopup(auth, authGoogleProvider);
      } else {
        throw err;
      }
    }
  }

  const latest = auth.currentUser;
  if (!latest) return false;
  await latest.reload();
  await latest.getIdToken(true);
  return Boolean(latest.emailVerified);
}

export async function signInWithGoogleAccount(): Promise<User> {
  const result = await signInWithPopup(auth, authGoogleProvider);
  return result.user;
}

export async function signInWithGoogleSheets(): Promise<{
  user: User;
  accessToken: string;
}> {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Failed to retrieve Google Workspace access token.');
  }
  cachedGoogleAccessToken = credential.accessToken;
  return { user: result.user, accessToken: credential.accessToken };
}

export async function authorizeGoogleSheetsForCurrentUser(): Promise<string> {
  const current = auth.currentUser;
  if (!current) {
    const res = await signInWithGoogleSheets();
    return res.accessToken;
  }

  const hasGoogleLinked = current.providerData.some(
    (p) => p.providerId === 'google.com'
  );

  if (hasGoogleLinked) {
    const result = await reauthenticateWithPopup(current, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to refresh Google Workspace access token.');
    }
    cachedGoogleAccessToken = credential.accessToken;
    return credential.accessToken;
  }

  try {
    const result = await linkWithPopup(current, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Workspace access token.');
    }
    cachedGoogleAccessToken = credential.accessToken;
    return credential.accessToken;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (
      code === 'auth/credential-already-in-use' ||
      code === 'auth/provider-already-linked' ||
      code === 'auth/email-already-in-use'
    ) {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to obtain Google Workspace access token.');
      }
      cachedGoogleAccessToken = credential.accessToken;
      return credential.accessToken;
    }
    throw err;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
