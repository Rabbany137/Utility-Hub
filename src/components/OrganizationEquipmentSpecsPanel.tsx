import React, { useEffect, useMemo, useState } from 'react';
import {
  Cpu,
  Droplets,
  Edit3,
  Flame,
  Gauge,
  Plus,
  Save,
  Search,
  Sun,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useApp } from '../context/AppContext';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type {
  CompanyInfrastructure,
  CompanyItem,
  EquipmentSpecCategory,
  EquipmentSpecItem,
  EquipmentStatus,
} from '../types';
import {
  formatDateTime,
  formatNumber,
  sanitizeNumericInput,
  toSafeFirestoreId,
} from '../utils/formatters';

interface OrganizationEquipmentSpecsPanelProps {
  company: CompanyItem;
  canEdit: boolean;
  onClose?: () => void;
}

const CATEGORY_META: Record<
  EquipmentSpecCategory,
  {
    label: string;
    shortLabel: string;
    namePlaceholder: string;
    brandPlaceholder: string;
    capacityPlaceholder: string;
    diaLabel: string;
    diaPlaceholder: string;
    fuelLabel: string;
    fuelPlaceholder: string;
    operatingPlaceholder: string;
  }
> = {
  generator: {
    label: 'Generator',
    shortLabel: 'Generators',
    namePlaceholder: 'e.g. Caterpillar Gas Generator #1',
    brandPlaceholder: 'e.g. Caterpillar G3516H / Cummins KTA50',
    capacityPlaceholder: 'e.g. 1500 kVA / 1200 kW',
    diaLabel: 'Exhaust / Line Dia or Size',
    diaPlaceholder: 'e.g. Exhaust 250mm / Gas Line 3 inch',
    fuelLabel: 'Fuel / Voltage',
    fuelPlaceholder: 'e.g. Natural Gas / Diesel · 400V 3-Phase',
    operatingPlaceholder: 'e.g. 1500 RPM · 50 Hz · PF 0.8 · Jacket Water 85°C',
  },
  boiler: {
    label: 'Boiler',
    shortLabel: 'Boilers',
    namePlaceholder: 'e.g. Steam Boiler #1 (6 Ton)',
    brandPlaceholder: 'e.g. Bosch UL-S / Cochran / Thermax',
    capacityPlaceholder: 'e.g. 6000 kg/hr (6 Ton/hr)',
    diaLabel: 'Steam Header / Pipe Dia',
    diaPlaceholder: 'e.g. 6 inch (150mm) Steam Header',
    fuelLabel: 'Fuel / Firing System',
    fuelPlaceholder: 'e.g. Natural Gas / Dual-Fuel (Gas + Diesel)',
    operatingPlaceholder: 'e.g. Working Pressure 10.5 Bar · 185°C',
  },
  deep_pump: {
    label: 'Deep Pump / Tube Well',
    shortLabel: 'Deep Pumps',
    namePlaceholder: 'e.g. Deep Tube Well Pump #1 (North)',
    brandPlaceholder: 'e.g. KSB / Pedrollo / Grundfos SP',
    capacityPlaceholder: 'e.g. 40 HP / 30 kW · 120 m³/hr',
    diaLabel: 'Pump & Borewell Pipe Dia',
    diaPlaceholder: 'e.g. Bore 8 inch · Column Pipe 6 inch Dia',
    fuelLabel: 'Power Supply',
    fuelPlaceholder: 'e.g. 415V 3-Phase · Submersible Motor',
    operatingPlaceholder: 'e.g. Depth 680 ft · Head 220 ft · Delivery 4 inch',
  },
  water_line: {
    label: 'Water Line / Pipeline',
    shortLabel: 'Water Lines',
    namePlaceholder: 'e.g. Main Factory Water Supply Line',
    brandPlaceholder: 'e.g. GI / MS / uPVC Schedule-80 Pipe',
    capacityPlaceholder: 'e.g. 150 m³/hr Flow · 4.5 Bar',
    diaLabel: 'Line Pipe Diameter (Dia)',
    diaPlaceholder: 'e.g. 4 inch (110mm) / 6 inch Header',
    fuelLabel: 'Source / Pump Feed',
    fuelPlaceholder: 'e.g. Overhead Tank + Booster Pump',
    operatingPlaceholder: 'e.g. Length 450m · Flow Meter Installed',
  },
  solar: {
    label: 'Solar System',
    shortLabel: 'Solar',
    namePlaceholder: 'e.g. Rooftop Solar Array Shed-A',
    brandPlaceholder: 'e.g. Huawei SUN2000 / Longi 550W',
    capacityPlaceholder: 'e.g. 500 kWp DC / 450 kW AC',
    diaLabel: 'Area / Cable Size',
    diaPlaceholder: 'e.g. 900 Panels · 4×185mm² AC Cable',
    fuelLabel: 'Inverter / Tie-In',
    fuelPlaceholder: 'e.g. On-Grid Synchronized 415V',
    operatingPlaceholder: 'e.g. 5× 100kW Inverters · Net Metering Active',
  },
  transformer: {
    label: 'Sub-station / Transformer',
    shortLabel: 'Sub-station',
    namePlaceholder: 'e.g. Main Transformer #1 (11/0.415 kV)',
    brandPlaceholder: 'e.g. Energypac / ABB / Siemens',
    capacityPlaceholder: 'e.g. 1500 kVA Oil-Type',
    diaLabel: 'HT / LT Busbar or Cable Size',
    diaPlaceholder: 'e.g. 11kV HT · 2500A LT Busbar',
    fuelLabel: 'Grid Feed',
    fuelPlaceholder: 'e.g. REB / DESCO 11kV Feeder',
    operatingPlaceholder: 'e.g. Dyn11 · Impedance 5.5% · Tap Changer',
  },
  other: {
    label: 'Chiller / Compressor / Other',
    shortLabel: 'Other',
    namePlaceholder: 'e.g. Screw Air Compressor #1 / ETP Blower',
    brandPlaceholder: 'e.g. Atlas Copco GA75 / York Chiller',
    capacityPlaceholder: 'e.g. 75 kW · 420 CFM / 250 TR',
    diaLabel: 'Header / Pipe Dia or Size',
    diaPlaceholder: 'e.g. 3 inch Air Header / 80mm Pipe',
    fuelLabel: 'Power / Medium',
    fuelPlaceholder: 'e.g. Electric 415V / Chilled Water',
    operatingPlaceholder: 'e.g. 7.5 Bar Working · VFD Controlled',
  },
};

