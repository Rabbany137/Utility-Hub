import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  Edit3,
  Eye,
  EyeOff,
  Flame,
  IdCard,
  KeyRound,
  Lock,
  Mail,
  Phone,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { hasGoogleProvider, hasPasswordProvider } from '../firebase';
import type { CompanyItem, UserDirectoryEntry, UserProfile, UserRole, UserStatus } from '../types';
import { formatEquipmentSummary } from '../utils/equipment';
import { formatDateTime, formatNumber } from '../utils/formatters';
import { CompanyEquipmentEditor } from './CompanyEquipmentEditor';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  entry: 'Data Entry',
  viewer: 'Viewer',
};

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: 'bg-teal-50 text-teal-800 border-teal-200',
  entry: 'bg-sky-50 text-sky-800 border-sky-200',
  viewer: 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  rejected: 'bg-rose-50 text-rose-800 border-rose-200',
};

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function mapPasswordError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Current password is incorrect.';
    case 'auth/weak-password':
      return 'New password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/requires-recent-login':
      return 'For your security, please re-verify your session and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google verification popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is currently disabled in Firebase Authentication.';
    case 'auth/network-request-failed':
      return 'Network error while updating password. Please check your connection.';
    default:
      return msg || 'Failed to update password. Please try again.';
  }
}

