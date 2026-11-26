export const ADMIN_EMAIL = 'omargolamrabbany@gmail.com';

export interface SeedUtility {
  id: string;
  name: string;
  unit: string;
  color: string;
  order: number;
}

export const DEFAULT_COMPANIES: string[] = [
  'Company A',
  'Company B',
  'Company C',
];

export const DEFAULT_UTILITIES: SeedUtility[] = [
  {
    id: 'electricity',
    name: 'Electricity',
    unit: 'kWh',
    color: '#E0A100',
    order: 1,
  },
  {
    id: 'gas',
    name: 'Gas',
    unit: 'm³',
    color: '#2F6FDE',
    order: 2,
  },
  {
    id: 'water',
    name: 'Water',
    unit: 'm³',
    color: '#12A5A0',
    order: 3,
  },
  {
    id: 'diesel',
    name: 'Diesel',
    unit: 'Liters',
    color: '#B5472B',
    order: 4,
  },
];

export const APP_NAME = 'Utility Hub';
