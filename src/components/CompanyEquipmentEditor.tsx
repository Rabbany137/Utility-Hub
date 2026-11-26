import React, { useEffect, useState } from 'react';
import { Flame, Plus, Save, Sun, Trash2, Zap } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  type CompanyItem,
  type DeviceFuelMode,
  GRID_PROVIDER_OPTIONS,
  type PlantDeviceConfig,
  type SingleDeviceFuelMode,
  type SolarDeviceConfig,
} from '../types';
import {
  BOILER_FUEL_MODES,
  GENERATOR_FUEL_MODES,
  SINGLE_FUEL_OPTIONS,
  createDeviceId,
  defaultUnitForFuelMode,
  formatDeviceFuelBadge,
  getFuelLabel,
  getUnitOptionsForFuelMode,
  isGasLikeFuelMode,
  normalizeSingleFuelMode,
  resolveCompanyDeviceConfigs,
} from '../utils/equipment';

interface CompanyEquipmentEditorProps {
  company: CompanyItem;
  canEdit?: boolean;
  onClose?: () => void;
  onSaved?: (message: string) => void;
  onError?: (message: string) => void;
}

interface EquipDraft {
  boilers: PlantDeviceConfig[];
  generators: PlantDeviceConfig[];
  solars: SolarDeviceConfig[];
  gridProviders: string[];
  gridHasPeakOffPeak: boolean;
}

function buildInitialDraft(company: CompanyItem): EquipDraft {
  const resolved = resolveCompanyDeviceConfigs(company);
  return {
    boilers: resolved.boilers.map((b) => ({ ...b })),
    generators: resolved.generators.map((g) => ({ ...g })),
    solars: resolved.solars.map((s) => ({ ...s })),
    gridProviders: Array.isArray(company.gridProviders)
      ? [...company.gridProviders]
      : [],
    gridHasPeakOffPeak: Boolean(company.gridHasPeakOffPeak),
  };
}

