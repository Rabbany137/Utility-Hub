import type {
  CompanyItem,
  GenerationEntry,
  UtilityEntry,
  UtilityItem,
} from '../types';
import { buildFactoryIssueLookupForSheet } from '../utils/analyticsValidation';

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

const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MASTER_BACKUP_TAB_NAME = 'Master_Backup';
export const SUMMARY_TAB_NAME = 'Executive_Summary';
const LEGACY_SUMMARY_TAB_NAMES = new Set(['Monthly_Summary', 'All_Summary']);

export const MASTER_BACKUP_HEADER_ROW: string[] = [
  'Year',
  'Month',
  'Date',
  'Factory',
  'Utility',
  'Consumption',
  'Unit',
  'Operating Hours',
  'Rate/Hr',
  'Unit Cost (BDT/Unit)',
  'Total Cost (BDT)',
  'Note',
  'Entered By',
  'Entry ID',
];

export const EXECUTIVE_SUMMARY_HEADER_ROW: string[] = [
  'Year',
  'Factory',
  'Report Tab',
  'Active Days',
  'Asset Run Hrs',
  'Hrs Logged %',
  'Total Spend (BDT)',
  'Avg Daily Spend (BDT)',
  'Blended Rate (BDT/Hr)',
  'Boiler Steam (kg)',
  'Gen + Solar (kWh)',
  'Solar Saved (BDT)',
  'Audit Flags',
];

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  sheetNames: string[];
}

export interface SheetMergeRange {
  startRow: number; // 0-indexed inclusive
  endRow: number; // 0-indexed exclusive
  startCol: number; // 0-indexed inclusive
  endCol: number; // 0-indexed exclusive
}

export interface SheetGroupHeaderColor {
  startCol: number; // 0-indexed inclusive
  endCol: number; // 0-indexed exclusive
  bgHex: string;
}

export interface SheetTabPayload {
  tabName: string;
  kind: 'summary' | 'factoryYear' | 'masterBackup';
  tabColorHex: string;
  rows: (string | number)[][];
  freezeRows: number;
  freezeCols: number;
  headerRowIndex: number; // 0-indexed row index of main column headers
  groupHeaderRowIndex?: number; // 0-indexed row index of grouped super-headers (Row 3 => 2)
  merges: SheetMergeRange[];
  groupColors: SheetGroupHeaderColor[];
  subtotalRows: number[]; // 0-indexed row indices
  annualTotalRows: number[]; // 0-indexed row indices
  qtyCols: number[]; // 0-indexed (#,##0.##)
  hrsCols: number[]; // 0-indexed (0.##)
  currencyCols: number[]; // 0-indexed (#,##0.00)
  intCols: number[]; // 0-indexed (#,##0)
  pctCols?: number[]; // 0-indexed (0.0%)
  centerCols?: number[]; // 0-indexed CENTER aligned columns
  wrapCols?: number[]; // 0-indexed WRAP text columns
  auditColIndex?: number; // 0-indexed Audit Flag column
  basicFilterRange?: SheetMergeRange;
  colWidths: number[]; // pixel width per column
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

export function columnIndexToA1(colIndexZeroBased: number): string {
  let n = colIndexZeroBased + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || 'A';
}

function hexToRgbColor(hex: string): { red: number; green: number; blue: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const int = parseInt(full, 16);
  return {
    red: ((int >> 16) & 255) / 255,
    green: ((int >> 8) & 255) / 255,
    blue: (int & 255) / 255,
  };
}

function makeSolidBorders(hex = '#CBD5E1', style: 'SOLID' | 'SOLID_MEDIUM' = 'SOLID') {
  const color = hexToRgbColor(hex);
  const side = { style, width: style === 'SOLID_MEDIUM' ? 2 : 1, color };
  return { top: side, bottom: side, left: side, right: side };
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

export function formatWeekdayShort(dateIso: string): string {
  const parts = dateIso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return '';
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return WEEKDAY_SHORT_NAMES[dt.getDay()] || '';
}

export function formatFactoryYearTabName(company: string, dateOrYear: string): string {
  const year = dateOrYear.slice(0, 4);
  const suffix = ` - ${year}`;
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
    return `${cleanCompany} Report${suffix}`.slice(0, 99);
  }
  return candidate;
}

export function formatFactoryMonthTabName(company: string, dateOrMonth: string): string {
  return formatFactoryYearTabName(company, dateOrMonth.slice(0, 4));
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
    spreadsheetTitle: data.properties?.title || 'Utility Hub Report Workbook',
    sheetNames,
  };
}

export async function createUtilitySpreadsheet(
  accessToken: string,
  title = 'Utility Hub — Annual Factory Reports'
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
      sheets: [{ properties: { title: SUMMARY_TAB_NAME } }],
    }),
  });

  const sheetName = created.sheets?.[0]?.properties?.title || SUMMARY_TAB_NAME;
  const headerEndCol = columnIndexToA1(EXECUTIVE_SUMMARY_HEADER_ROW.length - 1);
  const range = encodeURIComponent(quoteSheetRange(sheetName, `A1:${headerEndCol}1`));

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(
      created.spreadsheetId
    )}/values/${range}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [EXECUTIVE_SUMMARY_HEADER_ROW],
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
  const range = encodeURIComponent(quoteSheetRange(sheetName, 'A1:P25'));
  const data = await sheetsFetch<{ values?: string[][] }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    accessToken
  );
  return data.values || [];
}

export const APPS_SCRIPT_TEMPLATE = `function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mode = (e && e.parameter && e.parameter.mode) ? String(e.parameter.mode) : '';

  if (mode === 'workbook') {
    var allSheets = ss.getSheets();
    var tabsOut = [];
    for (var i = 0; i < allSheets.length; i++) {
      var sh = allSheets[i];
      var name = sh.getName();
      var isFactoryYear = / - \\d{4}$/.test(name);
      if (name !== 'Master_Backup' && !isFactoryYear) continue;
      if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
        tabsOut.push({ tabName: name, rows: [] });
        continue;
      }
      var tabRows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      tabsOut.push({ tabName: name, rows: tabRows });
    }
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        version: 6,
        mode: 'workbook',
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        spreadsheetTitle: ss.getName(),
        tabs: tabsOut
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var reqTab = (e && e.parameter && e.parameter.tab) ? String(e.parameter.tab) : '';
  var sheet = reqTab ? ss.getSheetByName(reqTab) : null;
  if (!sheet) {
    sheet = ss.getSheetByName('Master_Backup') || ss.getSheetByName('Executive_Summary') || ss.getSheets()[0];
  }
  if (!sheet || sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, version: 6, sheetName: sheet ? sheet.getName() : '', rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var rows = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, version: 6, sheetName: sheet.getName(), rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // Action 1: Direct HTML email dispatch via Google Apps Script MailApp
  if (data.action === 'sendDailyReport') {
    var recipient = String(data.to || '').trim();
    var subject = String(data.subject || 'Utility Hub Daily Report');
    var htmlBody = String(data.htmlBody || '');
    var textBody = String(data.textBody || 'Please open this report in an HTML-capable email client.');
    if (!recipient) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'Recipient email is required.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody
    });
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, sentTo: recipient }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Action 2: Persist per-user scheduled push mail roster in ScriptProperties
  if (data.action === 'saveMailSchedules') {
    var schedules = Array.isArray(data.schedules) ? data.schedules : [];
    PropertiesService.getScriptProperties().setProperty('DAILY_MAIL_SCHEDULES', JSON.stringify(schedules));
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, saved: schedules.length }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetsPayload = data.sheets || [];
  var totalRows = Number(data.totalRows || 0);
  var writtenTabs = {};
  var preserveTabs = { 'Executive_Summary': true, 'Master_Backup': true };

  // Pre-create all tabs first so cross-tab formulas in Executive_Summary resolve immediately
  for (var pIdx = 0; pIdx < sheetsPayload.length; pIdx++) {
    var preName = String(sheetsPayload[pIdx].tabName || 'Report').slice(0, 99);
    if (!ss.getSheetByName(preName)) ss.insertSheet(preName);
  }

  for (var i = 0; i < sheetsPayload.length; i++) {
    var item = sheetsPayload[i];
    var tabName = String(item.tabName || 'Report').slice(0, 99);
    writtenTabs[tabName] = true;
    var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
    if (sheet.getFilter()) sheet.getFilter().remove();
    sheet.clearConditionalFormatRules();
    sheet.clear();
    if (item.tabColorHex) {
      try { sheet.setTabColor(item.tabColorHex); } catch (err) {}
    }

    var rows = item.rows || [];
    if (rows.length === 0) continue;
    var numRows = rows.length;
    var numCols = rows[0].length;

    sheet.getRange(1, 1, numRows, numCols).setValues(rows);
    sheet.setFrozenRows(Number(item.freezeRows || 1));
    if (item.freezeCols) sheet.setFrozenColumns(Number(item.freezeCols));

    var fullRange = sheet.getRange(1, 1, numRows, numCols);
    fullRange.setVerticalAlignment('middle').setFontFamily('Arial').setFontSize(9.5).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    var headerIdx = Number(item.headerRowIndex || 0);
    var firstDataRow = headerIdx + 2; // 1-indexed

    if (firstDataRow <= numRows) {
      var dataCount = numRows - firstDataRow + 1;
      sheet.getRange(firstDataRow, 1, dataCount, numCols)
        .setBorder(true, true, true, true, true, true, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
      sheet.setRowHeights(firstDataRow, dataCount, 24);

      var bgs = [];
      for (var r = 0; r < dataCount; r++) {
        var rowBg = (r % 2 === 1) ? '#F8FAFC' : '#FFFFFF';
        var rowColors = [];
        for (var c = 0; c < numCols; c++) rowColors.push(rowBg);
        bgs.push(rowColors);
      }
      sheet.getRange(firstDataRow, 1, dataCount, numCols).setBackgrounds(bgs);

      var centerCols = item.centerCols || [];
      for (var cnc = 0; cnc < centerCols.length; cnc++) {
        sheet.getRange(firstDataRow, centerCols[cnc] + 1, dataCount, 1).setHorizontalAlignment('center');
      }
      var wrapCols = item.wrapCols || [];
      for (var wnc = 0; wnc < wrapCols.length; wnc++) {
        sheet.getRange(firstDataRow, wrapCols[wnc] + 1, dataCount, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
      }

      var intCols = item.intCols || [];
      for (var ic = 0; ic < intCols.length; ic++) {
        sheet.getRange(firstDataRow, intCols[ic] + 1, dataCount, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
      }
      var qtyCols = item.qtyCols || [];
      for (var qc = 0; qc < qtyCols.length; qc++) {
        sheet.getRange(firstDataRow, qtyCols[qc] + 1, dataCount, 1).setNumberFormat('#,##0.##').setHorizontalAlignment('right');
      }
      var hrsCols = item.hrsCols || [];
      for (var hc = 0; hc < hrsCols.length; hc++) {
        sheet.getRange(firstDataRow, hrsCols[hc] + 1, dataCount, 1).setNumberFormat('0.##').setHorizontalAlignment('right');
      }
      var curCols = item.currencyCols || [];
      for (var cc = 0; cc < curCols.length; cc++) {
        sheet.getRange(firstDataRow, curCols[cc] + 1, dataCount, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
      }
      var pctCols = item.pctCols || [];
      for (var pc = 0; pc < pctCols.length; pc++) {
        sheet.getRange(firstDataRow, pctCols[pc] + 1, dataCount, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');
      }

      if (typeof item.auditColIndex === 'number') {
        var auditColNum = item.auditColIndex + 1;
        var auditRange = sheet.getRange(firstDataRow, auditColNum, dataCount, 1);
        auditRange.setHorizontalAlignment('center');
        var auditColA1 = auditRange.getA1Notation().replace(/[0-9:]+.*/, '');
        var okRule = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=AND(LEFT($A' + firstDataRow + ',8)<>"SUBTOTAL",LEFT($A' + firstDataRow + ',6)<>"ANNUAL",LEFT($A' + firstDataRow + ',3)<>"ALL",ISNUMBER(SEARCH("Verified",' + auditColA1 + firstDataRow + ')))')
          .setBackground('#ECFDF5')
          .setFontColor('#065F46')
          .setBold(true)
          .setRanges([auditRange])
          .build();
        var flagRule = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=AND(LEFT($A' + firstDataRow + ',8)<>"SUBTOTAL",LEFT($A' + firstDataRow + ',6)<>"ANNUAL",LEFT($A' + firstDataRow + ',3)<>"ALL",LEN(' + auditColA1 + firstDataRow + ')>0,ISERROR(SEARCH("Verified",' + auditColA1 + firstDataRow + ')))')
          .setBackground('#FEF3C7')
          .setFontColor('#92400E')
          .setBold(true)
          .setRanges([auditRange])
          .build();
        sheet.setConditionalFormatRules([okRule, flagRule]);
      }
    }

    if (item.basicFilterRange) {
      var bf = item.basicFilterRange;
      var bfRows = bf.endRow - bf.startRow;
      var bfCols = bf.endCol - bf.startCol;
      if (bfRows > 1 && bfCols > 0) {
        sheet.getRange(bf.startRow + 1, bf.startCol + 1, bfRows, bfCols).createFilter();
      }
    }

    var merges = item.merges || [];
    for (var m = 0; m < merges.length; m++) {
      var mg = merges[m];
      if (mg.endCol > mg.startCol && mg.endRow > mg.startRow) {
        sheet.getRange(mg.startRow + 1, mg.startCol + 1, mg.endRow - mg.startRow, mg.endCol - mg.startCol).merge();
      }
    }

    if (item.kind !== 'masterBackup') {
      sheet.getRange(1, 1, 1, numCols)
        .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');
      sheet.setRowHeight(1, 36);
      if (numRows >= 2) {
        sheet.getRange(2, 1, 1, numCols)
          .setBackground('#F1F5F9').setFontColor('#334155').setFontSize(9.5).setHorizontalAlignment('left')
          .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
          .setBorder(null, null, true, null, null, null, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
        sheet.setRowHeight(2, 26);
      }
      if (typeof item.groupHeaderRowIndex === 'number') {
        var gRow = item.groupHeaderRowIndex + 1;
        sheet.setRowHeight(gRow, 25);
        var gColors = item.groupColors || [];
        for (var g = 0; g < gColors.length; g++) {
          var gc = gColors[g];
          sheet.getRange(gRow, gc.startCol + 1, 1, gc.endCol - gc.startCol)
            .setBackground(gc.bgHex).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9.5).setHorizontalAlignment('center')
            .setBorder(true, true, true, true, null, null, '#FFFFFF', SpreadsheetApp.BorderStyle.SOLID);
        }
      }
      var colHdrRow = headerIdx + 1;
      sheet.setRowHeight(colHdrRow, 28);
      sheet.getRange(colHdrRow, 1, 1, numCols)
        .setBackground('#E2E8F0').setFontColor('#0F172A').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center')
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
        .setBorder(true, true, true, true, true, null, '#94A3B8', SpreadsheetApp.BorderStyle.SOLID);
    } else {
      sheet.setRowHeight(1, 28);
      sheet.getRange(1, 1, 1, numCols)
        .setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9.5).setHorizontalAlignment('center')
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    }

    var subRows = item.subtotalRows || [];
    for (var sr = 0; sr < subRows.length; sr++) {
      var rNum = subRows[sr] + 1;
      sheet.getRange(rNum, 1, 1, numCols)
        .setBackground('#E2E8F0').setFontColor('#0F172A').setFontWeight('bold')
        .setBorder(true, true, true, true, true, null, '#94A3B8', SpreadsheetApp.BorderStyle.SOLID);
      sheet.getRange(rNum, 1, 1, Math.min(3, numCols)).setHorizontalAlignment('left');
      sheet.setRowHeight(rNum, 26);
    }

    var totRows = item.annualTotalRows || [];
    for (var tr = 0; tr < totRows.length; tr++) {
      var tNum = totRows[tr] + 1;
      sheet.getRange(tNum, 1, 1, numCols)
        .setBackground('#CCFBF1').setFontColor('#0F172A').setFontWeight('bold').setFontSize(10)
        .setBorder(true, true, true, true, true, null, '#0F766E', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
      sheet.getRange(tNum, 1, 1, Math.min(3, numCols)).setHorizontalAlignment('left');
      sheet.setRowHeight(tNum, 28);
    }

    var widths = item.colWidths || [];
    for (var w = 0; w < widths.length; w++) {
      sheet.setColumnWidth(w + 1, Number(widths[w] || 100));
    }
  }

  SpreadsheetApp.flush();

  for (var idx = 0; idx < sheetsPayload.length; idx++) {
    var targetSheet = ss.getSheetByName(String(sheetsPayload[idx].tabName || '').slice(0, 99));
    if (targetSheet) {
      ss.setActiveSheet(targetSheet);
      ss.moveActiveSheet(idx + 1);
    }
  }

  if (data.pruneStaleTabs) {
    var existingSheets = ss.getSheets();
    for (var p = 0; p < existingSheets.length; p++) {
      var candidate = existingSheets[p];
      var cName = candidate.getName();
      if (writtenTabs[cName] || preserveTabs[cName]) continue;
      if (ss.getSheets().length <= 1) continue;
      if (cName === 'Monthly_Summary' || cName === 'All_Summary' || cName === 'UtilityEntries') {
        ss.deleteSheet(candidate);
        continue;
      }
      if (candidate.getLastRow() >= 1 && candidate.getLastColumn() >= 1) {
        var topLeft = String(candidate.getRange(1, 1).getValue() || '');
        if (topLeft === 'Date' || topLeft.indexOf('Annual Utility') >= 0 || topLeft.indexOf('Executive') >= 0) {
          ss.deleteSheet(candidate);
        }
      }
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, count: totalRows, tabs: sheetsPayload.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once manually inside Apps Script Editor to enable automated every-15-min schedule checks
function installDailyMailTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendScheduledDailyUtilityReports') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendScheduledDailyUtilityReports').timeBased().everyMinutes(15).create();
}

function sendScheduledDailyUtilityReports() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('DAILY_MAIL_SCHEDULES');
  if (!raw) return;
  var schedules = JSON.parse(raw);
  if (!Array.isArray(schedules) || schedules.length === 0) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Dhaka';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var hhmmNow = Utilities.formatDate(now, tz, 'HH:mm');
  var yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  var reportDate = Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd');

  var master = ss.getSheetByName('Master_Backup');
  var rows = (master && master.getLastRow() > 1) ? master.getDataRange().getValues() : [];

  for (var s = 0; s < schedules.length; s++) {
    var sched = schedules[s];
    if (!sched || !sched.email || !sched.time) continue;
    var sentKey = 'DAILY_SENT_' + String(sched.uid || sched.email);
    if (props.getProperty(sentKey) === todayStr) continue;
    if (hhmmNow < String(sched.time)) continue;

    var allowedSet = Array.isArray(sched.companies) && sched.companies.length > 0 ? sched.companies : null;
    var totalCost = 0;
    var rowHtml = '';

    for (var r = 1; r < rows.length; r++) {
      var dStr = String(rows[r][2] || '').slice(0, 10);
      var comp = String(rows[r][3] || '');
      if (dStr !== reportDate) continue;
      if (allowedSet && allowedSet.indexOf(comp) === -1) continue;
      var utilName = String(rows[r][4] || '');
      var cons = Number(rows[r][5] || 0);
      var unit = String(rows[r][6] || '');
      var hrs = Number(rows[r][7] || 0);
      var cost = Number(rows[r][10] || 0);
      totalCost += cost;
      rowHtml += '<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">' + comp + '</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">' + utilName + '</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">' + cons.toFixed(2) + ' ' + unit + '</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">' + hrs.toFixed(1) + 'h</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold;">৳' + cost.toFixed(2) + '</td></tr>';
    }

    var html = '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">' +
      '<div style="background:#0F172A;color:#fff;padding:18px 20px;"><div style="font-size:11px;color:#5EEAD4;font-weight:bold;">UTILITY HUB DAILY REPORT</div><div style="font-size:18px;font-weight:bold;margin-top:4px;">Daily Summary for ' + reportDate + '</div></div>' +
      '<div style="padding:16px 20px;font-size:13px;color:#334155;"><p>Hello <strong>' + String(sched.name || 'Team') + '</strong>,</p><p>Total utility spend on <strong>' + reportDate + '</strong>: <strong style="color:#0F172A;">৳' + totalCost.toFixed(2) + '</strong></p>' +
      '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;"><thead><tr style="background:#f1f5f9;"><th align="left" style="padding:7px 8px;">Factory</th><th align="left" style="padding:7px 8px;">Utility</th><th align="right" style="padding:7px 8px;">Cons</th><th align="right" style="padding:7px 8px;">Hrs</th><th align="right" style="padding:7px 8px;">Cost</th></tr></thead><tbody>' +
      (rowHtml || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#64748b;">No entries logged for ' + reportDate + '</td></tr>') +
      '</tbody></table></div></div>';

    MailApp.sendEmail({
      to: String(sched.email),
      subject: 'Utility Hub Daily Report · ' + reportDate + ' · ৳' + totalCost.toFixed(2),
      body: 'Utility Hub Daily Report for ' + reportDate + ' | Total Spend: ৳' + totalCost.toFixed(2),
      htmlBody: html
    });
    props.setProperty(sentKey, todayStr);
  }
}`;

