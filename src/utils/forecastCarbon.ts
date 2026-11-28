import type {
  CompanyItem,
  FactoryBudget,
  GenerationEntry,
  UtilityEntry,
  UtilityItem,
} from '../types';
import { extractPlantFuelAllocations } from './equipment';
import { formatShortDate, getTodayISO } from './formatters';

// Standard industrial emission factors (Bangladesh grid + on-site fossil fuel combustion)
export const EMISSION_FACTORS = {
  gridKwhKg: 0.58, // kg CO2e per kWh grid electricity
  gasM3Kg: 1.92, // kg CO2e per m3 natural gas / CNG / LNG
  dieselLiterKg: 2.68, // kg CO2e per liter HSD / diesel
  lpgOrSolidKg: 2.95, // kg CO2e per kg LPG / solid fuel
  solarOffsetKwhKg: 0.58, // avoided grid emissions per kWh solar
} as const;

export interface MonthBounds {
  monthKey: string;
  startDate: string;
  endDate: string;
  daysInMonth: number;
  elapsedDays: number;
  monthLabel: string;
  prevMonthKey: string;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
}

export function getMonthBounds(
  monthKey: string,
  todayISO = getTodayISO()
): MonthBounds {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey);
  const year = match ? Number(match[1]) : Number(todayISO.slice(0, 4));
  const month = match ? Number(match[2]) : Number(todayISO.slice(5, 7));

  const padMonth = String(month).padStart(2, '0');
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = `${year}-${padMonth}-01`;
  const endDate = `${year}-${padMonth}-${String(daysInMonth).padStart(2, '0')}`;

  const currentMonthKey = todayISO.slice(0, 7);
  const todayDay = Number(todayISO.slice(8, 10));
  const isCurrentMonth = `${year}-${padMonth}` === currentMonthKey;
  const isFutureMonth = `${year}-${padMonth}` > currentMonthKey;

  const elapsedDays = isFutureMonth
    ? 0
    : isCurrentMonth
    ? Math.max(1, Math.min(daysInMonth, todayDay))
    : daysInMonth;

  const prevDate = new Date(Date.UTC(year, month - 2, 1));
  const prevMonthKey = `${prevDate.getUTCFullYear()}-${String(
    prevDate.getUTCMonth() + 1
  ).padStart(2, '0')}`;

  const monthLabel = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(
    'en-US',
    {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }
  );

  return {
    monthKey: `${year}-${padMonth}`,
    startDate,
    endDate,
    daysInMonth,
    elapsedDays,
    monthLabel,
    prevMonthKey,
    isCurrentMonth,
    isFutureMonth,
  };
}

export type BudgetPaceStatus =
  | 'onTrack'
  | 'watch'
  | 'overPace'
  | 'unconfigured';

export interface FactoryForecastRow {
  companyId: string;
  companyName: string;
  mtdCost: number;
  projectedEomCost: number;
  dailyBurnVelocity: number;
  activeDays: number;
  totalHours: number;
  costPerHour: number | null;
  budget: FactoryBudget | null;
  prevMonthBudget: FactoryBudget | null;
  monthlyBudgetCap: number | null;
  mtdUtilPct: number | null;
  projectedUtilPct: number | null;
  varianceAtEom: number | null;
  status: BudgetPaceStatus;
  scope1Kg: number;
  scope2Kg: number;
  grossCarbonKg: number;
  solarAvoidedKg: number;
  netCarbonKg: number;
  carbonCapKg: number | null;
  projectedCarbonKg: number;
  solarKwh: number;
  totalPowerKwh: number;
  solarSharePct: number;
  targetSolarSharePct: number | null;
  solarSavings: number;
}

export interface DailyTrajectoryPoint {
  day: number;
  date: string;
  dayLabel: string;
  dailyCost: number;
  actualCumCost: number | null;
  projectedCumCost: number | null;
  budgetPaceCost: number | null;
  warningPaceCost: number | null;
}

