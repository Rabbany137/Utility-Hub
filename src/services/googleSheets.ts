import type { CompanyItem, UtilityEntry, UtilityItem } from '../types';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const MASTER_BACKUP_TAB_NAME = 'Master_Backup';
export const SUMMARY_TAB_NAME = 'Monthly_Summary';

export const MASTER_BACKUP_HEADER_ROW: string[] = [
  'Year',
  'Month',
  'Date',
  'Factory',
  'Utility',
  'Consumption',
  'Unit',
  'Unit Cost (BDT/Unit)',
  'Total Cost (BDT)',
  'Note',
  'Entered By',
  'Entry ID',
];

export const SHEET_HEADER_ROW: string[] = [
  'Date',
  'Factory',
  'Utility',
  'Consumption',
  'Unit',
  'Cost (BDT)',
  'Unit Cost (BDT/Unit)',
  'Note',
  'Entered By',
  'Entry ID',
];

export const SUMMARY_HEADER_ROW: string[] = [
  'Year',
  'Month',
  'Factory',
  'Sheet Tab',
  'Active Days',
  'Entries',
  'Total Cost (BDT)',
  'Avg Daily Cost (BDT)',
];

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  sheetNames: string[];
}

export interface SheetTabPayload {
  tabName: string;
  rows: (string | number)[][];
}

export class SheetsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetsAuthError';
  }
}

function quoteSheetRange(sheetName: string, range: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

export function sanitizeSheetTabPart(raw: string): string {
  return raw
    .replace(/[:\\/?*[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatMonthYearLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const monthIdx = Number(monthStr) - 1;
  const monthLabel =
    monthIdx >= 0 && monthIdx < 12 ? MONTH_SHORT_NAMES[monthIdx] : monthStr || '00';
  return `${monthLabel} ${yearStr || '0000'}`;
}

export function formatFactoryMonthTabName(company: string, dateOrMonth: string): string {
  const monthKey = dateOrMonth.slice(0, 7);
  const suffix = ` - ${formatMonthYearLabel(monthKey)}`;
  const maxCompanyLen = Math.max(10, 99 - suffix.length);
  let cleanCompany = sanitizeSheetTabPart(company) || 'Factory';
  if (cleanCompany.length > maxCompanyLen) {
    cleanCompany = cleanCompany.slice(0, maxCompanyLen).trim();
  }
  const candidate = `${cleanCompany}${suffix}`;
  if (
    candidate.toLowerCase() === SUMMARY_TAB_NAME.toLowerCase() ||
    candidate.toLowerCase() === MASTER_BACKUP_TAB_NAME.toLowerCase()
  ) {
    return `${cleanCompany} Sheet${suffix}`.slice(0, 99);
  }
  return candidate;
}

async function sheetsFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const msg =
      body?.error?.message ||
      'Google Sheets authorization expired or lacks permission. Please reconnect with Google.';
    if (res.status === 401) {
      throw new SheetsAuthError(msg);
    }
    throw new Error(msg);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message || `Google Sheets API error (${res.status})`
    );
  }

  return res.json() as Promise<T>;
}

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{10,128}$/.test(trimmed)) return trimmed;
  return null;
}

export async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const data = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: { properties?: { title?: string } }[];
  }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    accessToken
  );

  const sheetNames = (data.sheets || [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));

  return {
    spreadsheetId: data.spreadsheetId || spreadsheetId,
    spreadsheetUrl:
      data.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetTitle: data.properties?.title || 'Utility Hub Spreadsheet',
    sheetNames,
  };
}

export async function createUtilitySpreadsheet(
  accessToken: string,
  title = 'Utility Hub — Daily Utility Records'
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  sheetName: string;
}> {
  const created = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: { properties?: { title?: string } }[];
  }>(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: MASTER_BACKUP_TAB_NAME } }],
    }),
  });

  const sheetName = created.sheets?.[0]?.properties?.title || MASTER_BACKUP_TAB_NAME;
  const range = encodeURIComponent(quoteSheetRange(sheetName, 'A1:L1'));

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(
      created.spreadsheetId
    )}/values/${range}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [MASTER_BACKUP_HEADER_ROW],
      }),
    }
  );

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    spreadsheetTitle: created.properties?.title || title,
    sheetName,
  };
}