export function isValidAppsScriptUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(
    url.trim()
  );
}

interface DayConsolidatedRecord {
  date: string;
  monthKey: string;
  utilities: Map<string, UtilityEntry>;
  generation?: GenerationEntry;
}

function roundNum(val: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(val * factor) / factor;
}

export function buildMasterBackupPayload(
  entries: UtilityEntry[],
  utilities: UtilityItem[]
): SheetTabPayload {
  const utilMap = new Map(utilities.map((u) => [u.id, u]));
  const sorted = [...entries].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    const compCmp = a.company.localeCompare(b.company);
    if (compCmp !== 0) return compCmp;
    return a.utilityName.localeCompare(b.utilityName);
  });

  const dataRows: (string | number)[][] = sorted.map((entry, idx) => {
    const meta = utilMap.get(entry.utilityId);
    const year = entry.date.slice(0, 4);
    const monthLabel = formatMonthYearLabel(entry.date.slice(0, 7));
    const hrs = Number(entry.operatingHours ?? 0);
    const r1 = idx + 2; // 1-indexed Excel row

    return [
      year,
      monthLabel,
      entry.date,
      entry.company,
      meta?.name || entry.utilityName,
      entry.consumption,
      meta?.unit || entry.unit,
      hrs,
      `=IF(AND(H${r1}>0,F${r1}>0),F${r1}/H${r1},0)`,
      `=IF(F${r1}>0,K${r1}/F${r1},0)`,
      entry.cost,
      entry.note || '',
      entry.enteredByName,
      entry.id,
    ];
  });

  const rows: (string | number)[][] = [MASTER_BACKUP_HEADER_ROW, ...dataRows];

  return {
    tabName: MASTER_BACKUP_TAB_NAME,
    kind: 'masterBackup',
    tabColorHex: '#475569',
    rows,
    freezeRows: 1,
    freezeCols: 3,
    headerRowIndex: 0,
    merges: [],
    groupColors: [],
    subtotalRows: [],
    annualTotalRows: [],
    intCols: [],
    qtyCols: [5, 8],
    hrsCols: [7],
    currencyCols: [9, 10],
    centerCols: [0, 1, 2, 6],
    wrapCols: [11],
    basicFilterRange:
      rows.length > 1
        ? {
            startRow: 0,
            endRow: rows.length,
            startCol: 0,
            endCol: MASTER_BACKUP_HEADER_ROW.length,
          }
        : undefined,
    colWidths: [64, 92, 105, 160, 145, 105, 72, 105, 92, 120, 125, 220, 130, 175],
  };
}

