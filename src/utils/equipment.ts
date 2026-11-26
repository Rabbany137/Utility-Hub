import type {
  BoilerUnitReading,
  CompanyDeviceConfigs,
  CompanyItem,
  DeviceFuelMode,
  GenerationEntry,
  GenerationUnitReadings,
  GeneratorUnitReading,
  PlantDeviceConfig,
  SingleDeviceFuelMode,
  SolarDeviceConfig,
  UtilityItem,
} from '../types';

export const SINGLE_FUEL_OPTIONS: Array<{
  mode: SingleDeviceFuelMode;
  label: string;
  shortLabel: string;
  defaultUnit: string;
}> = [
  { mode: 'gas', label: 'Natural Gas (m³)', shortLabel: 'Natural Gas', defaultUnit: 'm³' },
  { mode: 'cng', label: 'CNG (m³)', shortLabel: 'CNG', defaultUnit: 'm³' },
  { mode: 'lng', label: 'LNG (m³)', shortLabel: 'LNG', defaultUnit: 'm³' },
  { mode: 'lpg', label: 'LPG (kg)', shortLabel: 'LPG', defaultUnit: 'kg' },
  { mode: 'sng', label: 'SNG (m³)', shortLabel: 'SNG', defaultUnit: 'm³' },
  { mode: 'diesel', label: 'Diesel / HFO (L)', shortLabel: 'Diesel', defaultUnit: 'L' },
  { mode: 'solid', label: 'Solid Fuel (kg)', shortLabel: 'Solid Fuel', defaultUnit: 'kg' },
  { mode: 'electric', label: 'Electric (kWh)', shortLabel: 'Electric', defaultUnit: 'kWh' },
];

export const BOILER_FUEL_MODES: Array<{
  mode: DeviceFuelMode;
  label: string;
  shortLabel: string;
  defaultUnit: string;
  primaryMode?: SingleDeviceFuelMode;
  secondaryMode?: SingleDeviceFuelMode;
  secondaryUnit?: string;
}> = [
  { mode: 'gas', label: 'Natural Gas (m³)', shortLabel: 'Natural Gas', defaultUnit: 'm³' },
  { mode: 'cng', label: 'CNG (m³)', shortLabel: 'CNG', defaultUnit: 'm³' },
  { mode: 'lng', label: 'LNG (m³)', shortLabel: 'LNG', defaultUnit: 'm³' },
  { mode: 'lpg', label: 'LPG (kg)', shortLabel: 'LPG', defaultUnit: 'kg' },
  { mode: 'sng', label: 'SNG (m³)', shortLabel: 'SNG', defaultUnit: 'm³' },
  { mode: 'diesel', label: 'Diesel / HFO (L)', shortLabel: 'Diesel', defaultUnit: 'L' },
  {
    mode: 'dual',
    label: 'Dual-Fuel (Select 2 Fuels)',
    shortLabel: 'Dual-Fuel',
    defaultUnit: 'm³',
    primaryMode: 'gas',
    secondaryMode: 'diesel',
    secondaryUnit: 'L',
  },
  { mode: 'solid', label: 'Solid Fuel (kg)', shortLabel: 'Solid Fuel', defaultUnit: 'kg' },
  { mode: 'electric', label: 'Electric (kWh)', shortLabel: 'Electric', defaultUnit: 'kWh' },
];

export const GENERATOR_FUEL_MODES: Array<{
  mode: DeviceFuelMode;
  label: string;
  shortLabel: string;
  defaultUnit: string;
  primaryMode?: SingleDeviceFuelMode;
  secondaryMode?: SingleDeviceFuelMode;
  secondaryUnit?: string;
}> = [
  { mode: 'diesel', label: 'Diesel / HFO (L)', shortLabel: 'Diesel', defaultUnit: 'L' },
  { mode: 'gas', label: 'Natural Gas (m³)', shortLabel: 'Natural Gas', defaultUnit: 'm³' },
  { mode: 'cng', label: 'CNG (m³)', shortLabel: 'CNG', defaultUnit: 'm³' },
  { mode: 'lng', label: 'LNG (m³)', shortLabel: 'LNG', defaultUnit: 'm³' },
  { mode: 'lpg', label: 'LPG (kg)', shortLabel: 'LPG', defaultUnit: 'kg' },
  { mode: 'sng', label: 'SNG (m³)', shortLabel: 'SNG', defaultUnit: 'm³' },
  {
    mode: 'dual',
    label: 'Dual-Fuel (Select 2 Fuels)',
    shortLabel: 'Dual-Fuel',
    defaultUnit: 'm³',
    primaryMode: 'gas',
    secondaryMode: 'diesel',
    secondaryUnit: 'L',
  },
];