export interface SimulationBaseline {
  projectedEomCost: number;
  projectedGridKwh: number;
  projectedGridCost: number;
  projectedDieselGenKwh: number;
  projectedDieselCost: number;
  projectedOtherFuelAndUtilCost: number;
  projectedSolarKwh: number;
  projectedSolarSavings: number;
  projectedGrossCarbonKg: number;
  projectedAvoidedCarbonKg: number;
  projectedHours: number;
  gridRatePerKwh: number;
  dieselRatePerKwh: number;
}

export interface ForecastAnalyticsBundle {
  bounds: MonthBounds;
  mtdTotalCost: number;
  projectedEomCost: number;
  totalConfiguredBudget: number;
  configuredFactoryCount: number;
  unconfiguredFactoryCount: number;
  mtdBudgetPct: number | null;
  projectedBudgetPct: number | null;
  projectedVariance: number | null;
  overallStatus: BudgetPaceStatus;
  mtdGrossCarbonKg: number;
  mtdScope1Kg: number;
  mtdScope2Kg: number;
  mtdSolarAvoidedKg: number;
  mtdNetCarbonKg: number;
  totalCarbonCapKg: number;
  totalSolarKwh: number;
  totalPowerKwh: number;
  solarSharePct: number;
  avgTargetSolarPct: number | null;
  totalSolarSavings: number;
  totalHours: number;
  activeDaysCount: number;
  factoryRows: FactoryForecastRow[];
  trajectory: DailyTrajectoryPoint[];
  simulationBaseline: SimulationBaseline;
}

function estimateEmissionKgForFuelOrUtility(
  name: string,
  unit: string,
  quantity: number
): { scope1Kg: number; scope2Kg: number } {
  if (!(quantity > 0)) return { scope1Kg: 0, scope2Kg: 0 };
  const n = name.toLowerCase();
  const u = unit.toLowerCase().trim();

  if (u === 'kwh' || n.includes('electric') || n.includes('grid')) {
    return { scope1Kg: 0, scope2Kg: quantity * EMISSION_FACTORS.gridKwhKg };
  }
  if (
    u === 'l' ||
    u === 'ltr' ||
    u === 'liter' ||
    u === 'liters' ||
    n.includes('diesel') ||
    n.includes('hsd') ||
    n.includes('furnace')
  ) {
    return { scope1Kg: quantity * EMISSION_FACTORS.dieselLiterKg, scope2Kg: 0 };
  }
  if (
    u === 'm3' ||
    u === 'm³' ||
    u === 'scm' ||
    u === 'cft' ||
    n.includes('gas') ||
    n.includes('cng') ||
    n.includes('lng') ||
    n.includes('sng')
  ) {
    // Convert cft to m3 roughly if someone enters cft (1 m3 ≈ 35.3147 cft)
    const m3Qty = u === 'cft' ? quantity / 35.3147 : quantity;
    return { scope1Kg: m3Qty * EMISSION_FACTORS.gasM3Kg, scope2Kg: 0 };
  }
  if (!n.includes('steam') && (n.includes('lpg') || n.includes('solid') || n.includes('coal') || n.includes('wood'))) {
    if (u === 'kg' || u === 'ton' || u === 'mt') {
      const kgQty = u === 'ton' || u === 'mt' ? quantity * 1000 : quantity;
      return { scope1Kg: kgQty * EMISSION_FACTORS.lpgOrSolidKg, scope2Kg: 0 };
    }
  }
  return { scope1Kg: 0, scope2Kg: 0 };
}