export function buildFactoryYearReportSheetsPayload(
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    generationEntries?: GenerationEntry[];
    companies?: CompanyItem[];
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
  }
): {
  tabs: SheetTabPayload[];
  totalRows: number;
} {
  const genEntries = options?.generationEntries || [];
  const companyMap = new Map(
    (options?.companies || []).map((c) => [c.name, c])
  );
  const utilById = new Map(utilities.map((u) => [u.id, u]));
  const orderedUtilities = [...utilities].sort((a, b) => a.order - b.order);

  const issueLookup = buildFactoryIssueLookupForSheet({
    entries,
    generationEntries: genEntries,
    utilities,
    companies: options?.companies || [],
  });

  type YearBucket = {
    company: string;
    year: string;
    tabName: string;
    entryCount: number;
    byDate: Map<string, DayConsolidatedRecord>;
    usedUtilityIds: Set<string>;
    hasBoilers: boolean;
    hasGenerators: boolean;
    hasSolar: boolean;
  };

  const buckets = new Map<string, YearBucket>();

  const getOrCreateBucket = (company: string, dateOrYear: string): YearBucket | null => {
    const cleanCompany = company.trim();
    const year = dateOrYear.slice(0, 4);
    if (!cleanCompany || !/^\d{4}$/.test(year)) return null;
    const key = `${cleanCompany}|||${year}`;
    let b = buckets.get(key);
    if (!b) {
      const compMeta = companyMap.get(cleanCompany);
      b = {
        company: cleanCompany,
        year,
        tabName: formatFactoryYearTabName(cleanCompany, year),
        entryCount: 0,
        byDate: new Map(),
        usedUtilityIds: new Set(),
        hasBoilers: Boolean(compMeta && (compMeta.boilerCount ?? 0) > 0),
        hasGenerators: Boolean(
          compMeta &&
            ((compMeta.dieselGeneratorCount ?? 0) > 0 ||
              (compMeta.gasGeneratorCount ?? 0) > 0)
        ),
        hasSolar: Boolean(compMeta && (compMeta.solarCount ?? 0) > 0),
      };
      buckets.set(key, b);
    }
    return b;
  };

  const getOrCreateDay = (bucket: YearBucket, date: string): DayConsolidatedRecord => {
    let day = bucket.byDate.get(date);
    if (!day) {
      day = {
        date,
        monthKey: date.slice(0, 7),
        utilities: new Map(),
      };
      bucket.byDate.set(date, day);
    }
    return day;
  };

  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
    const bucket = getOrCreateBucket(entry.company, entry.date);
    if (!bucket) continue;
    bucket.entryCount += 1;
    bucket.usedUtilityIds.add(entry.utilityId);
    const day = getOrCreateDay(bucket, entry.date);
    day.utilities.set(entry.utilityId, entry);
  }

  for (const gen of genEntries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gen.date)) continue;
    const bucket = getOrCreateBucket(gen.company, gen.date);
    if (!bucket) continue;
    bucket.entryCount += 1;
    if (
      gen.boilerCount > 0 ||
      gen.steamKg > 0 ||
      gen.boilerFuelQty > 0 ||
      gen.boilerFuelCost > 0 ||
      (gen.boilerOperatingHours ?? 0) > 0
    ) {
      bucket.hasBoilers = true;
    }
    if (
      gen.generatorCount > 0 ||
      gen.generatorKwh > 0 ||
      gen.generatorFuelQty > 0 ||
      gen.generatorFuelCost > 0 ||
      (gen.generatorOperatingHours ?? 0) > 0
    ) {
      bucket.hasGenerators = true;
    }
    if (
      gen.solarSystemCount > 0 ||
      gen.solarKwh > 0 ||
      gen.solarSavings > 0 ||
      (gen.solarOperatingHours ?? 0) > 0
    ) {
      bucket.hasSolar = true;
    }
    const day = getOrCreateDay(bucket, gen.date);
    day.generation = gen;
  }

  if (options?.ensureTabKeys) {
    for (const extra of options.ensureTabKeys) {
      if (extra.company && extra.monthKey) {
        getOrCreateBucket(extra.company, extra.monthKey);
      }
    }
  }

  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
    const yrCmp = b.year.localeCompare(a.year);
    if (yrCmp !== 0) return yrCmp;
    return a.company.localeCompare(b.company);
  });

  const factoryTabs: SheetTabPayload[] = [];
  const summaryRowsData: {
    year: string;
    company: string;
    tabName: string;
    activeDays: number;
    totalHours: number;
    hrsCompletenessRatio: number;
    totalSpend: number;
    steamKg: number;
    genAndSolarKwh: number;
    solarSaved: number;
    flaggedDays: number;
    auditSummary: string;
    annualRow1: number;
    hrsColA1: string;
    spendColA1: string;
    steamColA1: string | null;
    genKwhColA1: string | null;
    solarKwhColA1: string | null;
    solarSavedColA1: string | null;
  }[] = [];

  const generatedStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  for (const bucket of sortedBuckets) {
    const activeUtils: UtilityItem[] = [];
    const seenIds = new Set<string>();
    for (const u of orderedUtilities) {
      if (bucket.usedUtilityIds.has(u.id)) {
        activeUtils.push(u);
        seenIds.add(u.id);
      }
    }
    for (const uid of bucket.usedUtilityIds) {
      if (!seenIds.has(uid)) {
        const fallback = utilById.get(uid);
        if (fallback) {
          activeUtils.push(fallback);
        } else {
          activeUtils.push({
            id: uid,
            name: uid,
            unit: 'unit',
            color: '#0F766E',
            order: 999,
            createdBy: '',
            createdAt: null,
          });
        }
      }
    }
    if (activeUtils.length === 0 && orderedUtilities.length > 0) {
      activeUtils.push(...orderedUtilities);
    }

    const groupHeaderRow: string[] = ['Calendar', '', ''];
    const subHeaderRow: string[] = ['Date', 'Day', 'Month'];
    const merges: SheetMergeRange[] = [];
    const groupColors: SheetGroupHeaderColor[] = [
      { startCol: 0, endCol: 3, bgHex: '#1E293B' },
    ];
    merges.push({ startRow: 2, endRow: 3, startCol: 0, endCol: 3 });

    const qtyCols: number[] = [];
    const hrsCols: number[] = [];
    const currencyCols: number[] = [];
    const intCols: number[] = [];
    const colWidths: number[] = [104, 54, 86];

    const summedCols = new Set<number>();
    const ratioColPairs = new Map<number, { numCol: number; denCol: number }>();
    const dayHrsInputCols: number[] = [];
    const dayCostInputCols: number[] = [];

    let colCursor = 3;
    const utilPalette = ['#0F766E', '#115E59', '#0E7490', '#1D4ED8', '#4338CA', '#0369A1'];

    const utilBlocks: Array<{
      utilId: string;
      consIdx: number;
      hrsIdx: number;
      rateHrIdx: number;
      costIdx: number;
    }> = [];

    activeUtils.forEach((util, idx) => {
      const startCol = colCursor;
      groupHeaderRow.push(`${util.name} (${util.unit})`, '', '', '');
      subHeaderRow.push(
        `Cons (${util.unit})`,
        'Run Hrs',
        `${util.unit}/Hr`,
        'Cost (৳)'
      );
      qtyCols.push(startCol, startCol + 2);
      hrsCols.push(startCol + 1);
      currencyCols.push(startCol + 3);
      colWidths.push(102, 72, 86, 110);

      summedCols.add(startCol);
      summedCols.add(startCol + 1);
      summedCols.add(startCol + 3);
      ratioColPairs.set(startCol + 2, { numCol: startCol, denCol: startCol + 1 });
      dayHrsInputCols.push(startCol + 1);
      dayCostInputCols.push(startCol + 3);

      utilBlocks.push({
        utilId: util.id,
        consIdx: startCol,
        hrsIdx: startCol + 1,
        rateHrIdx: startCol + 2,
        costIdx: startCol + 3,
      });

      merges.push({
        startRow: 2,
        endRow: 3,
        startCol,
        endCol: startCol + 4,
      });
      groupColors.push({
        startCol,
        endCol: startCol + 4,
        bgHex: utilPalette[idx % utilPalette.length],
      });
      colCursor += 4;
    });

    let boilerCols: {
      hrsIdx: number;
      steamIdx: number;
      kgHrIdx: number;
      fuelQtyIdx: number;
      fuelCostIdx: number;
    } | null = null;

    if (bucket.hasBoilers) {
      const startCol = colCursor;
      groupHeaderRow.push('Boilers & Steam', '', '', '', '');
      subHeaderRow.push('Run Hrs', 'Steam (kg)', 'kg/Hr', 'Fuel Qty', 'Fuel Cost (৳)');
      hrsCols.push(startCol);
      qtyCols.push(startCol + 1, startCol + 2, startCol + 3);
      currencyCols.push(startCol + 4);
      colWidths.push(72, 102, 84, 96, 110);

      summedCols.add(startCol);
      summedCols.add(startCol + 1);
      summedCols.add(startCol + 3);
      summedCols.add(startCol + 4);
      ratioColPairs.set(startCol + 2, { numCol: startCol + 1, denCol: startCol });
      dayHrsInputCols.push(startCol);
      dayCostInputCols.push(startCol + 4);

      boilerCols = {
        hrsIdx: startCol,
        steamIdx: startCol + 1,
        kgHrIdx: startCol + 2,
        fuelQtyIdx: startCol + 3,
        fuelCostIdx: startCol + 4,
      };

      merges.push({ startRow: 2, endRow: 3, startCol, endCol: startCol + 5 });
      groupColors.push({ startCol, endCol: startCol + 5, bgHex: '#9A3412' });
      colCursor += 5;
    }

    let genCols: {
      hrsIdx: number;
      kwhIdx: number;
      avgKwIdx: number;
      fuelQtyIdx: number;
      fuelCostIdx: number;
    } | null = null;

    if (bucket.hasGenerators) {
      const startCol = colCursor;
      groupHeaderRow.push('Captive Generators', '', '', '', '');
      subHeaderRow.push('Run Hrs', 'Power (kWh)', 'Avg kW', 'Fuel Qty', 'Fuel Cost (৳)');
      hrsCols.push(startCol);
      qtyCols.push(startCol + 1, startCol + 2, startCol + 3);
      currencyCols.push(startCol + 4);
      colWidths.push(72, 104, 84, 96, 110);

      summedCols.add(startCol);
      summedCols.add(startCol + 1);
      summedCols.add(startCol + 3);
      summedCols.add(startCol + 4);
      ratioColPairs.set(startCol + 2, { numCol: startCol + 1, denCol: startCol });
      dayHrsInputCols.push(startCol);
      dayCostInputCols.push(startCol + 4);

      genCols = {
        hrsIdx: startCol,
        kwhIdx: startCol + 1,
        avgKwIdx: startCol + 2,
        fuelQtyIdx: startCol + 3,
        fuelCostIdx: startCol + 4,
      };

      merges.push({ startRow: 2, endRow: 3, startCol, endCol: startCol + 5 });
      groupColors.push({ startCol, endCol: startCol + 5, bgHex: '#1E40AF' });
      colCursor += 5;
    }

    let solarCols: {
      hrsIdx: number;
      kwhIdx: number;
      savedIdx: number;
    } | null = null;

    if (bucket.hasSolar) {
      const startCol = colCursor;
      groupHeaderRow.push('Solar PV', '', '');
      subHeaderRow.push('Run Hrs', 'Solar (kWh)', 'Saved (৳)');
      hrsCols.push(startCol);
      qtyCols.push(startCol + 1);
      currencyCols.push(startCol + 2);
      colWidths.push(72, 100, 105);

      summedCols.add(startCol);
      summedCols.add(startCol + 1);
      summedCols.add(startCol + 2);
      dayHrsInputCols.push(startCol);

      solarCols = {
        hrsIdx: startCol,
        kwhIdx: startCol + 1,
        savedIdx: startCol + 2,
      };

      merges.push({ startRow: 2, endRow: 3, startCol, endCol: startCol + 3 });
      groupColors.push({ startCol, endCol: startCol + 3, bgHex: '#047857' });
      colCursor += 3;
    }

    // Daily Totals & Audit (6 columns including Audit Flag)
    const summaryStart = colCursor;
    const assetHrsIdx = summaryStart;
    const totalSpendIdx = summaryStart + 1;
    const spendPerHrIdx = summaryStart + 2;
    const auditColIdx = summaryStart + 3;

    groupHeaderRow.push('Daily Summary & Audit', '', '', '', '', '');
    subHeaderRow.push('Asset Hrs', 'Total Spend (৳)', '৳ / Hr', 'Audit Flag', 'Note', 'Entered By');
    hrsCols.push(assetHrsIdx);
    currencyCols.push(totalSpendIdx, spendPerHrIdx);
    colWidths.push(84, 122, 92, 165, 210, 130);
    summedCols.add(assetHrsIdx);
    summedCols.add(totalSpendIdx);
    ratioColPairs.set(spendPerHrIdx, { numCol: totalSpendIdx, denCol: assetHrsIdx });
    merges.push({ startRow: 2, endRow: 3, startCol: summaryStart, endCol: summaryStart + 6 });
    groupColors.push({ startCol: summaryStart, endCol: summaryStart + 6, bgHex: '#0F172A' });
    colCursor += 6;

    const totalCols = colCursor;
    merges.unshift(
      { startRow: 0, endRow: 1, startCol: 0, endCol: totalCols },
      { startRow: 1, endRow: 2, startCol: 0, endCol: totalCols }
    );

    const padRow = (cells: (string | number)[]): (string | number)[] => {
      const out = [...cells];
      while (out.length < totalCols) out.push('');
      return out;
    };

    const sortedDays = Array.from(bucket.byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const buildFormulaTotalsRow = (
      label: string,
      daysCount: number,
      subLabel: string,
      targetRow1: number,
      sumSource: { startRow1: number; endRow1: number } | number[],
      auditLabel: string
    ): (string | number)[] => {
      const row: (string | number)[] = [label, `${daysCount}d`, subLabel];
      for (let c = 3; c < totalCols; c++) {
        const colA1 = columnIndexToA1(c);
        if (summedCols.has(c)) {
          if (Array.isArray(sumSource)) {
            row.push(
              sumSource.length > 0
                ? `=SUM(${sumSource.map((sr) => `${colA1}${sr}`).join(',')})`
                : 0
            );
          } else {
            row.push(`=SUM(${colA1}${sumSource.startRow1}:${colA1}${sumSource.endRow1})`);
          }
        } else if (ratioColPairs.has(c)) {
          const pair = ratioColPairs.get(c)!;
          row.push(
            `=IFERROR(${columnIndexToA1(pair.numCol)}${targetRow1}/${columnIndexToA1(
              pair.denCol
            )}${targetRow1},"")`
          );
        } else if (c === auditColIdx) {
          row.push(auditLabel);
        } else {
          row.push('');
        }
      }
      return row;
    };

    const bodyRows: (string | number)[][] = [];
    const subtotalRows: number[] = [];
    const monthSubtotalExcelRows: number[] = [];
    const annualTotalRows: number[] = [];

    let annualDays = 0;
    let annualHrs = 0;
    let annualSpend = 0;
    let annualSteamKg = 0;
    let annualGenKwh = 0;
    let annualSolarKwh = 0;
    let annualSolarSavings = 0;
    let annualFlaggedDays = 0;
    let annualHrsEligible = 0;
    let annualHrsLogged = 0;

    let currentMonth = '';
    let monthDays = 0;
    let monthStartRow1 = 0;
    let monthEndRow1 = 0;
    let monthFlaggedDays = 0;

    const flushMonthSubtotal = () => {
      if (!currentMonth || monthDays === 0) return;
      const rowIdx0 = 4 + bodyRows.length;
      const rowExcel1 = rowIdx0 + 1;
      subtotalRows.push(rowIdx0);
      monthSubtotalExcelRows.push(rowExcel1);
      bodyRows.push(
        buildFormulaTotalsRow(
          `SUBTOTAL · ${formatMonthYearLabel(currentMonth)}`,
          monthDays,
          formatMonthYearLabel(currentMonth),
          rowExcel1,
          { startRow1: monthStartRow1, endRow1: monthEndRow1 },
          monthFlaggedDays > 0 ? `${monthFlaggedDays} flagged` : 'Verified'
        )
      );
      monthDays = 0;
      monthStartRow1 = 0;
      monthEndRow1 = 0;
      monthFlaggedDays = 0;
    };

    for (const day of sortedDays) {
      if (currentMonth && day.monthKey !== currentMonth) {
        flushMonthSubtotal();
      }
      currentMonth = day.monthKey;

      const rowExcel1 = 5 + bodyRows.length; // 4 header rows precede body
      if (monthStartRow1 === 0) monthStartRow1 = rowExcel1;
      monthEndRow1 = rowExcel1;

      const row: (string | number)[] = [
        day.date,
        formatWeekdayShort(day.date),
        formatMonthYearLabel(day.monthKey),
      ];

      let daySpend = 0;
      let dayHours = 0;
      const notes: string[] = [];
      const users = new Set<string>();

      utilBlocks.forEach((blk) => {
        const entry = day.utilities.get(blk.utilId);
        if (!entry) {
          row.push('', '', '', '');
          return;
        }
        const cons = roundNum(entry.consumption, 2);
        const hrs = roundNum(Number(entry.operatingHours ?? 0), 2);
        const cost = roundNum(entry.cost, 2);
        const consA1 = `${columnIndexToA1(blk.consIdx)}${rowExcel1}`;
        const hrsA1 = `${columnIndexToA1(blk.hrsIdx)}${rowExcel1}`;
        const rateFormula = `=IF(AND(${hrsA1}>0,${consA1}>0),${consA1}/${hrsA1},"")`;

        row.push(cons, hrs > 0 ? hrs : '', rateFormula, cost);

        if (entry.consumption > 0) {
          annualHrsEligible += 1;
          if (hrs > 0 && hrs <= 24) annualHrsLogged += 1;
        }
        daySpend += entry.cost;
        dayHours += hrs;
        const utilMeta = utilById.get(blk.utilId);
        if (entry.note.trim()) notes.push(`${utilMeta?.name || entry.utilityName}: ${entry.note.trim()}`);
        if (entry.enteredByName.trim()) users.add(entry.enteredByName.trim());
      });

      const gen = day.generation;
      if (boilerCols) {
        if (gen) {
          const bh = roundNum(Number(gen.boilerOperatingHours ?? 0), 2);
          const sk = roundNum(gen.steamKg, 2);
          const fq = roundNum(gen.boilerFuelQty, 2);
          const fc = roundNum(gen.boilerFuelCost, 2);
          const bhA1 = `${columnIndexToA1(boilerCols.hrsIdx)}${rowExcel1}`;
          const skA1 = `${columnIndexToA1(boilerCols.steamIdx)}${rowExcel1}`;
          row.push(
            bh > 0 ? bh : '',
            sk || '',
            `=IF(AND(${bhA1}>0,${skA1}>0),${skA1}/${bhA1},"")`,
            fq || '',
            fc || ''
          );
          if (gen.steamKg > 0) {
            annualHrsEligible += 1;
            if (bh > 0 && bh <= 24) annualHrsLogged += 1;
          }
          annualSteamKg += gen.steamKg;
          daySpend += gen.boilerFuelCost;
          dayHours += bh;
        } else {
          row.push('', '', '', '', '');
        }
      }

      if (genCols) {
        if (gen) {
          const gh = roundNum(Number(gen.generatorOperatingHours ?? 0), 2);
          const gk = roundNum(gen.generatorKwh, 2);
          const fq = roundNum(gen.generatorFuelQty, 2);
          const fc = roundNum(gen.generatorFuelCost, 2);
          const ghA1 = `${columnIndexToA1(genCols.hrsIdx)}${rowExcel1}`;
          const gkA1 = `${columnIndexToA1(genCols.kwhIdx)}${rowExcel1}`;
          row.push(
            gh > 0 ? gh : '',
            gk || '',
            `=IF(AND(${ghA1}>0,${gkA1}>0),${gkA1}/${ghA1},"")`,
            fq || '',
            fc || ''
          );
          if (gen.generatorKwh > 0) {
            annualHrsEligible += 1;
            if (gh > 0 && gh <= 24) annualHrsLogged += 1;
          }
          annualGenKwh += gen.generatorKwh;
          daySpend += gen.generatorFuelCost;
          dayHours += gh;
        } else {
          row.push('', '', '', '', '');
        }
      }

      if (solarCols) {
        if (gen) {
          const sh = roundNum(Number(gen.solarOperatingHours ?? 0), 2);
          const skwh = roundNum(gen.solarKwh, 2);
          const ssav = roundNum(gen.solarSavings, 2);
          row.push(sh > 0 ? sh : '', skwh || '', ssav || '');
          annualSolarKwh += gen.solarKwh;
          annualSolarSavings += gen.solarSavings;
          dayHours += sh;
        } else {
          row.push('', '', '');
        }
      }

      if (gen) {
        if (gen.note.trim()) notes.push(`Plant: ${gen.note.trim()}`);
        if (gen.enteredByName.trim()) users.add(gen.enteredByName.trim());
      }

      const hrsRefs = dayHrsInputCols.map((c) => `${columnIndexToA1(c)}${rowExcel1}`);
      const costRefs = dayCostInputCols.map((c) => `${columnIndexToA1(c)}${rowExcel1}`);
      const assetHrsA1 = `${columnIndexToA1(assetHrsIdx)}${rowExcel1}`;
      const spendA1 = `${columnIndexToA1(totalSpendIdx)}${rowExcel1}`;

      const assetHrsFormula =
        hrsRefs.length > 0 ? `=IF(SUM(${hrsRefs.join(',')})>0,SUM(${hrsRefs.join(',')}),"")` : '';
      const spendFormula = costRefs.length > 0 ? `=SUM(${costRefs.join(',')})` : 0;
      const spendPerHrFormula = `=IF(AND(${assetHrsA1}>0,${spendA1}>0),${spendA1}/${assetHrsA1},"")`;

      const flagLabel = issueLookup.get(`${bucket.company}|||${day.date}`) || 'Verified';
      if (flagLabel !== 'Verified') {
        monthFlaggedDays += 1;
        annualFlaggedDays += 1;
      }

      row.push(
        assetHrsFormula,
        spendFormula,
        spendPerHrFormula,
        flagLabel,
        notes.join(' | ').slice(0, 300),
        Array.from(users).join(', ')
      );

      monthDays += 1;
      annualDays += 1;
      annualHrs += dayHours;
      annualSpend += daySpend;

      bodyRows.push(row);
    }

    flushMonthSubtotal();

    let annualRow1 = 0;
    if (annualDays > 0) {
      const annualIdx0 = 4 + bodyRows.length;
      annualRow1 = annualIdx0 + 1;
      annualTotalRows.push(annualIdx0);
      bodyRows.push(
        buildFormulaTotalsRow(
          `ANNUAL TOTAL · ${bucket.year}`,
          annualDays,
          bucket.year,
          annualRow1,
          monthSubtotalExcelRows,
          annualFlaggedDays > 0 ? `${annualFlaggedDays} flagged` : 'Verified'
        )
      );
    }

    const blendedPerHr = annualHrs > 0 ? roundNum(annualSpend / annualHrs, 2) : 0;
    const hrsCompletenessRatio =
      annualHrsEligible > 0 ? Math.min(1, annualHrsLogged / annualHrsEligible) : 1;

    const bannerRow = padRow([
      `${bucket.company} — Annual Utility, Operating Hours & Plant Energy Report (${bucket.year})`,
    ]);
    const subtitleRow = padRow([
      `Active Days: ${annualDays}   |   Total Spend: ৳${roundNum(annualSpend, 2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}   |   Total Asset Hrs: ${roundNum(annualHrs, 1)} hrs (${Math.round(hrsCompletenessRatio * 100)}% logged)   |   Blended Rate: ৳${blendedPerHr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr   |   Audit Alerts: ${annualFlaggedDays}   |   Synced: ${generatedStamp}`,
    ]);

    const allRows = [bannerRow, subtitleRow, groupHeaderRow, subHeaderRow, ...bodyRows];

    factoryTabs.push({
      tabName: bucket.tabName,
      kind: 'factoryYear',
      tabColorHex: '#0F766E',
      rows: allRows,
      freezeRows: 4,
      freezeCols: 2,
      headerRowIndex: 3,
      groupHeaderRowIndex: 2,
      merges,
      groupColors,
      subtotalRows,
      annualTotalRows,
      intCols,
      qtyCols,
      hrsCols,
      currencyCols,
      centerCols: [0, 1, 2, auditColIdx],
      wrapCols: [auditColIdx + 1],
      auditColIndex: auditColIdx,
      colWidths,
    });

    if (annualDays > 0) {
      summaryRowsData.push({
        year: bucket.year,
        company: bucket.company,
        tabName: bucket.tabName,
        activeDays: annualDays,
        totalHours: roundNum(annualHrs, 2),
        hrsCompletenessRatio: roundNum(hrsCompletenessRatio, 4),
        totalSpend: roundNum(annualSpend, 2),
        steamKg: roundNum(annualSteamKg, 2),
        genAndSolarKwh: roundNum(annualGenKwh + annualSolarKwh, 2),
        solarSaved: roundNum(annualSolarSavings, 2),
        flaggedDays: annualFlaggedDays,
        auditSummary:
          annualFlaggedDays > 0 ? `${annualFlaggedDays} flagged` : 'Verified',
        annualRow1,
        hrsColA1: columnIndexToA1(assetHrsIdx),
        spendColA1: columnIndexToA1(totalSpendIdx),
        steamColA1: boilerCols ? columnIndexToA1(boilerCols.steamIdx) : null,
        genKwhColA1: genCols ? columnIndexToA1(genCols.kwhIdx) : null,
        solarKwhColA1: solarCols ? columnIndexToA1(solarCols.kwhIdx) : null,
        solarSavedColA1: solarCols ? columnIndexToA1(solarCols.savedIdx) : null,
      });
    }
  }

  // Build Executive_Summary Tab (live cross-tab formulas referencing each Factory - YYYY tab)
  const summaryRows: (string | number)[][] = [];
  const grandTotal = summaryRowsData.reduce(
    (acc, r) => ({
      activeDays: acc.activeDays + r.activeDays,
      totalHours: acc.totalHours + r.totalHours,
      totalSpend: acc.totalSpend + r.totalSpend,
      flaggedDays: acc.flaggedDays + r.flaggedDays,
    }),
    {
      activeDays: 0,
      totalHours: 0,
      totalSpend: 0,
      flaggedDays: 0,
    }
  );

  const summaryBanner = [
    'Utility Hub — Executive Factory & Annual Performance Summary',
    ...Array(EXECUTIVE_SUMMARY_HEADER_ROW.length - 1).fill(''),
  ];
  const summarySubtitle = [
    `Factories & Annual Tabs: ${summaryRowsData.length}   |   Consolidated Spend: ৳${roundNum(grandTotal.totalSpend, 2).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}   |   Total Asset Hrs: ${roundNum(grandTotal.totalHours, 1)} hrs   |   Flagged Days: ${grandTotal.flaggedDays}   |   Synced: ${generatedStamp}`,
    ...Array(EXECUTIVE_SUMMARY_HEADER_ROW.length - 1).fill(''),
  ];

  summaryRows.push(summaryBanner, summarySubtitle, EXECUTIVE_SUMMARY_HEADER_ROW);

  summaryRowsData.forEach((r, idx) => {
    const rowExcel1 = 4 + idx; // Banner=1, Subtitle=2, Header=3, Data=4..
    const tabPrefix = `'${r.tabName.replace(/'/g, "''")}'!`;
    const kwhParts: string[] = [];
    if (r.genKwhColA1) kwhParts.push(`${tabPrefix}${r.genKwhColA1}${r.annualRow1}`);
    if (r.solarKwhColA1) kwhParts.push(`${tabPrefix}${r.solarKwhColA1}${r.annualRow1}`);

    summaryRows.push([
      r.year,
      r.company,
      r.tabName,
      r.activeDays,
      `=${tabPrefix}${r.hrsColA1}${r.annualRow1}`,
      r.hrsCompletenessRatio,
      `=${tabPrefix}${r.spendColA1}${r.annualRow1}`,
      `=IFERROR(G${rowExcel1}/D${rowExcel1},0)`,
      `=IFERROR(G${rowExcel1}/E${rowExcel1},0)`,
      r.steamColA1 ? `=${tabPrefix}${r.steamColA1}${r.annualRow1}` : 0,
      kwhParts.length > 0 ? `=${kwhParts.join('+')}` : 0,
      r.solarSavedColA1 ? `=${tabPrefix}${r.solarSavedColA1}${r.annualRow1}` : 0,
      r.auditSummary,
    ]);
  });

  const summaryAnnualRows: number[] = [];
  if (summaryRowsData.length > 0) {
    const firstSumRow1 = 4;
    const lastSumRow1 = 3 + summaryRowsData.length;
    const gtRow1 = summaryRows.length + 1;
    summaryAnnualRows.push(summaryRows.length);
    summaryRows.push([
      'ALL',
      'Group Grand Total',
      `${summaryRowsData.length} tabs`,
      `=SUM(D${firstSumRow1}:D${lastSumRow1})`,
      `=SUM(E${firstSumRow1}:E${lastSumRow1})`,
      `=IFERROR(AVERAGE(F${firstSumRow1}:F${lastSumRow1}),1)`,
      `=SUM(G${firstSumRow1}:G${lastSumRow1})`,
      `=IFERROR(G${gtRow1}/D${gtRow1},0)`,
      `=IFERROR(G${gtRow1}/E${gtRow1},0)`,
      `=SUM(J${firstSumRow1}:J${lastSumRow1})`,
      `=SUM(K${firstSumRow1}:K${lastSumRow1})`,
      `=SUM(L${firstSumRow1}:L${lastSumRow1})`,
      grandTotal.flaggedDays > 0 ? `${grandTotal.flaggedDays} flagged` : 'All Verified',
    ]);
  }

  const executiveSummaryTab: SheetTabPayload = {
    tabName: SUMMARY_TAB_NAME,
    kind: 'summary',
    tabColorHex: '#0F172A',
    rows: summaryRows,
    freezeRows: 3,
    freezeCols: 2,
    headerRowIndex: 2,
    merges: [
      { startRow: 0, endRow: 1, startCol: 0, endCol: EXECUTIVE_SUMMARY_HEADER_ROW.length },
      { startRow: 1, endRow: 2, startCol: 0, endCol: EXECUTIVE_SUMMARY_HEADER_ROW.length },
    ],
    groupColors: [],
    subtotalRows: [],
    annualTotalRows: summaryAnnualRows,
    intCols: [3],
    hrsCols: [4],
    pctCols: [5],
    currencyCols: [6, 7, 8, 11],
    qtyCols: [9, 10],
    centerCols: [0, 12],
    auditColIndex: 12,
    basicFilterRange:
      summaryRowsData.length > 0
        ? {
            startRow: 2,
            endRow: 3 + summaryRowsData.length,
            startCol: 0,
            endCol: EXECUTIVE_SUMMARY_HEADER_ROW.length,
          }
        : undefined,
    colWidths: [70, 175, 195, 92, 108, 102, 138, 138, 138, 125, 128, 125, 135],
  };

  const masterBackupTab = buildMasterBackupPayload(entries, utilities);

  const tabs: SheetTabPayload[] = [
    executiveSummaryTab,
    ...factoryTabs,
    masterBackupTab,
  ];

  return {
    tabs,
    totalRows: entries.length + genEntries.length,
  };
}

