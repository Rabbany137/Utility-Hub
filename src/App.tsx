import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardPlus,
  FileSpreadsheet,
  FileText,
  Home,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
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
import { ForecastBudgetPage } from './components/ForecastBudgetPage';
import { ReportsPage } from './components/ReportsPage';
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
    title: 'Energy Intelligence & Operations',
    subtitle: 'Consumption, hourly intensity, tariff efficiency, and multi-factory spend benchmarking',
  },
  entry: {
    title: 'Daily Data Entry',
    subtitle: 'Record daily utility meters, equipment operating hours, captive power, and boiler steam',
  },
  reports: {
    title: 'Auto Summary Reports & Email',
    subtitle: 'Executive operational briefs, audit coverage, print exports, and daily mail preview',
  },
  forecast: {
    title: 'Budgets, Carbon & Forecast',
    subtitle: 'Month-end spend projections, factory budget variance, carbon footprint, and scenario simulation',
  },
  profile: {
    title: 'User Profile & Organization',
    subtitle: 'Manage your profile details, organization identity, and facility directory',
  },
  admin: {
    title: 'Administration & Setup',
    subtitle: 'Manage user permissions, daily push mails, factory assets, utility meters, and Sheets',
  },
};

function WorkspaceShell() {
  const {
    user,
    emailVerified,
    authReady,
    profile,
    profileLoading,
    profileError,
    allUsers,
    sheetsConfig,
    googleAccessToken,
    autoSyncState,
    connectGoogleSheets,
    runTwoWaySyncNow,
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
      id: 'reports',
      label: 'Reports & Mail',
      icon: <FileText className="w-4 h-4 shrink-0" />,
    });
    items.push({
      id: 'forecast',
      label: 'Budget & Forecast',
      icon: <TrendingUp className="w-4 h-4 shrink-0" />,
    });
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

  if (!emailVerified) {
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
                href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${(firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '-default-'}/rules`}
                target="_blank"
                rel="noreferrer"
                className="text-teal-700 font-medium underline"
              >
                Firebase Console Firestore Rules
              </a>{' '}
              for database{' '}
              <span className="font-mono-num font-semibold text-slate-900">
                {(firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '(default)'}
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
                className={`relative w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'text-teal-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebarActiveNav"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 bg-teal-50 border border-teal-200/80 rounded-lg"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-2.5 truncate">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="relative z-10 text-xs font-bold text-amber-700 tabular-nums">
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
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="fixed inset-0 bg-slate-900/40"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col z-10"
            >
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
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Crisp 3-Zone Top Bar */}
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
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
              className="lg:hidden inline-flex items-center gap-1.5 text-sm font-bold tracking-tight text-slate-900 hover:text-teal-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Home className="w-4 h-4 text-teal-700 shrink-0" />
              <span>{APP_NAME}</span>
            </button>
            <div className="lg:hidden h-4 w-px bg-slate-200 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base lg:text-lg font-bold text-slate-900 tracking-tight truncate">
                {pageMeta.title}
              </h1>
              <p className="hidden md:block text-xs text-slate-500 truncate">
                {pageMeta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            {profile.role === 'admin' && sheetsConfig && (() => {
              const needsOAuth =
                sheetsConfig.syncMode !== 'appsScript' && !googleAccessToken;
              const isPaused = sheetsConfig.autoSyncEnabled === false;
              const isSyncing = autoSyncState.status === 'syncing';
              const isError = autoSyncState.status === 'error';

              if (needsOAuth && !isPaused) {
                return (
                  <button
                    type="button"
                    onClick={() => void connectGoogleSheets().catch(() => {})}
                    title={autoSyncState.lastResultText || 'Authorize Google Sheets for automatic two-way sync'}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Reconnect Sheets
                  </button>
                );
              }

              return (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => {
                    if (isPaused) {
                      setActivePage('admin');
                    } else {
                      void runTwoWaySyncNow({ forceDirection: 'bidirectional' }).catch(
                        () => {}
                      );
                    }
                  }}
                  title={
                    autoSyncState.lastResultText ||
                    sheetsConfig.lastSyncSummary ||
                    'Run two-way Google Sheets sync'
                  }
                  className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-70 ${
                    isError
                      ? 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                      : isPaused
                      ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      : 'bg-emerald-50/80 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                  }`}
                >
                  {isSyncing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isSyncing
                      ? 'Syncing Sheets...'
                      : isError
                      ? 'Retry Sheets Sync'
                      : isPaused
                      ? 'Sheets Sync Paused'
                      : 'Sheets Auto-Sync'}
                  </span>
                </button>
              );
            })()}

            <div className="hidden xl:flex items-center gap-2 text-xs text-slate-500">
              {profile.organization && (
                <>
                  <span className="font-semibold text-slate-800">{profile.organization}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                </>
              )}
              <span>{ROLE_DISPLAY[profile.role]}</span>
            </div>
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activePage === 'dashboard' && (
                <DashboardPage onNavigate={setActivePage} />
              )}
              {activePage === 'entry' && canEnter && <DailyEntryPage />}
              {activePage === 'reports' && <ReportsPage onNavigate={setActivePage} />}
              {activePage === 'forecast' && (
                <ForecastBudgetPage onNavigate={setActivePage} />
              )}
              {activePage === 'profile' && <UserProfilePage />}
              {activePage === 'admin' && profile.role === 'admin' && (
                <AdminPage onNavigate={setActivePage} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <AppProvider>
          <WorkspaceShell />
        </AppProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