export function CompanyEquipmentEditor({
  company,
  canEdit = true,
  onClose,
  onSaved,
  onError,
}: CompanyEquipmentEditorProps) {
  const [equipDraft, setEquipDraft] = useState<EquipDraft>(() =>
    buildInitialDraft(company)
  );
  const [equipBusy, setEquipBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setEquipDraft(buildInitialDraft(company));
    setLocalError(null);
  }, [
    company.id,
    company.deviceConfigs,
    company.boilerCount,
    company.boilerFuelUnit,
    company.dieselGeneratorCount,
    company.gasGeneratorCount,
    company.solarCount,
    company.gridHasPeakOffPeak,
    company.equipmentConfigured,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (company.gridProviders || []).join('|||'),
  ]);

  const handleToggleGridProvider = (provider: string) => {
    if (!canEdit || equipBusy) return;
    setEquipDraft((prev) => {
      const exists = prev.gridProviders.includes(provider);
      const next = exists
        ? prev.gridProviders.filter((p) => p !== provider)
        : [...prev.gridProviders, provider].slice(0, 10);
      return { ...prev, gridProviders: next };
    });
  };

  const handleAddEquipDevice = (kind: 'boiler' | 'generator' | 'solar') => {
    if (!canEdit || equipBusy) return;
    setEquipDraft((prev) => {
      if (kind === 'boiler') {
        if (prev.boilers.length >= 50) return prev;
        const idx = prev.boilers.length + 1;
        return {
          ...prev,
          boilers: [
            ...prev.boilers,
            {
              id: createDeviceId('boiler'),
              name: `Boiler #${idx}`,
              fuelMode: 'gas',
              fuelUnit: 'm³',
            },
          ],
        };
      }
      if (kind === 'generator') {
        if (prev.generators.length >= 50) return prev;
        const idx = prev.generators.length + 1;
        return {
          ...prev,
          generators: [
            ...prev.generators,
            {
              id: createDeviceId('gen'),
              name: `Generator #${idx}`,
              fuelMode: 'diesel',
              fuelUnit: 'L',
            },
          ],
        };
      }
      if (prev.solars.length >= 50) return prev;
      const idx = prev.solars.length + 1;
      return {
        ...prev,
        solars: [
          ...prev.solars,
          {
            id: createDeviceId('solar'),
            name: idx === 1 ? 'Solar Power' : `Solar #${idx}`,
          },
        ],
      };
    });
  };

  const handleSaveEquipmentConfig = async () => {
    if (!canEdit) return;
    setLocalError(null);

    const cleanBoilers: PlantDeviceConfig[] = equipDraft.boilers
      .slice(0, 50)
      .map((b, idx) => {
        const fuelMode: DeviceFuelMode = b.fuelMode || 'gas';
        const fuelUnit = (b.fuelUnit.trim() || defaultUnitForFuelMode(fuelMode)).slice(
          0,
          20
        );
        const primaryFuelMode =
          fuelMode === 'dual'
            ? normalizeSingleFuelMode(b.primaryFuelMode, fuelUnit)
            : undefined;
        const secondaryFuelUnit =
          fuelMode === 'dual'
            ? (b.secondaryFuelUnit?.trim() || 'L').slice(0, 20)
            : undefined;
        const secondaryFuelMode =
          fuelMode === 'dual'
            ? normalizeSingleFuelMode(b.secondaryFuelMode, secondaryFuelUnit || 'L')
            : undefined;
        return {
          id: b.id.trim().slice(0, 64) || `boiler_${idx + 1}`,
          name: b.name.trim().slice(0, 80) || `Boiler #${idx + 1}`,
          fuelMode,
          fuelUnit,
          ...(primaryFuelMode ? { primaryFuelMode } : {}),
          ...(secondaryFuelMode ? { secondaryFuelMode } : {}),
          ...(secondaryFuelUnit ? { secondaryFuelUnit } : {}),
        };
      });

    const cleanGenerators: PlantDeviceConfig[] = equipDraft.generators
      .slice(0, 50)
      .map((g, idx) => {
        const fuelMode: DeviceFuelMode =
          g.fuelMode && g.fuelMode !== 'electric' ? g.fuelMode : 'diesel';
        const fuelUnit = (g.fuelUnit.trim() || defaultUnitForFuelMode(fuelMode)).slice(
          0,
          20
        );
        const primaryFuelMode =
          fuelMode === 'dual'
            ? normalizeSingleFuelMode(g.primaryFuelMode, fuelUnit)
            : undefined;
        const secondaryFuelUnit =
          fuelMode === 'dual'
            ? (g.secondaryFuelUnit?.trim() || 'L').slice(0, 20)
            : undefined;
        const secondaryFuelMode =
          fuelMode === 'dual'
            ? normalizeSingleFuelMode(g.secondaryFuelMode, secondaryFuelUnit || 'L')
            : undefined;
        return {
          id: g.id.trim().slice(0, 64) || `gen_${idx + 1}`,
          name: g.name.trim().slice(0, 80) || `Generator #${idx + 1}`,
          fuelMode,
          fuelUnit,
          ...(primaryFuelMode ? { primaryFuelMode } : {}),
          ...(secondaryFuelMode ? { secondaryFuelMode } : {}),
          ...(secondaryFuelUnit ? { secondaryFuelUnit } : {}),
        };
      });

    const cleanSolars: SolarDeviceConfig[] = equipDraft.solars
      .slice(0, 50)
      .map((s, idx) => ({
        id: s.id.trim().slice(0, 64) || `solar_${idx + 1}`,
        name: s.name.trim().slice(0, 80) || `Solar #${idx + 1}`,
      }));

    const deviceConfigsJson = JSON.stringify({
      boilers: cleanBoilers,
      generators: cleanGenerators,
      solars: cleanSolars,
    });

    if (deviceConfigsJson.length > 10000) {
      const msg =
        'Too many device configurations to save at once. Shorten device names or remove unused units.';
      setLocalError(msg);
      onError?.(msg);
      return;
    }

    const boilerCount = cleanBoilers.length;
    const uniqueBoilerUnits = Array.from(
      new Set(
        cleanBoilers.flatMap((b) =>
          b.fuelMode === 'dual'
            ? [b.fuelUnit, b.secondaryFuelUnit || 'L']
            : [b.fuelUnit]
        )
      )
    );
    const boilerFuelUnit =
      uniqueBoilerUnits.length === 1
        ? uniqueBoilerUnits[0].slice(0, 30)
        : uniqueBoilerUnits.length > 1
        ? 'Mixed'
        : 'm³';

    const dieselGeneratorCount = cleanGenerators.filter(
      (g) => g.fuelMode === 'diesel' || g.fuelMode === 'dual'
    ).length;
    const gasGeneratorCount = cleanGenerators.filter((g) =>
      isGasLikeFuelMode(g.fuelMode)
    ).length;
    const solarCount = cleanSolars.length;

    const gridProviders = Array.from(
      new Set(
        equipDraft.gridProviders.map((p) => p.trim().slice(0, 30)).filter(Boolean)
      )
    ).slice(0, 10);
    const gridHasPeakOffPeak = Boolean(equipDraft.gridHasPeakOffPeak);

    setEquipBusy(true);
    try {
      await updateDoc(doc(db, 'companies', company.id), {
        equipmentConfigured: true,
        boilerCount,
        boilerFuelUnit,
        dieselGeneratorCount,
        gasGeneratorCount,
        solarCount,
        gridProviders,
        gridHasPeakOffPeak,
        deviceConfigs: deviceConfigsJson,
      });
      onSaved?.(`Saved plant equipment & power sources for "${company.name}".`);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.UPDATE, `companies/${company.id}`);
      } catch (wrapped) {
        const msg =
          wrapped instanceof Error && wrapped.message.includes('Missing or insufficient permissions')
            ? `You do not have permission to edit equipment for "${company.name}".`
            : `Failed to save equipment configuration for "${company.name}".`;
        setLocalError(msg);
        onError?.(msg);
      }
    } finally {
      setEquipBusy(false);
    }
  };

  const disabled = !canEdit || equipBusy;

  return (
    <div className="mt-3 p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">
            Plant Equipment &amp; Fuel Assignment — {company.name}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {canEdit
              ? 'Name each boiler, generator, or solar unit and assign its exact fuel type & grid providers for this factory.'
              : 'Read-only view of configured equipment and grid providers for this factory.'}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Close
          </button>
        )}
      </div>

      {localError && (
        <div className="px-3.5 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-medium text-rose-800">
          {localError}
        </div>
      )}

      {/* Grid Providers */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-xs font-semibold text-slate-800">
            Grid Electricity Providers (PDB / DESCO / REB / DPDC...)
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {equipDraft.gridProviders.length > 0
              ? `Entry form will show: ${equipDraft.gridProviders.join(', ')} (combined automatically into Electricity).`
              : 'None checked — uses standard Electricity utility row if enabled.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {GRID_PROVIDER_OPTIONS.map((provider) => {
            const active = equipDraft.gridProviders.includes(provider);
            return (
              <label
                key={provider}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                  disabled ? 'cursor-default opacity-80' : 'cursor-pointer'
                } ${
                  active
                    ? 'bg-teal-50 border-teal-400 text-teal-900 font-semibold'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  disabled={disabled}
                  onChange={() => handleToggleGridProvider(provider)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>{provider}</span>
              </label>
            );
          })}
        </div>

        <div className="pt-2 border-t border-slate-100">
          <label
            className={`inline-flex items-start gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
              disabled ? 'cursor-default opacity-80' : 'cursor-pointer'
            } ${
              equipDraft.gridHasPeakOffPeak
                ? 'bg-blue-50 border-blue-300 text-blue-950 font-semibold'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <input
              type="checkbox"
              checked={equipDraft.gridHasPeakOffPeak}
              disabled={disabled}
              onChange={(e) =>
                setEquipDraft((prev) => ({
                  ...prev,
                  gridHasPeakOffPeak: e.target.checked,
                }))
              }
              className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <div>
              <div>Separate Peak &amp; Off-Peak Hour Tariff</div>
              <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                Check this if this factory pays different rates for Peak vs Off-Peak hours. Leave unchecked for a single flat Grid rate.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Named Boilers with Per-Unit Fuel Assignment */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-600" />
            <div>
              <div className="text-xs font-bold text-slate-900">
                Boilers ({equipDraft.boilers.length})
              </div>
              <div className="text-[11px] text-slate-500">
                Add each boiler separately (Natural Gas, CNG, LNG, LPG, SNG, Diesel, or Dual-Fuel).
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={disabled || equipDraft.boilers.length >= 50}
              onClick={() => handleAddEquipDevice('boiler')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Boiler
            </button>
          )}
        </div>

        {equipDraft.boilers.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-1">
            No boilers configured. Boiler section will be hidden from the entry form.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {equipDraft.boilers.map((boiler, idx) => (
              <div
                key={boiler.id}
                className="p-3 flex flex-col lg:flex-row lg:items-end gap-3"
              >
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Boiler #{idx + 1} Name
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={boiler.name}
                    disabled={disabled}
                    placeholder={`e.g. Gas Boiler #${idx + 1}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEquipDraft((prev) => ({
                        ...prev,
                        boilers: prev.boilers.map((item, i) =>
                          i === idx ? { ...item, name: val } : item
                        ),
                      }));
                    }}
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                  />
                </div>

                <div className="w-full lg:w-56">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Assigned Fuel Type
                  </label>
                  <select
                    value={boiler.fuelMode}
                    disabled={disabled}
                    onChange={(e) => {
                      const mode = e.target.value as DeviceFuelMode;
                      const found = BOILER_FUEL_MODES.find((m) => m.mode === mode);
                      setEquipDraft((prev) => ({
                        ...prev,
                        boilers: prev.boilers.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                fuelMode: mode,
                                fuelUnit: found?.defaultUnit || defaultUnitForFuelMode(mode),
                                primaryFuelMode:
                                  mode === 'dual' ? found?.primaryMode || 'gas' : undefined,
                                secondaryFuelMode:
                                  mode === 'dual'
                                    ? found?.secondaryMode || 'diesel'
                                    : undefined,
                                secondaryFuelUnit:
                                  mode === 'dual' ? found?.secondaryUnit || 'L' : undefined,
                              }
                            : item
                        ),
                      }));
                    }}
                    className="w-full h-9 px-2.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                  >
                    {BOILER_FUEL_MODES.map((m) => (
                      <option key={m.mode} value={m.mode}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                {getUnitOptionsForFuelMode(boiler.fuelMode).length > 0 && (
                  <div className="w-28">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {getFuelLabel(boiler.fuelMode)} Unit
                    </label>
                    <select
                      value={boiler.fuelUnit || defaultUnitForFuelMode(boiler.fuelMode)}
                      disabled={disabled}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEquipDraft((prev) => ({
                          ...prev,
                          boilers: prev.boilers.map((item, i) =>
                            i === idx ? { ...item, fuelUnit: val } : item
                          ),
                        }));
                      }}
                      className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                    >
                      {getUnitOptionsForFuelMode(boiler.fuelMode).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {boiler.fuelMode === 'dual' &&
                  (() => {
                    const pMode =
                      boiler.primaryFuelMode ||
                      normalizeSingleFuelMode(undefined, boiler.fuelUnit);
                    const sMode =
                      boiler.secondaryFuelMode ||
                      normalizeSingleFuelMode(undefined, boiler.secondaryFuelUnit || 'L');
                    const pUnits = getUnitOptionsForFuelMode(pMode);
                    const sUnits = getUnitOptionsForFuelMode(sMode);
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Fuel 1
                          </label>
                          <select
                            value={pMode}
                            disabled={disabled}
                            onChange={(e) => {
                              const nextMode = e.target.value as SingleDeviceFuelMode;
                              const opt = SINGLE_FUEL_OPTIONS.find(
                                (o) => o.mode === nextMode
                              );
                              setEquipDraft((prev) => ({
                                ...prev,
                                boilers: prev.boilers.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        primaryFuelMode: nextMode,
                                        fuelUnit:
                                          opt?.defaultUnit ||
                                          defaultUnitForFuelMode(nextMode),
                                      }
                                    : item
                                ),
                              }));
                            }}
                            className="h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                          >
                            {SINGLE_FUEL_OPTIONS.map((opt) => (
                              <option key={opt.mode} value={opt.mode}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {pUnits.length > 0 && (
                          <div className="w-20">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Unit 1
                            </label>
                            <select
                              value={boiler.fuelUnit || defaultUnitForFuelMode(pMode)}
                              disabled={disabled}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEquipDraft((prev) => ({
                                  ...prev,
                                  boilers: prev.boilers.map((item, i) =>
                                    i === idx ? { ...item, fuelUnit: val } : item
                                  ),
                                }));
                              }}
                              className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                            >
                              {pUnits.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Fuel 2
                          </label>
                          <select
                            value={sMode}
                            disabled={disabled}
                            onChange={(e) => {
                              const nextMode = e.target.value as SingleDeviceFuelMode;
                              const opt = SINGLE_FUEL_OPTIONS.find(
                                (o) => o.mode === nextMode
                              );
                              setEquipDraft((prev) => ({
                                ...prev,
                                boilers: prev.boilers.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        secondaryFuelMode: nextMode,
                                        secondaryFuelUnit:
                                          opt?.defaultUnit ||
                                          defaultUnitForFuelMode(nextMode),
                                      }
                                    : item
                                ),
                              }));
                            }}
                            className="h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                          >
                            {SINGLE_FUEL_OPTIONS.map((opt) => (
                              <option key={opt.mode} value={opt.mode}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {sUnits.length > 0 && (
                          <div className="w-20">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Unit 2
                            </label>
                            <select
                              value={
                                boiler.secondaryFuelUnit || defaultUnitForFuelMode(sMode)
                              }
                              disabled={disabled}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEquipDraft((prev) => ({
                                  ...prev,
                                  boilers: prev.boilers.map((item, i) =>
                                    i === idx ? { ...item, secondaryFuelUnit: val } : item
                                  ),
                                }));
                              }}
                              className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                            >
                              {sUnits.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                <div className="flex items-center justify-between lg:justify-end gap-2 pt-1 lg:pt-0">
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {formatDeviceFuelBadge(boiler)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setEquipDraft((prev) => ({
                          ...prev,
                          boilers: prev.boilers.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                      title="Remove boiler"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Named Generators with Per-Unit Fuel Assignment */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600" />
            <div>
              <div className="text-xs font-bold text-slate-900">
                Captive Generators ({equipDraft.generators.length})
              </div>
              <div className="text-[11px] text-slate-500">
                Assign custom names and fuel type (Diesel, Natural Gas, CNG, LNG, LPG, SNG, or Dual-Fuel) for each generator.
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={disabled || equipDraft.generators.length >= 50}
              onClick={() => handleAddEquipDevice('generator')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Generator
            </button>
          )}
        </div>

        {equipDraft.generators.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-1">
            No generators configured. Generator section will be hidden from the entry form.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {equipDraft.generators.map((gen, idx) => (
              <div
                key={gen.id}
                className="p-3 flex flex-col lg:flex-row lg:items-end gap-3"
              >
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Generator #{idx + 1} Name
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={gen.name}
                    disabled={disabled}
                    placeholder={`e.g. Caterpillar Gen #${idx + 1}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEquipDraft((prev) => ({
                        ...prev,
                        generators: prev.generators.map((item, i) =>
                          i === idx ? { ...item, name: val } : item
                        ),
                      }));
                    }}
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                  />
                </div>

                <div className="w-full lg:w-56">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Assigned Fuel Type
                  </label>
                  <select
                    value={gen.fuelMode}
                    disabled={disabled}
                    onChange={(e) => {
                      const mode = e.target.value as DeviceFuelMode;
                      const found = GENERATOR_FUEL_MODES.find((m) => m.mode === mode);
                      setEquipDraft((prev) => ({
                        ...prev,
                        generators: prev.generators.map((item, i) =>
                          i === idx
                            ? {
                                ...item,
                                fuelMode: mode,
                                fuelUnit: found?.defaultUnit || defaultUnitForFuelMode(mode),
                                primaryFuelMode:
                                  mode === 'dual' ? found?.primaryMode || 'gas' : undefined,
                                secondaryFuelMode:
                                  mode === 'dual'
                                    ? found?.secondaryMode || 'diesel'
                                    : undefined,
                                secondaryFuelUnit:
                                  mode === 'dual' ? found?.secondaryUnit || 'L' : undefined,
                              }
                            : item
                        ),
                      }));
                    }}
                    className="w-full h-9 px-2.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                  >
                    {GENERATOR_FUEL_MODES.map((m) => (
                      <option key={m.mode} value={m.mode}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                {getUnitOptionsForFuelMode(gen.fuelMode).length > 0 && (
                  <div className="w-28">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {getFuelLabel(gen.fuelMode)} Unit
                    </label>
                    <select
                      value={gen.fuelUnit || defaultUnitForFuelMode(gen.fuelMode)}
                      disabled={disabled}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEquipDraft((prev) => ({
                          ...prev,
                          generators: prev.generators.map((item, i) =>
                            i === idx ? { ...item, fuelUnit: val } : item
                          ),
                        }));
                      }}
                      className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                    >
                      {getUnitOptionsForFuelMode(gen.fuelMode).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {gen.fuelMode === 'dual' &&
                  (() => {
                    const pMode =
                      gen.primaryFuelMode ||
                      normalizeSingleFuelMode(undefined, gen.fuelUnit);
                    const sMode =
                      gen.secondaryFuelMode ||
                      normalizeSingleFuelMode(undefined, gen.secondaryFuelUnit || 'L');
                    const pUnits = getUnitOptionsForFuelMode(pMode);
                    const sUnits = getUnitOptionsForFuelMode(sMode);
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Fuel 1
                          </label>
                          <select
                            value={pMode}
                            disabled={disabled}
                            onChange={(e) => {
                              const nextMode = e.target.value as SingleDeviceFuelMode;
                              const opt = SINGLE_FUEL_OPTIONS.find(
                                (o) => o.mode === nextMode
                              );
                              setEquipDraft((prev) => ({
                                ...prev,
                                generators: prev.generators.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        primaryFuelMode: nextMode,
                                        fuelUnit:
                                          opt?.defaultUnit ||
                                          defaultUnitForFuelMode(nextMode),
                                      }
                                    : item
                                ),
                              }));
                            }}
                            className="h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                          >
                            {SINGLE_FUEL_OPTIONS.filter((o) => o.mode !== 'electric').map(
                              (opt) => (
                                <option key={opt.mode} value={opt.mode}>
                                  {opt.label}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                        {pUnits.length > 0 && (
                          <div className="w-20">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Unit 1
                            </label>
                            <select
                              value={gen.fuelUnit || defaultUnitForFuelMode(pMode)}
                              disabled={disabled}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEquipDraft((prev) => ({
                                  ...prev,
                                  generators: prev.generators.map((item, i) =>
                                    i === idx ? { ...item, fuelUnit: val } : item
                                  ),
                                }));
                              }}
                              className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                            >
                              {pUnits.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Fuel 2
                          </label>
                          <select
                            value={sMode}
                            disabled={disabled}
                            onChange={(e) => {
                              const nextMode = e.target.value as SingleDeviceFuelMode;
                              const opt = SINGLE_FUEL_OPTIONS.find(
                                (o) => o.mode === nextMode
                              );
                              setEquipDraft((prev) => ({
                                ...prev,
                                generators: prev.generators.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        secondaryFuelMode: nextMode,
                                        secondaryFuelUnit:
                                          opt?.defaultUnit ||
                                          defaultUnitForFuelMode(nextMode),
                                      }
                                    : item
                                ),
                              }));
                            }}
                            className="h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                          >
                            {SINGLE_FUEL_OPTIONS.filter((o) => o.mode !== 'electric').map(
                              (opt) => (
                                <option key={opt.mode} value={opt.mode}>
                                  {opt.label}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                        {sUnits.length > 0 && (
                          <div className="w-20">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Unit 2
                            </label>
                            <select
                              value={gen.secondaryFuelUnit || defaultUnitForFuelMode(sMode)}
                              disabled={disabled}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEquipDraft((prev) => ({
                                  ...prev,
                                  generators: prev.generators.map((item, i) =>
                                    i === idx ? { ...item, secondaryFuelUnit: val } : item
                                  ),
                                }));
                              }}
                              className="w-full h-9 px-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                            >
                              {sUnits.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                <div className="flex items-center justify-between lg:justify-end gap-2 pt-1 lg:pt-0">
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {formatDeviceFuelBadge(gen)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setEquipDraft((prev) => ({
                          ...prev,
                          generators: prev.generators.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                      title="Remove generator"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Named Solar Systems */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-emerald-600" />
            <div>
              <div className="text-xs font-bold text-slate-900">
                Solar Power Systems ({equipDraft.solars.length})
              </div>
              <div className="text-[11px] text-slate-500">
                Add and name rooftop or ground-mounted solar arrays / inverters.
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={disabled || equipDraft.solars.length >= 50}
              onClick={() => handleAddEquipDevice('solar')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Solar System
            </button>
          )}
        </div>

        {equipDraft.solars.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-1">
            No solar systems configured. Solar section will be hidden from the entry form.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {equipDraft.solars.map((solar, idx) => (
              <div key={solar.id} className="p-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Solar System #{idx + 1} Name
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={solar.name}
                    disabled={disabled}
                    placeholder={`e.g. Rooftop Solar #${idx + 1}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEquipDraft((prev) => ({
                        ...prev,
                        solars: prev.solars.map((item, i) =>
                          i === idx ? { ...item, name: val } : item
                        ),
                      }));
                    }}
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                  />
                </div>
                {canEdit && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setEquipDraft((prev) => ({
                        ...prev,
                        solars: prev.solars.filter((_, i) => i !== idx),
                      }))
                    }
                    className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                    title="Remove solar system"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <span className="text-xs text-slate-500">
          Only added devices &amp; selected grid providers appear in the Daily Entry form, with fuel types &amp; units locked during daily entry.
        </span>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              disabled={equipBusy}
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {canEdit ? 'Cancel' : 'Close'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={equipBusy}
              onClick={() => void handleSaveEquipmentConfig()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {equipBusy ? 'Saving...' : 'Save Equipment Setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
