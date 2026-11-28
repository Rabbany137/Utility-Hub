import type {
  CompanyItem,
  GenerationEntry,
  UtilityEntry,
  UtilityItem,
} from '../types';
import { formatNumber } from './formatters';

export type ValidationCategory =
  | 'rate_outlier'
  | 'intensity_outlier'
  | 'missing_hours'
  | 'zero_cost'
  | 'zero_consumption'
  | 'invalid_hours'
  | 'generation_gap';

export type ValidationSeverity = 'critical' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  entryId: string;
  source: 'utility' | 'generation';
  date: string;
  company: string;
  utilityId?: string;
  assetName: string;
  category: ValidationCategory;
  severity: ValidationSeverity;
  title: string;
  detail: string;
  metricValue?: number;
  baselineValue?: number;
  variancePct?: number | null;
  bdtImpact?: number;
}

export interface FactoryCoverageRow {
  company: string;
  loggedDays: number;
  expectedDays: number;
  coveragePct: number;
  entryCount: number;
  hoursLoggedCount: number;
  hoursCompletenessPct: number;
  issueCount: number;
  rateOutlierCount: number;
}

export interface AnalyticsValidationSummary {
  totalUtilityRecords: number;
  totalGenerationRecords: number;
  expectedFactoryDays: number;
  loggedFactoryDays: number;
  coveragePct: number;
  hoursEligibleCount: number;
  hoursLoggedCount: number;
  hoursCompletenessPct: number;
  missingFactories: string[];
  issues: ValidationIssue[];
  criticalCount: number;
  warningCount: number;
  rateOutlierCount: number;
  intensityOutlierCount: number;
  missingHoursCount: number;
  zeroCostCount: number;
  estimatedRateVarianceBdt: number;
  entryIssuesMap: Map<string, ValidationIssue[]>;
  factoryCoverage: FactoryCoverageRow[];
  healthScorePct: number;
}

interface MetricBaseline {
  mean: number;
  median: number;
  stdDev: number;
  count: number;
}

function computeBaseline(values: number[]): MetricBaseline | null {
  const valid = values.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length < 3) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length;
  const variance =
    valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
  const stdDev = Math.sqrt(variance);
  return { mean, median, stdDev, count: valid.length };
}

function countCalendarDaysInclusive(startISO: string, endISO: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) {
    return 1;
  }
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 1;
  }
  return Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
}