export function isGasLikeFuelMode(mode: DeviceFuelMode): boolean {
  return (
    mode === 'gas' ||
    mode === 'cng' ||
    mode === 'lng' ||
    mode === 'lpg' ||
    mode === 'sng'
  );
}

export function getUnitOptionsForFuelMode(mode: DeviceFuelMode): string[] {
  switch (mode) {
    case 'cng':
    case 'sng':
      return ['m³', 'kg'];
    case 'lng':
      return ['m³', 'kg', 'L'];
    case 'lpg':
      return ['kg', 'L', 'm³'];
    default:
      return [];
  }
}

export function unitToFuelMode(unit?: string): SingleDeviceFuelMode {
  const normalized = (unit || '').trim().toLowerCase();
  if (normalized === 'l' || normalized === 'liter' || normalized === 'liters') return 'diesel';
  if (normalized === 'kg') return 'solid';
  if (normalized === 'kwh') return 'electric';
  return 'gas';
}

export function normalizeSingleFuelMode(
  raw: unknown,
  fallbackUnit?: string
): SingleDeviceFuelMode {
  if (
    raw === 'gas' ||
    raw === 'cng' ||
    raw === 'lng' ||
    raw === 'lpg' ||
    raw === 'sng' ||
    raw === 'diesel' ||
    raw === 'solid' ||
    raw === 'electric'
  ) {
    return raw;
  }
  return unitToFuelMode(fallbackUnit);
}

export function defaultUnitForFuelMode(mode: DeviceFuelMode): string {
  switch (mode) {
    case 'diesel':
      return 'L';
    case 'lpg':
    case 'solid':
      return 'kg';
    case 'electric':
      return 'kWh';
    case 'cng':
    case 'lng':
    case 'sng':
    case 'dual':
    case 'gas':
    default:
      return 'm³';
  }
}

export function getFuelLabelForUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'l' || normalized === 'liter' || normalized === 'liters') return 'Diesel';
  if (normalized === 'm³' || normalized === 'm3') return 'Natural Gas';
  if (normalized === 'kg') return 'Solid Fuel';
  if (normalized === 'kwh') return 'Electric';
  return unit;
}

export function getFuelLabel(mode?: DeviceFuelMode, unit?: string): string {
  switch (mode) {
    case 'cng':
      return 'CNG';
    case 'lng':
      return 'LNG';
    case 'lpg':
      return 'LPG';
    case 'sng':
      return 'SNG';
    case 'gas':
      return 'Natural Gas';
    case 'diesel':
      return 'Diesel';
    case 'solid':
      return 'Solid Fuel';
    case 'electric':
      return 'Electric';
    default:
      return getFuelLabelForUnit(unit || 'm³');
  }
}

export function formatDeviceFuelBadge(
  device: Pick<
    PlantDeviceConfig,
    'fuelMode' | 'fuelUnit' | 'primaryFuelMode' | 'secondaryFuelMode' | 'secondaryFuelUnit'
  >
): string {
  if (device.fuelMode === 'dual') {
    const pMode = device.primaryFuelMode || unitToFuelMode(device.fuelUnit || 'm³');
    const sMode = device.secondaryFuelMode || unitToFuelMode(device.secondaryFuelUnit || 'L');
    const pUnit = device.fuelUnit || defaultUnitForFuelMode(pMode);
    const sUnit = device.secondaryFuelUnit || defaultUnitForFuelMode(sMode);
    return `Dual-Fuel: ${getFuelLabel(pMode, pUnit)} (${pUnit}) + ${getFuelLabel(sMode, sUnit)} (${sUnit})`;
  }
  const unit = device.fuelUnit || defaultUnitForFuelMode(device.fuelMode);
  const label = getFuelLabel(device.fuelMode, unit);
  return `${label} (${unit})`;
}

