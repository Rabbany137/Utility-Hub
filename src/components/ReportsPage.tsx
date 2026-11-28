import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Flame,
  Mail,
  Monitor,
  Printer,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  X,
  Zap,
} from 'lucide-react';
import { APP_NAME } from '../config';
import { useApp } from '../context/AppContext';
import {
  GmailAuthError,
  isValidEmailAddress,
  sendReportViaAppsScript,
  sendReportViaGmail,
} from '../services/dailyMail';
import { isValidAppsScriptUrl } from '../services/googleSheets';
import type { ActivePage } from '../types';
import {
  buildDailyReportEmailHtml,
  buildDailyReportPlainText,
  buildDailyReportSubject,
  buildExecutiveSummaryReport,
} from '../utils/dailyReportBuilder';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  getDaysAgoISO,
  getMonthEndISO,
  getMonthStartISO,
  getTodayISO,
  shiftDaysISO,
} from '../utils/formatters';

type ReportPreset = 'yesterday' | 'today' | '7d' | 'thisMonth' | 'custom';
type ReportTab = 'summary' | 'email';
type MailTransport = 'gmail' | 'appsScript';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

interface DispatchTarget {
  uid?: string;
  name: string;
  email: string;
  scheduledTime?: string;
  organization?: string;
  companies: string[];
  allowedUtilities: string[];
}