const STATUS_META: Record<
  EquipmentStatus,
  { label: string; textClass: string; dotClass: string }
> = {
  active: { label: 'Active', textClass: 'text-emerald-700', dotClass: 'bg-emerald-600' },
  standby: { label: 'Standby', textClass: 'text-sky-700', dotClass: 'bg-sky-600' },
  maintenance: {
    label: 'Maintenance',
    textClass: 'text-amber-700',
    dotClass: 'bg-amber-500',
  },
  inactive: { label: 'Inactive', textClass: 'text-slate-500', dotClass: 'bg-slate-400' },
};

function renderCategoryIcon(cat: EquipmentSpecCategory) {
  switch (cat) {
    case 'generator':
    case 'transformer':
      return <Zap className="w-4 h-4 text-amber-600 shrink-0" />;
    case 'boiler':
      return <Flame className="w-4 h-4 text-orange-600 shrink-0" />;
    case 'deep_pump':
    case 'water_line':
      return <Droplets className="w-4 h-4 text-sky-600 shrink-0" />;
    case 'solar':
      return <Sun className="w-4 h-4 text-emerald-600 shrink-0" />;
    default:
      return <Cpu className="w-4 h-4 text-slate-600 shrink-0" />;
  }
}

interface InfraFormState {
  totalDeepPumps: string;
  deepPumpDia: string;
  waterLineCount: string;
  waterLineDia: string;
  waterTankCapacity: string;
  wtpEtpCapacity: string;
  gasLineSpec: string;
  substationCapacity: string;
  notes: string;
}

interface SpecFormState {
  category: EquipmentSpecCategory;
  name: string;
  tagCode: string;
  brandModel: string;
  capacity: string;
  pipeDiaOrSize: string;
  fuelOrPowerSource: string;
  operatingSpec: string;
  serialOrYear: string;
  status: EquipmentStatus;
  notes: string;
}

const EMPTY_SPEC_FORM: SpecFormState = {
  category: 'generator',
  name: '',
  tagCode: '',
  brandModel: '',
  capacity: '',
  pipeDiaOrSize: '',
  fuelOrPowerSource: '',
  operatingSpec: '',
  serialOrYear: '',
  status: 'active',
  notes: '',
};

