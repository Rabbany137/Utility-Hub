import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Flame,
  Gauge,
  GitCompareArrows,
  PlusCircle,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';
import type {
  ActivePage,
  BoilerUnitReading,
  CompanyItem,
  DeviceFuelMode,
  GenerationEntry,
  GenerationUnitReadings,
  GeneratorUnitReading,
  GridProviderReading,
  GridTariffPeriod,
  SingleDeviceFuelMode,
  SolarUnitReading,
  UtilityEntry,
  UtilityItem,
} from '../types';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatMonthLabel,
  formatNumber,
  formatPercent,
  formatShortDate,
  getDaysAgoISO,
  getMonthEndISO,
  getMonthStartISO,
  getTodayISO,
} from '../utils/formatters';
import {
  extractPlantFuelAllocations,
  getBoilerReadingTotalCost,
  getFuelLabel,
  getGenReadingTotalCost,
  isGasLikeFuelMode,
  unitToFuelMode,
} from '../utils/equipment';
import {
  buildAnalyticsValidationSummary,
  type ValidationCategory,
} from '../utils/analyticsValidation';
import { GoogleSheetsSyncModal } from './GoogleSheetsSyncModal';

type DatePreset =
  | 'thisMonth'
  | '7d'
  | '30d'
  | '1y'
  | 'lastMonth'
  | 'all'
  | 'custom';

type DashboardViewTab = 'overview' | 'hourly' | 'generation' | 'audit';
type AuditLedgerFilter = 'all' | 'exceptions' | 'rate_outlier' | 'missing_hours' | 'zero_cost';
type CompareMode = 'auto' | 'day' | 'month' | 'year' | 'range';
type TrendGranularity = 'daily' | 'monthly';
type FactoryChartLayout = 'horizontal' | 'vertical';
type BenchmarkSortKey =
  | 'company'
  | 'activeDays'
  | 'totalHours'
  | 'totalCost'
  | 'sharePct'
  | 'dailyAvg'
  | 'deltaPct';

interface DashboardPageProps {
  onNavigate?: (page: ActivePage) => void;
}

interface PeriodBounds {
  start: string;
  end: string;
  label: string;
}

interface AnimatedMetricProps {
  value: number;
  formatter: (val: number) => string;
}