export function buildAnalyticsValidationSummary(params: {
  filteredEntries: UtilityEntry[];
  allVisibleEntries: UtilityEntry[];
  filteredGenerationEntries: GenerationEntry[];
  utilities: UtilityItem[];
  visibleCompanies: string[];
  startDate: string;
  endDate: string;
  todayISO: string;
}): AnalyticsValidationSummary {
  const {
    filteredEntries,
    allVisibleEntries,
    filteredGenerationEntries,
    utilities,
    visibleCompanies,
    startDate,
    endDate,
    todayISO,
  } = params;

  const utilMap = new Map(utilities.map((u) => [u.id, u]));

  // Build historical baselines per (company, utilityId) and fallback per utilityId
  const companyUtilRates = new Map<string, number[]>();
  const globalUtilRates = new Map<string, number[]>();
  const companyUtilHourly = new Map<string, number[]>();
  const globalUtilHourly = new Map<string, number[]>();

  for (const e of allVisibleEntries) {
    if (e.consumption > 0 && e.cost > 0) {
      const rate = e.cost / e.consumption;
      const ck = `${e.company}|||${e.utilityId}`;
      const cr = companyUtilRates.get(ck) || [];
      cr.push(rate);
      companyUtilRates.set(ck, cr);

      const gr = globalUtilRates.get(e.utilityId) || [];
      gr.push(rate);
      globalUtilRates.set(e.utilityId, gr);
    }
    const hrs = Number(e.operatingHours) || 0;
    if (e.consumption > 0 && hrs > 0 && hrs <= 24) {
      const rateHr = e.consumption / hrs;
      const ck = `${e.company}|||${e.utilityId}`;
      const ch = companyUtilHourly.get(ck) || [];
      ch.push(rateHr);
      companyUtilHourly.set(ck, ch);

      const gh = globalUtilHourly.get(e.utilityId) || [];
      gh.push(rateHr);
      globalUtilHourly.set(e.utilityId, gh);
    }
  }

  const rateBaselineCache = new Map<string, MetricBaseline | null>();
  const getRateBaseline = (company: string, utilityId: string): MetricBaseline | null => {
    const ck = `${company}|||${utilityId}`;
    if (rateBaselineCache.has(ck)) return rateBaselineCache.get(ck) || null;
    const base =
      computeBaseline(companyUtilRates.get(ck) || []) ||
      computeBaseline(globalUtilRates.get(utilityId) || []);
    rateBaselineCache.set(ck, base);
    return base;
  };

  const hourlyBaselineCache = new Map<string, MetricBaseline | null>();
  const getHourlyBaseline = (company: string, utilityId: string): MetricBaseline | null => {
    const ck = `${company}|||${utilityId}`;
    if (hourlyBaselineCache.has(ck)) return hourlyBaselineCache.get(ck) || null;
    const base =
      computeBaseline(companyUtilHourly.get(ck) || []) ||
      computeBaseline(globalUtilHourly.get(utilityId) || []);
    hourlyBaselineCache.set(ck, base);
    return base;
  };

  const issues: ValidationIssue[] = [];
  const entryIssuesMap = new Map<string, ValidationIssue[]>();

  const pushIssue = (issue: ValidationIssue) => {
    issues.push(issue);
    const list = entryIssuesMap.get(issue.entryId) || [];
    list.push(issue);
    entryIssuesMap.set(issue.entryId, list);
  };

  let hoursEligibleCount = 0;
  let hoursLoggedCount = 0;
  let estimatedRateVarianceBdt = 0;

  const companyDaysMap = new Map<string, Set<string>>();
  const companyCountsMap = new Map<
    string,
    { entries: number; hrsOk: number; hrsEligible: number; issues: number; outliers: number }
  >();

  for (const name of visibleCompanies) {
    companyDaysMap.set(name, new Set());
    companyCountsMap.set(name, {
      entries: 0,
      hrsOk: 0,
      hrsEligible: 0,
      issues: 0,
      outliers: 0,
    });
  }

  for (const entry of filteredEntries) {
    const meta = utilMap.get(entry.utilityId);
    const utilName = meta?.name || entry.utilityName;
    const unitLabel = meta?.unit || entry.unit || 'unit';
    const hrs = Number(entry.operatingHours) || 0;

    const cDaySet = companyDaysMap.get(entry.company) || new Set<string>();
    cDaySet.add(entry.date);
    companyDaysMap.set(entry.company, cDaySet);

    const cStat = companyCountsMap.get(entry.company) || {
      entries: 0,
      hrsOk: 0,
      hrsEligible: 0,
      issues: 0,
      outliers: 0,
    };
    cStat.entries += 1;

    if (entry.consumption > 0) {
      hoursEligibleCount += 1;
      cStat.hrsEligible += 1;
      if (hrs > 0) {
        hoursLoggedCount += 1;
        cStat.hrsOk += 1;
      } else {
        cStat.issues += 1;
        pushIssue({
          id: `${entry.id}_missing_hrs`,
          entryId: entry.id,
          source: 'utility',
          date: entry.date,
          company: entry.company,
          utilityId: entry.utilityId,
          assetName: utilName,
          category: 'missing_hours',
          severity: 'warning',
          title: 'Missing Run Hours',
          detail: `${formatNumber(entry.consumption)} ${unitLabel} logged with 0 operating hrs`,
        });
      }
    }

    if (hrs > 24 || hrs < 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${entry.id}_invalid_hrs`,
        entryId: entry.id,
        source: 'utility',
        date: entry.date,
        company: entry.company,
        utilityId: entry.utilityId,
        assetName: utilName,
        category: 'invalid_hours',
        severity: 'critical',
        title: 'Invalid Run Hours (>24h)',
        detail: `${formatNumber(hrs, 1)} hrs exceeds single-day 24h ceiling`,
        metricValue: hrs,
      });
    }

    if (entry.consumption > 0 && entry.cost <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${entry.id}_zero_cost`,
        entryId: entry.id,
        source: 'utility',
        date: entry.date,
        company: entry.company,
        utilityId: entry.utilityId,
        assetName: utilName,
        category: 'zero_cost',
        severity: 'warning',
        title: 'Zero Cost Entry',
        detail: `${formatNumber(entry.consumption)} ${unitLabel} recorded at ৳0.00`,
      });
    } else if (entry.cost > 0 && entry.consumption <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${entry.id}_zero_cons`,
        entryId: entry.id,
        source: 'utility',
        date: entry.date,
        company: entry.company,
        utilityId: entry.utilityId,
        assetName: utilName,
        category: 'zero_consumption',
        severity: 'warning',
        title: 'Cost Without Meter Reading',
        detail: `৳${formatNumber(entry.cost)} billed with 0 ${unitLabel} consumption`,
      });
    }

    // Statistical unit rate outlier check
    if (entry.consumption > 0 && entry.cost > 0) {
      const rate = entry.cost / entry.consumption;
      const base = getRateBaseline(entry.company, entry.utilityId);
      if (base && base.median > 0) {
        const diffRatio = (rate - base.median) / base.median;
        const absPct = Math.abs(diffRatio) * 100;
        const zScore =
          base.stdDev > 0 ? Math.abs(rate - base.mean) / base.stdDev : 0;
        if (absPct >= 20 && (base.stdDev === 0 || zScore >= 1.6 || absPct >= 30)) {
          const variancePct = diffRatio * 100;
          const bdtImpact = (rate - base.median) * entry.consumption;
          if (bdtImpact > 0) {
            estimatedRateVarianceBdt += bdtImpact;
          }
          cStat.issues += 1;
          cStat.outliers += 1;
          pushIssue({
            id: `${entry.id}_rate_outlier`,
            entryId: entry.id,
            source: 'utility',
            date: entry.date,
            company: entry.company,
            utilityId: entry.utilityId,
            assetName: utilName,
            category: 'rate_outlier',
            severity: absPct >= 35 ? 'critical' : 'warning',
            title:
              variancePct > 0
                ? `Tariff Spike (+${formatNumber(variancePct, 1)}%)`
                : `Low Rate Anomaly (${formatNumber(variancePct, 1)}%)`,
            detail: `৳${formatNumber(rate, 2)}/${unitLabel} vs baseline median ৳${formatNumber(base.median, 2)}/${unitLabel}`,
            metricValue: rate,
            baselineValue: base.median,
            variancePct,
            bdtImpact,
          });
        }
      }
    }

    // Statistical hourly consumption intensity check
    if (entry.consumption > 0 && hrs > 0 && hrs <= 24) {
      const rateHr = entry.consumption / hrs;
      const baseHr = getHourlyBaseline(entry.company, entry.utilityId);
      if (baseHr && baseHr.median > 0) {
        const diffRatio = (rateHr - baseHr.median) / baseHr.median;
        const absPct = Math.abs(diffRatio) * 100;
        const zScore =
          baseHr.stdDev > 0 ? Math.abs(rateHr - baseHr.mean) / baseHr.stdDev : 0;
        if (absPct >= 35 && (baseHr.stdDev === 0 || zScore >= 1.8 || absPct >= 45)) {
          const variancePct = diffRatio * 100;
          cStat.issues += 1;
          cStat.outliers += 1;
          pushIssue({
            id: `${entry.id}_intensity_outlier`,
            entryId: entry.id,
            source: 'utility',
            date: entry.date,
            company: entry.company,
            utilityId: entry.utilityId,
            assetName: utilName,
            category: 'intensity_outlier',
            severity: absPct >= 55 ? 'critical' : 'warning',
            title:
              variancePct > 0
                ? `High Burn/Hr (+${formatNumber(variancePct, 1)}%)`
                : `Low Burn/Hr (${formatNumber(variancePct, 1)}%)`,
            detail: `${formatNumber(rateHr, 2)} ${unitLabel}/hr vs normal ${formatNumber(baseHr.median, 2)} ${unitLabel}/hr`,
            metricValue: rateHr,
            baselineValue: baseHr.median,
            variancePct,
          });
        }
      }
    }

    companyCountsMap.set(entry.company, cStat);
  }

  // Validate Plant Generation logs as well
  for (const gen of filteredGenerationEntries) {
    const cDaySet = companyDaysMap.get(gen.company) || new Set<string>();
    cDaySet.add(gen.date);
    companyDaysMap.set(gen.company, cDaySet);

    const cStat = companyCountsMap.get(gen.company) || {
      entries: 0,
      hrsOk: 0,
      hrsEligible: 0,
      issues: 0,
      outliers: 0,
    };

    const bHrs = Number(gen.boilerOperatingHours ?? 0);
    if (gen.steamKg > 0 && bHrs <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${gen.id}_boiler_hrs`,
        entryId: gen.id,
        source: 'generation',
        date: gen.date,
        company: gen.company,
        assetName: 'Boilers',
        category: 'missing_hours',
        severity: 'warning',
        title: 'Boiler Run Hrs Missing',
        detail: `${formatNumber(gen.steamKg, 0)} kg steam logged without boiler operating hours`,
      });
    }
    if (gen.boilerFuelQty > 0 && gen.steamKg <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${gen.id}_boiler_output`,
        entryId: gen.id,
        source: 'generation',
        date: gen.date,
        company: gen.company,
        assetName: 'Boilers',
        category: 'generation_gap',
        severity: 'warning',
        title: 'Fuel Without Steam Output',
        detail: `${formatNumber(gen.boilerFuelQty)} ${gen.boilerFuelUnit} boiler fuel logged with 0 kg steam`,
      });
    }

    const gHrs = Number(gen.generatorOperatingHours ?? 0);
    if (gen.generatorKwh > 0 && gHrs <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${gen.id}_gen_hrs`,
        entryId: gen.id,
        source: 'generation',
        date: gen.date,
        company: gen.company,
        assetName: 'Captive Generators',
        category: 'missing_hours',
        severity: 'warning',
        title: 'Generator Run Hrs Missing',
        detail: `${formatNumber(gen.generatorKwh, 0)} kWh generated without generator run hours`,
      });
    }
    if (gen.generatorFuelQty > 0 && gen.generatorKwh <= 0) {
      cStat.issues += 1;
      pushIssue({
        id: `${gen.id}_gen_output`,
        entryId: gen.id,
        source: 'generation',
        date: gen.date,
        company: gen.company,
        assetName: 'Captive Generators',
        category: 'generation_gap',
        severity: 'warning',
        title: 'Fuel Without kWh Output',
        detail: `${formatNumber(gen.generatorFuelQty)} ${gen.generatorFuelUnit} fuel logged with 0 kWh output`,
      });
    }

    companyCountsMap.set(gen.company, cStat);
  }

  // Compute period calendar span capped at todayISO for fair coverage %
  const effectiveEnd = endDate > todayISO ? todayISO : endDate;
  const effectiveStart =
    startDate > effectiveEnd ? effectiveEnd : startDate;
  const calendarDays = countCalendarDaysInclusive(effectiveStart, effectiveEnd);
  const expectedFactoryDays = Math.max(1, visibleCompanies.length) * calendarDays;

  let loggedFactoryDays = 0;
  const missingFactories: string[] = [];
  const factoryCoverage: FactoryCoverageRow[] = [];

  for (const name of visibleCompanies) {
    const days = companyDaysMap.get(name)?.size || 0;
    const st = companyCountsMap.get(name) || {
      entries: 0,
      hrsOk: 0,
      hrsEligible: 0,
      issues: 0,
      outliers: 0,
    };
    loggedFactoryDays += days;
    if (days === 0) missingFactories.push(name);
    const covPct = Math.min(100, (days / calendarDays) * 100);
    const hrsPct =
      st.hrsEligible > 0 ? Math.min(100, (st.hrsOk / st.hrsEligible) * 100) : 100;
    factoryCoverage.push({
      company: name,
      loggedDays: days,
      expectedDays: calendarDays,
      coveragePct: covPct,
      entryCount: st.entries,
      hoursLoggedCount: st.hrsOk,
      hoursCompletenessPct: hrsPct,
      issueCount: st.issues,
      rateOutlierCount: st.outliers,
    });
  }

  factoryCoverage.sort((a, b) => b.issueCount - a.issueCount || a.coveragePct - b.coveragePct);

  const coveragePct = Math.min(100, (loggedFactoryDays / expectedFactoryDays) * 100);
  const hoursCompletenessPct =
    hoursEligibleCount > 0
      ? Math.min(100, (hoursLoggedCount / hoursEligibleCount) * 100)
      : 100;

  issues.sort((a, b) => {
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    const sDiff = sevOrder[a.severity] - sevOrder[b.severity];
    if (sDiff !== 0) return sDiff;
    return b.date.localeCompare(a.date);
  });

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const rateOutlierCount = issues.filter((i) => i.category === 'rate_outlier').length;
  const intensityOutlierCount = issues.filter(
    (i) => i.category === 'intensity_outlier'
  ).length;
  const missingHoursCount = issues.filter(
    (i) => i.category === 'missing_hours'
  ).length;
  const zeroCostCount = issues.filter(
    (i) => i.category === 'zero_cost' || i.category === 'zero_consumption'
  ).length;

  const totalChecked = Math.max(
    1,
    filteredEntries.length + filteredGenerationEntries.length
  );
  const cleanRatio = Math.max(0, 1 - issues.length / (totalChecked * 1.4));
  const healthScorePct = Math.round(cleanRatio * 100);

  return {
    totalUtilityRecords: filteredEntries.length,
    totalGenerationRecords: filteredGenerationEntries.length,
    expectedFactoryDays,
    loggedFactoryDays,
    coveragePct,
    hoursEligibleCount,
    hoursLoggedCount,
    hoursCompletenessPct,
    missingFactories,
    issues,
    criticalCount,
    warningCount,
    rateOutlierCount,
    intensityOutlierCount,
    missingHoursCount,
    zeroCostCount,
    estimatedRateVarianceBdt,
    entryIssuesMap,
    factoryCoverage,
    healthScorePct,
  };
}

