import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  MailCheck,
  RefreshCw,
  Save,
  ShieldX,
  UserPlus,
} from 'lucide-react';
import { APP_NAME } from '../config';
import { useApp } from '../context/AppContext';
import { GoogleSignInButton } from './GoogleSignInButton';

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This app domain is not yet added to Authorized Domains in Firebase Console (Authentication > Settings > Authorized domains).';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console yet. Please use "Sign in with Google" above, or enable Email/Password under Firebase Authentication > Sign-in method.';
    default:
      return msg || 'Authentication failed. Please try again.';
  }
}

export function AuthLoginScreen() {
  const {
    publicCompanies,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    resetPassword,
  } = useApp();
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [name, setName] = useState('');
  const [organizationSelect, setOrganizationSelect] = useState('');
  const [customOrganization, setCustomOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const resolvedOrganization =
    organizationSelect === '__other__'
      ? customOrganization.trim()
      : organizationSelect.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (mode === 'signup' && name.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (mode === 'signup' && !resolvedOrganization) {
      setError('Please select your organization / company.');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (mode !== 'reset' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else if (mode === 'signup') {
        await signUpWithEmail(name, email, password, resolvedOrganization);
      } else {
        await resetPassword(email);
        setInfo('A password reset link has been sent to your email.');
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setInfo('');
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="sm:mx-auto sm:w-full sm:max-w-md mb-6 text-center"
      >
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {APP_NAME}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Daily utility consumption and cost management portal
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
        className="sm:mx-auto sm:w-full sm:max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm"
      >
        {mode !== 'reset' && (
          <div className="mb-5">
            <GoogleSignInButton
              onClick={() => void handleGoogleLogin()}
              disabled={submitting || googleBusy}
              label={googleBusy ? 'Connecting...' : 'Sign in with Google'}
            />
            <div className="relative flex items-center justify-center mt-5">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-3 text-xs text-slate-400 uppercase tracking-wider">
                or with email
              </span>
              <div className="border-t border-slate-200 w-full" />
            </div>
          </div>
        )}

        {mode !== 'reset' ? (
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            {(
              [
                { id: 'login', label: 'Sign In' },
                { id: 'signup', label: 'Create Account' },
              ] as const
            ).map((item) => {
              const isActive = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMode(item.id);
                    setError('');
                    setInfo('');
                  }}
                  className={`relative py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'text-slate-900'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="authModePill"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 bg-white rounded-md shadow-sm"
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mb-6 pb-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Reset Password
            </h2>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setInfo('');
              }}
              className="text-sm text-teal-700 hover:underline font-medium cursor-pointer"
            >
              Back to Sign In
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rashed Karim"
                  maxLength={100}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-organization"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Organization / Company
                </label>
                <select
                  id="auth-organization"
                  value={organizationSelect}
                  onChange={(e) => setOrganizationSelect(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                >
                  <option value="">Select your organization / company</option>
                  {publicCompanies.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                  <option value="__other__">Other / Not listed</option>
                </select>
              </div>

              {organizationSelect === '__other__' && (
                <div>
                  <label
                    htmlFor="auth-organization-custom"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Enter Organization Name
                  </label>
                  <input
                    id="auth-organization-custom"
                    type="text"
                    value={customOrganization}
                    onChange={(e) => setCustomOrganization(e.target.value)}
                    placeholder="e.g. Head Office / Factory Name"
                    maxLength={100}
                    required
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
              )}
            </>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              autoComplete="email"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="auth-password"
                  className="block text-sm font-medium text-slate-700"
                >
                  Password
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                      setInfo('');
                    }}
                    className="text-xs text-teal-700 hover:underline font-medium cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800 leading-relaxed">
              {error}
            </div>
          )}

          {info && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 leading-relaxed">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || googleBusy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {mode === 'login' && <LogIn className="w-4 h-4" />}
            {mode === 'signup' && <UserPlus className="w-4 h-4" />}
            {mode === 'reset' && <KeyRound className="w-4 h-4" />}
            {submitting
              ? 'Please wait...'
              : mode === 'login'
              ? 'Sign In'
              : mode === 'signup'
              ? 'Create Account'
              : 'Send Reset Link'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export function VerifyEmailScreen() {
  const { user, checkEmailVerified, verifyWithGoogle, resendVerification, logout } = useApp();
  const [checking, setChecking] = useState(false);
  const [googleVerifying, setGoogleVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hasGoogleLinked = Boolean(
    user?.providerData?.some((p) => p.providerId === 'google.com')
  );
  const isGmail = Boolean(user?.email?.toLowerCase().endsWith('@gmail.com'));

  const handleCheck = async () => {
    setChecking(true);
    setMessage('');
    setError('');
    try {
      const verified = await checkEmailVerified();
      if (!verified) {
        setError(
          'Your email is not verified yet. Please check your inbox or spam folder, click the verification link, and try again.'
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setChecking(false);
    }
  };

  const handleGoogleVerify = async () => {
    setGoogleVerifying(true);
    setMessage('');
    setError('');
    try {
      const verified = await verifyWithGoogle();
      if (!verified) {
        setError(
          'Google sign-in completed, but email verification is still pending. Please try the email verification link.'
        );
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setGoogleVerifying(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setMessage('');
    setError('');
    try {
      await resendVerification();
      setMessage('A new verification link has been sent. Please check your inbox.');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="w-12 h-12 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
          <MailCheck className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">
            Verify Your Email
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your email{' '}
            <span className="font-semibold text-slate-900">{user?.email}</span>{' '}
            must be verified before accessing the workspace.
            {hasGoogleLinked || isGmail
              ? ' You can verify instantly with Google below, or click the verification link sent to your inbox.'
              : ' Click the link in your email to verify your address, then select the button below.'}
          </p>
        </div>

        {message && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            {message}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
            {error}
          </div>
        )}

        {(hasGoogleLinked || isGmail) && (
          <GoogleSignInButton
            onClick={() => void handleGoogleVerify()}
            disabled={googleVerifying || checking || resending}
            label={googleVerifying ? 'Verifying with Google...' : 'Verify Instantly with Google'}
          />
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking || googleVerifying}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {checking ? 'Checking...' : "I've Verified"}
          </button>

          <button
            type="button"
            onClick={handleResend}
            disabled={resending || googleVerifying}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            {resending ? 'Sending...' : 'Resend Link'}
          </button>
        </div>

        <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Wrong email address?</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-medium cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export function PendingApprovalScreen() {
  const {
    profile,
    user,
    publicCompanies,
    checkApprovalStatus,
    updateOwnProfile,
    logout,
  } = useApp();
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState(profile?.name || user?.displayName || '');
  const [editOrg, setEditOrg] = useState(profile?.organization || '');
  const [editDept, setEditDept] = useState(profile?.department || '');
  const [editDesig, setEditDesig] = useState(profile?.designation || '');
  const [editPhone, setEditPhone] = useState(profile?.phone || '');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const handleOpenEdit = () => {
    setEditName(profile?.name || user?.displayName || '');
    setEditOrg(profile?.organization || '');
    setEditDept(profile?.department || '');
    setEditDesig(profile?.designation || '');
    setEditPhone(profile?.phone || '');
    setSaveMessage('');
    setSaveError('');
    setEditing((prev) => !prev);
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      await updateOwnProfile({
        name: editName,
        organization: editOrg,
        department: editDept,
        designation: editDesig,
        phone: editPhone,
        employeeId: profile?.employeeId || '',
      });
      setSaveMessage('Your profile and organization details have been updated.');
      setEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Unable to save profile details.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    setFeedback('');
    try {
      const status = await checkApprovalStatus();
      if (status === 'pending') {
        setFeedback('Your account is still awaiting administrator approval.');
      }
    } finally {
      setChecking(false);
    }
  };

  const companyOptions = Array.from(
    new Set([...publicCompanies, ...(editOrg ? [editOrg] : [])].filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
          <Clock className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">
            Awaiting Admin Approval
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your email is verified. An administrator must approve your account before you can access{' '}
            <span className="font-semibold text-slate-900">{APP_NAME}</span>.
          </p>
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
          <div>
            Name:{' '}
            <span className="font-medium text-slate-900">
              {profile?.name || user?.displayName}
            </span>
          </div>
          <div>
            Email:{' '}
            <span className="font-medium text-slate-900">
              {profile?.email || user?.email}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span>
              Organization:{' '}
              <span className="font-semibold text-slate-900">
                {profile?.organization || 'Not selected yet'}
              </span>
            </span>
            <button
              type="button"
              onClick={handleOpenEdit}
              className="text-teal-700 font-semibold hover:underline cursor-pointer"
            >
              {editing ? 'Cancel' : 'Edit Info'}
            </button>
          </div>
          {(profile?.department || profile?.designation) && (
            <div>
              Role / Dept:{' '}
              <span className="font-medium text-slate-900">
                {[profile.designation, profile.department].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
        </div>

        {editing && (
          <form
            onSubmit={handleSaveDetails}
            className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-teal-700" />
              Update Your Details (Email stays locked)
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
                required
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Organization / Company
              </label>
              <select
                value={editOrg}
                onChange={(e) => setEditOrg(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="">Select your organization / company</option>
                {companyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Engineering"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Designation
                </label>
                <input
                  type="text"
                  value={editDesig}
                  onChange={(e) => setEditDesig(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Plant Manager"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Phone
              </label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                maxLength={30}
                placeholder="Optional contact number"
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            {saveError && (
              <div className="text-xs text-rose-700">{saveError}</div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Info'}
            </button>
          </form>
        )}

        {saveMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {saveMessage}
          </div>
        )}

        {feedback && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            {feedback}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleCheckStatus}
            disabled={checking}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking...' : 'Check Status'}
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export function RejectedScreen() {
  const { profile, logout } = useApp();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
        <div className="w-12 h-12 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700">
          <ShieldX className="w-6 h-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">
            Access Not Approved
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your access request for{' '}
            <span className="font-medium text-slate-900">{profile?.email}</span>{' '}
            was declined by an administrator. Please contact your organization admin for assistance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