export async function readSheetPreview(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[][]> {
  const range = encodeURIComponent(quoteSheetRange(sheetName, 'A1:L20'));
  const data = await sheetsFetch<{ values?: string[][] }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    accessToken
  );
  return data.values || [];
}

export const APPS_SCRIPT_TEMPLATE = `function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reqTab = (e && e.parameter && e.parameter.tab) ? String(e.parameter.tab) : '';
  var sheet = null;
  if (reqTab) {
    sheet = ss.getSheetByName(reqTab);
  }
  if (!sheet) {
    sheet = ss.getSheetByName('Master_Backup') || ss.getSheetByName('UtilityEntries') || ss.getSheets()[0];
  }
  if (!sheet || sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, sheetName: sheet ? sheet.getName() : '', rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var rows = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, sheetName: sheet.getName(), rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetsPayload = data.sheets;
  if (!sheetsPayload && data.rows) {
    sheetsPayload = [{ tabName: data.sheetName || 'UtilityEntries', rows: data.rows }];
  }
  sheetsPayload = sheetsPayload || [];

  var masterName = data.masterTabName || 'Master_Backup';
  var summaryName = data.summaryTabName || 'Monthly_Summary';
  var totalRows = 0;
  var writtenTabs = {};

  for (var i = 0; i < sheetsPayload.length; i++) {
    var item = sheetsPayload[i];
    var tabName = String(item.tabName || 'UtilityEntries').slice(0, 99);
    writtenTabs[tabName] = true;
    var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
    var rows = item.rows || [];
    sheet.clear();
    if (rows.length > 0) {
      var numCols = rows[0].length;
      sheet.getRange(1, 1, rows.length, numCols).setValues(rows);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, numCols)
        .setFontWeight('bold')
        .setBackground('#0F766E')
        .setFontColor('#FFFFFF');
      if (rows.length > 1) {
        sheet.getRange(2, 4, rows.length - 1, 1).setNumberFormat('#,##0.##');
        sheet.getRange(2, 6, rows.length - 1, 2).setNumberFormat('#,##0.00');
        var lastLabel = String(rows[rows.length - 1][0] || '');
        if (lastLabel === 'Monthly Total') {
          sheet.getRange(rows.length, 1, 1, numCols)
            .setFontWeight('bold')
            .setBackground('#F1F5F9');
        }
      }
      sheet.autoResizeColumns(1, numCols);
      totalRows += Math.max(0, rows.length - 2);
    }
  }

  if (data.pruneStaleTabs) {
    var existingSheets = ss.getSheets();
    for (var p = 0; p < existingSheets.length; p++) {
      var candidate = existingSheets[p];
      var cName = candidate.getName();
      if (cName === masterName || cName === summaryName || cName === 'All_Summary' || writtenTabs[cName]) continue;
      if (candidate.getLastRow() >= 1 && candidate.getLastColumn() >= 2) {
        var hdr = candidate.getRange(1, 1, 1, 2).getValues();
        if (hdr[0][0] === 'Date' && hdr[0][1] === 'Factory' && ss.getSheets().length > 1) {
          ss.deleteSheet(candidate);
        }
      }
    }
  }

  if (data.rebuildSummaryFromWorkbook) {
    var masterRows = [['Year', 'Month', 'Date', 'Factory', 'Utility', 'Consumption', 'Unit', 'Unit Cost (BDT/Unit)', 'Total Cost (BDT)', 'Note', 'Entered By', 'Entry ID']];
    var backupItems = [];
    var monthMap = {};
    var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var allSheets = ss.getSheets();
    for (var s = 0; s < allSheets.length; s++) {
      var sh = allSheets[s];
      var shName = sh.getName();
      if (shName === masterName || shName === summaryName || shName === 'All_Summary') continue;
      var lastRow = sh.getLastRow();
      if (lastRow < 2) continue;
      var vals = sh.getRange(1, 1, lastRow, Math.min(10, sh.getLastColumn())).getValues();
      if (vals[0][0] !== 'Date' || vals[0][1] !== 'Factory') continue;

      for (var r = 1; r < vals.length; r++) {
        var dtVal = vals[r][0];
        var dtStr = dtVal instanceof Date
          ? Utilities.formatDate(dtVal, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
          : String(dtVal || '');
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dtStr)) continue;

        var yr = dtStr.slice(0, 4);
        var mk = dtStr.slice(0, 7);
        var mNum = parseInt(dtStr.slice(5, 7), 10);
        var mLabel = (mNum >= 1 && mNum <= 12) ? monthNames[mNum - 1] + ' ' + yr : mk;
        var fac = String(vals[r][1] || '');
        var util = String(vals[r][2] || '');
        var cons = Number(vals[r][3] || 0);
        var unit = String(vals[r][4] || '');
        var cost = Number(vals[r][5] || 0);
        var unitCost = Number(vals[r][6] || (cons > 0 ? Math.round((cost / cons) * 10000) / 10000 : 0));
        var note = String(vals[r][7] || '');
        var enteredBy = String(vals[r][8] || '');
        var entryId = String(vals[r][9] || '');

        backupItems.push({
          date: dtStr,
          factory: fac,
          utility: util,
          row: [yr, mLabel, dtStr, fac, util, cons, unit, unitCost, cost, note, enteredBy, entryId]
        });

        var key = fac + '|||' + mk;
        if (!monthMap[key]) {
          monthMap[key] = {
            year: yr,
            monthKey: mk,
            monthLabel: mLabel,
            factory: fac,
            tab: shName,
            dates: {},
            count: 0,
            cost: 0
          };
        }
        monthMap[key].dates[dtStr] = true;
        monthMap[key].count += 1;
        monthMap[key].cost += cost;
      }
    }

    backupItems.sort(function(a, b) {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.factory !== b.factory) return a.factory.localeCompare(b.factory);
      return a.utility.localeCompare(b.utility);
    });
    for (var b = 0; b < backupItems.length; b++) {
      masterRows.push(backupItems[b].row);
    }

    var masterSheet = ss.getSheetByName(masterName) || ss.insertSheet(masterName, 0);
    ss.setActiveSheet(masterSheet);
    ss.moveActiveSheet(1);
    masterSheet.clear();
    masterSheet.getRange(1, 1, masterRows.length, masterRows[0].length).setValues(masterRows);
    masterSheet.setFrozenRows(1);
    masterSheet.getRange(1, 1, 1, masterRows[0].length)
      .setFontWeight('bold')
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF');
    if (masterRows.length > 1) {
      masterSheet.getRange(2, 6, masterRows.length - 1, 1).setNumberFormat('#,##0.##');
      masterSheet.getRange(2, 8, masterRows.length - 1, 2).setNumberFormat('#,##0.00');
    }
    masterSheet.autoResizeColumns(1, masterRows[0].length);

    var summaryRows = [['Year', 'Month', 'Factory', 'Sheet Tab', 'Active Days', 'Entries', 'Total Cost (BDT)', 'Avg Daily Cost (BDT)']];
    var records = [];
    for (var k in monthMap) records.push(monthMap[k]);
    records.sort(function(a, b) {
      if (a.monthKey !== b.monthKey) return b.monthKey.localeCompare(a.monthKey);
      return a.factory.localeCompare(b.factory);
    });
    for (var idx = 0; idx < records.length; idx++) {
      var rec = records[idx];
      var dayCount = Object.keys(rec.dates).length || 1;
      summaryRows.push([
        rec.year,
        rec.monthLabel,
        rec.factory,
        rec.tab,
        dayCount,
        rec.count,
        Math.round(rec.cost * 100) / 100,
        Math.round((rec.cost / dayCount) * 100) / 100
      ]);
    }

    var summarySheet = ss.getSheetByName(summaryName) || ss.insertSheet(summaryName, 1);
    ss.setActiveSheet(summarySheet);
    ss.moveActiveSheet(2);
    summarySheet.clear();
    summarySheet.getRange(1, 1, summaryRows.length, summaryRows[0].length).setValues(summaryRows);
    summarySheet.setFrozenRows(1);
    summarySheet.getRange(1, 1, 1, summaryRows[0].length)
      .setFontWeight('bold')
      .setBackground('#1E293B')
      .setFontColor('#FFFFFF');
    if (summaryRows.length > 1) {
      summarySheet.getRange(2, 7, summaryRows.length - 1, 2).setNumberFormat('#,##0.00');
    }
    summarySheet.autoResizeColumns(1, summaryRows[0].length);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, count: totalRows, tabs: sheetsPayload.length }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export function isValidAppsScriptUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(
    url.trim()
  );
}

export function buildSheetValues(
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  companyLabel?: string
): (string | number)[][] {
  const utilMap = new Map(utilities.map((u) => [u.id, u]));
  const sorted = [...entries].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    const compCmp = a.company.localeCompare(b.company);
    if (compCmp !== 0) return compCmp;
    return a.utilityName.localeCompare(b.utilityName);
  });

  let totalCost = 0;
  const dataRows = sorted.map((entry) => {
    const meta = utilMap.get(entry.utilityId);
    const unitCost =
      entry.consumption > 0
        ? Number((entry.cost / entry.consumption).toFixed(4))
        : 0;
    totalCost += entry.cost;
    return [
      entry.date,
      entry.company,
      meta?.name || entry.utilityName,
      entry.consumption,
      meta?.unit || entry.unit,
      entry.cost,
      unitCost,
      entry.note || '',
      entry.enteredByName,
      entry.id,
    ];
  });

  if (dataRows.length === 0) {
    return [SHEET_HEADER_ROW];
  }

  const totalRow: (string | number)[] = [
    'Monthly Total',
    companyLabel || sorted[0]?.company || '',
    '',
    '',
    '',
    Number(totalCost.toFixed(2)),
    '',
    `${dataRows.length} entries`,
    '',
    '',
  ];

  return [SHEET_HEADER_ROW, ...dataRows, totalRow];
}

export function buildMasterBackupRows(
  entries: UtilityEntry[],
  utilities: UtilityItem[]
): (string | number)[][] {
  const utilMap = new Map(utilities.map((u) => [u.id, u]));
  const sorted = [...entries].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const compCmp = a.company.localeCompare(b.company);
    if (compCmp !== 0) return compCmp;
    return a.utilityName.localeCompare(b.utilityName);
  });

  const dataRows = sorted.map((entry) => {
    const meta = utilMap.get(entry.utilityId);
    const year = entry.date.slice(0, 4);
    const monthLabel = formatMonthYearLabel(entry.date.slice(0, 7));
    const unitCost =
      entry.consumption > 0
        ? Number((entry.cost / entry.consumption).toFixed(4))
        : 0;
    return [
      year,
      monthLabel,
      entry.date,
      entry.company,
      meta?.name || entry.utilityName,
      entry.consumption,
      meta?.unit || entry.unit,
      unitCost,
      entry.cost,
      entry.note || '',
      entry.enteredByName,
      entry.id,
    ];
  });

  return [MASTER_BACKUP_HEADER_ROW, ...dataRows];
}

export function buildFactoryMonthlySheetsPayload(
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
    includeMasterAndSummaryTabs?: boolean;
  }
): {
  tabs: SheetTabPayload[];
  totalRows: number;
} {
  const grouped = new Map<
    string,
    { company: string; monthKey: string; tabName: string; items: UtilityEntry[] }
  >();

  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7);
    const key = `${entry.company}|||${monthKey}`;
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = {
        company: entry.company,
        monthKey,
        tabName: formatFactoryMonthTabName(entry.company, monthKey),
        items: [],
      };
      grouped.set(key, bucket);
    }
    bucket.items.push(entry);
  }

  if (options?.ensureTabKeys) {
    for (const extra of options.ensureTabKeys) {
      const monthKey = extra.monthKey.slice(0, 7);
      if (!extra.company || !/^\d{4}-\d{2}$/.test(monthKey)) continue;
      const key = `${extra.company}|||${monthKey}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          company: extra.company,
          monthKey,
          tabName: formatFactoryMonthTabName(extra.company, monthKey),
          items: [],
        });
      }
    }
  }

  const sortedBuckets = Array.from(grouped.values()).sort((a, b) => {
    const monthCmp = b.monthKey.localeCompare(a.monthKey);
    if (monthCmp !== 0) return monthCmp;
    return a.company.localeCompare(b.company);
  });

  const tabs: SheetTabPayload[] = [];

  if (options?.includeMasterAndSummaryTabs) {
    tabs.push({
      tabName: MASTER_BACKUP_TAB_NAME,
      rows: buildMasterBackupRows(entries, utilities),
    });

    const summaryRows: (string | number)[][] = [SUMMARY_HEADER_ROW];
    for (const bucket of sortedBuckets) {
      if (bucket.items.length === 0) continue;
      const year = bucket.monthKey.slice(0, 4);
      const monthLabel = formatMonthYearLabel(bucket.monthKey);
      const distinctDates = new Set(bucket.items.map((i) => i.date));
      const totalCost = bucket.items.reduce((sum, i) => sum + i.cost, 0);
      const avgDaily =
        distinctDates.size > 0 ? totalCost / distinctDates.size : 0;

      summaryRows.push([
        year,
        monthLabel,
        bucket.company,
        bucket.tabName,
        distinctDates.size,
        bucket.items.length,
        Number(totalCost.toFixed(2)),
        Number(avgDaily.toFixed(2)),
      ]);
    }
    tabs.push({
      tabName: SUMMARY_TAB_NAME,
      rows: summaryRows,
    });
  }

  let totalRows = 0;
  for (const bucket of sortedBuckets) {
    const rows = buildSheetValues(bucket.items, utilities, bucket.company);
    totalRows += bucket.items.length;
    tabs.push({
      tabName: bucket.tabName,
      rows,
    });
  }

  return { tabs, totalRows };
}

