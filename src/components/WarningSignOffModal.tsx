import React, { useState } from 'react';

interface WarningSignOffModalProps {
  open: boolean;
  warningCount: number;
  onClose: () => void;
  onConfirm: (approver: string, reason: string, expiry: string) => void;
}

export const WarningSignOffModal: React.FC<WarningSignOffModalProps> = ({
  open,
  warningCount,
  onClose,
  onConfirm,
}) => {
  const [approver, setApprover] = useState('');
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState('Current S&OP Cycle');
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!approver.trim() || reason.trim().length < 10) {
      setErrorMsg('Approver name and a justification of at least 10 characters are required.');
      return;
    }
    setErrorMsg('');
    onConfirm(approver.trim(), reason.trim(), expiry);
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signOffModalTitle"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-5 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <h3 id="signOffModalTitle" className="text-sm font-extrabold text-slate-900">
            Governed Warning Acknowledgement
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close warning sign-off modal"
            className="text-slate-400 hover:text-slate-700 text-xs font-bold px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-600">
          Critical Blockers are at <strong>0</strong>. Use this sign-off to formally document the{' '}
          <strong className="text-amber-700">{warningCount} non-blocking warning(s)</strong> for
          this S&amp;OP cycle. Critical blockers can never be bypassed by manager override.
        </p>

        <div className="space-y-2.5 text-xs">
          <div>
            <label htmlFor="ovApproverInput" className="font-semibold text-slate-700 block mb-1">
              Approving Manager Name &amp; Role
            </label>
            <input
              id="ovApproverInput"
              type="text"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5"
            />
          </div>
          <div>
            <label htmlFor="ovReasonInput" className="font-semibold text-slate-700 block mb-1">
              Business Justification (Required, min 10 characters)
            </label>
            <textarea
              id="ovReasonInput"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Seasonal stockout warnings reviewed with regional commercial team..."
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5"
            />
          </div>
          <div>
            <label htmlFor="ovExpirySelect" className="font-semibold text-slate-700 block mb-1">
              Acknowledgement Window
            </label>
            <select
              id="ovExpirySelect"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 bg-white"
            >
              <option value="24 Hours">24 Hours (Temporary Run)</option>
              <option value="Current S&OP Cycle">Current S&amp;OP Cycle Only</option>
              <option value="7 Days">7 Days (Pending ERP Fix)</option>
            </select>
          </div>
          {errorMsg && <p className="text-rose-600 font-semibold">{errorMsg}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
          >
            Log Warning Sign-Off
          </button>
        </div>
      </form>
    </div>
  );
};
