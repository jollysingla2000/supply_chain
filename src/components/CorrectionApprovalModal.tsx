import React, { useEffect, useState } from 'react';
import { ApprovedCorrection, ValidationException } from '../engine/types';
import { parseFlexibleDate, parseStrictNumber } from '../engine/validation';

interface CorrectionApprovalModalProps {
  exception: ValidationException | null;
  onClose: () => void;
  onApprove: (correction: Omit<ApprovedCorrection, 'id' | 'approvedAt'>) => void;
}

export const CorrectionApprovalModal: React.FC<CorrectionApprovalModalProps> = ({
  exception,
  onClose,
  onApprove,
}) => {
  const [approver, setApprover] = useState('Jolly Singla (Data Steward)');
  const [reason, setReason] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [negMode, setNegMode] = useState<'CREDIT_RETURN' | 'BILLING_CORRECTION'>('CREDIT_RETURN');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!exception) return;
    setFormError('');
    setNegMode('CREDIT_RETURN');
    if (exception.availableOptions && exception.availableOptions.length > 0) {
      setValueInput('');
    } else if (exception.suggestedVal !== undefined) {
      setValueInput(String(exception.suggestedVal));
    } else if (exception.missingPeriodMeta) {
      setValueInput('');
    } else {
      setValueInput('');
    }
    setReason(
      exception.requiresBusinessJudgement
        ? ''
        : 'Deterministic technical rule fix verified'
    );
  }, [exception]);

  if (!exception) return null;

  const isOptionSelect = Boolean(
    exception.availableOptions && exception.availableOptions.length > 0
  );
  const isNegative = exception.fixType === 'FIX_NEGATIVE';
  const isDuplicate = exception.fixType === 'REMOVE_DUPLICATE';
  const isSwapDates = exception.fixType === 'SWAP_PROMO_DATES';
  const isSanitize = exception.fixType === 'SANITIZE_CELL';
  const isSchema = exception.fixType === 'SCHEMA_REMEDIATION';
  const isTableLevelSchema = isSchema && (exception.rowIndex < 0 || !exception.targetCol);
  const isRowLevelSchema = isSchema && exception.rowIndex >= 0 && Boolean(exception.targetCol);
  const isDateSchemaError =
    isRowLevelSchema && exception.signature.startsWith('SCHEMA|INVALID_DATE|');
  const isNumericSchemaError =
    isRowLevelSchema &&
    (exception.signature.startsWith('SCHEMA|INVALID_NUM|') ||
      exception.signature.startsWith('SCHEMA|NEG_NONNEG|'));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!approver.trim()) {
      setFormError('Approver name is required.');
      return;
    }
    if (reason.trim().length < 5) {
      setFormError('Approval justification (min 5 characters) is required.');
      return;
    }

    let approvedValue: string | number = valueInput.trim();
    let afterSummary = '';

    if (isTableLevelSchema) {
      setFormError(
        'Table-level schema violations (missing mandatory tables or columns) must be corrected in the source workbook and re-uploaded.'
      );
      return;
    }

    if (isRowLevelSchema) {
      if (isDateSchemaError) {
        const parsed = parseFlexibleDate(valueInput.trim());
        if (!parsed) {
          setFormError(
            'Enter an unambiguous valid date in YYYY-MM-DD (e.g. 2025-02-01) or DD-MMM-YYYY (e.g. 01-Feb-2025) format. Ambiguous slash dates (e.g. 01/02/2025) are rejected.'
          );
          return;
        }
        approvedValue = parsed.toISOString().slice(0, 10);
        afterSummary = `Normalized ${exception.targetCol} to ${approvedValue} (ISO YYYY-MM-DD)`;
      } else if (isNumericSchemaError) {
        const num = parseStrictNumber(valueInput.trim());
        if (
          !Number.isFinite(num) ||
          (exception.signature.startsWith('SCHEMA|NEG_NONNEG|') && num < 0)
        ) {
          setFormError('Enter a valid non-negative numeric value.');
          return;
        }
        approvedValue = num;
        afterSummary = `Corrected ${exception.targetCol} to ${num}`;
      } else {
        if (!valueInput.trim()) {
          setFormError(`Enter a valid non-empty value for ${exception.targetCol}.`);
          return;
        }
        approvedValue = valueInput.trim();
        afterSummary = `Populated ${exception.targetCol} with "${approvedValue}"`;
      }
    } else if (isDuplicate) {
      approvedValue = 'REMOVE_DUPLICATE_ROW';
      afterSummary = `Marked duplicate Row #${exception.rowNum} as superseded in governed view`;
    } else if (isSwapDates) {
      approvedValue = exception.suggestedVal ?? 'SWAPPED';
      afterSummary = exception.suggestedValText;
    } else if (isSanitize) {
      approvedValue = valueInput.trim() || String(exception.suggestedVal ?? 'SAFE_TEXT');
      afterSummary = `Sanitized to "${approvedValue}"`;
    } else if (isNegative) {
      if (negMode === 'CREDIT_RETURN') {
        approvedValue = 0;
        afterSummary = 'Reclassified as Credit Return (0 Billed + Reconciled Returns Delta)';
      } else {
        const num = Number(valueInput);
        if (!Number.isFinite(num) || num < 0) {
          setFormError('Enter a valid non-negative billed quantity.');
          return;
        }
        approvedValue = num;
        afterSummary = `Corrected Billed Qty to ${num} u`;
      }
    } else if (isOptionSelect) {
      if (!approvedValue) {
        setFormError('Select a verified master target value from the list.');
        return;
      }
      afterSummary = `Mapped to verified value "${approvedValue}"`;
    } else {
      const numericFixes = new Set([
        'IMPUTE_ACTUAL',
        'IMPUTE_MISSING_PERIOD',
        'TAG_SPIKE',
        'FIX_UOM',
        'CAP_FORECAST',
        'RESTORE_STOCKOUT',
        'RESOLVE_PROMO_OVERLAP',
        'FIX_COGS',
        'CAP_OVERRIDE',
      ]);
      if (numericFixes.has(exception.fixType)) {
        const num = Number(valueInput);
        if (valueInput.trim() === '' || !Number.isFinite(num) || num < 0) {
          setFormError('Enter a valid non-negative numeric value.');
          return;
        }
        approvedValue = num;
        afterSummary =
          exception.fixType === 'IMPUTE_MISSING_PERIOD'
            ? `Continuity row added (0 Billed Actuals, ${num.toLocaleString()} u Governed Imputed Demand)`
            : `${num.toLocaleString()} (Governed Approval)`;
      }
    }

    onApprove({
      exceptionSignature: exception.signature,
      fixType: exception.fixType,
      table: exception.table,
      rowIndex: exception.rowIndex,
      targetCol: exception.targetCol,
      approvedValue,
      classificationMode: isNegative ? negMode : undefined,
      beforeSummary: exception.badVal,
      afterSummary,
      approver: approver.trim(),
      reason: reason.trim(),
      missingPeriodMeta: exception.missingPeriodMeta
        ? {
            periodDate: exception.missingPeriodMeta.periodDate,
            sku: exception.missingPeriodMeta.sku,
            depot: exception.missingPeriodMeta.depot,
            channel: exception.missingPeriodMeta.channel,
          }
        : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correctionModalTitle"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-5 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              Non-Destructive Governance
            </span>
            <h3 id="correctionModalTitle" className="text-sm font-extrabold text-slate-900 mt-1">
              Review &amp; Approve Correction ({exception.id})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close correction approval modal"
            className="text-slate-400 hover:text-slate-700 text-xs font-bold px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
          <div>
            <span className="font-bold text-slate-700">Target:</span>{' '}
            <span className="font-mono text-blue-800">{exception.table}</span> •{' '}
            <span>{exception.intersection}</span>
          </div>
          <div>
            <span className="font-bold text-slate-700">Issue:</span> {exception.issue}
          </div>
          <div>
            <span className="font-bold text-slate-700">Original Source Value (Kept Untouched):</span>{' '}
            <span className="font-mono font-bold text-rose-700">{exception.badVal}</span>
          </div>
          {exception.missingPeriodMeta && (
            <div className="text-slate-600">
              <span className="font-bold">Empirical Neighbor Reference (Info Only):</span>{' '}
              {exception.missingPeriodMeta.referenceAvgQty.toLocaleString()} u
            </div>
          )}
        </div>

        {isTableLevelSchema ? (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-semibold">
            Table-level schema violations (missing mandatory tables or missing mandatory columns)
            must be added to the source workbook and re-uploaded.
          </div>
        ) : (
          <div className="space-y-2.5 text-xs">
            {isDateSchemaError && (
              <div className="p-2.5 rounded bg-blue-50 border border-blue-200 text-blue-900 space-y-1">
                <div className="font-bold">Accepted Date Formats &amp; Normalization Rule:</div>
                <div>
                  Use ISO <code className="font-mono font-bold">YYYY-MM-DD</code> (e.g.{' '}
                  <code className="font-mono">2025-02-01</code>),{' '}
                  <code className="font-mono font-bold">DD-MMM-YYYY</code> (e.g.{' '}
                  <code className="font-mono">01-Feb-2025</code>), or native Excel Date cells.
                  Ambiguous slash dates where both day &amp; month ≤ 12 (e.g.{' '}
                  <code className="font-mono">01/02/2025</code>) are rejected to prevent DD/MM vs
                  MM/DD inversion.
                </div>
              </div>
            )}

            {isNegative && (
              <div>
                <label htmlFor="negModeSelect" className="font-semibold text-slate-700 block mb-1">
                  Business Classification
                </label>
                <select
                  id="negModeSelect"
                  value={negMode}
                  onChange={(e) =>
                    setNegMode(e.target.value as 'CREDIT_RETURN' | 'BILLING_CORRECTION')
                  }
                  className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white"
                >
                  <option value="CREDIT_RETURN">
                    Legitimate Credit Return (Set Billed = 0 u, Reconcile Unrecorded Returns Delta)
                  </option>
                  <option value="BILLING_CORRECTION">
                    Invalid Negative Billing (Enter Corrected Billed Qty)
                  </option>
                </select>
              </div>
            )}

            {isOptionSelect && exception.availableOptions && (
              <div>
                <label htmlFor="corrTargetSelect" className="font-semibold text-slate-700 block mb-1">
                  Select Verified Target Value
                </label>
                <select
                  id="corrTargetSelect"
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white font-mono"
                >
                  <option value="">-- Choose Verified Master Record --</option>
                  {exception.availableOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isOptionSelect &&
              !isDuplicate &&
              !isSwapDates &&
              (!isNegative || negMode === 'BILLING_CORRECTION') && (
                <div>
                  <label htmlFor="corrValueInput" className="font-semibold text-slate-700 block mb-1">
                    {isDateSchemaError
                      ? `Normalized ISO Date for ${exception.targetCol} (YYYY-MM-DD)`
                      : 'Approved Value (Explicit Confirmation Required)'}
                  </label>
                  <input
                    id="corrValueInput"
                    type={isSanitize || (isRowLevelSchema && !isNumericSchemaError) ? 'text' : 'number'}
                    step="any"
                    value={valueInput}
                    onChange={(e) => setValueInput(e.target.value)}
                    placeholder={
                      isDateSchemaError
                        ? 'e.g. 2025-02-01 or 01-Feb-2025'
                        : 'Enter confirmed value...'
                    }
                    className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 font-mono font-bold"
                  />
                </div>
              )}

            {isDuplicate && (
              <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                Confirming will mark colliding duplicate Row #{exception.rowNum} as superseded in
                the Governed Working View while preserving the original source row untouched.
              </div>
            )}

            <div>
              <label htmlFor="corrApproverInput" className="font-semibold text-slate-700 block mb-1">
                Approver Name &amp; Role
              </label>
              <input
                id="corrApproverInput"
                type="text"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5"
              />
            </div>

            <div>
              <label htmlFor="corrReasonInput" className="font-semibold text-slate-700 block mb-1">
                Business Justification / Audit Note (Required)
              </label>
              <textarea
                id="corrReasonInput"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this correction is valid (logged in Before/After Audit Trail)..."
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5"
              />
            </div>
          </div>
        )}

        {formError && <p className="text-xs text-rose-600 font-semibold">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          {!isTableLevelSchema && (
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              Approve Correction
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