export function createDeviceId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function normalizeFuelMode(raw: unknown, fallbackUnit: string): DeviceFuelMode {
  if (
    raw === 'gas' ||
    raw === 'cng' ||
    raw === 'lng' ||
    raw === 'lpg' ||
    raw === 'sng' ||
    raw === 'diesel' ||
    raw === 'dual' ||
    raw === 'solid' ||
    raw === 'electric'
  ) {
    return raw;
  }
  return unitToFuelMode(fallbackUnit);
}

export function parseCompanyDeviceConfigs(raw?: string): CompanyDeviceConfigs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompanyDeviceConfigs>;
    if (!parsed || typeof parsed !== 'object') return null;

    const boilers: PlantDeviceConfig[] = Array.isArray(parsed.boilers)
      ? parsed.boilers.slice(0, 50).map((b, idx) => {
          const fuelUnit =
            typeof b?.fuelUnit === 'string' && b.fuelUnit.trim()
              ? b.fuelUnit.trim().slice(0, 20)
              : 'm³';
          const fuelMode = normalizeFuelMode(b?.fuelMode, fuelUnit);
          const secondaryFuelUnit =
            fuelMode === 'dual'
              ? typeof b?.secondaryFuelUnit === 'string' && b.secondaryFuelUnit.trim()
                ? b.secondaryFuelUnit.trim().slice(0, 20)
                : 'L'
              : undefined;
          const primaryFuelMode =
            fuelMode === 'dual'
              ? normalizeSingleFuelMode(b?.primaryFuelMode, fuelUnit)
              : undefined;
          const secondaryFuelMode =
            fuelMode === 'dual'
              ? normalizeSingleFuelMode(b?.secondaryFuelMode, secondaryFuelUnit || 'L')
              : undefined;

          return {
            id:
              typeof b?.id === 'string' && b.id.trim()
                ? b.id.trim().slice(0, 64)
                : `boiler_${idx + 1}`,
            name:
              typeof b?.name === 'string' && b.name.trim()
                ? b.name.trim().slice(0, 80)
                : `Boiler #${idx + 1}`,
            fuelMode,
            fuelUnit: fuelMode === 'dual' ? fuelUnit : fuelUnit || defaultUnitForFuelMode(fuelMode),
            ...(primaryFuelMode ? { primaryFuelMode } : {}),
            ...(secondaryFuelMode ? { secondaryFuelMode } : {}),
            ...(secondaryFuelUnit ? { secondaryFuelUnit } : {}),
          };
        })
      : [];

    const generators: PlantDeviceConfig[] = Array.isArray(parsed.generators)
      ? parsed.generators.slice(0, 50).map((g, idx) => {
          const fuelUnit =
            typeof g?.fuelUnit === 'string' && g.fuelUnit.trim()
              ? g.fuelUnit.trim().slice(0, 20)
              : 'L';
          const fuelMode = normalizeFuelMode(g?.fuelMode, fuelUnit);
          const secondaryFuelUnit =
            fuelMode === 'dual'
              ? typeof g?.secondaryFuelUnit === 'string' && g.secondaryFuelUnit.trim()
                ? g.secondaryFuelUnit.trim().slice(0, 20)
                : 'L'
              : undefined;
          const primaryFuelMode =
            fuelMode === 'dual'
              ? normalizeSingleFuelMode(g?.primaryFuelMode, fuelUnit)
              : undefined;
          const secondaryFuelMode =
            fuelMode === 'dual'
              ? normalizeSingleFuelMode(g?.secondaryFuelMode, secondaryFuelUnit || 'L')
              : undefined;

          return {
            id:
              typeof g?.id === 'string' && g.id.trim()
                ? g.id.trim().slice(0, 64)
                : `gen_${idx + 1}`,
            name:
              typeof g?.name === 'string' && g.name.trim()
                ? g.name.trim().slice(0, 80)
                : `Generator #${idx + 1}`,
            fuelMode,
            fuelUnit: fuelMode === 'dual' ? fuelUnit : fuelUnit || defaultUnitForFuelMode(fuelMode),
            ...(primaryFuelMode ? { primaryFuelMode } : {}),
            ...(secondaryFuelMode ? { secondaryFuelMode } : {}),
            ...(secondaryFuelUnit ? { secondaryFuelUnit } : {}),
          };
        })
      : [];

    const solars: SolarDeviceConfig[] = Array.isArray(parsed.solars)
      ? parsed.solars.slice(0, 50).map((s, idx) => ({
          id:
            typeof s?.id === 'string' && s.id.trim()
              ? s.id.trim().slice(0, 64)
              : `solar_${idx + 1}`,
          name:
            typeof s?.name === 'string' && s.name.trim()
              ? s.name.trim().slice(0, 80)
              : `Solar #${idx + 1}`,
        }))
      : [];

    return { boilers, generators, solars };
  } catch {
    return null;
  }
}