export async function syncViaAppsScriptWebhook(
  webhookUrl: string,
  _sheetName: string,
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    generationEntries?: GenerationEntry[];
    companies?: CompanyItem[];
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

  const { tabs, totalRows } = buildFactoryYearReportSheetsPayload(
    entries,
    utilities,
    {
      generationEntries: options?.generationEntries,
      companies: options?.companies,
      ensureTabKeys: options?.ensureTabKeys,
    }
  );

  const res = await fetch(trimmed, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      sheets: tabs,
      totalRows,
      masterTabName: MASTER_BACKUP_TAB_NAME,
      summaryTabName: SUMMARY_TAB_NAME,
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

function buildFormattingRequestsForTab(
  sheetId: number,
  tabIndex: number,
  tab: SheetTabPayload,
  existingGrid?: { rowCount: number; columnCount: number }
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  const numRows = tab.rows.length;
  const numCols = tab.rows[0]?.length || 1;
  const clearRows = Math.max(existingGrid?.rowCount || 0, numRows + 30, 80);
  const clearCols = Math.max(existingGrid?.columnCount || 0, numCols + 10, 40);

  // 1. Tab properties: order, freeze, tab color
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        index: tabIndex,
        tabColor: hexToRgbColor(tab.tabColorHex),
        gridProperties: {
          frozenRowCount: tab.freezeRows,
          frozenColumnCount: tab.freezeCols,
        },
      },
      fields:
        'index,tabColor,gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });

  // 2. Clear any prior basic filter, merges, and stale cell formatting outside/inside current bounds
  requests.push({
    clearBasicFilter: {
      sheetId,
    },
  });

  requests.push({
    unmergeCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: clearRows,
        startColumnIndex: 0,
        endColumnIndex: clearCols,
      },
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: clearRows,
        startColumnIndex: 0,
        endColumnIndex: clearCols,
      },
      cell: {
        userEnteredFormat: {},
      },
      fields: 'userEnteredFormat',
    },
  });

  // 3. Base font, clipping & vertical alignment
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: numRows,
        startColumnIndex: 0,
        endColumnIndex: numCols,
      },
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { fontFamily: 'Arial', fontSize: 10 },
        },
      },
      fields:
        'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.fontFamily,textFormat.fontSize)',
    },
  });

  const firstDataRow = tab.headerRowIndex + 1;

  // 4. Data rows: alternating zebra + thin borders + uniform row height + alignments + number formats
  if (firstDataRow < numRows) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: firstDataRow,
          endIndex: numRows,
        },
        properties: { pixelSize: 24 },
        fields: 'pixelSize',
      },
    });

    for (let r = firstDataRow; r < numRows; r++) {
      const isOdd = (r - firstDataRow) % 2 === 1;
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: r,
            endRowIndex: r + 1,
            startColumnIndex: 0,
            endColumnIndex: numCols,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: hexToRgbColor(isOdd ? '#F8FAFC' : '#FFFFFF'),
              borders: makeSolidBorders('#E2E8F0', 'SOLID'),
            },
          },
          fields: 'userEnteredFormat(backgroundColor,borders)',
        },
      });
    }

    if (tab.centerCols && tab.centerCols.length > 0) {
      for (const c of tab.centerCols) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: firstDataRow,
              endRowIndex: numRows,
              startColumnIndex: c,
              endColumnIndex: c + 1,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat.horizontalAlignment',
          },
        });
      }
    }

    if (tab.wrapCols && tab.wrapCols.length > 0) {
      for (const c of tab.wrapCols) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: firstDataRow,
              endRowIndex: numRows,
              startColumnIndex: c,
              endColumnIndex: c + 1,
            },
            cell: {
              userEnteredFormat: {
                wrapStrategy: 'WRAP',
              },
            },
            fields: 'userEnteredFormat.wrapStrategy',
          },
        });
      }
    }

    const applyColFormat = (
      cols: number[],
      type: 'NUMBER' | 'PERCENT',
      pattern: string
    ) => {
      for (const c of cols) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: firstDataRow,
              endRowIndex: numRows,
              startColumnIndex: c,
              endColumnIndex: c + 1,
            },
            cell: {
              userEnteredFormat: {
                horizontalAlignment: 'RIGHT',
                numberFormat: { type, pattern },
              },
            },
            fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
          },
        });
      }
    };

    applyColFormat(tab.intCols, 'NUMBER', '#,##0');
    applyColFormat(tab.qtyCols, 'NUMBER', '#,##0.##');
    applyColFormat(tab.hrsCols, 'NUMBER', '0.##');
    applyColFormat(tab.currencyCols, 'NUMBER', '#,##0.00');
    if (tab.pctCols && tab.pctCols.length > 0) {
      applyColFormat(tab.pctCols, 'PERCENT', '0.0%');
    }
  }

  // 5. Report Headers / Banners
  if (tab.kind !== 'masterBackup') {
    // Row 0: Navy Title Banner
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#0F172A'),
            horizontalAlignment: 'LEFT',
            textFormat: {
              foregroundColor: hexToRgbColor('#FFFFFF'),
              bold: true,
              fontSize: 12,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    });

    // Row 1: KPI Subtitle Strip
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#F1F5F9'),
            horizontalAlignment: 'LEFT',
            wrapStrategy: 'WRAP',
            borders: {
              bottom: { style: 'SOLID', width: 1, color: hexToRgbColor('#CBD5E1') },
            },
            textFormat: {
              foregroundColor: hexToRgbColor('#334155'),
              fontSize: 9,
            },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,borders,textFormat)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 26 },
        fields: 'pixelSize',
      },
    });

    // Row 2 (optional): Colored Group Super-Headers
    if (typeof tab.groupHeaderRowIndex === 'number') {
      const gIdx = tab.groupHeaderRowIndex;
      for (const gc of tab.groupColors) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: gIdx,
              endRowIndex: gIdx + 1,
              startColumnIndex: gc.startCol,
              endColumnIndex: gc.endCol,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: hexToRgbColor(gc.bgHex),
                horizontalAlignment: 'CENTER',
                borders: makeSolidBorders('#FFFFFF', 'SOLID'),
                textFormat: {
                  foregroundColor: hexToRgbColor('#FFFFFF'),
                  bold: true,
                  fontSize: 9,
                },
              },
            },
            fields:
              'userEnteredFormat(backgroundColor,horizontalAlignment,borders,textFormat)',
          },
        });
      }
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: gIdx, endIndex: gIdx + 1 },
          properties: { pixelSize: 25 },
          fields: 'pixelSize',
        },
      });
    }

    // Column Header Row
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: tab.headerRowIndex,
          endRowIndex: tab.headerRowIndex + 1,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#E2E8F0'),
            horizontalAlignment: 'CENTER',
            wrapStrategy: 'WRAP',
            borders: makeSolidBorders('#94A3B8', 'SOLID'),
            textFormat: {
              foregroundColor: hexToRgbColor('#0F172A'),
              bold: true,
              fontSize: 9,
            },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,borders,textFormat)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: tab.headerRowIndex,
          endIndex: tab.headerRowIndex + 1,
        },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    });
  } else {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#0F172A'),
            horizontalAlignment: 'CENTER',
            wrapStrategy: 'WRAP',
            textFormat: {
              foregroundColor: hexToRgbColor('#FFFFFF'),
              bold: true,
              fontSize: 9.5,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,textFormat)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    });
  }

  // 6. Merges
  for (const m of tab.merges) {
    if (m.endCol > m.startCol && m.endRow > m.startRow) {
      requests.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: m.startRow,
            endRowIndex: m.endRow,
            startColumnIndex: m.startCol,
            endColumnIndex: m.endCol,
          },
          mergeType: 'MERGE_ALL',
        },
      });
    }
  }

  // 7. Monthly Subtotal Rows
  for (const sr of tab.subtotalRows) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: sr,
          endRowIndex: sr + 1,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#E2E8F0'),
            borders: makeSolidBorders('#94A3B8', 'SOLID'),
            textFormat: {
              foregroundColor: hexToRgbColor('#0F172A'),
              bold: true,
              fontSize: 9.5,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat)',
      },
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: sr,
          endRowIndex: sr + 1,
          startColumnIndex: 0,
          endColumnIndex: Math.min(3, numCols),
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: sr, endIndex: sr + 1 },
        properties: { pixelSize: 26 },
        fields: 'pixelSize',
      },
    });
  }

  // 8. Annual Total / Grand Total Rows
  for (const tr of tab.annualTotalRows) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: tr,
          endRowIndex: tr + 1,
          startColumnIndex: 0,
          endColumnIndex: numCols,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#CCFBF1'),
            borders: makeSolidBorders('#0F766E', 'SOLID_MEDIUM'),
            textFormat: {
              foregroundColor: hexToRgbColor('#0F172A'),
              bold: true,
              fontSize: 10,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat)',
      },
    });
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: tr,
          endRowIndex: tr + 1,
          startColumnIndex: 0,
          endColumnIndex: Math.min(3, numCols),
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: tr, endIndex: tr + 1 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    });
  }

  // 9. Pixel Column Widths
  tab.colWidths.forEach((width, colIdx) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: colIdx,
          endIndex: colIdx + 1,
        },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    });
  });

  // 10. Conditional Formatting on Audit Status Column (Verified = emerald, Flagged = amber, excluding summary rows)
  if (typeof tab.auditColIndex === 'number' && firstDataRow < numRows) {
    const auditColA1 = columnIndexToA1(tab.auditColIndex);
    const firstDataRow1 = firstDataRow + 1;
    const auditRange = {
      sheetId,
      startRowIndex: firstDataRow,
      endRowIndex: numRows,
      startColumnIndex: tab.auditColIndex,
      endColumnIndex: tab.auditColIndex + 1,
    };
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [auditRange],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [
                {
                  userEnteredValue: `=AND(LEFT($A${firstDataRow1},8)<>"SUBTOTAL",LEFT($A${firstDataRow1},6)<>"ANNUAL",LEFT($A${firstDataRow1},3)<>"ALL",ISNUMBER(SEARCH("Verified",${auditColA1}${firstDataRow1})))`,
                },
              ],
            },
            format: {
              backgroundColor: hexToRgbColor('#ECFDF5'),
              textFormat: {
                foregroundColor: hexToRgbColor('#065F46'),
                bold: true,
              },
            },
          },
        },
        index: 0,
      },
    });
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [auditRange],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [
                {
                  userEnteredValue: `=AND(LEFT($A${firstDataRow1},8)<>"SUBTOTAL",LEFT($A${firstDataRow1},6)<>"ANNUAL",LEFT($A${firstDataRow1},3)<>"ALL",LEN(${auditColA1}${firstDataRow1})>0,ISERROR(SEARCH("Verified",${auditColA1}${firstDataRow1})))`,
                },
              ],
            },
            format: {
              backgroundColor: hexToRgbColor('#FEF3C7'),
              textFormat: {
                foregroundColor: hexToRgbColor('#92400E'),
                bold: true,
              },
            },
          },
        },
        index: 1,
      },
    });
  }

  // 11. Interactive Auto-Filter on Executive_Summary and Master_Backup
  if (tab.basicFilterRange) {
    requests.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: tab.basicFilterRange.startRow,
            endRowIndex: tab.basicFilterRange.endRow,
            startColumnIndex: tab.basicFilterRange.startCol,
            endColumnIndex: tab.basicFilterRange.endCol,
          },
        },
      },
    });
  }

  return requests;
}

