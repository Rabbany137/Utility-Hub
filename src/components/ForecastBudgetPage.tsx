import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
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
  Copy,
  Download,
  Edit3,
  Flame,
  Leaf,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { ActivePage } from '../types';
import {
  EMISSION_FACTORS,
  buildMonthlyBudgetForecast,
  type BudgetPaceStatus,
  type FactoryForecastRow,
} from '../utils/forecastCarbon';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  getTodayISO,
} from '../utils/formatters';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const STATUS_META: Record<
  BudgetPaceStatus,
  { label: string; textClass: string; barClass: string }
> = {
  onTrack: {
    label: 'On Track',
    textClass: 'text-emerald-700',
    barClass: 'bg-emerald-600',
  },
  watch: {
    label: 'Watch Pace',
    textClass: 'text-amber-700',
    barClass: 'bg-amber-500',
  },
  overPace: {
    label: 'Over Pace',
    textClass: 'text-rose-700',
    barClass: 'bg-rose-600',
  },
  unconfigured: {
    label: 'No Budget Set',
    textClass: 'text-slate-500',
    barClass: 'bg-slate-300',
  },
};

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatTonnesOrKg(kg: number): string {
  if (Math.abs(kg) >= 1000) {
    return `${formatNumber(kg / 1000, 2)} tCO₂e`;
  }
  return `${formatNumber(kg, 0)} kg CO₂e`;
}