export function resolveCompanyDeviceConfigs(
  company?: Partial<CompanyItem> | null,
  fallbackGen?: GenerationEntry | null
): CompanyDeviceConfigs {
  const parsed = parseCompanyDeviceConfigs(company?.deviceConfigs);
  if (parsed) return parsed;

  const hasExplicitCounts = Boolean(
    company &&
      (company.equipmentConfigured ||
        company.boilerCount !== undefined ||
        company.dieselGeneratorCount !== undefined ||
        company.gasGeneratorCount !== undefined ||
        company.solarCount !== undefined)
  );

  const bCount = Math.max(
    0,
    hasExplicitCounts ? company?.boilerCount ?? 0 : fallbackGen?.boilerCount ?? 0
  );
  const bUnit =
    (hasExplicitCounts ? company?.boilerFuelUnit : fallbackGen?.boilerFuelUnit) || 'm³';
  const bMode = unitToFuelMode(bUnit);

  const dCount = Math.max(
    0,
    hasExplicitCounts
      ? company?.dieselGeneratorCount ?? 0
      : fallbackGen?.dieselGeneratorCount ?? fallbackGen?.generatorCount ?? 0
  );
  const gCount = Math.max(
    0,
    hasExplicitCounts ? company?.gasGeneratorCount ?? 0 : fallbackGen?.gasGeneratorCount ?? 0
  );
  const sCount = Math.max(
    0,
    hasExplicitCounts ? company?.solarCount ?? 0 : fallbackGen?.solarSystemCount ?? 0
  );

  const boilers: PlantDeviceConfig[] = Array.from({ length: bCount }, (_, idx) => ({
    id: `boiler_${idx + 1}`,
    name: `Boiler #${idx + 1}`,
    fuelMode: bMode,
    fuelUnit: bUnit === 'Mixed' ? 'm³' : bUnit,
  }));

  const generators: PlantDeviceConfig[] = [
    ...Array.from({ length: dCount }, (_, idx) => ({
      id: `diesel_gen_${idx + 1}`,
      name: `Diesel Gen #${idx + 1}`,
      fuelMode: 'diesel' as DeviceFuelMode,
      fuelUnit: 'L',
    })),
    ...Array.from({ length: gCount }, (_, idx) => ({
      id: `gas_gen_${idx + 1}`,
      name: `Gas Gen #${idx + 1}`,
      fuelMode: 'gas' as DeviceFuelMode,
      fuelUnit: 'm³',
    })),
  ];

  const solars: SolarDeviceConfig[] = Array.from({ length: sCount }, (_, idx) => ({
    id: `solar_${idx + 1}`,
    name: sCount === 1 ? 'Solar Power' : `Solar #${idx + 1}`,
  }));

  return { boilers, generators, solars };
}

export function getBoilerReadingTotalCost(b: Partial<BoilerUnitReading>): number {
  if (typeof b.totalFuelCost === 'number' && Number.isFinite(b.totalFuelCost)) {
    return b.totalFuelCost;
  }
  return (Number(b.fuelCost) || 0) + (Number(b.secondaryFuelCost) || 0);
}

export function getGenReadingTotalCost(g: Partial<GeneratorUnitReading>): number {
  if (typeof g.totalFuelCost === 'number' && Number.isFinite(g.totalFuelCost)) {
    return g.totalFuelCost;
  }
  return (Number(g.fuelCost) || 0) + (Number(g.secondaryFuelCost) || 0);
}

export interface ResolvedFuelTarget {
  id: string;
  name: string;
  unit: string;
  color: string;
  isUtilityMatch: boolean;
}

export interface PlantFuelAllocation extends ResolvedFuelTarget {
  consumption: number;
  cost: number;
}