export function OrganizationEquipmentSpecsPanel({
  company,
  canEdit,
  onClose,
}: OrganizationEquipmentSpecsPanelProps) {
  const { user, profile } = useApp();

  const [infra, setInfra] = useState<CompanyInfrastructure | null>(null);
  const [specs, setSpecs] = useState<EquipmentSpecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingInfra, setEditingInfra] = useState(false);
  const [infraDraft, setInfraDraft] = useState<InfraFormState>({
    totalDeepPumps: '0',
    deepPumpDia: '',
    waterLineCount: '0',
    waterLineDia: '',
    waterTankCapacity: '',
    wtpEtpCapacity: '',
    gasLineSpec: '',
    substationCapacity: '',
    notes: '',
  });
  const [infraBusy, setInfraBusy] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<'all' | EquipmentSpecCategory>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSpecForm, setShowSpecForm] = useState(false);
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [specForm, setSpecForm] = useState<SpecFormState>(EMPTY_SPEC_FORM);
  const [specBusy, setSpecBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setEditingInfra(false);
    setShowSpecForm(false);
    setEditingSpecId(null);
    setConfirmDeleteId(null);
    setToast(null);

    let infraReady = false;
    let specsReady = false;
    const markDone = () => {
      if (infraReady && specsReady) setLoading(false);
    };

    const unsubInfra = onSnapshot(
      doc(db, 'companies', company.id, 'infrastructure', 'summary'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const mapped: CompanyInfrastructure = {
            companyName: String(d.companyName || company.name),
            totalDeepPumps: Number(d.totalDeepPumps ?? 0),
            deepPumpDia: String(d.deepPumpDia || ''),
            waterLineCount: Number(d.waterLineCount ?? 0),
            waterLineDia: String(d.waterLineDia || ''),
            waterTankCapacity: String(d.waterTankCapacity || ''),
            wtpEtpCapacity: String(d.wtpEtpCapacity || ''),
            gasLineSpec: String(d.gasLineSpec || ''),
            substationCapacity: String(d.substationCapacity || ''),
            notes: String(d.notes || ''),
            updatedBy: String(d.updatedBy || ''),
            updatedByName: String(d.updatedByName || ''),
            updatedAt: (d.updatedAt as CompanyInfrastructure['updatedAt']) ?? null,
          };
          setInfra(mapped);
        } else {
          setInfra(null);
        }
        infraReady = true;
        markDone();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, `companies/${company.id}/infrastructure/summary`);
        } catch {
          setLoadError('You do not have view permission for this factory’s infrastructure details.');
        }
        infraReady = true;
        markDone();
      }
    );

    const unsubSpecs = onSnapshot(
      query(
        collection(db, 'companies', company.id, 'equipmentSpecs'),
        orderBy('name', 'asc')
      ),
      (snap) => {
        const list: EquipmentSpecItem[] = snap.docs.map((docItem) => {
          const d = docItem.data();
          return {
            id: docItem.id,
            companyName: String(d.companyName || company.name),
            category: (d.category as EquipmentSpecCategory) || 'other',
            name: String(d.name || ''),
            tagCode: String(d.tagCode || ''),
            brandModel: String(d.brandModel || ''),
            capacity: String(d.capacity || ''),
            pipeDiaOrSize: String(d.pipeDiaOrSize || ''),
            fuelOrPowerSource: String(d.fuelOrPowerSource || ''),
            operatingSpec: String(d.operatingSpec || ''),
            serialOrYear: String(d.serialOrYear || ''),
            status: (d.status as EquipmentStatus) || 'active',
            notes: String(d.notes || ''),
            createdBy: String(d.createdBy || ''),
            updatedBy: String(d.updatedBy || ''),
            updatedByName: String(d.updatedByName || ''),
            createdAt: (d.createdAt as EquipmentSpecItem['createdAt']) ?? null,
            updatedAt: (d.updatedAt as EquipmentSpecItem['updatedAt']) ?? null,
          };
        });
        setSpecs(list);
        specsReady = true;
        markDone();
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, `companies/${company.id}/equipmentSpecs`);
        } catch {
          setLoadError('You do not have view permission for this factory’s equipment specifications.');
        }
        specsReady = true;
        markDone();
      }
    );

    return () => {
      unsubInfra();
      unsubSpecs();
    };
  }, [company.id, company.name]);

  const categoryCounts = useMemo(() => {
    const counts: Record<EquipmentSpecCategory, number> = {
      generator: 0,
      boiler: 0,
      deep_pump: 0,
      water_line: 0,
      solar: 0,
      transformer: 0,
      other: 0,
    };
    for (const s of specs) {
      if (counts[s.category] !== undefined) counts[s.category] += 1;
    }
    return counts;
  }, [specs]);

  const filteredSpecs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return specs.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.tagCode || '').toLowerCase().includes(q) ||
        (item.brandModel || '').toLowerCase().includes(q) ||
        (item.capacity || '').toLowerCase().includes(q) ||
        (item.pipeDiaOrSize || '').toLowerCase().includes(q) ||
        (item.fuelOrPowerSource || '').toLowerCase().includes(q) ||
        (item.operatingSpec || '').toLowerCase().includes(q)
      );
    });
  }, [specs, categoryFilter, searchTerm]);

  const handleOpenInfraEditor = () => {
    setToast(null);
    setInfraDraft({
      totalDeepPumps: String(infra?.totalDeepPumps ?? 0),
      deepPumpDia: infra?.deepPumpDia || '',
      waterLineCount: String(infra?.waterLineCount ?? 0),
      waterLineDia: infra?.waterLineDia || '',
      waterTankCapacity: infra?.waterTankCapacity || '',
      wtpEtpCapacity: infra?.wtpEtpCapacity || '',
      gasLineSpec: infra?.gasLineSpec || '',
      substationCapacity: infra?.substationCapacity || '',
      notes: infra?.notes || '',
    });
    setEditingInfra(true);
  };

  const handleSaveInfra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !user || !profile) return;
    setToast(null);

    const parsedPumps = Math.min(
      500,
      Math.max(0, Math.round(Number(sanitizeNumericInput(infraDraft.totalDeepPumps || '0', false)) || 0))
    );
    const parsedLines = Math.min(
      500,
      Math.max(0, Math.round(Number(sanitizeNumericInput(infraDraft.waterLineCount || '0', false)) || 0))
    );

    const payloadBase = {
      totalDeepPumps: parsedPumps,
      deepPumpDia: infraDraft.deepPumpDia.trim().slice(0, 100),
      waterLineCount: parsedLines,
      waterLineDia: infraDraft.waterLineDia.trim().slice(0, 100),
      waterTankCapacity: infraDraft.waterTankCapacity.trim().slice(0, 120),
      wtpEtpCapacity: infraDraft.wtpEtpCapacity.trim().slice(0, 120),
      gasLineSpec: infraDraft.gasLineSpec.trim().slice(0, 120),
      substationCapacity: infraDraft.substationCapacity.trim().slice(0, 120),
      notes: infraDraft.notes.trim().slice(0, 500),
      updatedBy: user.uid,
      updatedByName: (profile.name || user.email || 'User').trim().slice(0, 100) || 'User',
      updatedAt: serverTimestamp(),
    };

    const ref = doc(db, 'companies', company.id, 'infrastructure', 'summary');
    setInfraBusy(true);
    try {
      if (infra) {
        await updateDoc(ref, payloadBase);
      } else {
        await setDoc(ref, {
          companyName: company.name.slice(0, 100),
          ...payloadBase,
        });
      }
      setEditingInfra(false);
      setToast({
        type: 'success',
        text: `Saved water lines, deep pump & infrastructure details for "${company.name}".`,
      });
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.UPDATE, `companies/${company.id}/infrastructure/summary`);
      } catch {
        setToast({
          type: 'error',
          text: `Failed to save infrastructure details for "${company.name}".`,
        });
      }
    } finally {
      setInfraBusy(false);
    }
  };

  const handleStartAddSpec = (defaultCat?: EquipmentSpecCategory) => {
    setToast(null);
    setEditingSpecId(null);
    setSpecForm({
      ...EMPTY_SPEC_FORM,
      category: defaultCat || (categoryFilter !== 'all' ? categoryFilter : 'generator'),
    });
    setShowSpecForm(true);
  };

  const handleStartEditSpec = (item: EquipmentSpecItem) => {
    setToast(null);
    setEditingSpecId(item.id);
    setSpecForm({
      category: item.category,
      name: item.name,
      tagCode: item.tagCode || '',
      brandModel: item.brandModel || '',
      capacity: item.capacity || '',
      pipeDiaOrSize: item.pipeDiaOrSize || '',
      fuelOrPowerSource: item.fuelOrPowerSource || '',
      operatingSpec: item.operatingSpec || '',
      serialOrYear: item.serialOrYear || '',
      status: item.status,
      notes: item.notes || '',
    });
    setShowSpecForm(true);
  };

  const handleSaveSpec = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !user || !profile) return;
    setToast(null);

    const cleanName = specForm.name.trim().slice(0, 100);
    if (!cleanName) {
      setToast({ type: 'error', text: 'Equipment or line name is required.' });
      return;
    }

    const commonFields = {
      category: specForm.category,
      name: cleanName,
      tagCode: specForm.tagCode.trim().slice(0, 40),
      brandModel: specForm.brandModel.trim().slice(0, 120),
      capacity: specForm.capacity.trim().slice(0, 100),
      pipeDiaOrSize: specForm.pipeDiaOrSize.trim().slice(0, 100),
      fuelOrPowerSource: specForm.fuelOrPowerSource.trim().slice(0, 80),
      operatingSpec: specForm.operatingSpec.trim().slice(0, 180),
      serialOrYear: specForm.serialOrYear.trim().slice(0, 80),
      status: specForm.status,
      notes: specForm.notes.trim().slice(0, 300),
      updatedBy: user.uid,
      updatedByName: (profile.name || user.email || 'User').trim().slice(0, 100) || 'User',
      updatedAt: serverTimestamp(),
    };

    setSpecBusy(true);
    try {
      if (editingSpecId) {
        await updateDoc(
          doc(db, 'companies', company.id, 'equipmentSpecs', editingSpecId),
          commonFields
        );
        setToast({ type: 'success', text: `Updated specifications for "${cleanName}".` });
      } else {
        const specId = toSafeFirestoreId(
          'spec',
          `${specForm.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );
        await setDoc(doc(db, 'companies', company.id, 'equipmentSpecs', specId), {
          companyName: company.name.slice(0, 100),
          ...commonFields,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
        setToast({ type: 'success', text: `Added "${cleanName}" to ${company.name} specs.` });
      }
      setShowSpecForm(false);
      setEditingSpecId(null);
      setSpecForm(EMPTY_SPEC_FORM);
    } catch (error) {
      try {
        handleFirestoreError(
          error,
          editingSpecId ? OperationType.UPDATE : OperationType.CREATE,
          `companies/${company.id}/equipmentSpecs`
        );
      } catch {
        setToast({
          type: 'error',
          text: `Failed to save equipment specifications for "${company.name}".`,
        });
      }
    } finally {
      setSpecBusy(false);
    }
  };

  const handleDeleteSpec = async (item: EquipmentSpecItem) => {
    if (!canEdit) return;
    setDeletingId(item.id);
    setToast(null);
    try {
      await deleteDoc(doc(db, 'companies', company.id, 'equipmentSpecs', item.id));
      setConfirmDeleteId(null);
      setToast({ type: 'success', text: `Removed "${item.name}" from specifications.` });
    } catch (error) {
      try {
        handleFirestoreError(
          error,
          OperationType.DELETE,
          `companies/${company.id}/equipmentSpecs/${item.id}`
        );
      } catch {
        setToast({ type: 'error', text: `Could not delete "${item.name}".` });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const activeMeta = CATEGORY_META[specForm.category];

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">
            Equipment Specifications &amp; Water / Deep Pump Info — {company.name}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {canEdit
              ? 'Update technical specifications (model, kVA/HP/Ton, voltage/RPM), water supply lines, total deep pumps, and pipe diameters (dia).'
              : 'Read-only view of factory equipment specifications, water lines, and deep pump details.'}
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

      {toast && (
        <div
          className={`px-3.5 py-2.5 rounded-lg border text-xs font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {toast.text}
        </div>
      )}

      {loadError && (
        <div className="px-3.5 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs font-medium text-amber-900">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-500">
          Loading equipment &amp; infrastructure details...
        </div>
      ) : (
        <>
          {/* Section A: Water Line, Deep Pumps & Utility Infrastructure Summary */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-sky-600" />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Water Lines, Deep Pumps &amp; Utility Infrastructure Summary
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Total deep pumps (মোট ডীপ পাম্প), pipe diameters (ডায়া), water lines, WTP/ETP, gas RMS &amp; sub-station capacity.
                  </div>
                </div>
              </div>
              {canEdit && !editingInfra && (
                <button
                  type="button"
                  onClick={handleOpenInfraEditor}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 cursor-pointer whitespace-nowrap"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  {infra ? 'Update Infrastructure' : 'Add Infrastructure Info'}
                </button>
              )}
            </div>

            {editingInfra ? (
              <form onSubmit={handleSaveInfra} className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Total Deep Pumps (মোট ডীপ পাম্প)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={infraDraft.totalDeepPumps}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({
                          ...prev,
                          totalDeepPumps: sanitizeNumericInput(e.target.value, false),
                        }))
                      }
                      placeholder="e.g. 4"
                      className="w-full h-9 px-3 text-sm font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Deep Pump / Bore Pipe Dia (ডায়া)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={infraDraft.deepPumpDia}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({ ...prev, deepPumpDia: e.target.value }))
                      }
                      placeholder="e.g. 6 inch / 8 inch (150mm)"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Main Water Lines (পানির লাইন সংখ্যা)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={infraDraft.waterLineCount}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({
                          ...prev,
                          waterLineCount: sanitizeNumericInput(e.target.value, false),
                        }))
                      }
                      placeholder="e.g. 3"
                      className="w-full h-9 px-3 text-sm font-mono-num bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Water Line Pipe Dia (পানির লাইন ডায়া)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={infraDraft.waterLineDia}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({ ...prev, waterLineDia: e.target.value }))
                      }
                      placeholder="e.g. 4 inch MS / 110mm uPVC"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Water Tank / Reservoir Capacity
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={infraDraft.waterTankCapacity}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({
                          ...prev,
                          waterTankCapacity: e.target.value,
                        }))
                      }
                      placeholder="e.g. 250,000 L (UG + OH)"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      WTP / ETP Capacity
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={infraDraft.wtpEtpCapacity}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({ ...prev, wtpEtpCapacity: e.target.value }))
                      }
                      placeholder="e.g. WTP 60 m³/hr · ETP 100 m³/hr"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Gas RMS / Supply Line Dia &amp; Pressure
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={infraDraft.gasLineSpec}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({ ...prev, gasLineSpec: e.target.value }))
                      }
                      placeholder="e.g. 4 inch Header · 15 PSI"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Sub-station / Transformer Capacity
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={infraDraft.substationCapacity}
                      disabled={infraBusy}
                      onChange={(e) =>
                        setInfraDraft((prev) => ({
                          ...prev,
                          substationCapacity: e.target.value,
                        }))
                      }
                      placeholder="e.g. 2 × 1500 kVA (3000 kVA)"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Infrastructure &amp; Piping Notes
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={infraDraft.notes}
                    disabled={infraBusy}
                    onChange={(e) =>
                      setInfraDraft((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    placeholder="e.g. Pump #1 & #2 feed Overhead Tank; Flow meter mounted on 4 inch main header."
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={infraBusy}
                    onClick={() => setEditingInfra(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={infraBusy}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {infraBusy ? 'Saving...' : 'Save Infrastructure Info'}
                  </button>
                </div>
              </form>
            ) : !infra ? (
              <div className="p-5 text-xs text-slate-500">
                No water line or deep pump summary recorded yet for {company.name}.{' '}
                {canEdit
                  ? 'Click "Add Infrastructure Info" to record total deep pumps, pipe diameters, water lines, and utility capacities.'
                  : ''}
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-xs">
                  <div className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">
                      Deep Pumps / Tube Wells
                    </div>
                    <div className="text-base font-bold text-slate-900 font-mono-num tabular-nums">
                      {formatNumber(infra.totalDeepPumps, 0)} Units
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Dia: <span className="font-semibold text-slate-800">{infra.deepPumpDia || '—'}</span>
                    </div>
                  </div>

                  <div className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">
                      Main Water Supply Lines
                    </div>
                    <div className="text-base font-bold text-slate-900 font-mono-num tabular-nums">
                      {formatNumber(infra.waterLineCount, 0)} Lines
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Dia: <span className="font-semibold text-slate-800">{infra.waterLineDia || '—'}</span>
                    </div>
                  </div>

                  <div className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Tank &amp; WTP / ETP
                    </div>
                    <div className="text-xs font-semibold text-slate-900">
                      Tank: {infra.waterTankCapacity || '—'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Plant: {infra.wtpEtpCapacity || '—'}
                    </div>
                  </div>

                  <div className="p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Gas Line &amp; Sub-station
                    </div>
                    <div className="text-xs font-semibold text-slate-900">
                      Gas: {infra.gasLineSpec || '—'}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Power: {infra.substationCapacity || '—'}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>{infra.notes ? `Note: ${infra.notes}` : ''}</span>
                  <span>
                    Last updated by <strong className="text-slate-700">{infra.updatedByName}</strong>
                    {infra.updatedAt ? ` · ${formatDateTime(infra.updatedAt.toDate())}` : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Section B: Detailed Equipment & Pipeline Specifications Registry */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-teal-700" />
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Equipment &amp; Line Technical Specifications ({formatNumber(specs.length, 0)})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Detailed specifications per generator, boiler, deep pump, water line, solar array, and transformer.
                  </div>
                </div>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleStartAddSpec()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Equipment / Line Spec
                </button>
              )}
            </div>

            {/* Category Filters & Search */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                    categoryFilter === 'all'
                      ? 'bg-teal-700 border-teal-700 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  All ({specs.length})
                </button>
                {(Object.keys(CATEGORY_META) as EquipmentSpecCategory[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                      categoryFilter === cat
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {CATEGORY_META[cat].shortLabel} ({categoryCounts[cat]})
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search model, capacity, dia..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear filter"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Add / Edit Specification Form */}
            {showSpecForm && canEdit && (
              <form
                onSubmit={handleSaveSpec}
                className="p-4 rounded-xl bg-slate-50 border border-teal-200 space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Wrench className="w-4 h-4 text-teal-700" />
                    {editingSpecId ? 'Edit Equipment Specification' : 'Add New Equipment / Line Specification'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSpecForm(false);
                      setEditingSpecId(null);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Category
                    </label>
                    <select
                      value={specForm.category}
                      disabled={specBusy}
                      onChange={(e) =>
                        setSpecForm((prev) => ({
                          ...prev,
                          category: e.target.value as EquipmentSpecCategory,
                        }))
                      }
                      className="w-full h-9 px-2.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {(Object.keys(CATEGORY_META) as EquipmentSpecCategory[]).map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_META[cat].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Equipment / Line Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      required
                      disabled={specBusy}
                      value={specForm.name}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder={activeMeta.namePlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Tag / Asset ID (Optional)
                    </label>
                    <input
                      type="text"
                      maxLength={40}
                      disabled={specBusy}
                      value={specForm.tagCode}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, tagCode: e.target.value }))
                      }
                      placeholder="e.g. GEN-01 / DTW-02 / WL-01"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Brand &amp; Model
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      disabled={specBusy}
                      value={specForm.brandModel}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, brandModel: e.target.value }))
                      }
                      placeholder={activeMeta.brandPlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Rated Capacity (kVA / HP / Ton / Flow)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      disabled={specBusy}
                      value={specForm.capacity}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, capacity: e.target.value }))
                      }
                      placeholder={activeMeta.capacityPlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {activeMeta.diaLabel}
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      disabled={specBusy}
                      value={specForm.pipeDiaOrSize}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, pipeDiaOrSize: e.target.value }))
                      }
                      placeholder={activeMeta.diaPlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {activeMeta.fuelLabel}
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      disabled={specBusy}
                      value={specForm.fuelOrPowerSource}
                      onChange={(e) =>
                        setSpecForm((prev) => ({
                          ...prev,
                          fuelOrPowerSource: e.target.value,
                        }))
                      }
                      placeholder={activeMeta.fuelPlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Operating Specs (RPM / Voltage / Pressure / Depth / Head)
                    </label>
                    <input
                      type="text"
                      maxLength={180}
                      disabled={specBusy}
                      value={specForm.operatingSpec}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, operatingSpec: e.target.value }))
                      }
                      placeholder={activeMeta.operatingPlaceholder}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Serial No. / Install Year
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      disabled={specBusy}
                      value={specForm.serialOrYear}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, serialOrYear: e.target.value }))
                      }
                      placeholder="e.g. 2021 · SN-88241"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Status
                    </label>
                    <select
                      value={specForm.status}
                      disabled={specBusy}
                      onChange={(e) =>
                        setSpecForm((prev) => ({
                          ...prev,
                          status: e.target.value as EquipmentStatus,
                        }))
                      }
                      className="w-full h-9 px-2.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      <option value="active">Active</option>
                      <option value="standby">Standby</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Additional Notes
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      disabled={specBusy}
                      value={specForm.notes}
                      onChange={(e) =>
                        setSpecForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="Any servicing schedule, flow meter location, or extra notes"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={specBusy}
                    onClick={() => {
                      setShowSpecForm(false);
                      setEditingSpecId(null);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={specBusy}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-teal-700 text-white text-xs font-semibold rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {specBusy
                      ? 'Saving...'
                      : editingSpecId
                      ? 'Update Specification'
                      : 'Save Specification'}
                  </button>
                </div>
              </form>
            )}

            {/* Specifications List */}
            {filteredSpecs.length === 0 ? (
              <div className="p-6 text-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                {specs.length === 0
                  ? `No equipment or pipeline specifications added for ${company.name} yet.`
                  : 'No specifications match the selected category or search filter.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {filteredSpecs.map((item) => {
                  const statusMeta = STATUS_META[item.status] || STATUS_META.active;
                  return (
                    <div key={item.id} className="p-3.5 sm:p-4 bg-white space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {renderCategoryIcon(item.category)}
                            <span className="text-sm font-bold text-slate-900">
                              {item.name}
                            </span>
                            {item.tagCode && (
                              <>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-xs font-mono-num font-semibold text-slate-600">
                                  {item.tagCode}
                                </span>
                              </>
                            )}
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-xs font-medium text-slate-500">
                              {CATEGORY_META[item.category]?.label || item.category}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusMeta.textClass}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                              {statusMeta.label}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-600 pt-1">
                            {item.brandModel && (
                              <div>
                                <span className="text-slate-400">Brand/Model:</span>{' '}
                                <span className="font-medium text-slate-800">
                                  {item.brandModel}
                                </span>
                              </div>
                            )}
                            {item.capacity && (
                              <div>
                                <span className="text-slate-400">Capacity:</span>{' '}
                                <span className="font-semibold text-teal-800">
                                  {item.capacity}
                                </span>
                              </div>
                            )}
                            {item.pipeDiaOrSize && (
                              <div>
                                <span className="text-slate-400">Dia / Size:</span>{' '}
                                <span className="font-semibold text-sky-800">
                                  {item.pipeDiaOrSize}
                                </span>
                              </div>
                            )}
                            {item.fuelOrPowerSource && (
                              <div>
                                <span className="text-slate-400">Fuel / Power:</span>{' '}
                                <span className="font-medium text-slate-800">
                                  {item.fuelOrPowerSource}
                                </span>
                              </div>
                            )}
                            {item.operatingSpec && (
                              <div className="sm:col-span-2">
                                <span className="text-slate-400">Specs:</span>{' '}
                                <span className="font-medium text-slate-800">
                                  {item.operatingSpec}
                                </span>
                              </div>
                            )}
                            {item.serialOrYear && (
                              <div>
                                <span className="text-slate-400">Serial / Year:</span>{' '}
                                <span className="font-mono-num text-slate-700">
                                  {item.serialOrYear}
                                </span>
                              </div>
                            )}
                          </div>

                          {(item.notes || item.updatedByName) && (
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                              <span>{item.notes ? `Note: ${item.notes}` : ''}</span>
                              <span>
                                Updated by {item.updatedByName}
                                {item.updatedAt
                                  ? ` · ${formatDateTime(item.updatedAt.toDate())}`
                                  : ''}
                              </span>
                            </div>
                          )}
                        </div>

                        {canEdit && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {confirmDeleteId === item.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={deletingId === item.id}
                                  onClick={() => void handleDeleteSpec(item)}
                                  className="px-2.5 py-1 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 cursor-pointer disabled:opacity-60"
                                >
                                  {deletingId === item.id ? 'Deleting...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditSpec(item)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(item.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                                  title="Delete specification"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