export interface DraftRowHint {
  tone: 'warning' | 'info';
  text: string;
}

export function evaluateUtilityDraftHints(params: {
  consumptionStr: string;
  hoursStr: string;
  costStr: string;
  unitLabel: string;
  baselineRate: number | null;
  baselineHourly: number | null;
}): DraftRowHint[] {
  const hints: DraftRowHint[] = [];
  const cons = Number(params.consumptionStr) || 0;
  const hrs = Number(params.hoursStr) || 0;
  const cost = Number(params.costStr) || 0;

  if (hrs > 24) {
    hints.push({
      tone: 'warning',
      text: `Run Hours (${formatNumber(hrs, 1)}h) exceeds 24h in a day.`,
    });
  } else if (cons > 0 && params.hoursStr.trim() === '') {
    hints.push({
      tone: 'info',
      text: `Add Run Hours to track ${params.unitLabel}/hr burn rate.`,
    });
  } else if (hrs > 0 && cons <= 0) {
    hints.push({
      tone: 'warning',
      text: `${formatNumber(hrs, 1)} run hrs entered with 0 ${params.unitLabel} consumption.`,
    });
  }

  if (cons > 0 && cost > 0 && params.baselineRate && params.baselineRate > 0) {
    const curRate = cost / cons;
    const diffPct = ((curRate - params.baselineRate) / params.baselineRate) * 100;
    if (Math.abs(diffPct) >= 25) {
      hints.push({
        tone: 'warning',
        text: `Rate ৳${formatNumber(curRate, 2)}/${params.unitLabel} is ${diffPct >= 0 ? '+' : ''}${formatNumber(diffPct, 0)}% vs factory avg (৳${formatNumber(params.baselineRate, 2)})`,
      });
    }
  }

  if (cons > 0 && hrs > 0 && hrs <= 24 && params.baselineHourly && params.baselineHourly > 0) {
    const curHourly = cons / hrs;
    const diffPct = ((curHourly - params.baselineHourly) / params.baselineHourly) * 100;
    if (Math.abs(diffPct) >= 40) {
      hints.push({
        tone: 'warning',
        text: `Burn ${formatNumber(curHourly, 1)} ${params.unitLabel}/hr is ${diffPct >= 0 ? '+' : ''}${formatNumber(diffPct, 0)}% vs avg (${formatNumber(params.baselineHourly, 1)}/hr)`,
      });
    }
  }

  return hints;
}