export function buildMonthlyBudgetForecast(params: {
  monthKey: string;
  companies: CompanyItem[];
  scopeCompanyNames: string[];
  utilities: UtilityItem[];
  entries: UtilityEntry[];
  generationEntries: GenerationEntry[];
  budgets: FactoryBudget[];
  todayISO?: string;
}): ForecastAnalyticsBundle {
  const {
    monthKey,
    companies,
    scopeCompanyNames,
    utilities,
    entries,
    generationEntries,
    budgets,
    todayISO = getTodayISO(),
  } = params;

  const bounds = getMonthBounds(monthKey, todayISO);
  const scopeSet = new Set(scopeCompanyNames);
  const companyMap = new Map(companies.map((c) => [c.name, c]));
  const budgetMap = new Map<string, FactoryBudget>();
  const prevBudgetMap = new Map<string, FactoryBudget>();

  for (const b of budgets) {
    if (!scopeSet.has(b.companyName)) continue;
    if (b.month === bounds.monthKey) {
      budgetMap.set(b.companyName, b);
    } else if (b.month === bounds.prevMonthKey) {
      prevBudgetMap.set(b.companyName, b);
    }
  }

  const monthEntries = entries.filter(
    (e) =>
      scopeSet.has(e.company) &&
      e.date >= bounds.startDate &&
      e.date <= bounds.endDate
  );

  const monthGen = generationEntries.filter(
    (g) =>
      scopeSet.has(g.company) &&
      g.date >= bounds.startDate &&
      g.date <= bounds.endDate
  );

  const electricityUtil = utilities.find(
    (u) =>
      u.name.toLowerCase().includes('electric') ||
      u.unit.toLowerCase() === 'kwh'
  );

  const dailyCostMap = new Map<string, number>();
  const activeDatesGlobal = new Set<string>();

  type FactoryAcc = {
    companyId: string;
    companyName: string;
    mtdCost: number;
    dates: Set<string>;
    totalHours: number;
    scope1Kg: number;
    scope2Kg: number;
    solarAvoidedKg: number;
    gridKwh: number;
    gridCost: number;
    genKwh: number;
    dieselGenKwh: number;
    dieselCost: number;
    solarKwh: number;
    solarSavings: number;
  };

  const factoryAccMap = new Map<string, FactoryAcc>();
  for (const name of scopeCompanyNames) {
    const comp = companyMap.get(name);
    factoryAccMap.set(name, {
      companyId: comp?.id || name,
      companyName: name,
      mtdCost: 0,
      dates: new Set(),
      totalHours: 0,
      scope1Kg: 0,
      scope2Kg: 0,
      solarAvoidedKg: 0,
      gridKwh: 0,
      gridCost: 0,
      genKwh: 0,
      dieselGenKwh: 0,
      dieselCost: 0,
      solarKwh: 0,
      solarSavings: 0,
    });
  }

  for (const item of monthEntries) {
    const f = factoryAccMap.get(item.company);
    if (!f) continue;
    const hrs = Number(item.operatingHours) || 0;
    f.mtdCost += item.cost;
    f.dates.add(item.date);
    if (hrs > 0) f.totalHours += hrs;

    const em = estimateEmissionKgForFuelOrUtility(
      item.utilityName,
      item.unit,
      item.consumption
    );
    f.scope1Kg += em.scope1Kg;
    f.scope2Kg += em.scope2Kg;

    if (
      (electricityUtil && item.utilityId === electricityUtil.id) ||
      item.unit.toLowerCase() === 'kwh'
    ) {
      f.gridKwh += item.consumption;
      f.gridCost += item.cost;
    }

    activeDatesGlobal.add(item.date);
    dailyCostMap.set(item.date, (dailyCostMap.get(item.date) || 0) + item.cost);
  }

  for (const gen of monthGen) {
    const f = factoryAccMap.get(gen.company);
    if (!f) continue;
    const eqHrs =
      (Number(gen.boilerOperatingHours) || 0) +
      (Number(gen.generatorOperatingHours) || 0) +
      (Number(gen.solarOperatingHours) || 0);
    if (eqHrs > 0) f.totalHours += eqHrs;

    f.genKwh += Number(gen.generatorKwh) || 0;
    f.dieselGenKwh += Number(gen.dieselGenKwh) || 0;
    f.dieselCost += Number(gen.dieselFuelCost) || 0;
    f.solarKwh += Number(gen.solarKwh) || 0;
    f.solarSavings += Number(gen.solarSavings) || 0;
    f.solarAvoidedKg +=
      (Number(gen.solarKwh) || 0) * EMISSION_FACTORS.solarOffsetKwhKg;

    const allocs = extractPlantFuelAllocations(
      gen,
      utilities,
      companyMap.get(gen.company)
    );
    for (const a of allocs) {
      f.mtdCost += a.cost;
      f.dates.add(gen.date);
      const em = estimateEmissionKgForFuelOrUtility(a.name, a.unit, a.consumption);
      f.scope1Kg += em.scope1Kg;
      f.scope2Kg += em.scope2Kg;

      activeDatesGlobal.add(gen.date);
      dailyCostMap.set(gen.date, (dailyCostMap.get(gen.date) || 0) + a.cost);
    }
  }

  // Projection ratio based on elapsed calendar days in month (bounded to avoid day-1 spikes if >0)
  const projectionFactor =
    bounds.elapsedDays > 0 && !bounds.isFutureMonth
      ? bounds.daysInMonth / bounds.elapsedDays
      : 1;

  let mtdTotalCost = 0;
  let projectedEomCost = 0;
  let totalConfiguredBudget = 0;
  let configuredFactoryCount = 0;
  let unconfiguredFactoryCount = 0;
  let mtdScope1Kg = 0;
  let mtdScope2Kg = 0;
  let mtdSolarAvoidedKg = 0;
  let totalCarbonCapKg = 0;
  let totalSolarKwh = 0;
  let totalPowerKwh = 0;
  let totalSolarSavings = 0;
  let totalHours = 0;

  let totalGridKwh = 0;
  let totalGridCost = 0;
  let totalDieselGenKwh = 0;
  let totalDieselCost = 0;

  const targetSolarList: number[] = [];

  const factoryRows: FactoryForecastRow[] = Array.from(factoryAccMap.values())
    .map((f) => {
      const budget = budgetMap.get(f.companyName) || null;
      const prevMonthBudget = prevBudgetMap.get(f.companyName) || null;
      const activeDays = f.dates.size;

      // Velocity: prefer elapsed days in current/past month for smooth calendar projection
      const effectiveElapsed = bounds.isCurrentMonth
        ? Math.max(1, bounds.elapsedDays)
        : Math.max(1, activeDays || bounds.elapsedDays);
      const dailyBurnVelocity =
        f.mtdCost > 0 ? f.mtdCost / effectiveElapsed : 0;
      const factoryProjectedEom = bounds.isCurrentMonth
        ? f.mtdCost * projectionFactor
        : f.mtdCost;

      const cap =
        budget && budget.monthlySpendLimit > 0 ? budget.monthlySpendLimit : null;
      const threshold = budget?.alertThresholdPct ?? 85;
      const mtdUtilPct = cap ? (f.mtdCost / cap) * 100 : null;
      const projectedUtilPct = cap ? (factoryProjectedEom / cap) * 100 : null;
      const varianceAtEom = cap !== null ? factoryProjectedEom - cap : null;

      let status: BudgetPaceStatus = 'unconfigured';
      if (cap !== null && projectedUtilPct !== null) {
        if (projectedUtilPct > 100 || (mtdUtilPct !== null && mtdUtilPct > 100)) {
          status = 'overPace';
        } else if (
          projectedUtilPct >= threshold ||
          (mtdUtilPct !== null && mtdUtilPct >= threshold)
        ) {
          status = 'watch';
        } else {
          status = 'onTrack';
        }
      }

      const grossCarbonKg = f.scope1Kg + f.scope2Kg;
      const netCarbonKg = Math.max(0, grossCarbonKg - f.solarAvoidedKg);
      const projectedCarbonKg = bounds.isCurrentMonth
        ? grossCarbonKg * projectionFactor
        : grossCarbonKg;
      const carbonCapKg =
        budget?.monthlyCarbonCapKg && budget.monthlyCarbonCapKg > 0
          ? budget.monthlyCarbonCapKg
          : null;

      const factoryTotalPower = f.gridKwh + f.genKwh + f.solarKwh;
      const solarSharePct =
        factoryTotalPower > 0 ? (f.solarKwh / factoryTotalPower) * 100 : 0;
      const targetSolarSharePct =
        budget?.targetSolarSharePct !== undefined && budget.targetSolarSharePct > 0
          ? budget.targetSolarSharePct
          : null;

      mtdTotalCost += f.mtdCost;
      projectedEomCost += factoryProjectedEom;
      mtdScope1Kg += f.scope1Kg;
      mtdScope2Kg += f.scope2Kg;
      mtdSolarAvoidedKg += f.solarAvoidedKg;
      totalSolarKwh += f.solarKwh;
      totalPowerKwh += factoryTotalPower;
      totalSolarSavings += f.solarSavings;
      totalHours += f.totalHours;
      totalGridKwh += f.gridKwh;
      totalGridCost += f.gridCost;
      totalDieselGenKwh += f.dieselGenKwh;
      totalDieselCost += f.dieselCost;

      if (cap !== null) {
        totalConfiguredBudget += cap;
        configuredFactoryCount += 1;
      } else {
        unconfiguredFactoryCount += 1;
      }
      if (carbonCapKg !== null) {
        totalCarbonCapKg += carbonCapKg;
      }
      if (targetSolarSharePct !== null) {
        targetSolarList.push(targetSolarSharePct);
      }

      return {
        companyId: f.companyId,
        companyName: f.companyName,
        mtdCost: f.mtdCost,
        projectedEomCost: factoryProjectedEom,
        dailyBurnVelocity,
        activeDays,
        totalHours: f.totalHours,
        costPerHour: f.totalHours > 0 ? f.mtdCost / f.totalHours : null,
        budget,
        prevMonthBudget,
        monthlyBudgetCap: cap,
        mtdUtilPct,
        projectedUtilPct,
        varianceAtEom,
        status,
        scope1Kg: f.scope1Kg,
        scope2Kg: f.scope2Kg,
        grossCarbonKg,
        solarAvoidedKg: f.solarAvoidedKg,
        netCarbonKg,
        carbonCapKg,
        projectedCarbonKg,
        solarKwh: f.solarKwh,
        totalPowerKwh: factoryTotalPower,
        solarSharePct,
        targetSolarSharePct,
        solarSavings: f.solarSavings,
      };
    })
    .sort((a, b) => b.mtdCost - a.mtdCost);

  // Build Daily Cumulative Trajectory across all days of the month
  const trajectory: DailyTrajectoryPoint[] = [];
  let runningActual = 0;
  let lastLoggedDay = 0;
  for (let d = 1; d <= bounds.daysInMonth; d++) {
    const date = `${bounds.monthKey}-${String(d).padStart(2, '0')}`;
    if ((dailyCostMap.get(date) || 0) > 0) {
      lastLoggedDay = d;
    }
  }
  const cutoffActualDay = bounds.isCurrentMonth
    ? Math.max(bounds.elapsedDays, lastLoggedDay)
    : bounds.isFutureMonth
    ? 0
    : bounds.daysInMonth;

  const avgWarningPct =
    configuredFactoryCount > 0
      ? factoryRows
          .filter((r) => r.monthlyBudgetCap !== null)
          .reduce((acc, r) => acc + (r.budget?.alertThresholdPct ?? 85), 0) /
        configuredFactoryCount
      : 85;

  // Slope per remaining day from cutoffActualDay to daysInMonth
  const remainingDays = Math.max(0, bounds.daysInMonth - cutoffActualDay);
  const dailySlope =
    cutoffActualDay > 0 && projectedEomCost > mtdTotalCost && remainingDays > 0
      ? (projectedEomCost - mtdTotalCost) / remainingDays
      : cutoffActualDay > 0 && mtdTotalCost > 0
      ? mtdTotalCost / cutoffActualDay
      : 0;

  let cumAtCutoff = 0;
  for (let d = 1; d <= bounds.daysInMonth; d++) {
    const date = `${bounds.monthKey}-${String(d).padStart(2, '0')}`;
    const dailyCost = dailyCostMap.get(date) || 0;
    runningActual += dailyCost;
    if (d === cutoffActualDay) {
      cumAtCutoff = runningActual;
    }

    const budgetPaceCost =
      totalConfiguredBudget > 0
        ? (totalConfiguredBudget / bounds.daysInMonth) * d
        : null;
    const warningPaceCost =
      budgetPaceCost !== null ? budgetPaceCost * (avgWarningPct / 100) : null;

    const isActualWindow = d <= cutoffActualDay && !bounds.isFutureMonth;
    const projectedCumCost =
      bounds.isCurrentMonth && cutoffActualDay > 0 && d >= cutoffActualDay
        ? d === cutoffActualDay
          ? cumAtCutoff
          : cumAtCutoff + dailySlope * (d - cutoffActualDay)
        : null;

    trajectory.push({
      day: d,
      date,
      dayLabel: formatShortDate(date),
      dailyCost,
      actualCumCost: isActualWindow ? runningActual : null,
      projectedCumCost,
      budgetPaceCost,
      warningPaceCost,
    });
  }

  const mtdBudgetPct =
    totalConfiguredBudget > 0 ? (mtdTotalCost / totalConfiguredBudget) * 100 : null;
  const projectedBudgetPct =
    totalConfiguredBudget > 0
      ? (projectedEomCost / totalConfiguredBudget) * 100
      : null;
  const projectedVariance =
    totalConfiguredBudget > 0 ? projectedEomCost - totalConfiguredBudget : null;

  let overallStatus: BudgetPaceStatus = 'unconfigured';
  if (totalConfiguredBudget > 0 && projectedBudgetPct !== null) {
    if (
      projectedBudgetPct > 100 ||
      (mtdBudgetPct !== null && mtdBudgetPct > 100)
    ) {
      overallStatus = 'overPace';
    } else if (
      projectedBudgetPct >= avgWarningPct ||
      (mtdBudgetPct !== null && mtdBudgetPct >= avgWarningPct)
    ) {
      overallStatus = 'watch';
    } else {
      overallStatus = 'onTrack';
    }
  }

  const mtdGrossCarbonKg = mtdScope1Kg + mtdScope2Kg;
  const mtdNetCarbonKg = Math.max(0, mtdGrossCarbonKg - mtdSolarAvoidedKg);
  const solarSharePct =
    totalPowerKwh > 0 ? (totalSolarKwh / totalPowerKwh) * 100 : 0;
  const avgTargetSolarPct =
    targetSolarList.length > 0
      ? targetSolarList.reduce((a, b) => a + b, 0) / targetSolarList.length
      : null;

  const projFactorSim = bounds.isCurrentMonth ? projectionFactor : 1;
  const projectedGridKwh = totalGridKwh * projFactorSim;
  const projectedGridCost = totalGridCost * projFactorSim;
  const projectedDieselGenKwh = totalDieselGenKwh * projFactorSim;
  const projectedDieselCost = totalDieselCost * projFactorSim;
  const projectedSolarKwh = totalSolarKwh * projFactorSim;
  const projectedSolarSavings = totalSolarSavings * projFactorSim;
  const projectedOtherFuelAndUtilCost = Math.max(
    0,
    projectedEomCost - projectedGridCost - projectedDieselCost
  );

  const gridRatePerKwh =
    totalGridKwh > 0 && totalGridCost > 0 ? totalGridCost / totalGridKwh : 10.5;
  const dieselRatePerKwh =
    totalDieselGenKwh > 0 && totalDieselCost > 0
      ? totalDieselCost / totalDieselGenKwh
      : 28.0;

  return {
    bounds,
    mtdTotalCost,
    projectedEomCost,
    totalConfiguredBudget,
    configuredFactoryCount,
    unconfiguredFactoryCount,
    mtdBudgetPct,
    projectedBudgetPct,
    projectedVariance,
    overallStatus,
    mtdGrossCarbonKg,
    mtdScope1Kg,
    mtdScope2Kg,
    mtdSolarAvoidedKg,
    mtdNetCarbonKg,
    totalCarbonCapKg,
    totalSolarKwh,
    totalPowerKwh,
    solarSharePct,
    avgTargetSolarPct,
    totalSolarSavings,
    totalHours,
    activeDaysCount: activeDatesGlobal.size,
    factoryRows,
    trajectory,
    simulationBaseline: {
      projectedEomCost,
      projectedGridKwh,
      projectedGridCost,
      projectedDieselGenKwh,
      projectedDieselCost,
      projectedOtherFuelAndUtilCost,
      projectedSolarKwh,
      projectedSolarSavings,
      projectedGrossCarbonKg: mtdGrossCarbonKg * projFactorSim,
      projectedAvoidedCarbonKg: mtdSolarAvoidedKg * projFactorSim,
      projectedHours: totalHours * projFactorSim,
      gridRatePerKwh,
      dieselRatePerKwh,
    },
  };
}