export async function syncEntriesToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  _sheetName: string,
  entries: UtilityEntry[],
  utilities: UtilityItem[],
  options?: {
    generationEntries?: GenerationEntry[];
    companies?: CompanyItem[];
    ensureTabKeys?: Array<{ company: string; monthKey: string }>;
    pruneStaleTabs?: boolean;
  }
): Promise<number> {
  const { tabs, totalRows } = buildFactoryYearReportSheetsPayload(
    entries,
    utilities,
    {
      generationEntries: options?.generationEntries,
      companies: options?.companies,
      ensureTabKeys: options?.ensureTabKeys,
    }
  );

  if (tabs.length === 0) {
    return 0;
  }

  const fullMeta = await sheetsFetch<{
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
      conditionalFormats?: unknown[];
    }[];
  }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(
      spreadsheetId
    )}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),conditionalFormats)`,
    accessToken
  );

  const sheetList = (fullMeta.sheets || [])
    .map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title || '',
      rowCount: s.properties?.gridProperties?.rowCount || 200,
      columnCount: s.properties?.gridProperties?.columnCount || 40,
      conditionalRuleCount: Array.isArray(s.conditionalFormats)
        ? s.conditionalFormats.length
        : 0,
    }))
    .filter((s) => Boolean(s.title));

  const sheetIdByTitle = new Map<string, number>();
  const condCountBySheetId = new Map<number, number>();
  const gridBySheetId = new Map<number, { rowCount: number; columnCount: number }>();
  for (const s of sheetList) {
    if (typeof s.sheetId === 'number') {
      sheetIdByTitle.set(s.title, s.sheetId);
      condCountBySheetId.set(s.sheetId, s.conditionalRuleCount);
      gridBySheetId.set(s.sheetId, {
        rowCount: s.rowCount,
        columnCount: s.columnCount,
      });
    }
  }

  const missingTabs = tabs.filter((t) => !sheetIdByTitle.has(t.tabName));

  if (missingTabs.length > 0) {
    const addRes = await sheetsFetch<{
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    }>(`${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
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
    });

    (addRes.replies || []).forEach((rep) => {
      const props = rep.addSheet?.properties;
      if (props?.title && typeof props.sheetId === 'number') {
        sheetIdByTitle.set(props.title, props.sheetId);
        condCountBySheetId.set(props.sheetId, 0);
        gridBySheetId.set(props.sheetId, { rowCount: 1000, columnCount: 40 });
      }
    });
  }

  // Clear full width safely across existing tabs
  const rangesToClear = tabs.map((t) => quoteSheetRange(t.tabName, 'A1:ZZ'));
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
    const maxCols = Math.max(1, t.rows[0]?.length || 1);
    const endCol = columnIndexToA1(maxCols - 1);
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

  // Build single batchUpdate for clearing stale conditional rules + resetting old formatting + applying crisp formatting, merges, widths, filters, tab colors & tab ordering
  const formatRequests: Record<string, unknown>[] = [];
  tabs.forEach((tab, idx) => {
    const sid = sheetIdByTitle.get(tab.tabName);
    if (typeof sid === 'number') {
      const existingCondCount = condCountBySheetId.get(sid) || 0;
      for (let k = 0; k < existingCondCount; k++) {
        formatRequests.push({
          deleteConditionalFormatRule: {
            sheetId: sid,
            index: 0,
          },
        });
      }
      formatRequests.push(
        ...buildFormattingRequestsForTab(sid, idx, tab, gridBySheetId.get(sid))
      );
    }
  });

  // Delete stale legacy/removed report tabs when requested
  if (options?.pruneStaleTabs) {
    const desiredNames = new Set(tabs.map((t) => t.tabName));
    const candidates = sheetList.filter(
      (s) =>
        typeof s.sheetId === 'number' &&
        !desiredNames.has(s.title) &&
        (LEGACY_SUMMARY_TAB_NAMES.has(s.title) || s.title !== MASTER_BACKUP_TAB_NAME)
    );

    const legacyNamedDeletes = candidates.filter(
      (c) =>
        (LEGACY_SUMMARY_TAB_NAMES.has(c.title) || c.title === 'UtilityEntries') &&
        typeof c.sheetId === 'number'
    );
    for (const del of legacyNamedDeletes) {
      if (typeof del.sheetId === 'number') {
        formatRequests.push({ deleteSheet: { sheetId: del.sheetId } });
      }
    }

    const otherCandidates = candidates.filter(
      (c) => !LEGACY_SUMMARY_TAB_NAMES.has(c.title) && c.title !== 'UtilityEntries'
    );
    if (otherCandidates.length > 0) {
      const headerQuery = otherCandidates
        .map((c) => `ranges=${encodeURIComponent(quoteSheetRange(c.title, 'A1:B1'))}`)
        .join('&');
      const headerRes = await sheetsFetch<{
        valueRanges?: { values?: string[][] }[];
      }>(
        `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${headerQuery}`,
        accessToken
      );

      otherCandidates.forEach((cand, idx) => {
        const firstRow = headerRes.valueRanges?.[idx]?.values?.[0] || [];
        const topLeft = String(firstRow[0] || '');
        if (
          typeof cand.sheetId === 'number' &&
          ((topLeft === 'Date' && String(firstRow[1] || '') === 'Factory') ||
            topLeft.includes('Annual Utility, Operating Hours'))
        ) {
          formatRequests.push({ deleteSheet: { sheetId: cand.sheetId } });
        }
      });
    }
  }

  if (formatRequests.length > 0) {
    await sheetsFetch(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: formatRequests }),
      }
    );
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
      'Apps Script did not return sheet rows. Update your Apps Script with the latest v4 code (including doGet) and deploy a New version.'
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
  const range = encodeURIComponent(quoteSheetRange(sheetName, 'A1:Z5000'));
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
  operatingHours: number;
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
  for (let i = 0; i < Math.min(rawRows.length, 6); i++) {
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
      'Could not find Master_Backup columns (Date, Factory, Utility) in the selected Google Sheet.'
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
  const hoursIdx = findCol(['operating hours', 'run hrs', 'hours']);
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
    const lowerDate = rawDate.toLowerCase();
    if (
      lowerDate === 'monthly total' ||
      lowerDate.startsWith('subtotal') ||
      lowerDate.startsWith('annual total')
    ) {
      continue;
    }

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
    const rawHours =
      hoursIdx >= 0 ? parseNumberString(row[hoursIdx] || '') ?? 0 : 0;
    const operatingHours = Math.min(24, Math.max(0, rawHours));
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
      operatingHours,
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

export interface WorkbookTabSnapshot {
  tabName: string;
  rows: string[][];
}

export interface WorkbookReadResult {
  tabs: WorkbookTabSnapshot[];
  masterRows: string[][];
  factoryTabs: WorkbookTabSnapshot[];
}

export interface ImportedGenerationRow {
  date: string;
  company: string;
  boilerOperatingHours: number;
  steamKg: number;
  boilerFuelQty: number;
  boilerFuelCost: number;
  generatorOperatingHours: number;
  generatorKwh: number;
  generatorFuelQty: number;
  generatorFuelCost: number;
  solarOperatingHours: number;
  solarKwh: number;
  solarSavings: number;
  hasBoilerData: boolean;
  hasGeneratorData: boolean;
  hasSolarData: boolean;
  note: string;
  enteredByName: string;
}

export interface RecordHashSnapshot {
  overallHash: string;
  utilityFullHashes: Record<string, string>;
  utilityCoreHashes: Record<string, string>;
  generationCoreHashes: Record<string, string>;
}

export interface SheetsBaselineStore {
  spreadsheetId: string;
  savedAt: string;
  overallHash: string;
  utilityFullHashes: Record<string, string>;
  utilityCoreHashes: Record<string, string>;
  generationCoreHashes: Record<string, string>;
}

export interface ReconciledUtilityOp {
  mode: 'create' | 'update';
  targetId?: string;
  existingEnteredBy?: string;
  source: 'master' | 'factoryYear';
  item: ImportedSheetRow;
}

export interface ReconciledGenerationOp {
  mode: 'create' | 'update';
  targetId?: string;
  existingEnteredBy?: string;
  existingEntry?: GenerationEntry;
  item: ImportedGenerationRow;
}

export interface ReconciliationPlan {
  utilityOps: ReconciledUtilityOp[];
  generationOps: ReconciledGenerationOp[];
  newCompanies: string[];
  skipped: number;
  appHash: string;
  needsPushToSheet: boolean;
}

const SHEETS_BASELINE_STORAGE_PREFIX = 'utility_hub_sheets_baseline_';

function normDec(val: number | undefined | null): number {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100) / 100;
}