const SYNTHETIC_FUEL_META: Record<
  SingleDeviceFuelMode,
  { id: string; name: string; defaultUnit: string; color: string }
> = {
  gas: { id: '__fuel_gas__', name: 'Natural Gas', defaultUnit: 'm³', color: '#2F6FDE' },
  cng: { id: '__fuel_cng__', name: 'CNG', defaultUnit: 'm³', color: '#0284C7' },
  lng: { id: '__fuel_lng__', name: 'LNG', defaultUnit: 'm³', color: '#0891B2' },
  lpg: { id: '__fuel_lpg__', name: 'LPG', defaultUnit: 'kg', color: '#EA580C' },
  sng: { id: '__fuel_sng__', name: 'SNG', defaultUnit: 'm³', color: '#6366F1' },
  diesel: { id: '__fuel_diesel__', name: 'Diesel', defaultUnit: 'Liters', color: '#B5472B' },
  solid: { id: '__fuel_solid__', name: 'Solid Fuel', defaultUnit: 'kg', color: '#78716C' },
  electric: {
    id: '__fuel_electric__',
    name: 'Electricity',
    defaultUnit: 'kWh',
    color: '#0F766E',
  },
};

export function resolveFuelTarget(
  fuelMode: SingleDeviceFuelMode,
  fuelUnit: string | undefined,
  utilities: UtilityItem[]
): ResolvedFuelTarget {
  let matched: UtilityItem | undefined;

  if (fuelMode === 'cng') {
    matched = utilities.find(
      (u) =>
        u.id.toLowerCase().includes('cng') || u.name.toLowerCase().includes('cng')
    );
  } else if (fuelMode === 'lng') {
    matched = utilities.find(
      (u) =>
        u.id.toLowerCase().includes('lng') || u.name.toLowerCase().includes('lng')
    );
  } else if (fuelMode === 'lpg') {
    matched = utilities.find(
      (u) =>
        u.id.toLowerCase().includes('lpg') || u.name.toLowerCase().includes('lpg')
    );
  } else if (fuelMode === 'sng') {
    matched = utilities.find(
      (u) =>
        u.id.toLowerCase().includes('sng') || u.name.toLowerCase().includes('sng')
    );
  } else if (fuelMode === 'gas') {
    matched = utilities.find((u) => {
      const id = u.id.toLowerCase();
      const name = u.name.toLowerCase();
      if (
        id.includes('cng') ||
        name.includes('cng') ||
        id.includes('lng') ||
        name.includes('lng') ||
        id.includes('lpg') ||
        name.includes('lpg') ||
        id.includes('sng') ||
        name.includes('sng')
      ) {
        return false;
      }
      return id === 'gas' || name.includes('natural gas') || name.includes('gas');
    });
  } else if (fuelMode === 'diesel') {
    matched = utilities.find((u) => {
      const id = u.id.toLowerCase();
      const name = u.name.toLowerCase();
      return id === 'diesel' || name.includes('diesel') || name.includes('hfo');
    });
  } else if (fuelMode === 'solid') {
    matched = utilities.find((u) => {
      const id = u.id.toLowerCase();
      const name = u.name.toLowerCase();
      return (
        id.includes('solid') ||
        name.includes('solid') ||
        name.includes('coal') ||
        name.includes('husk') ||
        name.includes('wood') ||
        name.includes('biomass')
      );
    });
  } else if (fuelMode === 'electric') {
    matched = utilities.find((u) => {
      const id = u.id.toLowerCase();
      const name = u.name.toLowerCase();
      return id === 'electricity' || name.includes('electric') || u.unit.toLowerCase() === 'kwh';
    });
  }

  if (matched) {
    return {
      id: matched.id,
      name: matched.name,
      unit: matched.unit || fuelUnit || SYNTHETIC_FUEL_META[fuelMode].defaultUnit,
      color: matched.color,
      isUtilityMatch: true,
    };
  }

  const meta = SYNTHETIC_FUEL_META[fuelMode] || SYNTHETIC_FUEL_META.gas;
  return {
    id: meta.id,
    name: meta.name,
    unit: (fuelUnit || '').trim() || meta.defaultUnit,
    color: meta.color,
    isUtilityMatch: false,
  };
}