export function buildFactoryIssueLookupForSheet(params: {
  entries: UtilityEntry[];
  generationEntries: GenerationEntry[];
  utilities: UtilityItem[];
  companies: CompanyItem[];
}): Map<string, string> {
  // Returns map keyed by `${company}|||${date}` -> concise analyst status ('Verified' | 'Missing Hrs' | 'Rate Alert' ...)
  const utilMap = new Map(params.utilities.map((u) => [u.id, u]));
  const ratesByKey = new Map<string, number[]>();
  for (const e of params.entries) {
    if (e.consumption > 0 && e.cost > 0) {
      const k = `${e.company}|||${e.utilityId}`;
      const arr = ratesByKey.get(k) || [];
      arr.push(e.cost / e.consumption);
      ratesByKey.set(k, arr);
    }
  }

  const medianMap = new Map<string, number>();
  for (const [k, vals] of ratesByKey.entries()) {
    const base = computeBaseline(vals);
    if (base) medianMap.set(k, base.median);
  }

  const dayFlags = new Map<string, Set<string>>();
  const addFlag = (company: string, date: string, flag: string) => {
    const key = `${company}|||${date}`;
    const set = dayFlags.get(key) || new Set<string>();
    set.add(flag);
    dayFlags.set(key, set);
  };

  for (const e of params.entries) {
    const hrs = Number(e.operatingHours) || 0;
    if (e.consumption > 0 && hrs <= 0) {
      addFlag(e.company, e.date, 'Missing Hrs');
    }
    if (e.consumption > 0 && e.cost <= 0) {
      addFlag(e.company, e.date, 'Zero Cost');
    }
    if (e.consumption > 0 && e.cost > 0) {
      const med = medianMap.get(`${e.company}|||${e.utilityId}`);
      if (med && med > 0) {
        const rate = e.cost / e.consumption;
        const pct = ((rate - med) / med) * 100;
        if (Math.abs(pct) >= 25) {
          const uName = utilMap.get(e.utilityId)?.name || e.utilityName;
          addFlag(
            e.company,
            e.date,
            `${uName} Rate ${pct >= 0 ? '+' : ''}${Math.round(pct)}%`
          );
        }
      }
    }
  }

  for (const g of params.generationEntries) {
    if (g.steamKg > 0 && Number(g.boilerOperatingHours ?? 0) <= 0) {
      addFlag(g.company, g.date, 'Boiler Hrs Missing');
    }
    if (g.generatorKwh > 0 && Number(g.generatorOperatingHours ?? 0) <= 0) {
      addFlag(g.company, g.date, 'Gen Hrs Missing');
    }
  }

  const out = new Map<string, string>();
  for (const [key, set] of dayFlags.entries()) {
    out.set(key, Array.from(set).slice(0, 3).join('; '));
  }
  return out;
}