export function ReportsPage({
  onNavigate,
}: {
  onNavigate?: (page: ActivePage) => void;
} = {}) {
  const {
    profile,
    allUsers,
    companies,
    utilities,
    entries,
    generationEntries,
    sheetsConfig,
    googleAccessToken,
    connectGoogleSheets,
    clearGoogleToken,
    adminUpdateUser,
  } = useApp();

  const isAdmin = profile?.role === 'admin';
  const todayISO = getTodayISO();
  const yesterdayISO = getDaysAgoISO(1);

  const [preset, setPreset] = useState<ReportPreset>('yesterday');
  const [customStart, setCustomStart] = useState<string>(() => getDaysAgoISO(6));
  const [customEnd, setCustomEnd] = useState<string>(() => getTodayISO());
  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<ReportTab>('summary');

  const [selectedRecipientUid, setSelectedRecipientUid] = useState<string>('__custom__');
  const [customRecipientEmail, setCustomRecipientEmail] = useState<string>(
    () => profile?.dailyMailEmail || profile?.email || ''
  );
  const [customRecipientName, setCustomRecipientName] = useState<string>(
    () => profile?.name || 'Stakeholder'
  );

  const hasAppsScriptWebhook = Boolean(
    sheetsConfig?.syncMode === 'appsScript' &&
      sheetsConfig?.webhookUrl &&
      isValidAppsScriptUrl(sheetsConfig.webhookUrl)
  );

  const [transport, setTransport] = useState<MailTransport>(() =>
    googleAccessToken ? 'gmail' : hasAppsScriptWebhook ? 'appsScript' : 'gmail'
  );
  const [confirmDispatch, setConfirmDispatch] = useState<{
    mode: 'single' | 'batch';
    targets: DispatchTarget[];
  } | null>(null);
  const [sendingMail, setSendingMail] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const visibleCompanies = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'admin') {
      return companies.map((c) => c.name);
    }
    const allowedSet = new Set(profile.viewCompanies);
    return companies.filter((c) => allowedSet.has(c.name)).map((c) => c.name);
  }, [profile, companies]);

  const userAllowedUtilityIds = useMemo(() => {
    if (!profile || profile.role === 'admin') return undefined;
    return profile.allowedUtilities;
  }, [profile]);

  const dateBounds = useMemo(() => {
    if (preset === 'yesterday') {
      const comp = shiftDaysISO(yesterdayISO, -1);
      return {
        startDate: yesterdayISO,
        endDate: yesterdayISO,
        periodLabel: `Yesterday (${formatDate(yesterdayISO)})`,
        comparisonStart: comp,
        comparisonEnd: comp,
        comparisonLabel: formatDate(comp),
      };
    }
    if (preset === 'today') {
      return {
        startDate: todayISO,
        endDate: todayISO,
        periodLabel: `Today (${formatDate(todayISO)})`,
        comparisonStart: yesterdayISO,
        comparisonEnd: yesterdayISO,
        comparisonLabel: formatDate(yesterdayISO),
      };
    }
    if (preset === '7d') {
      const start = getDaysAgoISO(6);
      const compEnd = shiftDaysISO(start, -1);
      const compStart = shiftDaysISO(compEnd, -6);
      return {
        startDate: start,
        endDate: todayISO,
        periodLabel: 'Last 7 Days',
        comparisonStart: compStart,
        comparisonEnd: compEnd,
        comparisonLabel: `${formatDate(compStart)} – ${formatDate(compEnd)}`,
      };
    }
    if (preset === 'thisMonth') {
      const start = getMonthStartISO(0);
      const prevStart = getMonthStartISO(-1);
      const prevEnd = getMonthEndISO(-1);
      return {
        startDate: start,
        endDate: todayISO,
        periodLabel: 'Month to Date',
        comparisonStart: prevStart,
        comparisonEnd: prevEnd,
        comparisonLabel: `${formatDate(prevStart)} – ${formatDate(prevEnd)}`,
      };
    }
    const safeStart = customStart <= customEnd ? customStart : customEnd;
    const safeEnd = customEnd >= customStart ? customEnd : customStart;
    return {
      startDate: safeStart,
      endDate: safeEnd,
      periodLabel: `${formatDate(safeStart)} – ${formatDate(safeEnd)}`,
      comparisonStart: undefined,
      comparisonEnd: undefined,
      comparisonLabel: undefined,
    };
  }, [preset, todayISO, yesterdayISO, customStart, customEnd]);

  const scopeCompanies = useMemo(() => {
    if (selectedCompany !== 'ALL' && visibleCompanies.includes(selectedCompany)) {
      return [selectedCompany];
    }
    return visibleCompanies;
  }, [selectedCompany, visibleCompanies]);

  const report = useMemo(
    () =>
      buildExecutiveSummaryReport({
        entries,
        generationEntries,
        companies,
        utilities,
        startDate: dateBounds.startDate,
        endDate: dateBounds.endDate,
        periodLabel: dateBounds.periodLabel,
        comparisonStart: dateBounds.comparisonStart,
        comparisonEnd: dateBounds.comparisonEnd,
        comparisonLabel: dateBounds.comparisonLabel,
        scopeCompanies,
        allowedUtilityIds: userAllowedUtilityIds,
        todayISO,
      }),
    [
      entries,
      generationEntries,
      companies,
      utilities,
      dateBounds,
      scopeCompanies,
      userAllowedUtilityIds,
      todayISO,
    ]
  );

  const approvedUsers = useMemo(
    () =>
      allUsers
        .filter((u) => u.status === 'approved')
        .sort((a, b) => {
          const ae = a.dailyMailEnabled ? 0 : 1;
          const be = b.dailyMailEnabled ? 0 : 1;
          if (ae !== be) return ae - be;
          return a.name.localeCompare(b.name);
        }),
    [allUsers]
  );

  const enabledDailyMailUsers = useMemo(
    () =>
      approvedUsers.filter(
        (u) => u.dailyMailEnabled && isValidEmailAddress(u.dailyMailEmail || u.email)
      ),
    [approvedUsers]
  );

  const dueDailyMailUsers = useMemo(
    () => enabledDailyMailUsers.filter((u) => u.lastDailyMailSentDate !== todayISO),
    [enabledDailyMailUsers, todayISO]
  );

  const selectedUserRecord = useMemo(() => {
    if (!isAdmin || selectedRecipientUid === '__custom__') return null;
    return approvedUsers.find((u) => u.uid === selectedRecipientUid) || null;
  }, [isAdmin, selectedRecipientUid, approvedUsers]);

  // Scoped preview report matching the selected recipient (if Admin picks a specific user)
  const previewReport = useMemo(() => {
    if (!selectedUserRecord) return report;
    const allCompNames = companies.map((c) => c.name);
    const userCompanies =
      selectedUserRecord.role === 'admin'
        ? allCompNames
        : selectedUserRecord.viewCompanies.filter((c) => allCompNames.includes(c));
    const finalScope =
      selectedCompany !== 'ALL' && userCompanies.includes(selectedCompany)
        ? [selectedCompany]
        : userCompanies.length > 0
        ? userCompanies
        : scopeCompanies;

    return buildExecutiveSummaryReport({
      entries,
      generationEntries,
      companies,
      utilities,
      startDate: dateBounds.startDate,
      endDate: dateBounds.endDate,
      periodLabel: dateBounds.periodLabel,
      comparisonStart: dateBounds.comparisonStart,
      comparisonEnd: dateBounds.comparisonEnd,
      comparisonLabel: dateBounds.comparisonLabel,
      scopeCompanies: finalScope,
      allowedUtilityIds:
        selectedUserRecord.role === 'admin'
          ? undefined
          : selectedUserRecord.allowedUtilities,
      todayISO,
    });
  }, [
    selectedUserRecord,
    report,
    companies,
    selectedCompany,
    scopeCompanies,
    entries,
    generationEntries,
    utilities,
    dateBounds,
    todayISO,
  ]);

  const effectiveRecipientEmail = useMemo(() => {
    if (selectedUserRecord) {
      return (selectedUserRecord.dailyMailEmail || selectedUserRecord.email).trim();
    }
    return customRecipientEmail.trim();
  }, [selectedUserRecord, customRecipientEmail]);

  const effectiveRecipientName = useMemo(() => {
    if (selectedUserRecord) return selectedUserRecord.name;
    return customRecipientName.trim() || profile?.name || 'Stakeholder';
  }, [selectedUserRecord, customRecipientName, profile?.name]);

  const emailSubject = useMemo(
    () => buildDailyReportSubject(previewReport, APP_NAME),
    [previewReport]
  );

  const emailHtml = useMemo(
    () =>
      buildDailyReportEmailHtml(previewReport, {
        recipientName: effectiveRecipientName,
        scheduledTime: selectedUserRecord?.dailyMailTime || undefined,
        organizationLabel: selectedUserRecord?.organization || profile?.organization,
      }),
    [
      previewReport,
      effectiveRecipientName,
      selectedUserRecord?.dailyMailTime,
      selectedUserRecord?.organization,
      profile?.organization,
    ]
  );

  const handleExportReportCSV = () => {
    const lines: string[] = [
      ['Executive Summary Report', report.periodLabel, `${report.startDate} to ${report.endDate}`].join(','),
      ['Total Spend (BDT)', report.totalCost.toFixed(2)].join(','),
      ['Daily Average (BDT)', report.dailyAvg.toFixed(2)].join(','),
      ['Asset Operating Hours', report.totalAssetHours.toFixed(1)].join(','),
      ['Data Quality Score (%)', report.validation.healthScorePct.toFixed(1)].join(','),
      '',
      ['Factory', 'Total Cost (BDT)', 'Share (%)', 'Active Days', 'Run Hours', 'Cost/Hr (BDT)', 'Steam (kg)', 'Generator (kWh)', 'Solar (kWh)', 'Audit Flags'].join(','),
      ...report.factoryRows.map((f) =>
        [
          `"${f.company.replace(/"/g, '""')}"`,
          f.totalCost.toFixed(2),
          f.sharePct.toFixed(1),
          f.activeDays,
          f.totalHours.toFixed(1),
          f.costPerHour !== null ? f.costPerHour.toFixed(2) : '',
          f.steamKg.toFixed(1),
          f.genKwh.toFixed(1),
          f.solarKwh.toFixed(1),
          f.flagCount,
        ].join(',')
      ),
      '',
      ['Utility', 'Consumption', 'Unit', 'Total Cost (BDT)', 'Share (%)', 'Avg Unit Cost (BDT)', 'Run Hours', 'Hourly Rate'].join(','),
      ...report.utilityRows.map((u) =>
        [
          `"${u.name.replace(/"/g, '""')}"`,
          u.consumption.toFixed(2),
          `"${u.unit}"`,
          u.cost.toFixed(2),
          u.sharePct.toFixed(1),
          u.avgUnitCost !== null ? u.avgUnitCost.toFixed(2) : '',
          u.hours.toFixed(1),
          u.avgHourlyRate !== null ? u.avgHourlyRate.toFixed(2) : '',
        ].join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `UtilityHub_Executive_Report_${report.startDate}_to_${report.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenSingleSendConfirm = () => {
    setToast(null);
    if (!isValidEmailAddress(effectiveRecipientEmail)) {
      setToast({
        type: 'error',
        text: 'Please select a valid user or enter a valid recipient email address.',
      });
      return;
    }

    const target: DispatchTarget = selectedUserRecord
      ? {
          uid: selectedUserRecord.uid,
          name: selectedUserRecord.name,
          email: effectiveRecipientEmail,
          scheduledTime: selectedUserRecord.dailyMailTime,
          organization: selectedUserRecord.organization,
          companies:
            selectedUserRecord.role === 'admin'
              ? companies.map((c) => c.name)
              : selectedUserRecord.viewCompanies,
          allowedUtilities:
            selectedUserRecord.role === 'admin'
              ? []
              : selectedUserRecord.allowedUtilities || [],
        }
      : {
          name: effectiveRecipientName,
          email: effectiveRecipientEmail,
          organization: profile?.organization,
          companies: scopeCompanies,
          allowedUtilities: userAllowedUtilityIds || [],
        };

    setConfirmDispatch({
      mode: 'single',
      targets: [target],
    });
  };

  const handleOpenBatchSendConfirm = () => {
    setToast(null);
    const list = dueDailyMailUsers.length > 0 ? dueDailyMailUsers : enabledDailyMailUsers;
    if (list.length === 0) {
      setToast({
        type: 'error',
        text: 'No users have Daily Push Mail enabled yet. Enable schedules in User Management first.',
      });
      return;
    }

    const targets: DispatchTarget[] = list.map((u) => ({
      uid: u.uid,
      name: u.name,
      email: (u.dailyMailEmail || u.email).trim(),
      scheduledTime: u.dailyMailTime || '08:30',
      organization: u.organization,
      companies:
        u.role === 'admin'
          ? companies.map((c) => c.name)
          : u.viewCompanies.filter((c) => visibleCompanies.includes(c)),
      allowedUtilities: u.role === 'admin' ? [] : u.allowedUtilities || [],
    }));

    setConfirmDispatch({
      mode: 'batch',
      targets,
    });
  };

  const handleConfirmSendNow = async () => {
    if (!confirmDispatch || !isAdmin) return;
    setSendingMail(true);
    setToast(null);

    try {
      let activeToken = googleAccessToken;
      if (transport === 'gmail' && !activeToken) {
        activeToken = await connectGoogleSheets();
      }
      if (transport === 'appsScript' && !hasAppsScriptWebhook) {
        throw new Error(
          'Google Apps Script Web App URL is not configured. Connect Apps Script in Admin → Google Sheets or switch transport to Gmail OAuth.'
        );
      }

      const allCompNames = companies.map((c) => c.name);
      let sentCount = 0;

      for (const target of confirmDispatch.targets) {
        const targetScope =
          target.companies.length > 0
            ? target.companies.filter((c) => allCompNames.includes(c))
            : allCompNames;

        const targetReport =
          confirmDispatch.mode === 'single' && !target.uid
            ? previewReport
            : buildExecutiveSummaryReport({
                entries,
                generationEntries,
                companies,
                utilities,
                startDate: dateBounds.startDate,
                endDate: dateBounds.endDate,
                periodLabel: dateBounds.periodLabel,
                comparisonStart: dateBounds.comparisonStart,
                comparisonEnd: dateBounds.comparisonEnd,
                comparisonLabel: dateBounds.comparisonLabel,
                scopeCompanies: targetScope.length > 0 ? targetScope : allCompNames,
                allowedUtilityIds:
                  target.allowedUtilities.length > 0
                    ? target.allowedUtilities
                    : undefined,
                todayISO,
              });

        const subject = buildDailyReportSubject(targetReport, APP_NAME);
        const textBody = buildDailyReportPlainText(targetReport, {
          recipientName: target.name,
        });
        const htmlBody = buildDailyReportEmailHtml(targetReport, {
          recipientName: target.name,
          scheduledTime: target.scheduledTime,
          organizationLabel: target.organization,
        });

        if (transport === 'gmail') {
          await sendReportViaGmail({
            accessToken: activeToken!,
            to: target.email,
            subject,
            htmlBody,
            textBody,
          });
        } else {
          await sendReportViaAppsScript({
            webhookUrl: sheetsConfig!.webhookUrl!,
            to: target.email,
            subject,
            htmlBody,
            textBody,
          });
        }

        sentCount += 1;
        if (target.uid) {
          const matchedUser = allUsers.find((u) => u.uid === target.uid);
          if (matchedUser) {
            await adminUpdateUser(matchedUser, {
              lastDailyMailSentDate: todayISO,
            }).catch(() => undefined);
          }
        }
      }

      setConfirmDispatch(null);
      setToast({
        type: 'success',
        text:
          sentCount === 1
            ? `Report email dispatched successfully to ${confirmDispatch.targets[0].email}.`
            : `Dispatched ${formatNumber(sentCount, 0)} scheduled daily report emails.`,
      });
    } catch (err) {
      if (err instanceof GmailAuthError) {
        clearGoogleToken();
      }
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to send report email.',
      });
    } finally {
      setSendingMail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Report Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 print:hidden">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Period & Scope Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'today', label: 'Today' },
                  { id: '7d', label: 'Last 7 Days' },
                  { id: 'thisMonth', label: 'This Month' },
                  { id: 'custom', label: 'Custom' },
                ] as { id: ReportPreset; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreset(item.id)}
                  className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    preset === item.id
                      ? 'text-slate-900'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset === item.id && (
                    <motion.span
                      layoutId="reportsPeriodPill"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                      className="absolute inset-0 bg-white rounded-md shadow-sm"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </button>
              ))}
            </div>

            {visibleCompanies.length > 1 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                <Building2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  aria-label="Filter report factory scope"
                  className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                >
                  <option value="ALL">
                    All Factories ({visibleCompanies.length})
                  </option>
                  {visibleCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Mode Tabs & Export Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('summary')}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer ${
                  activeTab === 'summary' ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeTab === 'summary' && (
                  <motion.span
                    layoutId="reportsModeTab"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    aria-hidden="true"
                  />
                )}
                <FileText className="w-3.5 h-3.5 relative z-10 text-teal-700" />
                <span className="relative z-10">Executive Summary</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('email')}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer ${
                  activeTab === 'email' ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeTab === 'email' && (
                  <motion.span
                    layoutId="reportsModeTab"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    aria-hidden="true"
                  />
                )}
                <Eye className="w-3.5 h-3.5 relative z-10 text-teal-700" />
                <span className="relative z-10">Email Preview &amp; Push</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportReportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / PDF
            </button>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="rep-start" className="text-xs font-medium text-slate-600">
                From:
              </label>
              <input
                id="rep-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="rep-end" className="text-xs font-medium text-slate-600">
                To:
              </label>
              <input
                id="rep-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
        )}

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              className={`p-3 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
                toast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-current opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mode 1: Executive Summary Document */}
      <AnimatePresence mode="wait" initial={false}>
        {activeTab === 'summary' ? (
          <motion.div
            key="summary-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            id="executive-report-print"
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            {/* Dark Executive Masthead */}
            <div className="bg-slate-900 text-white px-6 py-6 sm:px-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-teal-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  {APP_NAME} · Auto-Generated Operations Brief
                </div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                  Executive Utility &amp; Plant Energy Report
                </h2>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-400" />
                    {report.periodLabel} ({report.startDate} – {report.endDate})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {report.scopeCompanies.length === 1
                      ? report.scopeCompanies[0]
                      : `${report.scopeCompanies.length} Factories in Scope`}
                  </span>
                  {report.comparisonLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Baseline: {report.comparisonLabel}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-left md:text-right text-xs text-slate-300 space-y-1 tabular-nums">
                <div>
                  Validated Records:{' '}
                  <strong className="text-white">{formatNumber(report.recordCount, 0)}</strong>
                </div>
                <div>
                  Data Quality Score:{' '}
                  <strong className="text-emerald-300">
                    {formatNumber(report.validation.healthScorePct, 0)}%
                  </strong>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8 space-y-7">
              {/* 4-Card KPI Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="text-xs font-medium text-slate-500">Total Utility Spend</div>
                  <div className="text-2xl font-bold text-slate-900 tabular-nums">
                    {formatCurrency(report.totalCost)}
                  </div>
                  <div className="text-xs tabular-nums">
                    {report.costDeltaPct !== null ? (
                      <span
                        className={`font-semibold ${
                          report.costDeltaPct > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {report.costDeltaPct >= 0 ? '+' : ''}
                        {formatPercent(report.costDeltaPct)} vs baseline
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {formatNumber(report.activeCompaniesCount, 0)}/
                        {formatNumber(report.scopeCompanies.length, 0)} factories logged
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="text-xs font-medium text-slate-500">Daily Spend Average</div>
                  <div className="text-2xl font-bold text-slate-900 tabular-nums">
                    {formatCurrency(report.dailyAvg)}
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {report.peakDay
                      ? `Peak: ${formatDate(report.peakDay.date)} (${formatCompactCurrency(report.peakDay.cost)})`
                      : `${formatNumber(report.activeDaysCount, 0)} active day(s)`}
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="text-xs font-medium text-slate-500">Logged Asset Runtime</div>
                  <div className="text-2xl font-bold text-slate-900 tabular-nums">
                    {formatNumber(report.totalAssetHours, 1)}{' '}
                    <span className="text-sm font-medium text-slate-500">hrs</span>
                  </div>
                  <div className="text-xs text-teal-800 font-semibold tabular-nums">
                    {report.blendedCostPerHour !== null
                      ? `Burn Rate: ৳ ${formatNumber(report.blendedCostPerHour, 0)}/hr`
                      : 'Enter Run Hrs for burn rate'}
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-1">
                  <div className="text-xs font-medium text-emerald-900">
                    Validation &amp; Coverage
                  </div>
                  <div className="text-2xl font-bold text-emerald-950 tabular-nums">
                    {formatNumber(report.validation.healthScorePct, 0)}%
                  </div>
                  <div className="text-xs text-emerald-800 tabular-nums">
                    {formatPercent(report.validation.coveragePct)} coverage ·{' '}
                    {formatNumber(report.validation.issues.length, 0)} flag
                    {report.validation.issues.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>

              {/* Automated Analyst Highlights */}
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  Executive Insights &amp; Anomaly Summary
                </div>
                <ul className="space-y-1.5 text-sm text-slate-700 list-disc list-inside">
                  {report.highlights.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual Factory Spend & Burn Overview Chart */}
              {report.factoryRows.some((f) => f.totalCost > 0) && (
                <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Factory Spend Distribution (BDT)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Ranked spend with logged operating hours &amp; hourly burn rate per factory
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-teal-800 tabular-nums">
                      Total: {formatCompactCurrency(report.totalCost)}
                    </span>
                  </div>

                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={report.factoryRows.filter((f) => f.totalCost > 0)}
                        layout="vertical"
                        margin={{ top: 4, right: 20, left: 6, bottom: 4 }}
                        barCategoryGap="24%"
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#E2E8F0"
                          horizontal={false}
                        />
                        <XAxis
                          type="number"
                          tickFormatter={(v) => formatCompactCurrency(Number(v))}
                          tick={{ fontSize: 11, fill: '#64748B' }}
                          axisLine={{ stroke: '#E2E8F0' }}
                          tickLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="company"
                          width={134}
                          tick={{ fontSize: 11, fill: '#0F172A', fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(val: string) =>
                            val.length > 18 ? `${val.slice(0, 17)}…` : val
                          }
                        />
                        <Tooltip
                          cursor={{ fill: '#F8FAFC' }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0].payload as (typeof report.factoryRows)[number];
                            return (
                              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-sm space-y-1">
                                <div className="font-bold text-slate-900">{row.company}</div>
                                <div className="text-slate-700 tabular-nums">
                                  Spend: <strong>{formatCurrency(row.totalCost)}</strong> (
                                  {formatPercent(row.sharePct)})
                                </div>
                                {row.totalHours > 0 && (
                                  <div className="text-teal-800 tabular-nums">
                                    Runtime: {formatNumber(row.totalHours, 1)} hrs
                                    {row.costPerHour !== null
                                      ? ` · Burn: ৳ ${formatNumber(row.costPerHour, 0)}/hr`
                                      : ''}
                                  </div>
                                )}
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="totalCost"
                          radius={[0, 6, 6, 0]}
                          maxBarSize={28}
                          minPointSize={3}
                          animationDuration={450}
                        >
                          {report.factoryRows
                            .filter((f) => f.totalCost > 0)
                            .map((entry, idx) => (
                              <Cell
                                key={entry.company}
                                fill={idx === 0 ? '#0F766E' : '#14B8A6'}
                              />
                            ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Factory Ranking & Efficiency Table */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    Factory-Wise Spend &amp; Efficiency Ranking
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {formatNumber(report.factoryRows.length, 0)} factories
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Factory</th>
                        <th className="py-3 px-4 text-right">Total Spend</th>
                        <th className="py-3 px-4 text-right">Share</th>
                        <th className="py-3 px-4 text-right">Run Hrs</th>
                        <th className="py-3 px-4 text-right">Burn / Hr</th>
                        <th className="py-3 px-4 text-right">Steam / Gen / Solar</th>
                        <th className="py-3 px-4 text-center">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                      {report.factoryRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No factory records in selected period.
                          </td>
                        </tr>
                      ) : (
                        report.factoryRows.map((row) => (
                          <tr key={row.company} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                              {row.company}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatCurrency(row.totalCost)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-600 tabular-nums whitespace-nowrap">
                              <div className="inline-flex flex-col items-end gap-1 min-w-[68px]">
                                <span>{formatPercent(row.sharePct)}</span>
                                <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <motion.div
                                    initial={{ scaleX: 0 }}
                                    animate={{ scaleX: Math.min(1, Math.max(0, row.sharePct / 100)) }}
                                    transition={{ duration: 0.35, ease: EASE_OUT }}
                                    style={{ originX: 0 }}
                                    className="h-full w-full bg-teal-600 rounded-full"
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                              {row.totalHours > 0 ? `${formatNumber(row.totalHours, 1)}h` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-teal-800 tabular-nums whitespace-nowrap">
                              {row.costPerHour !== null
                                ? `৳ ${formatNumber(row.costPerHour, 0)}/h`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-right text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              {row.steamKg > 0 || row.genKwh > 0 || row.solarKwh > 0
                                ? `${formatNumber(row.steamKg, 0)}kg · ${formatNumber(row.genKwh, 0)}kWh · ${formatNumber(row.solarKwh, 0)}kWh☀`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {row.flagCount > 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {row.flagCount}
                                </span>
                              ) : row.totalCost > 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  OK
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">No log</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Utility Breakdown Table */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-900">
                  Utility Consumption &amp; Unit Cost Summary
                </h3>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Utility</th>
                        <th className="py-3 px-4 text-right">Consumption</th>
                        <th className="py-3 px-4 text-right">Avg Unit Rate</th>
                        <th className="py-3 px-4 text-right">Run Hrs</th>
                        <th className="py-3 px-4 text-right">Hourly Rate</th>
                        <th className="py-3 px-4 text-right">Total Spend</th>
                        <th className="py-3 px-4 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                      {report.utilityRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No utility readings recorded in this window.
                          </td>
                        </tr>
                      ) : (
                        report.utilityRows.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2 font-semibold text-slate-900">
                                <span
                                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                                  style={{ backgroundColor: u.color }}
                                />
                                <span>{u.name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                              {u.unit ? `${formatNumber(u.consumption)} ${u.unit}` : 'Plant Fuel'}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-teal-800 tabular-nums whitespace-nowrap">
                              {u.avgUnitCost !== null && u.unit
                                ? `৳ ${formatNumber(u.avgUnitCost, 2)}/${u.unit}`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                              {u.hours > 0 ? `${formatNumber(u.hours, 1)}h` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                              {u.avgHourlyRate !== null && u.unit
                                ? `${formatNumber(u.avgHourlyRate, 1)} ${u.unit}/h`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatCurrency(u.cost)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-600 tabular-nums whitespace-nowrap">
                              <div className="inline-flex flex-col items-end gap-1 min-w-[68px]">
                                <span>{formatPercent(u.sharePct)}</span>
                                <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <motion.div
                                    initial={{ scaleX: 0 }}
                                    animate={{ scaleX: Math.min(1, Math.max(0, u.sharePct / 100)) }}
                                    transition={{ duration: 0.35, ease: EASE_OUT }}
                                    style={{
                                      originX: 0,
                                      backgroundColor: u.color || '#0F766E',
                                    }}
                                    className="h-full w-full rounded-full"
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Captive Plant & Solar Performance */}
              {report.generation.hasRecords && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700">
                      <Flame className="w-3.5 h-3.5" />
                      Boiler Steam Output
                    </div>
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {formatNumber(report.generation.totalSteamKg, 0)} kg
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      {report.generation.steamCostPerKg !== null
                        ? `৳ ${formatNumber(report.generation.steamCostPerKg, 2)}/kg`
                        : 'No fuel cost'}{' '}
                      ·{' '}
                      {report.generation.steamPerHour !== null
                        ? `${formatNumber(report.generation.steamPerHour, 0)} kg/hr`
                        : 'Log boiler hrs'}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                      <Zap className="w-3.5 h-3.5" />
                      Captive Generator Output
                    </div>
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {formatNumber(report.generation.totalGenKwh, 0)} kWh
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      {report.generation.genCostPerKwh !== null
                        ? `৳ ${formatNumber(report.generation.genCostPerKwh, 2)}/kWh`
                        : 'No fuel cost'}{' '}
                      ·{' '}
                      {report.generation.avgGenKw !== null
                        ? `${formatNumber(report.generation.avgGenKw, 0)} kW avg`
                        : 'Log gen hrs'}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-1">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                      <Sun className="w-3.5 h-3.5" />
                      Clean Solar Generation &amp; Savings
                    </div>
                    <div className="text-lg font-bold text-emerald-950 tabular-nums">
                      {formatCurrency(report.generation.totalSolarSavings)}
                    </div>
                    <div className="text-xs text-emerald-800 tabular-nums">
                      {formatNumber(report.generation.totalSolarKwh, 0)} kWh (
                      {formatPercent(report.generation.solarSharePct)} total power)
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          /* Mode 2: Live Email Preview & Admin Dispatch */
          <motion.div
            key="email-view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            {/* Left Controls Panel */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Email Preview &amp; Daily Push
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Inspect the exact responsive HTML brief before dispatching to stakeholders.
                    </p>
                  </div>
                  {isAdmin && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('admin')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      Manage Schedules
                    </button>
                  )}
                </div>

                {isAdmin ? (
                  <>
                    <div>
                      <label
                        htmlFor="preview-recipient-select"
                        className="block text-xs font-medium text-slate-600 mb-1"
                      >
                        Select User Schedule / Recipient
                      </label>
                      <select
                        id="preview-recipient-select"
                        value={selectedRecipientUid}
                        onChange={(e) => setSelectedRecipientUid(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="__custom__">Custom Recipient / Group Brief</option>
                        {approvedUsers.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.name} ({u.dailyMailEnabled ? `Auto ${u.dailyMailTime || '08:30'}` : 'Manual'}) ·{' '}
                            {u.dailyMailEmail || u.email}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedRecipientUid === '__custom__' && (
                      <div className="space-y-3 pt-1">
                        <div>
                          <label
                            htmlFor="custom-mail-name"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Recipient Greeting Name
                          </label>
                          <input
                            id="custom-mail-name"
                            type="text"
                            value={customRecipientName}
                            onChange={(e) => setCustomRecipientName(e.target.value)}
                            maxLength={80}
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="custom-mail-to"
                            className="block text-xs font-medium text-slate-600 mb-1"
                          >
                            Recipient Email Address
                          </label>
                          <input
                            id="custom-mail-to"
                            type="email"
                            value={customRecipientEmail}
                            onChange={(e) => setCustomRecipientEmail(e.target.value)}
                            placeholder="director@company.com"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="text-xs font-medium text-slate-600">Delivery Channel</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTransport('gmail')}
                          className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                            transport === 'gmail'
                              ? 'bg-teal-50 border-teal-300 text-teal-900'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Gmail OAuth
                        </button>
                        <button
                          type="button"
                          disabled={!hasAppsScriptWebhook}
                          onClick={() => setTransport('appsScript')}
                          className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            transport === 'appsScript'
                              ? 'bg-teal-50 border-teal-300 text-teal-900'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Apps Script
                        </button>
                      </div>
                      {transport === 'gmail' && !googleAccessToken && (
                        <button
                          type="button"
                          onClick={() => void connectGoogleSheets()}
                          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Authorize Google Gmail &amp; Sheets
                        </button>
                      )}
                    </div>

                    <div className="pt-2 space-y-2.5">
                      <button
                        type="button"
                        onClick={handleOpenSingleSendConfirm}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send Previewed Mail Now
                      </button>

                      {enabledDailyMailUsers.length > 0 && (
                        <button
                          type="button"
                          onClick={handleOpenBatchSendConfirm}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-teal-700" />
                          {dueDailyMailUsers.length > 0
                            ? `Push Due Daily Briefs (${dueDailyMailUsers.length})`
                            : `Push All Enabled Briefs (${enabledDailyMailUsers.length})`}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                    <div className="font-semibold text-slate-800">
                      Your Scheduled Brief Status
                    </div>
                    <div>
                      Daily Mail:{' '}
                      <strong className="text-slate-900">
                        {profile?.dailyMailEnabled
                          ? `Active at ${profile.dailyMailTime || '08:30'}`
                          : 'Managed by Admin'}
                      </strong>
                    </div>
                    <div>
                      Target Email:{' '}
                      <strong className="text-slate-900">
                        {profile?.dailyMailEmail || profile?.email}
                      </strong>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                  <div className="text-slate-500">Email Subject Preview</div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 font-medium text-slate-900 break-words">
                    {emailSubject}
                  </div>
                  {selectedUserRecord?.dailyMailEnabled && (
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span>Scheduled Time: {selectedUserRecord.dailyMailTime || '08:30'}</span>
                      <span>
                        Last Sent: {selectedUserRecord.lastDailyMailSentDate || 'Never'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && enabledDailyMailUsers.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-900">
                      Active Daily Push Recipients
                    </div>
                    <span className="text-xs font-semibold text-teal-700 tabular-nums">
                      {enabledDailyMailUsers.length} active
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {enabledDailyMailUsers.map((u) => (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => setSelectedRecipientUid(u.uid)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                          selectedRecipientUid === u.uid
                            ? 'bg-teal-50 border-teal-300'
                            : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 truncate">{u.name}</span>
                          <span className="inline-flex items-center gap-1.5 font-mono-num text-[11px] font-bold text-teal-800 shrink-0">
                            {u.lastDailyMailSentDate === todayISO && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            {u.dailyMailTime || '08:30'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {u.dailyMailEmail || u.email}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Live Email HTML Iframe Preview */}
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <Mail className="w-4 h-4 text-teal-700" />
                  <span>Live Email Client Preview</span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-slate-600 font-normal">
                    To: {effectiveRecipientEmail || 'Preview'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('desktop')}
                      aria-label="Desktop email preview"
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                        previewViewport === 'desktop'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Monitor className="w-3 h-3" />
                      Desktop
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewViewport('mobile')}
                      aria-label="Mobile email preview"
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded cursor-pointer ${
                        previewViewport === 'mobile'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Smartphone className="w-3 h-3" />
                      Mobile
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums hidden sm:inline">
                    {previewReport.scopeCompanies.length}{' '}
                    {previewReport.scopeCompanies.length === 1 ? 'Factory' : 'Factories'} ·{' '}
                    {formatCurrency(previewReport.totalCost)}
                  </span>
                </div>
              </div>

              <div className="p-3 sm:p-4 bg-slate-100 flex-1 flex justify-center overflow-x-auto">
                <iframe
                  srcDoc={emailHtml}
                  title="Daily Utility Report Email Preview"
                  className={`h-[640px] rounded-lg border border-slate-200 bg-white transition-all duration-200 ${
                    previewViewport === 'mobile' ? 'w-[375px]' : 'w-full'
                  }`}
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Explicit Confirmation Modal Before Email Dispatch */}
      <AnimatePresence>
        {confirmDispatch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-base">
                  <Send className="w-4 h-4 text-teal-700" />
                  Confirm Email Dispatch
                </div>
                <button
                  type="button"
                  disabled={sendingMail}
                  onClick={() => setConfirmDispatch(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs text-slate-700">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div>
                    <span className="text-slate-500">Period:</span>{' '}
                    <strong className="text-slate-900">
                      {dateBounds.periodLabel} ({dateBounds.startDate} – {dateBounds.endDate})
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Transport:</span>{' '}
                    <strong className="text-teal-800">
                      {transport === 'gmail' ? 'Google Gmail API (OAuth)' : 'Apps Script MailApp'}
                    </strong>
                  </div>
                  {confirmDispatch.mode === 'single' && (
                    <div>
                      <span className="text-slate-500">Subject:</span>{' '}
                      <strong className="text-slate-900">{emailSubject}</strong>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-900">
                    Recipients ({confirmDispatch.targets.length}):
                  </div>
                  <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {confirmDispatch.targets.map((t, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          <div className="text-[11px] text-slate-500">{t.email}</div>
                        </div>
                        <div className="text-[11px] text-slate-500 text-right">
                          {t.companies.length} {t.companies.length === 1 ? 'factory' : 'factories'}
                          {t.scheduledTime ? ` · ${t.scheduledTime}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={sendingMail}
                  onClick={() => setConfirmDispatch(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={sendingMail}
                  onClick={() => void handleConfirmSendNow()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 hidden" />
                  <Send className="w-3.5 h-3.5" />
                  {sendingMail ? 'Sending...' : 'Confirm & Send Email'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
