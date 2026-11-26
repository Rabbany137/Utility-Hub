import React from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { formatNumber } from '../utils/formatters';

interface GoogleSheetsSyncModalProps {
  open: boolean;
  spreadsheetTitle: string;
  sheetName: string;
  recordCount: number;
  syncing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GoogleSheetsSyncModal({
  open,
  spreadsheetTitle,
  sheetName,
  recordCount,
  syncing,
  onConfirm,
  onCancel,
}: GoogleSheetsSyncModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheets-sync-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
            <h3
              id="sheets-sync-title"
              className="text-base font-bold text-slate-900"
            >
              Confirm Google Sheets Update
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={syncing}
            aria-label="Close dialog"
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm text-slate-600 leading-relaxed">
          <p>
            This action will sync{' '}
            <span className="font-semibold text-slate-900 tabular-nums">
              {formatNumber(recordCount, 0)}
            </span>{' '}
            utility entry rows into{' '}
            <span className="font-semibold text-slate-900">&quot;{spreadsheetTitle}&quot;</span>, organizing the main{' '}
            <span className="font-mono-num text-slate-900">Master_Backup</span> tab,{' '}
            <span className="font-mono-num text-slate-900">Monthly_Summary</span> tab, and separate monthly tabs per factory (e.g., <span className="font-mono-num text-slate-800">Factory - Nov 2026</span>).
          </p>
          <p className="text-xs text-slate-500">
            New monthly tabs are created automatically whenever a new factory, month, or year is logged. Each tab includes Unit Cost (BDT/Unit) and Monthly Totals.
          </p>
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={syncing}
            className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
          >
            {syncing ? 'Syncing...' : 'Confirm & Sync'}
          </button>
        </div>
      </div>
    </div>
  );
}
