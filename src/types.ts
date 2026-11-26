import type { Timestamp } from 'firebase/firestore';

export type UserStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'admin' | 'entry' | 'viewer';

export const GRID_PROVIDER_OPTIONS = [
  'PDB',
  'DESCO',
  'REB',
  'DPDC',
  'WZPDCL',
  'NESCO',
] as const;

export type GridProviderName = (typeof GRID_PROVIDER_OPTIONS)[number];

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  status: UserStatus;
  role: UserRole;
  companies: string[];
  viewCompanies: string[];
  allowedUtilities?: string[];
  organization?: string;
  department?: string;
  designation?: string;
  phone?: string;
  employeeId?: string;
  createdAt: Timestamp | null;
}

export interface UserDirectoryEntry {
  uid: string;
  name: string;
  organization: string;
  department: string;
  designation: string;
  employeeId: string;
  status: UserStatus;
  role: UserRole;
  companies: string[];
  viewCompanies: string[];
  allowedUtilities: string[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface OwnProfileUpdates {
  name: string;
  organization: string;
  department: string;
  designation: string;
  phone: string;
  employeeId: string;
}

export type AdminUserUpdates = Partial<
  Pick<
    UserProfile,
    | 'status'
    | 'role'
    | 'companies'
    | 'viewCompanies'
    | 'allowedUtilities'
    | 'name'
    | 'organization'
    | 'department'
    | 'designation'
    | 'phone'
    | 'employeeId'
  >
>;

export type SingleDeviceFuelMode =
  | 'gas'
  | 'cng'
  | 'lng'
  | 'lpg'
  | 'sng'
  | 'diesel'
  | 'solid'
  | 'electric';
export type DeviceFuelMode = SingleDeviceFuelMode | 'dual';

export interface PlantDeviceConfig {
  id: string;
  name: string;
  fuelMode: DeviceFuelMode;
  fuelUnit: string;
  primaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelUnit?: string;
}

export interface SolarDeviceConfig {
  id: string;
  name: string;
}

export interface CompanyDeviceConfigs {
  boilers: PlantDeviceConfig[];
  generators: PlantDeviceConfig[];
  solars: SolarDeviceConfig[];
}

export interface PlantEquipmentConfig {
  equipmentConfigured?: boolean;
  boilerCount?: number;
  boilerFuelUnit?: string;
  dieselGeneratorCount?: number;
  gasGeneratorCount?: number;
  solarCount?: number;
  gridProviders?: string[];
  gridHasPeakOffPeak?: boolean;
  deviceConfigs?: string;
}

export interface CompanyItem extends PlantEquipmentConfig {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp | null;
}

export interface UtilityItem {
  id: string;
  name: string;
  unit: string;
  color: string;
  order: number;
  createdBy: string;
  createdAt: Timestamp | null;
}

export interface UtilityEntry {
  id: string;
  date: string; // YYYY-MM-DD
  company: string;
  utilityId: string;
  utilityName: string;
  unit: string;
  consumption: number;
  cost: number;
  note: string;
  enteredBy: string;
  enteredByName: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type GoogleSheetsSyncMode = 'oauth' | 'appsScript';

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  sheetName: string;
  syncMode?: GoogleSheetsSyncMode;
  webhookUrl?: string;
  lastSyncedCount: number;
  lastSyncedAt: Timestamp | null;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export interface UserUnitRate {
  id: string;
  company: string;
  utilityId: string;
  unitCost: number;
  updatedAt: Timestamp | null;
}

export type GridTariffPeriod = 'flat' | 'peak' | 'offPeak';

export interface GridProviderReading {
  provider: string;
  tariff?: GridTariffPeriod;
  kwh: number;
  unitCost: number;
  cost: number;
}

export interface BoilerUnitReading {
  unitIndex: number;
  deviceId?: string;
  deviceName?: string;
  fuelMode?: DeviceFuelMode;
  primaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelMode?: SingleDeviceFuelMode;
  steamKg: number;
  fuelQty: number;
  fuelUnit: string;
  fuelUnitCost: number;
  fuelCost: number;
  secondaryFuelQty?: number;
  secondaryFuelUnit?: string;
  secondaryFuelUnitCost?: number;
  secondaryFuelCost?: number;
  totalFuelCost?: number;
}

export interface GeneratorUnitReading {
  unitIndex: number;
  deviceId?: string;
  deviceName?: string;
  fuelMode?: DeviceFuelMode;
  primaryFuelMode?: SingleDeviceFuelMode;
  secondaryFuelMode?: SingleDeviceFuelMode;
  kwh: number;
  fuelQty: number;
  fuelUnit: string;
  fuelUnitCost: number;
  fuelCost: number;
  secondaryFuelQty?: number;
  secondaryFuelUnit?: string;
  secondaryFuelUnitCost?: number;
  secondaryFuelCost?: number;
  totalFuelCost?: number;
}

export interface SolarUnitReading {
  unitIndex: number;
  deviceId?: string;
  deviceName?: string;
  kwh: number;
  unitCost?: number;
  savings: number;
}

export interface GenerationUnitReadings {
  boilers?: number[];
  boilerUnits?: BoilerUnitReading[];
  generatorUnits?: GeneratorUnitReading[];
  dieselGens?: number[];
  dieselGenUnits?: GeneratorUnitReading[];
  gasGens?: number[];
  gasGenUnits?: GeneratorUnitReading[];
  solarUnits?: number[];
  solarUnitDetails?: SolarUnitReading[];
}

export interface GenerationEntry {
  id: string;
  date: string; // YYYY-MM-DD
  company: string;
  boilerCount: number;
  steamKg: number;
  boilerFuelQty: number;
  boilerFuelUnit: string;
  boilerFuelCost: number;
  generatorCount: number;
  generatorKwh: number;
  generatorFuelQty: number;
  generatorFuelUnit: string;
  generatorFuelCost: number;
  dieselGeneratorCount?: number;
  dieselGenKwh?: number;
  dieselFuelQty?: number;
  dieselFuelCost?: number;
  gasGeneratorCount?: number;
  gasGenKwh?: number;
  gasFuelQty?: number;
  gasFuelCost?: number;
  solarSystemCount: number;
  solarKwh: number;
  solarSavings: number;
  gridProviderBreakdown?: string;
  unitReadings?: string;
  note: string;
  enteredBy: string;
  enteredByName: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type ActivePage = 'dashboard' | 'entry' | 'profile' | 'admin';