function normHours(val: number | undefined | null): number {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(24, Math.round(num * 100) / 100);
}

function stableHashString(input: string): string {
  // Fast deterministic 64-bit-like dual FNV-1a hex digest (16 chars)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((i * 31) & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function makeUtilityCompositeKey(
  date: string,
  company: string,
  utilityId: string
): string {
  return `${date.trim()}__${company.trim().toLowerCase()}__${utilityId.trim().toLowerCase()}`;
}

export function makeGenerationCompositeKey(date: string, company: string): string {
  return `${date.trim()}__${company.trim().toLowerCase()}`;
}

function hashUtilityFullFields(fields: {
  date: string;
  company: string;
  utilityId: string;
  consumption: number;
  operatingHours?: number;
  cost: number;
  note?: string;
}): string {
  return stableHashString(
    [
      fields.date.trim(),
      fields.company.trim().toLowerCase(),
      fields.utilityId.trim().toLowerCase(),
      normDec(fields.consumption).toFixed(2),
      normHours(fields.operatingHours).toFixed(2),
      normDec(fields.cost).toFixed(2),
      String(fields.note || '').trim().slice(0, 300),
    ].join('|')
  );
}

function hashUtilityCoreFields(fields: {
  date: string;
  company: string;
  utilityId: string;
  consumption: number;
  operatingHours?: number;
  cost: number;
}): string {
  return stableHashString(
    [
      fields.date.trim(),
      fields.company.trim().toLowerCase(),
      fields.utilityId.trim().toLowerCase(),
      normDec(fields.consumption).toFixed(2),
      normHours(fields.operatingHours).toFixed(2),
      normDec(fields.cost).toFixed(2),
    ].join('|')
  );
}

function hashGenerationCoreFields(fields: {
  date: string;
  company: string;
  boilerOperatingHours?: number;
  steamKg: number;
  boilerFuelQty: number;
  boilerFuelCost: number;
  generatorOperatingHours?: number;
  generatorKwh: number;
  generatorFuelQty: number;
  generatorFuelCost: number;
  solarOperatingHours?: number;
  solarKwh: number;
  solarSavings: number;
}): string {
  return stableHashString(
    [
      fields.date.trim(),
      fields.company.trim().toLowerCase(),
      normHours(fields.boilerOperatingHours).toFixed(2),
      normDec(fields.steamKg).toFixed(2),
      normDec(fields.boilerFuelQty).toFixed(2),
      normDec(fields.boilerFuelCost).toFixed(2),
      normHours(fields.generatorOperatingHours).toFixed(2),
      normDec(fields.generatorKwh).toFixed(2),
      normDec(fields.generatorFuelQty).toFixed(2),
      normDec(fields.generatorFuelCost).toFixed(2),
      normHours(fields.solarOperatingHours).toFixed(2),
      normDec(fields.solarKwh).toFixed(2),
      normDec(fields.solarSavings).toFixed(2),
    ].join('|')
  );
}

export function computeRecordHashSnapshot(
  entries: UtilityEntry[],
  generationEntries: GenerationEntry[],
  utilities: UtilityItem[] = [],
  companies: CompanyItem[] = []
): RecordHashSnapshot {
  const utilityFullHashes: Record<string, string> = {};
  const utilityCoreHashes: Record<string, string> = {};
  const generationCoreHashes: Record<string, string> = {};

  for (const e of entries) {
    if (!e.date || !e.company || !e.utilityId) continue;
    const key = makeUtilityCompositeKey(e.date, e.company, e.utilityId);
    utilityFullHashes[key] = hashUtilityFullFields(e);
    utilityCoreHashes[key] = hashUtilityCoreFields(e);
  }

  for (const g of generationEntries) {
    if (!g.date || !g.company) continue;
    const key = makeGenerationCompositeKey(g.date, g.company);
    generationCoreHashes[key] = hashGenerationCoreFields(g);
  }

  const utilSig = [...utilities]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((u) => `${u.id}:${u.name}:${u.unit}`)
    .join(',');
  const compSig = [...companies]
    .map((c) => c.name.trim())
    .sort()
    .join(',');

  const sortedUtilKeys = Object.keys(utilityFullHashes).sort();
  const sortedGenKeys = Object.keys(generationCoreHashes).sort();

  const overallHash = stableHashString(
    [
      `C:${compSig}`,
      `U:${utilSig}`,
      ...sortedUtilKeys.map((k) => `E:${k}=${utilityFullHashes[k]}`),
      ...sortedGenKeys.map((k) => `G:${k}=${generationCoreHashes[k]}`),
    ].join('\n')
  );

  return {
    overallHash,
    utilityFullHashes,
    utilityCoreHashes,
    generationCoreHashes,
  };
}

