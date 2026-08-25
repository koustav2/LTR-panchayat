import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { DeskHead, Field, YesNo, Banner, Modal, formatDate, formatMoney } from '../components/ui';
import { PhotoUploader, DocumentUploader } from '../components/Uploader';

const DRAFT_KEY = 'lrt.sahayak.draft.v1';

const EMPTY = {
  aadhaar: '',
  fullName: '',
  guardianName: '',
  phone: '',
  blockId: '',
  panchayatId: '',
  pinCode: '',
  supportTypeId: '',
  supportReasonId: '',
  amount: '',
  ppRecommend: '',
  ppComment: '',
  msRecommend: '',
  msComment: '',
  mpRecommend: '',
  mpComment: '',
};

const digits = (v) => v.replace(/\D/g, '');

export default function SahayakForm() {
  const { serverDate } = useAuth();
  const navigate = useNavigate();

  const [master, setMaster] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [photo, setPhoto] = useState(null);
  const [documents, setDocuments] = useState([]);

  const [lookup, setLookup] = useState({ state: 'idle', data: null });
  const [identityLocked, setIdentityLocked] = useState(false);

  const [banner, setBanner] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [success, setSuccess] = useState(null);
  const [copied, setCopied] = useState(false);

  const lookupSeq = useRef(0);

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    api.bootstrap().then(setMaster).catch((e) => setBanner({ kind: 'error', text: e.message }));
  }, []);

  // Restore a draft. Field connectivity drops constantly, so a half-typed form
  // must survive a reload or an accidental back-swipe.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setForm({ ...EMPTY, ...parsed.form });
          setPhoto(parsed.photo || null);
          setDocuments(parsed.documents || []);
          setBanner({ kind: 'info', text: 'An unfinished form was restored.', clearable: true });
        }
      }
    } catch {
      /* corrupt draft — ignore */
    }
  }, []);

  const hasContent = useMemo(() => Object.values(form).some((v) => String(v).trim() !== ''), [form]);

  useEffect(() => {
    if (success) return;
    if (!hasContent && !photo && documents.length === 0) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, photo, documents }));
      } catch {
        /* storage full or blocked — the form still works */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [form, photo, documents, hasContent, success]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  /* --------------------------------------------------------------- fields */

  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  // Echo the typed amount back formatted. An extra zero is very easy to type
  // and very hard to spot in a bare number field.
  const amountPreview = useMemo(() => {
    const raw = form.amount.replace(/[,\s₹]/g, '');
    if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    return formatMoney(n, { compact: n % 1 === 0 });
  }, [form.amount]);

  const panchayats = useMemo(() => {
    if (!master || !form.blockId) return [];
    return master.panchayats.filter((p) => String(p.block_id) === String(form.blockId));
  }, [master, form.blockId]);

  const reasons = useMemo(() => {
    if (!master || !form.supportTypeId) return [];
    return master.supportReasons.filter((r) => String(r.support_type_id) === String(form.supportTypeId));
  }, [master, form.supportTypeId]);

  // Changing the parent must clear the child, otherwise a stale panchayat from
  // the other block stays selected and the server rejects the submission.
  const onBlockChange = (value) => {
    setForm((f) => ({ ...f, blockId: value, panchayatId: '' }));
    setErrors((e) => ({ ...e, blockId: undefined, panchayatId: undefined }));
  };

  const onSupportTypeChange = (value) => {
    setForm((f) => ({ ...f, supportTypeId: value, supportReasonId: '' }));
    setErrors((e) => ({ ...e, supportTypeId: undefined, supportReasonId: undefined }));
  };

  /* -------------------------------------------------------- Aadhaar lookup */

  useEffect(() => {
    const value = form.aadhaar;

    if (value.length !== 12) {
      setLookup({ state: 'idle', data: null });
      setIdentityLocked(false);
      return;
    }

    const seq = ++lookupSeq.current;
    setLookup({ state: 'loading', data: null });

    const t = setTimeout(async () => {
      try {
        const res = await api.lookupAadhaar(value);
        if (seq !== lookupSeq.current) return; // a newer lookup already started

        if (res.found) {
          const b = res.beneficiary;
          setForm((f) => ({
            ...f,
            fullName: b.fullName,
            guardianName: b.guardianName,
            phone: b.phone,
            blockId: String(b.blockId),
            panchayatId: String(b.panchayatId),
            pinCode: b.pinCode,
          }));
          setErrors((e) => ({
            ...e,
            fullName: undefined, guardianName: undefined, phone: undefined,
            blockId: undefined, panchayatId: undefined, pinCode: undefined,
          }));
          setIdentityLocked(true);
          setLookup({ state: 'found', data: res });
        } else {
          setIdentityLocked(false);
          setLookup({ state: 'new', data: null });
        }
      } catch (err) {
        if (seq !== lookupSeq.current) return;
        setLookup({ state: 'idle', data: null });
        if (err.status === 400) setErrors((e) => ({ ...e, aadhaar: err.message }));
      }
    }, 400);

    return () => clearTimeout(t);
  }, [form.aadhaar]);

  /* ------------------------------------------------------------ validation */

  function validate() {
    const e = {};
    if (digits(form.aadhaar).length !== 12) e.aadhaar = 'Enter all 12 digits.';
    if (form.fullName.trim().length < 2) e.fullName = 'Name is required.';
    if (form.guardianName.trim().length < 2) e.guardianName = 'Father / Husband name is required.';
    if (!/^[6-9]\d{9}$/.test(digits(form.phone))) e.phone = 'Enter a valid 10-digit mobile number.';
    if (!form.blockId) e.blockId = 'Choose a block.';
    if (!form.panchayatId) e.panchayatId = 'Choose a panchayat.';
    if (digits(form.pinCode).length !== 6) e.pinCode = 'Enter a 6-digit PIN.';
    if (!form.supportTypeId) e.supportTypeId = 'Choose the type of support.';
    if (!form.supportReasonId) e.supportReasonId = 'Choose the reason for support.';

    const amt = form.amount.replace(/[,\s₹]/g, '');
    if (amt === '') e.amount = 'Enter the amount requested.';
    else if (!/^\d+(\.\d{1,2})?$/.test(amt)) e.amount = 'Enter a number, up to two decimal places.';
    else if (Number(amt) <= 0) e.amount = 'Amount must be greater than zero.';
    else if (Number(amt) > 100000000) e.amount = 'Amount looks too large.';

    [
      ['pp', 'Panchayat Prabhari'],
      ['ms', 'Mandal Sabhapati'],
      ['mp', 'Mandal Prabhari'],
    ].forEach(([k, label]) => {
      if (!form[`${k}Recommend`]) e[`${k}Recommend`] = `Choose Yes or No for ${label}.`;
      else if (form[`${k}Recommend`] === 'no' && !form[`${k}Comment`].trim()) {
        e[`${k}Comment`] = 'A comment is required when the answer is No.';
      }
    });

    setErrors(e);
    return e;
  }

  /* ---------------------------------------------------------------- submit */

  async function doSubmit(acknowledgeDuplicate = false) {
    const e = validate();
    if (Object.keys(e).length) {
      setBanner({ kind: 'error', text: 'Please correct the highlighted fields.' });
      const firstKey = Object.keys(e)[0];
      document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setBanner(null);
    setSubmitting(true);
    try {
      const res = await api.createApplication({
        aadhaar: digits(form.aadhaar),
        fullName: form.fullName.trim(),
        guardianName: form.guardianName.trim(),
        phone: digits(form.phone),
        blockId: Number(form.blockId),
        panchayatId: Number(form.panchayatId),
        pinCode: digits(form.pinCode),
        supportTypeId: Number(form.supportTypeId),
        supportReasonId: Number(form.supportReasonId),
        amount: form.amount.replace(/[,\s₹]/g, ''),
        ppRecommend: form.ppRecommend,
        ppComment: form.ppComment,
        msRecommend: form.msRecommend,
        msComment: form.msComment,
        mpRecommend: form.mpRecommend,
        mpComment: form.mpComment,
        photoFileId: photo ? photo.id : null,
        documentFileIds: documents.map((d) => d.id),
        acknowledgeDuplicate,
      });
      clearDraft();
      setDuplicate(null);
      setSuccess(res.application);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err.status === 409 && err.data?.needsAcknowledgement) {
        setDuplicate(err.data);
      } else {
        setBanner({ kind: 'error', text: err.message });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startNew() {
    setForm(EMPTY);
    setPhoto(null);
    setDocuments([]);
    setErrors({});
    setLookup({ state: 'idle', data: null });
    setIdentityLocked(false);
    setSuccess(null);
    setCopied(false);
    clearDraft();
  }

  /* --------------------------------------------------------------- render */

  if (success) {
    return (
      <div className="card success-wrap">
        <div className="tick" aria-hidden="true">✓</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Form submitted</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
          The application is now pending review by the MLA.
        </p>

        <div className="refbox">
          <div className="l">Reference Number</div>
          <div className="v">{success.referenceNo}</div>
        </div>

        <div style={{ display: 'grid', gap: 10, maxWidth: 420, margin: '0 auto' }}>
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              navigator.clipboard?.writeText(success.referenceNo).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                },
                () => {}
              );
            }}
          >
            {copied ? '✓ Copied' : 'Copy reference number'}
          </button>
          <button className="btn btn-primary btn-block" onClick={startNew}>
            Start a new form
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => navigate('/forms')}>
            View my forms
          </button>
        </div>
      </div>
    );
  }

  if (!master) {
    return <div className="skeleton" style={{ height: 220 }} />;
  }

  return (
    <>
      <DeskHead crumb="New application" title="Sahayak Form" />

      <div className="datestrip">
        <div>
          <div className="label">Date</div>
          <div className="value">{formatDate(serverDate)}</div>
        </div>
        <div className="note">Reference number is generated on submit</div>
      </div>

      {banner && (
        <Banner kind={banner.kind}>
          {banner.text}
          {banner.clearable && (
            <div>
              <button
                onClick={() => {
                  startNew();
                  setBanner(null);
                }}
              >
                Discard and start fresh
              </button>
            </div>
          )}
        </Banner>
      )}

      {/* ---------------------------------------------------- A. Applicant */}
      <details className="section card" open>
        <summary>
          <span className="section-num">A</span> Applicant Details
        </summary>
        <div className="section-body two-col">
          <Field
            label="Aadhaar Card Number"
            required
            className="full"
            error={errors.aadhaar}
            hint={
              lookup.state === 'loading'
                ? 'Checking records…'
                : lookup.state === 'new'
                ? 'New applicant — please enter the details below.'
                : '12 digits'
            }
          >
            <input
              data-field="aadhaar"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="XXXXXXXXXXXX"
              value={form.aadhaar}
              onChange={(e) => set('aadhaar', digits(e.target.value).slice(0, 12))}
            />
          </Field>

          {lookup.state === 'found' && (
            <div className="full">
              <Banner kind="success" icon="✓">
                <strong>Existing applicant found.</strong> Details filled in automatically
                {lookup.data.previousApplications.length > 0 && (
                  <> — {lookup.data.previousApplications.length} previous{' '}
                    {lookup.data.previousApplications.length === 1 ? 'application' : 'applications'}</>
                )}
                .
                {identityLocked && (
                  <div>
                    <button onClick={() => setIdentityLocked(false)}>Edit these details</button>
                  </div>
                )}
              </Banner>
            </div>
          )}

          <Field label="Name" required error={errors.fullName}>
            <input
              data-field="fullName"
              type="text"
              autoComplete="off"
              readOnly={identityLocked}
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
            />
          </Field>

          <Field label="Father / Husband Name" required error={errors.guardianName}>
            <input
              data-field="guardianName"
              type="text"
              autoComplete="off"
              readOnly={identityLocked}
              value={form.guardianName}
              onChange={(e) => set('guardianName', e.target.value)}
            />
          </Field>

          <Field label="Phone Number" required error={errors.phone} hint="10 digits">
            <input
              data-field="phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              autoComplete="off"
              readOnly={identityLocked}
              value={form.phone}
              onChange={(e) => set('phone', digits(e.target.value).slice(0, 10))}
            />
          </Field>

          <Field label="PIN Number" required error={errors.pinCode} hint="6 digits">
            <input
              data-field="pinCode"
              type="tel"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              readOnly={identityLocked}
              value={form.pinCode}
              onChange={(e) => set('pinCode', digits(e.target.value).slice(0, 6))}
            />
          </Field>

          <Field label="Block" required error={errors.blockId}>
            <select
              data-field="blockId"
              value={form.blockId}
              disabled={identityLocked}
              onChange={(e) => onBlockChange(e.target.value)}
            >
              <option value="">Select block</option>
              {master.blocks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Panchayat"
            required
            error={errors.panchayatId}
            hint={!form.blockId ? 'Choose a block first' : undefined}
          >
            <select
              data-field="panchayatId"
              value={form.panchayatId}
              disabled={identityLocked || !form.blockId}
              onChange={(e) => set('panchayatId', e.target.value)}
            >
              <option value="">Select panchayat</option>
              {panchayats.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </details>

      {/* ------------------------------------------------------ B. Support */}
      <details className="section card" open>
        <summary>
          <span className="section-num">B</span> Support Requested
        </summary>
        <div className="section-body two-col">
          <Field label="Type of Support" required error={errors.supportTypeId}>
            <select
              data-field="supportTypeId"
              value={form.supportTypeId}
              onChange={(e) => onSupportTypeChange(e.target.value)}
            >
              <option value="">Select type</option>
              {master.supportTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Reason of Support"
            required
            error={errors.supportReasonId}
            hint={!form.supportTypeId ? 'Choose a type of support first' : undefined}
          >
            <select
              data-field="supportReasonId"
              value={form.supportReasonId}
              disabled={!form.supportTypeId}
              onChange={(e) => set('supportReasonId', e.target.value)}
            >
              <option value="">Select reason</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Amount Requested"
            required
            error={errors.amount}
            hint={amountPreview || 'In rupees'}
          >
            <div className="amount-input">
              <span className="rupee" aria-hidden="true">₹</span>
              <input
                data-field="amount"
                type="tel"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value.replace(/[^\d.,]/g, ''))}
              />
            </div>
          </Field>
        </div>
      </details>

      {/* ---------------------------------------------- C. Recommendations */}
      <details className="section card" open>
        <summary>
          <span className="section-num">C</span> Recommendations
        </summary>
        <div className="section-body">
          {[
            ['pp', 'Comments of Panchayat Prabhari'],
            ['ms', 'Comments of Mandal Sabhapati'],
            ['mp', 'Comments of Mandal Prabhari'],
          ].map(([k, label]) => (
            <div key={k}>
              <Field label={label} required error={errors[`${k}Recommend`]}>
                <div data-field={`${k}Recommend`}>
                  <YesNo name={label} value={form[`${k}Recommend`]} onChange={(v) => set(`${k}Recommend`, v)} />
                </div>
              </Field>
              <div style={{ marginTop: 10 }}>
                <Field
                  error={errors[`${k}Comment`]}
                  hint={form[`${k}Recommend`] === 'no' ? undefined : 'Optional'}
                >
                  <textarea
                    data-field={`${k}Comment`}
                    placeholder="Comments"
                    value={form[`${k}Comment`]}
                    onChange={(e) => set(`${k}Comment`, e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* -------------------------------------------------- D. Attachments */}
      <details className="section card" open>
        <summary>
          <span className="section-num">D</span> Photo &amp; Documents
        </summary>
        <div className="section-body">
          <Field label="Applicant Photo" hint="Taken with the camera or chosen from the gallery">
            <PhotoUploader
              value={photo}
              onChange={setPhoto}
              onError={(text) => setBanner({ kind: 'error', text })}
            />
          </Field>

          <Field label="Supporting Documents" hint="Up to 5 files — JPG, PNG or PDF">
            <DocumentUploader
              value={documents}
              onChange={setDocuments}
              onError={(text) => setBanner({ kind: 'error', text })}
            />
          </Field>
        </div>
      </details>

      <div className="actionbar">
        <div className="actionbar-inner">
          <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => doSubmit(false)}>
            {submitting ? <span className="spinner" /> : 'Submit Form'}
          </button>
        </div>
      </div>

      {duplicate && (
        <Modal
          title="Similar application already pending"
          description={duplicate.error}
          onClose={() => setDuplicate(null)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setDuplicate(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={submitting} onClick={() => doSubmit(true)}>
                Submit anyway
              </button>
            </>
          }
        />
      )}
    </>
  );
}