export function ForecastBudgetPage({
  onNavigate,
}: {
  onNavigate?: (page: ActivePage) => void;
}) {
  const {
    profile,
    companies,
    utilities,
    entries,
    generationEntries,
    budgets,
    saveFactoryBudget,
    deleteFactoryBudget,
  } = useApp();

  const isAdmin = profile?.role === 'admin';
  const todayISO = getTodayISO();
  const currentMonthKey = todayISO.slice(0, 7);
  const prevMonthKey = shiftMonthKey(currentMonthKey, -1);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);
  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');

  // Inline budget editor state
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<{
    companyId: string;
    companyName: string;
    monthlySpendLimit: string;
    monthlyCarbonCapKg: string;
    targetSolarSharePct: string;
    alertThresholdPct: string;
    notes: string;
  } | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Interactive "What-If" Optimizer Sliders
  const [solarExpansionPct, setSolarExpansionPct] = useState<number>(25);
  const [dieselToGridPct, setDieselToGridPct] = useState<number>(40);
  const [tariffShiftPct, setTariffShiftPct] = useState<number>(0);
  const [runtimeOptPct, setRuntimeOptPct] = useState<number>(5);

  const visibleCompanies = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'admin') {
      return companies.map((c) => c.name);
    }
    const allowedSet = new Set(profile.viewCompanies);
    return companies.filter((c) => allowedSet.has(c.name)).map((c) => c.name);
  }, [profile, companies]);

  const scopeCompanyNames = useMemo(() => {
    if (selectedCompany !== 'ALL' && visibleCompanies.includes(selectedCompany)) {
      return [selectedCompany];
    }
    return visibleCompanies;
  }, [selectedCompany, visibleCompanies]);

  const bundle = useMemo(
    () =>
      buildMonthlyBudgetForecast({
        monthKey: selectedMonth,
        companies,
        scopeCompanyNames,
        utilities,
        entries,
        generationEntries,
        budgets,
        todayISO,
      }),
    [
      selectedMonth,
      companies,
      scopeCompanyNames,
      utilities,
      entries,
      generationEntries,
      budgets,
      todayISO,
    ]
  );

  // Live "What-If" Simulation Calculations anchored on real plant baseline
  const simulation = useMemo(() => {
    const base = bundle.simulationBaseline;
    const solarBaseKwh =
      base.projectedSolarKwh > 0
        ? base.projectedSolarKwh
        : Math.max(0, (base.projectedGridKwh + base.projectedDieselGenKwh) * 0.08);

    const addedSolarKwh = solarBaseKwh * (solarExpansionPct / 100);
    const solarDisplacesGridKwh = Math.min(base.projectedGridKwh, addedSolarKwh);
    const solarDisplacesDieselKwh = Math.max(
      0,
      Math.min(
        base.projectedDieselGenKwh,
        addedSolarKwh - solarDisplacesGridKwh
      )
    );

    const remainingDieselAfterSolar = Math.max(
      0,
      base.projectedDieselGenKwh - solarDisplacesDieselKwh
    );
    const shiftedDieselToGridKwh =
      remainingDieselAfterSolar * (dieselToGridPct / 100);

    const simGridKwh = Math.max(
      0,
      base.projectedGridKwh - solarDisplacesGridKwh + shiftedDieselToGridKwh
    );
    const simDieselKwh = Math.max(
      0,
      remainingDieselAfterSolar - shiftedDieselToGridKwh
    );

    const tariffMultiplier = 1 + tariffShiftPct / 100;
    const runtimeMultiplier = Math.max(0.5, 1 - runtimeOptPct / 100);

    const simGridCost = simGridKwh * base.gridRatePerKwh * tariffMultiplier;
    const simDieselCost = simDieselKwh * base.dieselRatePerKwh * tariffMultiplier;
    const simOtherCost =
      base.projectedOtherFuelAndUtilCost * tariffMultiplier * runtimeMultiplier;

    const simTotalCost = simGridCost + simDieselCost + simOtherCost;
    const monthlySavings = base.projectedEomCost - simTotalCost;

    const deltaGridKg =
      (simGridKwh - base.projectedGridKwh) * EMISSION_FACTORS.gridKwhKg;
    const dieselAvgKgPerKwh = 0.72; // ~0.27 L/kWh * 2.68 kg/L
    const deltaDieselKg =
      (simDieselKwh - base.projectedDieselGenKwh) * dieselAvgKgPerKwh;
    const simGrossCarbonKg = Math.max(
      0,
      base.projectedGrossCarbonKg * runtimeMultiplier + deltaGridKg + deltaDieselKg
    );
    const carbonSavedKg = Math.max(
      0,
      base.projectedGrossCarbonKg - simGrossCarbonKg
    );

    return {
      baseCost: base.projectedEomCost,
      simTotalCost,
      monthlySavings,
      annualizedSavings: monthlySavings * 12,
      addedSolarKwh,
      shiftedDieselToGridKwh,
      baseCarbonKg: base.projectedGrossCarbonKg,
      simGrossCarbonKg,
      carbonSavedKg,
      chartRows: [
        {
          name: 'Current Trajectory',
          cost: base.projectedEomCost,
          carbonKg: base.projectedGrossCarbonKg,
          fill: '#64748B',
        },
        {
          name: 'Simulated Scenario',
          cost: simTotalCost,
          carbonKg: simGrossCarbonKg,
          fill: simTotalCost <= base.projectedEomCost ? '#0F766E' : '#D97706',
        },
      ],
    };
  }, [
    bundle.simulationBaseline,
    solarExpansionPct,
    dieselToGridPct,
    tariffShiftPct,
    runtimeOptPct,
  ]);

  const handleOpenBudgetEditor = (row: FactoryForecastRow) => {
    if (!isAdmin) return;
    setToast(null);
    if (editingCompanyId === row.companyId) {
      setEditingCompanyId(null);
      setBudgetDraft(null);
      return;
    }
    const existing = row.budget;
    const suggestedCap =
      row.projectedEomCost > 0
        ? Math.round((row.projectedEomCost * 1.05) / 1000) * 1000
        : '';

    setEditingCompanyId(row.companyId);
    setBudgetDraft({
      companyId: row.companyId,
      companyName: row.companyName,
      monthlySpendLimit: existing
        ? String(existing.monthlySpendLimit)
        : row.prevMonthBudget
        ? String(row.prevMonthBudget.monthlySpendLimit)
        : String(suggestedCap),
      monthlyCarbonCapKg:
        existing?.monthlyCarbonCapKg !== undefined
          ? String(existing.monthlyCarbonCapKg)
          : row.prevMonthBudget?.monthlyCarbonCapKg !== undefined
          ? String(row.prevMonthBudget.monthlyCarbonCapKg)
          : '',
      targetSolarSharePct:
        existing?.targetSolarSharePct !== undefined
          ? String(existing.targetSolarSharePct)
          : row.prevMonthBudget?.targetSolarSharePct !== undefined
          ? String(row.prevMonthBudget.targetSolarSharePct)
          : '15',
      alertThresholdPct: existing
        ? String(existing.alertThresholdPct)
        : String(row.prevMonthBudget?.alertThresholdPct ?? 85),
      notes: existing?.notes || '',
    });
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetDraft) return;
    const spendCap = Number(budgetDraft.monthlySpendLimit);
    if (!Number.isFinite(spendCap) || spendCap < 0) {
      setToast({
        type: 'error',
        text: 'Please enter a valid non-negative monthly spend limit.',
      });
      return;
    }
    const carbonCap =
      budgetDraft.monthlyCarbonCapKg.trim() !== ''
        ? Number(budgetDraft.monthlyCarbonCapKg)
        : undefined;
    const solarTarget =
      budgetDraft.targetSolarSharePct.trim() !== ''
        ? Number(budgetDraft.targetSolarSharePct)
        : undefined;
    const threshold = Math.max(
      50,
      Math.min(100, Number(budgetDraft.alertThresholdPct) || 85)
    );

    setSavingBudget(true);
    setToast(null);
    try {
      await saveFactoryBudget({
        companyId: budgetDraft.companyId,
        companyName: budgetDraft.companyName,
        month: bundle.bounds.monthKey,
        monthlySpendLimit: spendCap,
        monthlyCarbonCapKg:
          carbonCap !== undefined && Number.isFinite(carbonCap)
            ? carbonCap
            : undefined,
        targetSolarSharePct:
          solarTarget !== undefined && Number.isFinite(solarTarget)
            ? solarTarget
            : undefined,
        alertThresholdPct: threshold,
        notes: budgetDraft.notes.trim(),
      });
      setToast({
        type: 'success',
        text: `Saved ${bundle.bounds.monthLabel} budget & targets for ${budgetDraft.companyName}.`,
      });
      setEditingCompanyId(null);
      setBudgetDraft(null);
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save budget.',
      });
    } finally {
      setSavingBudget(false);
    }
  };

  const handleCopyAllPrevBudgets = async () => {
    if (!isAdmin) return;
    const candidates = bundle.factoryRows.filter(
      (r) => !r.budget && r.prevMonthBudget
    );
    if (candidates.length === 0) return;

    setSavingBudget(true);
    setToast(null);
    try {
      for (const r of candidates) {
        const prev = r.prevMonthBudget!;
        await saveFactoryBudget({
          companyId: r.companyId,
          companyName: r.companyName,
          month: bundle.bounds.monthKey,
          monthlySpendLimit: prev.monthlySpendLimit,
          monthlyCarbonCapKg: prev.monthlyCarbonCapKg,
          targetSolarSharePct: prev.targetSolarSharePct,
          alertThresholdPct: prev.alertThresholdPct,
          notes: prev.notes,
        });
      }
      setToast({
        type: 'success',
        text: `Carried forward ${formatNumber(candidates.length, 0)} prior-month factory budget(s) into ${bundle.bounds.monthLabel}.`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to carry forward budgets.',
      });
    } finally {
      setSavingBudget(false);
    }
  };

  const handleDeleteBudget = async (row: FactoryForecastRow) => {
    if (!isAdmin || !row.budget) return;
    setSavingBudget(true);
    setToast(null);
    try {
      await deleteFactoryBudget(row.budget.id);
      setToast({
        type: 'success',
        text: `Removed ${bundle.bounds.monthLabel} budget cap for ${row.companyName}.`,
      });
      if (editingCompanyId === row.companyId) {
        setEditingCompanyId(null);
        setBudgetDraft(null);
      }
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete budget.',
      });
    } finally {
      setSavingBudget(false);
    }
  };

  const handleExportCSV = () => {
    const lines = [
      [
        'Factory',
        'Month',
        'MTD Spend (BDT)',
        'Projected EOM Spend (BDT)',
        'Monthly Budget (BDT)',
        'Projected Variance (BDT)',
        'Status',
        'MTD Gross CO2e (kg)',
        'Solar Avoided CO2e (kg)',
        'Net CO2e (kg)',
        'Solar Share (%)',
      ].join(','),
      ...bundle.factoryRows.map((r) =>
        [
          `"${r.companyName.replace(/"/g, '""')}"`,
          bundle.bounds.monthKey,
          r.mtdCost.toFixed(2),
          r.projectedEomCost.toFixed(2),
          r.monthlyBudgetCap !== null ? r.monthlyBudgetCap.toFixed(2) : '',
          r.varianceAtEom !== null ? r.varianceAtEom.toFixed(2) : '',
          STATUS_META[r.status].label,
          r.grossCarbonKg.toFixed(1),
          r.solarAvoidedKg.toFixed(1),
          r.netCarbonKg.toFixed(1),
          r.solarSharePct.toFixed(1),
        ].join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `UtilityHub_Budget_Carbon_${bundle.bounds.monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const carryForwardCount = bundle.factoryRows.filter(
    (r) => !r.budget && r.prevMonthBudget
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="space-y-6"
    >
      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSelectedMonth(currentMonthKey)}
                className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedMonth === currentMonthKey
                    ? 'text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {selectedMonth === currentMonthKey && (
                  <motion.span
                    layoutId="forecastMonthPill"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10">This Month</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMonth(prevMonthKey)}
                className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  selectedMonth === prevMonthKey
                    ? 'text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {selectedMonth === prevMonthKey && (
                  <motion.span
                    layoutId="forecastMonthPill"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10">Last Month</span>
              </button>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
              <Calendar className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              <input
                type="month"
                aria-label="Select budget month"
                value={selectedMonth}
                onChange={(e) => {
                  if (/^\d{4}-\d{2}$/.test(e.target.value)) {
                    setSelectedMonth(e.target.value);
                  }
                }}
                className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              />
            </div>

            {visibleCompanies.length > 1 && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                <Building2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <select
                  value={selectedCompany}
                  onChange={(e) => setSelectedCompany(e.target.value)}
                  aria-label="Filter forecast factory scope"
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

          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && carryForwardCount > 0 && (
              <button
                type="button"
                disabled={savingBudget}
                onClick={() => void handleCopyAllPrevBudgets()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-teal-50 border border-teal-200 text-teal-800 rounded-lg hover:bg-teal-100 disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Prior Month Budgets ({carryForwardCount})
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Forecast CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1 border-t border-slate-100 tabular-nums">
          <span>
            Cycle: <strong className="text-slate-800">{bundle.bounds.monthLabel}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Day {formatNumber(bundle.bounds.elapsedDays, 0)} of{' '}
            {formatNumber(bundle.bounds.daysInMonth, 0)} elapsed
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Configured budgets:{' '}
            <strong className="text-slate-800">
              {formatNumber(bundle.configuredFactoryCount, 0)}/
              {formatNumber(scopeCompanyNames.length, 0)}
            </strong>{' '}
            factories
          </span>
        </div>

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

      {/* 4-Card Forecast & Carbon KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
            <span>Month-to-Date Spend</span>
            <Target className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(bundle.mtdTotalCost)}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {bundle.totalConfiguredBudget > 0 ? (
              <>
                <span className="font-semibold text-slate-700">
                  {formatPercent(bundle.mtdBudgetPct || 0)}
                </span>{' '}
                of {formatCompactCurrency(bundle.totalConfiguredBudget)} cap
              </>
            ) : (
              `${formatNumber(bundle.activeDaysCount, 0)} active logged day(s)`
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
            <span>Projected Month-End</span>
            {bundle.projectedVariance !== null && bundle.projectedVariance > 0 ? (
              <TrendingUp className="w-4 h-4 text-rose-600" />
            ) : (
              <TrendingDown className="w-4 h-4 text-emerald-600" />
            )}
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(bundle.projectedEomCost)}
          </div>
          <div className="text-xs tabular-nums">
            {bundle.projectedVariance !== null ? (
              <span
                className={`font-semibold ${
                  bundle.projectedVariance > 0
                    ? 'text-rose-700'
                    : 'text-emerald-700'
                }`}
              >
                {bundle.projectedVariance > 0 ? '+' : ''}
                {formatCompactCurrency(bundle.projectedVariance)} vs budget
              </span>
            ) : (
              <span className="text-slate-500">
                Set factory budgets below to track variance
              </span>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
            <span>Net Carbon Emissions</span>
            <Leaf className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatTonnesOrKg(bundle.mtdNetCarbonKg)}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Gross {formatTonnesOrKg(bundle.mtdGrossCarbonKg)} · Solar offset{' '}
            <span className="font-semibold text-emerald-700">
              -{formatTonnesOrKg(bundle.mtdSolarAvoidedKg)}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
            <span>Clean Solar Mix</span>
            <Sun className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {formatPercent(bundle.solarSharePct)}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            {formatNumber(bundle.totalSolarKwh, 0)} kWh · Saved{' '}
            <span className="font-semibold text-emerald-700">
              {formatCompactCurrency(bundle.totalSolarSavings)}
            </span>
            {bundle.avgTargetSolarPct !== null &&
              ` · Target ${formatPercent(bundle.avgTargetSolarPct)}`}
          </div>
        </div>
      </div>

      {/* Trajectory Chart + Emissions Scope Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cumulative Spend Trajectory vs Monthly Budget Pace
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Day-by-day cumulative spend against ideal linear pace and projected month-end run rate
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                Actual MTD
              </span>
              {bundle.bounds.isCurrentMonth && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t-2 border-dashed border-amber-600 inline-block" />
                  Projected EOM
                </span>
              )}
              {bundle.totalConfiguredBudget > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-400 inline-block" />
                  Budget Pace
                </span>
              )}
            </div>
          </div>

          {bundle.mtdTotalCost === 0 && bundle.totalConfiguredBudget === 0 ? (
            <div className="h-[290px] flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-xl p-6 space-y-3">
              <p className="text-sm font-semibold text-slate-700">
                No spend logs or budgets recorded for {bundle.bounds.monthLabel}.
              </p>
              <p className="text-xs text-slate-500 max-w-md">
                Configure monthly factory spend caps below or log utility entries to view live burn velocity and EOM projections.
              </p>
              {onNavigate && (profile?.role === 'admin' || profile?.role === 'entry') && (
                <button
                  type="button"
                  onClick={() => onNavigate('entry')}
                  className="px-3.5 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg hover:bg-teal-800 cursor-pointer"
                >
                  Log Daily Entry
                </button>
              )}
            </div>
          ) : (
            <div className="h-[290px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={bundle.trajectory}
                  margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="mtdCumFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0F766E" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#0F766E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#E2E8F0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="dayLabel"
                    minTickGap={22}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={{ stroke: '#E2E8F0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCompactCurrency(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload as (typeof bundle.trajectory)[number];
                      return (
                        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs shadow-sm space-y-1">
                          <div className="font-bold text-slate-900">
                            {pt.date} (Day {pt.day})
                          </div>
                          {pt.dailyCost > 0 && (
                            <div className="text-slate-600 tabular-nums">
                              Day Spend: <strong>{formatCurrency(pt.dailyCost)}</strong>
                            </div>
                          )}
                          {pt.actualCumCost !== null && (
                            <div className="text-teal-800 tabular-nums">
                              Actual Cumulative:{' '}
                              <strong>{formatCurrency(pt.actualCumCost)}</strong>
                            </div>
                          )}
                          {pt.projectedCumCost !== null && (
                            <div className="text-amber-700 tabular-nums">
                              Projected EOM Path:{' '}
                              <strong>{formatCurrency(pt.projectedCumCost)}</strong>
                            </div>
                          )}
                          {pt.budgetPaceCost !== null && (
                            <div className="text-slate-600 tabular-nums">
                              Target Linear Pace:{' '}
                              <strong>{formatCurrency(pt.budgetPaceCost)}</strong>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  {bundle.totalConfiguredBudget > 0 && (
                    <ReferenceLine
                      y={bundle.totalConfiguredBudget}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      label={{
                        value: `Cap ${formatCompactCurrency(bundle.totalConfiguredBudget)}`,
                        position: 'insideTopRight',
                        fill: '#B91C1C',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  )}
                  {bundle.totalConfiguredBudget > 0 && (
                    <Line
                      type="monotone"
                      dataKey="budgetPaceCost"
                      stroke="#94A3B8"
                      strokeWidth={1.75}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="actualCumCost"
                    stroke="#0F766E"
                    strokeWidth={2.5}
                    fill="url(#mtdCumFill)"
                    connectNulls={false}
                    animationDuration={450}
                  />
                  {bundle.bounds.isCurrentMonth && (
                    <Line
                      type="monotone"
                      dataKey="projectedCumCost"
                      stroke="#D97706"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Carbon Scope 1 & 2 Breakdown */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Carbon Accounting (Scope 1 &amp; 2)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Calculated from logged grid kWh and fuel combustion
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <Flame className="w-3.5 h-3.5 text-orange-600" />
                    Scope 1 (Gas &amp; Diesel Fuels)
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatTonnesOrKg(bundle.mtdScope1Kg)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{
                      scaleX:
                        bundle.mtdGrossCarbonKg > 0
                          ? bundle.mtdScope1Kg / bundle.mtdGrossCarbonKg
                          : 0,
                    }}
                    transition={{ duration: 0.4, ease: EASE_OUT }}
                    style={{ originX: 0 }}
                    className="h-full w-full bg-orange-500 rounded-full"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                    <Zap className="w-3.5 h-3.5 text-sky-600" />
                    Scope 2 (Grid Electricity)
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatTonnesOrKg(bundle.mtdScope2Kg)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{
                      scaleX:
                        bundle.mtdGrossCarbonKg > 0
                          ? bundle.mtdScope2Kg / bundle.mtdGrossCarbonKg
                          : 0,
                    }}
                    transition={{ duration: 0.4, ease: EASE_OUT }}
                    style={{ originX: 0 }}
                    className="h-full w-full bg-sky-600 rounded-full"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
                    <Sun className="w-3.5 h-3.5 text-emerald-600" />
                    Solar Grid Displacement
                  </span>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    -{formatTonnesOrKg(bundle.mtdSolarAvoidedKg)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{
                      scaleX:
                        bundle.mtdGrossCarbonKg > 0
                          ? Math.min(
                              1,
                              bundle.mtdSolarAvoidedKg / bundle.mtdGrossCarbonKg
                            )
                          : 0,
                    }}
                    transition={{ duration: 0.4, ease: EASE_OUT }}
                    style={{ originX: 0 }}
                    className="h-full w-full bg-emerald-600 rounded-full"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-500 space-y-1 tabular-nums">
            <div className="font-semibold text-slate-700">Emission Factors Applied</div>
            <div>Grid: {EMISSION_FACTORS.gridKwhKg} kg/kWh · Natural Gas: {EMISSION_FACTORS.gasM3Kg} kg/m³</div>
            <div>Diesel: {EMISSION_FACTORS.dieselLiterKg} kg/L · Solid/LPG: {EMISSION_FACTORS.lpgOrSolidKg} kg/kg</div>
          </div>
        </div>
      </div>

      {/* Factory Budget Governance & Variance Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Factory Monthly Budgets, Variance &amp; Carbon Caps ({bundle.bounds.monthLabel})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAdmin
                ? 'Set spend caps, carbon limits, and solar share targets per factory to trigger early pace alerts.'
                : 'Read-only budget & carbon governance status across your authorized factories.'}
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 tabular-nums">
            {formatNumber(bundle.factoryRows.length, 0)} factories
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Factory</th>
                <th className="py-3 px-4 text-right">MTD Spend</th>
                <th className="py-3 px-4 text-right">EOM Projection</th>
                <th className="py-3 px-4 text-right">Monthly Budget</th>
                <th className="py-3 px-4">Pace Utilization</th>
                <th className="py-3 px-4 text-right">Net Carbon</th>
                <th className="py-3 px-4 text-right">Solar Share</th>
                {isAdmin && <th className="py-3 px-4 text-right">Configure</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {bundle.factoryRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdmin ? 8 : 7}
                    className="py-10 text-center text-slate-500"
                  >
                    No factories available in your current scope.
                  </td>
                </tr>
              ) : (
                bundle.factoryRows.map((row) => {
                  const meta = STATUS_META[row.status];
                  const pctBar = Math.min(
                    100,
                    Math.max(0, row.projectedUtilPct ?? row.mtdUtilPct ?? 0)
                  );
                  const isEditingThis = editingCompanyId === row.companyId;

                  return (
                    <React.Fragment key={row.companyId}>
                      <tr className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {row.companyName}
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {row.dailyBurnVelocity > 0
                              ? `${formatCompactCurrency(row.dailyBurnVelocity)}/day velocity`
                              : 'No spend logged'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatCurrency(row.mtdCost)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-800">
                            {formatCurrency(row.projectedEomCost)}
                          </div>
                          {row.varianceAtEom !== null && (
                            <div
                              className={`text-[11px] font-medium ${
                                row.varianceAtEom > 0
                                  ? 'text-rose-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {row.varianceAtEom > 0 ? '+' : ''}
                              {formatCompactCurrency(row.varianceAtEom)}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                          {row.monthlyBudgetCap !== null ? (
                            <span className="font-semibold text-slate-900">
                              {formatCurrency(row.monthlyBudgetCap)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Not set</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 min-w-[175px]">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] tabular-nums">
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${meta.textClass}`}
                              >
                                {row.status === 'onTrack' && (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                {(row.status === 'watch' ||
                                  row.status === 'overPace') && (
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                )}
                                {meta.label}
                              </span>
                              <span className="text-slate-600 font-medium">
                                {row.projectedUtilPct !== null
                                  ? formatPercent(row.projectedUtilPct)
                                  : '—'}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                              <motion.div
                                initial={{ scaleX: 0 }}
                                animate={{ scaleX: pctBar / 100 }}
                                transition={{ duration: 0.35, ease: EASE_OUT }}
                                style={{ originX: 0 }}
                                className={`h-full w-full rounded-full ${meta.barClass}`}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                          <div className="font-medium text-slate-800">
                            {formatTonnesOrKg(row.netCarbonKg)}
                          </div>
                          {row.carbonCapKg !== null && (
                            <div className="text-[11px] text-slate-500">
                              Cap: {formatTonnesOrKg(row.carbonCapKg)}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                          <span className="font-semibold text-emerald-700">
                            {formatPercent(row.solarSharePct)}
                          </span>
                          {row.targetSolarSharePct !== null && (
                            <div className="text-[11px] text-slate-500">
                              Goal: {formatPercent(row.targetSolarSharePct)}
                            </div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleOpenBudgetEditor(row)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                                isEditingThis
                                  ? 'bg-slate-900 border-slate-900 text-white'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              {isEditingThis
                                ? 'Close'
                                : row.budget
                                ? 'Edit'
                                : 'Set Cap'}
                            </button>
                          </td>
                        )}
                      </tr>

                      {isAdmin && isEditingThis && budgetDraft && (
                        <tr>
                          <td
                            colSpan={8}
                            className="p-4 sm:p-5 bg-teal-50/40 border-b border-teal-200"
                          >
                            <form
                              onSubmit={handleSaveBudget}
                              className="space-y-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-bold text-slate-900">
                                  Configure {bundle.bounds.monthLabel} Targets ·{' '}
                                  {row.companyName}
                                </div>
                                {row.budget && (
                                  <button
                                    type="button"
                                    disabled={savingBudget}
                                    onClick={() => void handleDeleteBudget(row)}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-900 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Remove Budget
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                    Monthly Spend Cap (BDT)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    required
                                    value={budgetDraft.monthlySpendLimit}
                                    onChange={(e) =>
                                      setBudgetDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              monthlySpendLimit: e.target.value,
                                            }
                                          : null
                                      )
                                    }
                                    placeholder="e.g. 2500000"
                                    className="w-full px-3 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                    Carbon Cap (kg CO₂e)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={budgetDraft.monthlyCarbonCapKg}
                                    onChange={(e) =>
                                      setBudgetDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              monthlyCarbonCapKg: e.target.value,
                                            }
                                          : null
                                      )
                                    }
                                    placeholder="Optional"
                                    className="w-full px-3 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                    Solar Mix Target (%)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.5"
                                    value={budgetDraft.targetSolarSharePct}
                                    onChange={(e) =>
                                      setBudgetDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              targetSolarSharePct:
                                                e.target.value,
                                            }
                                          : null
                                      )
                                    }
                                    placeholder="e.g. 15"
                                    className="w-full px-3 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                    Warning Alert (%)
                                  </label>
                                  <input
                                    type="number"
                                    min="50"
                                    max="100"
                                    step="1"
                                    required
                                    value={budgetDraft.alertThresholdPct}
                                    onChange={(e) =>
                                      setBudgetDraft((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              alertThresholdPct: e.target.value,
                                            }
                                          : null
                                      )
                                    }
                                    className="w-full px-3 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                    Planning Note
                                  </label>
                                  <input
                                    type="text"
                                    maxLength={300}
                                    value={budgetDraft.notes}
                                    onChange={(e) =>
                                      setBudgetDraft((prev) =>
                                        prev
                                          ? { ...prev, notes: e.target.value }
                                          : null
                                      )
                                    }
                                    placeholder="Peak shift / tariff note"
                                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                                  />
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCompanyId(null);
                                    setBudgetDraft(null);
                                  }}
                                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={savingBudget}
                                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                  {savingBudget ? 'Saving...' : 'Save Budget'}
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive "What-If" Tariff & Solar Optimization Simulator */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
              <SlidersHorizontal className="w-4 h-4 text-teal-700" />
              <span>What-If Energy Tariff &amp; Solar Optimization Simulator</span>
            </div>
            <p className="text-xs text-slate-500">
              Stress-test utility tariff shifts, diesel-to-grid load transfer, solar expansion, and idle runtime reductions against your live monthly baseline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSolarExpansionPct(25);
              setDieselToGridPct(40);
              setTariffShiftPct(0);
              setRuntimeOptPct(5);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Scenario
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="sim-solar"
                  className="font-semibold text-slate-800"
                >
                  Solar Capacity Expansion
                </label>
                <span className="font-mono-num font-bold text-emerald-700">
                  +{solarExpansionPct}%
                </span>
              </div>
              <input
                id="sim-solar"
                type="range"
                min="0"
                max="150"
                step="5"
                value={solarExpansionPct}
                onChange={(e) => setSolarExpansionPct(Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
              <div className="text-[11px] text-slate-500 tabular-nums">
                Adds +{formatNumber(simulation.addedSolarKwh, 0)} kWh/mo clean output
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="sim-diesel"
                  className="font-semibold text-slate-800"
                >
                  Shift Diesel Generator → Grid Power
                </label>
                <span className="font-mono-num font-bold text-teal-800">
                  {dieselToGridPct}%
                </span>
              </div>
              <input
                id="sim-diesel"
                type="range"
                min="0"
                max="100"
                step="5"
                value={dieselToGridPct}
                onChange={(e) => setDieselToGridPct(Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
              <div className="text-[11px] text-slate-500 tabular-nums">
                Transfers {formatNumber(simulation.shiftedDieselToGridKwh, 0)} kWh from ৳
                {formatNumber(bundle.simulationBaseline.dieselRatePerKwh, 1)}/kWh to ৳
                {formatNumber(bundle.simulationBaseline.gridRatePerKwh, 1)}/kWh
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="sim-tariff"
                  className="font-semibold text-slate-800"
                >
                  Grid &amp; Fuel Tariff Sensitivity
                </label>
                <span
                  className={`font-mono-num font-bold ${
                    tariffShiftPct > 0
                      ? 'text-rose-700'
                      : tariffShiftPct < 0
                      ? 'text-emerald-700'
                      : 'text-slate-700'
                  }`}
                >
                  {tariffShiftPct > 0 ? '+' : ''}
                  {tariffShiftPct}%
                </span>
              </div>
              <input
                id="sim-tariff"
                type="range"
                min="-15"
                max="30"
                step="1"
                value={tariffShiftPct}
                onChange={(e) => setTariffShiftPct(Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="sim-runtime"
                  className="font-semibold text-slate-800"
                >
                  Idle Machine / Boiler Runtime Reduction
                </label>
                <span className="font-mono-num font-bold text-teal-800">
                  -{runtimeOptPct}%
                </span>
              </div>
              <input
                id="sim-runtime"
                type="range"
                min="0"
                max="25"
                step="1"
                value={runtimeOptPct}
                onChange={(e) => setRuntimeOptPct(Number(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
            </div>
          </div>

          {/* Outcome Chart & Summary */}
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
            <div className="md:col-span-7 h-[230px] border border-slate-200 rounded-xl p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={simulation.chartRows}
                  margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                  barCategoryGap="32%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#E2E8F0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
                    axisLine={{ stroke: '#E2E8F0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCompactCurrency(Number(v))}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F8FAFC' }}
                    formatter={(value) => [
                      formatCurrency(Number(value ?? 0)),
                      'Projected Monthly Spend',
                    ]}
                  />
                  <Bar
                    dataKey="cost"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={56}
                    animationDuration={300}
                  >
                    {simulation.chartRows.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="md:col-span-5 flex flex-col justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">
                  Simulated Monthly Spend
                </div>
                <div className="text-xl font-bold text-slate-900 tabular-nums">
                  {formatCurrency(simulation.simTotalCost)}
                </div>
                <div
                  className={`text-xs font-semibold tabular-nums ${
                    simulation.monthlySavings >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {simulation.monthlySavings >= 0 ? 'Saves ' : 'Adds '}
                  {formatCompactCurrency(Math.abs(simulation.monthlySavings))}
                  /mo
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">
                  Annualized Impact (12 Mo)
                </div>
                <div
                  className={`text-lg font-bold tabular-nums ${
                    simulation.annualizedSavings >= 0
                      ? 'text-teal-800'
                      : 'text-rose-700'
                  }`}
                >
                  {simulation.annualizedSavings >= 0 ? '+' : '-'}
                  {formatCompactCurrency(Math.abs(simulation.annualizedSavings))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">
                  Monthly Carbon Reduction
                </div>
                <div className="text-sm font-bold text-emerald-700 tabular-nums">
                  -{formatTonnesOrKg(simulation.carbonSavedKg)} / mo
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