export function loadSheetsBaseline(spreadsheetId: string): SheetsBaselineStore | null {
  if (typeof window === 'undefined' || !spreadsheetId) return null;
  try {
    const raw = window.localStorage.getItem(`${SHEETS_BASELINE_STORAGE_PREFIX}${spreadsheetId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SheetsBaselineStore>;
    if (!parsed || typeof parsed.overallHash !== 'string') return null;
    return {
      spreadsheetId,
      savedAt: String(parsed.savedAt || ''),
      overallHash: parsed.overallHash,
      utilityFullHashes:
        parsed.utilityFullHashes && typeof parsed.utilityFullHashes === 'object'
          ? parsed.utilityFullHashes
          : {},
      utilityCoreHashes:
        parsed.utilityCoreHashes && typeof parsed.utilityCoreHashes === 'object'
          ? parsed.utilityCoreHashes
          : {},
      generationCoreHashes:
        parsed.generationCoreHashes && typeof parsed.generationCoreHashes === 'object'
          ? parsed.generationCoreHashes
          : {},
    };
  } catch {
    return null;
  }
}

export function saveSheetsBaseline(
  spreadsheetId: string,
  snapshot: RecordHashSnapshot
): void {
  if (typeof window === 'undefined' || !spreadsheetId) return;
  try {
    const store: SheetsBaselineStore = {
      spreadsheetId,
      savedAt: new Date().toISOString(),
      overallHash: snapshot.overallHash,
      utilityFullHashes: snapshot.utilityFullHashes,
      utilityCoreHashes: snapshot.utilityCoreHashes,
      generationCoreHashes: snapshot.generationCoreHashes,
    };
    window.localStorage.setItem(
      `${SHEETS_BASELINE_STORAGE_PREFIX}${spreadsheetId}`,
      JSON.stringify(store)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSheetsBaseline(spreadsheetId: string): void {
  if (typeof window === 'undefined' || !spreadsheetId) return;
  try {
    window.localStorage.removeItem(`${SHEETS_BASELINE_STORAGE_PREFIX}${spreadsheetId}`);
  } catch {
    // Ignore storage errors
  }
}

function isFactoryYearTabTitle(title: string): boolean {
  return /^.+\s+-\s+\d{4}$/.test(title.trim());
}

export async function fetchWorkbookTabsFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  fallbackTabName?: string
): Promise<WorkbookReadResult> {
  const meta = await fetchSpreadsheetMetadata(accessToken, spreadsheetId);
  const relevantTabs = new Set<string>();

  if (meta.sheetNames.includes(MASTER_BACKUP_TAB_NAME)) {
    relevantTabs.add(MASTER_BACKUP_TAB_NAME);
  }
  for (const name of meta.sheetNames) {
    if (isFactoryYearTabTitle(name)) {
      relevantTabs.add(name);
    }
  }
  if (
    relevantTabs.size === 0 &&
    fallbackTabName &&
    meta.sheetNames.includes(fallbackTabName)
  ) {
    relevantTabs.add(fallbackTabName);
  }
  if (relevantTabs.size === 0 && meta.sheetNames.length > 0) {
    relevantTabs.add(meta.sheetNames[0]);
  }

  const targetNames = Array.from(relevantTabs);
  if (targetNames.length === 0) {
    return { tabs: [], masterRows: [], factoryTabs: [] };
  }

  const rangeParams = targetNames
    .map((name) => `ranges=${encodeURIComponent(quoteSheetRange(name, 'A1:ZZ5000'))}`)
    .join('&');

  const res = await sheetsFetch<{
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangeParams}`,
    accessToken
  );

  const tabs: WorkbookTabSnapshot[] = targetNames.map((tabName, idx) => ({
    tabName,
    rows: (res.valueRanges?.[idx]?.values || []).map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? '')) : []
    ),
  }));

  const masterTab =
    tabs.find((t) => t.tabName === MASTER_BACKUP_TAB_NAME) ||
    (fallbackTabName ? tabs.find((t) => t.tabName === fallbackTabName) : undefined);

  return {
    tabs,
    masterRows: masterTab?.rows || [],
    factoryTabs: tabs.filter((t) => isFactoryYearTabTitle(t.tabName)),
  };
}

export async function fetchWorkbookTabsFromAppsScript(
  webhookUrl: string,
  fallbackTabName?: string
): Promise<WorkbookReadResult> {
  const trimmed = webhookUrl.trim();
  if (!isValidAppsScriptUrl(trimmed)) {
    throw new Error(
      'Invalid Google Apps Script Web App URL. It must end with /exec.'
    );
  }

  const url = `${trimmed}?mode=workbook`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `Apps Script workbook read failed (${res.status}). Ensure your script includes doGet(e) and a New version is deployed.`
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    ok?: boolean;
    tabs?: Array<{ tabName?: string; rows?: unknown[][] }>;
    sheetName?: string;
    rows?: unknown[][];
    error?: string;
  } | null;

  if (!payload) {
    throw new Error(
      'Apps Script did not return a valid JSON response. Update to the v6 Apps Script template and deploy a New version.'
    );
  }
  if (payload.ok === false) {
    throw new Error(payload.error || 'Apps Script returned an error while reading.');
  }

  if (Array.isArray(payload.tabs)) {
    const tabs: WorkbookTabSnapshot[] = payload.tabs
      .filter((t) => t && typeof t.tabName === 'string' && Array.isArray(t.rows))
      .map((t) => ({
        tabName: String(t.tabName || ''),
        rows: (t.rows || []).map((r) =>
          Array.isArray(r) ? r.map((c) => String(c ?? '')) : []
        ),
      }));

    const masterTab =
      tabs.find((t) => t.tabName === MASTER_BACKUP_TAB_NAME) ||
      (fallbackTabName ? tabs.find((t) => t.tabName === fallbackTabName) : undefined);

    return {
      tabs,
      masterRows: masterTab?.rows || [],
      factoryTabs: tabs.filter((t) => isFactoryYearTabTitle(t.tabName)),
    };
  }

  // Legacy v4/v5 single-tab response fallback
  if (Array.isArray(payload.rows)) {
    const tabName = String(payload.sheetName || fallbackTabName || MASTER_BACKUP_TAB_NAME);
    const rows = payload.rows.map((r) =>
      Array.isArray(r) ? r.map((c) => String(c ?? '')) : []
    );
    return {
      tabs: [{ tabName, rows }],
      masterRows: tabName === MASTER_BACKUP_TAB_NAME || !isFactoryYearTabTitle(tabName) ? rows : [],
      factoryTabs: isFactoryYearTabTitle(tabName) ? [{ tabName, rows }] : [],
    };
  }

  throw new Error(
    'Apps Script did not return sheet rows. Update your Apps Script to v6 and deploy a New version.'
  );
}

export function parseFactoryYearSheetRows(
  tabName: string,
  rawRows: string[][],
  existingCompanies: CompanyItem[],
  existingUtilities: UtilityItem[]
): {
  company: string;
  utilityItems: ImportedSheetRow[];
  generationItems: ImportedGenerationRow[];
  isNewCompany: boolean;
  skipped: number;
} {
  const companyByLower = new Map<string, string>();
  for (const c of existingCompanies) {
    companyByLower.set(c.name.trim().toLowerCase(), c.name);
  }

  let inferredCompany = '';
  const tabMatch = tabName.trim().match(/^(.+?)\s+-\s+\d{4}$/);
  if (tabMatch) {
    inferredCompany = tabMatch[1].trim();
  }
  const bannerText = String(rawRows[0]?.[0] || '').trim();
  if (bannerText.includes(' — ')) {
    const fromBanner = bannerText.split(' — ')[0].trim();
    if (fromBanner && (!inferredCompany || fromBanner.toLowerCase().startsWith(inferredCompany.toLowerCase()))) {
      inferredCompany = fromBanner;
    }
  }

  if (!inferredCompany || !rawRows || rawRows.length < 4) {
    return {
      company: inferredCompany,
      utilityItems: [],
      generationItems: [],
      isNewCompany: false,
      skipped: 0,
    };
  }

  const matchedExisting =
    companyByLower.get(inferredCompany.toLowerCase()) ||
    existingCompanies.find((c) => c.name.slice(0, 88).toLowerCase() === inferredCompany.toLowerCase())?.name;
  const canonicalCompany = (matchedExisting || inferredCompany).slice(0, 100);
  const isNewCompany = !matchedExisting;

  let subHeaderIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 8); i++) {
    const c0 = String(rawRows[i]?.[0] || '').trim().toLowerCase();
    const c1 = String(rawRows[i]?.[1] || '').trim().toLowerCase();
    const c2 = String(rawRows[i]?.[2] || '').trim().toLowerCase();
    if (c0 === 'date' && c1 === 'day' && c2 === 'month') {
      subHeaderIdx = i;
      break;
    }
  }

  if (subHeaderIdx === -1) {
    return {
      company: canonicalCompany,
      utilityItems: [],
      generationItems: [],
      isNewCompany: false,
      skipped: 0,
    };
  }

  const groupRow = subHeaderIdx > 0 ? rawRows[subHeaderIdx - 1] || [] : [];
  const subRow = rawRows[subHeaderIdx] || [];
  const totalCols = Math.max(subRow.length, groupRow.length);

  // Propagate merged group header labels horizontally
  const groupLabels: string[] = [];
  let activeGroup = '';
  for (let c = 0; c < totalCols; c++) {
    const rawG = String(groupRow[c] || '').trim();
    if (rawG) activeGroup = rawG;
    groupLabels.push(activeGroup);
  }

  const utilByLower = new Map<string, UtilityItem>();
  for (const u of existingUtilities) {
    utilByLower.set(u.name.trim().toLowerCase(), u);
    utilByLower.set(`${u.name.trim()} (${u.unit.trim()})`.toLowerCase(), u);
    utilByLower.set(u.id.trim().toLowerCase(), u);
  }

  interface ParsedUtilBlock {
    util: UtilityItem;
    consIdx: number;
    hrsIdx: number;
    costIdx: number;
  }

  const utilBlocks: ParsedUtilBlock[] = [];
  let boilerCols: { hrsIdx: number; steamIdx: number; fuelQtyIdx: number; fuelCostIdx: number } | null = null;
  let genCols: { hrsIdx: number; kwhIdx: number; fuelQtyIdx: number; fuelCostIdx: number } | null = null;
  let solarCols: { hrsIdx: number; kwhIdx: number; savedIdx: number } | null = null;
  let noteIdx = -1;
  let enteredByIdx = -1;

  for (let c = 0; c < totalCols; c++) {
    const gLabel = groupLabels[c] || '';
    const gLower = gLabel.toLowerCase();
    const sLabel = String(subRow[c] || '').trim();
    const sLower = sLabel.toLowerCase();

    if (sLower === 'note') {
      noteIdx = c;
      continue;
    }
    if (sLower === 'entered by') {
      enteredByIdx = c;
      continue;
    }

    if (gLower.includes('boiler')) {
      if (!boilerCols) {
        boilerCols = { hrsIdx: -1, steamIdx: -1, fuelQtyIdx: -1, fuelCostIdx: -1 };
      }
      if (sLower === 'run hrs') boilerCols.hrsIdx = c;
      else if (sLower.startsWith('steam')) boilerCols.steamIdx = c;
      else if (sLower.startsWith('fuel qty')) boilerCols.fuelQtyIdx = c;
      else if (sLower.startsWith('fuel cost')) boilerCols.fuelCostIdx = c;
      continue;
    }

    if (gLower.includes('generator')) {
      if (!genCols) {
        genCols = { hrsIdx: -1, kwhIdx: -1, fuelQtyIdx: -1, fuelCostIdx: -1 };
      }
      if (sLower === 'run hrs') genCols.hrsIdx = c;
      else if (sLower.startsWith('power')) genCols.kwhIdx = c;
      else if (sLower.startsWith('fuel qty')) genCols.fuelQtyIdx = c;
      else if (sLower.startsWith('fuel cost')) genCols.fuelCostIdx = c;
      continue;
    }

    if (gLower.includes('solar')) {
      if (!solarCols) {
        solarCols = { hrsIdx: -1, kwhIdx: -1, savedIdx: -1 };
      }
      if (sLower === 'run hrs') solarCols.hrsIdx = c;
      else if (sLower.startsWith('solar')) solarCols.kwhIdx = c;
      else if (sLower.startsWith('saved')) solarCols.savedIdx = c;
      continue;
    }

    if (sLower.startsWith('cons (')) {
      const groupNameOnly = gLabel.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      const matchedUtil =
        utilByLower.get(gLower) ||
        utilByLower.get(groupNameOnly) ||
        existingUtilities.find((u) => gLower.startsWith(u.name.trim().toLowerCase()));
      if (matchedUtil) {
        const next1 = String(subRow[c + 1] || '').trim().toLowerCase();
        const next2 = String(subRow[c + 2] || '').trim().toLowerCase();
        const next3 = String(subRow[c + 3] || '').trim().toLowerCase();
        const hrsIdx = next1 === 'run hrs' ? c + 1 : -1;
        const costIdx = next3.startsWith('cost')
          ? c + 3
          : next2.startsWith('cost')
          ? c + 2
          : -1;
        utilBlocks.push({
          util: matchedUtil,
          consIdx: c,
          hrsIdx,
          costIdx,
        });
      }
    }
  }

  const utilityItems: ImportedSheetRow[] = [];
  const generationItems: ImportedGenerationRow[] = [];
  let skipped = 0;

  for (let r = subHeaderIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;

    const rawDate = String(row[0] || '').trim();
    const lowerDate = rawDate.toLowerCase();
    if (
      !rawDate ||
      lowerDate.startsWith('subtotal') ||
      lowerDate.startsWith('annual total') ||
      lowerDate === 'monthly total'
    ) {
      continue;
    }

    const normalizedDate = normalizeImportedDate(rawDate);
    if (!normalizedDate) {
      skipped += 1;
      continue;
    }

    const rowNote =
      noteIdx >= 0 ? String(row[noteIdx] || '').trim().slice(0, 300) : '';
    const enteredByName =
      enteredByIdx >= 0 ? String(row[enteredByIdx] || '').trim().slice(0, 100) : '';

    for (const blk of utilBlocks) {
      const consVal = parseNumberString(row[blk.consIdx] || '');
      const hrsVal = blk.hrsIdx >= 0 ? parseNumberString(row[blk.hrsIdx] || '') : null;
      const costVal = blk.costIdx >= 0 ? parseNumberString(row[blk.costIdx] || '') : null;

      if (consVal === null && hrsVal === null && costVal === null) {
        continue;
      }

      utilityItems.push({
        entryId: '',
        date: normalizedDate,
        company: canonicalCompany,
        utilityId: blk.util.id,
        utilityName: blk.util.name,
        unit: blk.util.unit,
        consumption: roundNum(consVal ?? 0, 2),
        operatingHours: Math.min(24, Math.max(0, roundNum(hrsVal ?? 0, 2))),
        cost: roundNum(costVal ?? 0, 2),
        note: rowNote,
        enteredByName,
      });
    }

    const bHrs = boilerCols && boilerCols.hrsIdx >= 0 ? parseNumberString(row[boilerCols.hrsIdx] || '') : null;
    const bSteam = boilerCols && boilerCols.steamIdx >= 0 ? parseNumberString(row[boilerCols.steamIdx] || '') : null;
    const bQty = boilerCols && boilerCols.fuelQtyIdx >= 0 ? parseNumberString(row[boilerCols.fuelQtyIdx] || '') : null;
    const bCost = boilerCols && boilerCols.fuelCostIdx >= 0 ? parseNumberString(row[boilerCols.fuelCostIdx] || '') : null;
    const hasBoilerData =
      bHrs !== null || bSteam !== null || bQty !== null || bCost !== null;

    const gHrs = genCols && genCols.hrsIdx >= 0 ? parseNumberString(row[genCols.hrsIdx] || '') : null;
    const gKwh = genCols && genCols.kwhIdx >= 0 ? parseNumberString(row[genCols.kwhIdx] || '') : null;
    const gQty = genCols && genCols.fuelQtyIdx >= 0 ? parseNumberString(row[genCols.fuelQtyIdx] || '') : null;
    const gCost = genCols && genCols.fuelCostIdx >= 0 ? parseNumberString(row[genCols.fuelCostIdx] || '') : null;
    const hasGeneratorData =
      gHrs !== null || gKwh !== null || gQty !== null || gCost !== null;

    const sHrs = solarCols && solarCols.hrsIdx >= 0 ? parseNumberString(row[solarCols.hrsIdx] || '') : null;
    const sKwh = solarCols && solarCols.kwhIdx >= 0 ? parseNumberString(row[solarCols.kwhIdx] || '') : null;
    const sSav = solarCols && solarCols.savedIdx >= 0 ? parseNumberString(row[solarCols.savedIdx] || '') : null;
    const hasSolarData = sHrs !== null || sKwh !== null || sSav !== null;

    if (hasBoilerData || hasGeneratorData || hasSolarData) {
      generationItems.push({
        date: normalizedDate,
        company: canonicalCompany,
        boilerOperatingHours: Math.min(24, Math.max(0, roundNum(bHrs ?? 0, 2))),
        steamKg: roundNum(bSteam ?? 0, 2),
        boilerFuelQty: roundNum(bQty ?? 0, 2),
        boilerFuelCost: roundNum(bCost ?? 0, 2),
        generatorOperatingHours: Math.min(24, Math.max(0, roundNum(gHrs ?? 0, 2))),
        generatorKwh: roundNum(gKwh ?? 0, 2),
        generatorFuelQty: roundNum(gQty ?? 0, 2),
        generatorFuelCost: roundNum(gCost ?? 0, 2),
        solarOperatingHours: Math.min(24, Math.max(0, roundNum(sHrs ?? 0, 2))),
        solarKwh: roundNum(sKwh ?? 0, 2),
        solarSavings: roundNum(sSav ?? 0, 2),
        hasBoilerData,
        hasGeneratorData,
        hasSolarData,
        note: rowNote,
        enteredByName,
      });
    }
  }

  return {
    company: canonicalCompany,
    utilityItems,
    generationItems,
    isNewCompany,
    skipped,
  };
}

