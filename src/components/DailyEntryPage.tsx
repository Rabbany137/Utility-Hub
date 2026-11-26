import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Flame,
  Fuel,
  KeyRound,
  Lock,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { useApp } from '../context/AppContext';
import {
  OperationType,
  db,
  handleFirestoreError,
  hasGoogleProvider,
  hasPasswordProvider,
  reauthenticateCurrentUserWithGoogle,
  verifyCurrentUserPassword,
} from '../firebase';
import type {
  BoilerUnitReading,
  DeviceFuelMode,
  GenerationEntry,
  GenerationUnitReadings,
  GeneratorUnitReading,
  GridProviderReading,
  GridTariffPeriod,
  SingleDeviceFuelMode,
  SolarUnitReading,
  UtilityEntry,
} from '../types';
import {
  formatDeviceFuelBadge,
  getBoilerReadingTotalCost,
  getFuelLabel,
  getGenReadingTotalCost,
  isGasLikeFuelMode,
  normalizeSingleFuelMode,
  resolveCompanyDeviceConfigs,
} from '../utils/equipment';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  getTodayISO,
  sanitizeNumericInput,
  shiftDaysISO,
  toSafeFirestoreId,
} from '../utils/formatters';
import { CompanyEquipmentEditor } from './CompanyEquipmentEditor';
import { GoogleSheetsSyncModal } from './GoogleSheetsSyncModal';

interface RowDraft {
  unitCost: string;
  consumption: string;
  cost: string;
  note: string;
}

interface GridDraftRow {
  unitCost: string;
  kwh: string;
  cost: string;
}

interface GridSlot {
  key: string;
  provider: string;
  tariff: GridTariffPeriod;
  label: string;
  rateUtilityId: string;
}

interface BoilerUnitDraft {
  deviceId: string;
  deviceName: string;
  fuelMode: DeviceFuelMode;
  primaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelMode?: SingleDeviceFuelMode;
  steamKg: string;
  fuelQty: string;
  fuelUnit: string;
  fuelUnitCost: string;
  fuelCost: string;
  secondaryFuelQty: string;
  secondaryFuelUnit: string;
  secondaryFuelUnitCost: string;
  secondaryFuelCost: string;
}

interface GenUnitDraft {
  deviceId: string;
  deviceName: string;
  fuelMode: DeviceFuelMode;
  primaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelMode?: SingleDeviceFuelMode;
  kwh: string;
  fuelQty: string;
  fuelUnit: string;
  fuelUnitCost: string;
  fuelCost: string;
  secondaryFuelQty: string;
  secondaryFuelUnit: string;
  secondaryFuelUnitCost: string;
  secondaryFuelCost: string;
}

interface SolarUnitDraft {
  deviceId: string;
  deviceName: string;
  kwh: string;
  unitCost: string;
  savings: string;
}

interface UnifiedGenDraft {
  boilers: BoilerUnitDraft[];
  generators: GenUnitDraft[];
  solarUnits: SolarUnitDraft[];
  note: string;
}

const MONTH_FULL_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatMonthTitle(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = Number(m) - 1;
  const label = idx >= 0 && idx < 12 ? MONTH_FULL_NAMES[idx] : m;
  return `${label} ${y}`;
}

function getDaysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function formatCalcValue(num: number, maxDecimals = 2): string {
  if (!Number.isFinite(num)) return '';
  return String(Number(num.toFixed(maxDecimals)));
}