export function UserProfilePage() {
  const {
    user,
    profile,
    companies,
    publicCompanies,
    utilities,
    allUsers,
    directoryUsers,
    updateOwnProfile,
    adminUpdateUser,
    changePassword,
    linkPassword,
    resetPassword,
  } = useApp();

  const [name, setName] = useState(profile?.name || '');
  const [organizationSelect, setOrganizationSelect] = useState(profile?.organization || '');
  const [customOrganization, setCustomOrganization] = useState('');
  const [department, setDepartment] = useState(profile?.department || '');
  const [designation, setDesignation] = useState(profile?.designation || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [employeeId, setEmployeeId] = useState(profile?.employeeId || '');
  const [savingOwn, setSavingOwn] = useState(false);
  const [ownToast, setOwnToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Organization Equipment Setup state
  const [openEquipCompanyId, setOpenEquipCompanyId] = useState<string | null>(null);
  const [equipToast, setEquipToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Password Change / Link Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [resetEmailBusy, setResetEmailBusy] = useState(false);
  const [pwdToast, setPwdToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Team Directory state (for Admin & Viewer)
  const [dirSearch, setDirSearch] = useState('');
  const [dirOrgFilter, setDirOrgFilter] = useState('ALL');
  const [dirRoleFilter, setDirRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    organization: string;
    department: string;
    designation: string;
    phone: string;
    employeeId: string;
  }>({
    name: '',
    organization: '',
    department: '',
    designation: '',
    phone: '',
    employeeId: '',
  });
  const [savingAdminEdit, setSavingAdminEdit] = useState(false);
  const [dirToast, setDirToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const companyOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of companies) {
      if (c.name) names.add(c.name);
    }
    for (const n of publicCompanies) {
      if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [companies, publicCompanies]);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name || '');
    const org = (profile.organization || '').trim();
    if (!org || companyOptions.includes(org)) {
      setOrganizationSelect(org);
      setCustomOrganization('');
    } else {
      setOrganizationSelect('__other__');
      setCustomOrganization(org);
    }
    setDepartment(profile.department || '');
    setDesignation(profile.designation || '');
    setPhone(profile.phone || '');
    setEmployeeId(profile.employeeId || '');
  }, [profile, companyOptions]);

  const utilityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of utilities) {
      map.set(u.id, u.name);
    }
    return map;
  }, [utilities]);

  const formatAllowedUtilitiesText = (ids?: string[]): string => {
    if (!ids || ids.length === 0) return 'All Utilities';
    if (ids.length === 1 && ids[0] === '__none__') return 'None (Hidden)';
    const valid = ids.filter((id) => id !== '__none__');
    if (valid.length === 0) return 'None (Hidden)';
    return valid.map((id) => utilityNameMap.get(id) || id).join(', ');
  };

  const handleSaveOwnProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setOwnToast(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setOwnToast({ type: 'error', text: 'Full name cannot be empty.' });
      return;
    }
    const resolvedOrg =
      organizationSelect === '__other__'
        ? customOrganization.trim()
        : organizationSelect.trim();

    setSavingOwn(true);
    try {
      await updateOwnProfile({
        name: cleanName,
        organization: resolvedOrg,
        department: department.trim(),
        designation: designation.trim(),
        phone: phone.trim(),
        employeeId: employeeId.trim(),
      });
      setOwnToast({
        type: 'success',
        text: 'Your profile details have been saved.',
      });
    } catch (err) {
      setOwnToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setSavingOwn(false);
    }
  };

  const canSeeDirectory = profile?.role === 'admin' || profile?.role === 'viewer';
  const isAdmin = profile?.role === 'admin';
  const isPasswordLinked = hasPasswordProvider(user);
  const isGoogleLinked = hasGoogleProvider(user);

  const editableCompanyNames = useMemo(() => {
    if (!profile) return new Set<string>();
    if (profile.role === 'admin') {
      return new Set(companies.map((c) => c.name));
    }
    if (profile.role === 'entry') {
      return new Set(profile.companies || []);
    }
    return new Set<string>();
  }, [profile, companies]);

  const organizationFactories = useMemo<CompanyItem[]>(() => {
    if (!profile) return [];
    if (profile.role === 'admin') return companies;

    const relevantNames = new Set<string>();
    const orgName = (profile.organization || '').trim();
    if (orgName) relevantNames.add(orgName);
    for (const c of profile.companies || []) {
      if (c) relevantNames.add(c);
    }
    for (const c of profile.viewCompanies || []) {
      if (c) relevantNames.add(c);
    }
    return companies.filter((c) => relevantNames.has(c.name));
  }, [profile, companies]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setPwdToast(null);

    if (isPasswordLinked && !currentPassword) {
      setPwdToast({ type: 'error', text: 'Please enter your current password.' });
      return;
    }
    if (newPassword.length < 6) {
      setPwdToast({
        type: 'error',
        text: 'New password must be at least 6 characters long.',
      });
      return;
    }
    if (isPasswordLinked && newPassword === currentPassword) {
      setPwdToast({
        type: 'error',
        text: 'New password must be different from your current password.',
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwdToast({
        type: 'error',
        text: 'New password and confirm password do not match.',
      });
      return;
    }

    setPwdBusy(true);
    try {
      if (isPasswordLinked) {
        await changePassword(currentPassword, newPassword);
        setPwdToast({
          type: 'success',
          text: 'Your password has been changed successfully.',
        });
      } else {
        await linkPassword(newPassword);
        setPwdToast({
          type: 'success',
          text: 'Account password has been set successfully.',
        });
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowCurrentPwd(false);
      setShowNewPwd(false);
      setShowConfirmPwd(false);
    } catch (err) {
      setPwdToast({ type: 'error', text: mapPasswordError(err) });
    } finally {
      setPwdBusy(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!profile?.email) return;
    setPwdToast(null);
    setResetEmailBusy(true);
    try {
      await resetPassword(profile.email);
      setPwdToast({
        type: 'success',
        text: `Password reset link sent to ${profile.email}. Check your inbox or spam folder.`,
      });
    } catch (err) {
      setPwdToast({ type: 'error', text: mapPasswordError(err) });
    } finally {
      setResetEmailBusy(false);
    }
  };

  const adminUserMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of allUsers) {
      map.set(u.uid, u);
    }
    return map;
  }, [allUsers]);

  const directorySource: UserDirectoryEntry[] = useMemo(() => {
    return directoryUsers;
  }, [directoryUsers]);

  const directoryOrganizations = useMemo(() => {
    const orgSet = new Set<string>(companyOptions);
    for (const u of directorySource) {
      if (u.organization) orgSet.add(u.organization);
    }
    return Array.from(orgSet).sort((a, b) => a.localeCompare(b));
  }, [companyOptions, directorySource]);

  const filteredDirectory = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    return directorySource.filter((u) => {
      if (dirRoleFilter !== 'ALL' && u.role !== dirRoleFilter) return false;
      if (dirOrgFilter === '__unassigned__') {
        if (u.organization.trim()) return false;
      } else if (dirOrgFilter !== 'ALL' && u.organization !== dirOrgFilter) {
        return false;
      }
      if (!q) return true;
      const fullAdmin = adminUserMap.get(u.uid);
      return (
        u.name.toLowerCase().includes(q) ||
        u.organization.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.designation.toLowerCase().includes(q) ||
        u.employeeId.toLowerCase().includes(q) ||
        (fullAdmin?.email || '').toLowerCase().includes(q) ||
        (fullAdmin?.phone || '').toLowerCase().includes(q)
      );
    });
  }, [directorySource, dirSearch, dirOrgFilter, dirRoleFilter, adminUserMap]);

  const handleStartAdminEdit = (entry: UserDirectoryEntry) => {
    const full = adminUserMap.get(entry.uid);
    setDirToast(null);
    setEditingUid(entry.uid);
    setEditDraft({
      name: full?.name || entry.name,
      organization: full?.organization || entry.organization || '',
      department: full?.department || entry.department || '',
      designation: full?.designation || entry.designation || '',
      phone: full?.phone || '',
      employeeId: full?.employeeId || entry.employeeId || '',
    });
  };

  const handleSaveAdminEdit = async (entry: UserDirectoryEntry) => {
    const target = adminUserMap.get(entry.uid);
    if (!target) return;
    if (!editDraft.name.trim()) {
      setDirToast({ type: 'error', text: 'User name cannot be empty.' });
      return;
    }
    setSavingAdminEdit(true);
    setDirToast(null);
    try {
      await adminUpdateUser(target, {
        name: editDraft.name.trim(),
        organization: editDraft.organization.trim(),
        department: editDraft.department.trim(),
        designation: editDraft.designation.trim(),
        phone: editDraft.phone.trim(),
        employeeId: editDraft.employeeId.trim(),
      });
      setEditingUid(null);
      setDirToast({
        type: 'success',
        text: `Updated profile details for ${editDraft.name.trim()}.`,
      });
    } catch (err) {
      setDirToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update user details.',
      });
    } finally {
      setSavingAdminEdit(false);
    }
  };

  if (!profile) return null;

  return (
    <div className="space-y-6">
      {/* Top Identity Overview Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-xl bg-teal-700 text-white font-bold text-lg flex items-center justify-center shrink-0">
              {getInitials(profile.name)}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 truncate">
                  {profile.name}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${ROLE_BADGE_CLASS[profile.role]}`}
                >
                  <Shield className="w-3 h-3" />
                  {ROLE_LABELS[profile.role]}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${STATUS_BADGE_CLASS[profile.status]}`}
                >
                  <BadgeCheck className="w-3 h-3" />
                  {profile.status.charAt(0).toUpperCase() + profile.status.slice(1)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-semibold text-teal-800">
                  <Building2 className="w-3.5 h-3.5 text-teal-700" />
                  {profile.organization || 'Organization not set'}
                </span>
                {(profile.designation || profile.department) && (
                  <span className="inline-flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                    {[profile.designation, profile.department].filter(Boolean).join(' · ')}
                  </span>
                )}
                {profile.employeeId && (
                  <span className="inline-flex items-center gap-1.5 font-mono-num">
                    <IdCard className="w-3.5 h-3.5 text-slate-400" />
                    ID: {profile.employeeId}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              {profile.email}
            </span>
            {profile.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                {profile.phone}
              </span>
            )}
            <span>Member since {formatDateTime(profile.createdAt?.toDate())}</span>
          </div>
        </div>

        {/* Access Summary Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="font-semibold text-slate-700">Assigned Entry Factories</div>
            <div className="text-slate-600">
              {profile.role === 'admin'
                ? 'All Factories (Administrator)'
                : profile.companies.length > 0
                ? profile.companies.join(', ')
                : 'Read-only / None'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="font-semibold text-slate-700">View Factories (Dashboard)</div>
            <div className="text-slate-600">
              {profile.role === 'admin'
                ? 'All Factories (Administrator)'
                : profile.viewCompanies.length > 0
                ? profile.viewCompanies.join(', ')
                : 'None assigned yet'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
            <div className="font-semibold text-slate-700 inline-flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-teal-700" />
              Allowed Utilities
            </div>
            <div className="text-slate-600">
              {profile.role === 'admin'
                ? 'All Utilities (Administrator)'
                : formatAllowedUtilitiesText(profile.allowedUtilities)}
            </div>
          </div>
        </div>
      </div>

      {/* Self-Service Profile Editor (Email Locked) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Update Personal &amp; Organization Information
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              You can update your own name, organization, department, designation, employee ID, and phone number. Your login email cannot be changed.
            </p>
          </div>
          {ownToast && (
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                ownToast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {ownToast.text}
            </div>
          )}
        </div>

        <form onSubmit={handleSaveOwnProfile} className="pt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="prof-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-email"
                className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1"
              >
                <span>Email Address</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <Lock className="w-3 h-3" />
                  Locked
                </span>
              </label>
              <input
                id="prof-email"
                type="email"
                value={profile.email}
                disabled
                readOnly
                className="w-full px-3.5 py-2 text-sm bg-slate-100 text-slate-500 border border-slate-200 rounded-lg cursor-not-allowed"
              />
            </div>

            <div>
              <label
                htmlFor="prof-org"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Organization / Company
              </label>
              <select
                id="prof-org"
                value={organizationSelect}
                onChange={(e) => setOrganizationSelect(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="">Select organization / company</option>
                {companyOptions.map((comp) => (
                  <option key={comp} value={comp}>
                    {comp}
                  </option>
                ))}
                <option value="__other__">Other / Custom</option>
              </select>
            </div>

            {organizationSelect === '__other__' && (
              <div>
                <label
                  htmlFor="prof-org-custom"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Custom Organization Name
                </label>
                <input
                  id="prof-org-custom"
                  type="text"
                  value={customOrganization}
                  onChange={(e) => setCustomOrganization(e.target.value)}
                  maxLength={100}
                  placeholder="Enter organization name"
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="prof-dept"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Department
              </label>
              <input
                id="prof-dept"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                maxLength={80}
                placeholder="e.g. Utilities & Engineering"
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-desig"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Designation
              </label>
              <input
                id="prof-desig"
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                maxLength={80}
                placeholder="e.g. Senior Engineer"
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-empid"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Employee ID
              </label>
              <input
                id="prof-empid"
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                maxLength={40}
                placeholder="e.g. EMP-1042"
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label
                htmlFor="prof-phone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Phone Number
              </label>
              <input
                id="prof-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                placeholder="e.g. +880 17XX-XXXXXX"
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={savingOwn}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {savingOwn ? 'Saving Changes...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Organization Equipment & Power Setup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold text-slate-900">
                Organization Equipment &amp; Power Setup
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {profile.role === 'viewer'
                ? 'View boilers, captive generators, solar arrays, and grid electricity providers configured for your organization. Data Entry or Admin access is required to modify equipment.'
                : 'Add or update boilers, captive generators, solar systems, and grid electricity providers for your assigned organization factories.'}
            </p>
          </div>
          {equipToast && (
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                equipToast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {equipToast.text}
            </div>
          )}
        </div>

        {organizationFactories.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
            No factory is linked to your profile yet. Select your organization above or ask an Admin to assign your factories.
          </div>
        ) : (
          <div className="space-y-3">
            {organizationFactories.map((comp) => {
              const canEditComp = editableCompanyNames.has(comp.name);
              const isOpen = openEquipCompanyId === comp.id;
              const isPrimaryOrg =
                (profile.organization || '').trim().toLowerCase() === comp.name.toLowerCase();

              return (
                <div
                  key={comp.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {comp.name}
                        </span>
                        {isPrimaryOrg && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-teal-50 text-teal-800 border border-teal-200">
                            Your Organization
                          </span>
                        )}
                        {!canEditComp && (
                          <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-slate-100 text-slate-600">
                            Read-Only
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <Zap className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>{formatEquipmentSummary(comp)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEquipToast(null);
                        setOpenEquipCompanyId((prev) =>
                          prev === comp.id ? null : comp.id
                        );
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer shrink-0 transition-colors ${
                        isOpen
                          ? 'bg-teal-700 text-white'
                          : 'bg-teal-50 text-teal-800 hover:bg-teal-100'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      {isOpen
                        ? 'Hide Equipment'
                        : canEditComp
                        ? 'Update Equipment'
                        : 'View Equipment'}
                    </button>
                  </div>

                  {isOpen && (
                    <CompanyEquipmentEditor
                      company={comp}
                      canEdit={canEditComp}
                      onClose={() => setOpenEquipCompanyId(null)}
                      onSaved={(msg) => {
                        setOpenEquipCompanyId(null);
                        setEquipToast({ type: 'success', text: msg });
                      }}
                      onError={(msg) => setEquipToast({ type: 'error', text: msg })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Password & Account Security */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-teal-700" />
              <h3 className="text-base font-bold text-slate-900">
                Password &amp; Account Security
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPasswordLinked
                ? 'Change your account password after confirming your current password.'
                : 'Your account currently uses Google sign-in. Set a password below after verifying with Google.'}
            </p>
          </div>
          {pwdToast && (
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                pwdToast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {pwdToast.text}
            </div>
          )}
        </div>

        <form onSubmit={handlePasswordSubmit} className="pt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {isPasswordLinked && (
              <div>
                <label
                  htmlFor="prof-current-pwd"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Current Password
                </label>
                <div className="relative">
                  <input
                    id="prof-current-pwd"
                    type={showCurrentPwd ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter current password"
                    required
                    className="w-full pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPwd((p) => !p)}
                    aria-label={showCurrentPwd ? 'Hide current password' : 'Show current password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="prof-new-pwd"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="prof-new-pwd"
                  type={showNewPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  placeholder="Minimum 6 characters"
                  required
                  className="w-full pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd((p) => !p)}
                  aria-label={showNewPwd ? 'Hide new password' : 'Show new password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="prof-confirm-pwd"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="prof-confirm-pwd"
                  type={showConfirmPwd ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  placeholder="Re-enter new password"
                  required
                  className="w-full pl-3.5 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPwd((p) => !p)}
                  aria-label={showConfirmPwd ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              {isPasswordLinked && (
                <button
                  type="button"
                  disabled={resetEmailBusy || pwdBusy}
                  onClick={() => void handleSendResetEmail()}
                  className="text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline disabled:opacity-50 cursor-pointer"
                >
                  {resetEmailBusy
                    ? 'Sending password reset email...'
                    : 'Forgot current password? Send reset email'}
                </button>
              )}
              {!isPasswordLinked && !isGoogleLinked && (
                <span className="text-xs text-slate-500">
                  Password sign-in is linked to {profile.email}.
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={pwdBusy}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              {pwdBusy
                ? isPasswordLinked
                  ? 'Updating Password...'
                  : 'Setting Password...'
                : isPasswordLinked
                ? 'Change Password'
                : 'Verify Google & Set Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Organization & User Directory (Admin + Viewer) */}
      {canSeeDirectory && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-700" />
                <h3 className="text-base font-bold text-slate-900">
                  Organization &amp; Team Directory ({formatNumber(filteredDirectory.length, 0)})
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin
                  ? 'Full member directory across all companies. Edit any user profile details or organization assignment directly below.'
                  : 'Read-only directory showing each member’s organization, role, designation, and assigned utility/factory scope.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  placeholder="Search name, company, ID..."
                  className="w-full pl-8 pr-7 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                {dirSearch && (
                  <button
                    type="button"
                    onClick={() => setDirSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={dirOrgFilter}
                onChange={(e) => setDirOrgFilter(e.target.value)}
                aria-label="Filter by organization"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">All Organizations</option>
                <option value="__unassigned__">Unassigned Organization</option>
                {directoryOrganizations.map((org) => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>

              <select
                value={dirRoleFilter}
                onChange={(e) => setDirRoleFilter(e.target.value as 'ALL' | UserRole)}
                aria-label="Filter by role"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">All Roles</option>
                <option value="admin">Admin</option>
                <option value="entry">Data Entry</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          </div>

          {dirToast && (
            <div
              className={`mx-5 sm:mx-6 mt-4 px-3.5 py-2 rounded-lg border text-xs font-medium ${
                dirToast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {dirToast.text}
            </div>
          )}

          {filteredDirectory.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No team members match the current filters.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredDirectory.map((entry) => {
                const fullAdmin = adminUserMap.get(entry.uid);
                const isEditingThis = editingUid === entry.uid;
                const isSelf = entry.uid === profile.uid;

                return (
                  <div key={entry.uid} className="p-5 sm:p-6 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {getInitials(entry.name)}
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {entry.name}
                            </span>
                            {isSelf && (
                              <span className="text-[11px] font-semibold text-teal-700">
                                (You)
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${ROLE_BADGE_CLASS[entry.role]}`}
                            >
                              {ROLE_LABELS[entry.role]}
                            </span>
                            <span
                              className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${STATUS_BADGE_CLASS[entry.status]}`}
                            >
                              {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                            <span className="inline-flex items-center gap-1 font-semibold text-teal-800">
                              <Building2 className="w-3.5 h-3.5 text-teal-700" />
                              {entry.organization || 'No organization specified'}
                            </span>
                            {(entry.designation || entry.department) && (
                              <span className="inline-flex items-center gap-1">
                                <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                                {[entry.designation, entry.department].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {entry.employeeId && (
                              <span className="inline-flex items-center gap-1 font-mono-num">
                                <IdCard className="w-3.5 h-3.5 text-slate-400" />
                                {entry.employeeId}
                              </span>
                            )}
                            {isAdmin && fullAdmin?.email && (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <Mail className="w-3.5 h-3.5 text-slate-400" />
                                {fullAdmin.email}
                              </span>
                            )}
                            {isAdmin && fullAdmin?.phone && (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <Phone className="w-3.5 h-3.5 text-slate-400" />
                                {fullAdmin.phone}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-slate-600">
                            {entry.role === 'admin' ? (
                              <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 font-medium">
                                Full Access (All Factories &amp; Utilities)
                              </span>
                            ) : (
                              <>
                                {entry.role === 'entry' && (
                                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                    Entry:{' '}
                                    {entry.companies.length > 0
                                      ? entry.companies.join(', ')
                                      : 'None'}
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 inline-flex items-center gap-1">
                                  <Eye className="w-3 h-3 text-slate-400" />
                                  View:{' '}
                                  {entry.viewCompanies.length > 0
                                    ? entry.viewCompanies.join(', ')
                                    : 'None'}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900">
                                  Utilities: {formatAllowedUtilitiesText(entry.allowedUtilities)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {isAdmin && fullAdmin && (
                        <div className="shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              isEditingThis
                                ? setEditingUid(null)
                                : handleStartAdminEdit(entry)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {isEditingThis ? 'Close Editor' : 'Edit User'}
                          </button>
                        </div>
                      )}
                    </div>

                    {isAdmin && isEditingThis && fullAdmin && (
                      <div className="mt-3 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                        <div className="text-xs font-bold text-slate-800">
                          Edit User Profile Details (Email locked: {fullAdmin.email})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Full Name
                            </label>
                            <input
                              type="text"
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft((prev) => ({ ...prev, name: e.target.value }))
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
                              value={
                                companyOptions.includes(editDraft.organization)
                                  ? editDraft.organization
                                  : editDraft.organization
                                  ? '__custom__'
                                  : ''
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__custom__') return;
                                setEditDraft((prev) => ({ ...prev, organization: v }));
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            >
                              <option value="">Not assigned</option>
                              {companyOptions.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                              {editDraft.organization &&
                                !companyOptions.includes(editDraft.organization) && (
                                  <option value="__custom__">{editDraft.organization}</option>
                                )}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Department
                            </label>
                            <input
                              type="text"
                              value={editDraft.department}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
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
                              value={editDraft.designation}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
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
                              value={editDraft.employeeId}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
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
                              value={editDraft.phone}
                              onChange={(e) =>
                                setEditDraft((prev) => ({ ...prev, phone: e.target.value }))
                              }
                              maxLength={30}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingUid(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={savingAdminEdit}
                            onClick={() => void handleSaveAdminEdit(entry)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {savingAdminEdit ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