export function reconcileWorkbookWithApp(params: {
  workbook: WorkbookReadResult;
  entries: UtilityEntry[];
  generationEntries: GenerationEntry[];
  companies: CompanyItem[];
  utilities: UtilityItem[];
  lastSyncedHash?: string;
  baseline?: SheetsBaselineStore | null;
  preferSheetOnPullOnly?: boolean;
}): ReconciliationPlan {
  const {
    workbook,
    entries,
    generationEntries,
    companies,
    utilities,
    lastSyncedHash,
    baseline,
    preferSheetOnPullOnly = false,
  } = params;

  const snapshot = computeRecordHashSnapshot(
    entries,
    generationEntries,
    utilities,
    companies
  );

  // If lastSyncedHash matches current appHash, App has NOT changed since the last completed Google Sheets sync.
  const appUnchangedGlobally =
    Boolean(lastSyncedHash) && lastSyncedHash === snapshot.overallHash;

  const entryByComposite = new Map<string, UtilityEntry>();
  const entryById = new Map<string, UtilityEntry>();
  for (const e of entries) {
    entryById.set(e.id, e);
    entryByComposite.set(makeUtilityCompositeKey(e.date, e.company, e.utilityId), e);
  }

  const genByComposite = new Map<string, GenerationEntry>();
  for (const g of generationEntries) {
    genByComposite.set(makeGenerationCompositeKey(g.date, g.company), g);
  }

  const newCompanySet = new Set<string>();
  let skipped = 0;

  // 1. Parse Master_Backup (safe even if header absent/blank)
  const masterMap = new Map<string, ImportedSheetRow>();
  if (workbook.masterRows.length > 0) {
    try {
      const parsedMaster = parseImportedSheetRows(
        workbook.masterRows,
        companies,
        utilities
      );
      skipped += parsedMaster.skipped;
      for (const comp of parsedMaster.newCompanies) {
        newCompanySet.add(comp);
      }
      for (const item of parsedMaster.items) {
        masterMap.set(
          makeUtilityCompositeKey(item.date, item.company, item.utilityId),
          item
        );
      }
    } catch {
      // Master_Backup may not have valid headers yet if reading a standalone Factory tab
    }
  }

  // 2. Parse Factory - YYYY tabs (both utilities and plant generation)
  const factoryUtilMap = new Map<string, ImportedSheetRow>();
  const factoryGenMap = new Map<string, ImportedGenerationRow>();
  for (const tab of workbook.factoryTabs) {
    const parsedTab = parseFactoryYearSheetRows(
      tab.tabName,
      tab.rows,
      companies,
      utilities
    );
    skipped += parsedTab.skipped;
    if (parsedTab.isNewCompany && parsedTab.company) {
      newCompanySet.add(parsedTab.company);
    }
    for (const item of parsedTab.utilityItems) {
      factoryUtilMap.set(
        makeUtilityCompositeKey(item.date, item.company, item.utilityId),
        item
      );
    }
    for (const gen of parsedTab.generationItems) {
      factoryGenMap.set(makeGenerationCompositeKey(gen.date, gen.company), gen);
    }
  }

  const utilityOps: ReconciledUtilityOp[] = [];
  const allUtilKeys = new Set<string>([
    ...masterMap.keys(),
    ...factoryUtilMap.keys(),
  ]);

  for (const key of allUtilKeys) {
    const masterItem = masterMap.get(key);
    const factoryItem = factoryUtilMap.get(key);
    const existing =
      (masterItem?.entryId ? entryById.get(masterItem.entryId) : undefined) ||
      entryByComposite.get(key);

    const masterFullHash = masterItem ? hashUtilityFullFields(masterItem) : undefined;
    const masterCoreHash = masterItem ? hashUtilityCoreFields(masterItem) : undefined;
    const factoryCoreHash = factoryItem ? hashUtilityCoreFields(factoryItem) : undefined;

    const appFullHash = snapshot.utilityFullHashes[key];
    const appCoreHash = snapshot.utilityCoreHashes[key];
    const baseFullHash = baseline?.utilityFullHashes[key];
    const baseCoreHash = baseline?.utilityCoreHashes[key];

    const appChangedLocally =
      !appUnchangedGlobally &&
      (baseFullHash !== undefined ? appFullHash !== baseFullHash : Boolean(existing));

    if (!existing) {
      // If App recently deleted this row relative to baseline and neither Master nor Factory edited it since baseline -> do NOT resurrect it; push the deletion to Sheet instead.
      if (baseFullHash && !preferSheetOnPullOnly) {
        const masterUnchangedFromBase =
          !masterFullHash || masterFullHash === baseFullHash;
        const factoryUnchangedFromBase =
          !factoryCoreHash || !baseCoreHash || factoryCoreHash === baseCoreHash;
        if (masterUnchangedFromBase && factoryUnchangedFromBase) {
          continue;
        }
      }

      const chosen = factoryItem || masterItem;
      if (!chosen) continue;
      // Preserve clean note if Master_Backup also had this row, otherwise take Factory note
      const mergedItem: ImportedSheetRow =
        factoryItem && masterItem
          ? {
              ...factoryItem,
              entryId: masterItem.entryId || '',
              unit: masterItem.unit || factoryItem.unit,
              note: masterItem.note || factoryItem.note,
              enteredByName: masterItem.enteredByName || factoryItem.enteredByName,
            }
          : chosen;

      utilityOps.push({
        mode: 'create',
        targetId:
          mergedItem.entryId && /^[a-zA-Z0-9_-]{1,128}$/.test(mergedItem.entryId)
            ? mergedItem.entryId
            : undefined,
        source: factoryItem ? 'factoryYear' : 'master',
        item: mergedItem,
      });
      continue;
    }

    // Existing record in Firestore: determine if Sheet edited it relative to App / Baseline
    const factoryDiffersFromApp =
      factoryCoreHash !== undefined && factoryCoreHash !== appCoreHash;
    const factoryDiffersFromBase =
      factoryCoreHash !== undefined &&
      (baseCoreHash !== undefined ? factoryCoreHash !== baseCoreHash : factoryDiffersFromApp);

    const masterDiffersFromApp =
      masterFullHash !== undefined && masterFullHash !== appFullHash;
    const masterDiffersFromBase =
      masterFullHash !== undefined &&
      (baseFullHash !== undefined ? masterFullHash !== baseFullHash : masterDiffersFromApp);

    const canPullSheet =
      preferSheetOnPullOnly || appUnchangedGlobally || !appChangedLocally;

    if (!canPullSheet) continue;

    // Prioritize whichever tab changed relative to baseline (or Factory - YYYY if both differ)
    if (factoryItem && factoryDiffersFromApp && (factoryDiffersFromBase || preferSheetOnPullOnly || appUnchangedGlobally)) {
      // Preserve per-utility note unless Master_Backup explicitly modified the note while unchanged in Factory
      const useMasterNote =
        masterItem &&
        masterFullHash !== baseFullHash &&
        masterCoreHash === baseCoreHash;
      utilityOps.push({
        mode: 'update',
        targetId: existing.id,
        existingEnteredBy: existing.enteredBy,
        source: 'factoryYear',
        item: {
          ...factoryItem,
          entryId: existing.id,
          unit: existing.unit || factoryItem.unit,
          note: useMasterNote ? masterItem.note : existing.note,
          enteredByName: existing.enteredByName || factoryItem.enteredByName,
        },
      });
    } else if (
      masterItem &&
      masterDiffersFromApp &&
      (masterDiffersFromBase || preferSheetOnPullOnly || appUnchangedGlobally)
    ) {
      utilityOps.push({
        mode: 'update',
        targetId: existing.id,
        existingEnteredBy: existing.enteredBy,
        source: 'master',
        item: {
          ...masterItem,
          entryId: existing.id,
        },
      });
    }
  }

  // 3. Reconcile Generation entries from Factory - YYYY tabs
  const generationOps: ReconciledGenerationOp[] = [];
  for (const [key, sheetGen] of factoryGenMap.entries()) {
    const existingGen = genByComposite.get(key);
    const sheetGenHash = hashGenerationCoreFields({
      date: sheetGen.date,
      company: sheetGen.company,
      boilerOperatingHours: sheetGen.boilerOperatingHours,
      steamKg: sheetGen.steamKg,
      boilerFuelQty: sheetGen.boilerFuelQty,
      boilerFuelCost: sheetGen.boilerFuelCost,
      generatorOperatingHours: sheetGen.generatorOperatingHours,
      generatorKwh: sheetGen.generatorKwh,
      generatorFuelQty: sheetGen.generatorFuelQty,
      generatorFuelCost: sheetGen.generatorFuelCost,
      solarOperatingHours: sheetGen.solarOperatingHours,
      solarKwh: sheetGen.solarKwh,
      solarSavings: sheetGen.solarSavings,
    });

    const appGenHash = snapshot.generationCoreHashes[key];
    const baseGenHash = baseline?.generationCoreHashes[key];
    const appChangedLocally =
      !appUnchangedGlobally &&
      (baseGenHash !== undefined ? appGenHash !== baseGenHash : Boolean(existingGen));

    if (!existingGen) {
      if (baseGenHash && sheetGenHash === baseGenHash && !preferSheetOnPullOnly) {
        // App deleted this generation log and Sheet still holds stale pre-delete copy
        continue;
      }
      generationOps.push({
        mode: 'create',
        item: sheetGen,
      });
      continue;
    }

    const canPullSheet =
      preferSheetOnPullOnly || appUnchangedGlobally || !appChangedLocally;
    const sheetDiffersFromApp = sheetGenHash !== appGenHash;
    const sheetDiffersFromBase =
      baseGenHash !== undefined ? sheetGenHash !== baseGenHash : sheetDiffersFromApp;

    if (canPullSheet && sheetDiffersFromApp && (sheetDiffersFromBase || preferSheetOnPullOnly || appUnchangedGlobally)) {
      generationOps.push({
        mode: 'update',
        targetId: existingGen.id,
        existingEnteredBy: existingGen.enteredBy,
        existingEntry: existingGen,
        item: sheetGen,
      });
    }
  }

  // Push is needed whenever App changed relative to lastSyncedHash OR when we pulled edits from one sheet tab and should re-sync/format all workbook tabs consistently
  const hasPulledChanges = utilityOps.length > 0 || generationOps.length > 0 || newCompanySet.size > 0;
  const needsPushToSheet =
    hasPulledChanges ||
    !lastSyncedHash ||
    lastSyncedHash !== snapshot.overallHash ||
    workbook.tabs.length === 0;

  return {
    utilityOps,
    generationOps,
    newCompanies: Array.from(newCompanySet),
    skipped,
    appHash: snapshot.overallHash,
    needsPushToSheet,
  };
}