export function extractPlantFuelAllocations(
  gen: GenerationEntry,
  utilities: UtilityItem[],
  company?: Partial<CompanyItem> | null
): PlantFuelAllocation[] {
  const byTarget = new Map<string, PlantFuelAllocation>();

  const addLeg = (
    mode: SingleDeviceFuelMode,
    unit: string | undefined,
    qty: number,
    cost: number
  ) => {
    const cleanQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const cleanCost = Number.isFinite(cost) && cost > 0 ? cost : 0;
    if (cleanQty <= 0 && cleanCost <= 0) return;

    const target = resolveFuelTarget(mode, unit, utilities);
    const prev = byTarget.get(target.id);
    if (prev) {
      prev.consumption += cleanQty;
      prev.cost += cleanCost;
    } else {
      byTarget.set(target.id, {
        ...target,
        consumption: cleanQty,
        cost: cleanCost,
      });
    }
  };

  let parsedUnits: GenerationUnitReadings | null = null;
  if (gen.unitReadings) {
    try {
      const parsed = JSON.parse(gen.unitReadings);
      if (parsed && typeof parsed === 'object') {
        parsedUnits = parsed as GenerationUnitReadings;
      }
    } catch {
      parsedUnits = null;
    }
  }

  const companyDevices = parseCompanyDeviceConfigs(company?.deviceConfigs);

  // 1. Boilers
  if (parsedUnits?.boilerUnits && parsedUnits.boilerUnits.length > 0) {
    for (let i = 0; i < parsedUnits.boilerUnits.length; i++) {
      const bu = parsedUnits.boilerUnits[i];
      const cfg =
        companyDevices?.boilers.find((d) => bu.deviceId && d.id === bu.deviceId) ||
        companyDevices?.boilers[i];
      const mode: DeviceFuelMode =
        bu.fuelMode || cfg?.fuelMode || unitToFuelMode(bu.fuelUnit);

      if (mode === 'dual') {
        const pMode =
          bu.primaryFuelMode || cfg?.primaryFuelMode || unitToFuelMode(bu.fuelUnit);
        const sMode =
          bu.secondaryFuelMode ||
          cfg?.secondaryFuelMode ||
          unitToFuelMode(bu.secondaryFuelUnit);
        addLeg(pMode, bu.fuelUnit, Number(bu.fuelQty) || 0, Number(bu.fuelCost) || 0);
        addLeg(
          sMode,
          bu.secondaryFuelUnit,
          Number(bu.secondaryFuelQty) || 0,
          Number(bu.secondaryFuelCost) || 0
        );
      } else {
        addLeg(
          mode,
          bu.fuelUnit,
          Number(bu.fuelQty) || 0,
          getBoilerReadingTotalCost(bu)
        );
      }
    }
  } else if ((gen.boilerFuelQty || 0) > 0 || (gen.boilerFuelCost || 0) > 0) {
    const singleBoiler =
      companyDevices?.boilers.length === 1 ? companyDevices.boilers[0] : undefined;
    const bMode: SingleDeviceFuelMode =
      singleBoiler && singleBoiler.fuelMode !== 'dual'
        ? singleBoiler.fuelMode
        : unitToFuelMode(gen.boilerFuelUnit);
    addLeg(
      bMode,
      gen.boilerFuelUnit,
      Number(gen.boilerFuelQty) || 0,
      Number(gen.boilerFuelCost) || 0
    );
  }

  // 2. Generators
  if (parsedUnits?.generatorUnits && parsedUnits.generatorUnits.length > 0) {
    for (let i = 0; i < parsedUnits.generatorUnits.length; i++) {
      const gu = parsedUnits.generatorUnits[i];
      const cfg =
        companyDevices?.generators.find((d) => gu.deviceId && d.id === gu.deviceId) ||
        companyDevices?.generators[i];
      const mode: DeviceFuelMode =
        gu.fuelMode || cfg?.fuelMode || unitToFuelMode(gu.fuelUnit);

      if (mode === 'dual') {
        const pMode =
          gu.primaryFuelMode || cfg?.primaryFuelMode || unitToFuelMode(gu.fuelUnit);
        const sMode =
          gu.secondaryFuelMode ||
          cfg?.secondaryFuelMode ||
          unitToFuelMode(gu.secondaryFuelUnit);
        addLeg(pMode, gu.fuelUnit, Number(gu.fuelQty) || 0, Number(gu.fuelCost) || 0);
        addLeg(
          sMode,
          gu.secondaryFuelUnit,
          Number(gu.secondaryFuelQty) || 0,
          Number(gu.secondaryFuelCost) || 0
        );
      } else {
        addLeg(
          mode,
          gu.fuelUnit,
          Number(gu.fuelQty) || 0,
          getGenReadingTotalCost(gu)
        );
      }
    }
  } else if (
    (parsedUnits?.dieselGenUnits && parsedUnits.dieselGenUnits.length > 0) ||
    (parsedUnits?.gasGenUnits && parsedUnits.gasGenUnits.length > 0)
  ) {
    for (const du of parsedUnits.dieselGenUnits || []) {
      const mode = normalizeSingleFuelMode(du.fuelMode, du.fuelUnit || 'L');
      addLeg(mode, du.fuelUnit || 'L', Number(du.fuelQty) || 0, getGenReadingTotalCost(du));
    }
    for (const gu of parsedUnits.gasGenUnits || []) {
      const mode = normalizeSingleFuelMode(gu.fuelMode, gu.fuelUnit || 'm³');
      addLeg(mode, gu.fuelUnit || 'm³', Number(gu.fuelQty) || 0, getGenReadingTotalCost(gu));
    }
  } else {
    const dQty = Number(gen.dieselFuelQty) || 0;
    const dCost = Number(gen.dieselFuelCost) || 0;
    const gQty = Number(gen.gasFuelQty) || 0;
    const gCost = Number(gen.gasFuelCost) || 0;
    if (dQty > 0 || dCost > 0 || gQty > 0 || gCost > 0) {
      addLeg('diesel', 'L', dQty, dCost);
      addLeg('gas', 'm³', gQty, gCost);
    } else if ((gen.generatorFuelQty || 0) > 0 || (gen.generatorFuelCost || 0) > 0) {
      const gMode = unitToFuelMode(gen.generatorFuelUnit || 'L');
      addLeg(
        gMode,
        gen.generatorFuelUnit || defaultUnitForFuelMode(gMode),
        Number(gen.generatorFuelQty) || 0,
        Number(gen.generatorFuelCost) || 0
      );
    }
  }

  return Array.from(byTarget.values());
}