export async function syncViaAppsScriptWebhook(
  webhookUrl: string,
  _sheetName: string,
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
    pruneStaleTabs?: boolean;
  }
): Promise<number> {
  const trimmed = webhookUrl.trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'Invalid Google Apps Script Web App URL. It must end with /exec.'
    );
  }

  const { tabs, totalRows } = buildFactoryMonthlySheetsPayload(
    entries,
    utilities,
    {
      ensureTabKeys: options?.ensureTabKeys,
      includeMasterAndSummaryTabs: false,
    }
  );

  const res = await fetch(trimmed, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      sheets: tabs,
      masterTabName: MASTER_BACKUP_TAB_NAME,
      summaryTabName: SUMMARY_TAB_NAME,
      rebuildSummaryFromWorkbook: true,
      pruneStaleTabs: Boolean(options?.pruneStaleTabs),
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Apps Script sync failed (${res.status}). Check deployment access is set to "Anyone".`
    );
  }

  const payload = (await res.json().catch(() => null)) as
    | { ok?: boolean; count?: number; error?: string }
    | null;
  if (payload && payload.ok === false) {
    throw new Error(payload.error || 'Apps Script returned an error.');
  }

  return totalRows;
}

export async function syncEntriesToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  _sheetName: string,
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
    pruneStaleTabs?: boolean;
  }
): Promise<number> {
  const { tabs, totalRows } = buildFactoryMonthlySheetsPayload(
    entries,
    utilities,
    {
      ensureTabKeys: options?.ensureTabKeys,
      includeMasterAndSummaryTabs: true,
    }
  );

  if (tabs.length === 0) {
    return 0;
  }

  const fullMeta = await sheetsFetch<{
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets.properties(sheetId,title)`,
    accessToken
  );

  const sheetList = (fullMeta.sheets || [])
    .map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title || '',
    }))
    .filter((s) => Boolean(s.title));

  const existingSet = new Set(sheetList.map((s) => s.title));
  const missingTabs = tabs.filter((t) => !existingSet.has(t.tabName));

  if (missingTabs.length > 0) {
    await sheetsFetch(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTabs.map((t) => ({
            addSheet: {
              properties: {
                title: t.tabName,
              },
            },
          })),
        }),
      }
    );
  }

  const rangesToClear = tabs.map((t) => quoteSheetRange(t.tabName, 'A1:L'));
  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        ranges: rangesToClear,
      }),
    }
  );

  const dataToWrite = tabs.map((t) => {
    const endCol =
      t.tabName === MASTER_BACKUP_TAB_NAME
        ? 'L'
        : t.tabName === SUMMARY_TAB_NAME
        ? 'H'
        : 'J';
    return {
      range: quoteSheetRange(t.tabName, `A1:${endCol}${t.rows.length}`),
      values: t.rows,
    };
  });

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: dataToWrite,
      }),
    }
  );

  if (options?.pruneStaleTabs) {
    const desiredNames = new Set(tabs.map((t) => t.tabName));
    const candidates = sheetList.filter(
      (s) =>
        typeof s.sheetId === 'number' &&
        s.title !== MASTER_BACKUP_TAB_NAME &&
        s.title !== SUMMARY_TAB_NAME &&
        s.title !== 'All_Summary' &&
        !desiredNames.has(s.title)
    );

    if (candidates.length > 0) {
      const headerQuery = candidates
        .map((c) => `ranges=${encodeURIComponent(quoteSheetRange(c.title, 'A1:B1'))}`)
        .join('&');
      const headerRes = await sheetsFetch<{
        valueRanges?: { values?: string[][] }[];
      }>(
        `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${headerQuery}`,
        accessToken
      );

      const deleteRequests: { deleteSheet: { sheetId: number } }[] = [];
      candidates.forEach((cand, idx) => {
        const firstRow = headerRes.valueRanges?.[idx]?.values?.[0] || [];
        if (firstRow[0] === 'Date' && firstRow[1] === 'Factory' && typeof cand.sheetId === 'number') {
          deleteRequests.push({ deleteSheet: { sheetId: cand.sheetId } });
        }
      });

      if (deleteRequests.length > 0) {
        await sheetsFetch(
          `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({ requests: deleteRequests }),
          }
        );
      }
    }
  }

  return totalRows;
}

export async function fetchRowsFromAppsScriptWebhook(
  webhookUrl: string,
  tabName?: string
): Promise<{ sheetName: string; rows: string[][] }> {
  const trimmed = webhookUrl.trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'Invalid Google Apps Script Web App URL. It must end with /exec.'
    );
  }

  const url = tabName
    ? `${trimmed}?tab=${encodeURIComponent(tabName)}`
    : trimmed;

  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `Apps Script read failed (${res.status}). Ensure your script includes doGet(e) and a New version is deployed.`
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    ok?: boolean;
    sheetName?: string;
    rows?: string[][];
    error?: string;
  } | null;

  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error(
      'Apps Script did not return sheet rows. Update your Apps Script with the latest v3 code (including doGet) and deploy a New version.'
    );
  }

  if (payload.ok === false) {
    throw new Error(payload.error || 'Apps Script returned an error while reading.');
  }

  return {
    sheetName: String(payload.sheetName || tabName || MASTER_BACKUP_TAB_NAME),
    rows: payload.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])),
  };
}

export async function readAllRowsFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[][]> {
  const range = encodeURIComponent(quoteSheetRange(sheetName, 'A1:L5000'));
  const data = await sheetsFetch<{ values?: string[][] }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    accessToken
  );
  return data.values || [];
}

const isValidCalendarDate = (y: number, m: number, d: number): boolean => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

export function normalizeImportedDate(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarDate(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (y >= 2000 && y <= 2100) {
      let m = first;
      let d = second;
      if (first > 12 && second <= 12) {
        d = first;
        m = second;
      }
      if (isValidCalendarDate(y, m, d)) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  const textMonthIdx = (tok: string) =>
    MONTH_SHORT_NAMES.findIndex((m) => tok.toLowerCase().startsWith(m.toLowerCase()));

  const dmyText = trimmed.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (dmyText) {
    const d = Number(dmyText[1]);
    const m = textMonthIdx(dmyText[2]) + 1;
    const y = Number(dmyText[3]);
    if (isValidCalendarDate(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const mdyText = trimmed.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2})[\s,-]+(\d{4})$/);
  if (mdyText) {
    const m = textMonthIdx(mdyText[1]) + 1;
    const d = Number(mdyText[2]);
    const y = Number(mdyText[3]);
    if (isValidCalendarDate(y, m, d)) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

export function parseNumberString(raw: string): number | null {
  const cleaned = String(raw || '')
    .replace(/BDT|৳|,|\s+/gi, '')
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export interface ImportedSheetRow {
  entryId: string;
  date: string;
  company: string;
  utilityId: string;
  utilityName: string;
  unit: string;
  consumption: number;
  cost: number;
  note: string;
  enteredByName: string;
}

export function parseImportedSheetRows(
  rawRows: string[][],
  existingCompanies: CompanyItem[],
  existingUtilities: UtilityItem[]
): {
  items: ImportedSheetRow[];
  newCompanies: string[];
  skipped: number;
} {
  if (!rawRows || rawRows.length === 0) {
    return { items: [], newCompanies: [], skipped: 0 };
  }

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const normalized = rawRows[i].map((c) => String(c || '').trim().toLowerCase());
    const hasDate = normalized.some((c) => c === 'date');
    const hasCompany = normalized.some((c) => c === 'factory' || c === 'company');
    const hasUtility = normalized.some((c) => c === 'utility' || c === 'utility name');
    if (hasDate && hasCompany && hasUtility) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(
      'Could not find Utility Hub columns (Date, Factory, Utility) in the selected Google Sheet.'
    );
  }

  const headers = rawRows[headerRowIdx].map((c) =>
    String(c || '').trim().toLowerCase()
  );

  const findCol = (candidates: string[], excludeSubstr?: string) =>
    headers.findIndex((h) => {
      if (excludeSubstr && h.includes(excludeSubstr)) return false;
      return candidates.some((cand) => h === cand || h.startsWith(cand));
    });

  const dateIdx = findCol(['date']);
  const companyIdx = findCol(['factory', 'company']);
  const utilityIdx = findCol(['utility name', 'utility']);
  const consumptionIdx = findCol(['consumption']);
  const unitIdx = findCol(['unit'], 'cost');
  const costIdx = findCol(['total cost', 'cost (bdt)', 'cost'], 'unit cost');
  const unitCostIdx = findCol(['unit cost']);
  const noteIdx = findCol(['note']);
  const enteredByIdx = findCol(['entered by']);
  const entryIdIdx = findCol(['entry id', 'id']);

  const companyByLower = new Map<string, string>();
  for (const c of existingCompanies) {
    companyByLower.set(c.name.trim().toLowerCase(), c.name);
  }

  const utilityByLower = new Map<string, UtilityItem>();
  for (const u of existingUtilities) {
    utilityByLower.set(u.name.trim().toLowerCase(), u);
    utilityByLower.set(u.id.trim().toLowerCase(), u);
  }

  const items: ImportedSheetRow[] = [];
  const newCompanySet = new Set<string>();
  let skipped = 0;

  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.every((c) => !String(c || '').trim())) continue;

    const rawDate = String(row[dateIdx] || '').trim();
    if (rawDate.toLowerCase() === 'monthly total') continue;

    const normalizedDate = normalizeImportedDate(rawDate);
    const rawCompany = String(row[companyIdx] || '').trim();
    const rawUtility = String(row[utilityIdx] || '').trim();

    if (!normalizedDate || !rawCompany || !rawUtility) {
      skipped += 1;
      continue;
    }

    const utilMeta = utilityByLower.get(rawUtility.toLowerCase());
    if (!utilMeta) {
      skipped += 1;
      continue;
    }

    const canonicalCompany =
      companyByLower.get(rawCompany.toLowerCase()) || rawCompany.slice(0, 100);
    if (!companyByLower.has(canonicalCompany.toLowerCase())) {
      companyByLower.set(canonicalCompany.toLowerCase(), canonicalCompany);
      newCompanySet.add(canonicalCompany);
    }

    const consumption =
      consumptionIdx >= 0 ? parseNumberString(row[consumptionIdx] || '') ?? 0 : 0;
    let cost = costIdx >= 0 ? parseNumberString(row[costIdx] || '') : null;
    const unitCost =
      unitCostIdx >= 0 ? parseNumberString(row[unitCostIdx] || '') : null;

    if (cost === null) {
      if (unitCost !== null && consumption > 0) {
        cost = Number((consumption * unitCost).toFixed(2));
      } else {
        cost = 0;
      }
    }

    const rawUnit = unitIdx >= 0 ? String(row[unitIdx] || '').trim() : '';
    const note = noteIdx >= 0 ? String(row[noteIdx] || '').trim().slice(0, 300) : '';
    const enteredByName =
      enteredByIdx >= 0 ? String(row[enteredByIdx] || '').trim().slice(0, 100) : '';
    const rawEntryId =
      entryIdIdx >= 0 ? String(row[entryIdIdx] || '').trim() : '';

    items.push({
      entryId: rawEntryId,
      date: normalizedDate,
      company: canonicalCompany,
      utilityId: utilMeta.id,
      utilityName: utilMeta.name,
      unit: rawUnit || utilMeta.unit,
      consumption,
      cost,
      note,
      enteredByName,
    });
  }

  return {
    items,
    newCompanies: Array.from(newCompanySet),
    skipped,
  };
}