function parseUnitReadingsJson(raw?: string): GenerationUnitReadings {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as GenerationUnitReadings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseGridBreakdownJson(raw?: string): GridProviderReading[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function gridRateUtilityId(provider: string, tariff: GridTariffPeriod = 'flat'): string {
  if (tariff === 'flat') return toSafeFirestoreId('grid', provider);
  return toSafeFirestoreId('grid', `${provider}_${tariff}`);
}

function boilerRateUtilityId(index: number): string {
  return `fuel_boiler_${index + 1}`;
}

function boilerDeviceRateId(
  deviceId: string,
  fuelUnit: string,
  fuelMode?: SingleDeviceFuelMode
): string {
  return fuelMode
    ? toSafeFirestoreId('brate', `${deviceId}__${fuelMode}__${fuelUnit}`)
    : toSafeFirestoreId('brate', `${deviceId}__${fuelUnit}`);
}

function boilerSecondaryRateId(
  deviceId: string,
  fuelUnit: string,
  fuelMode?: SingleDeviceFuelMode
): string {
  return fuelMode
    ? toSafeFirestoreId('brate2', `${deviceId}__${fuelMode}__${fuelUnit}`)
    : toSafeFirestoreId('brate2', `${deviceId}__${fuelUnit}`);
}

function dieselRateUtilityId(index: number): string {
  return `fuel_diesel_${index + 1}`;
}

function gasRateUtilityId(index: number): string {
  return `fuel_gas_${index + 1}`;
}

function genDeviceRateId(
  deviceId: string,
  fuelUnit: string,
  fuelMode?: SingleDeviceFuelMode
): string {
  return fuelMode
    ? toSafeFirestoreId('grate', `${deviceId}__${fuelMode}__${fuelUnit}`)
    : toSafeFirestoreId('grate', `${deviceId}__${fuelUnit}`);
}

function genSecondaryRateId(
  deviceId: string,
  fuelUnit: string,
  fuelMode?: SingleDeviceFuelMode
): string {
  return fuelMode
    ? toSafeFirestoreId('grate2', `${deviceId}__${fuelMode}__${fuelUnit}`)
    : toSafeFirestoreId('grate2', `${deviceId}__${fuelUnit}`);
}

function solarDeviceRateId(deviceId: string): string {
  return toSafeFirestoreId('srate', deviceId);
}

const LEGACY_FUEL_RATE_IDS = {
  diesel: 'fuel_diesel',
  gas: 'fuel_gas',
  boiler: 'fuel_boiler',
} as const;

export function DailyEntryPage() {
  const {
    user,
    profile,
    companies,
    utilities,
    entries,
    generationEntries,
    userUnitRates,
    sheetsConfig,
    googleAccessToken,
    connectGoogleSheets,
    syncEntriesToConnectedSheet,
  } = useApp();

  const todayISO = getTodayISO();

  const allowedCompanies = useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'admin') {
      return companies.map((c) => c.name);
    }
    if (profile.role === 'entry') {
      const existingNames = new Set(companies.map((c) => c.name));
      return profile.companies.filter((name) => existingNames.has(name));
    }
    return [];
  }, [profile, companies]);

  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [showEquipEditor, setShowEquipEditor] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [gridDrafts, setGridDrafts] = useState<Record<string, GridDraftRow>>({});
  const [genDraft, setGenDraft] = useState<UnifiedGenDraft>({
    boilers: [],
    generators: [],
    solarUnits: [],
    note: '',
  });

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteGenId, setConfirmDeleteGenId] = useState<string | null>(null);
  const [genDeleting, setGenDeleting] = useState(false);
  const [logFactoryFilter, setLogFactoryFilter] = useState<string>('SELECTED');

  // Password-protected Unit Cost lock (applies across Grid, Generator Fuel, Boiler Fuel & Utilities)
  const [unitCostUnlocked, setUnitCostUnlocked] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const [dirtyUtilIds, setDirtyUtilIds] = useState<Set<string>>(() => new Set());
  const [gridDirty, setGridDirty] = useState(false);
  const [genDirty, setGenDirty] = useState(false);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [promptSyncAfterSave, setPromptSyncAfterSave] = useState(true);

  const selectedMonth = selectedDate.slice(0, 7);

  useEffect(() => {
    if (allowedCompanies.length === 0) {
      setSelectedCompany('');
      return;
    }
    if (!selectedCompany || !allowedCompanies.includes(selectedCompany)) {
      setSelectedCompany(allowedCompanies[0]);
    }
  }, [allowedCompanies, selectedCompany]);

  const selectedCompanyObj = useMemo(
    () => companies.find((c) => c.name === selectedCompany) || null,
    [companies, selectedCompany]
  );

  const existingGeneration = useMemo(() => {
    return (
      generationEntries.find(
        (g) => g.date === selectedDate && g.company === selectedCompany
      ) || null
    );
  }, [generationEntries, selectedDate, selectedCompany]);

  // Active plant equipment & tariff setup defined by Admin for the selected factory
  const plantSetup = useMemo(() => {
    const c = selectedCompanyObj;
    const explicitConfigured = Boolean(
      c &&
        (c.equipmentConfigured ||
          Boolean(c.deviceConfigs) ||
          c.boilerCount !== undefined ||
          c.dieselGeneratorCount !== undefined ||
          c.gasGeneratorCount !== undefined ||
          c.solarCount !== undefined ||
          c.gridHasPeakOffPeak !== undefined ||
          (c.gridProviders && c.gridProviders.length > 0))
    );

    const gridProviders = c?.gridProviders || [];
    const gridHasPeakOffPeak = Boolean(c?.gridHasPeakOffPeak);
    const resolved = resolveCompanyDeviceConfigs(c, existingGeneration);

    const boilerFuelUnit =
      resolved.boilers.length === 1
        ? resolved.boilers[0].fuelUnit
        : c?.boilerFuelUnit || existingGeneration?.boilerFuelUnit || 'm³';

    return {
      explicitConfigured,
      gridProviders,
      gridHasPeakOffPeak,
      boilers: resolved.boilers,
      generators: resolved.generators,
      solars: resolved.solars,
      boilerCount: resolved.boilers.length,
      boilerFuelUnit,
      dieselGeneratorCount: resolved.generators.filter(
        (g) => g.fuelMode === 'diesel' || g.fuelMode === 'dual'
      ).length,
      gasGeneratorCount: resolved.generators.filter((g) =>
        isGasLikeFuelMode(g.fuelMode)
      ).length,
      solarCount: resolved.solars.length,
    };
  }, [selectedCompanyObj, existingGeneration]);

  const electricityUtility = useMemo(() => {
    return (
      utilities.find(
        (u) =>
          u.id === 'electricity' ||
          u.name.toLowerCase().includes('electric') ||
          u.unit.toLowerCase() === 'kwh'
      ) || null
    );
  }, [utilities]);

  const userAllowedUtilitiesSet = useMemo(() => {
    if (!profile || profile.role === 'admin') return null;
    const list = profile.allowedUtilities || [];
    if (list.length === 0) return null;
    return new Set(list);
  }, [profile]);

  const isElectricityAllowed =
    !electricityUtility ||
    !userAllowedUtilitiesSet ||
    userAllowedUtilitiesSet.has(electricityUtility.id);

  // Build sequential Grid Electricity slots (Flat or Peak + Off-Peak per provider or main Grid)
  const gridSlots = useMemo<GridSlot[]>(() => {
    if (!isElectricityAllowed) return [];
    const providers = plantSetup.gridProviders;
    const isPeakSplit = plantSetup.gridHasPeakOffPeak;

    if (providers.length > 0) {
      const slots: GridSlot[] = [];
      for (const provider of providers) {
        if (isPeakSplit) {
          slots.push({
            key: `${provider}::peak`,
            provider,
            tariff: 'peak',
            label: `${provider} — Peak`,
            rateUtilityId: gridRateUtilityId(provider, 'peak'),
          });
          slots.push({
            key: `${provider}::offPeak`,
            provider,
            tariff: 'offPeak',
            label: `${provider} — Off-Peak`,
            rateUtilityId: gridRateUtilityId(provider, 'offPeak'),
          });
        } else {
          slots.push({
            key: `${provider}::flat`,
            provider,
            tariff: 'flat',
            label: `${provider} Grid`,
            rateUtilityId: gridRateUtilityId(provider, 'flat'),
          });
        }
      }
      return slots;
    }

    if (isPeakSplit) {
      return [
        {
          key: 'Grid::peak',
          provider: 'Grid',
          tariff: 'peak',
          label: 'Grid Electricity — Peak',
          rateUtilityId: gridRateUtilityId('main', 'peak'),
        },
        {
          key: 'Grid::offPeak',
          provider: 'Grid',
          tariff: 'offPeak',
          label: 'Grid Electricity — Off-Peak',
          rateUtilityId: gridRateUtilityId('main', 'offPeak'),
        },
      ];
    }

    return [];
  }, [isElectricityAllowed, plantSetup.gridProviders, plantSetup.gridHasPeakOffPeak]);

  const showGridSection = gridSlots.length > 0 && isElectricityAllowed;
  const showSingleElectricityTop =
    !showGridSection && Boolean(electricityUtility) && isElectricityAllowed;

  // All allowed utilities OTHER than Electricity (since Electricity appears first in Step 1)
  const otherUtilities = useMemo(() => {
    return utilities.filter((u) => {
      if (userAllowedUtilitiesSet && !userAllowedUtilitiesSet.has(u.id)) {
        return false;
      }
      if (electricityUtility && u.id === electricityUtility.id) {
        return false;
      }
      return true;
    });
  }, [utilities, userAllowedUtilitiesSet, electricityUtility]);

  // Utilities tracked as direct standard rows (excluding Electricity when handled by gridSlots)
  const formStandardUtilities = useMemo(() => {
    return utilities.filter((u) => {
      if (userAllowedUtilitiesSet && !userAllowedUtilitiesSet.has(u.id)) {
        return false;
      }
      if (showGridSection && electricityUtility && u.id === electricityUtility.id) {
        return false;
      }
      return true;
    });
  }, [utilities, userAllowedUtilitiesSet, showGridSection, electricityUtility]);

  const hasGenerators = plantSetup.generators.length > 0;
  const hasAnyEquipment =
    plantSetup.boilers.length > 0 || hasGenerators || plantSetup.solars.length > 0;

  const savedRateMap = useMemo(() => {
    const map = new Map<string, (typeof userUnitRates)[number]>();
    for (const rate of userUnitRates) {
      map.set(`${rate.company}|||${rate.utilityId}`, rate);
    }
    return map;
  }, [userUnitRates]);

  const existingMap = useMemo(() => {
    const map = new Map<string, UtilityEntry>();
    for (const item of entries) {
      if (item.date === selectedDate && item.company === selectedCompany) {
        map.set(item.utilityId, item);
      }
    }
    return map;
  }, [entries, selectedDate, selectedCompany]);

  const isEditingExisting = existingMap.size > 0 || existingGeneration !== null;

  const lastContextKeyRef = useRef<string>('');
  const lastEquipSignatureRef = useRef<string>('');

  const buildDraftRow = useCallback(
    (utilId: string): RowDraft => {
      const existing = existingMap.get(utilId);
      const savedRate = savedRateMap.get(`${selectedCompany}|||${utilId}`);

      if (existing) {
        const derivedRate =
          existing.consumption > 0
            ? formatCalcValue(existing.cost / existing.consumption, 4)
            : savedRate !== undefined
            ? formatCalcValue(savedRate.unitCost, 4)
            : '';
        return {
          unitCost: derivedRate,
          consumption: String(existing.consumption),
          cost: String(existing.cost),
          note: existing.note,
        };
      }

      return {
        unitCost: savedRate !== undefined ? formatCalcValue(savedRate.unitCost, 4) : '',
        consumption: '',
        cost: '',
        note: '',
      };
    },
    [existingMap, savedRateMap, selectedCompany]
  );

  const buildGridDrafts = useCallback((): Record<string, GridDraftRow> => {
    const savedGridRows = parseGridBreakdownJson(
      existingGeneration?.gridProviderBreakdown
    );
    const savedBySlotKey = new Map<string, GridProviderReading>();
    for (const r of savedGridRows) {
      const t: GridTariffPeriod = r.tariff || 'flat';
      savedBySlotKey.set(`${r.provider}::${t}`, r);
    }

    const fallbackElecRate = electricityUtility
      ? savedRateMap.get(`${selectedCompany}|||${electricityUtility.id}`)?.unitCost
      : undefined;

    const next: Record<string, GridDraftRow> = {};
    for (const slot of gridSlots) {
      const savedSlotRate = savedRateMap.get(
        `${selectedCompany}|||${slot.rateUtilityId}`
      );
      const legacyFlatRate =
        slot.tariff !== 'flat'
          ? savedRateMap.get(
              `${selectedCompany}|||${gridRateUtilityId(slot.provider, 'flat')}`
            )
          : undefined;

      const existingRow =
        savedBySlotKey.get(slot.key) ||
        (slot.tariff === 'flat'
          ? savedBySlotKey.get(`${slot.provider}::flat`)
          : undefined);

      const defaultRateStr =
        existingRow && existingRow.unitCost > 0
          ? formatCalcValue(existingRow.unitCost, 4)
          : existingRow && existingRow.kwh > 0
          ? formatCalcValue(existingRow.cost / existingRow.kwh, 4)
          : savedSlotRate !== undefined
          ? formatCalcValue(savedSlotRate.unitCost, 4)
          : legacyFlatRate !== undefined
          ? formatCalcValue(legacyFlatRate.unitCost, 4)
          : fallbackElecRate !== undefined
          ? formatCalcValue(fallbackElecRate, 4)
          : '';

      if (existingRow) {
        next[slot.key] = {
          unitCost: defaultRateStr,
          kwh: existingRow.kwh > 0 ? String(existingRow.kwh) : '',
          cost: existingRow.cost > 0 ? String(existingRow.cost) : '',
        };
      } else if (
        gridSlots.length === 1 &&
        electricityUtility &&
        existingMap.has(electricityUtility.id)
      ) {
        const elec = existingMap.get(electricityUtility.id)!;
        const rateStr =
          elec.consumption > 0
            ? formatCalcValue(elec.cost / elec.consumption, 4)
            : defaultRateStr;
        next[slot.key] = {
          unitCost: rateStr,
          kwh: elec.consumption > 0 ? String(elec.consumption) : '',
          cost: elec.cost > 0 ? String(elec.cost) : '',
        };
      } else {
        next[slot.key] = {
          unitCost: defaultRateStr,
          kwh: '',
          cost: '',
        };
      }
    }
    return next;
  }, [
    gridSlots,
    existingGeneration,
    savedRateMap,
    selectedCompany,
    electricityUtility,
    existingMap,
  ]);

  const buildGenerationDraft = useCallback((): UnifiedGenDraft => {
    const parsedUnits = parseUnitReadingsJson(existingGeneration?.unitReadings);

    const legacyBoilerRate = savedRateMap.get(
      `${selectedCompany}|||${LEGACY_FUEL_RATE_IDS.boiler}`
    );
    const legacyDieselRate = savedRateMap.get(
      `${selectedCompany}|||${LEGACY_FUEL_RATE_IDS.diesel}`
    );
    const legacyGasRate = savedRateMap.get(
      `${selectedCompany}|||${LEGACY_FUEL_RATE_IDS.gas}`
    );

    // 1. Named Boilers (Single or Dual-Fuel, Admin-locked fuel types & units)
    const boilerUnitDetails = Array.isArray(parsedUnits.boilerUnits)
      ? parsedUnits.boilerUnits
      : [];
    const boilers: BoilerUnitDraft[] = plantSetup.boilers.map((device, idx) => {
      const detail =
        boilerUnitDetails.find((u) => u.deviceId && u.deviceId === device.id) ||
        boilerUnitDetails[idx];
      const fUnit = device.fuelUnit;
      const sUnit = device.secondaryFuelUnit || 'L';
      const pMode: SingleDeviceFuelMode =
        device.fuelMode === 'dual'
          ? normalizeSingleFuelMode(device.primaryFuelMode, fUnit)
          : device.fuelMode;
      const sMode: SingleDeviceFuelMode =
        device.fuelMode === 'dual'
          ? normalizeSingleFuelMode(device.secondaryFuelMode, sUnit)
          : 'diesel';

      const perUnitRate =
        savedRateMap.get(
          `${selectedCompany}|||${boilerDeviceRateId(device.id, fUnit, pMode)}`
        ) ||
        savedRateMap.get(
          `${selectedCompany}|||${boilerDeviceRateId(device.id, fUnit)}`
        ) ||
        savedRateMap.get(`${selectedCompany}|||${boilerRateUtilityId(idx)}`);
      const legacySteam = parsedUnits.boilers?.[idx];

      let steamVal = detail?.steamKg ?? legacySteam ?? 0;
      let fQty = detail?.fuelQty ?? 0;
      let fCost = detail?.fuelCost ?? 0;

      // Backward compatibility for single-pool boiler logs
      if (
        !detail &&
        boilerUnitDetails.length === 0 &&
        idx === 0 &&
        existingGeneration
      ) {
        if (
          steamVal === 0 &&
          existingGeneration.steamKg > 0 &&
          !parsedUnits.boilers?.length
        ) {
          steamVal = existingGeneration.steamKg;
        }
        if (existingGeneration.boilerFuelQty > 0) {
          fQty = existingGeneration.boilerFuelQty;
        }
        if (existingGeneration.boilerFuelCost > 0) {
          fCost = existingGeneration.boilerFuelCost;
        }
      }

      const detailPrimaryMode =
        detail?.fuelMode === 'dual'
          ? normalizeSingleFuelMode(detail.primaryFuelMode, detail.fuelUnit || fUnit)
          : detail?.fuelMode;
      const matchingSavedUnit =
        !detail ||
        ((!detail.fuelUnit || detail.fuelUnit === fUnit) &&
          (!detailPrimaryMode || detailPrimaryMode === pMode));
      const rateStr =
        matchingSavedUnit && detail && detail.fuelUnitCost > 0
          ? formatCalcValue(detail.fuelUnitCost, 4)
          : matchingSavedUnit && fQty > 0 && fCost > 0
          ? formatCalcValue(fCost / fQty, 4)
          : perUnitRate !== undefined
          ? formatCalcValue(perUnitRate.unitCost, 4)
          : pMode === 'gas' && legacyBoilerRate !== undefined
          ? formatCalcValue(legacyBoilerRate.unitCost, 4)
          : '';

      const sQty = detail?.secondaryFuelQty ?? 0;
      const sCost = detail?.secondaryFuelCost ?? 0;
      const savedSecRate =
        savedRateMap.get(
          `${selectedCompany}|||${boilerSecondaryRateId(device.id, sUnit, sMode)}`
        ) ||
        savedRateMap.get(
          `${selectedCompany}|||${boilerSecondaryRateId(device.id, sUnit)}`
        );
      const secRateStr =
        detail && (detail.secondaryFuelUnitCost ?? 0) > 0
          ? formatCalcValue(detail.secondaryFuelUnitCost ?? 0, 4)
          : sQty > 0 && sCost > 0
          ? formatCalcValue(sCost / sQty, 4)
          : savedSecRate !== undefined
          ? formatCalcValue(savedSecRate.unitCost, 4)
          : '';

      return {
        deviceId: device.id,
        deviceName: device.name,
        fuelMode: device.fuelMode,
        ...(device.fuelMode === 'dual'
          ? { primaryFuelMode: pMode, secondaryFuelMode: sMode }
          : {}),
        steamKg: steamVal > 0 ? String(steamVal) : '',
        fuelQty: fQty > 0 ? String(fQty) : '',
        fuelUnit: fUnit,
        fuelUnitCost: rateStr,
        fuelCost: fCost > 0 ? String(fCost) : '',
        secondaryFuelQty: sQty > 0 ? String(sQty) : '',
        secondaryFuelUnit: sUnit,
        secondaryFuelUnitCost: secRateStr,
        secondaryFuelCost: sCost > 0 ? String(sCost) : '',
      };
    });

    // 2. Unified Named Generators (Diesel, Natural Gas, CNG, or Dual-Fuel)
    const unifiedGenDetails = Array.isArray(parsedUnits.generatorUnits)
      ? parsedUnits.generatorUnits
      : [];
    const legacyDieselDetails = Array.isArray(parsedUnits.dieselGenUnits)
      ? parsedUnits.dieselGenUnits
      : [];
    const legacyGasDetails = Array.isArray(parsedUnits.gasGenUnits)
      ? parsedUnits.gasGenUnits
      : [];

    let dieselCursor = 0;
    let gasCursor = 0;

    const generators: GenUnitDraft[] = plantSetup.generators.map((device, idx) => {
      const fUnit = device.fuelUnit;
      const sUnit = device.secondaryFuelUnit || 'L';
      const pMode: SingleDeviceFuelMode =
        device.fuelMode === 'dual'
          ? normalizeSingleFuelMode(device.primaryFuelMode, fUnit)
          : device.fuelMode;
      const sMode: SingleDeviceFuelMode =
        device.fuelMode === 'dual'
          ? normalizeSingleFuelMode(device.secondaryFuelMode, sUnit)
          : 'diesel';
      const isGasLike = isGasLikeFuelMode(device.fuelMode);

      let detail: GeneratorUnitReading | undefined = unifiedGenDetails.find(
        (u) => u.deviceId && u.deviceId === device.id
      );

      let legacyIdx = idx;
      if (!detail && unifiedGenDetails[idx]) {
        detail = unifiedGenDetails[idx];
      }

      if (!detail) {
        if (isGasLike) {
          detail = legacyGasDetails[gasCursor];
          legacyIdx = gasCursor;
          gasCursor += 1;
        } else {
          detail = legacyDieselDetails[dieselCursor];
          legacyIdx = dieselCursor;
          dieselCursor += 1;
        }
      } else if (isGasLike) {
        legacyIdx = gasCursor;
        gasCursor += 1;
      } else {
        legacyIdx = dieselCursor;
        dieselCursor += 1;
      }

      const legacyKwh = isGasLike
        ? parsedUnits.gasGens?.[legacyIdx]
        : parsedUnits.dieselGens?.[legacyIdx];

      let kwhVal = detail?.kwh ?? legacyKwh ?? 0;
      let fQty = detail?.fuelQty ?? 0;
      let fCost = detail?.fuelCost ?? 0;

      if (
        !detail &&
        unifiedGenDetails.length === 0 &&
        legacyDieselDetails.length === 0 &&
        legacyGasDetails.length === 0 &&
        existingGeneration
      ) {
        if (!isGasLike && legacyIdx === 0) {
          const fallbackKwh =
            existingGeneration.dieselGenKwh !== undefined
              ? existingGeneration.dieselGenKwh
              : plantSetup.gasGeneratorCount === 0
              ? existingGeneration.generatorKwh
              : 0;
          if (kwhVal === 0 && fallbackKwh > 0) kwhVal = fallbackKwh;
          const fallbackQty =
            (existingGeneration.dieselFuelQty ?? 0) > 0
              ? existingGeneration.dieselFuelQty ?? 0
              : plantSetup.gasGeneratorCount === 0
              ? existingGeneration.generatorFuelQty
              : 0;
          const fallbackCost =
            (existingGeneration.dieselFuelCost ?? 0) > 0
              ? existingGeneration.dieselFuelCost ?? 0
              : plantSetup.gasGeneratorCount === 0
              ? existingGeneration.generatorFuelCost
              : 0;
          if (fallbackQty > 0) fQty = fallbackQty;
          if (fallbackCost > 0) fCost = fallbackCost;
        } else if (isGasLike && legacyIdx === 0) {
          if (kwhVal === 0 && (existingGeneration.gasGenKwh ?? 0) > 0) {
            kwhVal = existingGeneration.gasGenKwh ?? 0;
          }
          if ((existingGeneration.gasFuelQty ?? 0) > 0) {
            fQty = existingGeneration.gasFuelQty ?? 0;
          }
          if ((existingGeneration.gasFuelCost ?? 0) > 0) {
            fCost = existingGeneration.gasFuelCost ?? 0;
          }
        }
      }

      const savedDeviceRate =
        savedRateMap.get(
          `${selectedCompany}|||${genDeviceRateId(device.id, fUnit, pMode)}`
        ) ||
        savedRateMap.get(
          `${selectedCompany}|||${genDeviceRateId(device.id, fUnit)}`
        );
      const savedGroupRate =
        device.fuelMode === 'gas'
          ? savedRateMap.get(
              `${selectedCompany}|||${gasRateUtilityId(legacyIdx)}`
            ) || legacyGasRate
          : device.fuelMode === 'diesel'
          ? savedRateMap.get(
              `${selectedCompany}|||${dieselRateUtilityId(legacyIdx)}`
            ) || legacyDieselRate
          : undefined;

      const detailPrimaryMode =
        detail?.fuelMode === 'dual'
          ? normalizeSingleFuelMode(detail.primaryFuelMode, detail.fuelUnit || fUnit)
          : detail?.fuelMode;
      const matchingSavedUnit =
        !detail ||
        ((!detail.fuelUnit || detail.fuelUnit === fUnit) &&
          (!detailPrimaryMode || detailPrimaryMode === pMode));
      const rateStr =
        matchingSavedUnit && detail && detail.fuelUnitCost > 0
          ? formatCalcValue(detail.fuelUnitCost, 4)
          : matchingSavedUnit && fQty > 0 && fCost > 0
          ? formatCalcValue(fCost / fQty, 4)
          : savedDeviceRate !== undefined
          ? formatCalcValue(savedDeviceRate.unitCost, 4)
          : savedGroupRate !== undefined
          ? formatCalcValue(savedGroupRate.unitCost, 4)
          : '';

      const sQty = detail?.secondaryFuelQty ?? 0;
      const sCost = detail?.secondaryFuelCost ?? 0;
      const savedSecRate =
        savedRateMap.get(
          `${selectedCompany}|||${genSecondaryRateId(device.id, sUnit, sMode)}`
        ) ||
        savedRateMap.get(
          `${selectedCompany}|||${genSecondaryRateId(device.id, sUnit)}`
        );
      const secRateStr =
        detail && (detail.secondaryFuelUnitCost ?? 0) > 0
          ? formatCalcValue(detail.secondaryFuelUnitCost ?? 0, 4)
          : sQty > 0 && sCost > 0
          ? formatCalcValue(sCost / sQty, 4)
          : savedSecRate !== undefined
          ? formatCalcValue(savedSecRate.unitCost, 4)
          : '';

      return {
        deviceId: device.id,
        deviceName: device.name,
        fuelMode: device.fuelMode,
        ...(device.fuelMode === 'dual'
          ? { primaryFuelMode: pMode, secondaryFuelMode: sMode }
          : {}),
        kwh: kwhVal > 0 ? String(kwhVal) : '',
        fuelQty: fQty > 0 ? String(fQty) : '',
        fuelUnit: fUnit,
        fuelUnitCost: rateStr,
        fuelCost: fCost > 0 ? String(fCost) : '',
        secondaryFuelQty: sQty > 0 ? String(sQty) : '',
        secondaryFuelUnit: sUnit,
        secondaryFuelUnitCost: secRateStr,
        secondaryFuelCost: sCost > 0 ? String(sCost) : '',
      };
    });

    // 3. Named Solar Systems (With Editable Tariff Rate + Additive Savings)
    const solarDetails = Array.isArray(parsedUnits.solarUnitDetails)
      ? parsedUnits.solarUnitDetails
      : [];
    const totalLegacySolarKwh = existingGeneration?.solarKwh || 0;
    const totalLegacySavings = existingGeneration?.solarSavings || 0;

    const solarUnits: SolarUnitDraft[] = plantSetup.solars.map((device, idx) => {
      const detail =
        solarDetails.find((u) => u.deviceId && u.deviceId === device.id) ||
        solarDetails[idx];
      const legacyArrKwh = parsedUnits.solarUnits?.[idx];
      let kwhVal = detail?.kwh ?? legacyArrKwh ?? 0;
      let savVal = detail?.savings ?? 0;

      if (!detail && solarDetails.length === 0 && existingGeneration) {
        if (
          idx === 0 &&
          kwhVal === 0 &&
          totalLegacySolarKwh > 0 &&
          !parsedUnits.solarUnits?.length
        ) {
          kwhVal = totalLegacySolarKwh;
        }
        if (totalLegacySavings > 0 && kwhVal > 0 && totalLegacySolarKwh > 0) {
          savVal = Number(
            ((kwhVal / totalLegacySolarKwh) * totalLegacySavings).toFixed(2)
          );
        } else if (
          idx === 0 &&
          totalLegacySavings > 0 &&
          plantSetup.solars.length === 1
        ) {
          savVal = totalLegacySavings;
        }
      }

      const savedSolarRate = savedRateMap.get(
        `${selectedCompany}|||${solarDeviceRateId(device.id)}`
      );
      const solarRateStr =
        detail && (detail.unitCost ?? 0) > 0
          ? formatCalcValue(detail.unitCost ?? 0, 4)
          : kwhVal > 0 && savVal > 0
          ? formatCalcValue(savVal / kwhVal, 4)
          : savedSolarRate !== undefined
          ? formatCalcValue(savedSolarRate.unitCost, 4)
          : '';

      return {
        deviceId: device.id,
        deviceName: device.name,
        kwh: kwhVal > 0 ? String(kwhVal) : '',
        unitCost: solarRateStr,
        savings: savVal > 0 ? String(savVal) : '',
      };
    });

    return {
      boilers,
      generators,
      solarUnits,
      note: existingGeneration?.note || '',
    };
  }, [existingGeneration, plantSetup, savedRateMap, selectedCompany]);

  useEffect(() => {
    const contextKey = `${selectedDate}|||${selectedCompany}`;
    const equipSig = [
      plantSetup.boilers
        .map(
          (b) =>
            `${b.id}:${b.name}:${b.fuelMode}:${b.primaryFuelMode || ''}:${b.fuelUnit}:${b.secondaryFuelMode || ''}:${b.secondaryFuelUnit || ''}`
        )
        .join('|'),
      plantSetup.generators
        .map(
          (g) =>
            `${g.id}:${g.name}:${g.fuelMode}:${g.primaryFuelMode || ''}:${g.fuelUnit}:${g.secondaryFuelMode || ''}:${g.secondaryFuelUnit || ''}`
        )
        .join('|'),
      plantSetup.solars.map((s) => `${s.id}:${s.name}`).join('|'),
      String(plantSetup.gridHasPeakOffPeak),
      plantSetup.gridProviders.join(','),
    ].join('::');

    const isContextSwitch = lastContextKeyRef.current !== contextKey;
    const isEquipSwitch = lastEquipSignatureRef.current !== equipSig;

    if (isContextSwitch) {
      lastContextKeyRef.current = contextKey;
      lastEquipSignatureRef.current = equipSig;
      setDirtyUtilIds(new Set());
      setGridDirty(false);
      setGenDirty(false);
      setUnitCostUnlocked(false);

      const next: Record<string, RowDraft> = {};
      for (const util of utilities) {
        next[util.id] = buildDraftRow(util.id);
      }
      setDrafts(next);
      setGridDrafts(buildGridDrafts());
      setGenDraft(buildGenerationDraft());
      return;
    }

    if (isEquipSwitch) {
      lastEquipSignatureRef.current = equipSig;
      if (!gridDirty) setGridDrafts(buildGridDrafts());
      if (!genDirty) setGenDraft(buildGenerationDraft());
    }

    setDrafts((prev) => {
      const next: Record<string, RowDraft> = {};
      for (const util of utilities) {
        if (dirtyUtilIds.has(util.id) && prev[util.id]) {
          next[util.id] = prev[util.id];
        } else {
          next[util.id] = buildDraftRow(util.id);
        }
      }
      return next;
    });

    if (!gridDirty) setGridDrafts(buildGridDrafts());
    if (!genDirty) setGenDraft(buildGenerationDraft());
  }, [
    utilities,
    selectedDate,
    selectedCompany,
    plantSetup,
    buildDraftRow,
    buildGridDrafts,
    buildGenerationDraft,
    dirtyUtilIds,
    gridDirty,
    genDirty,
  ]);

  // Live combined Grid & Electricity rate (Weighted Peak + Off-Peak + Providers)
  const gridTotals = useMemo(() => {
    let totalKwh = 0;
    let totalCost = 0;
    let peakKwh = 0;
    let peakCost = 0;
    let offPeakKwh = 0;
    let offPeakCost = 0;

    for (const slot of gridSlots) {
      const row = gridDrafts[slot.key];
      if (!row) continue;
      const k = Number(row.kwh) || 0;
      const c = Number(row.cost) || 0;
      if (k > 0) totalKwh += k;
      if (c > 0) totalCost += c;
      if (slot.tariff === 'peak') {
        if (k > 0) peakKwh += k;
        if (c > 0) peakCost += c;
      } else if (slot.tariff === 'offPeak') {
        if (k > 0) offPeakKwh += k;
        if (c > 0) offPeakCost += c;
      }
    }
    return { totalKwh, totalCost, peakKwh, peakCost, offPeakKwh, offPeakCost };
  }, [gridSlots, gridDrafts]);

  const activeElectricityRate = useMemo(() => {
    if (showGridSection) {
      if (gridTotals.totalKwh > 0 && gridTotals.totalCost > 0) {
        return gridTotals.totalCost / gridTotals.totalKwh;
      }
      // Prefer Peak / Flat saved rate as daytime solar savings reference
      for (const slot of gridSlots) {
        if (slot.tariff === 'peak' || slot.tariff === 'flat') {
          const rate = Number(gridDrafts[slot.key]?.unitCost || 0);
          if (Number.isFinite(rate) && rate > 0) return rate;
        }
      }
      for (const slot of gridSlots) {
        const rate = Number(gridDrafts[slot.key]?.unitCost || 0);
        if (Number.isFinite(rate) && rate > 0) return rate;
      }
    }
    if (!electricityUtility) return 0;
    const draftRate = Number(drafts[electricityUtility.id]?.unitCost || 0);
    if (Number.isFinite(draftRate) && draftRate > 0) return draftRate;
    const saved = savedRateMap.get(`${selectedCompany}|||${electricityUtility.id}`);
    return saved && saved.unitCost > 0 ? saved.unitCost : 0;
  }, [
    showGridSection,
    gridTotals,
    gridSlots,
    gridDrafts,
    electricityUtility,
    drafts,
    savedRateMap,
    selectedCompany,
  ]);

  const activeGridKwh = useMemo(() => {
    if (showGridSection) return gridTotals.totalKwh;
    if (!electricityUtility) return 0;
    const val = Number(drafts[electricityUtility.id]?.consumption || 0);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [showGridSection, gridTotals.totalKwh, electricityUtility, drafts]);

  const genLiveMetrics = useMemo(() => {
    let combinedSteamKg = 0;
    let combinedBoilerFuelQty = 0;
    let combinedBoilerFuelCost = 0;
    const boilerFuelBreakdown = new Map<string, number>();

    for (const b of genDraft.boilers) {
      const s = Number(b.steamKg) || 0;
      const q = Number(b.fuelQty) || 0;
      const c = Number(b.fuelCost) || 0;
      const sq = b.fuelMode === 'dual' ? Number(b.secondaryFuelQty) || 0 : 0;
      const sc = b.fuelMode === 'dual' ? Number(b.secondaryFuelCost) || 0 : 0;

      if (s > 0) combinedSteamKg += s;
      if (q > 0) {
        combinedBoilerFuelQty += q;
        boilerFuelBreakdown.set(
          b.fuelUnit,
          (boilerFuelBreakdown.get(b.fuelUnit) || 0) + q
        );
      }
      if (sq > 0) {
        boilerFuelBreakdown.set(
          b.secondaryFuelUnit,
          (boilerFuelBreakdown.get(b.secondaryFuelUnit) || 0) + sq
        );
      }
      if (c > 0) combinedBoilerFuelCost += c;
      if (sc > 0) combinedBoilerFuelCost += sc;
    }

    let dieselKwh = 0;
    let dieselFuelQty = 0;
    let dieselFuelCost = 0;
    let gasKwh = 0;
    let gasFuelQty = 0;
    let gasFuelCost = 0;
    let combinedGenKwh = 0;
    let combinedGenFuelCost = 0;

    for (const g of genDraft.generators) {
      const k = Number(g.kwh) || 0;
      const q = Number(g.fuelQty) || 0;
      const c = Number(g.fuelCost) || 0;
      const sq = g.fuelMode === 'dual' ? Number(g.secondaryFuelQty) || 0 : 0;
      const sc = g.fuelMode === 'dual' ? Number(g.secondaryFuelCost) || 0 : 0;

      if (k > 0) combinedGenKwh += k;
      if (c > 0) combinedGenFuelCost += c;
      if (sc > 0) combinedGenFuelCost += sc;

      if (g.fuelMode === 'dual') {
        const pMode = normalizeSingleFuelMode(g.primaryFuelMode, g.fuelUnit);
        if (isGasLikeFuelMode(pMode)) {
          if (k > 0) gasKwh += k;
          if (q > 0) gasFuelQty += q;
          if (c > 0) gasFuelCost += c;
          if (sq > 0) dieselFuelQty += sq;
          if (sc > 0) dieselFuelCost += sc;
        } else {
          if (k > 0) dieselKwh += k;
          if (q > 0) dieselFuelQty += q;
          if (c > 0) dieselFuelCost += c;
          if (sq > 0) gasFuelQty += sq;
          if (sc > 0) gasFuelCost += sc;
        }
      } else if (isGasLikeFuelMode(g.fuelMode)) {
        if (k > 0) gasKwh += k;
        if (q > 0) gasFuelQty += q;
        if (c > 0) gasFuelCost += c;
      } else {
        if (k > 0) dieselKwh += k;
        if (q > 0) dieselFuelQty += q;
        if (c > 0) dieselFuelCost += c;
      }
    }

    let combinedSolarKwh = 0;
    let combinedSolarSavings = 0;
    for (const s of genDraft.solarUnits) {
      const k = Number(s.kwh) || 0;
      const sav = Number(s.savings) || 0;
      if (k > 0) combinedSolarKwh += k;
      if (sav > 0) combinedSolarSavings += sav;
    }

    const totalPlantPower = activeGridKwh + combinedGenKwh + combinedSolarKwh;
    const solarSharePct =
      totalPlantPower > 0 ? (combinedSolarKwh / totalPlantPower) * 100 : 0;

    return {
      combinedSteamKg,
      combinedBoilerFuelQty,
      combinedBoilerFuelCost,
      boilerFuelBreakdown: Array.from(boilerFuelBreakdown.entries()),
      costPerKgSteam:
        combinedSteamKg > 0 && combinedBoilerFuelCost > 0
          ? combinedBoilerFuelCost / combinedSteamKg
          : null,
      steamPerFuel:
        combinedBoilerFuelQty > 0 && combinedSteamKg > 0
          ? combinedSteamKg / combinedBoilerFuelQty
          : null,

      dieselKwh,
      dieselFuelQty,
      dieselFuelCost,
      dieselCostPerKwh:
        dieselKwh > 0 && dieselFuelCost > 0 ? dieselFuelCost / dieselKwh : null,

      gasKwh,
      gasFuelQty,
      gasFuelCost,
      gasCostPerKwh:
        gasKwh > 0 && gasFuelCost > 0 ? gasFuelCost / gasKwh : null,

      combinedGenKwh,
      combinedGenFuelCost,
      combinedGenCostPerKwh:
        combinedGenKwh > 0 && combinedGenFuelCost > 0
          ? combinedGenFuelCost / combinedGenKwh
          : null,

      combinedSolarKwh,
      combinedSolarSavings,
      totalPlantPower,
      solarSharePct,
    };
  }, [genDraft, activeGridKwh]);

  const utilityDraftCost = useMemo(() => {
    let sum = showGridSection ? gridTotals.totalCost : 0;
    for (const util of formStandardUtilities) {
      const val = Number(drafts[util.id]?.cost || 0);
      if (Number.isFinite(val) && val > 0) sum += val;
    }
    return sum;
  }, [showGridSection, gridTotals.totalCost, formStandardUtilities, drafts]);

  const totalDraftCost = useMemo(() => {
    return (
      utilityDraftCost +
      genLiveMetrics.combinedBoilerFuelCost +
      genLiveMetrics.combinedGenFuelCost
    );
  }, [
    utilityDraftCost,
    genLiveMetrics.combinedBoilerFuelCost,
    genLiveMetrics.combinedGenFuelCost,
  ]);

  const hasUnsavedChanges = dirtyUtilIds.size > 0 || gridDirty || genDirty;

  const previousLoggedDay = useMemo(() => {
    if (!selectedCompany || !selectedDate) return null;
    let latestDate: string | null = null;
    for (const entry of entries) {
      if (entry.company === selectedCompany && entry.date < selectedDate) {
        if (!latestDate || entry.date > latestDate) {
          latestDate = entry.date;
        }
      }
    }
    return latestDate;
  }, [entries, selectedCompany, selectedDate]);

  const handleFieldChange = (
    utilityId: string,
    field: keyof RowDraft,
    value: string
  ) => {
    if (!unitCostUnlocked && (field === 'unitCost' || field === 'cost')) {
      return;
    }
    const cleanVal = field === 'note' ? value : sanitizeNumericInput(value);
    setFeedback(null);
    setDirtyUtilIds((prev) => {
      if (prev.has(utilityId)) return prev;
      const next = new Set(prev);
      next.add(utilityId);
      return next;
    });
    setDrafts((prev) => {
      const current = prev[utilityId] || {
        unitCost: '',
        consumption: '',
        cost: '',
        note: '',
      };
      const nextRow: RowDraft = { ...current, [field]: cleanVal };

      if (field === 'unitCost') {
        const rate = Number(cleanVal);
        const cons = Number(current.consumption);
        if (
          cleanVal.trim() !== '' &&
          current.consumption.trim() !== '' &&
          Number.isFinite(rate) &&
          rate >= 0 &&
          Number.isFinite(cons) &&
          cons >= 0
        ) {
          nextRow.cost = formatCalcValue(cons * rate, 2);
        }
      } else if (field === 'consumption') {
        const cons = Number(cleanVal);
        const rate = Number(current.unitCost);
        if (cleanVal.trim() === '') {
          nextRow.cost = '';
        } else if (
          current.unitCost.trim() !== '' &&
          Number.isFinite(cons) &&
          cons >= 0 &&
          Number.isFinite(rate) &&
          rate >= 0
        ) {
          nextRow.cost = formatCalcValue(cons * rate, 2);
        }
      } else if (field === 'cost') {
        const costVal = Number(cleanVal);
        const cons = Number(current.consumption);
        if (
          cleanVal.trim() !== '' &&
          current.consumption.trim() !== '' &&
          Number.isFinite(costVal) &&
          costVal >= 0 &&
          Number.isFinite(cons) &&
          cons > 0
        ) {
          nextRow.unitCost = formatCalcValue(costVal / cons, 4);
        }
      }

      return { ...prev, [utilityId]: nextRow };
    });
  };

  const handleGridFieldChange = (
    slotKey: string,
    field: keyof GridDraftRow,
    value: string
  ) => {
    if (!unitCostUnlocked && (field === 'unitCost' || field === 'cost')) {
      return;
    }
    const cleanVal = sanitizeNumericInput(value);
    setFeedback(null);
    setGridDirty(true);
    setGridDrafts((prev) => {
      const current = prev[slotKey] || { unitCost: '', kwh: '', cost: '' };
      const nextRow: GridDraftRow = { ...current, [field]: cleanVal };

      if (field === 'unitCost') {
        const rate = Number(cleanVal);
        const kwh = Number(current.kwh);
        if (
          cleanVal.trim() !== '' &&
          current.kwh.trim() !== '' &&
          Number.isFinite(rate) &&
          rate >= 0 &&
          Number.isFinite(kwh) &&
          kwh >= 0
        ) {
          nextRow.cost = formatCalcValue(kwh * rate, 2);
        }
      } else if (field === 'kwh') {
        const kwh = Number(cleanVal);
        const rate = Number(current.unitCost);
        if (cleanVal.trim() === '') {
          nextRow.cost = '';
        } else if (
          current.unitCost.trim() !== '' &&
          Number.isFinite(kwh) &&
          kwh >= 0 &&
          Number.isFinite(rate) &&
          rate >= 0
        ) {
          nextRow.cost = formatCalcValue(kwh * rate, 2);
        }
      } else if (field === 'cost') {
        const costVal = Number(cleanVal);
        const kwh = Number(current.kwh);
        if (
          cleanVal.trim() !== '' &&
          current.kwh.trim() !== '' &&
          Number.isFinite(costVal) &&
          costVal >= 0 &&
          Number.isFinite(kwh) &&
          kwh > 0
        ) {
          nextRow.unitCost = formatCalcValue(costVal / kwh, 4);
        }
      }

      return { ...prev, [slotKey]: nextRow };
    });
  };

  const handleGenUnitChange = (
    index: number,
    field:
      | 'kwh'
      | 'fuelQty'
      | 'fuelUnitCost'
      | 'fuelCost'
      | 'secondaryFuelQty'
      | 'secondaryFuelUnitCost'
      | 'secondaryFuelCost',
    value: string
  ) => {
    if (
      !unitCostUnlocked &&
      (field === 'fuelUnitCost' ||
        field === 'fuelCost' ||
        field === 'secondaryFuelUnitCost' ||
        field === 'secondaryFuelCost')
    ) {
      return;
    }
    const cleanVal = sanitizeNumericInput(value);
    setFeedback(null);
    setGenDirty(true);
    setGenDraft((prev) => {
      const list = [...prev.generators];
      const cur = list[index];
      if (!cur) return prev;
      const nextUnit: GenUnitDraft = { ...cur, [field]: cleanVal };

      if (field === 'fuelUnitCost') {
        const r = Number(cleanVal);
        const q = Number(cur.fuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.fuelQty.trim() !== '' &&
          Number.isFinite(r) &&
          r >= 0 &&
          Number.isFinite(q) &&
          q >= 0
        ) {
          nextUnit.fuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'fuelQty') {
        const q = Number(cleanVal);
        const r = Number(cur.fuelUnitCost);
        if (cleanVal.trim() === '') {
          nextUnit.fuelCost = '';
        } else if (
          cur.fuelUnitCost.trim() !== '' &&
          Number.isFinite(q) &&
          q >= 0 &&
          Number.isFinite(r) &&
          r >= 0
        ) {
          nextUnit.fuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'fuelCost') {
        const c = Number(cleanVal);
        const q = Number(cur.fuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.fuelQty.trim() !== '' &&
          Number.isFinite(c) &&
          c >= 0 &&
          Number.isFinite(q) &&
          q > 0
        ) {
          nextUnit.fuelUnitCost = formatCalcValue(c / q, 4);
        }
      } else if (field === 'secondaryFuelUnitCost') {
        const r = Number(cleanVal);
        const q = Number(cur.secondaryFuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.secondaryFuelQty.trim() !== '' &&
          Number.isFinite(r) &&
          r >= 0 &&
          Number.isFinite(q) &&
          q >= 0
        ) {
          nextUnit.secondaryFuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'secondaryFuelQty') {
        const q = Number(cleanVal);
        const r = Number(cur.secondaryFuelUnitCost);
        if (cleanVal.trim() === '') {
          nextUnit.secondaryFuelCost = '';
        } else if (
          cur.secondaryFuelUnitCost.trim() !== '' &&
          Number.isFinite(q) &&
          q >= 0 &&
          Number.isFinite(r) &&
          r >= 0
        ) {
          nextUnit.secondaryFuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'secondaryFuelCost') {
        const c = Number(cleanVal);
        const q = Number(cur.secondaryFuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.secondaryFuelQty.trim() !== '' &&
          Number.isFinite(c) &&
          c >= 0 &&
          Number.isFinite(q) &&
          q > 0
        ) {
          nextUnit.secondaryFuelUnitCost = formatCalcValue(c / q, 4);
        }
      }

      list[index] = nextUnit;
      return { ...prev, generators: list };
    });
  };

  const handleBoilerUnitChange = (
    index: number,
    field:
      | 'steamKg'
      | 'fuelQty'
      | 'fuelUnitCost'
      | 'fuelCost'
      | 'secondaryFuelQty'
      | 'secondaryFuelUnitCost'
      | 'secondaryFuelCost',
    value: string
  ) => {
    if (
      !unitCostUnlocked &&
      (field === 'fuelUnitCost' ||
        field === 'fuelCost' ||
        field === 'secondaryFuelUnitCost' ||
        field === 'secondaryFuelCost')
    ) {
      return;
    }
    const cleanVal = sanitizeNumericInput(value);
    setFeedback(null);
    setGenDirty(true);
    setGenDraft((prev) => {
      const list = [...prev.boilers];
      const cur = list[index];
      if (!cur) return prev;
      const nextUnit: BoilerUnitDraft = { ...cur, [field]: cleanVal };

      if (field === 'fuelUnitCost') {
        const r = Number(cleanVal);
        const q = Number(cur.fuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.fuelQty.trim() !== '' &&
          Number.isFinite(r) &&
          r >= 0 &&
          Number.isFinite(q) &&
          q >= 0
        ) {
          nextUnit.fuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'fuelQty') {
        const q = Number(cleanVal);
        const r = Number(cur.fuelUnitCost);
        if (cleanVal.trim() === '') {
          nextUnit.fuelCost = '';
        } else if (
          cur.fuelUnitCost.trim() !== '' &&
          Number.isFinite(q) &&
          q >= 0 &&
          Number.isFinite(r) &&
          r >= 0
        ) {
          nextUnit.fuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'fuelCost') {
        const c = Number(cleanVal);
        const q = Number(cur.fuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.fuelQty.trim() !== '' &&
          Number.isFinite(c) &&
          c >= 0 &&
          Number.isFinite(q) &&
          q > 0
        ) {
          nextUnit.fuelUnitCost = formatCalcValue(c / q, 4);
        }
      } else if (field === 'secondaryFuelUnitCost') {
        const r = Number(cleanVal);
        const q = Number(cur.secondaryFuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.secondaryFuelQty.trim() !== '' &&
          Number.isFinite(r) &&
          r >= 0 &&
          Number.isFinite(q) &&
          q >= 0
        ) {
          nextUnit.secondaryFuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'secondaryFuelQty') {
        const q = Number(cleanVal);
        const r = Number(cur.secondaryFuelUnitCost);
        if (cleanVal.trim() === '') {
          nextUnit.secondaryFuelCost = '';
        } else if (
          cur.secondaryFuelUnitCost.trim() !== '' &&
          Number.isFinite(q) &&
          q >= 0 &&
          Number.isFinite(r) &&
          r >= 0
        ) {
          nextUnit.secondaryFuelCost = formatCalcValue(q * r, 2);
        }
      } else if (field === 'secondaryFuelCost') {
        const c = Number(cleanVal);
        const q = Number(cur.secondaryFuelQty);
        if (
          cleanVal.trim() !== '' &&
          cur.secondaryFuelQty.trim() !== '' &&
          Number.isFinite(c) &&
          c >= 0 &&
          Number.isFinite(q) &&
          q > 0
        ) {
          nextUnit.secondaryFuelUnitCost = formatCalcValue(c / q, 4);
        }
      }

      list[index] = nextUnit;
      return { ...prev, boilers: list };
    });
  };

  const handleSolarUnitChange = (
    index: number,
    field: 'kwh' | 'unitCost' | 'savings',
    value: string
  ) => {
    if ((field === 'savings' || field === 'unitCost') && !unitCostUnlocked) {
      return;
    }
    const cleanVal = sanitizeNumericInput(value);
    setFeedback(null);
    setGenDirty(true);
    setGenDraft((prev) => {
      const list = [...prev.solarUnits];
      const cur = list[index];
      if (!cur) return prev;
      const nextUnit: SolarUnitDraft = { ...cur, [field]: cleanVal };

      if (field === 'kwh') {
        const k = Number(cleanVal);
        const rate =
          cur.unitCost.trim() !== '' ? Number(cur.unitCost) : activeElectricityRate;
        if (cleanVal.trim() === '') {
          nextUnit.savings = '';
        } else if (Number.isFinite(rate) && rate > 0 && Number.isFinite(k) && k >= 0) {
          nextUnit.savings = formatCalcValue(k * rate, 2);
          if (cur.unitCost.trim() === '' && activeElectricityRate > 0) {
            nextUnit.unitCost = formatCalcValue(activeElectricityRate, 4);
          }
        }
      } else if (field === 'unitCost') {
        const r = Number(cleanVal);
        const k = Number(cur.kwh);
        if (
          cleanVal.trim() !== '' &&
          cur.kwh.trim() !== '' &&
          Number.isFinite(r) &&
          r >= 0 &&
          Number.isFinite(k) &&
          k >= 0
        ) {
          nextUnit.savings = formatCalcValue(k * r, 2);
        }
      } else if (field === 'savings') {
        const sav = Number(cleanVal);
        const k = Number(cur.kwh);
        if (
          cleanVal.trim() !== '' &&
          cur.kwh.trim() !== '' &&
          Number.isFinite(sav) &&
          sav >= 0 &&
          Number.isFinite(k) &&
          k > 0
        ) {
          nextUnit.unitCost = formatCalcValue(sav / k, 4);
        }
      }

      list[index] = nextUnit;
      return { ...prev, solarUnits: list };
    });
  };

  const handleOpenUnlockModal = () => {
    setUnlockPassword('');
    setShowUnlockPassword(false);
    setUnlockError(null);
    setUnlockModalOpen(true);
  };

  const handleVerifyPasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassword.trim()) {
      setUnlockError('Please enter your account password to unlock Unit Rate.');
      return;
    }
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      await verifyCurrentUserPassword(unlockPassword);
      setUnitCostUnlocked(true);
      setUnlockModalOpen(false);
      setUnlockPassword('');
      setFeedback({
        type: 'success',
        text: 'Unit Rates unlocked. Edit rates and click Save to lock again.',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials'
      ) {
        setUnlockError('Incorrect password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setUnlockError('Too many attempts. Please wait a moment and try again.');
      } else {
        setUnlockError(
          err instanceof Error ? err.message : 'Password verification failed.'
        );
      }
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleVerifyGoogleUnlock = async () => {
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      await reauthenticateCurrentUserWithGoogle();
      setUnitCostUnlocked(true);
      setUnlockModalOpen(false);
      setUnlockPassword('');
      setFeedback({
        type: 'success',
        text: 'Verified via Google. Unit Rates are now unlocked for editing.',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setUnlockError('Google verification window was closed before completing.');
      } else {
        setUnlockError(
          err instanceof Error ? err.message : 'Google verification failed.'
        );
      }
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleResetForm = () => {
    setFeedback(null);
    setDirtyUtilIds(new Set());
    setGridDirty(false);
    setGenDirty(false);
    const next: Record<string, RowDraft> = {};
    for (const util of utilities) {
      next[util.id] = buildDraftRow(util.id);
    }
    setDrafts(next);
    setGridDrafts(buildGridDrafts());
    setGenDraft(buildGenerationDraft());
  };

  const handleCopyPreviousDay = () => {
    if (!previousLoggedDay) return;
    setFeedback(null);
    const prevByUtil = new Map<string, UtilityEntry>();
    for (const item of entries) {
      if (item.company === selectedCompany && item.date === previousLoggedDay) {
        prevByUtil.set(item.utilityId, item);
      }
    }
    if (prevByUtil.size === 0) return;

    const touched = new Set<string>();
    setDrafts((prev) => {
      const next = { ...prev };
      for (const util of formStandardUtilities) {
        const source = prevByUtil.get(util.id);
        if (!source) continue;
        touched.add(util.id);
        const savedRate = savedRateMap.get(`${selectedCompany}|||${util.id}`);
        const fixedRateStr =
          savedRate !== undefined
            ? formatCalcValue(savedRate.unitCost, 4)
            : prev[util.id]?.unitCost || '';
        const derivedRate =
          !unitCostUnlocked && fixedRateStr !== ''
            ? fixedRateStr
            : source.consumption > 0
            ? formatCalcValue(source.cost / source.consumption, 4)
            : fixedRateStr;
        const resolvedRateNum = Number(derivedRate);
        const computedCost =
          !unitCostUnlocked &&
          derivedRate !== '' &&
          Number.isFinite(resolvedRateNum) &&
          resolvedRateNum >= 0
            ? formatCalcValue(source.consumption * resolvedRateNum, 2)
            : String(source.cost);
        next[util.id] = {
          unitCost: derivedRate,
          consumption: String(source.consumption),
          cost: computedCost,
          note: source.note,
        };
      }
      return next;
    });
    setDirtyUtilIds(touched);
    setFeedback({
      type: 'success',
      text: `Copied readings from ${formatDate(previousLoggedDay)}. Review and save.`,
    });
  };

  // Single Unified Atomic Save (Grid Peak/Off-Peak + Per-Unit Generators & Fuel + Additive Solar + Per-Unit Boilers & Fuel + Other Utilities + Locked Rates)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !selectedCompany || !selectedDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || selectedDate > todayISO) {
      setFeedback({
        type: 'error',
        text: 'Please choose a valid date on or before today.',
      });
      return;
    }

    setFeedback(null);

    const rowsToSave = formStandardUtilities.filter((util) => {
      const d = drafts[util.id];
      if (!d) return false;
      return (
        d.consumption.trim() !== '' ||
        d.cost.trim() !== '' ||
        d.note.trim() !== ''
      );
    });

    const rowsToDelete = formStandardUtilities.filter((util) => {
      const d = drafts[util.id];
      if (!d) return false;
      const isBlank =
        d.consumption.trim() === '' &&
        d.cost.trim() === '' &&
        d.note.trim() === '';
      return isBlank && existingMap.has(util.id);
    });

    const ratesToPersist: Array<{
      utilId: string;
      rateVal: number;
      existingRateDocId?: string;
    }> = [];

    const collectRate = (
      utilId: string,
      rateStr: string,
      qtyVal: number,
      costVal: number,
      label: string
    ): boolean => {
      const trimmed = rateStr.trim();
      let resolved: number | null = null;
      if (trimmed !== '') {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000000) {
          setFeedback({
            type: 'error',
            text: `${label} unit rate must be between 0 and 10,000,000.`,
          });
          return false;
        }
        resolved = parsed;
      } else if (qtyVal > 0 && costVal >= 0) {
        const computed = Number((costVal / qtyVal).toFixed(4));
        if (computed <= 10000000) resolved = computed;
      }

      if (resolved !== null) {
        const existingSaved = savedRateMap.get(`${selectedCompany}|||${utilId}`);
        if (!existingSaved || Math.abs(existingSaved.unitCost - resolved) > 0.0001) {
          ratesToPersist.push({
            utilId,
            rateVal: resolved,
            existingRateDocId: existingSaved?.id,
          });
        }
      }
      return true;
    };

    for (const util of formStandardUtilities) {
      const d = drafts[util.id];
      if (!d) continue;
      const consVal = d.consumption.trim() === '' ? 0 : Number(d.consumption);
      const costVal = d.cost.trim() === '' ? 0 : Number(d.cost);
      if (
        !collectRate(
          util.id,
          d.unitCost,
          d.consumption.trim() !== '' ? consVal : 0,
          d.cost.trim() !== '' ? costVal : 0,
          util.name
        )
      ) {
        return;
      }
    }

    const gridBreakdownRows: GridProviderReading[] = [];
    let hasGridInput = false;

    if (showGridSection) {
      for (const slot of gridSlots) {
        const gd = gridDrafts[slot.key] || { unitCost: '', kwh: '', cost: '' };
        const kwhVal = gd.kwh.trim() === '' ? 0 : Number(gd.kwh);
        const costVal = gd.cost.trim() === '' ? 0 : Number(gd.cost);

        if (!Number.isFinite(kwhVal) || kwhVal < 0 || kwhVal > 1000000000) {
          setFeedback({
            type: 'error',
            text: `${slot.label} kWh must be between 0 and 1,000,000,000.`,
          });
          return;
        }
        if (!Number.isFinite(costVal) || costVal < 0 || costVal > 100000000000) {
          setFeedback({
            type: 'error',
            text: `${slot.label} cost must be between 0 and 100,000,000,000.`,
          });
          return;
        }
        if (
          !collectRate(
            slot.rateUtilityId,
            gd.unitCost,
            kwhVal,
            costVal,
            slot.label
          )
        ) {
          return;
        }

        if (gd.kwh.trim() !== '' || gd.cost.trim() !== '') {
          hasGridInput = true;
          gridBreakdownRows.push({
            provider: slot.provider,
            tariff: slot.tariff,
            kwh: kwhVal,
            unitCost: Number(gd.unitCost) || (kwhVal > 0 ? costVal / kwhVal : 0),
            cost: costVal,
          });
        }
      }
    }

    for (const util of rowsToSave) {
      const d = drafts[util.id];
      const consumption = d.consumption.trim() === '' ? 0 : Number(d.consumption);
      const cost = d.cost.trim() === '' ? 0 : Number(d.cost);
      if (
        !Number.isFinite(consumption) ||
        consumption < 0 ||
        consumption > 1000000000
      ) {
        setFeedback({
          type: 'error',
          text: `${util.name} consumption must be between 0 and 1,000,000,000.`,
        });
        return;
      }
      if (!Number.isFinite(cost) || cost < 0 || cost > 100000000000) {
        setFeedback({
          type: 'error',
          text: `${util.name} cost must be between 0 and 100,000,000,000.`,
        });
        return;
      }
    }

    // Parse & validate per-unit Named Boilers, Generators (including dual-fuel), and Solar
    const parseVal = (raw: string, max: number, label: string): number | null => {
      if (raw.trim() === '') return 0;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        setFeedback({
          type: 'error',
          text: `${label} must be between 0 and ${formatNumber(max, 0)}.`,
        });
        return null;
      }
      return n;
    };

    const boilerUnitPayload: BoilerUnitReading[] = [];
    const boilerLegacyArray: number[] = [];
    let steamKg = 0;
    let boilerFuelQty = 0;
    let boilerFuelCost = 0;

    for (let i = 0; i < genDraft.boilers.length; i++) {
      const b = genDraft.boilers[i];
      const bLabel = b.deviceName || `Boiler #${i + 1}`;
      const pMode: SingleDeviceFuelMode =
        b.fuelMode === 'dual'
          ? normalizeSingleFuelMode(b.primaryFuelMode, b.fuelUnit)
          : b.fuelMode;
      const sMode: SingleDeviceFuelMode =
        b.fuelMode === 'dual'
          ? normalizeSingleFuelMode(b.secondaryFuelMode, b.secondaryFuelUnit)
          : 'diesel';

      const sVal = parseVal(b.steamKg, 1000000000, `${bLabel} steam`);
      const qVal = parseVal(b.fuelQty, 1000000000, `${bLabel} fuel qty`);
      const cVal = parseVal(b.fuelCost, 100000000000, `${bLabel} fuel cost`);
      if (sVal === null || qVal === null || cVal === null) return;

      if (
        !collectRate(
          boilerDeviceRateId(b.deviceId, b.fuelUnit, pMode),
          b.fuelUnitCost,
          qVal,
          cVal,
          `${bLabel} fuel`
        )
      ) {
        return;
      }

      const resolvedRate =
        Number(b.fuelUnitCost) || (qVal > 0 ? Number((cVal / qVal).toFixed(4)) : 0);

      let sQVal = 0;
      let sCVal = 0;
      let resolvedSecRate = 0;
      if (b.fuelMode === 'dual') {
        const sq = parseVal(b.secondaryFuelQty, 1000000000, `${bLabel} fuel 2 qty`);
        const sc = parseVal(b.secondaryFuelCost, 100000000000, `${bLabel} fuel 2 cost`);
        if (sq === null || sc === null) return;
        sQVal = sq;
        sCVal = sc;
        if (
          !collectRate(
            boilerSecondaryRateId(b.deviceId, b.secondaryFuelUnit, sMode),
            b.secondaryFuelUnitCost,
            sQVal,
            sCVal,
            `${bLabel} secondary fuel`
          )
        ) {
          return;
        }
        resolvedSecRate =
          Number(b.secondaryFuelUnitCost) ||
          (sQVal > 0 ? Number((sCVal / sQVal).toFixed(4)) : 0);
      }

      const unitTotalFuelCost = cVal + sCVal;
      boilerLegacyArray.push(sVal);
      boilerUnitPayload.push({
        unitIndex: i + 1,
        deviceId: b.deviceId,
        deviceName: bLabel.slice(0, 80),
        fuelMode: b.fuelMode,
        ...(b.fuelMode === 'dual'
          ? { primaryFuelMode: pMode, secondaryFuelMode: sMode }
          : {}),
        steamKg: sVal,
        fuelQty: qVal,
        fuelUnit: (b.fuelUnit.trim() || 'm³').slice(0, 16),
        fuelUnitCost: resolvedRate,
        fuelCost: cVal,
        ...(b.fuelMode === 'dual'
          ? {
              secondaryFuelQty: sQVal,
              secondaryFuelUnit: b.secondaryFuelUnit.slice(0, 16),
              secondaryFuelUnitCost: resolvedSecRate,
              secondaryFuelCost: sCVal,
              totalFuelCost: unitTotalFuelCost,
            }
          : { totalFuelCost: unitTotalFuelCost }),
      });
      steamKg += sVal;
      boilerFuelQty += qVal + sQVal;
      boilerFuelCost += unitTotalFuelCost;
    }

    const unifiedGenPayload: GeneratorUnitReading[] = [];
    const dieselUnitPayload: GeneratorUnitReading[] = [];
    const gasUnitPayload: GeneratorUnitReading[] = [];
    const dieselLegacyArray: number[] = [];
    const gasLegacyArray: number[] = [];
    let dieselGenKwh = 0;
    let dieselFuelQty = 0;
    let dieselFuelCost = 0;
    let gasGenKwh = 0;
    let gasFuelQty = 0;
    let gasFuelCost = 0;

    for (let i = 0; i < genDraft.generators.length; i++) {
      const g = genDraft.generators[i];
      const gLabel = g.deviceName || `Generator #${i + 1}`;
      const pMode: SingleDeviceFuelMode =
        g.fuelMode === 'dual'
          ? normalizeSingleFuelMode(g.primaryFuelMode, g.fuelUnit)
          : g.fuelMode;
      const sMode: SingleDeviceFuelMode =
        g.fuelMode === 'dual'
          ? normalizeSingleFuelMode(g.secondaryFuelMode, g.secondaryFuelUnit)
          : 'diesel';

      const kVal = parseVal(g.kwh, 1000000000, `${gLabel} kWh`);
      const qVal = parseVal(g.fuelQty, 1000000000, `${gLabel} fuel qty`);
      const cVal = parseVal(g.fuelCost, 100000000000, `${gLabel} fuel cost`);
      if (kVal === null || qVal === null || cVal === null) return;

      if (
        !collectRate(
          genDeviceRateId(g.deviceId, g.fuelUnit, pMode),
          g.fuelUnitCost,
          qVal,
          cVal,
          `${gLabel} fuel`
        )
      ) {
        return;
      }

      const resolvedRate =
        Number(g.fuelUnitCost) || (qVal > 0 ? Number((cVal / qVal).toFixed(4)) : 0);

      let sQVal = 0;
      let sCVal = 0;
      let resolvedSecRate = 0;
      if (g.fuelMode === 'dual') {
        const sq = parseVal(g.secondaryFuelQty, 1000000000, `${gLabel} fuel 2 qty`);
        const sc = parseVal(g.secondaryFuelCost, 100000000000, `${gLabel} fuel 2 cost`);
        if (sq === null || sc === null) return;
        sQVal = sq;
        sCVal = sc;
        if (
          !collectRate(
            genSecondaryRateId(g.deviceId, g.secondaryFuelUnit, sMode),
            g.secondaryFuelUnitCost,
            sQVal,
            sCVal,
            `${gLabel} secondary fuel`
          )
        ) {
          return;
        }
        resolvedSecRate =
          Number(g.secondaryFuelUnitCost) ||
          (sQVal > 0 ? Number((sCVal / sQVal).toFixed(4)) : 0);
      }

      const unitTotalFuelCost = cVal + sCVal;
      const genReading: GeneratorUnitReading = {
        unitIndex: i + 1,
        deviceId: g.deviceId,
        deviceName: gLabel.slice(0, 80),
        fuelMode: g.fuelMode,
        ...(g.fuelMode === 'dual'
          ? { primaryFuelMode: pMode, secondaryFuelMode: sMode }
          : {}),
        kwh: kVal,
        fuelQty: qVal,
        fuelUnit: (g.fuelUnit.trim() || 'L').slice(0, 16),
        fuelUnitCost: resolvedRate,
        fuelCost: cVal,
        ...(g.fuelMode === 'dual'
          ? {
              secondaryFuelQty: sQVal,
              secondaryFuelUnit: g.secondaryFuelUnit.slice(0, 16),
              secondaryFuelUnitCost: resolvedSecRate,
              secondaryFuelCost: sCVal,
              totalFuelCost: unitTotalFuelCost,
            }
          : { totalFuelCost: unitTotalFuelCost }),
      };

      unifiedGenPayload.push(genReading);

      if (g.fuelMode === 'dual') {
        if (isGasLikeFuelMode(pMode)) {
          gasLegacyArray.push(kVal);
          gasUnitPayload.push(genReading);
          gasGenKwh += kVal;
          gasFuelQty += qVal;
          gasFuelCost += cVal;
          dieselFuelQty += sQVal;
          dieselFuelCost += sCVal;
        } else {
          dieselLegacyArray.push(kVal);
          dieselUnitPayload.push(genReading);
          dieselGenKwh += kVal;
          dieselFuelQty += qVal;
          dieselFuelCost += cVal;
          gasFuelQty += sQVal;
          gasFuelCost += sCVal;
        }
      } else if (isGasLikeFuelMode(g.fuelMode)) {
        gasLegacyArray.push(kVal);
        gasUnitPayload.push(genReading);
        gasGenKwh += kVal;
        gasFuelQty += qVal;
        gasFuelCost += cVal;
      } else {
        dieselLegacyArray.push(kVal);
        dieselUnitPayload.push(genReading);
        dieselGenKwh += kVal;
        dieselFuelQty += qVal;
        dieselFuelCost += cVal;
      }
    }

    const solarUnitPayload: SolarUnitReading[] = [];
    const solarLegacyArray: number[] = [];
    let solarKwh = 0;
    let solarSavings = 0;

    for (let i = 0; i < genDraft.solarUnits.length; i++) {
      const s = genDraft.solarUnits[i];
      const sLabel = s.deviceName || `Solar #${i + 1}`;
      const kVal = parseVal(s.kwh, 1000000000, `${sLabel} kWh`);
      const savVal = parseVal(s.savings, 100000000000, `${sLabel} savings`);
      if (kVal === null || savVal === null) return;

      if (
        s.unitCost.trim() !== '' &&
        !collectRate(
          solarDeviceRateId(s.deviceId),
          s.unitCost,
          kVal,
          savVal,
          `${sLabel} tariff`
        )
      ) {
        return;
      }

      const resolvedSolarRate =
        s.unitCost.trim() !== ''
          ? Number(s.unitCost)
          : kVal > 0 && savVal > 0
          ? Number((savVal / kVal).toFixed(4))
          : activeElectricityRate > 0
          ? Number(activeElectricityRate.toFixed(4))
          : 0;

      solarLegacyArray.push(kVal);
      solarUnitPayload.push({
        unitIndex: i + 1,
        deviceId: s.deviceId,
        deviceName: sLabel.slice(0, 80),
        kwh: kVal,
        unitCost: resolvedSolarRate,
        savings: savVal,
      });
      solarKwh += kVal;
      solarSavings += savVal;
    }

    const generatorKwh = dieselGenKwh + gasGenKwh;
    const generatorFuelQty = dieselFuelQty + gasFuelQty;
    const generatorFuelCost = dieselFuelCost + gasFuelCost;

    const hasGenerationData =
      steamKg > 0 ||
      boilerFuelQty > 0 ||
      boilerFuelCost > 0 ||
      generatorKwh > 0 ||
      generatorFuelQty > 0 ||
      generatorFuelCost > 0 ||
      solarKwh > 0 ||
      solarSavings > 0 ||
      hasGridInput ||
      genDraft.note.trim() !== '';

    const shouldDeleteElectricityFromGrid =
      showGridSection &&
      !hasGridInput &&
      Boolean(electricityUtility && existingMap.has(electricityUtility.id));

    const shouldDeleteExistingGen =
      !hasGenerationData && existingGeneration !== null;

    if (
      rowsToSave.length === 0 &&
      rowsToDelete.length === 0 &&
      ratesToPersist.length === 0 &&
      !hasGridInput &&
      !shouldDeleteElectricityFromGrid &&
      !hasGenerationData &&
      !shouldDeleteExistingGen
    ) {
      setFeedback({
        type: 'error',
        text: 'Enter at least one utility, generator, solar, or boiler reading before saving.',
      });
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      const safeEnteredByName =
        (profile.name || user.displayName || user.email || 'User')
          .trim()
          .slice(0, 100) || 'User';

      const canViewSelectedCompany =
        profile.role === 'admin' ||
        (profile.viewCompanies || []).includes(selectedCompany);

      const nextEntriesMap = new Map(entries.map((item) => [item.id, item]));

      const upsertUtilityEntry = async (
        util: (typeof utilities)[number],
        consumption: number,
        cost: number,
        note: string
      ) => {
        let existing = existingMap.get(util.id);
        const docId =
          existing?.id ||
          toSafeFirestoreId(
            'entry',
            `${selectedDate}__${selectedCompany}__${util.id}`
          );

        if (!existing && !canViewSelectedCompany) {
          const existingSnap = await getDoc(doc(db, 'utilityEntries', docId));
          if (existingSnap.exists()) {
            existing = {
              id: existingSnap.id,
              ...(existingSnap.data() as Omit<UtilityEntry, 'id'>),
            };
          }
        }

        const entryRef = doc(db, 'utilityEntries', docId);
        if (existing) {
          batch.update(entryRef, {
            utilityName: util.name.slice(0, 80),
            unit: util.unit.slice(0, 30),
            consumption,
            cost,
            note,
            enteredBy: user.uid,
            enteredByName: safeEnteredByName,
            updatedAt: serverTimestamp(),
          });
          if (canViewSelectedCompany) {
            nextEntriesMap.set(docId, {
              ...existing,
              utilityName: util.name,
              unit: util.unit,
              consumption,
              cost,
              note,
              enteredBy: user.uid,
              enteredByName: safeEnteredByName,
            });
          }
        } else {
          batch.set(entryRef, {
            date: selectedDate,
            company: selectedCompany,
            utilityId: util.id,
            utilityName: util.name.slice(0, 80),
            unit: util.unit.slice(0, 30),
            consumption,
            cost,
            note,
            enteredBy: user.uid,
            enteredByName: safeEnteredByName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (canViewSelectedCompany) {
            nextEntriesMap.set(docId, {
              id: docId,
              date: selectedDate,
              company: selectedCompany,
              utilityId: util.id,
              utilityName: util.name,
              unit: util.unit,
              consumption,
              cost,
              note,
              enteredBy: user.uid,
              enteredByName: safeEnteredByName,
              createdAt: null,
              updatedAt: null,
            });
          }
        }
      };

      for (const util of rowsToDelete) {
        const existing = existingMap.get(util.id);
        if (!existing) continue;
        batch.delete(doc(db, 'utilityEntries', existing.id));
        if (canViewSelectedCompany) nextEntriesMap.delete(existing.id);
      }

      for (const util of rowsToSave) {
        const d = drafts[util.id];
        const consumption = d.consumption.trim() === '' ? 0 : Number(d.consumption);
        const cost = d.cost.trim() === '' ? 0 : Number(d.cost);
        const note = d.note.trim().slice(0, 300);
        await upsertUtilityEntry(util, consumption, cost, note);
      }

      if (showGridSection && electricityUtility) {
        if (hasGridInput) {
          const gridSummaryNote = gridBreakdownRows
            .map((r) => {
              const tLabel =
                r.tariff === 'peak'
                  ? ' Peak'
                  : r.tariff === 'offPeak'
                  ? ' Off-Peak'
                  : '';
              return `${r.provider}${tLabel}: ${formatNumber(r.kwh)} kWh`;
            })
            .join(', ')
            .slice(0, 300);
          await upsertUtilityEntry(
            electricityUtility,
            gridTotals.totalKwh,
            gridTotals.totalCost,
            gridSummaryNote
          );
        } else if (shouldDeleteElectricityFromGrid) {
          const existingElec = existingMap.get(electricityUtility.id);
          if (existingElec) {
            batch.delete(doc(db, 'utilityEntries', existingElec.id));
            if (canViewSelectedCompany) nextEntriesMap.delete(existingElec.id);
          }
        }
      }

      for (const item of ratesToPersist) {
        const rateDocId =
          item.existingRateDocId ||
          toSafeFirestoreId('rate', `${selectedCompany}__${item.utilId}`);
        const rateRef = doc(db, 'users', user.uid, 'unitRates', rateDocId);
        if (item.existingRateDocId) {
          batch.update(rateRef, {
            unitCost: item.rateVal,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(rateRef, {
            company: selectedCompany,
            utilityId: item.utilId,
            unitCost: item.rateVal,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const genDocId =
        existingGeneration?.id ||
        toSafeFirestoreId('gen', `${selectedDate}__${selectedCompany}`);
      let existingGenDoc = existingGeneration;
      if (!existingGenDoc && !canViewSelectedCompany) {
        const gSnap = await getDoc(doc(db, 'generationEntries', genDocId));
        if (gSnap.exists()) {
          existingGenDoc = {
            id: gSnap.id,
            ...(gSnap.data() as Omit<GenerationEntry, 'id'>),
          };
        }
      }

      if (hasGenerationData) {
        const unitReadingsPayload: GenerationUnitReadings = {
          boilerUnits: boilerUnitPayload,
          generatorUnits: unifiedGenPayload,
          dieselGenUnits: dieselUnitPayload,
          gasGenUnits: gasUnitPayload,
          solarUnitDetails: solarUnitPayload,
          boilers: boilerLegacyArray,
          dieselGens: dieselLegacyArray,
          gasGens: gasLegacyArray,
          solarUnits: solarLegacyArray,
        };
        let unitReadingsJson = JSON.stringify(unitReadingsPayload);
        if (unitReadingsJson.length > 12000) {
          const compactPayload: GenerationUnitReadings = {
            boilerUnits: boilerUnitPayload,
            generatorUnits: unifiedGenPayload,
            solarUnitDetails: solarUnitPayload,
          };
          unitReadingsJson = JSON.stringify(compactPayload).slice(0, 12000);
        }
        const gridBreakdownJson = JSON.stringify(gridBreakdownRows).slice(0, 2500);

        const boilerUnitsDistinct = Array.from(
          new Set(
            boilerUnitPayload.flatMap((u) =>
              u.fuelMode === 'dual' && u.secondaryFuelUnit
                ? [u.fuelUnit, u.secondaryFuelUnit]
                : [u.fuelUnit]
            )
          )
        );
        const primaryBoilerUnit =
          boilerUnitsDistinct.length === 1
            ? boilerUnitsDistinct[0]
            : boilerUnitsDistinct.length > 1
            ? 'Mixed'
            : plantSetup.boilerFuelUnit || 'm³';

        const genFuelUnits = Array.from(
          new Set(
            unifiedGenPayload.flatMap((u) =>
              u.fuelMode === 'dual' && u.secondaryFuelUnit
                ? [u.fuelUnit, u.secondaryFuelUnit]
                : [u.fuelUnit]
            )
          )
        );
        const genFuelUnit =
          genFuelUnits.length === 1
            ? genFuelUnits[0]
            : genFuelUnits.length > 1
            ? 'Mixed'
            : plantSetup.dieselGeneratorCount > 0
            ? 'L'
            : 'm³';

        const genPayload = {
          boilerCount: plantSetup.boilers.length,
          steamKg,
          boilerFuelQty,
          boilerFuelUnit: primaryBoilerUnit.slice(0, 30),
          boilerFuelCost,
          generatorCount: plantSetup.generators.length,
          generatorKwh,
          generatorFuelQty,
          generatorFuelUnit: genFuelUnit.slice(0, 30),
          generatorFuelCost,
          dieselGeneratorCount: plantSetup.dieselGeneratorCount,
          dieselGenKwh,
          dieselFuelQty,
          dieselFuelCost,
          gasGeneratorCount: plantSetup.gasGeneratorCount,
          gasGenKwh,
          gasFuelQty,
          gasFuelCost,
          solarSystemCount: plantSetup.solars.length,
          solarKwh,
          solarSavings,
          gridProviderBreakdown: gridBreakdownJson,
          unitReadings: unitReadingsJson,
          note: genDraft.note.trim().slice(0, 300),
          enteredBy: user.uid,
          enteredByName: safeEnteredByName,
          updatedAt: serverTimestamp(),
        };

        if (existingGenDoc) {
          batch.update(doc(db, 'generationEntries', existingGenDoc.id), genPayload);
        } else {
          batch.set(doc(db, 'generationEntries', genDocId), {
            date: selectedDate,
            company: selectedCompany,
            ...genPayload,
            createdAt: serverTimestamp(),
          });
        }
      } else if (existingGenDoc) {
        batch.delete(doc(db, 'generationEntries', existingGenDoc.id));
      }

      await batch.commit();
      setDirtyUtilIds(new Set());
      setGridDirty(false);
      setGenDirty(false);
      setUnitCostUnlocked(false);

      const savedUtilityChanges =
        rowsToSave.length > 0 ||
        rowsToDelete.length > 0 ||
        hasGridInput ||
        shouldDeleteElectricityFromGrid;

      if (!savedUtilityChanges && !hasGenerationData && !shouldDeleteExistingGen) {
        setFeedback({
          type: 'success',
          text: `Saved and locked unit rates for ${selectedCompany}.`,
        });
        return;
      }

      const actionLabel = `Saved daily log for ${selectedCompany} (${formatDate(
        selectedDate
      )})`;

      const nextEntries = Array.from(nextEntriesMap.values());
      const affectedTabs = canViewSelectedCompany
        ? [{ company: selectedCompany, monthKey: selectedMonth }]
        : undefined;

      if (
        profile.role === 'admin' &&
        sheetsConfig?.syncMode === 'appsScript' &&
        canViewSelectedCompany &&
        savedUtilityChanges
      ) {
        try {
          const syncedCount = await syncEntriesToConnectedSheet(
            nextEntries,
            affectedTabs
          );
          setFeedback({
            type: 'success',
            text: `${actionLabel} and synced ${formatNumber(syncedCount, 0)} rows to Google Sheets.`,
          });
        } catch (syncErr) {
          setFeedback({
            type: 'error',
            text: `Saved to database, but Google Sheets sync failed: ${
              syncErr instanceof Error ? syncErr.message : 'Unknown error'
            }`,
          });
        }
      } else {
        setFeedback({
          type: 'success',
          text: `${actionLabel}.`,
        });
        if (
          profile.role === 'admin' &&
          sheetsConfig &&
          promptSyncAfterSave &&
          googleAccessToken &&
          canViewSelectedCompany &&
          savedUtilityChanges
        ) {
          setSyncModalOpen(true);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'utilityEntries');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGeneration = async (genId: string) => {
    setGenDeleting(true);
    try {
      await deleteDoc(doc(db, 'generationEntries', genId));
      setConfirmDeleteGenId(null);
      setGenDirty(false);
      setFeedback({ type: 'success', text: 'Generation log deleted.' });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `generationEntries/${genId}`
      );
    } finally {
      setGenDeleting(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    setDeletingId(entryId);
    const targetEntry = entries.find((item) => item.id === entryId);
    try {
      await deleteDoc(doc(db, 'utilityEntries', entryId));
      setConfirmDeleteId(null);

      if (profile?.role === 'admin' && sheetsConfig?.syncMode === 'appsScript') {
        try {
          const nextEntries = entries.filter((item) => item.id !== entryId);
          const ensureTabs = targetEntry
            ? [
                {
                  company: targetEntry.company,
                  monthKey: targetEntry.date.slice(0, 7),
                },
              ]
            : undefined;
          const count = await syncEntriesToConnectedSheet(nextEntries, ensureTabs);
          setFeedback({
            type: 'success',
            text: `Entry deleted and Google Sheet synced (${formatNumber(
              count,
              0
            )} rows).`,
          });
        } catch (syncErr) {
          setFeedback({
            type: 'error',
            text: `Entry deleted from database, but Google Sheets sync failed: ${
              syncErr instanceof Error ? syncErr.message : 'Unknown error'
            }`,
          });
        }
      } else {
        setFeedback({ type: 'success', text: 'Entry deleted.' });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `utilityEntries/${entryId}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenSyncSheets = async () => {
    if (profile?.role !== 'admin') return;
    setFeedback(null);
    if (sheetsConfig?.syncMode === 'appsScript') {
      setSyncingSheets(true);
      try {
        const count = await syncEntriesToConnectedSheet();
        setFeedback({
          type: 'success',
          text: `Synced ${formatNumber(count, 0)} entries to Google Sheets.`,
        });
      } catch (err) {
        setFeedback({
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
        setFeedback({
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
    try {
      const count = await syncEntriesToConnectedSheet();
      setSyncModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Synced ${formatNumber(count, 0)} entries to Google Sheets.`,
      });
    } catch (err) {
      setSyncModalOpen(false);
      setFeedback({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to sync with Google Sheets.',
      });
    } finally {
      setSyncingSheets(false);
    }
  };

  const monthCalendarDays = useMemo(() => {
    const totalDays = getDaysInMonth(selectedMonth);
    const dayTotals = new Map<string, { cost: number; count: number }>();

    for (const entry of entries) {
      if (
        entry.company === selectedCompany &&
        entry.date.startsWith(`${selectedMonth}-`)
      ) {
        const cur = dayTotals.get(entry.date) || { cost: 0, count: 0 };
        cur.cost += entry.cost;
        cur.count += 1;
        dayTotals.set(entry.date, cur);
      }
    }
    for (const gen of generationEntries) {
      if (
        gen.company === selectedCompany &&
        gen.date.startsWith(`${selectedMonth}-`)
      ) {
        const cur = dayTotals.get(gen.date) || { cost: 0, count: 0 };
        cur.cost += (gen.boilerFuelCost || 0) + (gen.generatorFuelCost || 0);
        cur.count += 1;
        dayTotals.set(gen.date, cur);
      }
    }

    const list: Array<{
      iso: string;
      dayNum: number;
      isFuture: boolean;
      cost: number;
      count: number;
    }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const iso = `${selectedMonth}-${String(d).padStart(2, '0')}`;
      const info = dayTotals.get(iso);
      list.push({
        iso,
        dayNum: d,
        isFuture: iso > todayISO,
        cost: info?.cost ?? 0,
        count: info?.count ?? 0,
      });
    }
    return list;
  }, [entries, generationEntries, selectedCompany, selectedMonth, todayISO]);

  const monthFactoryStats = useMemo(() => {
    let totalCost = 0;
    let loggedDays = 0;
    let availableDays = 0;
    for (const day of monthCalendarDays) {
      if (!day.isFuture) availableDays += 1;
      if (day.count > 0) {
        loggedDays += 1;
        totalCost += day.cost;
      }
    }
    return { totalCost, loggedDays, availableDays };
  }, [monthCalendarDays]);

  const monthlyGroupedDates = useMemo(() => {
    const allowedSet = new Set(allowedCompanies);
    const matchFactory = (comp: string) => {
      if (!allowedSet.has(comp)) return false;
      if (logFactoryFilter === 'SELECTED') return comp === selectedCompany;
      if (logFactoryFilter !== 'ALL' && comp !== logFactoryFilter) return false;
      return true;
    };

    const byDate = new Map<
      string,
      {
        date: string;
        totalCost: number;
        items: UtilityEntry[];
        generations: GenerationEntry[];
      }
    >();

    const ensureBucket = (date: string) => {
      let bucket = byDate.get(date);
      if (!bucket) {
        bucket = { date, totalCost: 0, items: [], generations: [] };
        byDate.set(date, bucket);
      }
      return bucket;
    };

    for (const entry of entries) {
      if (!entry.date.startsWith(`${selectedMonth}-`)) continue;
      if (!matchFactory(entry.company)) continue;
      const b = ensureBucket(entry.date);
      b.totalCost += entry.cost;
      b.items.push(entry);
    }

    for (const gen of generationEntries) {
      if (!gen.date.startsWith(`${selectedMonth}-`)) continue;
      if (!matchFactory(gen.company)) continue;
      const b = ensureBucket(gen.date);
      b.totalCost += (gen.boilerFuelCost || 0) + (gen.generatorFuelCost || 0);
      b.generations.push(gen);
    }

    return Array.from(byDate.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => {
          const cCmp = a.company.localeCompare(b.company);
          if (cCmp !== 0) return cCmp;
          return a.utilityName.localeCompare(b.utilityName);
        }),
        generations: group.generations.sort((a, b) =>
          a.company.localeCompare(b.company)
        ),
      }));
  }, [
    entries,
    generationEntries,
    allowedCompanies,
    selectedMonth,
    logFactoryFilter,
    selectedCompany,
  ]);

  if (allowedCompanies.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-xl mx-auto">
        <AlertCircle className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">
          No Factories Assigned
        </h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Ask an administrator to assign Entry Factories under User Management.
        </p>
      </div>
    );
  }

  const renderInlineRateBadge = (
    rateStr: string,
    unitLabel: string,
    fallbackText?: string
  ) => {
    const numRate = Number(rateStr);
    const hasRate = rateStr.trim() !== '' && Number.isFinite(numRate);
    return (
      <button
        type="button"
        onClick={handleOpenUnlockModal}
        title="Click to unlock and edit Unit Rate"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-teal-700 transition-colors tabular-nums cursor-pointer"
      >
        <Lock className="w-3 h-3 text-slate-400 shrink-0" />
        {hasRate ? (
          <span>
            Rate:{' '}
            <strong className="font-mono-num text-slate-800">
              ৳ {formatNumber(numRate, 2)}/{unitLabel}
            </strong>
          </span>
        ) : (
          <span className="text-slate-500">{fallbackText || 'Rate not set'}</span>
        )}
      </button>
    );
  };

  // Unlocked-only rate input helper (only rendered when unitCostUnlocked is true)
  const renderEditableRateInput = (
    value: string,
    onChange: (v: string) => void,
    unitLabel: string,
    ariaLabel: string,
    customPlaceholder?: string
  ) => (
    <div className="flex items-stretch h-10 rounded-lg border border-amber-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
      <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center select-none shrink-0">
        ৳/{unitLabel}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={customPlaceholder ?? '0.00'}
        aria-label={ariaLabel}
        className="w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums text-slate-900 bg-transparent focus:outline-none"
      />
    </div>
  );

  const renderStandardUtilityRow = (util: (typeof utilities)[number]) => {
    const draft = drafts[util.id] || {
      unitCost: '',
      consumption: '',
      cost: '',
      note: '',
    };
    return (
      <div
        key={util.id}
        className="p-4 sm:p-5 space-y-3 hover:bg-slate-50/40 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: util.color }}
            />
            <span className="text-sm font-semibold text-slate-900 truncate">
              {util.name}
            </span>
            <span className="text-xs text-slate-500">({util.unit})</span>
          </div>
          {!unitCostUnlocked && renderInlineRateBadge(draft.unitCost, util.unit)}
        </div>

        <div
          className={`grid grid-cols-1 gap-3.5 ${
            unitCostUnlocked ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          }`}
        >
          {unitCostUnlocked && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Tariff Rate (Editable)
              </label>
              {renderEditableRateInput(
                draft.unitCost,
                (v) => handleFieldChange(util.id, 'unitCost', v),
                util.unit,
                `${util.name} unit rate`
              )}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Consumption ({util.unit})
            </label>
            <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20 focus-within:border-teal-600">
              <input
                type="text"
                inputMode="decimal"
                value={draft.consumption}
                onChange={(e) =>
                  handleFieldChange(util.id, 'consumption', e.target.value)
                }
                placeholder="0"
                aria-label={`${util.name} usage`}
                className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums text-slate-900 bg-transparent focus:outline-none"
              />
              <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center select-none shrink-0">
                {util.unit}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Total Cost (৳)
            </label>
            <div
              className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                !unitCostUnlocked
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
              }`}
            >
              <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center select-none shrink-0">
                ৳
              </span>
              <input
                type="text"
                inputMode="decimal"
                readOnly={!unitCostUnlocked}
                tabIndex={!unitCostUnlocked ? -1 : undefined}
                value={draft.cost}
                onChange={(e) => handleFieldChange(util.id, 'cost', e.target.value)}
                placeholder="0.00"
                aria-label={`${util.name} total cost`}
                className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                  !unitCostUnlocked
                    ? 'text-teal-800 bg-transparent cursor-not-allowed'
                    : 'text-slate-900 bg-transparent'
                }`}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Compact Top Context Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:px-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              id="entry-company"
              aria-label="Select factory"
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setFeedback(null);
              }}
              className="h-9 px-3 text-sm font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              {allowedCompanies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(shiftDaysISO(selectedDate, -1));
                  setFeedback(null);
                }}
                aria-label="Previous day"
                className="w-9 h-9 flex items-center justify-center bg-white border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                id="entry-date"
                aria-label="Entry date"
                type="date"
                value={selectedDate}
                max={todayISO}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
                  setSelectedDate(raw > todayISO ? todayISO : raw);
                  setFeedback(null);
                }}
                className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                disabled={selectedDate >= todayISO}
                onClick={() => {
                  const nextDay = shiftDaysISO(selectedDate, 1);
                  setSelectedDate(nextDay > todayISO ? todayISO : nextDay);
                  setFeedback(null);
                }}
                aria-label="Next day"
                className="w-9 h-9 flex items-center justify-center bg-white border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {selectedDate !== todayISO && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(todayISO);
                    setFeedback(null);
                  }}
                  className="h-9 px-2.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg cursor-pointer"
                >
                  Today
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 tabular-nums">
              <span className="text-slate-500">{formatMonthTitle(selectedMonth)}: </span>
              <strong className="text-slate-900">
                {formatNumber(monthFactoryStats.loggedDays, 0)}/
                {formatNumber(monthFactoryStats.availableDays, 0)}d
              </strong>
              <span className="text-slate-300 mx-1.5">·</span>
              <strong className="text-teal-800">
                {formatCurrency(monthFactoryStats.totalCost)}
              </strong>
            </div>

            <button
              type="button"
              onClick={() => setShowCalendar((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                showCalendar
                  ? 'bg-teal-700 border-teal-700 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              {showCalendar ? 'Hide Calendar' : 'Month Calendar'}
            </button>

            {selectedCompanyObj && (
              <button
                type="button"
                onClick={() => setShowEquipEditor((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  showEquipEditor
                    ? 'bg-teal-700 border-teal-700 text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {showEquipEditor ? 'Hide Equipment' : 'Equipment Setup'}
              </button>
            )}
          </div>
        </div>

        {showEquipEditor && selectedCompanyObj && (
          <div className="pt-2 border-t border-slate-200">
            <CompanyEquipmentEditor
              company={selectedCompanyObj}
              canEdit={true}
              onClose={() => setShowEquipEditor(false)}
              onSaved={(msg) => {
                setShowEquipEditor(false);
                setFeedback({ type: 'success', text: msg });
              }}
              onError={(msg) => setFeedback({ type: 'error', text: msg })}
            />
          </div>
        )}

        {/* Collapsible 31-day Month Calendar */}
        {showCalendar && (
          <div className="pt-3 border-t border-slate-200 grid grid-cols-7 sm:grid-cols-11 lg:grid-cols-16 gap-1.5">
            {monthCalendarDays.map((day) => {
              const isSelected = day.iso === selectedDate;
              const hasEntry = day.count > 0;
              return (
                <button
                  key={day.iso}
                  type="button"
                  disabled={day.isFuture}
                  onClick={() => {
                    setSelectedDate(day.iso);
                    setFeedback(null);
                  }}
                  className={`p-1.5 rounded-lg border text-center transition-colors ${
                    day.isFuture
                      ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                      : isSelected
                      ? 'bg-teal-700 border-teal-700 text-white cursor-pointer'
                      : hasEntry
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950 hover:bg-emerald-100 cursor-pointer'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                  }`}
                >
                  <div className="text-xs font-bold tabular-nums leading-tight">
                    {String(day.dayNum).padStart(2, '0')}
                  </div>
                  <div
                    className={`text-[10px] tabular-nums truncate mt-0.5 leading-tight ${
                      isSelected
                        ? 'text-teal-100'
                        : hasEntry
                        ? 'text-emerald-700 font-medium'
                        : 'text-slate-400'
                    }`}
                  >
                    {hasEntry
                      ? day.cost > 0
                        ? formatCompactCurrency(day.cost)
                        : 'Logged'
                      : '—'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* AIRY, NON-COMPACT ENTRY FORM */}
      <form
        onSubmit={handleSave}
        className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200"
      >
        {/* Form Toolbar */}
        <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-900">
              {selectedCompany} · {formatDate(selectedDate)}
            </h2>
            <span
              className={`text-xs font-semibold ${
                isEditingExisting ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              {isEditingExisting ? '· Saved Day' : '· New Entry'}
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs font-semibold text-amber-700">
                · Unsaved
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <button
              type="button"
              onClick={() => {
                if (unitCostUnlocked) {
                  setUnitCostUnlocked(false);
                  setFeedback({
                    type: 'success',
                    text: 'Unit Rates locked.',
                  });
                } else {
                  handleOpenUnlockModal();
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                unitCostUnlocked
                  ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                  : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-100'
              }`}
            >
              {unitCostUnlocked ? (
                <>
                  <Unlock className="w-3.5 h-3.5 text-amber-700" />
                  Unlocked · Lock Rates
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-teal-700" />
                  Rates Locked · Unlock
                </>
              )}
            </button>

            {!isEditingExisting && previousLoggedDay && (
              <button
                type="button"
                onClick={handleCopyPreviousDay}
                className="inline-flex items-center gap-1.5 px-3 py-2 font-medium bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-teal-700" />
                Copy Prev Day
              </button>
            )}

            <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 tabular-nums">
              <span className="text-slate-500">Total Cost: </span>
              <strong className="text-slate-900">{formatCurrency(totalDraftCost)}</strong>
              {genLiveMetrics.combinedSolarSavings > 0 && (
                <>
                  <span className="text-slate-300 mx-1.5">|</span>
                  <span className="text-emerald-700 font-semibold">
                    Solar Saved: {formatCurrency(genLiveMetrics.combinedSolarSavings)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* STEP 1: GRID ELECTRICITY (FLAT OR PEAK / OFF-PEAK) */}
        {(showGridSection || showSingleElectricityTop) && (
          <div>
            <div className="px-4 sm:px-6 py-3 bg-blue-50/40 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Zap className="w-4 h-4 text-blue-600" />
                1. Grid Electricity
                {plantSetup.gridHasPeakOffPeak && (
                  <span className="text-xs font-medium text-blue-700">
                    (Peak &amp; Off-Peak Hours)
                  </span>
                )}
              </span>
              {showGridSection && gridSlots.length > 1 && (
                <span className="font-semibold text-blue-900 tabular-nums">
                  Combined: {formatNumber(gridTotals.totalKwh)} kWh ·{' '}
                  {formatCurrency(gridTotals.totalCost)}
                  {plantSetup.gridHasPeakOffPeak &&
                    (gridTotals.peakKwh > 0 || gridTotals.offPeakKwh > 0) &&
                    ` (Peak: ${formatNumber(gridTotals.peakKwh)} · Off-Peak: ${formatNumber(
                      gridTotals.offPeakKwh
                    )} kWh)`}
                </span>
              )}
            </div>

            {showGridSection ? (
              <div className="divide-y divide-slate-100">
                {gridSlots.map((slot) => {
                  const gd = gridDrafts[slot.key] || {
                    unitCost: '',
                    kwh: '',
                    cost: '',
                  };
                  return (
                    <div
                      key={slot.key}
                      className="p-4 sm:p-5 space-y-3 hover:bg-slate-50/40 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-2.5 h-2.5 rounded-sm shrink-0 ${
                              slot.tariff === 'peak'
                                ? 'bg-indigo-600'
                                : slot.tariff === 'offPeak'
                                ? 'bg-sky-500'
                                : 'bg-blue-600'
                            }`}
                          />
                          <span className="text-sm font-semibold text-slate-900">
                            {slot.label}
                          </span>
                          <span className="text-xs text-slate-500">(kWh)</span>
                        </div>
                        {!unitCostUnlocked && renderInlineRateBadge(gd.unitCost, 'kWh')}
                      </div>

                      <div
                        className={`grid grid-cols-1 gap-3.5 ${
                          unitCostUnlocked ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                        }`}
                      >
                        {unitCostUnlocked && (
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Tariff Rate (Editable)
                            </label>
                            {renderEditableRateInput(
                              gd.unitCost,
                              (v) => handleGridFieldChange(slot.key, 'unitCost', v),
                              'kWh',
                              `${slot.label} unit rate`
                            )}
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Meter Consumption (kWh)
                          </label>
                          <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20 focus-within:border-teal-600">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={gd.kwh}
                              onChange={(e) =>
                                handleGridFieldChange(slot.key, 'kwh', e.target.value)
                              }
                              placeholder="0"
                              aria-label={`${slot.label} usage kWh`}
                              className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums text-slate-900 bg-transparent focus:outline-none"
                            />
                            <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center select-none shrink-0">
                              kWh
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            Electricity Cost (৳)
                          </label>
                          <div
                            className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                              !unitCostUnlocked
                                ? 'border-slate-200 bg-slate-50'
                                : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
                            }`}
                          >
                            <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center select-none shrink-0">
                              ৳
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              readOnly={!unitCostUnlocked}
                              tabIndex={!unitCostUnlocked ? -1 : undefined}
                              value={gd.cost}
                              onChange={(e) =>
                                handleGridFieldChange(slot.key, 'cost', e.target.value)
                              }
                              placeholder="0.00"
                              aria-label={`${slot.label} cost`}
                              className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                                !unitCostUnlocked
                                  ? 'text-teal-800 bg-transparent cursor-not-allowed'
                                  : 'text-slate-900 bg-transparent'
                              }`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              electricityUtility && (
                <div className="divide-y divide-slate-100">
                  {renderStandardUtilityRow(electricityUtility)}
                </div>
              )
            )}
          </div>
        )}

        {/* STEP 2: NAMED GENERATORS (SINGLE OR DUAL-FUEL, LOCKED UNITS) */}
        {hasGenerators && (
          <div>
            <div className="px-4 sm:px-6 py-3 bg-amber-50/40 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Fuel className="w-4 h-4 text-amber-600" />
                2. Captive Generators ({genDraft.generators.length})
              </span>
              {genLiveMetrics.combinedGenKwh > 0 && (
                <span className="font-semibold text-slate-700 tabular-nums">
                  Total Gen: {formatNumber(genLiveMetrics.combinedGenKwh)} kWh
                  {genLiveMetrics.combinedGenFuelCost > 0 &&
                    ` · Fuel: ${formatCurrency(genLiveMetrics.combinedGenFuelCost)}`}
                  {genLiveMetrics.combinedGenCostPerKwh !== null &&
                    ` · Avg ৳ ${formatNumber(genLiveMetrics.combinedGenCostPerKwh, 2)}/kWh`}
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {genDraft.generators.map((unit, idx) => {
                const kwhVal = Number(unit.kwh) || 0;
                const fQtyVal = Number(unit.fuelQty) || 0;
                const fCostVal = Number(unit.fuelCost) || 0;
                const secQtyVal =
                  unit.fuelMode === 'dual' ? Number(unit.secondaryFuelQty) || 0 : 0;
                const secCostVal =
                  unit.fuelMode === 'dual' ? Number(unit.secondaryFuelCost) || 0 : 0;
                const totalUnitFuelCost = fCostVal + secCostVal;
                const unitCostPerKwh =
                  kwhVal > 0 && totalUnitFuelCost > 0
                    ? totalUnitFuelCost / kwhVal
                    : null;
                const unitYield =
                  unit.fuelMode !== 'dual' && fQtyVal > 0 && kwhVal > 0
                    ? kwhVal / fQtyVal
                    : null;
                const pMode: SingleDeviceFuelMode =
                  unit.fuelMode === 'dual'
                    ? normalizeSingleFuelMode(unit.primaryFuelMode, unit.fuelUnit)
                    : unit.fuelMode;
                const sMode: SingleDeviceFuelMode =
                  unit.fuelMode === 'dual'
                    ? normalizeSingleFuelMode(unit.secondaryFuelMode, unit.secondaryFuelUnit)
                    : 'diesel';
                const primaryFuelLabel = getFuelLabel(pMode, unit.fuelUnit);
                const secondaryFuelLabel = getFuelLabel(sMode, unit.secondaryFuelUnit);

                return (
                  <div
                    key={unit.deviceId || `gen-${idx}`}
                    className="p-4 sm:p-5 space-y-3.5 hover:bg-slate-50/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            unit.fuelMode === 'gas'
                              ? 'bg-teal-600'
                              : unit.fuelMode === 'cng'
                              ? 'bg-sky-600'
                              : unit.fuelMode === 'lng'
                              ? 'bg-cyan-600'
                              : unit.fuelMode === 'lpg'
                              ? 'bg-orange-500'
                              : unit.fuelMode === 'sng'
                              ? 'bg-violet-600'
                              : unit.fuelMode === 'dual'
                              ? 'bg-indigo-600'
                              : 'bg-amber-500'
                          }`}
                        />
                        <span className="text-sm font-semibold text-slate-900">
                          {unit.deviceName}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          · {formatDeviceFuelBadge(unit)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-medium tabular-nums">
                        {!unitCostUnlocked &&
                          renderInlineRateBadge(unit.fuelUnitCost, unit.fuelUnit)}
                        {(unitCostPerKwh !== null ||
                          unitYield !== null ||
                          totalUnitFuelCost > 0) && (
                          <span>
                            {unitYield !== null &&
                              `${formatNumber(unitYield, 2)} kWh/${unit.fuelUnit}`}
                            {unitYield !== null && unitCostPerKwh !== null && ' · '}
                            {unitCostPerKwh !== null &&
                              `৳${formatNumber(unitCostPerKwh, 2)}/kWh`}
                            {unit.fuelMode === 'dual' && totalUnitFuelCost > 0 && (
                              <span className="ml-2 text-slate-900 font-semibold">
                                Combined Fuel: {formatCurrency(totalUnitFuelCost)}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      className={`grid grid-cols-1 gap-3.5 ${
                        unitCostUnlocked
                          ? 'sm:grid-cols-2 lg:grid-cols-4'
                          : 'sm:grid-cols-3'
                      }`}
                    >
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Power Generated (kWh)
                        </label>
                        <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={unit.kwh}
                            onChange={(e) =>
                              handleGenUnitChange(idx, 'kwh', e.target.value)
                            }
                            placeholder="0"
                            aria-label={`${unit.deviceName} output kWh`}
                            className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                          />
                          <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            kWh
                          </span>
                        </div>
                      </div>

                      {unitCostUnlocked && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            {unit.fuelMode === 'dual'
                              ? `${primaryFuelLabel} Rate`
                              : 'Fuel Rate'}{' '}
                            (৳/{unit.fuelUnit})
                          </label>
                          {renderEditableRateInput(
                            unit.fuelUnitCost,
                            (v) => handleGenUnitChange(idx, 'fuelUnitCost', v),
                            unit.fuelUnit,
                            `${unit.deviceName} ${primaryFuelLabel} rate`
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          {unit.fuelMode === 'dual'
                            ? `${primaryFuelLabel} Used (${unit.fuelUnit})`
                            : `Fuel Used (${unit.fuelUnit})`}
                        </label>
                        <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={unit.fuelQty}
                            onChange={(e) =>
                              handleGenUnitChange(idx, 'fuelQty', e.target.value)
                            }
                            placeholder="0"
                            aria-label={`${unit.deviceName} ${primaryFuelLabel} quantity`}
                            className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                          />
                          <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            {unit.fuelUnit}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          {unit.fuelMode === 'dual'
                            ? `${primaryFuelLabel} Cost (৳)`
                            : 'Fuel Cost (৳)'}
                        </label>
                        <div
                          className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                            !unitCostUnlocked
                              ? 'border-slate-200 bg-slate-50'
                              : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
                          }`}
                        >
                          <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            ৳
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            readOnly={!unitCostUnlocked}
                            tabIndex={!unitCostUnlocked ? -1 : undefined}
                            value={unit.fuelCost}
                            onChange={(e) =>
                              handleGenUnitChange(idx, 'fuelCost', e.target.value)
                            }
                            placeholder="0.00"
                            aria-label={`${unit.deviceName} ${primaryFuelLabel} cost`}
                            className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                              !unitCostUnlocked
                                ? 'text-teal-800 bg-transparent cursor-not-allowed'
                                : 'text-slate-900 bg-transparent'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {unit.fuelMode === 'dual' && (
                      <div className="pt-2 border-t border-dashed border-slate-200 space-y-2.5">
                        {!unitCostUnlocked && (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="font-medium">
                              Secondary Fuel · {secondaryFuelLabel} ({unit.secondaryFuelUnit})
                              {secQtyVal > 0 && kwhVal > 0 && (
                                <span className="ml-1.5 text-slate-400">
                                  ({formatNumber(kwhVal / secQtyVal, 2)} kWh/
                                  {unit.secondaryFuelUnit})
                                </span>
                              )}
                            </span>
                            {renderInlineRateBadge(
                              unit.secondaryFuelUnitCost,
                              unit.secondaryFuelUnit
                            )}
                          </div>
                        )}

                        <div
                          className={`grid grid-cols-1 gap-3.5 ${
                            unitCostUnlocked
                              ? 'sm:grid-cols-2 lg:grid-cols-4'
                              : 'sm:grid-cols-2'
                          }`}
                        >
                          {unitCostUnlocked && (
                            <>
                              <div className="hidden lg:flex items-center text-xs font-medium text-slate-500">
                                Secondary Fuel · {secondaryFuelLabel} ({unit.secondaryFuelUnit})
                                {secQtyVal > 0 && kwhVal > 0 && (
                                  <span className="ml-1.5 text-slate-400">
                                    ({formatNumber(kwhVal / secQtyVal, 2)} kWh/
                                    {unit.secondaryFuelUnit})
                                  </span>
                                )}
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                  {secondaryFuelLabel} Rate (৳/{unit.secondaryFuelUnit})
                                </label>
                                {renderEditableRateInput(
                                  unit.secondaryFuelUnitCost,
                                  (v) =>
                                    handleGenUnitChange(
                                      idx,
                                      'secondaryFuelUnitCost',
                                      v
                                    ),
                                  unit.secondaryFuelUnit,
                                  `${unit.deviceName} ${secondaryFuelLabel} rate`
                                )}
                              </div>
                            </>
                          )}

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              {secondaryFuelLabel} Used ({unit.secondaryFuelUnit})
                            </label>
                            <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={unit.secondaryFuelQty}
                                onChange={(e) =>
                                  handleGenUnitChange(
                                    idx,
                                    'secondaryFuelQty',
                                    e.target.value
                                  )
                                }
                                placeholder="0"
                                aria-label={`${unit.deviceName} ${secondaryFuelLabel} quantity`}
                                className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                              />
                              <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                                {unit.secondaryFuelUnit}
                              </span>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              {secondaryFuelLabel} Cost (৳)
                            </label>
                            <div
                              className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                                !unitCostUnlocked
                                  ? 'border-slate-200 bg-slate-50'
                                  : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
                              }`}
                            >
                              <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                                ৳
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                readOnly={!unitCostUnlocked}
                                tabIndex={!unitCostUnlocked ? -1 : undefined}
                                value={unit.secondaryFuelCost}
                                onChange={(e) =>
                                  handleGenUnitChange(
                                    idx,
                                    'secondaryFuelCost',
                                    e.target.value
                                  )
                                }
                                placeholder="0.00"
                                aria-label={`${unit.deviceName} ${secondaryFuelLabel} cost`}
                                className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                                  !unitCostUnlocked
                                    ? 'text-teal-800 bg-transparent cursor-not-allowed'
                                    : 'text-slate-900 bg-transparent'
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: SOLAR GENERATION — EDITABLE TARIFF RATE & ADDITIVE SAVINGS */}
        {plantSetup.solars.length > 0 && (
          <div>
            <div className="px-4 sm:px-6 py-3 bg-emerald-50/50 border-b border-emerald-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 font-bold text-emerald-950 text-sm">
                <Sun className="w-4 h-4 text-amber-500" />
                3. Solar Power ({plantSetup.solars.length})
              </span>
              <span className="text-emerald-800 font-semibold tabular-nums">
                {genLiveMetrics.combinedSolarKwh > 0
                  ? `Combined: ${formatNumber(
                      genLiveMetrics.combinedSolarKwh
                    )} kWh · Total Saved: ${formatCurrency(
                      genLiveMetrics.combinedSolarSavings
                    )}`
                  : 'Tracks solar yield and cost savings (never added to spend)'}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {genDraft.solarUnits.map((solar, idx) => (
                <div
                  key={solar.deviceId || `solar-${idx}`}
                  className="p-4 sm:p-5 space-y-3 hover:bg-emerald-50/20 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 shrink-0" />
                      <span className="text-sm font-semibold text-slate-900">
                        {solar.deviceName}
                      </span>
                      <span className="text-xs text-slate-500">
                        · Zero fuel (Clean Energy)
                      </span>
                    </div>
                    {!unitCostUnlocked &&
                      renderInlineRateBadge(
                        solar.unitCost,
                        'kWh',
                        activeElectricityRate > 0
                          ? `Ref: ৳ ${formatCalcValue(activeElectricityRate, 2)}/kWh`
                          : 'Rate not set'
                      )}
                  </div>

                  <div
                    className={`grid grid-cols-1 gap-3.5 ${
                      unitCostUnlocked ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                    }`}
                  >
                    {unitCostUnlocked && (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Solar Tariff Rate (Editable)
                        </label>
                        {renderEditableRateInput(
                          solar.unitCost,
                          (v) => handleSolarUnitChange(idx, 'unitCost', v),
                          'kWh',
                          `${solar.deviceName} tariff rate`,
                          activeElectricityRate > 0
                            ? `Ref ${formatCalcValue(activeElectricityRate, 2)}`
                            : undefined
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Solar Generation (kWh)
                      </label>
                      <div className="flex items-stretch h-10 rounded-lg border border-emerald-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-emerald-600/20">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={solar.kwh}
                          onChange={(e) =>
                            handleSolarUnitChange(idx, 'kwh', e.target.value)
                          }
                          placeholder="0"
                          aria-label={`${solar.deviceName} kWh`}
                          className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                        />
                        <span className="px-2.5 bg-emerald-50 border-l border-emerald-200 text-xs text-emerald-800 flex items-center shrink-0">
                          kWh
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Estimated Savings (৳)
                      </label>
                      <div
                        className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                          !unitCostUnlocked
                            ? 'border-emerald-200 bg-emerald-50/60'
                            : 'border-emerald-300 bg-white focus-within:ring-2 focus-within:ring-emerald-600/20'
                        }`}
                      >
                        <span
                          className="px-2.5 bg-emerald-50 border-r border-emerald-200 text-xs text-emerald-800 flex items-center shrink-0"
                          title="Money Saved by Solar (Additive)"
                        >
                          Saved ৳
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          readOnly={!unitCostUnlocked}
                          tabIndex={!unitCostUnlocked ? -1 : undefined}
                          value={solar.savings}
                          onChange={(e) =>
                            handleSolarUnitChange(idx, 'savings', e.target.value)
                          }
                          placeholder="0.00"
                          aria-label={`${solar.deviceName} savings BDT`}
                          className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                            !unitCostUnlocked
                              ? 'text-emerald-800 bg-transparent cursor-not-allowed'
                              : 'text-slate-900 bg-transparent'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: NAMED BOILERS — STEAM PRODUCTION & ADMIN-ASSIGNED FUEL(S) */}
        {plantSetup.boilers.length > 0 && (
          <div>
            <div className="px-4 sm:px-6 py-3 bg-orange-50/40 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-2 font-bold text-slate-900 text-sm">
                <Flame className="w-4 h-4 text-orange-600" />
                4. Boilers ({genDraft.boilers.length}) — Steam &amp; Fuel
              </span>
              {(genLiveMetrics.combinedSteamKg > 0 ||
                genLiveMetrics.combinedBoilerFuelCost > 0) && (
                <span className="font-semibold text-orange-800 tabular-nums">
                  Combined Steam: {formatNumber(genLiveMetrics.combinedSteamKg)} kg
                  {genLiveMetrics.combinedBoilerFuelCost > 0 &&
                    ` · Fuel Cost: ${formatCurrency(
                      genLiveMetrics.combinedBoilerFuelCost
                    )}`}
                  {genLiveMetrics.costPerKgSteam !== null &&
                    ` · Avg ৳ ${formatNumber(genLiveMetrics.costPerKgSteam, 2)}/kg`}
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {genDraft.boilers.map((boiler, idx) => {
                const steamVal = Number(boiler.steamKg) || 0;
                const fQtyVal = Number(boiler.fuelQty) || 0;
                const fCostVal = Number(boiler.fuelCost) || 0;
                const secCostVal =
                  boiler.fuelMode === 'dual' ? Number(boiler.secondaryFuelCost) || 0 : 0;
                const totalBoilerFuelCost = fCostVal + secCostVal;
                const costPerKg =
                  steamVal > 0 && totalBoilerFuelCost > 0
                    ? totalBoilerFuelCost / steamVal
                    : null;
                const yieldPerFuel =
                  boiler.fuelMode !== 'dual' && fQtyVal > 0 && steamVal > 0
                    ? steamVal / fQtyVal
                    : null;
                const pMode: SingleDeviceFuelMode =
                  boiler.fuelMode === 'dual'
                    ? normalizeSingleFuelMode(boiler.primaryFuelMode, boiler.fuelUnit)
                    : boiler.fuelMode;
                const sMode: SingleDeviceFuelMode =
                  boiler.fuelMode === 'dual'
                    ? normalizeSingleFuelMode(
                        boiler.secondaryFuelMode,
                        boiler.secondaryFuelUnit
                      )
                    : 'diesel';
                const primaryFuelLabel = getFuelLabel(pMode, boiler.fuelUnit);
                const secondaryFuelLabel = getFuelLabel(sMode, boiler.secondaryFuelUnit);

                return (
                  <div
                    key={boiler.deviceId || `boiler-${idx}`}
                    className="p-4 sm:p-5 space-y-3.5 hover:bg-slate-50/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            boiler.fuelMode === 'diesel'
                              ? 'bg-amber-600'
                              : boiler.fuelMode === 'cng'
                              ? 'bg-sky-600'
                              : boiler.fuelMode === 'lng'
                              ? 'bg-cyan-600'
                              : boiler.fuelMode === 'lpg'
                              ? 'bg-orange-600'
                              : boiler.fuelMode === 'sng'
                              ? 'bg-violet-600'
                              : boiler.fuelMode === 'dual'
                              ? 'bg-purple-600'
                              : boiler.fuelMode === 'solid'
                              ? 'bg-stone-500'
                              : 'bg-orange-500'
                          }`}
                        />
                        <span className="text-sm font-semibold text-slate-900">
                          {boiler.deviceName}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          · {formatDeviceFuelBadge(boiler)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-orange-800 font-medium tabular-nums">
                        {!unitCostUnlocked &&
                          renderInlineRateBadge(boiler.fuelUnitCost, boiler.fuelUnit)}
                        {(yieldPerFuel !== null ||
                          costPerKg !== null ||
                          totalBoilerFuelCost > 0) && (
                          <span>
                            {yieldPerFuel !== null &&
                              `${formatNumber(yieldPerFuel, 2)} kg/${boiler.fuelUnit}`}
                            {yieldPerFuel !== null && costPerKg !== null && ' · '}
                            {costPerKg !== null && `৳${formatNumber(costPerKg, 2)}/kg`}
                            {boiler.fuelMode === 'dual' && totalBoilerFuelCost > 0 && (
                              <span className="ml-2 text-slate-900 font-semibold">
                                Combined Fuel: {formatCurrency(totalBoilerFuelCost)}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      className={`grid grid-cols-1 gap-3.5 ${
                        unitCostUnlocked
                          ? 'sm:grid-cols-2 lg:grid-cols-4'
                          : 'sm:grid-cols-3'
                      }`}
                    >
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          Steam Produced (kg)
                        </label>
                        <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={boiler.steamKg}
                            onChange={(e) =>
                              handleBoilerUnitChange(idx, 'steamKg', e.target.value)
                            }
                            placeholder="0"
                            aria-label={`${boiler.deviceName} steam kg`}
                            className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                          />
                          <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            kg
                          </span>
                        </div>
                      </div>

                      {unitCostUnlocked && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            {boiler.fuelMode === 'dual'
                              ? `${primaryFuelLabel} Rate`
                              : 'Fuel Rate'}{' '}
                            (৳/{boiler.fuelUnit})
                          </label>
                          {renderEditableRateInput(
                            boiler.fuelUnitCost,
                            (v) => handleBoilerUnitChange(idx, 'fuelUnitCost', v),
                            boiler.fuelUnit,
                            `${boiler.deviceName} ${primaryFuelLabel} rate`
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          {boiler.fuelMode === 'dual'
                            ? `${primaryFuelLabel} Used (${boiler.fuelUnit})`
                            : `Fuel Used (${boiler.fuelUnit})`}
                        </label>
                        <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={boiler.fuelQty}
                            onChange={(e) =>
                              handleBoilerUnitChange(idx, 'fuelQty', e.target.value)
                            }
                            placeholder="0"
                            aria-label={`${boiler.deviceName} ${primaryFuelLabel} quantity`}
                            className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                          />
                          <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            {boiler.fuelUnit}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 mb-1">
                          {boiler.fuelMode === 'dual'
                            ? `${primaryFuelLabel} Cost (৳)`
                            : 'Fuel Cost (৳)'}
                        </label>
                        <div
                          className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                            !unitCostUnlocked
                              ? 'border-slate-200 bg-slate-50'
                              : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
                          }`}
                        >
                          <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                            ৳
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            readOnly={!unitCostUnlocked}
                            tabIndex={!unitCostUnlocked ? -1 : undefined}
                            value={boiler.fuelCost}
                            onChange={(e) =>
                              handleBoilerUnitChange(idx, 'fuelCost', e.target.value)
                            }
                            placeholder="0.00"
                            aria-label={`${boiler.deviceName} ${primaryFuelLabel} cost`}
                            className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                              !unitCostUnlocked
                                ? 'text-teal-800 bg-transparent cursor-not-allowed'
                                : 'text-slate-900 bg-transparent'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {boiler.fuelMode === 'dual' && (
                      <div className="pt-2 border-t border-dashed border-slate-200 space-y-2.5">
                        {!unitCostUnlocked && (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="font-medium">
                              Secondary Fuel · {secondaryFuelLabel} ({boiler.secondaryFuelUnit})
                            </span>
                            {renderInlineRateBadge(
                              boiler.secondaryFuelUnitCost,
                              boiler.secondaryFuelUnit
                            )}
                          </div>
                        )}

                        <div
                          className={`grid grid-cols-1 gap-3.5 ${
                            unitCostUnlocked
                              ? 'sm:grid-cols-2 lg:grid-cols-4'
                              : 'sm:grid-cols-2'
                          }`}
                        >
                          {unitCostUnlocked && (
                            <>
                              <div className="hidden lg:flex items-center text-xs font-medium text-slate-500">
                                Secondary Fuel · {secondaryFuelLabel} ({boiler.secondaryFuelUnit})
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                  {secondaryFuelLabel} Rate (৳/{boiler.secondaryFuelUnit})
                                </label>
                                {renderEditableRateInput(
                                  boiler.secondaryFuelUnitCost,
                                  (v) =>
                                    handleBoilerUnitChange(
                                      idx,
                                      'secondaryFuelUnitCost',
                                      v
                                    ),
                                  boiler.secondaryFuelUnit,
                                  `${boiler.deviceName} ${secondaryFuelLabel} rate`
                                )}
                              </div>
                            </>
                          )}

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              {secondaryFuelLabel} Used ({boiler.secondaryFuelUnit})
                            </label>
                            <div className="flex items-stretch h-10 rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-teal-600/20">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={boiler.secondaryFuelQty}
                                onChange={(e) =>
                                  handleBoilerUnitChange(
                                    idx,
                                    'secondaryFuelQty',
                                    e.target.value
                                  )
                                }
                                placeholder="0"
                                aria-label={`${boiler.deviceName} ${secondaryFuelLabel} quantity`}
                                className="w-full min-w-0 px-3 text-sm text-right font-mono-num tabular-nums bg-transparent focus:outline-none"
                              />
                              <span className="px-2.5 bg-slate-50 border-l border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                                {boiler.secondaryFuelUnit}
                              </span>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              {secondaryFuelLabel} Cost (৳)
                            </label>
                            <div
                              className={`flex items-stretch h-10 rounded-lg border overflow-hidden ${
                                !unitCostUnlocked
                                  ? 'border-slate-200 bg-slate-50'
                                  : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-teal-600/20'
                              }`}
                            >
                              <span className="px-2.5 bg-slate-100/80 border-r border-slate-200 text-xs text-slate-500 flex items-center shrink-0">
                                ৳
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                readOnly={!unitCostUnlocked}
                                tabIndex={!unitCostUnlocked ? -1 : undefined}
                                value={boiler.secondaryFuelCost}
                                onChange={(e) =>
                                  handleBoilerUnitChange(
                                    idx,
                                    'secondaryFuelCost',
                                    e.target.value
                                  )
                                }
                                placeholder="0.00"
                                aria-label={`${boiler.deviceName} ${secondaryFuelLabel} cost`}
                                className={`w-full min-w-0 px-2.5 text-sm text-right font-mono-num tabular-nums font-semibold focus:outline-none ${
                                  !unitCostUnlocked
                                    ? 'text-teal-800 bg-transparent cursor-not-allowed'
                                    : 'text-slate-900 bg-transparent'
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 5: OTHER ALLOWED UTILITIES (GAS, WATER, ETC.) */}
        {otherUtilities.length > 0 && (
          <div>
            <div className="px-4 sm:px-6 py-3 bg-slate-50/80 border-b border-slate-200 text-sm font-bold text-slate-900">
              5. Other Plant Utilities
            </div>
            <div className="divide-y divide-slate-100">
              {otherUtilities.map((util) => renderStandardUtilityRow(util))}
            </div>
          </div>
        )}

        {/* STEP 6: SINGLE DAILY NOTE & SAVE */}
        <div className="px-4 sm:px-5 py-3.5 bg-white border-b border-slate-200">
          <input
            type="text"
            maxLength={300}
            value={genDraft.note}
            onChange={(e) => {
              setFeedback(null);
              setGenDirty(true);
              setGenDraft((prev) => ({ ...prev, note: e.target.value }));
            }}
            placeholder="Optional daily note (e.g. maintenance, outage, shift remark)..."
            aria-label="Daily note"
            className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
          />
        </div>

        <div className="px-4 sm:px-5 py-4 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            {feedback && (
              <div
                className={`inline-flex items-center gap-2 text-sm font-medium ${
                  feedback.type === 'success' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {profile?.role === 'admin' &&
              sheetsConfig &&
              sheetsConfig.syncMode !== 'appsScript' && (
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={promptSyncAfterSave}
                    onChange={(e) => setPromptSyncAfterSave(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                  />
                  <span>Sync prompt</span>
                </label>
              )}

            {profile?.role === 'admin' && sheetsConfig && (
              <button
                type="button"
                disabled={syncingSheets}
                onClick={() => void handleOpenSyncSheets()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                {syncingSheets ? 'Syncing...' : 'Sync Sheets'}
              </button>
            )}

            {hasUnsavedChanges && (
              <button
                type="button"
                disabled={saving}
                onClick={handleResetForm}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving
                ? 'Saving...'
                : isEditingExisting
                ? 'Update Daily Log'
                : 'Save Daily Log'}
            </button>
          </div>
        </div>
      </form>

      {/* Clean Monthly Entries History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              {formatMonthTitle(selectedMonth)} — Logged Days (
              {formatNumber(monthlyGroupedDates.length, 0)})
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="recent-company-filter" className="text-xs text-slate-600">
              Factory:
            </label>
            <select
              id="recent-company-filter"
              value={logFactoryFilter}
              onChange={(e) => setLogFactoryFilter(e.target.value)}
              className="px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="SELECTED">{selectedCompany} Only</option>
              {allowedCompanies.length > 1 && (
                <option value="ALL">All Assigned Factories</option>
              )}
              {allowedCompanies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {monthlyGroupedDates.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No entries logged for {formatMonthTitle(selectedMonth)} yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {monthlyGroupedDates.map((group) => (
              <div key={group.date}>
                <div className="px-4 sm:px-5 py-2.5 bg-slate-50 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatDate(group.date)}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {formatNumber(group.items.length, 0)}{' '}
                      {group.items.length === 1 ? 'utility' : 'utilities'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-teal-800 tabular-nums">
                      {formatCurrency(group.totalCost)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(group.date);
                        const comp =
                          group.items[0]?.company || group.generations[0]?.company;
                        if (comp) setSelectedCompany(comp);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Day
                    </button>
                  </div>
                </div>

                {group.items.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                          <th className="py-2 px-4 sm:px-5">Factory</th>
                          <th className="py-2 px-4">Utility</th>
                          <th className="py-2 px-4 text-right">Usage</th>
                          <th className="py-2 px-4 text-right">Unit Rate</th>
                          <th className="py-2 px-4 text-right">Cost</th>
                          <th className="py-2 px-4 sm:px-5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {group.items.map((entry) => {
                          const matchedUtil = utilities.find(
                            (u) => u.id === entry.utilityId
                          );
                          const unitLabel = matchedUtil?.unit || entry.unit;
                          const unitCost =
                            entry.consumption > 0
                              ? entry.cost / entry.consumption
                              : null;

                          return (
                            <tr key={entry.id} className="hover:bg-slate-50/70">
                              <td className="py-2 px-4 sm:px-5 font-medium text-slate-900 whitespace-nowrap">
                                {entry.company}
                              </td>
                              <td className="py-2 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-2 text-slate-800">
                                  <span
                                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                                    style={{
                                      backgroundColor: matchedUtil?.color || '#64748B',
                                    }}
                                  />
                                  {matchedUtil?.name || entry.utilityName}
                                </span>
                              </td>
                              <td className="py-2 px-4 text-right tabular-nums text-slate-800 whitespace-nowrap">
                                {formatNumber(entry.consumption)} {unitLabel}
                              </td>
                              <td className="py-2 px-4 text-right tabular-nums text-teal-800 font-medium whitespace-nowrap">
                                {unitCost !== null
                                  ? `৳ ${formatNumber(unitCost, 2)}/${unitLabel}`
                                  : '—'}
                              </td>
                              <td className="py-2 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                                {formatCurrency(entry.cost)}
                              </td>
                              <td className="py-2 px-4 sm:px-5 text-right whitespace-nowrap">
                                {confirmDeleteId === entry.id ? (
                                  <div className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={deletingId === entry.id}
                                      onClick={() => void handleDeleteEntry(entry.id)}
                                      className="px-2 py-0.5 text-xs font-medium bg-rose-600 text-white rounded hover:bg-rose-700 cursor-pointer"
                                    >
                                      {deletingId === entry.id
                                        ? 'Deleting...'
                                        : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-xs text-slate-600 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(entry.id)}
                                    title="Delete entry"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {group.generations.length > 0 && (
                  <div className="px-4 sm:px-5 py-2.5 bg-slate-50/50 border-t border-slate-100 space-y-1.5">
                    {group.generations.map((gen) => {
                      const steamRate =
                        gen.steamKg > 0 && gen.boilerFuelCost > 0
                          ? gen.boilerFuelCost / gen.steamKg
                          : null;
                      const genFuelTotalCost = gen.generatorFuelCost || 0;
                      const gridRows = parseGridBreakdownJson(
                        gen.gridProviderBreakdown
                      );
                      const parsedHistoryUnits = parseUnitReadingsJson(gen.unitReadings);
                      const histGenerators =
                        parsedHistoryUnits.generatorUnits &&
                        parsedHistoryUnits.generatorUnits.length > 0
                          ? parsedHistoryUnits.generatorUnits
                          : [
                              ...(parsedHistoryUnits.dieselGenUnits || []),
                              ...(parsedHistoryUnits.gasGenUnits || []),
                            ];
                      const histBoilers = parsedHistoryUnits.boilerUnits || [];

                      return (
                        <div
                          key={gen.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 bg-white border border-slate-200/80 rounded-lg px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                            <span className="font-semibold text-slate-900">
                              {gen.company}:
                            </span>
                            {gridRows.length > 0 && (
                              <span className="text-blue-800">
                                Grid (
                                {gridRows
                                  .map((r) => {
                                    const t =
                                      r.tariff === 'peak'
                                        ? ' Peak'
                                        : r.tariff === 'offPeak'
                                        ? ' Off-Peak'
                                        : '';
                                    return `${r.provider}${t}: ${formatNumber(r.kwh)} kWh`;
                                  })
                                  .join(' · ')}
                                )
                              </span>
                            )}
                            {histGenerators.length > 0 ? (
                              histGenerators.map((g, gIdx) => {
                                const gCost = getGenReadingTotalCost(g);
                                if ((g.kwh || 0) <= 0 && gCost <= 0) return null;
                                return (
                                  <span key={`hist-gen-${gIdx}`}>
                                    {g.deviceName || `Gen #${gIdx + 1}`}:{' '}
                                    <strong>{formatNumber(g.kwh)} kWh</strong>
                                    {gCost > 0 && ` (${formatCurrency(gCost)})`}
                                  </span>
                                );
                              })
                            ) : (
                              (gen.generatorCount > 0 || gen.generatorKwh > 0) && (
                                <span>
                                  Gen: <strong>{formatNumber(gen.generatorKwh)} kWh</strong>
                                  {genFuelTotalCost > 0 &&
                                    ` (${formatCurrency(genFuelTotalCost)})`}
                                </span>
                              )
                            )}
                            {(gen.solarKwh > 0 || gen.solarSystemCount > 0) && (
                              <span className="text-emerald-700">
                                Solar: <strong>{formatNumber(gen.solarKwh)} kWh</strong>
                                {gen.solarSavings > 0 &&
                                  ` (Saved ${formatCurrency(gen.solarSavings)})`}
                              </span>
                            )}
                            {histBoilers.length > 0 ? (
                              histBoilers.map((b, bIdx) => {
                                const bCost = getBoilerReadingTotalCost(b);
                                if ((b.steamKg || 0) <= 0 && bCost <= 0) return null;
                                return (
                                  <span key={`hist-boiler-${bIdx}`}>
                                    {b.deviceName || `Boiler #${bIdx + 1}`}:{' '}
                                    <strong>{formatNumber(b.steamKg)} kg</strong>
                                    {bCost > 0 && ` (${formatCurrency(bCost)})`}
                                  </span>
                                );
                              })
                            ) : (
                              (gen.boilerCount > 0 || gen.steamKg > 0 || gen.boilerFuelCost > 0) && (
                                <span>
                                  Steam: <strong>{formatNumber(gen.steamKg)} kg</strong>
                                  {gen.boilerFuelCost > 0 &&
                                    ` (${formatCurrency(gen.boilerFuelCost)})`}
                                  {steamRate !== null &&
                                    ` · ৳${formatNumber(steamRate, 2)}/kg`}
                                </span>
                              )
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {confirmDeleteGenId === gen.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={genDeleting}
                                  onClick={() => void handleDeleteGeneration(gen.id)}
                                  className="px-2 py-0.5 bg-rose-600 text-white rounded font-medium cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteGenId(null)}
                                  className="text-slate-500 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteGenId(gen.id)}
                                className="inline-flex items-center gap-1 font-medium text-rose-700 hover:underline cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Password Verification Modal for Unlocking Locked Unit Rates */}
      {unlockModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unlock-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
                  <KeyRound className="w-4 h-4 text-teal-700" />
                </div>
                <div>
                  <h3
                    id="unlock-modal-title"
                    className="text-base font-bold text-slate-900"
                  >
                    Unlock Unit Rates
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[260px]">
                    {user?.email || 'Current user'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={unlockBusy}
                onClick={() => setUnlockModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {hasPasswordProvider(user) ? (
              <form onSubmit={handleVerifyPasswordUnlock} className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enter your account password to unlock and update fixed Unit Rates for{' '}
                  <strong>{selectedCompany}</strong>.
                </p>

                <div>
                  <label
                    htmlFor="unlock-unit-password"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="unlock-unit-password"
                      type={showUnlockPassword ? 'text' : 'password'}
                      autoFocus
                      value={unlockPassword}
                      onChange={(e) => {
                        setUnlockPassword(e.target.value);
                        setUnlockError(null);
                      }}
                      placeholder="Enter your password"
                      className="w-full h-10 pl-3.5 pr-10 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowUnlockPassword((prev) => !prev)}
                      aria-label={
                        showUnlockPassword ? 'Hide password' : 'Show password'
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showUnlockPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {unlockError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{unlockError}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  {hasGoogleProvider(user) ? (
                    <button
                      type="button"
                      disabled={unlockBusy}
                      onClick={() => void handleVerifyGoogleUnlock()}
                      className="text-xs font-medium text-teal-700 hover:underline cursor-pointer"
                    >
                      Verify via Google instead
                    </button>
                  ) : (
                    <span />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={unlockBusy}
                      onClick={() => setUnlockModalOpen(false)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={unlockBusy}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      {unlockBusy ? 'Verifying...' : 'Unlock'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Re-authenticate with your Google account to unlock and update Unit Rates.
                </p>

                {unlockError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{unlockError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={unlockBusy}
                    onClick={() => setUnlockModalOpen(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={unlockBusy}
                    onClick={() => void handleVerifyGoogleUnlock()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    {unlockBusy ? 'Verifying...' : 'Verify with Google'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {profile?.role === 'admin' && sheetsConfig && (
        <GoogleSheetsSyncModal
          open={syncModalOpen}
          spreadsheetTitle={sheetsConfig.spreadsheetTitle}
          sheetName={sheetsConfig.sheetName}
          recordCount={entries.length}
          syncing={syncingSheets}
          onConfirm={() => void handleConfirmSyncSheets()}
          onCancel={() => setSyncModalOpen(false)}
        />
      )}
    </div>
  );
}