export function formatEquipmentSummary(c: CompanyItem): string {
  const resolved = resolveCompanyDeviceConfigs(c);
  const hasExplicit =
    Boolean(c.equipmentConfigured) ||
    Boolean(c.deviceConfigs) ||
    c.boilerCount !== undefined ||
    c.dieselGeneratorCount !== undefined ||
    c.gasGeneratorCount !== undefined ||
    c.solarCount !== undefined ||
    Boolean(c.gridHasPeakOffPeak) ||
    (c.gridProviders && c.gridProviders.length > 0);
  if (!hasExplicit) return 'Equipment not configured yet';

  const parts: string[] = [];
  if (c.gridProviders && c.gridProviders.length > 0) {
    parts.push(
      `Grid: ${c.gridProviders.join(', ')}${
        c.gridHasPeakOffPeak ? ' (Peak/Off-Peak)' : ''
      }`
    );
  } else if (c.gridHasPeakOffPeak) {
    parts.push('Grid: Peak/Off-Peak');
  }
  if (resolved.boilers.length > 0) {
    const names = resolved.boilers
      .slice(0, 2)
      .map(
        (b) =>
          `${b.name} (${b.fuelMode === 'dual' ? 'Dual' : getFuelLabel(b.fuelMode, b.fuelUnit)})`
      )
      .join(', ');
    parts.push(
      `Boilers (${resolved.boilers.length}): ${names}${
        resolved.boilers.length > 2 ? ', …' : ''
      }`
    );
  }
  if (resolved.generators.length > 0) {
    const names = resolved.generators
      .slice(0, 2)
      .map(
        (g) =>
          `${g.name} (${g.fuelMode === 'dual' ? 'Dual' : getFuelLabel(g.fuelMode, g.fuelUnit)})`
      )
      .join(', ');
    parts.push(
      `Generators (${resolved.generators.length}): ${names}${
        resolved.generators.length > 2 ? ', …' : ''
      }`
    );
  }
  if (resolved.solars.length > 0) {
    parts.push(`${resolved.solars.length} Solar`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Utilities only (0 generators/boilers)';
}

