import type {
  CompanyItem,
  GenerationEntry,
  UtilityEntry,
  UtilityItem,
} from '../types';
import {
  buildAnalyticsValidationSummary,
  type AnalyticsValidationSummary,
} from './analyticsValidation';
import { extractPlantFuelAllocations } from './equipment';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  getTodayISO,
} from './formatters';

export interface ReportFactoryRow {
  company: string;
  totalCost: number;
  sharePct: number;
  activeDays: number;
  entryCount: number;
  totalHours: number;
  costPerHour: number | null;
  dailyAvg: number;
  deltaPct: number | null;
  steamKg: number;
  genKwh: number;
  solarKwh: number;
  solarSavings: number;
  flagCount: number;
}

export interface ReportUtilityRow {
  id: string;
  name: string;
  unit: string;
  color: string;
  consumption: number;
  cost: number;
  sharePct: number;
  hours: number;
  avgUnitCost: number | null;
  avgHourlyRate: number | null;
  costPerHour: number | null;
  entryCount: number;
}

export interface ExecutiveSummaryReport {
  startDate: string;
  endDate: string;
  periodLabel: string;
  comparisonLabel?: string;
  generatedAtISO: string;
  scopeCompanies: string[];
  totalCost: number;
  prevTotalCost: number | null;
  costDeltaPct: number | null;
  dailyAvg: number;
  activeDaysCount: number;
  activeCompaniesCount: number;
  recordCount: number;
  totalUtilityHours: number;
  totalEquipmentHours: number;
  totalAssetHours: number;
  blendedCostPerHour: number | null;
  peakDay: { date: string; cost: number } | null;
  topFactory: ReportFactoryRow | null;
  factoryRows: ReportFactoryRow[];
  utilityRows: ReportUtilityRow[];
  generation: {
    hasRecords: boolean;
    totalSteamKg: number;
    boilerFuelCost: number;
    boilerHours: number;
    steamPerHour: number | null;
    steamCostPerKg: number | null;
    totalGenKwh: number;
    genFuelCost: number;
    genHours: number;
    avgGenKw: number | null;
    genCostPerKwh: number | null;
    totalSolarKwh: number;
    totalSolarSavings: number;
    solarHours: number;
    gridKwh: number;
    solarSharePct: number;
  };
  validation: AnalyticsValidationSummary;
  highlights: string[];
}

