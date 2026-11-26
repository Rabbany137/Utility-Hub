import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardPlus,
  Home,
  LogOut,
  Menu,
  ShieldCheck,
  UserCircle,
  X,
} from 'lucide-react';
import { AdminPage } from './components/AdminPage';
import {
  AuthLoginScreen,
  PendingApprovalScreen,
  RejectedScreen,
  VerifyEmailScreen,
} from './components/AuthScreens';
import { DailyEntryPage } from './components/DailyEntryPage';
import { DashboardPage } from './components/DashboardPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UserProfilePage } from './components/UserProfilePage';
import { APP_NAME } from './config';
import { AppProvider, useApp } from './context/AppContext';
import firebaseConfig from '../firebase-applet-config.json';
import type { ActivePage, UserRole } from './types';

const ROLE_DISPLAY: Record<UserRole, string> = {
  admin: 'Admin',
  entry: 'Data Entry',
  viewer: 'Viewer',
};

const PAGE_TITLES: Record<ActivePage, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Dashboard & Analytics',
    subtitle: 'Overview of utility consumption and cost across all companies',
  },
  entry: {
    title: 'Daily Data Entry',
    subtitle: 'Record and update daily utility readings and costs',
  },
  profile: {
    title: 'User Profile & Organization',
    subtitle: 'Manage your profile details, organization identity, and directory',
  },
  admin: {
    title: 'User Management',
    subtitle: 'Manage user approvals, roles, companies, and utility types',
  },
};

function WorkspaceShell() {
  const {
    user,
    authReady,
    profile,
    profileLoading,
    profileError,
    allUsers,
    logout,
    retryProfileLoad,
  } = useApp();
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = useMemo(() => {
    if (!profile) return [];
    const items: { id: ActivePage; label: string; icon: React.ReactNode; badge?: number }[] = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: <BarChart3 className="w-4 h-4 shrink-0" />,
      },
    ];
    if (profile.role === 'admin' || profile.role === 'entry') {
      items.push({
        id: 'entry',
        label: 'Daily Data Entry',
        icon: <ClipboardPlus className="w-4 h-4 shrink-0" />,
      });
    }
    items.push({
      id: 'profile',
      label: 'User Profile',
      icon: <UserCircle className="w-4 h-4 shrink-0" />,
    });
    if (profile.role === 'admin') {
      const pending = allUsers.filter((u) => u.status === 'pending').length;
      items.push({
        id: 'admin',
        label: 'User Management',
        icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
        badge: pending > 0 ? pending : undefined,
      });
    }
    return items;
  }, [profile, allUsers]);

  useEffect(() => {
    if (navItems.length > 0 && !navItems.some((item) => item.id === activePage)) {
      setActivePage('dashboard');
    }
  }, [navItems, activePage]);

  const handleGoHome = () => {
    setActivePage('dashboard');
    setMobileMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!authReady || profileLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthLoginScreen />;
  }

  if (!user.emailVerified) {
    return <VerifyEmailScreen />;
  }

  if (profileError && !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-bold text-slate-900">
            Database Connection Error
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            {profileError}
          </p>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
            <div>
              Active Firebase Project:{' '}
              <span className="font-mono-num font-semibold text-slate-900">
                {firebaseConfig.projectId}
              </span>
            </div>
            <div>
              Open{' '}
              <a
                href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId || '-default-'}/rules`}
                target="_blank"
                rel="noreferrer"
                className="text-teal-700 font-medium underline"
              >
                Firebase Console Firestore Rules
              </a>{' '}
              for database{' '}
              <span className="font-mono-num font-semibold text-slate-900">
                {firebaseConfig.firestoreDatabaseId || '(default)'}
              </span>{' '}
              and publish <span className="font-mono-num">firestore.rules</span>.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => void retryProfileLoad()}
              className="px-4 py-2 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || profile.status === 'pending') {
    return <PendingApprovalScreen />;
  }

  if (profile.status === 'rejected') {
    return <RejectedScreen />;
  }

  const pageMeta = PAGE_TITLES[activePage];
  const canEnter = profile.role === 'admin' || profile.role === 'entry';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={handleGoHome}
            title="Go to Dashboard Home"
            className="text-xl font-bold tracking-tight text-slate-900 hover:text-teal-700 transition-colors whitespace-nowrap cursor-pointer text-left"
          >
            {APP_NAME}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-teal-50 text-teal-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="text-xs font-bold text-amber-700 tabular-nums">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <button
            type="button"
            onClick={() => setActivePage('profile')}
            title="Open User Profile"
            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors space-y-0.5 cursor-pointer"
          >
            <div className="text-sm font-semibold text-slate-900 truncate">
              {profile.name}
            </div>
            {profile.organization && (
              <div className="text-[11px] font-semibold text-teal-800 truncate">
                {profile.organization}
              </div>
            )}
            <div className="text-xs text-slate-500 truncate">
              {ROLE_DISPLAY[profile.role]} · {profile.email}
            </div>
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <button
                type="button"
                onClick={handleGoHome}
                title="Go to Dashboard Home"
                className="text-lg font-bold text-slate-900 hover:text-teal-700 transition-colors cursor-pointer"
              >
                {APP_NAME}
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-4 space-y-1">
              {navItems.map((item) => {
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePage(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-teal-50 text-teal-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span className="text-xs font-bold text-amber-700 tabular-nums">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setActivePage('profile');
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors space-y-0.5 cursor-pointer"
              >
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {profile.name}
                </div>
                {profile.organization && (
                  <div className="text-[11px] font-semibold text-teal-800 truncate">
                    {profile.organization}
                  </div>
                )}
                <div className="text-xs text-slate-500 truncate">
                  {ROLE_DISPLAY[profile.role]} · {profile.email}
                </div>
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleGoHome}
              title="Back to Utility Hub Home"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold tracking-tight transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                activePage === 'dashboard'
                  ? 'bg-slate-100 text-slate-900 border-slate-200 hover:bg-slate-200'
                  : 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'
              }`}
            >
              <Home className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              <span>{APP_NAME}</span>
            </button>
            <div className="hidden sm:block h-5 w-px bg-slate-200 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base lg:text-lg font-bold text-slate-900 truncate">
                {pageMeta.title}
              </h1>
              <p className="hidden md:block text-xs text-slate-500 truncate">
                {pageMeta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {activePage !== 'entry' && canEnter && (
              <button
                type="button"
                onClick={() => setActivePage('entry')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ClipboardPlus className="w-4 h-4" />
                Daily Entry
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {activePage === 'dashboard' && (
            <DashboardPage onNavigate={setActivePage} />
          )}
          {activePage === 'entry' && canEnter && <DailyEntryPage />}
          {activePage === 'profile' && <UserProfilePage />}
          {activePage === 'admin' && profile.role === 'admin' && <AdminPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <WorkspaceShell />
      </AppProvider>
    </ErrorBoundary>
  );
}