function AnimatedMetric({ value, formatter }: AnimatedMetricProps) {
  const shouldReduceMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    if (shouldReduceMotion) {
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }
    const from = prevValueRef.current;
    prevValueRef.current = value;
    if (Math.abs(from - value) < 0.01) {
      setDisplayValue(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplayValue(latest),
    });
    return () => controls.stop();
  }, [value, shouldReduceMotion]);

  return <>{formatter(displayValue)}</>;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function getMonthDaysCount(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function summarizePeriod(
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  visibleCompanies: string[],
  generationList: GenerationEntry[] = [],
  selectedUtilityId = 'ALL',
  companyMap: Map<string, CompanyItem> = new Map(),
  allowedUtilitySet: Set<string> | null = null,
  allUtilities: UtilityItem[] = utilities
) {
  let totalCost = 0;
  let fuelRecordCount = 0;
  const activeDates = new Set<string>();
  const activeCompanies = new Set<string>();
  const byDateCost = new Map<string, number>();
  const byCompany = new Map<
    string,
    { cost: number; consumption: number; dates: Set<string>; count: number }
  >();
  const byUtility = new Map<
    string,
    { cost: number; consumption: number; count: number }
  >();

  for (const name of visibleCompanies) {
    byCompany.set(name, { cost: 0, consumption: 0, dates: new Set(), count: 0 });
  }
  for (const u of utilities) {
    byUtility.set(u.id, { cost: 0, consumption: 0, count: 0 });
  }

  for (const item of entries) {
    totalCost += item.cost;
    activeDates.add(item.date);
    activeCompanies.add(item.company);
    byDateCost.set(item.date, (byDateCost.get(item.date) || 0) + item.cost);

    const comp = byCompany.get(item.company) || {
      cost: 0,
      consumption: 0,
      dates: new Set<string>(),
      count: 0,
    };
    comp.cost += item.cost;
    comp.consumption += item.consumption;
    comp.dates.add(item.date);
    comp.count += 1;
    byCompany.set(item.company, comp);

    const util = byUtility.get(item.utilityId) || {
      cost: 0,
      consumption: 0,
      count: 0,
    };
    util.cost += item.cost;
    util.consumption += item.consumption;
    util.count += 1;
    byUtility.set(item.utilityId, util);
  }

  for (const gen of generationList) {
    const allocs = extractPlantFuelAllocations(
      gen,
      allUtilities,
      companyMap.get(gen.company)
    ).filter(
      (a) =>
        (!allowedUtilitySet || allowedUtilitySet.has(a.id)) &&
        (selectedUtilityId === 'ALL' || a.id === selectedUtilityId)
    );
    if (allocs.length === 0) continue;

    let dayCost = 0;
    let dayCons = 0;
    for (const a of allocs) {
      dayCost += a.cost;
      dayCons += a.consumption;
      const uStat = byUtility.get(a.id) || { cost: 0, consumption: 0, count: 0 };
      uStat.cost += a.cost;
      uStat.consumption += a.consumption;
      uStat.count += 1;
      byUtility.set(a.id, uStat);
    }

    totalCost += dayCost;
    fuelRecordCount += 1;
    activeDates.add(gen.date);
    activeCompanies.add(gen.company);
    byDateCost.set(gen.date, (byDateCost.get(gen.date) || 0) + dayCost);

    const comp = byCompany.get(gen.company) || {
      cost: 0,
      consumption: 0,
      dates: new Set<string>(),
      count: 0,
    };
    comp.cost += dayCost;
    comp.consumption += dayCons;
    comp.dates.add(gen.date);
    comp.count += 1;
    byCompany.set(gen.company, comp);
  }

  let peakDay: { date: string; cost: number } | null = null;
  for (const [date, cost] of byDateCost.entries()) {
    if (!peakDay || cost > peakDay.cost) {
      peakDay = { date, cost };
    }
  }

  const activeDaysCount = activeDates.size;
  const dailyAvg = activeDaysCount > 0 ? totalCost / activeDaysCount : 0;

  return {
    totalCost,
    activeDaysCount,
    activeCompaniesCount: activeCompanies.size,
    dailyAvg,
    recordCount: entries.length + fuelRecordCount,
    peakDay,
    byCompany,
    byUtility,
  };
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const {
    profile,
    companies,
    utilities,
    entries,
    generationEntries,
    dataLoading,
    sheetsConfig,
    googleAccessToken,
    connectGoogleSheets,
    syncEntriesToConnectedSheet,
  } = useApp();

  const todayISO = getTodayISO();
  const currentMonthKey = todayISO.slice(0, 7);
  const currentYear = Number(todayISO.slice(0, 4)) || new Date().getFullYear();

  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');
  const [selectedUtilityId, setSelectedUtilityId] = useState<string>('ALL');
  const [unitTrendUtilityId, setUnitTrendUtilityId] = useState<string>('');
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [customStart, setCustomStart] = useState<string>(getDaysAgoISO(29));
  const [customEnd, setCustomEnd] = useState<string>(todayISO);

  // Compare mode controls
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const [compareMode, setCompareMode] = useState<CompareMode>('auto');
  const [compareDay, setCompareDay] = useState<string>(getDaysAgoISO(1));
  const [compareMonth, setCompareMonth] = useState<string>(
    getMonthStartISO(-1).slice(0, 7)
  );
  const [compareYear, setCompareYear] = useState<string>(String(currentYear - 1));
  const [compareRangeStart, setCompareRangeStart] = useState<string>(
    getMonthStartISO(-1)
  );
  const [compareRangeEnd, setCompareRangeEnd] = useState<string>(
    getMonthEndISO(-1)
  );
  const [compareChartTab, setCompareChartTab] = useState<'factory' | 'utility'>(
    'factory'
  );
  const [compareMetric, setCompareMetric] = useState<'total' | 'dailyAvg'>('total');

  // Visualization controls
  const [trendGranularity, setTrendGranularity] =
    useState<TrendGranularity>('daily');
  const [factoryLayout, setFactoryLayout] =
    useState<FactoryChartLayout>('horizontal');
  const [factoryStackMode, setFactoryStackMode] = useState<'stacked' | 'total'>(
    'stacked'
  );
  const [benchmarkSortKey, setBenchmarkSortKey] =
    useState<BenchmarkSortKey>('totalCost');
  const [benchmarkSortDir, setBenchmarkSortDir] = useState<'asc' | 'desc'>('desc');
  const [benchmarkSearch, setBenchmarkSearch] = useState<string>('');

  const [dashboardView, setDashboardView] = useState<DashboardViewTab>('overview');
  const [auditFilter, setAuditFilter] = useState<AuditLedgerFilter>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [tableLimit, setTableLimit] = useState<number>(25);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [syncToast, setSyncToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const visibleCompanyNames = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'admin') {
      return companies
        .map((c) => c.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    const activeSet = new Set(companies.map((c) => c.name));
    return Array.from(
      new Set(
        (profile.viewCompanies || [])
          .map((c) => c.trim())
          .filter((name) => Boolean(name) && activeSet.has(name))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [profile, companies]);

  useEffect(() => {
    if (selectedCompany !== 'ALL' && !visibleCompanyNames.includes(selectedCompany)) {
      setSelectedCompany('ALL');
    }
  }, [visibleCompanyNames, selectedCompany]);

  // Adapt trend granularity & factory chart orientation automatically
  useEffect(() => {
    if (preset === '1y' || preset === 'all') {
      setTrendGranularity('monthly');
    } else {
      setTrendGranularity('daily');
    }
  }, [preset]);

  useEffect(() => {
    if (visibleCompanyNames.length > 5) {
      setFactoryLayout('horizontal');
    } else {
      setFactoryLayout('vertical');
    }
  }, [visibleCompanyNames.length]);

  useEffect(() => {
    if (
      compareOpen &&
      (preset === 'all' || preset === 'custom') &&
      compareMode === 'auto'
    ) {
      setCompareMode('month');
    }
  }, [compareOpen, preset, compareMode]);

  const canSyncSheets = Boolean(sheetsConfig) && profile?.role === 'admin';

  const handleOpenSyncSheets = async () => {
    if (profile?.role !== 'admin') return;
    setSyncToast(null);
    if (sheetsConfig?.syncMode === 'appsScript') {
      setSyncingSheets(true);
      try {
        const count = await syncEntriesToConnectedSheet(
          undefined,
          undefined,
          profile?.role === 'admin'
        );
        setSyncToast({
          type: 'success',
          text: `Synced ${formatNumber(count, 0)} entries into Executive_Summary, Factory × Year reports, and Master_Backup in "${sheetsConfig.spreadsheetTitle}".`,
        });
      } catch (err) {
        setSyncToast({
          type: 'error',
          text:
            err instanceof Error ? err.message : 'Failed to sync with Google Sheets.',
        });
      } finally {
        setSyncingSheets(false);
      }
      return;
    }

    if (!googleAccessToken) {
      try {
        await connectGoogleSheets();
      } catch (err) {
        setSyncToast({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Google authorization is required to sync.',
        });
        return;
      }
    }
    setSyncModalOpen(true);
  };

  const handleConfirmSyncSheets = async () => {
    setSyncingSheets(true);
    setSyncToast(null);
    try {
      const count = await syncEntriesToConnectedSheet(
        undefined,
        undefined,
        profile?.role === 'admin'
      );
      setSyncModalOpen(false);
      setSyncToast({
        type: 'success',
        text: `Synced ${formatNumber(count, 0)} entries into Executive_Summary, Factory × Year reports, and Master_Backup in "${sheetsConfig?.spreadsheetTitle}".`,
      });
    } catch (err) {
      setSyncModalOpen(false);
      setSyncToast({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to sync with Google Sheets.',
      });
    } finally {
      setSyncingSheets(false);
    }
  };

  const isCustomRangeInverted =
    preset === 'custom' &&
    Boolean(customStart && customEnd && customStart > customEnd);

  const dateBounds = useMemo<PeriodBounds>(() => {
    const today = getTodayISO();
    switch (preset) {
      case 'thisMonth': {
        const start = getMonthStartISO(0);
        return {
          start,
          end: getMonthEndISO(0),
          label: `${formatMonthLabel(currentMonthKey)} (Running Month)`,
        };
      }
      case '7d': {
        const start = getDaysAgoISO(6);
        return {
          start,
          end: today,
          label: `${formatShortDate(start)} – ${formatShortDate(today)}`,
        };
      }
      case '30d': {
        const start = getDaysAgoISO(29);
        return {
          start,
          end: today,
          label: `${formatShortDate(start)} – ${formatShortDate(today)}`,
        };
      }
      case '1y': {
        const start = getDaysAgoISO(364);
        return {
          start,
          end: today,
          label: `${formatDate(start)} – ${formatDate(today)}`,
        };
      }
      case 'lastMonth': {
        const start = getMonthStartISO(-1);
        return {
          start,
          end: getMonthEndISO(-1),
          label: formatMonthLabel(start.slice(0, 7)),
        };
      }
      case 'all':
        return {
          start: '0000-01-01',
          end: '9999-12-31',
          label: 'All Recorded History',
        };
      case 'custom': {
        const s = customStart || '0000-01-01';
        const e = customEnd || '9999-12-31';
        const norm = s > e ? { start: e, end: s } : { start: s, end: e };
        return {
          ...norm,
          label: `${formatDate(norm.start)} – ${formatDate(norm.end)}`,
        };
      }
    }
  }, [preset, customStart, customEnd, currentMonthKey]);

  const companyMap = useMemo(() => {
    const map = new Map<string, CompanyItem>();
    for (const c of companies) {
      if (c.name) map.set(c.name, c);
    }
    return map;
  }, [companies]);

  const userAllowedUtilitiesSet = useMemo(() => {
    if (!profile || profile.role === 'admin') return null;
    const list = profile.allowedUtilities || [];
    if (list.length === 0) return null;
    return new Set(list);
  }, [profile]);

  const visibleUtilities = useMemo(() => {
    if (!userAllowedUtilitiesSet) return utilities;
    return utilities.filter((u) => userAllowedUtilitiesSet.has(u.id));
  }, [utilities, userAllowedUtilitiesSet]);

  const utilityMap = useMemo(() => {
    const map = new Map<string, (typeof utilities)[number]>();
    for (const u of visibleUtilities) {
      map.set(u.id, u);
    }
    return map;
  }, [visibleUtilities]);

  const visibleEntries = useMemo(() => {
    const allowedSet = new Set(visibleCompanyNames);
    return entries.filter(
      (item) =>
        allowedSet.has(item.company) &&
        (!userAllowedUtilitiesSet || userAllowedUtilitiesSet.has(item.utilityId))
    );
  }, [entries, visibleCompanyNames, userAllowedUtilitiesSet]);

  const visibleGenerationEntries = useMemo(() => {
    const allowedSet = new Set(visibleCompanyNames);
    return generationEntries.filter((item) => allowedSet.has(item.company));
  }, [generationEntries, visibleCompanyNames]);

  const availableSyntheticFuels = useMemo(() => {
    const extras = new Map<
      string,
      { id: string; name: string; unit: string; color: string }
    >();
    for (const gen of visibleGenerationEntries) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      );
      for (const a of allocs) {
        if (userAllowedUtilitiesSet && !userAllowedUtilitiesSet.has(a.id)) {
          continue;
        }
        if (!a.isUtilityMatch && !extras.has(a.id)) {
          extras.set(a.id, {
            id: a.id,
            name: a.name,
            unit: a.unit,
            color: a.color,
          });
        }
      }
    }
    return Array.from(extras.values());
  }, [visibleGenerationEntries, utilities, companyMap, userAllowedUtilitiesSet]);

  const filterableUtilities = useMemo(() => {
    return [
      ...visibleUtilities.map((u) => ({
        id: u.id,
        name: u.name,
        unit: u.unit,
        color: u.color,
      })),
      ...availableSyntheticFuels,
    ];
  }, [visibleUtilities, availableSyntheticFuels]);

  useEffect(() => {
    if (
      selectedUtilityId !== 'ALL' &&
      !filterableUtilities.some((u) => u.id === selectedUtilityId)
    ) {
      setSelectedUtilityId('ALL');
    }
  }, [filterableUtilities, selectedUtilityId]);

  const filterableUtilityMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; unit: string; color: string }
    >();
    for (const u of filterableUtilities) {
      map.set(u.id, u);
    }
    return map;
  }, [filterableUtilities]);

  const availableYears = useMemo(() => {
    const yearSet = new Set<string>([String(currentYear), String(currentYear - 1)]);
    for (const e of visibleEntries) {
      const y = e.date.slice(0, 4);
      if (/^\d{4}$/.test(y)) yearSet.add(y);
    }
    return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  }, [visibleEntries, currentYear]);

  const filteredEntries = useMemo(() => {
    return visibleEntries.filter((item) => {
      if (item.date < dateBounds.start || item.date > dateBounds.end) return false;
      if (selectedCompany !== 'ALL' && item.company !== selectedCompany) return false;
      if (selectedUtilityId !== 'ALL' && item.utilityId !== selectedUtilityId)
        return false;
      return true;
    });
  }, [visibleEntries, dateBounds, selectedCompany, selectedUtilityId]);

  const autoPreviousBounds = useMemo<PeriodBounds | null>(() => {
    if (preset === 'all' || preset === 'custom') return null;

    if (preset === 'thisMonth') {
      const dayOfMonth = Number(todayISO.slice(8, 10)) || 1;
      const prevMonthStart = getMonthStartISO(-1);
      const prevMonthEnd = getMonthEndISO(-1);
      const prevMonthDays = Number(prevMonthEnd.slice(8, 10)) || 28;
      const clampedDay = Math.min(dayOfMonth, prevMonthDays);
      const end = `${prevMonthStart.slice(0, 7)}-${String(clampedDay).padStart(2, '0')}`;
      return {
        start: prevMonthStart,
        end,
        label: `${formatShortDate(prevMonthStart)} – ${formatShortDate(end)}`,
      };
    }

    if (preset === 'lastMonth') {
      const start = getMonthStartISO(-2);
      const end = getMonthEndISO(-2);
      return {
        start,
        end,
        label: formatMonthLabel(start.slice(0, 7)),
      };
    }

    const startDt = new Date(`${dateBounds.start}T00:00:00`);
    const endDt = new Date(`${dateBounds.end}T00:00:00`);
    const spanDays =
      Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const prevEnd = new Date(startDt);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (spanDays - 1));

    const toISO = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;

    const s = toISO(prevStart);
    const e = toISO(prevEnd);
    return {
      start: s,
      end: e,
      label: `${formatShortDate(s)} – ${formatShortDate(e)}`,
    };
  }, [preset, dateBounds, todayISO]);

  const isCompareRangeInverted =
    compareOpen &&
    compareMode === 'range' &&
    Boolean(compareRangeStart && compareRangeEnd && compareRangeStart > compareRangeEnd);

  const activeComparisonBounds = useMemo<PeriodBounds | null>(() => {
    if (!compareOpen) {
      return autoPreviousBounds;
    }

    switch (compareMode) {
      case 'auto':
        return autoPreviousBounds;
      case 'day': {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(compareDay)
          ? compareDay
          : getDaysAgoISO(1);
        return {
          start: d,
          end: d,
          label: formatDate(d),
        };
      }
      case 'month': {
        const m = /^\d{4}-\d{2}$/.test(compareMonth)
          ? compareMonth
          : getMonthStartISO(-1).slice(0, 7);
        const days = getMonthDaysCount(m);
        return {
          start: `${m}-01`,
          end: `${m}-${String(days).padStart(2, '0')}`,
          label: formatMonthLabel(m),
        };
      }
      case 'year': {
        const y = /^\d{4}$/.test(compareYear)
          ? compareYear
          : String(currentYear - 1);
        return {
          start: `${y}-01-01`,
          end: `${y}-12-31`,
          label: `Year ${y}`,
        };
      }
      case 'range': {
        const s = compareRangeStart || '0000-01-01';
        const e = compareRangeEnd || '9999-12-31';
        const norm = s > e ? { start: e, end: s } : { start: s, end: e };
        return {
          ...norm,
          label: `${formatDate(norm.start)} – ${formatDate(norm.end)}`,
        };
      }
    }
  }, [
    compareOpen,
    compareMode,
    compareDay,
    compareMonth,
    compareYear,
    compareRangeStart,
    compareRangeEnd,
    autoPreviousBounds,
    currentYear,
  ]);

  useEffect(() => {
    setTableLimit(25);
  }, [preset, customStart, customEnd, selectedCompany, selectedUtilityId, searchTerm]);

  const hasNonDefaultFilters =
    preset !== 'thisMonth' ||
    selectedCompany !== 'ALL' ||
    selectedUtilityId !== 'ALL' ||
    searchTerm.trim() !== '' ||
    compareOpen;

  const handleResetFilters = () => {
    setPreset('thisMonth');
    setSelectedCompany('ALL');
    setSelectedUtilityId('ALL');
    setSearchTerm('');
    setCompareOpen(false);
    setCompareMode('auto');
  };

  const comparisonEntries = useMemo(() => {
    if (!activeComparisonBounds) return [];
    return visibleEntries.filter((item) => {
      if (
        item.date < activeComparisonBounds.start ||
        item.date > activeComparisonBounds.end
      ) {
        return false;
      }
      if (selectedCompany !== 'ALL' && item.company !== selectedCompany) return false;
      if (selectedUtilityId !== 'ALL' && item.utilityId !== selectedUtilityId)
        return false;
      return true;
    });
  }, [
    visibleEntries,
    activeComparisonBounds,
    selectedCompany,
    selectedUtilityId,
  ]);

  const filteredGenerationEntries = useMemo(() => {
    return visibleGenerationEntries.filter((item) => {
      if (item.date < dateBounds.start || item.date > dateBounds.end) return false;
      if (selectedCompany !== 'ALL' && item.company !== selectedCompany) return false;
      return true;
    });
  }, [visibleGenerationEntries, dateBounds, selectedCompany]);

  const comparisonGenerationEntries = useMemo(() => {
    if (!activeComparisonBounds) return [];
    return visibleGenerationEntries.filter((item) => {
      if (
        item.date < activeComparisonBounds.start ||
        item.date > activeComparisonBounds.end
      ) {
        return false;
      }
      if (selectedCompany !== 'ALL' && item.company !== selectedCompany) return false;
      return true;
    });
  }, [visibleGenerationEntries, activeComparisonBounds, selectedCompany]);

  const comparisonStats = useMemo(() => {
    if (!activeComparisonBounds) return null;
    const companyList =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];
    const stats = summarizePeriod(
      comparisonEntries,
      visibleUtilities,
      companyList,
      comparisonGenerationEntries,
      selectedUtilityId,
      companyMap,
      userAllowedUtilitiesSet,
      utilities
    );
    return {
      bounds: activeComparisonBounds,
      ...stats,
    };
  }, [
    activeComparisonBounds,
    comparisonEntries,
    comparisonGenerationEntries,
    visibleUtilities,
    utilities,
    userAllowedUtilitiesSet,
    visibleCompanyNames,
    selectedCompany,
    selectedUtilityId,
    companyMap,
  ]);

  const kpis = useMemo(() => {
    let totalCost = 0;
    let totalUtilityHours = 0;
    let fuelRecordCount = 0;
    const activeDates = new Set<string>();
    const activeCompanies = new Set<string>();
    const byDateCost = new Map<string, number>();
    const byCompanyCost = new Map<string, number>();

    const byUtility = new Map<
      string,
      {
        id: string;
        name: string;
        unit: string;
        color: string;
        cost: number;
        consumption: number;
        hours: number;
        entryCount: number;
        minUnitCost: number | null;
        maxUnitCost: number | null;
        byCompany: Map<string, { cost: number; consumption: number; hours: number }>;
      }
    >();

    for (const u of visibleUtilities) {
      byUtility.set(u.id, {
        id: u.id,
        name: u.name,
        unit: u.unit,
        color: u.color,
        cost: 0,
        consumption: 0,
        hours: 0,
        entryCount: 0,
        minUnitCost: null,
        maxUnitCost: null,
        byCompany: new Map(),
      });
    }

    for (const item of filteredEntries) {
      const itemHours = Number(item.operatingHours) || 0;
      totalCost += item.cost;
      if (itemHours > 0) totalUtilityHours += itemHours;
      activeDates.add(item.date);
      activeCompanies.add(item.company);
      byDateCost.set(item.date, (byDateCost.get(item.date) || 0) + item.cost);
      byCompanyCost.set(
        item.company,
        (byCompanyCost.get(item.company) || 0) + item.cost
      );

      const meta = utilityMap.get(item.utilityId);
      const existing = byUtility.get(item.utilityId) || {
        id: item.utilityId,
        name: meta?.name || item.utilityName,
        unit: meta?.unit || item.unit,
        color: meta?.color || '#64748B',
        cost: 0,
        consumption: 0,
        hours: 0,
        entryCount: 0,
        minUnitCost: null,
        maxUnitCost: null,
        byCompany: new Map(),
      };
      existing.cost += item.cost;
      existing.consumption += item.consumption;
      if (itemHours > 0) existing.hours += itemHours;
      existing.entryCount += 1;
      if (item.consumption > 0) {
        const rate = item.cost / item.consumption;
        existing.minUnitCost =
          existing.minUnitCost === null ? rate : Math.min(existing.minUnitCost, rate);
        existing.maxUnitCost =
          existing.maxUnitCost === null ? rate : Math.max(existing.maxUnitCost, rate);
      }
      const compStat = existing.byCompany.get(item.company) || {
        cost: 0,
        consumption: 0,
        hours: 0,
      };
      compStat.cost += item.cost;
      compStat.consumption += item.consumption;
      if (itemHours > 0) compStat.hours += itemHours;
      existing.byCompany.set(item.company, compStat);
      byUtility.set(item.utilityId, existing);
    }

    for (const gen of filteredGenerationEntries) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      ).filter(
        (a) =>
          (!userAllowedUtilitiesSet || userAllowedUtilitiesSet.has(a.id)) &&
          (selectedUtilityId === 'ALL' || a.id === selectedUtilityId)
      );
      if (allocs.length === 0) continue;

      let dayFuelCost = 0;
      for (const alloc of allocs) {
        dayFuelCost += alloc.cost;
        const existing = byUtility.get(alloc.id) || {
          id: alloc.id,
          name: alloc.name,
          unit: alloc.unit,
          color: alloc.color,
          cost: 0,
          consumption: 0,
          hours: 0,
          entryCount: 0,
          minUnitCost: null,
          maxUnitCost: null,
          byCompany: new Map(),
        };
        existing.cost += alloc.cost;
        existing.consumption += alloc.consumption;
        existing.entryCount += 1;
        if (alloc.consumption > 0 && alloc.cost > 0) {
          const rate = alloc.cost / alloc.consumption;
          existing.minUnitCost =
            existing.minUnitCost === null
              ? rate
              : Math.min(existing.minUnitCost, rate);
          existing.maxUnitCost =
            existing.maxUnitCost === null
              ? rate
              : Math.max(existing.maxUnitCost, rate);
        }
        const compStat = existing.byCompany.get(gen.company) || {
          cost: 0,
          consumption: 0,
          hours: 0,
        };
        compStat.cost += alloc.cost;
        compStat.consumption += alloc.consumption;
        existing.byCompany.set(gen.company, compStat);
        byUtility.set(alloc.id, existing);
      }

      totalCost += dayFuelCost;
      fuelRecordCount += 1;
      activeDates.add(gen.date);
      activeCompanies.add(gen.company);
      byDateCost.set(gen.date, (byDateCost.get(gen.date) || 0) + dayFuelCost);
      byCompanyCost.set(
        gen.company,
        (byCompanyCost.get(gen.company) || 0) + dayFuelCost
      );
    }

    const utilityBreakdown = Array.from(byUtility.values())
      .filter((u) => {
        if (selectedUtilityId !== 'ALL') return u.id === selectedUtilityId;
        return utilityMap.has(u.id) || u.cost > 0 || u.consumption > 0;
      })
      .map((u) => {
        const companyRows = Array.from(u.byCompany.entries())
          .filter(([, val]) => val.cost > 0 || val.consumption > 0)
          .map(([company, val]) => ({
            company,
            cost: val.cost,
            consumption: val.consumption,
            hours: val.hours,
            avgRate: val.consumption > 0 ? val.cost / val.consumption : null,
          }))
          .sort((a, b) => b.cost - a.cost);

        const highestCompany = companyRows[0] ?? null;
        const lowestCompany =
          companyRows.length > 1 ? companyRows[companyRows.length - 1] : null;

        return {
          ...u,
          avgUnitCost: u.consumption > 0 ? u.cost / u.consumption : null,
          avgHourlyRate:
            u.hours > 0 && u.consumption > 0 ? u.consumption / u.hours : null,
          costPerHour: u.hours > 0 && u.cost > 0 ? u.cost / u.hours : null,
          sharePct: totalCost > 0 ? (u.cost / totalCost) * 100 : 0,
          factoryCount: companyRows.length,
          highestCompany,
          lowestCompany,
        };
      });

    const sortedByCost = [...utilityBreakdown].sort((a, b) => b.cost - a.cost);
    const topUtility = sortedByCost[0] && sortedByCost[0].cost > 0 ? sortedByCost[0] : null;
    const dailyAvg = activeDates.size > 0 ? totalCost / activeDates.size : 0;

    let peakDay: { date: string; cost: number } | null = null;
    for (const [date, cost] of byDateCost.entries()) {
      if (!peakDay || cost > peakDay.cost) {
        peakDay = { date, cost };
      }
    }

    let topCompany: { name: string; cost: number; sharePct: number } | null = null;
    for (const [name, cost] of byCompanyCost.entries()) {
      if (!topCompany || cost > topCompany.cost) {
        topCompany = {
          name,
          cost,
          sharePct: totalCost > 0 ? (cost / totalCost) * 100 : 0,
        };
      }
    }

    let costDeltaPct: number | null = null;
    let costDeltaDiff: number | null = null;
    let dailyAvgDeltaPct: number | null = null;
    let dailyAvgDeltaDiff: number | null = null;

    if (comparisonStats && comparisonStats.recordCount > 0) {
      costDeltaDiff = totalCost - comparisonStats.totalCost;
      if (comparisonStats.totalCost > 0) {
        costDeltaPct = (costDeltaDiff / comparisonStats.totalCost) * 100;
      }
      dailyAvgDeltaDiff = dailyAvg - comparisonStats.dailyAvg;
      if (comparisonStats.dailyAvg > 0) {
        dailyAvgDeltaPct = (dailyAvgDeltaDiff / comparisonStats.dailyAvg) * 100;
      }
    }

    const inactiveCompanies =
      selectedCompany === 'ALL'
        ? visibleCompanyNames.filter((name) => !activeCompanies.has(name))
        : [];

    return {
      totalCost,
      totalUtilityHours,
      dailyAvg,
      activeDaysCount: activeDates.size,
      activeCompaniesCount: activeCompanies.size,
      inactiveCompanies,
      recordCount: filteredEntries.length + fuelRecordCount,
      topUtility,
      utilityBreakdown,
      costDeltaPct,
      costDeltaDiff,
      dailyAvgDeltaPct,
      dailyAvgDeltaDiff,
      peakDay,
      topCompany,
    };
  }, [
    filteredEntries,
    filteredGenerationEntries,
    utilities,
    visibleUtilities,
    userAllowedUtilitiesSet,
    utilityMap,
    companyMap,
    selectedUtilityId,
    comparisonStats,
    selectedCompany,
    visibleCompanyNames,
  ]);

  const utilityAvgUnitCostMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of kpis.utilityBreakdown) {
      if (u.avgUnitCost !== null) {
        map.set(u.id, u.avgUnitCost);
      }
    }
    return map;
  }, [kpis.utilityBreakdown]);

  useEffect(() => {
    if (selectedUtilityId !== 'ALL') {
      setUnitTrendUtilityId(selectedUtilityId);
      return;
    }
    if (
      unitTrendUtilityId &&
      filterableUtilities.some((u) => u.id === unitTrendUtilityId)
    ) {
      return;
    }
    if (
      kpis.topUtility?.id &&
      filterableUtilities.some((u) => u.id === kpis.topUtility?.id)
    ) {
      setUnitTrendUtilityId(kpis.topUtility.id);
    } else if (filterableUtilities[0]?.id) {
      setUnitTrendUtilityId(filterableUtilities[0].id);
    }
  }, [selectedUtilityId, kpis.topUtility?.id, filterableUtilities, unitTrendUtilityId]);

  const trendData = useMemo(() => {
    const byBucket = new Map<string, Record<string, string | number | null>>();

    const ensureBucket = (bucketKey: string) => {
      let row = byBucket.get(bucketKey);
      if (!row) {
        row = {
          date: bucketKey,
          label:
            trendGranularity === 'monthly'
              ? formatMonthLabel(bucketKey)
              : formatShortDate(bucketKey),
          totalCost: 0,
          totalConsumption: 0,
        };
        for (const u of filterableUtilities) {
          row[`cost_${u.id}`] = 0;
          row[`cons_${u.id}`] = 0;
          row[`rate_${u.id}`] = null;
        }
        byBucket.set(bucketKey, row);
      }
      return row;
    };

    for (const item of filteredEntries) {
      const bucketKey =
        trendGranularity === 'monthly' ? item.date.slice(0, 7) : item.date;
      const row = ensureBucket(bucketKey);
      row[`cost_${item.utilityId}`] =
        Number(row[`cost_${item.utilityId}`] || 0) + item.cost;
      row[`cons_${item.utilityId}`] =
        Number(row[`cons_${item.utilityId}`] || 0) + item.consumption;
      row.totalCost = Number(row.totalCost || 0) + item.cost;
      row.totalConsumption = Number(row.totalConsumption || 0) + item.consumption;
    }

    for (const gen of filteredGenerationEntries) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      ).filter(
        (a) =>
          (!userAllowedUtilitiesSet || userAllowedUtilitiesSet.has(a.id)) &&
          (selectedUtilityId === 'ALL' || a.id === selectedUtilityId)
      );
      if (allocs.length === 0) continue;

      const bucketKey =
        trendGranularity === 'monthly' ? gen.date.slice(0, 7) : gen.date;
      const row = ensureBucket(bucketKey);
      for (const alloc of allocs) {
        row[`cost_${alloc.id}`] =
          Number(row[`cost_${alloc.id}`] || 0) + alloc.cost;
        row[`cons_${alloc.id}`] =
          Number(row[`cons_${alloc.id}`] || 0) + alloc.consumption;
        row.totalCost = Number(row.totalCost || 0) + alloc.cost;
        row.totalConsumption =
          Number(row.totalConsumption || 0) + alloc.consumption;
      }
    }

    for (const row of byBucket.values()) {
      for (const u of filterableUtilities) {
        const c = Number(row[`cost_${u.id}`] || 0);
        const q = Number(row[`cons_${u.id}`] || 0);
        row[`rate_${u.id}`] = q > 0 ? Number((c / q).toFixed(4)) : null;
      }
    }

    return Array.from(byBucket.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  }, [
    filteredEntries,
    filteredGenerationEntries,
    utilities,
    userAllowedUtilitiesSet,
    filterableUtilities,
    companyMap,
    trendGranularity,
    selectedUtilityId,
  ]);

  const companyComparisonData = useMemo(() => {
    const byCompany = new Map<string, Record<string, string | number>>();
    const companyList =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];

    const ensureCompRow = (name: string) => {
      let row = byCompany.get(name);
      if (!row) {
        row = { company: name, totalCost: 0 };
        for (const u of filterableUtilities) {
          row[`cost_${u.id}`] = 0;
          row[`cons_${u.id}`] = 0;
        }
        byCompany.set(name, row);
      }
      return row;
    };

    for (const name of companyList) {
      ensureCompRow(name);
    }

    for (const item of filteredEntries) {
      const row = ensureCompRow(item.company);
      row[`cost_${item.utilityId}`] =
        Number(row[`cost_${item.utilityId}`] || 0) + item.cost;
      row[`cons_${item.utilityId}`] =
        Number(row[`cons_${item.utilityId}`] || 0) + item.consumption;
      row.totalCost = Number(row.totalCost || 0) + item.cost;
    }

    for (const gen of filteredGenerationEntries) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      ).filter(
        (a) =>
          (!userAllowedUtilitiesSet || userAllowedUtilitiesSet.has(a.id)) &&
          (selectedUtilityId === 'ALL' || a.id === selectedUtilityId)
      );
      if (allocs.length === 0) continue;

      const row = ensureCompRow(gen.company);
      for (const alloc of allocs) {
        row[`cost_${alloc.id}`] =
          Number(row[`cost_${alloc.id}`] || 0) + alloc.cost;
        row[`cons_${alloc.id}`] =
          Number(row[`cons_${alloc.id}`] || 0) + alloc.consumption;
        row.totalCost = Number(row.totalCost || 0) + alloc.cost;
      }
    }

    return Array.from(byCompany.values()).sort(
      (a, b) => Number(b.totalCost || 0) - Number(a.totalCost || 0)
    );
  }, [
    filteredEntries,
    filteredGenerationEntries,
    visibleCompanyNames,
    utilities,
    userAllowedUtilitiesSet,
    filterableUtilities,
    companyMap,
    selectedCompany,
    selectedUtilityId,
  ]);

  const companyBenchmarkRows = useMemo(() => {
    const companyList =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];

    const statsMap = new Map<
      string,
      {
        company: string;
        entryCount: number;
        dates: Set<string>;
        totalCost: number;
        totalConsumption: number;
        totalHours: number;
        byUtil: Map<string, { cost: number; consumption: number; hours: number }>;
      }
    >();

    for (const name of companyList) {
      statsMap.set(name, {
        company: name,
        entryCount: 0,
        dates: new Set(),
        totalCost: 0,
        totalConsumption: 0,
        totalHours: 0,
        byUtil: new Map(),
      });
    }

    for (const item of filteredEntries) {
      const hrs = Number(item.operatingHours) || 0;
      let st = statsMap.get(item.company);
      if (!st) {
        st = {
          company: item.company,
          entryCount: 0,
          dates: new Set(),
          totalCost: 0,
          totalConsumption: 0,
          totalHours: 0,
          byUtil: new Map(),
        };
        statsMap.set(item.company, st);
      }
      st.entryCount += 1;
      st.dates.add(item.date);
      st.totalCost += item.cost;
      st.totalConsumption += item.consumption;
      if (hrs > 0) st.totalHours += hrs;

      const uStat = st.byUtil.get(item.utilityId) || {
        cost: 0,
        consumption: 0,
        hours: 0,
      };
      uStat.cost += item.cost;
      uStat.consumption += item.consumption;
      if (hrs > 0) uStat.hours += hrs;
      st.byUtil.set(item.utilityId, uStat);
    }

    for (const gen of filteredGenerationEntries) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      ).filter(
        (a) =>
          (!userAllowedUtilitiesSet || userAllowedUtilitiesSet.has(a.id)) &&
          (selectedUtilityId === 'ALL' || a.id === selectedUtilityId)
      );

      let st = statsMap.get(gen.company);
      if (!st) {
        st = {
          company: gen.company,
          entryCount: 0,
          dates: new Set(),
          totalCost: 0,
          totalConsumption: 0,
          totalHours: 0,
          byUtil: new Map(),
        };
        statsMap.set(gen.company, st);
      }

      if (selectedUtilityId === 'ALL') {
        const genAssetHrs =
          (Number(gen.boilerOperatingHours) || 0) +
          (Number(gen.generatorOperatingHours) || 0) +
          (Number(gen.solarOperatingHours) || 0);
        if (genAssetHrs > 0) {
          st.totalHours += genAssetHrs;
          st.dates.add(gen.date);
        }
      }

      if (allocs.length === 0) continue;

      st.entryCount += 1;
      st.dates.add(gen.date);

      for (const alloc of allocs) {
        st.totalCost += alloc.cost;
        st.totalConsumption += alloc.consumption;
        const uStat = st.byUtil.get(alloc.id) || {
          cost: 0,
          consumption: 0,
          hours: 0,
        };
        uStat.cost += alloc.cost;
        uStat.consumption += alloc.consumption;
        st.byUtil.set(alloc.id, uStat);
      }
    }

    const q = benchmarkSearch.trim().toLowerCase();

    return Array.from(statsMap.values())
      .map((st) => {
        const activeDays = st.dates.size;
        const dailyAvg = activeDays > 0 ? st.totalCost / activeDays : 0;
        const costPerHour = st.totalHours > 0 ? st.totalCost / st.totalHours : null;
        const sharePct =
          kpis.totalCost > 0 ? (st.totalCost / kpis.totalCost) * 100 : 0;
        const prevComp = comparisonStats?.byCompany.get(st.company);
        const prevCost = prevComp && prevComp.count > 0 ? prevComp.cost : null;
        const prevDailyAvg =
          prevComp && prevComp.dates.size > 0
            ? prevComp.cost / prevComp.dates.size
            : null;
        const deltaPct =
          prevCost !== null && prevCost > 0
            ? ((st.totalCost - prevCost) / prevCost) * 100
            : null;
        const dailyDeltaPct =
          prevDailyAvg !== null && prevDailyAvg > 0
            ? ((dailyAvg - prevDailyAvg) / prevDailyAvg) * 100
            : null;
        const singleUtilAvgRate =
          selectedUtilityId !== 'ALL' && st.totalConsumption > 0
            ? st.totalCost / st.totalConsumption
            : null;

        return {
          company: st.company,
          entryCount: st.entryCount,
          activeDays,
          totalHours: st.totalHours,
          costPerHour,
          totalCost: st.totalCost,
          totalConsumption: st.totalConsumption,
          dailyAvg,
          sharePct,
          prevCost,
          prevDailyAvg,
          deltaPct,
          dailyDeltaPct,
          singleUtilAvgRate,
          byUtil: st.byUtil,
        };
      })
      .filter((r) => !q || r.company.toLowerCase().includes(q))
      .sort((a, b) => {
        const dir = benchmarkSortDir === 'asc' ? 1 : -1;
        switch (benchmarkSortKey) {
          case 'company':
            return a.company.localeCompare(b.company) * dir;
          case 'activeDays':
            return (a.activeDays - b.activeDays) * dir;
          case 'totalHours':
            return (a.totalHours - b.totalHours) * dir;
          case 'sharePct':
            return (a.sharePct - b.sharePct) * dir;
          case 'dailyAvg':
            return (a.dailyAvg - b.dailyAvg) * dir;
          case 'deltaPct': {
            const va = a.deltaPct ?? -Infinity;
            const vb = b.deltaPct ?? -Infinity;
            return (va - vb) * dir;
          }
          case 'totalCost':
          default:
            return (a.totalCost - b.totalCost) * dir;
        }
      });
  }, [
    selectedCompany,
    visibleCompanyNames,
    filteredEntries,
    filteredGenerationEntries,
    utilities,
    userAllowedUtilitiesSet,
    companyMap,
    kpis.totalCost,
    comparisonStats,
    selectedUtilityId,
    benchmarkSearch,
    benchmarkSortKey,
    benchmarkSortDir,
  ]);

  // Period Comparison Chart Data (Period A vs Period B)
  const compareChartData = useMemo(() => {
    if (!compareOpen || !comparisonStats) return [];
    if (compareChartTab === 'utility') {
      return kpis.utilityBreakdown.map((u) => {
        const prevUtil = comparisonStats.byUtility.get(u.id);
        const curVal =
          compareMetric === 'dailyAvg'
            ? kpis.activeDaysCount > 0
              ? u.cost / kpis.activeDaysCount
              : 0
            : u.cost;
        const prevVal =
          compareMetric === 'dailyAvg'
            ? comparisonStats.activeDaysCount > 0
              ? (prevUtil?.cost || 0) / comparisonStats.activeDaysCount
              : 0
            : prevUtil?.cost || 0;
        const diff = curVal - prevVal;
        const pct = prevVal > 0 ? (diff / prevVal) * 100 : null;
        return {
          name: u.name,
          current: curVal,
          previous: prevVal,
          diff,
          pct,
        };
      });
    }

    const companyList =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];
    const curCompanyMap = new Map(
      companyBenchmarkRows.map((r) => [r.company, r])
    );

    return companyList
      .map((name) => {
        const curRow = curCompanyMap.get(name);
        const prevRow = comparisonStats.byCompany.get(name);
        const curVal =
          compareMetric === 'dailyAvg'
            ? curRow?.dailyAvg || 0
            : curRow?.totalCost || 0;
        const prevDaily =
          prevRow && prevRow.dates.size > 0
            ? prevRow.cost / prevRow.dates.size
            : 0;
        const prevVal =
          compareMetric === 'dailyAvg' ? prevDaily : prevRow?.cost || 0;
        const diff = curVal - prevVal;
        const pct = prevVal > 0 ? (diff / prevVal) * 100 : null;
        return {
          name,
          current: curVal,
          previous: prevVal,
          diff,
          pct,
        };
      })
      .sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous));
  }, [
    compareOpen,
    comparisonStats,
    compareChartTab,
    compareMetric,
    kpis.utilityBreakdown,
    kpis.activeDaysCount,
    selectedCompany,
    visibleCompanyNames,
    companyBenchmarkRows,
  ]);

  // Actionable executive management insights
  const managementInsights = useMemo(() => {
    const items: Array<{
      id: string;
      tone: 'neutral' | 'warning' | 'positive' | 'alert';
      text: string;
      actionLabel?: string;
      onAction?: () => void;
    }> = [];

    if (kpis.costDeltaPct !== null && comparisonStats) {
      const sign = kpis.costDeltaPct >= 0 ? '+' : '';
      items.push({
        id: 'period-delta',
        tone:
          kpis.costDeltaPct > 10
            ? 'alert'
            : kpis.costDeltaPct < -5
            ? 'positive'
            : 'neutral',
        text: `Spend is ${sign}${formatPercent(kpis.costDeltaPct)} (${
          kpis.costDeltaDiff && kpis.costDeltaDiff >= 0 ? '+' : ''
        }${formatCurrency(kpis.costDeltaDiff || 0)}) vs ${comparisonStats.bounds.label}.`,
      });
    }

    if (kpis.topCompany && visibleCompanyNames.length > 1) {
      items.push({
        id: 'top-factory',
        tone: 'neutral',
        text: `${kpis.topCompany.name} leads group spend at ${formatCurrency(
          kpis.topCompany.cost
        )} (${formatPercent(kpis.topCompany.sharePct)}).`,
        actionLabel: selectedCompany === 'ALL' ? 'Filter Factory' : undefined,
        onAction:
          selectedCompany === 'ALL'
            ? () => setSelectedCompany(kpis.topCompany!.name)
            : undefined,
      });
    }

    if (kpis.inactiveCompanies.length > 0 && kpis.recordCount > 0) {
      const preview = kpis.inactiveCompanies.slice(0, 3).join(', ');
      const extra =
        kpis.inactiveCompanies.length > 3
          ? ` +${kpis.inactiveCompanies.length - 3} more`
          : '';
      items.push({
        id: 'missing-factories',
        tone: 'warning',
        text: `${formatNumber(kpis.inactiveCompanies.length, 0)} ${
          kpis.inactiveCompanies.length === 1 ? 'factory has' : 'factories have'
        } no logs in this period: ${preview}${extra}.`,
      });
    }

    return items;
  }, [
    kpis,
    comparisonStats,
    visibleCompanyNames.length,
    selectedCompany,
  ]);

  const pieData = useMemo(() => {
    return kpis.utilityBreakdown
      .filter((u) => u.cost > 0)
      .map((u) => ({
        id: u.id,
        name: u.name,
        value: u.cost,
        color: u.color,
        consumption: u.consumption,
        unit: u.unit,
        avgUnitCost: u.avgUnitCost,
      }));
  }, [kpis.utilityBreakdown]);

  const hasFactorySpendData = useMemo(
    () => companyComparisonData.some((r) => Number(r.totalCost || 0) > 0),
    [companyComparisonData]
  );

  const activeUtilities = useMemo(() => {
    if (selectedUtilityId === 'ALL') {
      const usedExtraIds = new Set(
        kpis.utilityBreakdown
          .filter((u) => !utilityMap.has(u.id) && (u.cost > 0 || u.consumption > 0))
          .map((u) => u.id)
      );
      return filterableUtilities.filter(
        (u) => utilityMap.has(u.id) || usedExtraIds.has(u.id)
      );
    }
    return filterableUtilities.filter((u) => u.id === selectedUtilityId);
  }, [filterableUtilities, utilityMap, selectedUtilityId, kpis.utilityBreakdown]);

  const singleSelectedUtil =
    selectedUtilityId !== 'ALL'
      ? filterableUtilityMap.get(selectedUtilityId) ?? null
      : null;

  const activeUnitTrendUtil =
    filterableUtilityMap.get(unitTrendUtilityId) ??
    singleSelectedUtil ??
    filterableUtilities[0] ??
    null;

  const activeUnitTrendAvg = activeUnitTrendUtil
    ? utilityAvgUnitCostMap.get(activeUnitTrendUtil.id) ?? null
    : null;

  const unitTrendPoints = useMemo(() => {
    if (!activeUnitTrendUtil) return [];
    return trendData.filter(
      (row) => row[`rate_${activeUnitTrendUtil.id}`] !== null
    );
  }, [trendData, activeUnitTrendUtil]);

  const unitTrendDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
    if (!activeUnitTrendUtil || unitTrendPoints.length === 0) return ['auto', 'auto'];
    const vals = unitTrendPoints
      .map((r) => Number(r[`rate_${activeUnitTrendUtil.id}`]))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (vals.length === 0) return ['auto', 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (Math.abs(max - min) < 0.01) {
      const pad = Math.max(0.5, min * 0.15);
      return [Math.max(0, Number((min - pad).toFixed(2))), Number((max + pad).toFixed(2))];
    }
    const pad = (max - min) * 0.14;
    return [Math.max(0, Number((min - pad).toFixed(2))), Number((max + pad).toFixed(2))];
  }, [activeUnitTrendUtil, unitTrendPoints]);

  const electricityUtility = useMemo(() => {
    return (
      visibleUtilities.find(
        (u) =>
          u.name.toLowerCase().includes('electric') ||
          u.unit.toLowerCase() === 'kwh'
      ) || null
    );
  }, [visibleUtilities]);

  const canViewPlantGeneration = useMemo(() => {
    if (!userAllowedUtilitiesSet) return true;
    if (electricityUtility) return true;
    return visibleGenerationEntries.some((gen) =>
      extractPlantFuelAllocations(gen, utilities, companyMap.get(gen.company)).some(
        (a) => userAllowedUtilitiesSet.has(a.id)
      )
    );
  }, [
    userAllowedUtilitiesSet,
    electricityUtility,
    visibleGenerationEntries,
    utilities,
    companyMap,
  ]);

  const generationAnalytics = useMemo(() => {
    let totalSteamKg = 0;
    let totalBoilerFuelQty = 0;
    let totalBoilerFuelCost = 0;
    let totalBoilerHours = 0;
    let totalGenKwh = 0;
    let totalGenFuelQty = 0;
    let totalGenFuelCost = 0;
    let totalGenHours = 0;
    let totalDieselGenKwh = 0;
    let totalDieselFuelQty = 0;
    let totalDieselFuelCost = 0;
    let totalGasGenKwh = 0;
    let totalGasFuelQty = 0;
    let totalGasFuelCost = 0;
    let totalSolarKwh = 0;
    let totalSolarSavings = 0;
    let totalSolarHours = 0;
    let totalGridKwh = 0;
    let totalGridHours = 0;
    let totalPeakGridKwh = 0;
    let totalPeakGridCost = 0;
    let totalOffPeakGridKwh = 0;
    let totalOffPeakGridCost = 0;

    const parseGridBreakdown = (raw?: string): GridProviderReading[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(
            (x) =>
              x &&
              typeof x.provider === 'string' &&
              x.provider.trim().length > 0 &&
              (Number(x.kwh) > 0 || Number(x.cost) > 0 || Number(x.operatingHours) > 0)
          )
          .map((x) => {
            const tariff: GridTariffPeriod =
              x.tariff === 'peak' || x.tariff === 'offPeak' ? x.tariff : 'flat';
            return {
              provider: String(x.provider).trim(),
              tariff,
              kwh: Number(x.kwh) || 0,
              operatingHours: Number(x.operatingHours) || 0,
              unitCost: Number(x.unitCost) || 0,
              cost: Number(x.cost) || 0,
            };
          });
      } catch {
        return [];
      }
    };

    const parseUnitReadings = (raw?: string): GenerationUnitReadings | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed as GenerationUnitReadings;
      } catch {
        return null;
      }
    };

    const globalGridProviderMap = new Map<
      string,
      {
        provider: string;
        kwh: number;
        cost: number;
        hours: number;
        peakKwh: number;
        peakCost: number;
        offPeakKwh: number;
        offPeakCost: number;
      }
    >();

    type BoilerAgg = {
      key: string;
      unitIndex: number;
      deviceName: string;
      fuelMode: DeviceFuelMode;
      hours: number;
      steamKg: number;
      fuelQty: number;
      fuelUnit: string;
      secondaryFuelQty: number;
      secondaryFuelUnit?: string;
      fuelCost: number;
    };

    type GenAgg = {
      key: string;
      unitIndex: number;
      deviceName: string;
      fuelMode: DeviceFuelMode;
      hours: number;
      kwh: number;
      fuelQty: number;
      fuelUnit: string;
      secondaryFuelQty: number;
      secondaryFuelUnit?: string;
      fuelCost: number;
    };

    type SolarAgg = {
      key: string;
      unitIndex: number;
      deviceName: string;
      hours: number;
      kwh: number;
      savings: number;
    };

    const boilerFuelByUnitGlobal = new Map<string, number>();
    const genFuelByUnitGlobal = new Map<string, number>();
    const globalBoilerUnitsMap = new Map<string, BoilerAgg>();
    const globalGenUnitsMap = new Map<string, GenAgg>();
    const globalSolarUnitsMap = new Map<string, SolarAgg>();

    const latestByCompany = new Map<string, GenerationEntry>();
    const byCompany = new Map<
      string,
      {
        company: string;
        boilerCount: number;
        boilerHours: number;
        steamKg: number;
        boilerFuelQty: number;
        boilerFuelUnit: string;
        boilerFuelCost: number;
        boilerFuelByUnit: Map<string, number>;
        boilerUnitsMap: Map<string, BoilerAgg>;
        generatorCount: number;
        dieselGeneratorCount: number;
        gasGeneratorCount: number;
        generatorHours: number;
        generatorKwh: number;
        generatorFuelQty: number;
        generatorFuelUnit: string;
        generatorFuelCost: number;
        genFuelByUnit: Map<string, number>;
        generatorUnitsMap: Map<string, GenAgg>;
        dieselGenKwh: number;
        dieselFuelCost: number;
        dieselUnitsMap: Map<string, GenAgg>;
        gasGenKwh: number;
        gasFuelCost: number;
        gasUnitsMap: Map<string, GenAgg>;
        solarSystemCount: number;
        solarHours: number;
        solarKwh: number;
        solarSavings: number;
        solarUnitsMap: Map<string, SolarAgg>;
        gridKwh: number;
        gridHours: number;
        peakGridKwh: number;
        peakGridCost: number;
        offPeakGridKwh: number;
        offPeakGridCost: number;
        gridProviders: Map<
          string,
          {
            provider: string;
            kwh: number;
            cost: number;
            hours: number;
            peakKwh: number;
            peakCost: number;
            offPeakKwh: number;
            offPeakCost: number;
          }
        >;
        logCount: number;
      }
    >();

    const companyList =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];
    for (const c of companyList) {
      byCompany.set(c, {
        company: c,
        boilerCount: 0,
        boilerHours: 0,
        steamKg: 0,
        boilerFuelQty: 0,
        boilerFuelUnit: 'm³',
        boilerFuelCost: 0,
        boilerFuelByUnit: new Map(),
        boilerUnitsMap: new Map(),
        generatorCount: 0,
        dieselGeneratorCount: 0,
        gasGeneratorCount: 0,
        generatorHours: 0,
        generatorKwh: 0,
        generatorFuelQty: 0,
        generatorFuelUnit: 'm³',
        generatorFuelCost: 0,
        genFuelByUnit: new Map(),
        generatorUnitsMap: new Map(),
        dieselGenKwh: 0,
        dieselFuelCost: 0,
        dieselUnitsMap: new Map(),
        gasGenKwh: 0,
        gasFuelCost: 0,
        gasUnitsMap: new Map(),
        solarSystemCount: 0,
        solarHours: 0,
        solarKwh: 0,
        solarSavings: 0,
        solarUnitsMap: new Map(),
        gridKwh: 0,
        gridHours: 0,
        peakGridKwh: 0,
        peakGridCost: 0,
        offPeakGridKwh: 0,
        offPeakGridCost: 0,
        gridProviders: new Map(),
        logCount: 0,
      });
    }

    // Track grid electricity kWh & operating hours across same date/company scope
    if (electricityUtility) {
      for (const e of visibleEntries) {
        if (e.utilityId !== electricityUtility.id) continue;
        if (e.date < dateBounds.start || e.date > dateBounds.end) continue;
        if (selectedCompany !== 'ALL' && e.company !== selectedCompany) continue;
        const hrs = Number(e.operatingHours) || 0;
        totalGridKwh += e.consumption;
        totalGridHours += hrs;
        const row = byCompany.get(e.company);
        if (row) {
          row.gridKwh += e.consumption;
          row.gridHours += hrs;
        }
      }
    }

    const boilerUnitCounts = new Map<string, number>();
    const genUnitCounts = new Map<string, number>();

    const byTimeBucket = new Map<
      string,
      {
        date: string;
        label: string;
        steamKg: number;
        generatorKwh: number;
        solarKwh: number;
        gridKwh: number;
      }
    >();

    if (electricityUtility) {
      for (const e of visibleEntries) {
        if (e.utilityId !== electricityUtility.id) continue;
        if (e.date < dateBounds.start || e.date > dateBounds.end) continue;
        if (selectedCompany !== 'ALL' && e.company !== selectedCompany) continue;
        const bucketKey =
          trendGranularity === 'monthly' ? e.date.slice(0, 7) : e.date;
        const bucket = byTimeBucket.get(bucketKey) || {
          date: bucketKey,
          label:
            trendGranularity === 'monthly'
              ? formatMonthLabel(bucketKey)
              : formatShortDate(bucketKey),
          steamKg: 0,
          generatorKwh: 0,
          solarKwh: 0,
          gridKwh: 0,
        };
        bucket.gridKwh += e.consumption;
        byTimeBucket.set(bucketKey, bucket);
      }
    }

    const accumulateGenUnit = (
      targetMap: Map<string, GenAgg>,
      u: GeneratorUnitReading,
      fallbackPrefix: string,
      companyPrefix = ''
    ) => {
      const idx = Number(u.unitIndex) || 1;
      const baseKey = u.deviceId?.trim() || `${fallbackPrefix}_${idx}`;
      const key = companyPrefix ? `${companyPrefix}::${baseKey}` : baseKey;
      const fMode: DeviceFuelMode =
        u.fuelMode || unitToFuelMode(u.fuelUnit || 'L');
      const unitCostTotal = getGenReadingTotalCost(u);
      const prev = targetMap.get(key) || {
        key,
        unitIndex: idx,
        deviceName: companyPrefix
          ? `${companyPrefix} · ${u.deviceName?.trim() || `Generator #${idx}`}`
          : u.deviceName?.trim() || `Generator #${idx}`,
        fuelMode: fMode,
        hours: 0,
        kwh: 0,
        fuelQty: 0,
        fuelUnit: u.fuelUnit || 'L',
        secondaryFuelQty: 0,
        secondaryFuelUnit: u.secondaryFuelUnit,
        fuelCost: 0,
      };
      prev.hours += Number(u.operatingHours) || 0;
      prev.kwh += Number(u.kwh) || 0;
      prev.fuelQty += Number(u.fuelQty) || 0;
      prev.secondaryFuelQty += Number(u.secondaryFuelQty) || 0;
      prev.fuelCost += unitCostTotal;
      if (u.deviceName?.trim()) {
        prev.deviceName = companyPrefix
          ? `${companyPrefix} · ${u.deviceName.trim()}`
          : u.deviceName.trim();
      }
      if (u.fuelMode) prev.fuelMode = u.fuelMode;
      if (u.fuelUnit) prev.fuelUnit = u.fuelUnit;
      if (u.secondaryFuelUnit) prev.secondaryFuelUnit = u.secondaryFuelUnit;
      targetMap.set(key, prev);
    };

    const accumulateBoilerUnit = (
      targetMap: Map<string, BoilerAgg>,
      u: BoilerUnitReading,
      companyPrefix = ''
    ) => {
      const idx = Number(u.unitIndex) || 1;
      const baseKey = u.deviceId?.trim() || `boiler_${idx}`;
      const key = companyPrefix ? `${companyPrefix}::${baseKey}` : baseKey;
      const fMode: DeviceFuelMode =
        u.fuelMode || unitToFuelMode(u.fuelUnit || 'm³');
      const unitCostTotal = getBoilerReadingTotalCost(u);
      const prev = targetMap.get(key) || {
        key,
        unitIndex: idx,
        deviceName: companyPrefix
          ? `${companyPrefix} · ${u.deviceName?.trim() || `Boiler #${idx}`}`
          : u.deviceName?.trim() || `Boiler #${idx}`,
        fuelMode: fMode,
        hours: 0,
        steamKg: 0,
        fuelQty: 0,
        fuelUnit: u.fuelUnit || 'm³',
        secondaryFuelQty: 0,
        secondaryFuelUnit: u.secondaryFuelUnit,
        fuelCost: 0,
      };
      prev.hours += Number(u.operatingHours) || 0;
      prev.steamKg += Number(u.steamKg) || 0;
      prev.fuelQty += Number(u.fuelQty) || 0;
      prev.secondaryFuelQty += Number(u.secondaryFuelQty) || 0;
      prev.fuelCost += unitCostTotal;
      if (u.deviceName?.trim()) {
        prev.deviceName = companyPrefix
          ? `${companyPrefix} · ${u.deviceName.trim()}`
          : u.deviceName.trim();
      }
      if (u.fuelMode) prev.fuelMode = u.fuelMode;
      if (u.fuelUnit) prev.fuelUnit = u.fuelUnit;
      if (u.secondaryFuelUnit) prev.secondaryFuelUnit = u.secondaryFuelUnit;
      targetMap.set(key, prev);
    };

    const accumulateSolarUnit = (
      targetMap: Map<string, SolarAgg>,
      u: SolarUnitReading,
      companyPrefix = ''
    ) => {
      const idx = Number(u.unitIndex) || 1;
      const baseKey = u.deviceId?.trim() || `solar_${idx}`;
      const key = companyPrefix ? `${companyPrefix}::${baseKey}` : baseKey;
      const prev = targetMap.get(key) || {
        key,
        unitIndex: idx,
        deviceName: companyPrefix
          ? `${companyPrefix} · ${u.deviceName?.trim() || `Solar #${idx}`}`
          : u.deviceName?.trim() || `Solar #${idx}`,
        hours: 0,
        kwh: 0,
        savings: 0,
      };
      prev.hours += Number(u.operatingHours) || 0;
      prev.kwh += Number(u.kwh) || 0;
      prev.savings += Number(u.savings) || 0;
      if (u.deviceName?.trim()) {
        prev.deviceName = companyPrefix
          ? `${companyPrefix} · ${u.deviceName.trim()}`
          : u.deviceName.trim();
      }
      targetMap.set(key, prev);
    };

    const multiFactoryInScope =
      selectedCompany === 'ALL' && visibleCompanyNames.length > 1;

    for (const item of filteredGenerationEntries) {
      const dieselKwh = item.dieselGenKwh || 0;
      const dieselQty = item.dieselFuelQty || 0;
      const dieselCost = item.dieselFuelCost || 0;
      const gasKwh = item.gasGenKwh || 0;
      const gasQty = item.gasFuelQty || 0;
      const gasCost = item.gasFuelCost || 0;

      const parsedUnits = parseUnitReadings(item.unitReadings);

      const itemBoilerHrs =
        Number(item.boilerOperatingHours) ||
        (parsedUnits?.boilerUnits || []).reduce(
          (acc, u) => acc + (Number(u.operatingHours) || 0),
          0
        );
      const itemGenHrs =
        Number(item.generatorOperatingHours) ||
        (parsedUnits?.generatorUnits || []).reduce(
          (acc, u) => acc + (Number(u.operatingHours) || 0),
          0
        ) +
          (parsedUnits?.dieselGenUnits || []).reduce(
            (acc, u) => acc + (Number(u.operatingHours) || 0),
            0
          ) +
          (parsedUnits?.gasGenUnits || []).reduce(
            (acc, u) => acc + (Number(u.operatingHours) || 0),
            0
          );
      const itemSolarHrs =
        Number(item.solarOperatingHours) ||
        (parsedUnits?.solarUnitDetails || []).reduce(
          (acc, u) => acc + (Number(u.operatingHours) || 0),
          0
        );

      totalSteamKg += item.steamKg;
      totalBoilerFuelQty += item.boilerFuelQty;
      totalBoilerFuelCost += item.boilerFuelCost;
      totalBoilerHours += itemBoilerHrs;
      totalGenKwh += item.generatorKwh;
      totalGenFuelQty += item.generatorFuelQty;
      totalGenFuelCost += item.generatorFuelCost;
      totalGenHours += itemGenHrs;
      totalDieselGenKwh += dieselKwh;
      totalDieselFuelQty += dieselQty;
      totalDieselFuelCost += dieselCost;
      totalGasGenKwh += gasKwh;
      totalGasFuelQty += gasQty;
      totalGasFuelCost += gasCost;
      totalSolarKwh += item.solarKwh;
      totalSolarSavings += item.solarSavings;
      totalSolarHours += itemSolarHrs;

      if (item.boilerFuelUnit && item.boilerFuelUnit !== 'Mixed') {
        boilerUnitCounts.set(
          item.boilerFuelUnit,
          (boilerUnitCounts.get(item.boilerFuelUnit) || 0) + 1
        );
      }
      if (item.generatorFuelUnit && item.generatorFuelUnit !== 'Mixed') {
        genUnitCounts.set(
          item.generatorFuelUnit,
          (genUnitCounts.get(item.generatorFuelUnit) || 0) + 1
        );
      }

      const prevLatest = latestByCompany.get(item.company);
      if (!prevLatest || item.date > prevLatest.date) {
        latestByCompany.set(item.company, item);
      }

      const comp = byCompany.get(item.company) || {
        company: item.company,
        boilerCount: 0,
        boilerHours: 0,
        steamKg: 0,
        boilerFuelQty: 0,
        boilerFuelUnit: item.boilerFuelUnit || 'm³',
        boilerFuelCost: 0,
        boilerFuelByUnit: new Map<string, number>(),
        boilerUnitsMap: new Map<string, BoilerAgg>(),
        generatorCount: 0,
        dieselGeneratorCount: 0,
        gasGeneratorCount: 0,
        generatorHours: 0,
        generatorKwh: 0,
        generatorFuelQty: 0,
        generatorFuelUnit: item.generatorFuelUnit || 'm³',
        generatorFuelCost: 0,
        genFuelByUnit: new Map<string, number>(),
        generatorUnitsMap: new Map<string, GenAgg>(),
        dieselGenKwh: 0,
        dieselFuelCost: 0,
        dieselUnitsMap: new Map<string, GenAgg>(),
        gasGenKwh: 0,
        gasFuelCost: 0,
        gasUnitsMap: new Map<string, GenAgg>(),
        solarSystemCount: 0,
        solarHours: 0,
        solarKwh: 0,
        solarSavings: 0,
        solarUnitsMap: new Map<string, SolarAgg>(),
        gridKwh: 0,
        gridHours: 0,
        peakGridKwh: 0,
        peakGridCost: 0,
        offPeakGridKwh: 0,
        offPeakGridCost: 0,
        gridProviders: new Map(),
        logCount: 0,
      };
      comp.boilerHours += itemBoilerHrs;
      comp.steamKg += item.steamKg;
      comp.boilerFuelQty += item.boilerFuelQty;
      comp.boilerFuelCost += item.boilerFuelCost;
      comp.boilerFuelUnit = item.boilerFuelUnit || comp.boilerFuelUnit;
      comp.generatorHours += itemGenHrs;
      comp.generatorKwh += item.generatorKwh;
      comp.generatorFuelQty += item.generatorFuelQty;
      comp.generatorFuelCost += item.generatorFuelCost;
      comp.generatorFuelUnit = item.generatorFuelUnit || comp.generatorFuelUnit;
      comp.dieselGenKwh += dieselKwh;
      comp.dieselFuelCost += dieselCost;
      comp.gasGenKwh += gasKwh;
      comp.gasFuelCost += gasCost;
      comp.solarHours += itemSolarHrs;
      comp.solarKwh += item.solarKwh;
      comp.solarSavings += item.solarSavings;
      comp.logCount += 1;

      const globalPrefix = multiFactoryInScope ? item.company : '';

      if (parsedUnits?.boilerUnits && Array.isArray(parsedUnits.boilerUnits) && parsedUnits.boilerUnits.length > 0) {
        for (const bu of parsedUnits.boilerUnits) {
          const totalUnitCost = getBoilerReadingTotalCost(bu);
          const pQty = Number(bu.fuelQty) || 0;
          const sQty = Number(bu.secondaryFuelQty) || 0;
          const bHrs = Number(bu.operatingHours) || 0;
          if (pQty > 0 && bu.fuelUnit) {
            boilerFuelByUnitGlobal.set(
              bu.fuelUnit,
              (boilerFuelByUnitGlobal.get(bu.fuelUnit) || 0) + pQty
            );
            comp.boilerFuelByUnit.set(
              bu.fuelUnit,
              (comp.boilerFuelByUnit.get(bu.fuelUnit) || 0) + pQty
            );
          }
          if (sQty > 0 && bu.secondaryFuelUnit) {
            boilerFuelByUnitGlobal.set(
              bu.secondaryFuelUnit,
              (boilerFuelByUnitGlobal.get(bu.secondaryFuelUnit) || 0) + sQty
            );
            comp.boilerFuelByUnit.set(
              bu.secondaryFuelUnit,
              (comp.boilerFuelByUnit.get(bu.secondaryFuelUnit) || 0) + sQty
            );
          }
          if (
            (Number(bu.steamKg) || 0) > 0 ||
            pQty > 0 ||
            sQty > 0 ||
            totalUnitCost > 0 ||
            bHrs > 0
          ) {
            accumulateBoilerUnit(comp.boilerUnitsMap, bu);
            accumulateBoilerUnit(globalBoilerUnitsMap, bu, globalPrefix);
          }
        }
      } else if (item.boilerFuelQty > 0 && item.boilerFuelUnit) {
        boilerFuelByUnitGlobal.set(
          item.boilerFuelUnit,
          (boilerFuelByUnitGlobal.get(item.boilerFuelUnit) || 0) + item.boilerFuelQty
        );
        comp.boilerFuelByUnit.set(
          item.boilerFuelUnit,
          (comp.boilerFuelByUnit.get(item.boilerFuelUnit) || 0) + item.boilerFuelQty
        );
      }

      const hasUnifiedGens =
        Array.isArray(parsedUnits?.generatorUnits) &&
        parsedUnits.generatorUnits.length > 0;
      if (hasUnifiedGens && parsedUnits?.generatorUnits) {
        for (const gu of parsedUnits.generatorUnits) {
          const totalUnitCost = getGenReadingTotalCost(gu);
          const pQty = Number(gu.fuelQty) || 0;
          const sQty = Number(gu.secondaryFuelQty) || 0;
          const gHrs = Number(gu.operatingHours) || 0;
          if (pQty > 0 && gu.fuelUnit) {
            genFuelByUnitGlobal.set(
              gu.fuelUnit,
              (genFuelByUnitGlobal.get(gu.fuelUnit) || 0) + pQty
            );
            comp.genFuelByUnit.set(
              gu.fuelUnit,
              (comp.genFuelByUnit.get(gu.fuelUnit) || 0) + pQty
            );
          }
          if (sQty > 0 && gu.secondaryFuelUnit) {
            genFuelByUnitGlobal.set(
              gu.secondaryFuelUnit,
              (genFuelByUnitGlobal.get(gu.secondaryFuelUnit) || 0) + sQty
            );
            comp.genFuelByUnit.set(
              gu.secondaryFuelUnit,
              (comp.genFuelByUnit.get(gu.secondaryFuelUnit) || 0) + sQty
            );
          }
          if (
            (Number(gu.kwh) || 0) > 0 ||
            pQty > 0 ||
            sQty > 0 ||
            totalUnitCost > 0 ||
            gHrs > 0
          ) {
            accumulateGenUnit(comp.generatorUnitsMap, gu, 'gen');
            accumulateGenUnit(globalGenUnitsMap, gu, 'gen', globalPrefix);
            const fMode = gu.fuelMode || unitToFuelMode(gu.fuelUnit || 'L');
            if (fMode === 'diesel') {
              accumulateGenUnit(comp.dieselUnitsMap, gu, 'diesel_gen');
            } else if (isGasLikeFuelMode(fMode)) {
              accumulateGenUnit(comp.gasUnitsMap, gu, 'gas_gen');
            }
          }
        }
      } else {
        if (
          parsedUnits?.dieselGenUnits &&
          Array.isArray(parsedUnits.dieselGenUnits)
        ) {
          for (const du of parsedUnits.dieselGenUnits) {
            const pQty = Number(du.fuelQty) || 0;
            const dHrs = Number(du.operatingHours) || 0;
            if (pQty > 0 && du.fuelUnit) {
              genFuelByUnitGlobal.set(
                du.fuelUnit,
                (genFuelByUnitGlobal.get(du.fuelUnit) || 0) + pQty
              );
              comp.genFuelByUnit.set(
                du.fuelUnit,
                (comp.genFuelByUnit.get(du.fuelUnit) || 0) + pQty
              );
            }
            if (
              (Number(du.kwh) || 0) > 0 ||
              pQty > 0 ||
              getGenReadingTotalCost(du) > 0 ||
              dHrs > 0
            ) {
              accumulateGenUnit(comp.dieselUnitsMap, du, 'diesel_gen');
              const dCompat = {
                ...du,
                deviceName: du.deviceName || `Diesel Gen #${du.unitIndex}`,
                fuelMode: 'diesel' as DeviceFuelMode,
              };
              accumulateGenUnit(comp.generatorUnitsMap, dCompat, 'diesel_gen');
              accumulateGenUnit(globalGenUnitsMap, dCompat, 'diesel_gen', globalPrefix);
            }
          }
        }
        if (parsedUnits?.gasGenUnits && Array.isArray(parsedUnits.gasGenUnits)) {
          for (const gu of parsedUnits.gasGenUnits) {
            const pQty = Number(gu.fuelQty) || 0;
            const gHrs = Number(gu.operatingHours) || 0;
            if (pQty > 0 && gu.fuelUnit) {
              genFuelByUnitGlobal.set(
                gu.fuelUnit,
                (genFuelByUnitGlobal.get(gu.fuelUnit) || 0) + pQty
              );
              comp.genFuelByUnit.set(
                gu.fuelUnit,
                (comp.genFuelByUnit.get(gu.fuelUnit) || 0) + pQty
              );
            }
            if (
              (Number(gu.kwh) || 0) > 0 ||
              pQty > 0 ||
              getGenReadingTotalCost(gu) > 0 ||
              gHrs > 0
            ) {
              accumulateGenUnit(comp.gasUnitsMap, gu, 'gas_gen');
              const gCompat = {
                ...gu,
                deviceName: gu.deviceName || `Gas Gen #${gu.unitIndex}`,
                fuelMode: 'gas' as DeviceFuelMode,
              };
              accumulateGenUnit(comp.generatorUnitsMap, gCompat, 'gas_gen');
              accumulateGenUnit(globalGenUnitsMap, gCompat, 'gas_gen', globalPrefix);
            }
          }
        }
      }

      if (
        parsedUnits?.solarUnitDetails &&
        Array.isArray(parsedUnits.solarUnitDetails)
      ) {
        for (const su of parsedUnits.solarUnitDetails) {
          if (
            (Number(su.kwh) || 0) > 0 ||
            (Number(su.savings) || 0) > 0 ||
            (Number(su.operatingHours) || 0) > 0
          ) {
            accumulateSolarUnit(comp.solarUnitsMap, su);
            accumulateSolarUnit(globalSolarUnitsMap, su, globalPrefix);
          }
        }
      }

      const parsedGrid = parseGridBreakdown(item.gridProviderBreakdown);
      for (const gp of parsedGrid) {
        const gpHrs = Number(gp.operatingHours) || 0;
        if (gp.tariff === 'peak') {
          totalPeakGridKwh += gp.kwh;
          totalPeakGridCost += gp.cost;
          comp.peakGridKwh += gp.kwh;
          comp.peakGridCost += gp.cost;
        } else if (gp.tariff === 'offPeak') {
          totalOffPeakGridKwh += gp.kwh;
          totalOffPeakGridCost += gp.cost;
          comp.offPeakGridKwh += gp.kwh;
          comp.offPeakGridCost += gp.cost;
        }

        const gPrev = globalGridProviderMap.get(gp.provider) || {
          provider: gp.provider,
          kwh: 0,
          cost: 0,
          hours: 0,
          peakKwh: 0,
          peakCost: 0,
          offPeakKwh: 0,
          offPeakCost: 0,
        };
        gPrev.kwh += gp.kwh;
        gPrev.cost += gp.cost;
        gPrev.hours += gpHrs;
        if (gp.tariff === 'peak') {
          gPrev.peakKwh += gp.kwh;
          gPrev.peakCost += gp.cost;
        } else if (gp.tariff === 'offPeak') {
          gPrev.offPeakKwh += gp.kwh;
          gPrev.offPeakCost += gp.cost;
        }
        globalGridProviderMap.set(gp.provider, gPrev);

        const cPrev = comp.gridProviders.get(gp.provider) || {
          provider: gp.provider,
          kwh: 0,
          cost: 0,
          hours: 0,
          peakKwh: 0,
          peakCost: 0,
          offPeakKwh: 0,
          offPeakCost: 0,
        };
        cPrev.kwh += gp.kwh;
        cPrev.cost += gp.cost;
        cPrev.hours += gpHrs;
        if (gp.tariff === 'peak') {
          cPrev.peakKwh += gp.kwh;
          cPrev.peakCost += gp.cost;
        } else if (gp.tariff === 'offPeak') {
          cPrev.offPeakKwh += gp.kwh;
          cPrev.offPeakCost += gp.cost;
        }
        comp.gridProviders.set(gp.provider, cPrev);
      }

      byCompany.set(item.company, comp);

      const bucketKey =
        trendGranularity === 'monthly' ? item.date.slice(0, 7) : item.date;
      const bucket = byTimeBucket.get(bucketKey) || {
        date: bucketKey,
        label:
          trendGranularity === 'monthly'
            ? formatMonthLabel(bucketKey)
            : formatShortDate(bucketKey),
        steamKg: 0,
        generatorKwh: 0,
        solarKwh: 0,
        gridKwh: 0,
      };
      bucket.steamKg += item.steamKg;
      bucket.generatorKwh += item.generatorKwh;
      bucket.solarKwh += item.solarKwh;
      byTimeBucket.set(bucketKey, bucket);
    }

    let totalBoilers = 0;
    let totalGenerators = 0;
    let totalDieselGenerators = 0;
    let totalGasGenerators = 0;
    let totalSolarSystems = 0;
    for (const [compName, latest] of latestByCompany.entries()) {
      totalBoilers += latest.boilerCount;
      totalGenerators += latest.generatorCount;
      totalDieselGenerators += latest.dieselGeneratorCount || 0;
      totalGasGenerators += latest.gasGeneratorCount || 0;
      totalSolarSystems += latest.solarSystemCount;
      const comp = byCompany.get(compName);
      if (comp) {
        comp.boilerCount = latest.boilerCount;
        comp.generatorCount = latest.generatorCount;
        comp.dieselGeneratorCount = latest.dieselGeneratorCount || 0;
        comp.gasGeneratorCount = latest.gasGeneratorCount || 0;
        comp.solarSystemCount = latest.solarSystemCount;
      }
    }

    const totalPlantPowerKwh = totalGridKwh + totalGenKwh + totalSolarKwh;
    const solarSharePct =
      totalPlantPowerKwh > 0 ? (totalSolarKwh / totalPlantPowerKwh) * 100 : 0;
    const genSharePct =
      totalPlantPowerKwh > 0 ? (totalGenKwh / totalPlantPowerKwh) * 100 : 0;
    const gridSharePct =
      totalPlantPowerKwh > 0 ? (totalGridKwh / totalPlantPowerKwh) * 100 : 0;

    const topBoilerFuelUnit =
      Array.from(boilerUnitCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      Array.from(boilerFuelByUnitGlobal.keys())[0] ||
      'm³';
    const topGenFuelUnit =
      Array.from(genUnitCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      Array.from(genFuelByUnitGlobal.keys())[0] ||
      'm³';

    const gridProviderTotals = Array.from(globalGridProviderMap.values()).sort(
      (a, b) => b.kwh - a.kwh
    );

    const finalizeBoilerUnits = (map: Map<string, BoilerAgg>) =>
      Array.from(map.values())
        .sort((a, b) => a.unitIndex - b.unitIndex)
        .map((b) => ({
          ...b,
          costPerKg:
            b.steamKg > 0 && b.fuelCost > 0 ? b.fuelCost / b.steamKg : null,
          yieldPerFuel:
            b.fuelMode !== 'dual' && b.steamKg > 0 && b.fuelQty > 0
              ? b.steamKg / b.fuelQty
              : null,
          steamPerHour: b.hours > 0 && b.steamKg > 0 ? b.steamKg / b.hours : null,
          fuelPerHour: b.hours > 0 && b.fuelQty > 0 ? b.fuelQty / b.hours : null,
        }));

    const finalizeGenUnits = (map: Map<string, GenAgg>) =>
      Array.from(map.values())
        .sort((a, b) => a.unitIndex - b.unitIndex)
        .map((g) => ({
          ...g,
          costPerKwh:
            g.kwh > 0 && g.fuelCost > 0 ? g.fuelCost / g.kwh : null,
          yieldPerFuel:
            g.fuelMode !== 'dual' && g.kwh > 0 && g.fuelQty > 0
              ? g.kwh / g.fuelQty
              : null,
          avgKw: g.hours > 0 && g.kwh > 0 ? g.kwh / g.hours : null,
          fuelPerHour: g.hours > 0 && g.fuelQty > 0 ? g.fuelQty / g.hours : null,
        }));

    const finalizeSolarUnits = (map: Map<string, SolarAgg>) =>
      Array.from(map.values())
        .sort((a, b) => a.unitIndex - b.unitIndex)
        .map((s) => ({
          ...s,
          avgKw: s.hours > 0 && s.kwh > 0 ? s.kwh / s.hours : null,
        }));

    const factoryRows = Array.from(byCompany.values())
      .filter((r) => r.logCount > 0 || r.gridKwh > 0)
      .map((r) => {
        const totalPower = r.gridKwh + r.generatorKwh + r.solarKwh;
        const boilerHasSingleFuel = r.boilerFuelByUnit.size <= 1;
        const genHasSingleFuel = r.genFuelByUnit.size <= 1;
        return {
          ...r,
          totalPower,
          steamCostPerKg:
            r.steamKg > 0 && r.boilerFuelCost > 0
              ? r.boilerFuelCost / r.steamKg
              : null,
          steamPerHour:
            r.boilerHours > 0 && r.steamKg > 0
              ? r.steamKg / r.boilerHours
              : null,
          steamYield:
            boilerHasSingleFuel && r.steamKg > 0 && r.boilerFuelQty > 0
              ? r.steamKg / r.boilerFuelQty
              : null,
          boilerFuelSummary: Array.from(r.boilerFuelByUnit.entries()).map(
            ([unit, qty]) => ({ unit, qty })
          ),
          boilerUnits: finalizeBoilerUnits(r.boilerUnitsMap),
          genCostPerKwh:
            r.generatorKwh > 0 && r.generatorFuelCost > 0
              ? r.generatorFuelCost / r.generatorKwh
              : null,
          genAvgKw:
            r.generatorHours > 0 && r.generatorKwh > 0
              ? r.generatorKwh / r.generatorHours
              : null,
          dieselCostPerKwh:
            r.dieselGenKwh > 0 && r.dieselFuelCost > 0
              ? r.dieselFuelCost / r.dieselGenKwh
              : null,
          gasCostPerKwh:
            r.gasGenKwh > 0 && r.gasFuelCost > 0
              ? r.gasFuelCost / r.gasGenKwh
              : null,
          genFuelSummary: Array.from(r.genFuelByUnit.entries()).map(
            ([unit, qty]) => ({ unit, qty })
          ),
          generatorUnits: finalizeGenUnits(r.generatorUnitsMap),
          dieselUnits: finalizeGenUnits(r.dieselUnitsMap),
          gasUnits: finalizeGenUnits(r.gasUnitsMap),
          solarUnits: finalizeSolarUnits(r.solarUnitsMap),
          solarAvgKw:
            r.solarHours > 0 && r.solarKwh > 0
              ? r.solarKwh / r.solarHours
              : null,
          genYield:
            genHasSingleFuel && r.generatorKwh > 0 && r.generatorFuelQty > 0
              ? r.generatorKwh / r.generatorFuelQty
              : null,
          solarSharePct: totalPower > 0 ? (r.solarKwh / totalPower) * 100 : 0,
          gridProvidersSummary: Array.from(r.gridProviders.values()).sort(
            (a, b) => b.kwh - a.kwh
          ),
        };
      })
      .sort((a, b) => b.steamKg + b.totalPower - (a.steamKg + a.totalPower));

    const boilerFactoryRows = factoryRows.filter((r) => r.boilerUnits.length > 0);
    const singleScopeBoilerUnits =
      boilerFactoryRows.length === 1 ? boilerFactoryRows[0].boilerUnits : [];

    const genFactoryRows = factoryRows.filter((r) => r.generatorUnits.length > 0);
    const singleScopeGeneratorUnits =
      genFactoryRows.length === 1 ? genFactoryRows[0].generatorUnits : [];

    const solarFactoryRows = factoryRows.filter((r) => r.solarUnits.length > 0);
    const singleScopeSolarUnits =
      solarFactoryRows.length === 1 ? solarFactoryRows[0].solarUnits : [];

    const dieselFactoryRows = factoryRows.filter((r) => r.dieselUnits.length > 0);
    const singleScopeDieselUnits =
      dieselFactoryRows.length === 1 ? dieselFactoryRows[0].dieselUnits : [];

    const gasFactoryRows = factoryRows.filter((r) => r.gasUnits.length > 0);
    const singleScopeGasUnits =
      gasFactoryRows.length === 1 ? gasFactoryRows[0].gasUnits : [];

    const trendPoints = Array.from(byTimeBucket.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    let prevSteamKg = 0;
    let prevGenKwh = 0;
    let prevSolarKwh = 0;
    for (const item of comparisonGenerationEntries) {
      prevSteamKg += item.steamKg;
      prevGenKwh += item.generatorKwh;
      prevSolarKwh += item.solarKwh;
    }

    const boilerFuelBreakdown = Array.from(boilerFuelByUnitGlobal.entries()).map(
      ([unit, qty]) => ({ unit, qty })
    );
    const genFuelBreakdown = Array.from(genFuelByUnitGlobal.entries()).map(
      ([unit, qty]) => ({ unit, qty })
    );

    return {
      hasRecords: filteredGenerationEntries.length > 0,
      recordCount: filteredGenerationEntries.length,
      totalBoilers,
      totalGenerators,
      totalDieselGenerators,
      totalGasGenerators,
      totalSolarSystems,
      totalBoilerHours,
      totalSteamKg,
      totalBoilerFuelQty,
      totalBoilerFuelCost,
      boilerFuelBreakdown,
      topBoilerFuelUnit,
      singleScopeBoilerUnits,
      allBoilerUnits: finalizeBoilerUnits(globalBoilerUnitsMap),
      avgSteamPerHour:
        totalBoilerHours > 0 && totalSteamKg > 0
          ? totalSteamKg / totalBoilerHours
          : null,
      avgSteamCostPerKg:
        totalSteamKg > 0 && totalBoilerFuelCost > 0
          ? totalBoilerFuelCost / totalSteamKg
          : null,
      avgSteamYield:
        boilerFuelByUnitGlobal.size <= 1 &&
        totalSteamKg > 0 &&
        totalBoilerFuelQty > 0
          ? totalSteamKg / totalBoilerFuelQty
          : null,
      totalGenHours,
      totalGenKwh,
      totalGenFuelQty,
      totalGenFuelCost,
      genFuelBreakdown,
      singleScopeGeneratorUnits,
      allGenUnits: finalizeGenUnits(globalGenUnitsMap),
      avgGenKw:
        totalGenHours > 0 && totalGenKwh > 0
          ? totalGenKwh / totalGenHours
          : null,
      totalDieselGenKwh,
      totalDieselFuelQty,
      totalDieselFuelCost,
      avgDieselCostPerKwh:
        totalDieselGenKwh > 0 && totalDieselFuelCost > 0
          ? totalDieselFuelCost / totalDieselGenKwh
          : null,
      singleScopeDieselUnits,
      totalGasGenKwh,
      totalGasFuelQty,
      totalGasFuelCost,
      avgGasCostPerKwh:
        totalGasGenKwh > 0 && totalGasFuelCost > 0
          ? totalGasFuelCost / totalGasGenKwh
          : null,
      singleScopeGasUnits,
      topGenFuelUnit,
      avgGenCostPerKwh:
        totalGenKwh > 0 && totalGenFuelCost > 0
          ? totalGenFuelCost / totalGenKwh
          : null,
      avgGenYield:
        genFuelByUnitGlobal.size <= 1 && totalGenKwh > 0 && totalGenFuelQty > 0
          ? totalGenKwh / totalGenFuelQty
          : null,
      totalSolarHours,
      totalSolarKwh,
      totalSolarSavings,
      singleScopeSolarUnits,
      allSolarUnits: finalizeSolarUnits(globalSolarUnitsMap),
      avgSolarKw:
        totalSolarHours > 0 && totalSolarKwh > 0
          ? totalSolarKwh / totalSolarHours
          : null,
      totalGridKwh,
      totalGridHours,
      avgGridKw:
        totalGridHours > 0 && totalGridKwh > 0
          ? totalGridKwh / totalGridHours
          : null,
      totalPeakGridKwh,
      totalPeakGridCost,
      avgPeakGridRate:
        totalPeakGridKwh > 0 && totalPeakGridCost > 0
          ? totalPeakGridCost / totalPeakGridKwh
          : null,
      totalOffPeakGridKwh,
      totalOffPeakGridCost,
      avgOffPeakGridRate:
        totalOffPeakGridKwh > 0 && totalOffPeakGridCost > 0
          ? totalOffPeakGridCost / totalOffPeakGridKwh
          : null,
      gridProviderTotals,
      totalPlantPowerKwh,
      solarSharePct,
      genSharePct,
      gridSharePct,
      steamDeltaPct:
        comparisonGenerationEntries.length > 0 && prevSteamKg > 0
          ? ((totalSteamKg - prevSteamKg) / prevSteamKg) * 100
          : null,
      genDeltaPct:
        comparisonGenerationEntries.length > 0 && prevGenKwh > 0
          ? ((totalGenKwh - prevGenKwh) / prevGenKwh) * 100
          : null,
      solarDeltaPct:
        comparisonGenerationEntries.length > 0 && prevSolarKwh > 0
          ? ((totalSolarKwh - prevSolarKwh) / prevSolarKwh) * 100
          : null,
      factoryRows,
      trendPoints,
    };
  }, [
    filteredGenerationEntries,
    comparisonGenerationEntries,
    visibleCompanyNames,
    selectedCompany,
    electricityUtility,
    visibleEntries,
    dateBounds,
    trendGranularity,
  ]);

  const powerMixFactoryRows = useMemo(
    () => generationAnalytics.factoryRows.filter((r) => r.totalPower > 0),
    [generationAnalytics.factoryRows]
  );

  const hourlyConsumptionAnalytics = useMemo(() => {
    const totalPlantEquipmentHours =
      generationAnalytics.totalBoilerHours +
      generationAnalytics.totalGenHours +
      generationAnalytics.totalSolarHours;
    const totalAssetHours = kpis.totalUtilityHours + totalPlantEquipmentHours;
    const blendedCostPerHour =
      totalAssetHours > 0 && kpis.totalCost > 0
        ? kpis.totalCost / totalAssetHours
        : null;

    type HourlyAssetRow = {
      id: string;
      category: 'Utility' | 'Boiler' | 'Generator' | 'Solar';
      name: string;
      color: string;
      quantity: number;
      unit: string;
      hours: number;
      hourlyRate: number | null;
      hourlyRateLabel: string;
      cost: number;
      costPerHour: number | null;
    };

    const rows: HourlyAssetRow[] = [];

    for (const u of kpis.utilityBreakdown) {
      if (u.hours <= 0 && u.consumption <= 0 && u.cost <= 0) continue;
      rows.push({
        id: `util_${u.id}`,
        category: 'Utility',
        name: u.name,
        color: u.color,
        quantity: u.consumption,
        unit: u.unit || 'unit',
        hours: u.hours,
        hourlyRate: u.avgHourlyRate,
        hourlyRateLabel:
          u.avgHourlyRate !== null
            ? `${formatNumber(u.avgHourlyRate, 2)} ${u.unit}/hr`
            : '—',
        cost: u.cost,
        costPerHour: u.costPerHour,
      });
    }

    if (canViewPlantGeneration && selectedUtilityId === 'ALL') {
      if (generationAnalytics.allBoilerUnits.length > 0) {
        for (const b of generationAnalytics.allBoilerUnits) {
          if (b.hours <= 0 && b.steamKg <= 0 && b.fuelCost <= 0) continue;
          rows.push({
            id: `boiler_${b.key}`,
            category: 'Boiler',
            name: b.deviceName,
            color: '#EA580C',
            quantity: b.steamKg,
            unit: 'kg steam',
            hours: b.hours,
            hourlyRate: b.steamPerHour,
            hourlyRateLabel:
              b.steamPerHour !== null
                ? `${formatNumber(b.steamPerHour, 1)} kg/hr`
                : '—',
            cost: b.fuelCost,
            costPerHour:
              b.hours > 0 && b.fuelCost > 0 ? b.fuelCost / b.hours : null,
          });
        }
      } else if (
        generationAnalytics.totalBoilerHours > 0 ||
        generationAnalytics.totalSteamKg > 0
      ) {
        rows.push({
          id: 'boiler_combined',
          category: 'Boiler',
          name: 'All Boilers (Steam)',
          color: '#EA580C',
          quantity: generationAnalytics.totalSteamKg,
          unit: 'kg steam',
          hours: generationAnalytics.totalBoilerHours,
          hourlyRate: generationAnalytics.avgSteamPerHour,
          hourlyRateLabel:
            generationAnalytics.avgSteamPerHour !== null
              ? `${formatNumber(generationAnalytics.avgSteamPerHour, 1)} kg/hr`
              : '—',
          cost: generationAnalytics.totalBoilerFuelCost,
          costPerHour:
            generationAnalytics.totalBoilerHours > 0 &&
            generationAnalytics.totalBoilerFuelCost > 0
              ? generationAnalytics.totalBoilerFuelCost /
                generationAnalytics.totalBoilerHours
              : null,
        });
      }

      if (generationAnalytics.allGenUnits.length > 0) {
        for (const g of generationAnalytics.allGenUnits) {
          if (g.hours <= 0 && g.kwh <= 0 && g.fuelCost <= 0) continue;
          rows.push({
            id: `gen_${g.key}`,
            category: 'Generator',
            name: g.deviceName,
            color: '#D97706',
            quantity: g.kwh,
            unit: 'kWh',
            hours: g.hours,
            hourlyRate: g.avgKw,
            hourlyRateLabel:
              g.avgKw !== null ? `${formatNumber(g.avgKw, 1)} kW` : '—',
            cost: g.fuelCost,
            costPerHour:
              g.hours > 0 && g.fuelCost > 0 ? g.fuelCost / g.hours : null,
          });
        }
      } else if (
        generationAnalytics.totalGenHours > 0 ||
        generationAnalytics.totalGenKwh > 0
      ) {
        rows.push({
          id: 'gen_combined',
          category: 'Generator',
          name: 'Captive Generators',
          color: '#D97706',
          quantity: generationAnalytics.totalGenKwh,
          unit: 'kWh',
          hours: generationAnalytics.totalGenHours,
          hourlyRate: generationAnalytics.avgGenKw,
          hourlyRateLabel:
            generationAnalytics.avgGenKw !== null
              ? `${formatNumber(generationAnalytics.avgGenKw, 1)} kW`
              : '—',
          cost: generationAnalytics.totalGenFuelCost,
          costPerHour:
            generationAnalytics.totalGenHours > 0 &&
            generationAnalytics.totalGenFuelCost > 0
              ? generationAnalytics.totalGenFuelCost /
                generationAnalytics.totalGenHours
              : null,
        });
      }

      if (generationAnalytics.allSolarUnits.length > 0) {
        for (const s of generationAnalytics.allSolarUnits) {
          if (s.hours <= 0 && s.kwh <= 0) continue;
          rows.push({
            id: `solar_${s.key}`,
            category: 'Solar',
            name: s.deviceName,
            color: '#059669',
            quantity: s.kwh,
            unit: 'kWh',
            hours: s.hours,
            hourlyRate: s.avgKw,
            hourlyRateLabel:
              s.avgKw !== null ? `${formatNumber(s.avgKw, 1)} kW` : '—',
            cost: 0,
            costPerHour: null,
          });
        }
      } else if (
        generationAnalytics.totalSolarHours > 0 ||
        generationAnalytics.totalSolarKwh > 0
      ) {
        rows.push({
          id: 'solar_combined',
          category: 'Solar',
          name: 'Solar PV Array',
          color: '#059669',
          quantity: generationAnalytics.totalSolarKwh,
          unit: 'kWh',
          hours: generationAnalytics.totalSolarHours,
          hourlyRate: generationAnalytics.avgSolarKw,
          hourlyRateLabel:
            generationAnalytics.avgSolarKw !== null
              ? `${formatNumber(generationAnalytics.avgSolarKw, 1)} kW`
              : '—',
          cost: 0,
          costPerHour: null,
        });
      }
    }

    const chartRows = rows
      .filter((r) => r.hours > 0)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 12);

    return {
      totalUtilityHours: kpis.totalUtilityHours,
      totalPlantEquipmentHours,
      totalAssetHours,
      blendedCostPerHour,
      rows,
      chartRows,
    };
  }, [
    kpis.utilityBreakdown,
    kpis.totalUtilityHours,
    kpis.totalCost,
    generationAnalytics,
    canViewPlantGeneration,
    selectedUtilityId,
  ]);

  const validationSummary = useMemo(() => {
    const scopeCompanies =
      selectedCompany === 'ALL' ? visibleCompanyNames : [selectedCompany];
    const startBound =
      dateBounds.start === '0000-01-01'
        ? visibleEntries.reduce(
            (min, e) => (e.date < min ? e.date : min),
            todayISO
          )
        : dateBounds.start;
    const endBound =
      dateBounds.end === '9999-12-31' ? todayISO : dateBounds.end;

    return buildAnalyticsValidationSummary({
      filteredEntries,
      allVisibleEntries: visibleEntries,
      filteredGenerationEntries,
      utilities: visibleUtilities,
      visibleCompanies: scopeCompanies,
      startDate: startBound,
      endDate: endBound,
      todayISO,
    });
  }, [
    selectedCompany,
    visibleCompanyNames,
    dateBounds,
    visibleEntries,
    filteredEntries,
    filteredGenerationEntries,
    visibleUtilities,
    todayISO,
  ]);

  useEffect(() => {
    if (!canViewPlantGeneration && dashboardView === 'generation') {
      setDashboardView('overview');
    }
  }, [canViewPlantGeneration, dashboardView]);

  const tableRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return filteredEntries.filter((row) => {
      if (auditFilter !== 'all') {
        const rowIssues = validationSummary.entryIssuesMap.get(row.id) || [];
        if (auditFilter === 'exceptions') {
          if (rowIssues.length === 0) return false;
        } else if (auditFilter === 'zero_cost') {
          if (
            !rowIssues.some(
              (iss) =>
                iss.category === 'zero_cost' || iss.category === 'zero_consumption'
            )
          ) {
            return false;
          }
        } else if (
          !rowIssues.some(
            (iss) => iss.category === (auditFilter as ValidationCategory)
          )
        ) {
          return false;
        }
      }

      if (!q) return true;
      const uName = (
        utilityMap.get(row.utilityId)?.name || row.utilityName
      ).toLowerCase();
      return (
        row.company.toLowerCase().includes(q) ||
        uName.includes(q) ||
        row.date.includes(q) ||
        row.note.toLowerCase().includes(q) ||
        row.enteredByName.toLowerCase().includes(q)
      );
    });
  }, [
    filteredEntries,
    searchTerm,
    utilityMap,
    auditFilter,
    validationSummary.entryIssuesMap,
  ]);

  const handleSortBenchmark = (key: BenchmarkSortKey) => {
    if (benchmarkSortKey === key) {
      setBenchmarkSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setBenchmarkSortKey(key);
      setBenchmarkSortDir(key === 'company' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: BenchmarkSortKey) => {
    if (benchmarkSortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 inline ml-1" />;
    }
    return benchmarkSortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-teal-700 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-teal-700 inline ml-1" />
    );
  };

  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Factory',
      'Utility',
      'Consumption',
      'Unit',
      'Operating Hours (hr)',
      'Hourly Consumption Rate (Unit/hr)',
      'Cost (BDT)',
      'Unit Cost (BDT/Unit)',
      'Audit Status',
      'Audit Notes',
      'Note',
      'Entered By',
    ];
    const rows = tableRows.map((r) => {
      const meta = utilityMap.get(r.utilityId);
      const hrs = Number(r.operatingHours) || 0;
      const hourlyRate = hrs > 0 && r.consumption > 0 ? Number((r.consumption / hrs).toFixed(4)) : 0;
      const unitCost =
        r.consumption > 0 ? Number((r.cost / r.consumption).toFixed(4)) : 0;
      const rowIssues = validationSummary.entryIssuesMap.get(r.id) || [];
      const auditStatus = rowIssues.some((i) => i.severity === 'critical')
        ? 'Critical'
        : rowIssues.some((i) => i.severity === 'warning')
        ? 'Warning'
        : rowIssues.length > 0
        ? 'Info'
        : 'OK';
      const auditNotes = rowIssues.map((i) => i.title).join('; ');
      const escape = (v: string | number) =>
        `"${String(v).replace(/"/g, '""')}"`;
      return [
        escape(r.date),
        escape(r.company),
        escape(meta?.name || r.utilityName),
        escape(r.consumption),
        escape(meta?.unit || r.unit),
        escape(hrs),
        escape(hourlyRate),
        escape(r.cost),
        escape(unitCost),
        escape(auditStatus),
        escape(auditNotes),
        escape(r.note),
        escape(r.enteredByName),
      ].join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `utility-hub-${getTodayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (dataLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-16 bg-white border border-slate-200 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 bg-white border border-slate-200 rounded-xl"
            />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (profile?.role !== 'admin' && visibleCompanyNames.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto space-y-4">
        <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          No Factories Assigned for Viewing
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Your account currently has no factories enabled under{' '}
          <strong>View Factories</strong>. Please ask an administrator to assign
          factory view permissions in User Management.
        </p>
        {profile?.role === 'entry' &&
          (profile.companies || []).length > 0 &&
          onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('entry')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Go to Daily Data Entry
            </button>
          )}
      </div>
    );
  }

  if (
    profile?.role !== 'admin' &&
    userAllowedUtilitiesSet &&
    visibleUtilities.length === 0
  ) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto space-y-4">
        <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          No Utilities Assigned for Viewing
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Your account currently has no utilities enabled under{' '}
          <strong>Allowed Utilities</strong>. Please ask an administrator to select
          which utilities you can view in User Management.
        </p>
      </div>
    );
  }

  const horizontalChartHeight = Math.max(
    260,
    companyComparisonData.length * 42 + 44
  );
  const compareChartHeight = Math.max(
    250,
    compareChartData.length > 6 ? compareChartData.length * 40 + 44 : 280
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6">
        {/* Executive Filter & Compare Toolbar */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            {/* Date presets: Running Month default, then 7d, 30d, 1y, plus secondary */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              {(
                [
                  ['thisMonth', 'This Month'],
                  ['7d', '7 Days'],
                  ['30d', '30 Days'],
                  ['1y', '1 Year'],
                  ['lastMonth', 'Last Month'],
                  ['all', 'All Time'],
                  ['custom', 'Custom'],
                ] as [DatePreset, string][]
              ).map(([key, label]) => {
                const isSelected = preset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreset(key)}
                    className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'text-slate-900 font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {isSelected && (
                      <motion.span
                        layoutId="dashDatePresetPill"
                        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                        className="absolute inset-0 bg-white rounded-md shadow-sm"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Factory, Utility, Compare & Export Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                aria-label="Filter by factory"
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">
                  {profile?.role === 'admin'
                    ? `All Factories (${visibleCompanyNames.length})`
                    : `All Visible Factories (${visibleCompanyNames.length})`}
                </option>
                {visibleCompanyNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <select
                value={selectedUtilityId}
                onChange={(e) => setSelectedUtilityId(e.target.value)}
                aria-label="Filter by utility"
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">
                  {userAllowedUtilitiesSet
                    ? `All Allowed Utilities (${filterableUtilities.length})`
                    : 'All Utilities'}
                </option>
                {filterableUtilities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.unit})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setCompareOpen((prev) => !prev)}
                aria-pressed={compareOpen}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  compareOpen
                    ? 'bg-teal-700 border-teal-700 text-white hover:bg-teal-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <GitCompareArrows className="w-4 h-4" />
                {compareOpen ? 'Comparing' : 'Compare'}
              </button>

              {hasNonDefaultFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}

              {profile?.role === 'admin' && filteredEntries.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
              )}

              {canSyncSheets && (
                <button
                  type="button"
                  disabled={syncingSheets}
                  onClick={() => void handleOpenSyncSheets()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {syncingSheets ? 'Syncing...' : 'Sync Sheets'}
                </button>
              )}

              {profile?.role === 'admin' &&
                sheetsConfig &&
                sheetsConfig.spreadsheetUrl && (
                  <a
                    href={sheetsConfig.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Sheet
                  </a>
                )}
            </div>
          </div>

          {/* Active Window Metadata */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              <span className="font-medium text-slate-700">{dateBounds.label}</span>
              {activeComparisonBounds && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {compareOpen ? 'Comparing with ' : 'Baseline: '}
                    <span className="font-medium text-slate-700">
                      {activeComparisonBounds.label}
                    </span>
                  </span>
                </>
              )}
            </div>
            <div className="tabular-nums">
              {formatNumber(visibleCompanyNames.length, 0)}{' '}
              {visibleCompanyNames.length === 1 ? 'factory' : 'factories'} in scope
            </div>
          </div>

          {syncToast && (
            <div
              className={`p-3 rounded-lg border text-sm font-medium ${
                syncToast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {syncToast.text}
            </div>
          )}

          {preset === 'custom' && (
            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="dash-start" className="text-xs text-slate-600">
                  Start Date:
                </label>
                <input
                  id="dash-start"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="dash-end" className="text-xs text-slate-600">
                  End Date:
                </label>
                <input
                  id="dash-end"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              {isCustomRangeInverted && (
                <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                  <span>Start date is after end date (showing swapped range).</span>
                  <button
                    type="button"
                    onClick={() => {
                      const prevStart = customStart;
                      setCustomStart(customEnd);
                      setCustomEnd(prevStart);
                    }}
                    className="font-semibold text-teal-700 hover:underline cursor-pointer"
                  >
                    Swap Dates
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Animated Compare Configuration Bar */}
          <AnimatePresence initial={false}>
            {compareOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="pt-3.5 border-t border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700 mr-1">
                    Compare against:
                  </span>
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        ...(preset !== 'all' && preset !== 'custom'
                          ? [['auto', 'Previous Period']]
                          : []),
                        ['day', 'Custom Day'],
                        ['month', 'Custom Month'],
                        ['year', 'Custom Year'],
                        ['range', 'Custom Range'],
                      ] as [CompareMode, string][]
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCompareMode(mode)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          compareMode === mode
                            ? 'bg-white text-teal-800 shadow-sm font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {compareMode === 'day' && (
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="compare-day"
                        className="text-xs text-slate-600"
                      >
                        Day:
                      </label>
                      <input
                        id="compare-day"
                        type="date"
                        value={compareDay}
                        max={todayISO}
                        onChange={(e) => {
                          if (e.target.value) setCompareDay(e.target.value);
                        }}
                        className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  )}

                  {compareMode === 'month' && (
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="compare-month"
                        className="text-xs text-slate-600"
                      >
                        Month:
                      </label>
                      <input
                        id="compare-month"
                        type="month"
                        value={compareMonth}
                        max={currentMonthKey}
                        onChange={(e) => {
                          if (e.target.value) setCompareMonth(e.target.value);
                        }}
                        className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  )}

                  {compareMode === 'year' && (
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="compare-year"
                        className="text-xs text-slate-600"
                      >
                        Year:
                      </label>
                      <select
                        id="compare-year"
                        value={compareYear}
                        onChange={(e) => setCompareYear(e.target.value)}
                        className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {availableYears.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {compareMode === 'range' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        aria-label="Compare start date"
                        value={compareRangeStart}
                        onChange={(e) => setCompareRangeStart(e.target.value)}
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="date"
                        aria-label="Compare end date"
                        value={compareRangeEnd}
                        onChange={(e) => setCompareRangeEnd(e.target.value)}
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                      {isCompareRangeInverted && (
                        <button
                          type="button"
                          onClick={() => {
                            const s = compareRangeStart;
                            setCompareRangeStart(compareRangeEnd);
                            setCompareRangeEnd(s);
                          }}
                          className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                        >
                          Swap
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setCompareOpen(false)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Close Compare
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Empty State */}
        {visibleEntries.length === 0 && visibleGenerationEntries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              No Utility Entries Recorded Yet
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              Once daily electricity, gas, water, or diesel consumption and cost
              entries are logged for your visible factories, unit cost analytics
              and interactive charts will appear here.
            </p>
            {(profile?.role === 'admin' || profile?.role === 'entry') &&
              onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('entry')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  Log First Entry
                </button>
              )}
          </div>
        ) : (
          <>
            {/* Executive KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.02, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">
                      Total Utility Spend
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                      {formatNumber(kpis.recordCount, 0)} entries
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                    <AnimatedMetric
                      value={kpis.totalCost}
                      formatter={formatCurrency}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
                    {kpis.costDeltaPct !== null ? (
                      <>
                        {kpis.costDeltaPct >= 0 ? (
                          <TrendingUp className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        )}
                        <span
                          className={
                            kpis.costDeltaPct >= 0
                              ? 'text-rose-700 font-medium tabular-nums truncate'
                              : 'text-emerald-700 font-medium tabular-nums truncate'
                          }
                        >
                          {kpis.costDeltaPct >= 0 ? '+' : ''}
                          {formatPercent(kpis.costDeltaPct)} vs{' '}
                          {comparisonStats?.bounds.label || 'prev'}
                        </span>
                      </>
                    ) : (
                      <span>Spend breakdown by utility</span>
                    )}
                  </div>
                </div>

                {kpis.utilityBreakdown.some((u) => u.cost > 0) && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 max-h-36 overflow-y-auto pr-0.5">
                    {kpis.utilityBreakdown
                      .filter((u) => u.cost > 0)
                      .sort((a, b) => b.cost - a.cost)
                      .map((u) => (
                        <div
                          key={u.id}
                          className="flex items-center justify-between gap-2 text-xs tabular-nums"
                        >
                          <span className="inline-flex items-center gap-1.5 text-slate-600 truncate">
                            <span
                              className="w-2 h-2 rounded-sm shrink-0"
                              style={{ backgroundColor: u.color }}
                            />
                            <span className="truncate">{u.name}</span>
                          </span>
                          <span className="font-semibold text-slate-900 shrink-0">
                            {formatCurrency(u.cost)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.06, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">
                      Daily Burn &amp; Runtime
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                      {formatNumber(kpis.activeDaysCount, 0)}{' '}
                      {kpis.activeDaysCount === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                    <AnimatedMetric
                      value={kpis.dailyAvg}
                      formatter={formatCurrency}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500 tabular-nums truncate">
                    {kpis.dailyAvgDeltaPct !== null && compareOpen ? (
                      <span
                        className={
                          kpis.dailyAvgDeltaPct >= 0
                            ? 'text-rose-700 font-medium'
                            : 'text-emerald-700 font-medium'
                        }
                      >
                        {kpis.dailyAvgDeltaPct >= 0 ? '+' : ''}
                        {formatPercent(kpis.dailyAvgDeltaPct)} daily avg vs{' '}
                        {comparisonStats?.bounds.label}
                      </span>
                    ) : (
                      <>
                        {formatNumber(kpis.activeCompaniesCount, 0)} of{' '}
                        {formatNumber(
                          selectedCompany === 'ALL' ? visibleCompanyNames.length : 1,
                          0
                        )}{' '}
                        factories active
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                    Asset Run Hrs
                  </span>
                  <span className="font-semibold text-slate-900">
                    {hourlyConsumptionAnalytics.totalAssetHours > 0 ? (
                      <>
                        {formatNumber(hourlyConsumptionAnalytics.totalAssetHours, 1)} hrs
                        {hourlyConsumptionAnalytics.blendedCostPerHour !== null && (
                          <span className="text-teal-800 ml-1.5">
                            · ৳{formatNumber(hourlyConsumptionAnalytics.blendedCostPerHour, 0)}/hr
                          </span>
                        )}
                      </>
                    ) : (
                      '0 hrs logged'
                    )}
                  </span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.1, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5"
              >
                {singleSelectedUtil ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500">
                        {singleSelectedUtil.name} · Unit Rate &amp; Intensity
                      </span>
                      <span className="text-[11px] font-semibold text-teal-800 tabular-nums">
                        {kpis.utilityBreakdown[0]?.avgUnitCost !== null &&
                        kpis.utilityBreakdown[0]?.avgUnitCost !== undefined
                          ? `৳ ${formatNumber(
                              kpis.utilityBreakdown[0].avgUnitCost,
                              2
                            )}/${singleSelectedUtil.unit}`
                          : '—'}
                      </span>
                    </div>
                    {kpis.utilityBreakdown[0]?.avgHourlyRate !== null &&
                    kpis.utilityBreakdown[0]?.avgHourlyRate !== undefined && (
                      <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
                        {formatNumber(kpis.utilityBreakdown[0].avgHourlyRate, 2)}{' '}
                        {singleSelectedUtil.unit}/hr
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          ({formatNumber(kpis.utilityBreakdown[0].hours, 1)} hrs)
                        </span>
                      </div>
                    )}
                    {kpis.utilityBreakdown[0]?.highestCompany ? (
                      <div className="mt-2.5 space-y-1.5 text-xs tabular-nums">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-rose-700 font-medium truncate">
                            High: {kpis.utilityBreakdown[0].highestCompany.company}
                          </span>
                          <span className="font-bold text-slate-900 shrink-0">
                            {formatCurrency(
                              kpis.utilityBreakdown[0].highestCompany.cost
                            )}
                          </span>
                        </div>
                        {kpis.utilityBreakdown[0].lowestCompany ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-emerald-700 font-medium truncate">
                              Low: {kpis.utilityBreakdown[0].lowestCompany.company}
                            </span>
                            <span className="font-bold text-slate-900 shrink-0">
                              {formatCurrency(
                                kpis.utilityBreakdown[0].lowestCompany.cost
                              )}
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">
                            Only 1 factory logged in this period
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-400">No data</div>
                    )}
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 tabular-nums truncate">
                      {kpis.utilityBreakdown[0]?.minUnitCost !== null &&
                      kpis.utilityBreakdown[0]?.maxUnitCost !== null
                        ? `Rate Spread: ৳${formatNumber(
                            kpis.utilityBreakdown[0].minUnitCost,
                            2
                          )} – ৳${formatNumber(
                            kpis.utilityBreakdown[0].maxUnitCost,
                            2
                          )}/${singleSelectedUtil.unit}`
                        : `Total: ${formatNumber(
                            kpis.utilityBreakdown[0]?.consumption || 0
                          )} ${singleSelectedUtil.unit}`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500">
                        Factory High &amp; Low by Energy
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Per utility
                      </span>
                    </div>
                    {kpis.utilityBreakdown.some((u) => u.highestCompany !== null) ? (
                      <div className="mt-2.5 space-y-2 max-h-48 overflow-y-auto pr-0.5">
                        {kpis.utilityBreakdown
                          .filter((u) => u.highestCompany !== null)
                          .map((u) => (
                            <div
                              key={u.id}
                              className="pb-2 border-b border-slate-100 last:border-b-0 last:pb-0 space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 truncate">
                                  <span
                                    className="w-2 h-2 rounded-sm shrink-0"
                                    style={{ backgroundColor: u.color }}
                                  />
                                  {u.name}
                                </span>
                                {u.avgUnitCost !== null && (
                                  <span className="text-[11px] font-medium text-teal-800 tabular-nums shrink-0">
                                    ৳{formatNumber(u.avgUnitCost, 2)}/{u.unit}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                                <span className="text-rose-700 truncate">
                                  High: <strong>{u.highestCompany!.company}</strong>
                                </span>
                                <span className="font-semibold text-slate-800 shrink-0">
                                  {formatCurrency(u.highestCompany!.cost)}
                                </span>
                              </div>
                              {u.lowestCompany ? (
                                <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                                  <span className="text-emerald-700 truncate">
                                    Low: <strong>{u.lowestCompany.company}</strong>
                                  </span>
                                  <span className="font-semibold text-slate-800 shrink-0">
                                    {formatCurrency(u.lowestCompany.cost)}
                                  </span>
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-400">
                                  1 factory logged
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-slate-400">
                        No energy records yet
                      </div>
                    )}
                  </>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.14, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    Top Factory &amp; Clean Solar Offset
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900 tabular-nums truncate">
                    {kpis.topCompany
                      ? `${kpis.topCompany.name} · ${formatCompactCurrency(
                          kpis.topCompany.cost
                        )}`
                      : '—'}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 tabular-nums truncate">
                    {kpis.topCompany
                      ? `${formatPercent(kpis.topCompany.sharePct)} of total`
                      : 'No factory data'}
                    {kpis.peakDay
                      ? ` · Peak ${formatShortDate(kpis.peakDay.date)}: ${formatCompactCurrency(
                          kpis.peakDay.cost
                        )}`
                      : ''}
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    Solar Saved
                  </span>
                  <span className="font-semibold text-emerald-800">
                    {generationAnalytics.totalSolarKwh > 0 ? (
                      <>
                        {formatCurrency(generationAnalytics.totalSolarSavings)}
                        <span className="text-slate-500 font-normal ml-1">
                          ({formatPercent(generationAnalytics.solarSharePct)} power)
                        </span>
                      </>
                    ) : (
                      '0 kWh solar'
                    )}
                  </span>
                </div>
              </motion.div>
            </div>

            {/* Executive Validation & Management Insights Strip */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.14, ease: EASE_OUT }}
              className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 tabular-nums">
                  {validationSummary.criticalCount > 0 ? (
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  ) : validationSummary.issues.length > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  )}
                  Data Quality: {formatNumber(validationSummary.healthScorePct, 0)}%
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="text-slate-600 tabular-nums">
                  Coverage:{' '}
                  <strong className="text-slate-900">
                    {formatPercent(validationSummary.coveragePct)}
                  </strong>{' '}
                  ({formatNumber(validationSummary.loggedFactoryDays, 0)}/
                  {formatNumber(validationSummary.expectedFactoryDays, 0)} factory-days)
                </span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="text-slate-600 tabular-nums">
                  Run Hrs Logged:{' '}
                  <strong className="text-slate-900">
                    {formatPercent(validationSummary.hoursCompletenessPct)}
                  </strong>
                </span>
                {validationSummary.issues.length > 0 ? (
                  <>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-amber-800 font-medium tabular-nums">
                      {formatNumber(validationSummary.issues.length, 0)} validation{' '}
                      {validationSummary.issues.length === 1 ? 'flag' : 'flags'}
                      {validationSummary.rateOutlierCount > 0
                        ? ` (${validationSummary.rateOutlierCount} rate variance)`
                        : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-emerald-700 font-medium">
                      All readings verified within normal baseline
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs shrink-0">
                {managementInsights.slice(0, 1).map((ins) => (
                  <span
                    key={ins.id}
                    className={
                      ins.tone === 'alert'
                        ? 'text-rose-700 font-medium'
                        : ins.tone === 'warning'
                        ? 'text-amber-700 font-medium'
                        : ins.tone === 'positive'
                        ? 'text-emerald-700 font-medium'
                        : 'text-slate-600'
                    }
                  >
                    {ins.text}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setAuditFilter(
                      validationSummary.issues.length > 0 ? 'exceptions' : 'all'
                    );
                    setDashboardView('audit');
                  }}
                  className="text-teal-700 font-semibold hover:underline whitespace-nowrap cursor-pointer"
                >
                  {validationSummary.issues.length > 0
                    ? `Audit ${validationSummary.issues.length} Flags →`
                    : 'Open Audit Ledger →'}
                </button>
              </div>
            </motion.div>

            {/* Interactive Period Comparison Spotlight (when Compare is active) */}
            <AnimatePresence initial={false}>
              {compareOpen && comparisonStats && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: EASE_OUT }}
                  className="bg-white border border-teal-200 rounded-xl p-5 sm:p-6 space-y-5"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Period Comparison — {dateBounds.label} vs{' '}
                        {comparisonStats.bounds.label}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Side-by-side total spend and normalized daily burn rate across factories and utilities
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['factory', 'By Factory'],
                            ['utility', 'By Utility'],
                          ] as const
                        ).map(([tabKey, label]) => {
                          const isSelected = compareChartTab === tabKey;
                          return (
                            <button
                              key={tabKey}
                              type="button"
                              onClick={() => setCompareChartTab(tabKey)}
                              className={`relative px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                                isSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="dashCompareTabPill"
                                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                  className="absolute inset-0 bg-white rounded-md shadow-sm"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="relative z-10">{label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['total', 'Total Spend'],
                            ['dailyAvg', 'Daily Avg'],
                          ] as const
                        ).map(([metricKey, label]) => {
                          const isSelected = compareMetric === metricKey;
                          return (
                            <button
                              key={metricKey}
                              type="button"
                              onClick={() => setCompareMetric(metricKey)}
                              className={`relative px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                                isSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="dashCompareMetricPill"
                                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                  className="absolute inset-0 bg-white rounded-md shadow-sm"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="relative z-10">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Comparison Summary Metrics */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Total Spend Delta
                      </div>
                      <div className="text-lg font-bold text-slate-900 tabular-nums">
                        {formatCurrency(kpis.totalCost)}
                        <span className="text-xs font-normal text-slate-500 ml-1.5">
                          vs {formatCompactCurrency(comparisonStats.totalCost)}
                        </span>
                      </div>
                      <div
                        className={`text-xs font-semibold tabular-nums ${
                          (kpis.costDeltaDiff || 0) >= 0
                            ? 'text-rose-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {comparisonStats.recordCount > 0 && kpis.costDeltaDiff !== null
                          ? `${kpis.costDeltaDiff >= 0 ? '+' : ''}${formatCurrency(
                              kpis.costDeltaDiff
                            )}${
                              kpis.costDeltaPct !== null
                                ? ` (${kpis.costDeltaPct >= 0 ? '+' : ''}${formatPercent(
                                    kpis.costDeltaPct
                                  )})`
                                : ''
                            }`
                          : 'No records in comparison period'}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Daily Avg Spend Delta
                      </div>
                      <div className="text-lg font-bold text-slate-900 tabular-nums">
                        {formatCurrency(kpis.dailyAvg)}
                        <span className="text-xs font-normal text-slate-500 ml-1.5">
                          vs {formatCompactCurrency(comparisonStats.dailyAvg)}
                        </span>
                      </div>
                      <div
                        className={`text-xs font-semibold tabular-nums ${
                          (kpis.dailyAvgDeltaDiff || 0) >= 0
                            ? 'text-rose-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {comparisonStats.recordCount > 0 &&
                        kpis.dailyAvgDeltaDiff !== null
                          ? `${kpis.dailyAvgDeltaDiff >= 0 ? '+' : ''}${formatCurrency(
                              kpis.dailyAvgDeltaDiff
                            )}/day${
                              kpis.dailyAvgDeltaPct !== null
                                ? ` (${
                                    kpis.dailyAvgDeltaPct >= 0 ? '+' : ''
                                  }${formatPercent(kpis.dailyAvgDeltaPct)})`
                                : ''
                            }`
                          : 'No baseline daily avg'}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Peak Day Comparison
                      </div>
                      <div className="text-lg font-bold text-slate-900 tabular-nums">
                        {kpis.peakDay ? formatCurrency(kpis.peakDay.cost) : '—'}
                      </div>
                      <div className="text-xs text-slate-600 tabular-nums">
                        Compare peak:{' '}
                        {comparisonStats.peakDay
                          ? `${formatCurrency(
                              comparisonStats.peakDay.cost
                            )} (${formatShortDate(comparisonStats.peakDay.date)})`
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Logged Coverage
                      </div>
                      <div className="text-lg font-bold text-slate-900 tabular-nums">
                        {formatNumber(kpis.activeDaysCount, 0)}d ·{' '}
                        {formatNumber(kpis.recordCount, 0)} rows
                      </div>
                      <div className="text-xs text-slate-600 tabular-nums">
                        Compare period: {formatNumber(comparisonStats.activeDaysCount, 0)}d ·{' '}
                        {formatNumber(comparisonStats.recordCount, 0)} rows
                      </div>
                    </div>
                  </div>

                  {/* Side-by-Side Comparison BarChart */}
                  {compareChartData.length === 0 ||
                  compareChartData.every((r) => r.current === 0 && r.previous === 0) ? (
                    <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No spend recorded in either comparison window for the active filter.
                    </div>
                  ) : (
                    <div className="max-h-[420px] overflow-y-auto pr-1">
                      <div style={{ height: compareChartHeight }} className="w-full">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <BarChart
                            data={compareChartData}
                            layout={compareChartData.length > 6 ? 'vertical' : 'horizontal'}
                            barCategoryGap="20%"
                            margin={{
                              top: 8,
                              right: 20,
                              left: 8,
                              bottom: compareChartData.length <= 6 && compareChartData.length > 3 ? 22 : 4,
                            }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            {compareChartData.length > 6 ? (
                              <>
                                <XAxis
                                  type="number"
                                  tickFormatter={(v) =>
                                    formatCompactCurrency(Number(v))
                                  }
                                  tick={{ fontSize: 11, fill: '#475569' }}
                                />
                                <YAxis
                                  type="category"
                                  dataKey="name"
                                  width={136}
                                  tickFormatter={(v) =>
                                    String(v).length > 18
                                      ? `${String(v).slice(0, 17)}…`
                                      : String(v)
                                  }
                                  tick={{ fontSize: 12, fill: '#0F172A' }}
                                />
                              </>
                            ) : (
                              <>
                                <XAxis
                                  dataKey="name"
                                  interval={0}
                                  angle={compareChartData.length > 3 ? -16 : 0}
                                  textAnchor={compareChartData.length > 3 ? 'end' : 'middle'}
                                  height={compareChartData.length > 3 ? 46 : 28}
                                  tickFormatter={(v) =>
                                    String(v).length > 16
                                      ? `${String(v).slice(0, 15)}…`
                                      : String(v)
                                  }
                                  tick={{ fontSize: 11, fill: '#334155' }}
                                />
                                <YAxis
                                  tickFormatter={(v) =>
                                    formatCompactCurrency(Number(v))
                                  }
                                  tick={{ fontSize: 11, fill: '#475569' }}
                                  width={64}
                                />
                              </>
                            )}
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const row = payload[0].payload as {
                                  name: string;
                                  current: number;
                                  previous: number;
                                  diff: number;
                                  pct: number | null;
                                };
                                return (
                                  <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1 min-w-[220px]">
                                    <div className="font-bold text-slate-900 pb-1 border-b border-slate-100">
                                      {row.name}
                                    </div>
                                    <div className="flex items-center justify-between gap-4 tabular-nums">
                                      <span className="text-teal-800 font-medium">
                                        Current ({dateBounds.label})
                                      </span>
                                      <span className="font-bold text-slate-900">
                                        {formatCurrency(row.current)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 tabular-nums">
                                      <span className="text-slate-600">
                                        Compare ({comparisonStats.bounds.label})
                                      </span>
                                      <span className="font-semibold text-slate-800">
                                        {formatCurrency(row.previous)}
                                      </span>
                                    </div>
                                    <div
                                      className={`pt-1 border-t border-slate-100 flex items-center justify-between font-semibold tabular-nums ${
                                        row.diff >= 0
                                          ? 'text-rose-700'
                                          : 'text-emerald-700'
                                      }`}
                                    >
                                      <span>Difference</span>
                                      <span>
                                        {row.diff >= 0 ? '+' : ''}
                                        {formatCurrency(row.diff)}
                                        {row.pct !== null
                                          ? ` (${row.pct >= 0 ? '+' : ''}${formatPercent(
                                              row.pct
                                            )})`
                                          : ''}
                                      </span>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Legend />
                            <Bar
                              dataKey="current"
                              name={`Current (${dateBounds.label})`}
                              fill="#0F766E"
                              maxBarSize={30}
                              minPointSize={2}
                              className={compareChartTab === 'factory' ? 'cursor-pointer' : undefined}
                              onClick={(data) => {
                                if (compareChartTab !== 'factory') return;
                                const d = data as { payload?: { name?: string }; name?: string };
                                const name = d?.payload?.name ?? d?.name;
                                if (name) {
                                  setSelectedCompany((prev) =>
                                    prev === name ? 'ALL' : name
                                  );
                                }
                              }}
                              radius={
                                compareChartData.length > 6
                                  ? [0, 3, 3, 0]
                                  : [3, 3, 0, 0]
                              }
                              animationDuration={450}
                            />
                            <Bar
                              dataKey="previous"
                              name={`Compare (${comparisonStats.bounds.label})`}
                              fill="#94A3B8"
                              maxBarSize={30}
                              minPointSize={2}
                              radius={
                                compareChartData.length > 6
                                  ? [0, 3, 3, 0]
                                  : [3, 3, 0, 0]
                              }
                              animationDuration={450}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Curated Workspace View Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'overview', label: 'Executive Overview' },
                    { id: 'hourly', label: 'Runtime & Hourly Intensity' },
                    ...(canViewPlantGeneration
                      ? [{ id: 'generation' as const, label: 'Plant Generation & Mix' }]
                      : []),
                    {
                      id: 'audit',
                      label:
                        validationSummary.issues.length > 0
                          ? `Data Quality & Ledger (${validationSummary.issues.length})`
                          : 'Data Quality & Ledger',
                    },
                  ] as Array<{ id: DashboardViewTab; label: string }>
                ).map((tab) => {
                  const isActive = dashboardView === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDashboardView(tab.id)}
                      className={`relative px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'text-slate-900 font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="dashWorkspaceTab"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          className="absolute inset-0 bg-white rounded-lg shadow-sm border border-slate-200/70"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="text-xs text-slate-500 tabular-nums">
                Showing <strong className="text-slate-800">{dateBounds.label}</strong>
                {selectedCompany !== 'ALL' && ` · ${selectedCompany}`}
                {singleSelectedUtil && ` · ${singleSelectedUtil.name}`}
              </div>
            </div>

            {dashboardView === 'overview' && (
            <motion.div
              key="view-overview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="space-y-6"
            >
            {/* Utility Performance & Unit Cost Matrix */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Utility Cost, Consumption &amp; Unit Rate Summary
                  </h3>
                  <p className="text-xs text-slate-500">
                    Weighted average cost per unit and observed min–max rate spread. Click a card to filter.
                  </p>
                </div>
                {selectedUtilityId !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setSelectedUtilityId('ALL')}
                    className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                  >
                    Show All Utilities
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                {kpis.utilityBreakdown.map((u) => {
                  const isSelected = selectedUtilityId === u.id;
                  const prevUtilCost = comparisonStats?.byUtility.get(u.id)?.cost ?? null;
                  const utilDeltaPct =
                    prevUtilCost !== null && prevUtilCost > 0
                      ? ((u.cost - prevUtilCost) / prevUtilCost) * 100
                      : null;

                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setSelectedUtilityId((prev) =>
                          prev === u.id ? 'ALL' : u.id
                        )
                      }
                      className={`text-left p-4 transition-colors cursor-pointer space-y-2.5 ${
                        isSelected
                          ? 'bg-teal-50/80'
                          : 'bg-white hover:bg-slate-50/90'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: u.color }}
                          />
                          <span className="text-sm font-bold text-slate-900 truncate">
                            {u.name}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 tabular-nums shrink-0">
                          {formatPercent(u.sharePct)}
                        </span>
                      </div>

                      <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: Math.min(1, Math.max(0, u.sharePct / 100)) }}
                          transition={{ duration: 0.45, ease: EASE_OUT }}
                          className="h-full w-full rounded-full origin-left"
                          style={{ backgroundColor: u.color }}
                        />
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold text-slate-900 tabular-nums">
                          {formatCurrency(u.cost)}
                        </span>
                        <span className="text-xs text-slate-600 tabular-nums">
                          {u.unit
                            ? `${formatNumber(u.consumption)} ${u.unit}`
                            : `${formatNumber(u.entryCount, 0)} logs`}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">
                          {u.unit ? 'Avg Rate' : 'Type'}
                        </span>
                        <span className="font-semibold text-teal-800 tabular-nums">
                          {u.avgUnitCost !== null && u.unit
                            ? `৳ ${formatNumber(u.avgUnitCost, 2)} / ${u.unit}`
                            : u.unit
                            ? '—'
                            : 'Plant Fuel'}
                        </span>
                      </div>

                      {u.hours > 0 && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-700 tabular-nums">
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Clock className="w-3 h-3 text-teal-700" />
                            {formatNumber(u.hours, 1)} Run Hrs
                          </span>
                          <span className="font-semibold text-slate-900">
                            {u.avgHourlyRate !== null
                              ? `${formatNumber(u.avgHourlyRate, 2)} ${u.unit}/hr`
                              : '—'}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 tabular-nums">
                        {u.minUnitCost !== null && u.maxUnitCost !== null ? (
                          <span>
                            ৳{formatNumber(u.minUnitCost, 2)} – ৳
                            {formatNumber(u.maxUnitCost, 2)}
                          </span>
                        ) : (
                          <span>
                            {u.unit ? 'No rate range' : 'Included in Total Spend'}
                          </span>
                        )}
                        {utilDeltaPct !== null && (
                          <span
                            className={`font-semibold ${
                              utilDeltaPct >= 0
                                ? 'text-rose-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {utilDeltaPct >= 0 ? '+' : ''}
                            {formatPercent(utilDeltaPct)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            </motion.div>
            )}

            {/* Operating Hours & Hourly Consumption Intensity (কতক্ষন সময়ে কত কনজাম্পশন) */}
            {dashboardView === 'hourly' && (
              <motion.div
                key="view-hourly"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-teal-700 shrink-0" />
                      Operating Hours &amp; Hourly Consumption Rate
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Run-time utilization and consumption intensity per operating hour (unit/hr, kg/hr, Avg kW, and ৳/hr burn rate)
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                    <span>
                      Utility Hrs:{' '}
                      <strong className="text-slate-900">
                        {formatNumber(hourlyConsumptionAnalytics.totalUtilityHours, 1)}h
                      </strong>
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span>
                      Equipment Hrs:{' '}
                      <strong className="text-slate-900">
                        {formatNumber(hourlyConsumptionAnalytics.totalPlantEquipmentHours, 1)}h
                      </strong>
                    </span>
                    {hourlyConsumptionAnalytics.blendedCostPerHour !== null && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-teal-800 font-semibold">
                          Blended Burn: ৳{formatNumber(hourlyConsumptionAnalytics.blendedCostPerHour, 0)}/hr
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Flattened Summary Metric Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                  <div className="p-4 bg-white space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Total Asset Run Hours</span>
                      <Clock className="w-3.5 h-3.5 text-teal-700" />
                    </div>
                    <div className="text-xl font-bold text-slate-900 tabular-nums">
                      {formatNumber(hourlyConsumptionAnalytics.totalAssetHours, 1)} hrs
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {hourlyConsumptionAnalytics.blendedCostPerHour !== null
                        ? `Avg ৳${formatNumber(hourlyConsumptionAnalytics.blendedCostPerHour, 2)} per asset-hr`
                        : 'Log Run Hrs in Daily Entry to track rate/hr'}
                    </div>
                  </div>

                  <div className="p-4 bg-white space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Boiler Steam Intensity</span>
                      <Flame className="w-3.5 h-3.5 text-orange-600" />
                    </div>
                    <div className="text-xl font-bold text-slate-900 tabular-nums">
                      {generationAnalytics.avgSteamPerHour !== null
                        ? `${formatNumber(generationAnalytics.avgSteamPerHour, 1)} kg/hr`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {generationAnalytics.totalBoilerHours > 0
                        ? `${formatNumber(generationAnalytics.totalBoilerHours, 1)} boiler run hrs`
                        : 'No boiler run hrs logged'}
                    </div>
                  </div>

                  <div className="p-4 bg-white space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Captive Generator Load</span>
                      <Activity className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                    <div className="text-xl font-bold text-slate-900 tabular-nums">
                      {generationAnalytics.avgGenKw !== null
                        ? `${formatNumber(generationAnalytics.avgGenKw, 1)} kW`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {generationAnalytics.totalGenHours > 0
                        ? `${formatNumber(generationAnalytics.totalGenHours, 1)} gen run hrs`
                        : 'No generator run hrs logged'}
                    </div>
                  </div>

                  <div className="p-4 bg-emerald-50/40 space-y-1">
                    <div className="flex items-center justify-between text-xs text-emerald-900">
                      <span>Grid &amp; Solar Avg Load</span>
                      <Sun className="w-3.5 h-3.5 text-emerald-700" />
                    </div>
                    <div className="text-xl font-bold text-emerald-950 tabular-nums">
                      {generationAnalytics.avgGridKw !== null || generationAnalytics.avgSolarKw !== null
                        ? [
                            generationAnalytics.avgGridKw !== null
                              ? `Grid ${formatNumber(generationAnalytics.avgGridKw, 1)} kW`
                              : null,
                            generationAnalytics.avgSolarKw !== null
                              ? `Solar ${formatNumber(generationAnalytics.avgSolarKw, 1)} kW`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : '—'}
                    </div>
                    <div className="text-[11px] text-emerald-800 tabular-nums">
                      {generationAnalytics.totalGridHours > 0 || generationAnalytics.totalSolarHours > 0
                        ? `Grid ${formatNumber(generationAnalytics.totalGridHours, 1)}h · Solar ${formatNumber(generationAnalytics.totalSolarHours, 1)}h`
                        : 'Log Grid / Solar hours to inspect kW load'}
                    </div>
                  </div>
                </div>

                {hourlyConsumptionAnalytics.rows.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500">
                    No consumption or operating hours logged for the current filters.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Run Hours Distribution Chart */}
                    <div className="lg:col-span-5 border border-slate-200 rounded-xl p-4">
                      <div className="mb-3">
                        <h4 className="text-sm font-bold text-slate-900">
                          Operating Hours by Utility &amp; Equipment
                        </h4>
                        <p className="text-xs text-slate-500">
                          Total logged runtime (hrs) in selected period
                        </p>
                      </div>

                      {hourlyConsumptionAnalytics.chartRows.length === 0 ? (
                        <div className="h-56 flex items-center justify-center text-xs text-slate-500 text-center px-4">
                          Enter Run Hours on Daily Data Entry to visualize hourly runtime and load intensity.
                        </div>
                      ) : (
                        <div
                          className="w-full"
                          style={{
                            height: Math.max(
                              220,
                              hourlyConsumptionAnalytics.chartRows.length * 36 + 32
                            ),
                          }}
                        >
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart
                              data={hourlyConsumptionAnalytics.chartRows}
                              layout="vertical"
                              barCategoryGap="20%"
                              margin={{ top: 4, right: 20, left: 6, bottom: 4 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                              <XAxis
                                type="number"
                                tickFormatter={(v) => `${formatNumber(Number(v), 0)}h`}
                                tick={{ fontSize: 11, fill: '#475569' }}
                              />
                              <YAxis
                                type="category"
                                dataKey="name"
                                width={138}
                                tickFormatter={(v) =>
                                  String(v).length > 18
                                    ? `${String(v).slice(0, 17)}…`
                                    : String(v)
                                }
                                tick={{ fontSize: 11, fill: '#0F172A' }}
                              />
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const row = payload[0].payload as (typeof hourlyConsumptionAnalytics.rows)[number];
                                  return (
                                    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1">
                                      <div className="font-bold text-slate-900">
                                        {row.name} ({row.category})
                                      </div>
                                      <div className="text-slate-700 tabular-nums">
                                        Run Time:{' '}
                                        <strong>{formatNumber(row.hours, 1)} hrs</strong>
                                      </div>
                                      <div className="text-slate-700 tabular-nums">
                                        Output/Usage:{' '}
                                        <strong>
                                          {formatNumber(row.quantity)} {row.unit}
                                        </strong>
                                      </div>
                                      <div className="text-teal-800 font-semibold tabular-nums">
                                        Hourly Rate: {row.hourlyRateLabel}
                                      </div>
                                    </div>
                                  );
                                }}
                              />
                              <Bar
                                dataKey="hours"
                                name="Run Hours"
                                maxBarSize={26}
                                minPointSize={3}
                                radius={[0, 4, 4, 0]}
                                animationDuration={450}
                              >
                                {hourlyConsumptionAnalytics.chartRows.map((entry) => (
                                  <Cell key={entry.id} fill={entry.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Hourly Consumption Intensity Ledger */}
                    <div className="lg:col-span-7 border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          Asset &amp; Utility Hourly Intensity Ledger
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {formatNumber(hourlyConsumptionAnalytics.rows.length, 0)} meters / units
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-[340px]">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wide sticky top-0">
                              <th className="py-2.5 px-4">Asset / Utility</th>
                              <th className="py-2.5 px-4 text-right">Total Output / Usage</th>
                              <th className="py-2.5 px-4 text-right">Run Hrs</th>
                              <th className="py-2.5 px-4 text-right">Hourly Rate</th>
                              <th className="py-2.5 px-4 text-right">Spend / Hr</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                            {hourlyConsumptionAnalytics.rows.map((r) => (
                              <tr key={r.id} className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-4 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                                      style={{ backgroundColor: r.color }}
                                    />
                                    <span className="font-semibold text-slate-900">
                                      {r.name}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      · {r.category}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                  {formatNumber(r.quantity)} {r.unit}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                  {r.hours > 0 ? `${formatNumber(r.hours, 1)} hr` : '—'}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-bold text-teal-800 whitespace-nowrap">
                                  {r.hourlyRateLabel}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                  {r.costPerHour !== null
                                    ? `৳ ${formatNumber(r.costPerHour, 1)}/hr`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Charts Grid (Executive Overview) */}
            {dashboardView === 'overview' && (
              <motion.div
                key="view-overview-charts"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.04, ease: EASE_OUT }}
              >
                {kpis.recordCount === 0 && kpis.totalCost === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                    No records match the selected filters. Try adjusting the date
                    range, factory, or utility filter.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Chart 1: Daily / Monthly Cost Trend */}
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        {singleSelectedUtil
                          ? `${
                              trendGranularity === 'monthly' ? 'Monthly' : 'Daily'
                            } ${singleSelectedUtil.name} Consumption & Cost`
                          : `${
                              trendGranularity === 'monthly' ? 'Monthly' : 'Daily'
                            } Utility Cost Trend (BDT)`}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {trendGranularity === 'monthly'
                          ? 'Month-by-month spend across selected utilities and factories'
                          : 'Day-by-day spend trajectory across selected utilities and factories'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                      {(
                        [
                          ['daily', 'Daily'],
                          ['monthly', 'Monthly'],
                        ] as const
                      ).map(([gKey, label]) => {
                        const isSelected = trendGranularity === gKey;
                        return (
                          <button
                            key={gKey}
                            type="button"
                            onClick={() => setTrendGranularity(gKey)}
                            className={`relative px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                              isSelected
                                ? 'text-slate-900 font-semibold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {isSelected && (
                              <motion.span
                                layoutId="dashTrendGranularityPill"
                                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                className="absolute inset-0 bg-white rounded-md shadow-sm"
                                aria-hidden="true"
                              />
                            )}
                            <span className="relative z-10">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {trendData.length === 0 ? (
                    <div className="h-80 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No daily or monthly spend points in the selected date range.
                    </div>
                  ) : (
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      {singleSelectedUtil ? (
                        <LineChart
                          data={trendData}
                          margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis
                            dataKey="label"
                            minTickGap={18}
                            tick={{ fontSize: 12, fill: '#475569' }}
                          />
                          <YAxis
                            yAxisId="cost"
                            tickFormatter={(v) => formatCompactCurrency(Number(v))}
                            tick={{ fontSize: 12, fill: '#475569' }}
                            width={64}
                          />
                          <YAxis
                            yAxisId="cons"
                            orientation="right"
                            tickFormatter={(v) => formatNumber(Number(v), 0)}
                            tick={{ fontSize: 12, fill: '#475569' }}
                            width={56}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0].payload as Record<
                                string,
                                string | number | null
                              >;
                              const costVal = Number(
                                row[`cost_${singleSelectedUtil.id}`] || 0
                              );
                              const consVal = Number(
                                row[`cons_${singleSelectedUtil.id}`] || 0
                              );
                              const rateVal =
                                consVal > 0 ? costVal / consVal : null;
                              return (
                                <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1">
                                  <div className="font-bold text-slate-900">
                                    {trendGranularity === 'monthly'
                                      ? formatMonthLabel(String(row.date))
                                      : formatDate(String(row.date))}
                                  </div>
                                  <div className="text-slate-700 tabular-nums">
                                    Cost:{' '}
                                    <span className="font-semibold">
                                      {formatCurrency(costVal)}
                                    </span>
                                  </div>
                                  <div className="text-slate-700 tabular-nums">
                                    Consumption:{' '}
                                    <span className="font-semibold">
                                      {formatNumber(consVal)}{' '}
                                      {singleSelectedUtil.unit}
                                    </span>
                                  </div>
                                  <div className="pt-1 border-t border-slate-100 text-teal-800 font-semibold tabular-nums">
                                    Unit Cost:{' '}
                                    {rateVal !== null
                                      ? `৳ ${formatNumber(rateVal, 2)}/${
                                          singleSelectedUtil.unit
                                        }`
                                      : '—'}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Legend />
                          <Line
                            yAxisId="cost"
                            type="monotone"
                            dataKey={`cost_${singleSelectedUtil.id}`}
                            name="Cost (BDT)"
                            stroke={singleSelectedUtil.color}
                            strokeWidth={2.5}
                            dot={{ r: 3.5 }}
                            activeDot={{ r: 5 }}
                            animationDuration={450}
                          />
                          <Line
                            yAxisId="cons"
                            type="monotone"
                            dataKey={`cons_${singleSelectedUtil.id}`}
                            name={`Consumption (${singleSelectedUtil.unit})`}
                            stroke="#0F172A"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            animationDuration={450}
                          />
                        </LineChart>
                      ) : (
                        <BarChart
                          data={trendData}
                          barCategoryGap="20%"
                          margin={{ top: 10, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis
                            dataKey="label"
                            minTickGap={18}
                            tick={{ fontSize: 12, fill: '#475569' }}
                          />
                          <YAxis
                            tickFormatter={(v) => formatCompactCurrency(Number(v))}
                            tick={{ fontSize: 12, fill: '#475569' }}
                            width={64}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0].payload as Record<
                                string,
                                string | number | null
                              >;
                              return (
                                <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1.5 min-w-[240px]">
                                  <div className="font-bold text-slate-900 pb-1 border-b border-slate-100">
                                    {trendGranularity === 'monthly'
                                      ? formatMonthLabel(String(row.date))
                                      : formatDate(String(row.date))}
                                  </div>
                                  {activeUtilities.map((u) => {
                                    const c = Number(row[`cost_${u.id}`] || 0);
                                    const q = Number(row[`cons_${u.id}`] || 0);
                                    if (c === 0 && q === 0) return null;
                                    const rate = q > 0 && u.unit ? c / q : null;
                                    return (
                                      <div
                                        key={u.id}
                                        className="flex items-center justify-between gap-4 tabular-nums"
                                      >
                                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                                          <span
                                            className="w-2 h-2 rounded-sm"
                                            style={{ backgroundColor: u.color }}
                                          />
                                          {u.name}
                                          {q > 0 && u.unit
                                            ? ` (${formatNumber(q)} ${u.unit})`
                                            : ''}
                                        </span>
                                        <span className="font-semibold text-slate-900 text-right">
                                          {formatCurrency(c)}
                                          {rate !== null && u.unit && (
                                            <span className="text-[11px] font-normal text-teal-700 ml-1">
                                              (৳{formatNumber(rate, 2)}/{u.unit})
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  <div className="pt-1 border-t border-slate-100 flex items-center justify-between font-bold text-slate-900 tabular-nums">
                                    <span>Total</span>
                                    <span>
                                      {formatCurrency(Number(row.totalCost || 0))}
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Legend />
                          {activeUtilities.map((u, idx) => (
                            <Bar
                              key={u.id}
                              dataKey={`cost_${u.id}`}
                              name={u.name}
                              stackId="a"
                              fill={u.color}
                              maxBarSize={36}
                              radius={
                                idx === activeUtilities.length - 1
                                  ? [4, 4, 0, 0]
                                  : [0, 0, 0, 0]
                              }
                              animationDuration={450}
                            />
                          ))}
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  )}
                </div>

                {/* Chart 2: Utility Cost Share Donut */}
                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Cost Share &amp; Rate by Utility
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Click a utility to filter dashboard
                      </p>
                    </div>
                    {selectedUtilityId !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setSelectedUtilityId('ALL')}
                        className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer shrink-0"
                      >
                        All
                      </button>
                    )}
                  </div>

                  {pieData.length === 0 ? (
                    <div className="flex-1 min-h-[220px] flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No cost data available
                    </div>
                  ) : (
                    <>
                      <div className="relative h-52 w-full">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={54}
                              outerRadius={82}
                              paddingAngle={2}
                              animationDuration={500}
                              className="cursor-pointer"
                              onClick={(data) => {
                                const d = data as { payload?: { id?: string }; id?: string };
                                const uid = d?.payload?.id ?? d?.id;
                                if (uid) {
                                  setSelectedUtilityId((prev) =>
                                    prev === uid ? 'ALL' : uid
                                  );
                                }
                              }}
                            >
                              {pieData.map((entry) => (
                                <Cell
                                  key={entry.id}
                                  fill={entry.color}
                                  fillOpacity={
                                    selectedUtilityId === 'ALL' ||
                                    selectedUtilityId === entry.id
                                      ? 1
                                      : 0.35
                                  }
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value) => formatCurrency(Number(value))}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Total Spend
                          </span>
                          <span className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                            {formatCompactCurrency(kpis.totalCost)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        {pieData.map((item) => {
                          const pct =
                            kpis.totalCost > 0
                              ? (item.value / kpis.totalCost) * 100
                              : 0;
                          const isUtilSelected = selectedUtilityId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                setSelectedUtilityId((prev) =>
                                  prev === item.id ? 'ALL' : item.id
                                )
                              }
                              className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors cursor-pointer space-y-1 ${
                                isUtilSelected
                                  ? 'bg-teal-50/80'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs gap-2">
                                <div className="flex items-center gap-2 text-slate-700 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                                    style={{ backgroundColor: item.color }}
                                  />
                                  <span className="font-medium truncate">
                                    {item.name}
                                  </span>
                                </div>
                                <div className="tabular-nums text-right shrink-0">
                                  <span className="text-slate-900 font-semibold">
                                    {formatCurrency(item.value)} · {formatPercent(pct)}
                                  </span>
                                  {item.avgUnitCost !== null && item.unit && (
                                    <span className="block text-[11px] text-teal-700">
                                      ৳ {formatNumber(item.avgUnitCost, 2)}/{item.unit}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ scaleX: 0 }}
                                  animate={{ scaleX: Math.min(1, Math.max(0, pct / 100)) }}
                                  transition={{ duration: 0.4, ease: EASE_OUT }}
                                  className="h-full w-full rounded-full origin-left"
                                  style={{ backgroundColor: item.color }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Chart 3: Unit Cost Trajectory */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Unit Cost Trajectory (৳ / Unit)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Effective rate vs period average
                        {activeUnitTrendAvg !== null && activeUnitTrendUtil
                          ? ` (Avg: ৳${formatNumber(
                              activeUnitTrendAvg,
                              2
                            )}/${activeUnitTrendUtil.unit})`
                          : ''}
                      </p>
                    </div>

                    {selectedUtilityId === 'ALL' && filterableUtilities.length > 1 && (
                      <select
                        value={activeUnitTrendUtil?.id || ''}
                        onChange={(e) => setUnitTrendUtilityId(e.target.value)}
                        aria-label="Select utility for unit cost trend"
                        className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {filterableUtilities.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} (৳/{u.unit})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {!activeUnitTrendUtil || unitTrendPoints.length === 0 ? (
                    <div className="h-64 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No consumption readings available to compute unit cost.
                    </div>
                  ) : (
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <LineChart
                          data={unitTrendPoints}
                          margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis
                            dataKey="label"
                            minTickGap={18}
                            tick={{ fontSize: 11, fill: '#475569' }}
                          />
                          <YAxis
                            tickFormatter={(v) => `৳${formatNumber(Number(v), 2)}`}
                            tick={{ fontSize: 11, fill: '#475569' }}
                            width={62}
                            domain={unitTrendDomain}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0].payload as Record<
                                string,
                                string | number | null
                              >;
                              const rate = Number(
                                row[`rate_${activeUnitTrendUtil.id}`] || 0
                              );
                              const cost = Number(
                                row[`cost_${activeUnitTrendUtil.id}`] || 0
                              );
                              const cons = Number(
                                row[`cons_${activeUnitTrendUtil.id}`] || 0
                              );
                              const variancePct =
                                activeUnitTrendAvg && activeUnitTrendAvg > 0
                                  ? ((rate - activeUnitTrendAvg) /
                                      activeUnitTrendAvg) *
                                    100
                                  : null;
                              return (
                                <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1">
                                  <div className="font-bold text-slate-900">
                                    {trendGranularity === 'monthly'
                                      ? formatMonthLabel(String(row.date))
                                      : formatDate(String(row.date))}{' '}
                                    · {activeUnitTrendUtil.name}
                                  </div>
                                  <div className="text-teal-800 font-bold tabular-nums">
                                    Unit Cost: ৳ {formatNumber(rate, 2)}/
                                    {activeUnitTrendUtil.unit}
                                  </div>
                                  <div className="text-slate-600 tabular-nums">
                                    {formatCurrency(cost)} for {formatNumber(cons)}{' '}
                                    {activeUnitTrendUtil.unit}
                                  </div>
                                  {variancePct !== null && (
                                    <div
                                      className={`font-medium tabular-nums ${
                                        variancePct > 0
                                          ? 'text-rose-700'
                                          : 'text-emerald-700'
                                      }`}
                                    >
                                      {variancePct >= 0 ? '+' : ''}
                                      {formatPercent(variancePct)} vs period avg
                                    </div>
                                  )}
                                </div>
                              );
                            }}
                          />
                          {activeUnitTrendAvg !== null && (
                            <ReferenceLine
                              y={activeUnitTrendAvg}
                              stroke="#64748B"
                              strokeDasharray="4 4"
                              label={{
                                value: `Avg ৳${formatNumber(
                                  activeUnitTrendAvg,
                                  2
                                )}`,
                                position: 'insideTopRight',
                                fill: '#475569',
                                fontSize: 11,
                              }}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey={`rate_${activeUnitTrendUtil.id}`}
                            name={`৳/${activeUnitTrendUtil.unit}`}
                            stroke={activeUnitTrendUtil.color}
                            strokeWidth={2.5}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                            animationDuration={450}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Chart 4: Many-Factory Ranked Spend Comparison */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Factory-Wise Spend Ranking (BDT)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Ranked by total cost · Click any factory bar to drill down
                        {selectedCompany !== 'ALL' ? ` · Active: ${selectedCompany}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {selectedCompany !== 'ALL' && (
                        <button
                          type="button"
                          onClick={() => setSelectedCompany('ALL')}
                          className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer mr-1"
                        >
                          All Factories
                        </button>
                      )}
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['stacked', 'By Utility'],
                            ['total', 'Total'],
                          ] as const
                        ).map(([modeKey, label]) => {
                          const isSelected = factoryStackMode === modeKey;
                          return (
                            <button
                              key={modeKey}
                              type="button"
                              onClick={() => setFactoryStackMode(modeKey)}
                              className={`relative px-2 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                                isSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="dashFactoryStackPill"
                                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                  className="absolute inset-0 bg-white rounded-md shadow-sm"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="relative z-10">{label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['horizontal', 'Horizontal'],
                            ['vertical', 'Vertical'],
                          ] as const
                        ).map(([layoutKey, label]) => {
                          const isSelected = factoryLayout === layoutKey;
                          return (
                            <button
                              key={layoutKey}
                              type="button"
                              onClick={() => setFactoryLayout(layoutKey)}
                              className={`relative px-2 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
                                isSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="dashFactoryLayoutPill"
                                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                  className="absolute inset-0 bg-white rounded-md shadow-sm"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="relative z-10">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {!hasFactorySpendData ? (
                    <div className="h-64 flex items-center justify-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No factory spend recorded for the active date range and utility filter.
                    </div>
                  ) : (
                  <div
                    className={
                      factoryLayout === 'horizontal'
                        ? 'max-h-[420px] overflow-y-auto pr-1'
                        : 'h-72 w-full'
                    }
                  >
                    <div
                      style={
                        factoryLayout === 'horizontal'
                          ? { height: horizontalChartHeight }
                          : { height: '100%' }
                      }
                      className="w-full"
                    >
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <BarChart
                          data={companyComparisonData}
                          layout={factoryLayout === 'horizontal' ? 'vertical' : 'horizontal'}
                          barCategoryGap="22%"
                          margin={{
                            top: 8,
                            right: 20,
                            left: 8,
                            bottom:
                              factoryLayout === 'vertical' && companyComparisonData.length > 4
                                ? 24
                                : 4,
                          }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          {factoryLayout === 'horizontal' ? (
                            <>
                              <XAxis
                                type="number"
                                tickFormatter={(v) =>
                                  formatCompactCurrency(Number(v))
                                }
                                tick={{ fontSize: 11, fill: '#475569' }}
                              />
                              <YAxis
                                type="category"
                                dataKey="company"
                                width={136}
                                tickFormatter={(v) =>
                                  String(v).length > 18
                                    ? `${String(v).slice(0, 17)}…`
                                    : String(v)
                                }
                                tick={{ fontSize: 12, fill: '#0F172A' }}
                              />
                            </>
                          ) : (
                            <>
                              <XAxis
                                dataKey="company"
                                interval={0}
                                angle={companyComparisonData.length > 4 ? -20 : 0}
                                textAnchor={companyComparisonData.length > 4 ? 'end' : 'middle'}
                                height={companyComparisonData.length > 4 ? 52 : 28}
                                tickFormatter={(v) =>
                                  String(v).length > 15
                                    ? `${String(v).slice(0, 14)}…`
                                    : String(v)
                                }
                                tick={{ fontSize: 11, fill: '#334155' }}
                              />
                              <YAxis
                                tickFormatter={(v) =>
                                  formatCompactCurrency(Number(v))
                                }
                                tick={{ fontSize: 11, fill: '#475569' }}
                                width={64}
                              />
                            </>
                          )}
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0].payload as Record<
                                string,
                                string | number
                              >;
                              const rowTotal = Number(row.totalCost || 0);
                              const rowSharePct =
                                kpis.totalCost > 0
                                  ? (rowTotal / kpis.totalCost) * 100
                                  : 0;
                              return (
                                <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1.5 min-w-[230px]">
                                  <div className="font-bold text-slate-900 pb-1 border-b border-slate-100 flex items-center justify-between gap-3">
                                    <span>{String(row.company)}</span>
                                    <span className="text-[11px] font-semibold text-teal-800 tabular-nums">
                                      {formatPercent(rowSharePct)}
                                    </span>
                                  </div>
                                  {activeUtilities.map((u) => {
                                    const c = Number(row[`cost_${u.id}`] || 0);
                                    const q = Number(row[`cons_${u.id}`] || 0);
                                    if (c === 0 && q === 0) return null;
                                    const rate = q > 0 && u.unit ? c / q : null;
                                    return (
                                      <div
                                        key={u.id}
                                        className="flex items-center justify-between gap-4 tabular-nums"
                                      >
                                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                                          <span
                                            className="w-2 h-2 rounded-sm"
                                            style={{ backgroundColor: u.color }}
                                          />
                                          {u.name}
                                        </span>
                                        <span className="font-semibold text-slate-900 text-right">
                                          {formatCurrency(c)}
                                          {rate !== null && (
                                            <span className="text-[11px] font-normal text-teal-700 ml-1">
                                              (৳{formatNumber(rate, 2)}/{u.unit})
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  <div className="pt-1 border-t border-slate-100 flex items-center justify-between font-bold text-slate-900 tabular-nums">
                                    <span>Total</span>
                                    <span>
                                      {formatCurrency(rowTotal)}
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Legend />
                          {factoryStackMode === 'total' ? (
                            <Bar
                              dataKey="totalCost"
                              name="Total Spend (BDT)"
                              fill="#0F766E"
                              maxBarSize={32}
                              minPointSize={3}
                              radius={
                                factoryLayout === 'horizontal'
                                  ? [0, 4, 4, 0]
                                  : [4, 4, 0, 0]
                              }
                              className="cursor-pointer"
                              onClick={(data) => {
                                const d = data as {
                                  payload?: { company?: string };
                                  company?: string;
                                };
                                const name = d?.payload?.company ?? d?.company;
                                if (name) {
                                  setSelectedCompany((prev) =>
                                    prev === name ? 'ALL' : name
                                  );
                                }
                              }}
                              animationDuration={450}
                            >
                              {companyComparisonData.map((entry) => (
                                <Cell
                                  key={String(entry.company)}
                                  fill={
                                    selectedCompany === 'ALL' ||
                                    selectedCompany === String(entry.company)
                                      ? '#0F766E'
                                      : '#CBD5E1'
                                  }
                                />
                              ))}
                            </Bar>
                          ) : (
                            activeUtilities.map((u, idx) => (
                              <Bar
                                key={u.id}
                                dataKey={`cost_${u.id}`}
                                name={u.name}
                                stackId="factory"
                                fill={u.color}
                                maxBarSize={32}
                                radius={
                                  idx === activeUtilities.length - 1
                                    ? factoryLayout === 'horizontal'
                                      ? [0, 4, 4, 0]
                                      : [4, 4, 0, 0]
                                    : [0, 0, 0, 0]
                                }
                                className="cursor-pointer"
                                onClick={(data) => {
                                  const d = data as {
                                    payload?: { company?: string };
                                    company?: string;
                                  };
                                  const name = d?.payload?.company ?? d?.company;
                                  if (name) {
                                    setSelectedCompany((prev) =>
                                      prev === name ? 'ALL' : name
                                    );
                                  }
                                }}
                                animationDuration={450}
                              >
                                {companyComparisonData.map((entry) => (
                                  <Cell
                                    key={`${u.id}-${String(entry.company)}`}
                                    fill={u.color}
                                    fillOpacity={
                                      selectedCompany === 'ALL' ||
                                      selectedCompany === String(entry.company)
                                        ? 1
                                        : 0.35
                                    }
                                  />
                                ))}
                              </Bar>
                            ))
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  )}
                </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Plant Equipment & Generation Analytics (Boilers · Generators · Solar) */}
            {dashboardView === 'generation' &&
              canViewPlantGeneration && (
              <motion.div
                key="view-generation"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Plant Generation &amp; Power Mix (Boilers · Generators · Solar)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Factory steam production (kg &amp; ৳/kg), captive generator power (kWh &amp; ৳/kWh), and clean solar energy share
                    </p>
                  </div>

                  {generationAnalytics.hasRecords ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 tabular-nums">
                      <span>
                        <strong className="text-slate-900">
                          {formatNumber(generationAnalytics.totalBoilers, 0)}
                        </strong>{' '}
                        Boilers
                      </span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        <strong className="text-slate-900">
                          {formatNumber(generationAnalytics.totalGenerators, 0)}
                        </strong>{' '}
                        Generators
                        {(generationAnalytics.totalDieselGenerators > 0 ||
                          generationAnalytics.totalGasGenerators > 0) && (
                          <span className="text-slate-500">
                            {' '}
                            ({generationAnalytics.totalDieselGenerators}D /{' '}
                            {generationAnalytics.totalGasGenerators}G)
                          </span>
                        )}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span>
                        <strong className="text-emerald-700">
                          {formatNumber(generationAnalytics.totalSolarSystems, 0)}
                        </strong>{' '}
                        Solar Units
                      </span>
                    </div>
                  ) : (
                    onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('entry')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer self-start sm:self-auto"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        Log Boiler, Generator &amp; Solar Data
                      </button>
                    )
                  )}
                </div>

                {!generationAnalytics.hasRecords ? (
                  <div className="py-6 text-center text-sm text-slate-500">
                    No Boiler steam, Generator power, or Solar generation records logged for{' '}
                    <strong className="text-slate-700">{dateBounds.label}</strong> yet.
                  </div>
                ) : (
                  <>
                    {/* Flattened Generation KPI Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                      <div className="p-4 bg-white space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <Flame className="w-3.5 h-3.5 text-orange-600" />
                            Boiler Steam Produced
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                            {formatNumber(generationAnalytics.totalBoilers, 0)} boilers
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 tabular-nums">
                          <AnimatedMetric
                            value={generationAnalytics.totalSteamKg}
                            formatter={(v) => `${formatNumber(v, 0)} kg`}
                          />
                        </div>
                        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs tabular-nums">
                          <span className="text-slate-500">
                            {generationAnalytics.avgSteamCostPerKg !== null
                              ? `৳ ${formatNumber(
                                  generationAnalytics.avgSteamCostPerKg,
                                  2
                                )}/kg`
                              : 'No fuel cost'}
                            {generationAnalytics.totalBoilerFuelCost > 0 && (
                              <span className="text-slate-600 ml-1">
                                ({formatCurrency(generationAnalytics.totalBoilerFuelCost)})
                              </span>
                            )}
                          </span>
                          <span className="font-semibold text-teal-800">
                            {generationAnalytics.avgSteamYield !== null
                              ? `${formatNumber(
                                  generationAnalytics.avgSteamYield,
                                  2
                                )} kg/${generationAnalytics.topBoilerFuelUnit}`
                              : `${formatNumber(
                                  generationAnalytics.totalSteamKg / 1000,
                                  1
                                )} t`}
                          </span>
                        </div>
                        {generationAnalytics.boilerFuelBreakdown.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 tabular-nums">
                            <span>Fuel:</span>
                            {generationAnalytics.boilerFuelBreakdown.map((bf) => (
                              <span key={bf.unit} className="font-medium text-slate-800">
                                {formatNumber(bf.qty)} {bf.unit}
                              </span>
                            ))}
                          </div>
                        )}
                        {(generationAnalytics.singleScopeBoilerUnits.length > 1 ||
                          generationAnalytics.singleScopeBoilerUnits.some(
                            (bu) => bu.fuelMode === 'dual'
                          )) && (
                          <div className="pt-1.5 border-t border-slate-200/60 space-y-0.5 text-[11px] text-slate-600 tabular-nums">
                            {generationAnalytics.singleScopeBoilerUnits.map((bu) => (
                              <div
                                key={bu.key}
                                className="flex items-center justify-between gap-2"
                              >
                                <span className="font-medium text-slate-700 truncate">
                                  {bu.deviceName}
                                </span>
                                <span className="shrink-0">
                                  {bu.fuelMode === 'dual'
                                    ? `${formatNumber(bu.fuelQty, 0)} ${bu.fuelUnit} + ${formatNumber(bu.secondaryFuelQty, 0)} ${bu.secondaryFuelUnit || 'L'}`
                                    : bu.yieldPerFuel !== null
                                    ? `${formatNumber(bu.yieldPerFuel, 1)} kg/${bu.fuelUnit}`
                                    : `${formatNumber(bu.steamKg, 0)} kg`}
                                  {bu.costPerKg !== null && (
                                    <span className="text-teal-800 font-semibold">
                                      {' '}
                                      · ৳{formatNumber(bu.costPerKg, 2)}/kg
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {generationAnalytics.steamDeltaPct !== null && (
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {generationAnalytics.steamDeltaPct >= 0 ? '+' : ''}
                            {formatPercent(generationAnalytics.steamDeltaPct)} vs{' '}
                            {comparisonStats?.bounds.label}
                          </div>
                        )}
                        {(generationAnalytics.totalBoilerHours > 0 ||
                          generationAnalytics.avgSteamPerHour !== null) && (
                          <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                            <span>Run: {formatNumber(generationAnalytics.totalBoilerHours, 1)} hrs</span>
                            <span className="font-semibold text-orange-800">
                              {generationAnalytics.avgSteamPerHour !== null
                                ? `${formatNumber(generationAnalytics.avgSteamPerHour, 1)} kg/hr`
                                : '—'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="p-4 bg-white space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <Zap className="w-3.5 h-3.5 text-teal-700" />
                            Generator Electricity
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                            {formatNumber(generationAnalytics.totalGenerators, 0)} gen
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 tabular-nums">
                          <AnimatedMetric
                            value={generationAnalytics.totalGenKwh}
                            formatter={(v) => `${formatNumber(v, 0)} kWh`}
                          />
                        </div>
                        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs tabular-nums">
                          <span className="text-slate-500">
                            {generationAnalytics.avgGenCostPerKwh !== null
                              ? `৳ ${formatNumber(
                                  generationAnalytics.avgGenCostPerKwh,
                                  2
                                )}/kWh`
                              : 'No fuel cost'}
                            {generationAnalytics.totalGenFuelCost > 0 && (
                              <span className="text-slate-600 ml-1">
                                ({formatCurrency(generationAnalytics.totalGenFuelCost)})
                              </span>
                            )}
                          </span>
                          <span className="font-semibold text-teal-800">
                            {generationAnalytics.avgGenYield !== null
                              ? `${formatNumber(
                                  generationAnalytics.avgGenYield,
                                  2
                                )} kWh/${generationAnalytics.topGenFuelUnit}`
                              : `${formatPercent(generationAnalytics.genSharePct)} mix`}
                          </span>
                        </div>
                        {(generationAnalytics.totalGenHours > 0 ||
                          generationAnalytics.avgGenKw !== null) && (
                          <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums">
                            <span>Run: {formatNumber(generationAnalytics.totalGenHours, 1)} hrs</span>
                            <span className="font-semibold text-teal-800">
                              {generationAnalytics.avgGenKw !== null
                                ? `Avg ${formatNumber(generationAnalytics.avgGenKw, 1)} kW`
                                : '—'}
                            </span>
                          </div>
                        )}
                        {(generationAnalytics.totalDieselGenKwh > 0 ||
                          generationAnalytics.totalGasGenKwh > 0) && (
                          <div className="pt-1.5 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600 tabular-nums">
                            <span>
                              Diesel:{' '}
                              <strong className="text-slate-800">
                                {formatNumber(generationAnalytics.totalDieselGenKwh, 0)} kWh
                              </strong>
                              {generationAnalytics.avgDieselCostPerKwh !== null && (
                                <span className="text-slate-500">
                                  {' '}
                                  (৳{formatNumber(generationAnalytics.avgDieselCostPerKwh, 2)})
                                </span>
                              )}
                            </span>
                            <span>
                              Gas:{' '}
                              <strong className="text-slate-800">
                                {formatNumber(generationAnalytics.totalGasGenKwh, 0)} kWh
                              </strong>
                              {generationAnalytics.avgGasCostPerKwh !== null && (
                                <span className="text-slate-500">
                                  {' '}
                                  (৳{formatNumber(generationAnalytics.avgGasCostPerKwh, 2)})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {(generationAnalytics.singleScopeGeneratorUnits.length > 1 ||
                          generationAnalytics.singleScopeGeneratorUnits.some(
                            (gu) => gu.fuelMode === 'dual'
                          )) && (
                          <div className="pt-1.5 border-t border-slate-200/60 space-y-0.5 text-[11px] text-slate-600 tabular-nums">
                            {generationAnalytics.singleScopeGeneratorUnits.map((gu) => (
                              <div
                                key={gu.key}
                                className="flex items-center justify-between gap-2"
                              >
                                <span
                                  className={`font-medium truncate ${
                                    gu.fuelMode === 'diesel'
                                      ? 'text-amber-800'
                                      : gu.fuelMode === 'cng'
                                      ? 'text-sky-800'
                                      : gu.fuelMode === 'lng'
                                      ? 'text-cyan-800'
                                      : gu.fuelMode === 'lpg'
                                      ? 'text-orange-800'
                                      : gu.fuelMode === 'sng'
                                      ? 'text-violet-800'
                                      : gu.fuelMode === 'dual'
                                      ? 'text-indigo-800'
                                      : 'text-teal-800'
                                  }`}
                                >
                                  {gu.deviceName} (
                                  {gu.fuelMode === 'dual'
                                    ? `${gu.fuelUnit}+${gu.secondaryFuelUnit || 'L'}`
                                    : gu.fuelMode === 'cng' ||
                                      gu.fuelMode === 'lng' ||
                                      gu.fuelMode === 'lpg' ||
                                      gu.fuelMode === 'sng'
                                    ? `${getFuelLabel(gu.fuelMode)} ${gu.fuelUnit}`
                                    : gu.fuelUnit}
                                  )
                                </span>
                                <span className="shrink-0">
                                  {formatNumber(gu.kwh, 0)} kWh
                                  {gu.hours > 0 && ` · ${formatNumber(gu.hours, 1)}h`}
                                  {gu.costPerKwh !== null && (
                                    <span className="text-slate-700 font-semibold">
                                      {' '}
                                      · ৳{formatNumber(gu.costPerKwh, 2)}/kWh
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {generationAnalytics.genDeltaPct !== null && (
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {generationAnalytics.genDeltaPct >= 0 ? '+' : ''}
                            {formatPercent(generationAnalytics.genDeltaPct)} vs{' '}
                            {comparisonStats?.bounds.label}
                          </div>
                        )}
                      </div>

                      <div className="p-4 bg-emerald-50/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-900">
                            <Sun className="w-3.5 h-3.5 text-amber-500" />
                            Solar Electricity
                          </span>
                          <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                            {formatPercent(generationAnalytics.solarSharePct)} share
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-emerald-950 tabular-nums">
                          <AnimatedMetric
                            value={generationAnalytics.totalSolarKwh}
                            formatter={(v) => `${formatNumber(v, 0)} kWh`}
                          />
                        </div>
                        <div className="pt-2 border-t border-emerald-200/70 flex items-center justify-between text-xs tabular-nums">
                          <span className="text-emerald-800">Total Money Saved</span>
                          <span className="font-bold text-emerald-800">
                            {formatCurrency(generationAnalytics.totalSolarSavings)}
                          </span>
                        </div>
                        {(generationAnalytics.totalSolarHours > 0 ||
                          generationAnalytics.avgSolarKw !== null) && (
                          <div className="flex items-center justify-between text-[11px] text-emerald-800 tabular-nums">
                            <span>Sun Hrs: {formatNumber(generationAnalytics.totalSolarHours, 1)}h</span>
                            <span className="font-semibold">
                              {generationAnalytics.avgSolarKw !== null
                                ? `Avg ${formatNumber(generationAnalytics.avgSolarKw, 1)} kW`
                                : '—'}
                            </span>
                          </div>
                        )}
                        {generationAnalytics.singleScopeSolarUnits.length > 1 && (
                          <div className="pt-1.5 border-t border-emerald-200/60 space-y-0.5 text-[11px] text-emerald-900 tabular-nums">
                            {generationAnalytics.singleScopeSolarUnits.map((su) => (
                              <div
                                key={su.key}
                                className="flex items-center justify-between gap-2"
                              >
                                <span className="font-medium truncate">
                                  {su.deviceName}
                                </span>
                                <span className="shrink-0">
                                  {formatNumber(su.kwh, 0)} kWh ·{' '}
                                  <strong>{formatCurrency(su.savings)}</strong>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="text-[10px] text-emerald-700/90">
                          Combined solar savings (never deducted from spend)
                        </div>
                        {generationAnalytics.solarDeltaPct !== null && (
                          <div className="text-[11px] text-emerald-700 tabular-nums">
                            {generationAnalytics.solarDeltaPct >= 0 ? '+' : ''}
                            {formatPercent(generationAnalytics.solarDeltaPct)} vs{' '}
                            {comparisonStats?.bounds.label}
                          </div>
                        )}
                      </div>

                      <div className="p-4 bg-white space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-600">
                            Total Plant Power Mix
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                            Grid + Gen + Solar
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 tabular-nums">
                          <AnimatedMetric
                            value={generationAnalytics.totalPlantPowerKwh}
                            formatter={(v) => `${formatNumber(v, 0)} kWh`}
                          />
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-[#2F6FDE] transition-all duration-500"
                            style={{ width: `${generationAnalytics.gridSharePct}%` }}
                            title={`Grid: ${formatPercent(generationAnalytics.gridSharePct)}`}
                          />
                          <div
                            className="h-full bg-[#E0A100] transition-all duration-500"
                            style={{ width: `${generationAnalytics.genSharePct}%` }}
                            title={`Generator: ${formatPercent(generationAnalytics.genSharePct)}`}
                          />
                          <div
                            className="h-full bg-[#16A34A] transition-all duration-500"
                            style={{ width: `${generationAnalytics.solarSharePct}%` }}
                            title={`Solar: ${formatPercent(generationAnalytics.solarSharePct)}`}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] tabular-nums text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-[#2F6FDE]" />
                            Grid {formatPercent(generationAnalytics.gridSharePct)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-[#E0A100]" />
                            Gen {formatPercent(generationAnalytics.genSharePct)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <span className="w-2 h-2 rounded-sm bg-[#16A34A]" />
                            Solar {formatPercent(generationAnalytics.solarSharePct)}
                          </span>
                        </div>
                        {(generationAnalytics.totalPeakGridKwh > 0 ||
                          generationAnalytics.totalOffPeakGridKwh > 0) && (
                          <div className="pt-1.5 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600 tabular-nums">
                            <span>
                              Peak:{' '}
                              <strong className="text-slate-800">
                                {formatNumber(generationAnalytics.totalPeakGridKwh, 0)} kWh
                              </strong>
                              {generationAnalytics.avgPeakGridRate !== null && (
                                <span className="text-slate-500">
                                  {' '}
                                  (৳{formatNumber(generationAnalytics.avgPeakGridRate, 2)})
                                </span>
                              )}
                            </span>
                            <span>
                              Off-Peak:{' '}
                              <strong className="text-slate-800">
                                {formatNumber(generationAnalytics.totalOffPeakGridKwh, 0)} kWh
                              </strong>
                              {generationAnalytics.avgOffPeakGridRate !== null && (
                                <span className="text-slate-500">
                                  {' '}
                                  (৳{formatNumber(generationAnalytics.avgOffPeakGridRate, 2)})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {generationAnalytics.gridProviderTotals.length > 0 && (
                          <div className="pt-1.5 border-t border-slate-200/60 text-[11px] text-blue-900 font-medium tabular-nums">
                            {generationAnalytics.gridProviderTotals
                              .map((gp) => `${gp.provider}: ${formatNumber(gp.kwh, 0)} kWh`)
                              .join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Generation Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Power Source Mix by Factory */}
                      <div className="lg:col-span-6 border border-slate-200 rounded-xl p-4 sm:p-5">
                        <div className="mb-3">
                          <h4 className="text-sm font-bold text-slate-900">
                            Power Source Mix by Factory (kWh)
                          </h4>
                          <p className="text-xs text-slate-500">
                            Grid Electricity vs Captive Generator vs Clean Solar output
                          </p>
                        </div>

                        {powerMixFactoryRows.length === 0 ? (
                          <div className="h-64 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                            No Grid, Generator, or Solar kWh readings recorded in this period.
                          </div>
                        ) : (
                        <div
                          className={
                            powerMixFactoryRows.length > 5
                              ? 'max-h-[340px] overflow-y-auto pr-1'
                              : 'h-64 w-full'
                          }
                        >
                          <div
                            style={
                              powerMixFactoryRows.length > 5
                                ? {
                                    height: Math.max(
                                      240,
                                      powerMixFactoryRows.length * 40 + 40
                                    ),
                                  }
                                : { height: '100%' }
                            }
                            className="w-full"
                          >
                            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                              <BarChart
                                data={powerMixFactoryRows}
                                layout={
                                  powerMixFactoryRows.length > 5
                                    ? 'vertical'
                                    : 'horizontal'
                                }
                                barCategoryGap="22%"
                                margin={{
                                  top: 8,
                                  right: 16,
                                  left: 6,
                                  bottom:
                                    powerMixFactoryRows.length <= 5 &&
                                    powerMixFactoryRows.length > 3
                                      ? 20
                                      : 4,
                                }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                                {powerMixFactoryRows.length > 5 ? (
                                  <>
                                    <XAxis
                                      type="number"
                                      tickFormatter={(v) => formatNumber(Number(v), 0)}
                                      tick={{ fontSize: 11, fill: '#475569' }}
                                    />
                                    <YAxis
                                      type="category"
                                      dataKey="company"
                                      width={128}
                                      tickFormatter={(v) =>
                                        String(v).length > 17
                                          ? `${String(v).slice(0, 16)}…`
                                          : String(v)
                                      }
                                      tick={{ fontSize: 11, fill: '#0F172A' }}
                                    />
                                  </>
                                ) : (
                                  <>
                                    <XAxis
                                      dataKey="company"
                                      interval={0}
                                      angle={powerMixFactoryRows.length > 3 ? -16 : 0}
                                      textAnchor={powerMixFactoryRows.length > 3 ? 'end' : 'middle'}
                                      height={powerMixFactoryRows.length > 3 ? 44 : 26}
                                      tickFormatter={(v) =>
                                        String(v).length > 15
                                          ? `${String(v).slice(0, 14)}…`
                                          : String(v)
                                      }
                                      tick={{ fontSize: 11, fill: '#334155' }}
                                    />
                                    <YAxis
                                      tickFormatter={(v) => formatNumber(Number(v), 0)}
                                      tick={{ fontSize: 11, fill: '#475569' }}
                                      width={58}
                                    />
                                  </>
                                )}
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const row = payload[0].payload as {
                                      company: string;
                                      gridKwh: number;
                                      generatorKwh: number;
                                      solarKwh: number;
                                      totalPower: number;
                                      solarSharePct: number;
                                    };
                                    return (
                                      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs space-y-1 min-w-[200px] tabular-nums">
                                        <div className="font-bold text-slate-900 pb-1 border-b border-slate-100">
                                          {row.company}
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <span className="text-blue-700">Grid Power</span>
                                          <span className="font-semibold">{formatNumber(row.gridKwh, 0)} kWh</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <span className="text-amber-700">Generator</span>
                                          <span className="font-semibold">{formatNumber(row.generatorKwh, 0)} kWh</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <span className="text-emerald-700">Clean Solar</span>
                                          <span className="font-semibold">{formatNumber(row.solarKwh, 0)} kWh ({formatPercent(row.solarSharePct)})</span>
                                        </div>
                                        <div className="pt-1 border-t border-slate-100 flex justify-between font-bold text-slate-900">
                                          <span>Total Mix</span>
                                          <span>{formatNumber(row.totalPower, 0)} kWh</span>
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <Legend />
                                <Bar
                                  dataKey="gridKwh"
                                  name="Grid (kWh)"
                                  stackId="pwr"
                                  fill="#2F6FDE"
                                  maxBarSize={32}
                                  animationDuration={450}
                                />
                                <Bar
                                  dataKey="generatorKwh"
                                  name="Generator (kWh)"
                                  stackId="pwr"
                                  fill="#E0A100"
                                  maxBarSize={32}
                                  animationDuration={450}
                                />
                                <Bar
                                  dataKey="solarKwh"
                                  name="Solar (kWh)"
                                  stackId="pwr"
                                  fill="#16A34A"
                                  maxBarSize={32}
                                  radius={
                                    powerMixFactoryRows.length > 5
                                      ? [0, 3, 3, 0]
                                      : [3, 3, 0, 0]
                                  }
                                  animationDuration={450}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        )}
                      </div>

                      {/* Steam & Captive/Solar Generation Trend */}
                      <div className="lg:col-span-6 border border-slate-200 rounded-xl p-4 sm:p-5">
                        <div className="mb-3">
                          <h4 className="text-sm font-bold text-slate-900">
                            Steam (kg) vs Generator &amp; Solar (kWh) Trend
                          </h4>
                          <p className="text-xs text-slate-500">
                            Track boiler steam generation alongside captive generator and solar electricity
                          </p>
                        </div>

                        {generationAnalytics.trendPoints.length === 0 ? (
                          <div className="h-64 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                            No generation timeline points in the active period.
                          </div>
                        ) : (
                        <div className="h-64 w-full">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <LineChart
                              data={generationAnalytics.trendPoints}
                              margin={{ top: 8, right: 16, left: 6, bottom: 4 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                              <XAxis
                                dataKey="label"
                                minTickGap={18}
                                tick={{ fontSize: 11, fill: '#475569' }}
                              />
                              <YAxis
                                yAxisId="power"
                                tickFormatter={(v) => formatNumber(Number(v), 0)}
                                tick={{ fontSize: 11, fill: '#475569' }}
                                width={54}
                              />
                              <YAxis
                                yAxisId="steam"
                                orientation="right"
                                tickFormatter={(v) => formatNumber(Number(v), 0)}
                                tick={{ fontSize: 11, fill: '#EA580C' }}
                                width={56}
                              />
                              <Tooltip
                                formatter={(value, name) => [
                                  formatNumber(Number(value)),
                                  String(name),
                                ]}
                              />
                              <Legend />
                              <Line
                                yAxisId="power"
                                type="monotone"
                                dataKey="generatorKwh"
                                name="Generator (kWh)"
                                stroke="#E0A100"
                                strokeWidth={2.2}
                                dot={{ r: 3 }}
                                animationDuration={450}
                              />
                              <Line
                                yAxisId="power"
                                type="monotone"
                                dataKey="solarKwh"
                                name="Solar (kWh)"
                                stroke="#16A34A"
                                strokeWidth={2.4}
                                dot={{ r: 3 }}
                                animationDuration={450}
                              />
                              <Line
                                yAxisId="steam"
                                type="monotone"
                                dataKey="steamKg"
                                name="Steam (kg)"
                                stroke="#EA580C"
                                strokeDasharray="4 4"
                                strokeWidth={2}
                                dot={{ r: 2.5 }}
                                animationDuration={450}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        )}
                      </div>
                    </div>

                    {/* Plant-by-Plant Equipment & Generation Efficiency Table */}
                    {generationAnalytics.factoryRows.length > 0 && (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                              <th className="py-3 px-4 whitespace-nowrap">Factory</th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Boilers
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Steam (kg)
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Steam Cost &amp; Yield
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Generators
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Gen Power (kWh)
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Gen Cost &amp; Yield
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Solar (kWh)
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Solar Saved (Total)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-sm">
                            {generationAnalytics.factoryRows.map((row) => (
                              <tr
                                key={row.company}
                                onClick={() =>
                                  setSelectedCompany((prev) =>
                                    prev === row.company ? 'ALL' : row.company
                                  )
                                }
                                className={`cursor-pointer transition-colors ${
                                  selectedCompany === row.company
                                    ? 'bg-teal-50/70'
                                    : 'hover:bg-slate-50/80'
                                }`}
                              >
                                <td className="py-2.5 px-4 font-semibold text-slate-900 whitespace-nowrap align-top">
                                  {row.company}
                                  {row.gridProvidersSummary.length > 0 && (
                                    <span className="block text-[11px] font-normal text-blue-700">
                                      Grid:{' '}
                                      {row.gridProvidersSummary
                                        .map((g) => `${g.provider} (${formatNumber(g.kwh, 0)})`)
                                        .join(' · ')}
                                    </span>
                                  )}
                                  {(row.peakGridKwh > 0 || row.offPeakGridKwh > 0) && (
                                    <span className="block text-[10px] font-normal text-slate-500">
                                      Peak {formatNumber(row.peakGridKwh, 0)} · Off-Peak{' '}
                                      {formatNumber(row.offPeakGridKwh, 0)} kWh
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 align-top">
                                  {row.boilerCount > 0
                                    ? formatNumber(row.boilerCount, 0)
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap align-top">
                                  {row.steamKg > 0
                                    ? `${formatNumber(row.steamKg)} kg`
                                    : '—'}
                                  {row.steamPerHour !== null && (
                                    <span className="block text-[11px] font-normal text-orange-700">
                                      {formatNumber(row.steamPerHour, 1)} kg/hr · {formatNumber(row.boilerHours, 1)}h
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-xs whitespace-nowrap align-top">
                                  {row.steamCostPerKg !== null ? (
                                    <span className="font-semibold text-teal-800">
                                      ৳ {formatNumber(row.steamCostPerKg, 2)}/kg
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                  {row.boilerFuelCost > 0 && (
                                    <span className="block text-[11px] text-slate-600">
                                      Fuel: {formatCurrency(row.boilerFuelCost)}
                                    </span>
                                  )}
                                  {row.steamYield !== null ? (
                                    <span className="block text-[11px] text-slate-500">
                                      {formatNumber(row.steamYield, 2)} kg/
                                      {row.boilerFuelUnit}
                                    </span>
                                  ) : (
                                    row.boilerFuelSummary.length > 0 && (
                                      <span className="block text-[11px] text-slate-500">
                                        {row.boilerFuelSummary
                                          .map((b) => `${formatNumber(b.qty, 0)} ${b.unit}`)
                                          .join(' + ')}
                                      </span>
                                    )
                                  )}
                                  {(row.boilerUnits.length > 1 ||
                                    row.boilerUnits.some((bu) => bu.fuelMode === 'dual')) && (
                                    <div className="mt-1 pt-1 border-t border-slate-200/70 space-y-0.5 text-[10px] text-slate-600">
                                      {row.boilerUnits.map((bu) => (
                                        <div key={bu.key}>
                                          {bu.deviceName}:{' '}
                                          {bu.fuelMode === 'dual'
                                            ? `${formatNumber(bu.fuelQty, 0)} ${bu.fuelUnit} + ${formatNumber(bu.secondaryFuelQty, 0)} ${bu.secondaryFuelUnit || 'L'}`
                                            : bu.yieldPerFuel !== null
                                            ? `${formatNumber(bu.yieldPerFuel, 1)} kg/${bu.fuelUnit}`
                                            : `${formatNumber(bu.steamKg, 0)} kg`}
                                          {bu.steamPerHour !== null &&
                                            ` · ${formatNumber(bu.steamPerHour, 1)} kg/hr`}
                                          {bu.costPerKg !== null &&
                                            ` (৳${formatNumber(bu.costPerKg, 2)})`}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap align-top">
                                  {row.generatorCount > 0 ? (
                                    <>
                                      {formatNumber(row.generatorCount, 0)}
                                      {(row.dieselGeneratorCount > 0 ||
                                        row.gasGeneratorCount > 0) && (
                                        <span className="block text-[11px] text-slate-500">
                                          {row.dieselGeneratorCount}D / {row.gasGeneratorCount}G
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap align-top">
                                  {row.generatorKwh > 0 ? (
                                    <>
                                      {formatNumber(row.generatorKwh)} kWh
                                      {row.genAvgKw !== null && (
                                        <span className="block text-[11px] font-normal text-amber-700">
                                          Avg {formatNumber(row.genAvgKw, 1)} kW · {formatNumber(row.generatorHours, 1)}h
                                        </span>
                                      )}
                                      {(row.dieselGenKwh > 0 || row.gasGenKwh > 0) && (
                                        <span className="block text-[11px] font-normal text-slate-500">
                                          D: {formatNumber(row.dieselGenKwh, 0)} · G:{' '}
                                          {formatNumber(row.gasGenKwh, 0)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-xs whitespace-nowrap align-top">
                                  {row.genCostPerKwh !== null ? (
                                    <span className="font-semibold text-teal-800">
                                      ৳ {formatNumber(row.genCostPerKwh, 2)}/kWh
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                  {row.generatorFuelCost > 0 && (
                                    <span className="block text-[11px] text-slate-600">
                                      Fuel: {formatCurrency(row.generatorFuelCost)}
                                    </span>
                                  )}
                                  {(row.dieselCostPerKwh !== null ||
                                    row.gasCostPerKwh !== null) ? (
                                    <span className="block text-[11px] text-slate-500">
                                      {row.dieselCostPerKwh !== null
                                        ? `D: ৳${formatNumber(row.dieselCostPerKwh, 2)}`
                                        : ''}
                                      {row.dieselCostPerKwh !== null &&
                                      row.gasCostPerKwh !== null
                                        ? ' · '
                                        : ''}
                                      {row.gasCostPerKwh !== null
                                        ? `G: ৳${formatNumber(row.gasCostPerKwh, 2)}`
                                        : ''}
                                    </span>
                                  ) : (
                                    row.genYield !== null && (
                                      <span className="block text-[11px] text-slate-500">
                                        {formatNumber(row.genYield, 2)} kWh/
                                        {row.generatorFuelUnit}
                                      </span>
                                    )
                                  )}
                                  {(row.generatorUnits.length > 1 ||
                                    row.generatorUnits.some((gu) => gu.fuelMode === 'dual')) && (
                                    <div className="mt-1 pt-1 border-t border-slate-200/70 space-y-0.5 text-[10px] text-slate-600">
                                      {row.generatorUnits.map((gu) => (
                                        <div key={gu.key}>
                                          {gu.deviceName} (
                                          {gu.fuelMode === 'dual'
                                            ? `${gu.fuelUnit}+${gu.secondaryFuelUnit || 'L'}`
                                            : gu.fuelMode === 'cng' ||
                                              gu.fuelMode === 'lng' ||
                                              gu.fuelMode === 'lpg' ||
                                              gu.fuelMode === 'sng'
                                            ? `${getFuelLabel(gu.fuelMode)} ${gu.fuelUnit}`
                                            : gu.fuelUnit}
                                          ): {formatNumber(gu.kwh, 0)} kWh
                                          {gu.avgKw !== null && ` (${formatNumber(gu.avgKw, 1)} kW)`}
                                          {gu.costPerKwh !== null &&
                                            ` · ৳${formatNumber(gu.costPerKwh, 2)}`}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-emerald-700 whitespace-nowrap align-top">
                                  {row.solarKwh > 0 ? (
                                    <>
                                      {formatNumber(row.solarKwh)} kWh
                                      {row.solarAvgKw !== null && (
                                        <span className="block text-[11px] font-normal text-emerald-600">
                                          Avg {formatNumber(row.solarAvgKw, 1)} kW · {formatNumber(row.solarHours, 1)}h
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right tabular-nums text-xs whitespace-nowrap align-top">
                                  {row.solarSavings > 0 || row.solarKwh > 0 ? (
                                    <>
                                      <span className="font-semibold text-emerald-800">
                                        {formatCurrency(row.solarSavings)}
                                      </span>
                                      <span className="block text-[11px] text-slate-500">
                                        Total saved · {formatPercent(row.solarSharePct)} share
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* Factory Efficiency & Unit Cost Benchmarking Table (Executive Overview) */}
            {dashboardView === 'overview' &&
              (companyBenchmarkRows.length > 0 || benchmarkSearch.trim() !== '') && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Factory Efficiency &amp; Unit Cost Benchmarking
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sort any column or click a factory row to filter the dashboard.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {visibleCompanyNames.length > 5 && (
                      <div className="relative w-56">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={benchmarkSearch}
                          onChange={(e) => setBenchmarkSearch(e.target.value)}
                          placeholder="Find factory..."
                          aria-label="Filter factories in benchmarking table"
                          className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                        {benchmarkSearch && (
                          <button
                            type="button"
                            onClick={() => setBenchmarkSearch('')}
                            aria-label="Clear factory filter"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {selectedCompany !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setSelectedCompany('ALL')}
                        className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Show All Factories
                      </button>
                    )}
                  </div>
                </div>

                {companyBenchmarkRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No factories match &ldquo;{benchmarkSearch}&rdquo;.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 select-none">
                          <th
                            onClick={() => handleSortBenchmark('company')}
                            className="py-3 px-4 cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Factory {renderSortIcon('company')}
                          </th>
                          <th
                            onClick={() => handleSortBenchmark('activeDays')}
                            className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Active Days {renderSortIcon('activeDays')}
                          </th>
                          <th
                            onClick={() => handleSortBenchmark('totalHours')}
                            className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Run Hrs {renderSortIcon('totalHours')}
                          </th>
                          <th
                            onClick={() => handleSortBenchmark('totalCost')}
                            className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Total Cost {renderSortIcon('totalCost')}
                          </th>
                          <th
                            onClick={() => handleSortBenchmark('sharePct')}
                            className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Share {renderSortIcon('sharePct')}
                          </th>
                          <th
                            onClick={() => handleSortBenchmark('dailyAvg')}
                            className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                          >
                            Daily Avg {renderSortIcon('dailyAvg')}
                          </th>
                          {singleSelectedUtil ? (
                            <>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Usage ({singleSelectedUtil.unit})
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                Unit Cost (৳/{singleSelectedUtil.unit})
                              </th>
                              <th className="py-3 px-4 text-right whitespace-nowrap">
                                vs Group Avg
                              </th>
                            </>
                          ) : (
                            <th className="py-3 px-4">Unit Cost by Utility</th>
                          )}
                          {activeComparisonBounds && (
                            <th
                              onClick={() => handleSortBenchmark('deltaPct')}
                              className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                            >
                              {compareOpen ? 'Compare Δ' : 'Period Δ'}{' '}
                              {renderSortIcon('deltaPct')}
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {companyBenchmarkRows.map((row) => {
                          const groupAvgRate = singleSelectedUtil
                            ? utilityAvgUnitCostMap.get(singleSelectedUtil.id) ??
                              null
                            : null;
                          const rateDiffPct =
                            singleSelectedUtil &&
                            row.singleUtilAvgRate !== null &&
                            groupAvgRate !== null &&
                            groupAvgRate > 0
                              ? ((row.singleUtilAvgRate - groupAvgRate) /
                                  groupAvgRate) *
                                100
                              : null;

                          return (
                            <tr
                              key={row.company}
                              onClick={() =>
                                setSelectedCompany((prev) =>
                                  prev === row.company ? 'ALL' : row.company
                                )
                              }
                              className={`cursor-pointer transition-colors ${
                                selectedCompany === row.company
                                  ? 'bg-teal-50/70'
                                  : 'hover:bg-slate-50/80'
                              }`}
                            >
                              <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                                {row.company}
                                <span className="ml-2 text-xs font-normal text-slate-400 tabular-nums">
                                  ({formatNumber(row.entryCount, 0)})
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                                {formatNumber(row.activeDays, 0)}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                {row.totalHours > 0 ? (
                                  <>
                                    <span>{formatNumber(row.totalHours, 1)}h</span>
                                    {row.costPerHour !== null && (
                                      <span className="block text-[11px] text-teal-800">
                                        ৳{formatNumber(row.costPerHour, 0)}/hr
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                {formatCurrency(row.totalCost)}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                                {formatPercent(row.sharePct)}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-slate-800 whitespace-nowrap">
                                {formatCurrency(row.dailyAvg)}
                              </td>

                              {singleSelectedUtil ? (
                                <>
                                  <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                                    {formatNumber(row.totalConsumption)}
                                  </td>
                                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-teal-800 whitespace-nowrap">
                                    {row.singleUtilAvgRate !== null
                                      ? `৳ ${formatNumber(
                                          row.singleUtilAvgRate,
                                          2
                                        )}`
                                      : '—'}
                                  </td>
                                  <td className="py-3 px-4 text-right tabular-nums text-xs font-semibold whitespace-nowrap">
                                    {rateDiffPct !== null ? (
                                      <span
                                        className={
                                          rateDiffPct > 2
                                            ? 'text-rose-700'
                                            : rateDiffPct < -2
                                            ? 'text-emerald-700'
                                            : 'text-slate-600'
                                        }
                                      >
                                        {rateDiffPct >= 0 ? '+' : ''}
                                        {formatPercent(rateDiffPct)}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                </>
                              ) : (
                                <td className="py-3 px-4 text-xs text-slate-700">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                                    {activeUtilities.map((u) => {
                                      const st = row.byUtil.get(u.id);
                                      if (!st || (st.consumption <= 0 && st.cost <= 0))
                                        return null;
                                      const rate =
                                        st.consumption > 0
                                          ? st.cost / st.consumption
                                          : null;
                                      return (
                                        <span
                                          key={u.id}
                                          className="whitespace-nowrap"
                                        >
                                          <span className="font-medium text-slate-600">
                                            {u.name}:
                                          </span>{' '}
                                          <span className="font-semibold text-teal-800">
                                            {rate !== null && u.unit
                                              ? `৳${formatNumber(rate, 2)}/${u.unit}`
                                              : formatCurrency(st.cost)}
                                          </span>
                                        </span>
                                      );
                                    })}
                                    {row.totalCost === 0 && (
                                      <span className="text-slate-400">
                                        No entries
                                      </span>
                                    )}
                                  </div>
                                </td>
                              )}

                              {activeComparisonBounds && (
                                <td className="py-3 px-4 text-right tabular-nums text-xs font-semibold whitespace-nowrap">
                                  {row.deltaPct !== null ? (
                                    <span
                                      className={
                                        row.deltaPct >= 0
                                          ? 'text-rose-700'
                                          : 'text-emerald-700'
                                      }
                                      title={
                                        row.prevCost !== null
                                          ? `Compare total: ${formatCurrency(
                                              row.prevCost
                                            )}${
                                              row.dailyDeltaPct !== null
                                                ? ` | Daily avg ${
                                                    row.dailyDeltaPct >= 0
                                                      ? '+'
                                                      : ''
                                                  }${formatPercent(
                                                    row.dailyDeltaPct
                                                  )}`
                                                : ''
                                            }`
                                          : undefined
                                      }
                                    >
                                      {row.deltaPct >= 0 ? '+' : ''}
                                      {formatPercent(row.deltaPct)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 15-Year Data Analyst Validation Workbench & Detailed Ledger */}
            {dashboardView === 'audit' && (
              <motion.div
                key="view-audit"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="space-y-6"
              >
                {/* Validation Summary & Completeness Matrix */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                        Data Quality, Completeness &amp; Anomaly Validation
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Statistical baseline checks (±20% tariff drift, ±35% hourly burn variance, missing run hours, and logging coverage)
                      </p>
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      Checked{' '}
                      <strong className="text-slate-900">
                        {formatNumber(
                          validationSummary.totalUtilityRecords +
                            validationSummary.totalGenerationRecords,
                          0
                        )}
                      </strong>{' '}
                      entries across{' '}
                      <strong className="text-slate-900">
                        {formatNumber(validationSummary.factoryCoverage.length, 0)}
                      </strong>{' '}
                      factories
                    </div>
                  </div>

                  {/* Single-Elevation 4-Metric Validation Health Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-b border-slate-200 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500">Data Integrity Score</div>
                      <div className="text-2xl font-bold text-slate-900 tabular-nums">
                        {formatNumber(validationSummary.healthScorePct, 0)}%
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {validationSummary.criticalCount} critical · {validationSummary.warningCount} warnings
                      </div>
                    </div>

                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500">Factory-Day Coverage</div>
                      <div className="text-2xl font-bold text-slate-900 tabular-nums">
                        {formatPercent(validationSummary.coveragePct)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatNumber(validationSummary.loggedFactoryDays, 0)} of{' '}
                        {formatNumber(validationSummary.expectedFactoryDays, 0)} expected days
                      </div>
                    </div>

                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500">Run Hours Completeness</div>
                      <div className="text-2xl font-bold text-slate-900 tabular-nums">
                        {formatPercent(validationSummary.hoursCompletenessPct)}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatNumber(validationSummary.missingHoursCount, 0)} logs missing runtime hrs
                      </div>
                    </div>

                    <div className="p-4 space-y-1">
                      <div className="text-xs text-slate-500">Tariff Spike Variance</div>
                      <div className="text-2xl font-bold text-amber-800 tabular-nums">
                        {validationSummary.estimatedRateVarianceBdt > 0
                          ? formatCurrency(validationSummary.estimatedRateVarianceBdt)
                          : '৳ 0.00'}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatNumber(validationSummary.rateOutlierCount, 0)} rate outliers ·{' '}
                        {formatNumber(validationSummary.intensityOutlierCount, 0)} burn spikes
                      </div>
                    </div>
                  </div>

                  {/* Two-column Completeness & Exception Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                    {/* Factory Completeness Table */}
                    <div className="lg:col-span-5 overflow-x-auto max-h-[340px]">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wide sticky top-0">
                            <th className="py-2.5 px-4">Factory</th>
                            <th className="py-2.5 px-4 text-right">Days</th>
                            <th className="py-2.5 px-4 text-right">Run Hrs %</th>
                            <th className="py-2.5 px-4 text-right">Flags</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {validationSummary.factoryCoverage.map((fc) => (
                            <tr
                              key={fc.company}
                              onClick={() =>
                                setSelectedCompany((prev) =>
                                  prev === fc.company ? 'ALL' : fc.company
                                )
                              }
                              className={`cursor-pointer transition-colors ${
                                selectedCompany === fc.company
                                  ? 'bg-teal-50/70'
                                  : 'hover:bg-slate-50/70'
                              }`}
                            >
                              <td className="py-2.5 px-4 font-semibold text-slate-900 whitespace-nowrap">
                                {fc.company}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                {fc.loggedDays}/{fc.expectedDays} ({formatNumber(fc.coveragePct, 0)}%)
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums font-medium whitespace-nowrap">
                                <span
                                  className={
                                    fc.hoursCompletenessPct >= 90
                                      ? 'text-emerald-700'
                                      : fc.hoursCompletenessPct >= 60
                                      ? 'text-amber-700'
                                      : 'text-rose-700'
                                  }
                                >
                                  {formatNumber(fc.hoursCompletenessPct, 0)}%
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums font-semibold whitespace-nowrap">
                                {fc.issueCount > 0 ? (
                                  <span className="text-amber-700">{fc.issueCount}</span>
                                ) : (
                                  <span className="text-emerald-700">0</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Top Validation Exceptions */}
                    <div className="lg:col-span-7 overflow-y-auto max-h-[340px]">
                      {validationSummary.issues.length === 0 ? (
                        <div className="h-full min-h-[180px] flex flex-col items-center justify-center p-6 text-center space-y-2">
                          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                          <div className="text-sm font-semibold text-slate-900">
                            Zero Exceptions Detected
                          </div>
                          <p className="text-xs text-slate-500 max-w-sm">
                            All meter readings, tariffs, and runtime hours in this window match historical operating baselines.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {validationSummary.issues.slice(0, 25).map((iss) => (
                            <div
                              key={iss.id}
                              className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span
                                    className={`font-semibold ${
                                      iss.severity === 'critical'
                                        ? 'text-rose-700'
                                        : 'text-amber-700'
                                    }`}
                                  >
                                    {iss.title}
                                  </span>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span className="font-medium text-slate-900">
                                    {iss.company}
                                  </span>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span className="text-slate-600">{iss.assetName}</span>
                                </div>
                                <div className="text-xs text-slate-500">
                                  {iss.detail}
                                </div>
                              </div>
                              <div className="text-right shrink-0 text-xs tabular-nums">
                                <div className="font-medium text-slate-700">
                                  {formatShortDate(iss.date)}
                                </div>
                                {iss.bdtImpact !== undefined && iss.bdtImpact > 0 && (
                                  <div className="text-[11px] font-semibold text-rose-700">
                                    +{formatCurrency(iss.bdtImpact)}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detailed Ledger with Validation Filters */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Detailed Audit Ledger
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {formatNumber(tableRows.length, 0)} matching records
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                        {(
                          [
                            ['all', `All (${filteredEntries.length})`],
                            [
                              'exceptions',
                              `Exceptions (${filteredEntries.filter((e) => (validationSummary.entryIssuesMap.get(e.id)?.length || 0) > 0).length})`,
                            ],
                            ['rate_outlier', `Rate Spikes (${validationSummary.rateOutlierCount})`],
                            ['missing_hours', `Missing Hrs (${validationSummary.missingHoursCount})`],
                            ['zero_cost', `Zero Cost (${validationSummary.zeroCostCount})`],
                          ] as [AuditLedgerFilter, string][]
                        ).map(([key, label]) => {
                          const isSelected = auditFilter === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setAuditFilter(key)}
                              className={`relative px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                                isSelected
                                  ? 'text-slate-900 font-semibold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {isSelected && (
                                <motion.span
                                  layoutId="dashAuditFilterPill"
                                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                                  className="absolute inset-0 bg-white rounded-md shadow-sm"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="relative z-10">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="relative w-full lg:w-72">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search factory, utility, or note..."
                        className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                      {searchTerm && (
                        <button
                          type="button"
                          onClick={() => setSearchTerm('')}
                          aria-label="Clear search"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {tableRows.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-500">
                      No records match your current search or audit filter.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                              <th className="py-3 px-4">Date</th>
                              <th className="py-3 px-4">Factory</th>
                              <th className="py-3 px-4">Utility</th>
                              <th className="py-3 px-4 text-right">Consumption</th>
                              <th className="py-3 px-4 text-right">Run Hrs</th>
                              <th className="py-3 px-4 text-right">Rate/Hr</th>
                              <th className="py-3 px-4 text-right">Cost</th>
                              <th className="py-3 px-4 text-right">Unit Cost</th>
                              <th className="py-3 px-4">Validation</th>
                              <th className="py-3 px-4">Note</th>
                              <th className="py-3 px-4">Entered By</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-sm">
                            {tableRows.slice(0, tableLimit).map((row) => {
                              const meta = utilityMap.get(row.utilityId);
                              const unitLabel = meta?.unit || row.unit;
                              const rowHrs = Number(row.operatingHours) || 0;
                              const rowHourlyRate =
                                rowHrs > 0 && row.consumption > 0
                                  ? row.consumption / rowHrs
                                  : null;
                              const unitCost =
                                row.consumption > 0
                                  ? row.cost / row.consumption
                                  : null;
                              const periodAvg = utilityAvgUnitCostMap.get(
                                row.utilityId
                              );
                              const rowIssues =
                                validationSummary.entryIssuesMap.get(row.id) || [];
                              const hasCritical = rowIssues.some(
                                (i) => i.severity === 'critical'
                              );
                              const isHighRate =
                                (unitCost !== null &&
                                  periodAvg !== undefined &&
                                  periodAvg > 0 &&
                                  unitCost > periodAvg * 1.15) ||
                                rowIssues.some((i) => i.category === 'rate_outlier');

                              return (
                                <tr key={row.id} className="hover:bg-slate-50/70">
                                  <td className="py-2.5 px-4 whitespace-nowrap text-slate-700 tabular-nums">
                                    {formatDate(row.date)}
                                  </td>
                                  <td className="py-2.5 px-4 font-medium text-slate-900 whitespace-nowrap">
                                    {row.company}
                                  </td>
                                  <td className="py-2.5 px-4 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-2 text-slate-800">
                                      <span
                                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                                        style={{
                                          backgroundColor: meta?.color || '#64748B',
                                        }}
                                      />
                                      {meta?.name || row.utilityName}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-right tabular-nums text-slate-800 whitespace-nowrap">
                                    {formatNumber(row.consumption)} {unitLabel}
                                  </td>
                                  <td className="py-2.5 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
                                    {rowHrs > 0 ? `${formatNumber(rowHrs, 1)} hr` : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right tabular-nums font-medium text-slate-700 whitespace-nowrap">
                                    {rowHourlyRate !== null
                                      ? `${formatNumber(rowHourlyRate, 2)} ${unitLabel}/hr`
                                      : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                                    {formatCurrency(row.cost)}
                                  </td>
                                  <td
                                    className={`py-2.5 px-4 text-right tabular-nums font-medium whitespace-nowrap ${
                                      isHighRate
                                        ? 'text-amber-700 font-semibold'
                                        : 'text-teal-800'
                                    }`}
                                    title={
                                      isHighRate && periodAvg
                                        ? `Above baseline (period avg ৳${formatNumber(
                                            periodAvg,
                                            2
                                          )}/${unitLabel})`
                                        : undefined
                                    }
                                  >
                                    {unitCost !== null
                                      ? `৳ ${formatNumber(unitCost, 2)}/${unitLabel}`
                                      : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                                    {rowIssues.length === 0 ? (
                                      <span className="text-emerald-700 font-medium">
                                        Verified
                                      </span>
                                    ) : (
                                      <span
                                        title={rowIssues.map((i) => i.detail).join(' | ')}
                                        className={`font-semibold ${
                                          hasCritical ? 'text-rose-700' : 'text-amber-700'
                                        }`}
                                      >
                                        {rowIssues.map((i) => i.title).join(' · ')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                                    {row.note || '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">
                                    {row.enteredByName}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {tableRows.length > tableLimit && (
                        <div className="p-4 border-t border-slate-200 text-center">
                          <button
                            type="button"
                            onClick={() => setTableLimit((prev) => prev + 25)}
                            className="px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors cursor-pointer"
                          >
                            Show More (
                            {formatNumber(tableRows.length - tableLimit, 0)}{' '}
                            remaining)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </>
        )}

        {profile?.role === 'admin' && sheetsConfig && (
          <GoogleSheetsSyncModal
            open={syncModalOpen}
            spreadsheetTitle={sheetsConfig.spreadsheetTitle}
            sheetName={sheetsConfig.sheetName}
            recordCount={entries.length + generationEntries.length}
            syncing={syncingSheets}
            onConfirm={() => void handleConfirmSyncSheets()}
            onCancel={() => setSyncModalOpen(false)}
          />
        )}
      </div>
    </MotionConfig>
  );
}