export function buildExecutiveSummaryReport(params: {
  entries: UtilityEntry[];
  generationEntries: GenerationEntry[];
  companies: CompanyItem[];
  utilities: UtilityItem[];
  startDate: string;
  endDate: string;
  periodLabel: string;
  comparisonStart?: string;
  comparisonEnd?: string;
  comparisonLabel?: string;
  scopeCompanies: string[];
  allowedUtilityIds?: string[];
  todayISO?: string;
}): ExecutiveSummaryReport {
  const {
    entries,
    generationEntries,
    companies,
    utilities,
    startDate,
    endDate,
    periodLabel,
    comparisonStart,
    comparisonEnd,
    comparisonLabel,
    scopeCompanies,
    allowedUtilityIds,
    todayISO = getTodayISO(),
  } = params;

  const companySet = new Set(scopeCompanies);
  const companyMap = new Map(companies.map((c) => [c.name, c]));
  const hasUtilityAllowlist =
    Array.isArray(allowedUtilityIds) && allowedUtilityIds.length > 0;
  const allowedUtilSet = hasUtilityAllowlist ? new Set(allowedUtilityIds) : null;
  const visibleUtilities = allowedUtilSet
    ? utilities.filter((u) => allowedUtilSet.has(u.id))
    : utilities;

  const scopedAllEntries = entries.filter(
    (e) =>
      companySet.has(e.company) &&
      (!allowedUtilSet || allowedUtilSet.has(e.utilityId))
  );

  const periodEntries = scopedAllEntries.filter(
    (e) => e.date >= startDate && e.date <= endDate
  );

  const periodGenEntries = generationEntries.filter(
    (g) => companySet.has(g.company) && g.date >= startDate && g.date <= endDate
  );

  let prevTotalCost: number | null = null;
  const prevCompanyCost = new Map<string, number>();

  if (comparisonStart && comparisonEnd) {
    const prevEntries = scopedAllEntries.filter(
      (e) => e.date >= comparisonStart && e.date <= comparisonEnd
    );
    const prevGen = generationEntries.filter(
      (g) =>
        companySet.has(g.company) &&
        g.date >= comparisonStart &&
        g.date <= comparisonEnd
    );
    let acc = 0;
    for (const item of prevEntries) {
      acc += item.cost;
      prevCompanyCost.set(
        item.company,
        (prevCompanyCost.get(item.company) || 0) + item.cost
      );
    }
    for (const gen of prevGen) {
      const allocs = extractPlantFuelAllocations(
        gen,
        utilities,
        companyMap.get(gen.company)
      ).filter((a) => !allowedUtilSet || allowedUtilSet.has(a.id));
      for (const a of allocs) {
        acc += a.cost;
        prevCompanyCost.set(
          gen.company,
          (prevCompanyCost.get(gen.company) || 0) + a.cost
        );
      }
    }
    if (prevEntries.length > 0 || prevGen.length > 0) {
      prevTotalCost = acc;
    }
  }

  let totalCost = 0;
  let totalUtilityHours = 0;
  let totalEquipmentHours = 0;
  let fuelRecordCount = 0;
  const activeDates = new Set<string>();
  const activeCompanies = new Set<string>();
  const byDateCost = new Map<string, number>();

  const utilAggMap = new Map<
    string,
    {
      id: string;
      name: string;
      unit: string;
      color: string;
      consumption: number;
      cost: number;
      hours: number;
      entryCount: number;
    }
  >();

  for (const u of visibleUtilities) {
    utilAggMap.set(u.id, {
      id: u.id,
      name: u.name,
      unit: u.unit,
      color: u.color,
      consumption: 0,
      cost: 0,
      hours: 0,
      entryCount: 0,
    });
  }

  const factoryAggMap = new Map<
    string,
    {
      company: string;
      totalCost: number;
      dates: Set<string>;
      entryCount: number;
      totalHours: number;
      steamKg: number;
      genKwh: number;
      solarKwh: number;
      solarSavings: number;
    }
  >();

  for (const c of scopeCompanies) {
    factoryAggMap.set(c, {
      company: c,
      totalCost: 0,
      dates: new Set(),
      entryCount: 0,
      totalHours: 0,
      steamKg: 0,
      genKwh: 0,
      solarKwh: 0,
      solarSavings: 0,
    });
  }

  const electricityUtil = visibleUtilities.find(
    (u) =>
      u.name.toLowerCase().includes('electric') ||
      u.unit.toLowerCase() === 'kwh'
  );
  let gridKwh = 0;

  for (const item of periodEntries) {
    const hrs = Number(item.operatingHours) || 0;
    totalCost += item.cost;
    if (hrs > 0) totalUtilityHours += hrs;
    activeDates.add(item.date);
    activeCompanies.add(item.company);
    byDateCost.set(item.date, (byDateCost.get(item.date) || 0) + item.cost);

    if (electricityUtil && item.utilityId === electricityUtil.id) {
      gridKwh += item.consumption;
    }

    const uAgg = utilAggMap.get(item.utilityId) || {
      id: item.utilityId,
      name: item.utilityName,
      unit: item.unit,
      color: '#0F766E',
      consumption: 0,
      cost: 0,
      hours: 0,
      entryCount: 0,
    };
    uAgg.consumption += item.consumption;
    uAgg.cost += item.cost;
    if (hrs > 0) uAgg.hours += hrs;
    uAgg.entryCount += 1;
    utilAggMap.set(item.utilityId, uAgg);

    const fAgg = factoryAggMap.get(item.company);
    if (fAgg) {
      fAgg.totalCost += item.cost;
      fAgg.dates.add(item.date);
      fAgg.entryCount += 1;
      if (hrs > 0) fAgg.totalHours += hrs;
    }
  }

  let totalSteamKg = 0;
  let boilerFuelCost = 0;
  let boilerHours = 0;
  let totalGenKwh = 0;
  let genFuelCost = 0;
  let genHours = 0;
  let totalSolarKwh = 0;
  let totalSolarSavings = 0;
  let solarHours = 0;

  for (const gen of periodGenEntries) {
    const bHrs = Number(gen.boilerOperatingHours) || 0;
    const gHrs = Number(gen.generatorOperatingHours) || 0;
    const sHrs = Number(gen.solarOperatingHours) || 0;
    const eqHrs = bHrs + gHrs + sHrs;

    totalSteamKg += gen.steamKg;
    boilerFuelCost += gen.boilerFuelCost;
    boilerHours += bHrs;
    totalGenKwh += gen.generatorKwh;
    genFuelCost += gen.generatorFuelCost;
    genHours += gHrs;
    totalSolarKwh += gen.solarKwh;
    totalSolarSavings += gen.solarSavings;
    solarHours += sHrs;
    totalEquipmentHours += eqHrs;

    const fAgg = factoryAggMap.get(gen.company);
    if (fAgg) {
      fAgg.steamKg += gen.steamKg;
      fAgg.genKwh += gen.generatorKwh;
      fAgg.solarKwh += gen.solarKwh;
      fAgg.solarSavings += gen.solarSavings;
      if (eqHrs > 0) fAgg.totalHours += eqHrs;
    }

    const allocs = extractPlantFuelAllocations(
      gen,
      utilities,
      companyMap.get(gen.company)
    ).filter((a) => !allowedUtilSet || allowedUtilSet.has(a.id));

    if (allocs.length > 0) {
      fuelRecordCount += 1;
      activeDates.add(gen.date);
      activeCompanies.add(gen.company);
      for (const a of allocs) {
        totalCost += a.cost;
        byDateCost.set(gen.date, (byDateCost.get(gen.date) || 0) + a.cost);
        const uAgg = utilAggMap.get(a.id) || {
          id: a.id,
          name: a.name,
          unit: a.unit,
          color: a.color,
          consumption: 0,
          cost: 0,
          hours: 0,
          entryCount: 0,
        };
        uAgg.consumption += a.consumption;
        uAgg.cost += a.cost;
        uAgg.entryCount += 1;
        utilAggMap.set(a.id, uAgg);

        if (fAgg) {
          fAgg.totalCost += a.cost;
          fAgg.dates.add(gen.date);
          fAgg.entryCount += 1;
        }
      }
    }
  }

  const validation = buildAnalyticsValidationSummary({
    filteredEntries: periodEntries,
    allVisibleEntries: scopedAllEntries,
    filteredGenerationEntries: periodGenEntries,
    utilities: visibleUtilities,
    visibleCompanies: scopeCompanies,
    startDate,
    endDate,
    todayISO,
  });

  const flagCountByCompany = new Map<string, number>();
  for (const iss of validation.issues) {
    flagCountByCompany.set(
      iss.company,
      (flagCountByCompany.get(iss.company) || 0) + 1
    );
  }

  const factoryRows: ReportFactoryRow[] = Array.from(factoryAggMap.values())
    .map((f) => {
      const activeDays = f.dates.size;
      const prev = prevCompanyCost.get(f.company);
      return {
        company: f.company,
        totalCost: f.totalCost,
        sharePct: totalCost > 0 ? (f.totalCost / totalCost) * 100 : 0,
        activeDays,
        entryCount: f.entryCount,
        totalHours: f.totalHours,
        costPerHour: f.totalHours > 0 ? f.totalCost / f.totalHours : null,
        dailyAvg: activeDays > 0 ? f.totalCost / activeDays : 0,
        deltaPct:
          prev !== undefined && prev > 0
            ? ((f.totalCost - prev) / prev) * 100
            : null,
        steamKg: f.steamKg,
        genKwh: f.genKwh,
        solarKwh: f.solarKwh,
        solarSavings: f.solarSavings,
        flagCount: flagCountByCompany.get(f.company) || 0,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const utilityRows: ReportUtilityRow[] = Array.from(utilAggMap.values())
    .filter((u) => u.cost > 0 || u.consumption > 0 || u.hours > 0)
    .map((u) => ({
      ...u,
      sharePct: totalCost > 0 ? (u.cost / totalCost) * 100 : 0,
      avgUnitCost: u.consumption > 0 && u.cost > 0 ? u.cost / u.consumption : null,
      avgHourlyRate: u.hours > 0 && u.consumption > 0 ? u.consumption / u.hours : null,
      costPerHour: u.hours > 0 && u.cost > 0 ? u.cost / u.hours : null,
    }))
    .sort((a, b) => b.cost - a.cost);

  let peakDay: { date: string; cost: number } | null = null;
  for (const [date, cost] of byDateCost.entries()) {
    if (!peakDay || cost > peakDay.cost) {
      peakDay = { date, cost };
    }
  }

  const activeDaysCount = activeDates.size;
  const dailyAvg = activeDaysCount > 0 ? totalCost / activeDaysCount : 0;
  const totalAssetHours = totalUtilityHours + totalEquipmentHours;
  const blendedCostPerHour =
    totalAssetHours > 0 && totalCost > 0 ? totalCost / totalAssetHours : null;
  const costDeltaPct =
    prevTotalCost !== null && prevTotalCost > 0
      ? ((totalCost - prevTotalCost) / prevTotalCost) * 100
      : null;

  const totalPowerKwh = gridKwh + totalGenKwh + totalSolarKwh;
  const solarSharePct =
    totalPowerKwh > 0 ? (totalSolarKwh / totalPowerKwh) * 100 : 0;

  const topFactory = factoryRows.find((r) => r.totalCost > 0) || null;

  const highlights: string[] = [];
  if (totalCost > 0) {
    highlights.push(
      `Group utility & plant fuel spend reached ${formatCurrency(totalCost)} across ${activeCompanies.size} of ${scopeCompanies.length} factories (${activeDaysCount} active day${activeDaysCount === 1 ? '' : 's'}).`
    );
  } else {
    highlights.push(
      `No utility spend entries were recorded across ${scopeCompanies.length} factory scope for ${periodLabel}.`
    );
  }

  if (costDeltaPct !== null && comparisonLabel) {
    highlights.push(
      `Spend shifted ${costDeltaPct >= 0 ? '+' : ''}${formatPercent(costDeltaPct)} compared to ${comparisonLabel}.`
    );
  }

  if (topFactory) {
    highlights.push(
      `${topFactory.company} accounted for the largest spend share at ${formatCurrency(topFactory.totalCost)} (${formatPercent(topFactory.sharePct)}).`
    );
  }

  if (totalAssetHours > 0 && blendedCostPerHour !== null) {
    highlights.push(
      `Logged ${formatNumber(totalAssetHours, 1)} asset operating hours with a blended burn rate of ৳${formatNumber(blendedCostPerHour, 0)}/hr.`
    );
  }

  if (totalSolarKwh > 0) {
    highlights.push(
      `Clean solar generation delivered ${formatNumber(totalSolarKwh, 0)} kWh (${formatPercent(solarSharePct)} power mix), saving ${formatCurrency(totalSolarSavings)}.`
    );
  }

  if (validation.issues.length > 0) {
    highlights.push(
      `Data Quality Score: ${formatNumber(validation.healthScorePct, 0)}% with ${validation.issues.length} audit flag${validation.issues.length === 1 ? '' : 's'} requiring review.`
    );
  }

  return {
    startDate,
    endDate,
    periodLabel,
    comparisonLabel,
    generatedAtISO: new Date().toISOString(),
    scopeCompanies,
    totalCost,
    prevTotalCost,
    costDeltaPct,
    dailyAvg,
    activeDaysCount,
    activeCompaniesCount: activeCompanies.size,
    recordCount: periodEntries.length + fuelRecordCount,
    totalUtilityHours,
    totalEquipmentHours,
    totalAssetHours,
    blendedCostPerHour,
    peakDay,
    topFactory,
    factoryRows,
    utilityRows,
    generation: {
      hasRecords: periodGenEntries.length > 0,
      totalSteamKg,
      boilerFuelCost,
      boilerHours,
      steamPerHour:
        boilerHours > 0 && totalSteamKg > 0 ? totalSteamKg / boilerHours : null,
      steamCostPerKg:
        totalSteamKg > 0 && boilerFuelCost > 0
          ? boilerFuelCost / totalSteamKg
          : null,
      totalGenKwh,
      genFuelCost,
      genHours,
      avgGenKw: genHours > 0 && totalGenKwh > 0 ? totalGenKwh / genHours : null,
      genCostPerKwh:
        totalGenKwh > 0 && genFuelCost > 0 ? genFuelCost / totalGenKwh : null,
      totalSolarKwh,
      totalSolarSavings,
      solarHours,
      gridKwh,
      solarSharePct,
    },
    validation,
    highlights,
  };
}

function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDailyReportSubject(
  report: ExecutiveSummaryReport,
  appName = 'Utility Hub'
): string {
  const scopeLabel =
    report.scopeCompanies.length === 1
      ? report.scopeCompanies[0]
      : `${report.scopeCompanies.length} Factories`;
  return `${appName} Daily Utility Report · ${report.periodLabel} · ${scopeLabel} (${formatCompactCurrency(report.totalCost)})`;
}

export function buildDailyReportPlainText(
  report: ExecutiveSummaryReport,
  options?: { recipientName?: string }
): string {
  const lines: string[] = [];
  lines.push(`UTILITY HUB — EXECUTIVE ENERGY & OPERATIONS REPORT`);
  lines.push(`Period: ${report.periodLabel} (${report.startDate} to ${report.endDate})`);
  if (options?.recipientName) {
    lines.push(`Prepared for: ${options.recipientName}`);
  }
  lines.push(`Scope: ${report.scopeCompanies.join(', ')}`);
  lines.push('');
  lines.push(`Total Spend: ${formatCurrency(report.totalCost)}`);
  lines.push(`Daily Average: ${formatCurrency(report.dailyAvg)}`);
  lines.push(`Asset Run Hours: ${formatNumber(report.totalAssetHours, 1)} hrs`);
  lines.push(
    `Data Quality: ${formatNumber(report.validation.healthScorePct, 0)}% · Coverage ${formatPercent(report.validation.coveragePct)}`
  );
  lines.push('');
  lines.push('HIGHLIGHTS:');
  report.highlights.forEach((h) => lines.push(`- ${h}`));
  lines.push('');
  lines.push('FACTORY BREAKDOWN:');
  report.factoryRows.forEach((f, idx) => {
    lines.push(
      `${idx + 1}. ${f.company}: ${formatCurrency(f.totalCost)} (${formatPercent(f.sharePct)}) · ${formatNumber(f.totalHours, 1)} hrs · Flags: ${f.flagCount}`
    );
  });
  lines.push('');
  lines.push('UTILITY BREAKDOWN:');
  report.utilityRows.forEach((u) => {
    lines.push(
      `- ${u.name}: ${formatNumber(u.consumption)} ${u.unit} · ${formatCurrency(u.cost)} (${formatPercent(u.sharePct)})`
    );
  });
  return lines.join('\n');
}

export function buildDailyReportEmailHtml(
  report: ExecutiveSummaryReport,
  options?: {
    recipientName?: string;
    scheduledTime?: string;
    organizationLabel?: string;
  }
): string {
  const recipientLine = options?.recipientName
    ? `Prepared for <strong>${escapeHtml(options.recipientName)}</strong>`
    : 'Executive Stakeholder Distribution';
  const scheduleTag = options?.scheduledTime
    ? `Scheduled Push: ${escapeHtml(options.scheduledTime)}`
    : 'On-Demand Dispatch';
  const deltaText =
    report.costDeltaPct !== null
      ? `${report.costDeltaPct >= 0 ? '+' : ''}${formatPercent(report.costDeltaPct)} vs ${escapeHtml(report.comparisonLabel || 'baseline')}`
      : `${report.activeCompaniesCount}/${report.scopeCompanies.length} factories active`;

  const factoryTableRows =
    report.factoryRows.length === 0
      ? `<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748B;font-size:12px;">No factory entries in selected period.</td></tr>`
      : report.factoryRows
          .map(
            (f, i) => `
          <tr style="background:${i % 2 === 1 ? '#F8FAFC' : '#FFFFFF'};border-bottom:1px solid #E2E8F0;">
            <td style="padding:9px 10px;font-size:12px;font-weight:600;color:#0F172A;">${escapeHtml(f.company)}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">${escapeHtml(formatCurrency(f.totalCost))}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#475569;font-variant-numeric:tabular-nums;">${escapeHtml(formatPercent(f.sharePct))}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#475569;font-variant-numeric:tabular-nums;">${f.totalHours > 0 ? `${escapeHtml(formatNumber(f.totalHours, 1))}h` : '—'}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#0F766E;font-weight:600;font-variant-numeric:tabular-nums;">${f.costPerHour !== null ? `৳${escapeHtml(formatNumber(f.costPerHour, 0))}/h` : '—'}</td>
            <td style="padding:9px 10px;font-size:11px;text-align:center;color:${f.flagCount > 0 ? '#B45309' : '#047857'};font-weight:600;">${f.flagCount > 0 ? `${f.flagCount} Flag` : 'Verified'}</td>
          </tr>`
          )
          .join('');

  const utilityTableRows =
    report.utilityRows.length === 0
      ? `<tr><td colspan="5" style="padding:14px;text-align:center;color:#64748B;font-size:12px;">No utility entries logged.</td></tr>`
      : report.utilityRows
          .map(
            (u, i) => `
          <tr style="background:${i % 2 === 1 ? '#F8FAFC' : '#FFFFFF'};border-bottom:1px solid #E2E8F0;">
            <td style="padding:9px 10px;font-size:12px;font-weight:600;color:#0F172A;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${escapeHtml(u.color)};margin-right:6px;vertical-align:middle;"></span>
              ${escapeHtml(u.name)}
            </td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#334155;font-variant-numeric:tabular-nums;">${u.unit ? `${escapeHtml(formatNumber(u.consumption))} ${escapeHtml(u.unit)}` : 'Plant Fuel'}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#0F766E;font-variant-numeric:tabular-nums;">${u.avgUnitCost !== null && u.unit ? `৳${escapeHtml(formatNumber(u.avgUnitCost, 2))}/${escapeHtml(u.unit)}` : '—'}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;color:#475569;font-variant-numeric:tabular-nums;">${u.avgHourlyRate !== null && u.unit ? `${escapeHtml(formatNumber(u.avgHourlyRate, 1))} ${escapeHtml(u.unit)}/h` : '—'}</td>
            <td style="padding:9px 10px;font-size:12px;text-align:right;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">${escapeHtml(formatCurrency(u.cost))}</td>
          </tr>`
          )
          .join('');

  const highlightsHtml = report.highlights
    .map(
      (h) =>
        `<li style="margin:0 0 6px 0;color:#334155;font-size:12.5px;line-height:1.5;">${escapeHtml(h)}</li>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;overflow:hidden;">
          <!-- Header Banner -->
          <tr>
            <td style="background:#0F172A;padding:22px 24px;color:#FFFFFF;">
              <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5EEAD4;font-weight:700;">
                Utility Hub · Automated Daily Operations Brief
              </div>
              <div style="font-size:20px;font-weight:700;margin-top:6px;line-height:1.25;">
                Executive Utility &amp; Plant Performance Report
              </div>
              <div style="font-size:12px;color:#CBD5E1;margin-top:8px;">
                ${escapeHtml(report.periodLabel)} (${escapeHtml(report.startDate)} – ${escapeHtml(report.endDate)}) &nbsp;·&nbsp; ${scheduleTag}
              </div>
            </td>
          </tr>

          <!-- Recipient Context -->
          <tr>
            <td style="background:#F8FAFC;padding:12px 24px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">
              ${recipientLine}${options?.organizationLabel ? ` &nbsp;·&nbsp; ${escapeHtml(options.organizationLabel)}` : ''} &nbsp;·&nbsp; Scope: <strong style="color:#0F172A;">${report.scopeCompanies.length} ${report.scopeCompanies.length === 1 ? 'Factory' : 'Factories'}</strong>
            </td>
          </tr>

          <!-- KPI Strip -->
          <tr>
            <td style="padding:20px 24px 12px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
                <tr>
                  <td width="25%" style="padding:12px;border-right:1px solid #E2E8F0;vertical-align:top;">
                    <div style="font-size:10.5px;color:#64748B;text-transform:uppercase;font-weight:600;">Total Spend</div>
                    <div style="font-size:17px;font-weight:700;color:#0F172A;margin-top:4px;font-variant-numeric:tabular-nums;">${escapeHtml(formatCurrency(report.totalCost))}</div>
                    <div style="font-size:11px;color:#0F766E;margin-top:3px;">${deltaText}</div>
                  </td>
                  <td width="25%" style="padding:12px;border-right:1px solid #E2E8F0;vertical-align:top;">
                    <div style="font-size:10.5px;color:#64748B;text-transform:uppercase;font-weight:600;">Daily Average</div>
                    <div style="font-size:17px;font-weight:700;color:#0F172A;margin-top:4px;font-variant-numeric:tabular-nums;">${escapeHtml(formatCurrency(report.dailyAvg))}</div>
                    <div style="font-size:11px;color:#64748B;margin-top:3px;">${escapeHtml(formatNumber(report.activeDaysCount, 0))} active day(s)</div>
                  </td>
                  <td width="25%" style="padding:12px;border-right:1px solid #E2E8F0;vertical-align:top;">
                    <div style="font-size:10.5px;color:#64748B;text-transform:uppercase;font-weight:600;">Asset Runtime</div>
                    <div style="font-size:17px;font-weight:700;color:#0F172A;margin-top:4px;font-variant-numeric:tabular-nums;">${escapeHtml(formatNumber(report.totalAssetHours, 1))} hrs</div>
                    <div style="font-size:11px;color:#64748B;margin-top:3px;">${report.blendedCostPerHour !== null ? `৳${escapeHtml(formatNumber(report.blendedCostPerHour, 0))}/hr burn` : 'Log hrs for rate'}</div>
                  </td>
                  <td width="25%" style="padding:12px;vertical-align:top;background:#F0FDF4;">
                    <div style="font-size:10.5px;color:#065F46;text-transform:uppercase;font-weight:600;">Data Quality</div>
                    <div style="font-size:17px;font-weight:700;color:#064E3B;margin-top:4px;font-variant-numeric:tabular-nums;">${escapeHtml(formatNumber(report.validation.healthScorePct, 0))}%</div>
                    <div style="font-size:11px;color:#047857;margin-top:3px;">${escapeHtml(formatPercent(report.validation.coveragePct))} coverage</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Key Takeaways -->
          <tr>
            <td style="padding:8px 24px 16px 24px;">
              <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;">Executive Highlights</div>
              <ul style="margin:0;padding-left:18px;">
                ${highlightsHtml}
              </ul>
            </td>
          </tr>

          <!-- Factory Ranking Table -->
          <tr>
            <td style="padding:4px 24px 18px 24px;">
              <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;">Factory Spend &amp; Efficiency Ranking</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;border-collapse:collapse;">
                <thead>
                  <tr style="background:#F1F5F9;border-bottom:1px solid #CBD5E1;">
                    <th style="padding:8px 10px;font-size:11px;text-align:left;color:#475569;text-transform:uppercase;">Factory</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Total Spend</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Share</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Run Hrs</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Burn / Hr</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:center;color:#475569;text-transform:uppercase;">Audit</th>
                  </tr>
                </thead>
                <tbody>
                  ${factoryTableRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Utility Breakdown Table -->
          <tr>
            <td style="padding:0 24px 18px 24px;">
              <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;">Utility Consumption &amp; Unit Rate Summary</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;border-collapse:collapse;">
                <thead>
                  <tr style="background:#F1F5F9;border-bottom:1px solid #CBD5E1;">
                    <th style="padding:8px 10px;font-size:11px;text-align:left;color:#475569;text-transform:uppercase;">Utility</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Consumption</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Avg Rate</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Rate / Hr</th>
                    <th style="padding:8px 10px;font-size:11px;text-align:right;color:#475569;text-transform:uppercase;">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  ${utilityTableRows}
                </tbody>
              </table>
            </td>
          </tr>

          ${
            report.generation.hasRecords
              ? `<tr>
            <td style="padding:0 24px 18px 24px;">
              <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;">Captive Generation &amp; Solar Summary</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E2E8F0;background:#F8FAFC;border-radius:6px;">
                <tr>
                  <td width="33%" style="padding:10px 12px;border-right:1px solid #E2E8F0;">
                    <div style="font-size:10.5px;color:#64748B;">Boiler Steam</div>
                    <div style="font-size:14px;font-weight:700;color:#0F172A;margin-top:2px;">${escapeHtml(formatNumber(report.generation.totalSteamKg, 0))} kg</div>
                    <div style="font-size:11px;color:#475569;">${report.generation.steamCostPerKg !== null ? `৳${escapeHtml(formatNumber(report.generation.steamCostPerKg, 2))}/kg` : '—'}</div>
                  </td>
                  <td width="33%" style="padding:10px 12px;border-right:1px solid #E2E8F0;">
                    <div style="font-size:10.5px;color:#64748B;">Captive Generator</div>
                    <div style="font-size:14px;font-weight:700;color:#0F172A;margin-top:2px;">${escapeHtml(formatNumber(report.generation.totalGenKwh, 0))} kWh</div>
                    <div style="font-size:11px;color:#475569;">${report.generation.genCostPerKwh !== null ? `৳${escapeHtml(formatNumber(report.generation.genCostPerKwh, 2))}/kWh` : '—'}</div>
                  </td>
                  <td width="34%" style="padding:10px 12px;background:#ECFDF5;">
                    <div style="font-size:10.5px;color:#065F46;">Clean Solar Savings</div>
                    <div style="font-size:14px;font-weight:700;color:#065F46;margin-top:2px;">${escapeHtml(formatCurrency(report.generation.totalSolarSavings))}</div>
                    <div style="font-size:11px;color:#047857;">${escapeHtml(formatNumber(report.generation.totalSolarKwh, 0))} kWh (${escapeHtml(formatPercent(report.generation.solarSharePct))})</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
              : ''
          }

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;padding:14px 24px;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B;">
              Automated summary generated from Utility Hub · ${escapeHtml(report.recordCount.toString())} records validated.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
