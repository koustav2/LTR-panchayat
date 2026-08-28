import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import {
  DeskHead, StatusBadge, Banner, Modal, Field,
  formatDate, formatMoney, stageLabel,
} from '../components/ui';
import CameraCapture from '../components/CameraCapture';

function Row({ k, v, full }) {
  return (
    <div className={full ? 'full' : undefined}>
      <div className="k">{k}</div>
      <div className="v">{v || '—'}</div>
    </div>
  );
}

function Recommendation({ who, value, comment }) {
  return (
    <div className="rec">
      <div className="rec-head">
        <span className="who">{who}</span>
        <span className={`pill ${value}`}>{value === 'yes' ? 'Yes' : 'No'}</span>
      </div>
      <div className={`rec-comment ${comment ? '' : 'empty'}`}>{comment || 'No comment'}</div>
    </div>
  );
}

/**
 * The three-stage progress rail.
 *
 * Reading a status word tells you where a form is; this tells you how far it
 * has come and what is left, which is the question anyone opening this page is
 * actually asking. A rejection stops the rail at the stage that ended it.
 */
function Pipeline({ app }) {
  const s = app.status;
  const headDone = s !== 'pending_head';
  const headRejected = s === 'head_rejected';
  const mlaDone = s === 'accepted' || s === 'rejected';

  const step = (state, title, sub) => (
    <div className={`pl-step ${state}`}>
      <span className="pl-dot" aria-hidden="true" />
      <div>
        <div className="pl-t">{title}</div>
        <div className="pl-s">{sub}</div>
      </div>
    </div>
  );

  return (
    <div className="pipeline" role="list" aria-label="Application progress">
      {step('done', 'Submitted', `${app.submittedByName} · ${formatDate(app.submittedAt)}`)}
      {step(
        headRejected ? 'stop' : headDone ? 'done' : 'now',
        'Head Sahayak',
        // Applications filed before this stage existed were migrated straight
        // to the MLA and carry no verification date. "Verified · —" reads as a
        // bug; the bare word is the truth.
        headRejected
          ? `Rejected${app.headReviewedAt ? ` · ${formatDate(app.headReviewedAt)}` : ''}`
          : headDone
          ? `Verified${app.headReviewedAt ? ` · ${formatDate(app.headReviewedAt)}` : ''}`
          : 'Verification pending'
      )}
      {step(
        headRejected ? 'skip' : s === 'rejected' ? 'stop' : mlaDone ? 'done' : headDone ? 'now' : 'todo',
        'MLA',
        headRejected
          ? 'Not reached'
          : s === 'accepted'
          ? `Accepted · ${formatDate(app.reviewedAt)}`
          : s === 'rejected'
          ? `Rejected · ${formatDate(app.reviewedAt)}`
          : headDone
          ? 'Awaiting decision'
          : 'Not yet'
      )}
    </div>
  );
}

export default function FormDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // MLA
  const [rejecting, setRejecting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [sanction, setSanction] = useState('');

  // Head Sahayak
  const [forwarding, setForwarding] = useState(false);
  const [headRejecting, setHeadRejecting] = useState(false);
  const [headComment, setHeadComment] = useState('');

  // Distribution
  const [handingOver, setHandingOver] = useState(false);
  const [distPhoto, setDistPhoto] = useState(null);

  const load = useCallback(
    async (reveal = false) => {
      try {
        const res = await api.getApplication(id, reveal);
        setApp(res.application);
        if (reveal) setRevealed(true);
      } catch (err) {
        setError(err.message);
      }
    },
    [id]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const closeAll = () => {
    setRejecting(false);
    setAccepting(false);
    setForwarding(false);
    setHeadRejecting(false);
    setHandingOver(false);
  };

  async function decide(status, rejectionReason) {
    setBusy(true);
    try {
      await api.setStatus(id, {
        status,
        approvedAmount: status === 'accepted' ? sanction.replace(/[,\s₹]/g, '') : undefined,
        rejectionReason,
        comment: comment.trim(),
      });
      closeAll();
      setReason('');
      setComment('');
      setNotice(status === 'accepted' ? 'Application accepted.' : 'Application rejected.');
      await load(revealed);
    } catch (err) {
      setError(err.message);
      closeAll();
    } finally {
      setBusy(false);
    }
  }

  async function verify(decision) {
    setBusy(true);
    try {
      await api.verifyApplication(id, decision, headComment.trim());
      closeAll();
      setHeadComment('');
      setNotice(
        decision === 'forward'
          ? 'Sent to the MLA for approval.'
          : 'Application rejected. The MLA will see it as rejected by you.'
      );
      await load(revealed);
    } catch (err) {
      setError(err.message);
      closeAll();
    } finally {
      setBusy(false);
    }
  }

  async function recordDistribution() {
    if (!distPhoto) return;
    setBusy(true);
    try {
      await api.distribute(id, distPhoto.id);
      closeAll();
      setDistPhoto(null);
      setNotice('Recorded as distributed to the applicant.');
      await load(revealed);
    } catch (err) {
      setError(err.message);
      closeAll();
    } finally {
      setBusy(false);
    }
  }

  // The sanctioned amount the MLA is about to set, parsed the same way the
  // server parses it, so the preview below the field can never disagree with
  // what gets saved.
  const sanctionNum = useMemo(() => {
    const raw = sanction.replace(/[,\s₹]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [sanction]);

  if (error && !app) return <Banner kind="error">{error}</Banner>;
  if (!app) return <div className="skeleton" style={{ height: 320 }} />;

  const isHead = user.role === 'head_sahayak';
  const isMla = user.role === 'mla';

  const isSupervisor = user.role === 'supervisor';
  const canVerify = isHead && app.status === 'pending_head';
  const canDecide = isMla && app.status === 'pending_mla';
  // Either field role can record the handover — whoever is standing in front of
  // the applicant. The MLA decides; they do not distribute.
  const canDistribute =
    (isSupervisor || isHead) && app.status === 'accepted' && !app.distributedAt;
  // The MLA can see a form still in verification, and one the head turned down,
  // but can act on neither. Saying so beats an unexplained missing button.
  const mlaBlocked = isMla && (app.status === 'pending_head' || app.status === 'head_rejected');

  const delta = app.approvedAmount == null ? 0 : app.approvedAmount - app.amount;

  // A repeat applicant often does not re-upload their photo, so nothing of
  // kind 'applicant_photo' is attached to this particular application. Fall
  // back to the photo held on the beneficiary record.
  const attachedPhoto = app.files.find((f) => f.kind === 'applicant_photo');
  const photo =
    attachedPhoto ||
    (app.photoFileId
      ? { id: app.photoFileId, originalName: 'Applicant photo', mimeType: 'image/jpeg' }
      : null);
  const documents = app.files.filter((f) => f.kind === 'document');

  return (
    <>
      <DeskHead crumb={app.referenceNo} title={app.fullName}>
        <StatusBadge status={app.status} />
      </DeskHead>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}

      <div className="detail-layout">
      <div className="card" style={{ marginBottom: 14 }}>
        {/* Duplicated by the desktop page heading, so it is hidden from 1024px up. */}
        <div className="detail-group record-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="row-ref" style={{ fontSize: 14 }}>{app.referenceNo}</span>
            <span style={{ flex: 1 }} />
            <StatusBadge status={app.status} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 650 }}>{app.fullName}</div>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>
            {app.supportType} · {app.supportReason}
          </div>
        </div>

        <div className="detail-group">
          <h3>Progress</h3>
          <Pipeline app={app} />
        </div>

        {/* Everything anyone said about the decision, in the order it was said. */}
        {(app.headComment || app.rejectionReason || app.mlaComment) && (
          <div className="detail-group">
            {app.headComment && (
              <div className={`stage-note head ${app.status === 'head_rejected' ? 'stop' : ''}`}>
                <strong>
                  Head Sahayak
                  {app.status === 'head_rejected' ? ' — rejected' : ' — sent to MLA'}
                  {app.headReviewedByName ? ` (${app.headReviewedByName})` : ''}:
                </strong>{' '}
                {app.headComment}
              </div>
            )}
            {app.status === 'rejected' && app.rejectionReason && (
              <div className="row-reject">
                <strong>MLA rejection reason:</strong> {app.rejectionReason}
              </div>
            )}
            {app.mlaComment && (
              <div className={`mla-note ${app.status}`}>
                <strong>MLA comment:</strong> {app.mlaComment}
              </div>
            )}
          </div>
        )}

        {/* Proof the money actually reached the applicant. Shown to everyone
            once recorded — it is the end of the story for this application. */}
        {app.distributedAt && (
          <div className="detail-group">
            <h3>Distributed to Applicant</h3>
            <div className="handover-done">
              <div className="hd-meta">
                <div>
                  <div className="k">Handed over on</div>
                  <div className="v">{formatDate(app.distributedAt, true)}</div>
                </div>
                <div>
                  <div className="k">Recorded by</div>
                  <div className="v">{app.distributedByName || '—'}</div>
                </div>
              </div>
              {app.distributionPhotoFileId && (
                <a
                  className="photo-tile"
                  href={api.fileUrl(app.distributionPhotoFileId)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open full size"
                >
                  <img
                    src={api.fileUrl(app.distributionPhotoFileId)}
                    alt={`Distribution photo for ${app.fullName}`}
                  />
                  <div className="cap">Distribution photo</div>
                </a>
              )}
            </div>
          </div>
        )}

        {/* What the applicant is asking for, and what they were granted. Called
            out as its own section rather than buried in the subtitle — it is
            the first thing a reviewer looks for. */}
        <div className="detail-group">
          <h3>Support Requested</h3>
          <div className="support-callout">
            <div>
              <div className="k">Type of Support</div>
              <div className="support-type">{app.supportType}</div>
            </div>
            <div>
              <div className="k">Reason of Support</div>
              <div className="support-reason">{app.supportReason}</div>
            </div>
            <div className="amount-cell">
              <div className="money-pair">
                <div>
                  <div className="k">Amount Requested</div>
                  <div className="support-amount">
                    {formatMoney(app.amount, { compact: app.amount % 1 === 0 })}
                  </div>
                </div>
                <div>
                  <div className="k">Amount Sanctioned</div>
                  {app.approvedAmount == null ? (
                    <div className="support-amount muted">
                      —
                      <span className="await">
                        {app.status === 'pending_head'
                          ? 'not yet verified'
                          : app.status === 'pending_mla'
                          ? 'awaiting MLA'
                          : 'not sanctioned'}
                      </span>
                    </div>
                  ) : (
                    <div className="support-amount granted">
                      {formatMoney(app.approvedAmount, { compact: app.approvedAmount % 1 === 0 })}
                      {Math.round(delta * 100) !== 0 && (
                        <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>
                          {delta > 0 ? '+' : '−'}
                          {formatMoney(Math.abs(delta))} vs requested
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-group">
          <h3>Applicant</h3>
          <div className="dl">
            <Row k="Name" v={app.fullName} />
            <Row k="Father / Husband Name" v={app.guardianName} />
            <Row k="Phone Number" v={app.phone} />
            <div>
              <div className="k">Aadhaar Card</div>
              <div className="v">
                {app.aadhaarFull || app.aadhaarMasked}{' '}
                {!app.aadhaarFull && (
                  <button
                    onClick={() => load(true)}
                    style={{
                      background: 'none', border: 0, color: '#15803d', textDecoration: 'underline',
                      cursor: 'pointer', font: 'inherit', fontSize: 13, padding: 0, marginLeft: 4,
                    }}
                  >
                    Show
                  </button>
                )}
              </div>
            </div>
            <Row k="Block" v={app.blockName} />
            <Row k="Zone" v={app.zoneName} />
            <Row k="Panchayat" v={app.panchayatName} />
            <Row k="PIN Number" v={app.pinCode} />
          </div>
        </div>

        <div className="detail-group">
          <h3>Recommendations</h3>
          <div className="recs">
            <Recommendation who="Panchayat Prabhari" value={app.ppRecommend} comment={app.ppComment} />
            <Recommendation who="Mandal Sabhapati" value={app.msRecommend} comment={app.msComment} />
            <Recommendation who="Mandal Prabhari" value={app.mpRecommend} comment={app.mpComment} />
          </div>
        </div>

        <div className="detail-group">
          <h3>Applicant Photo</h3>
          {photo ? (
            <div className="attachments">
              <a
                className="photo-tile"
                href={api.fileUrl(photo.id)}
                target="_blank"
                rel="noreferrer"
                title="Open full size"
              >
                <img src={api.fileUrl(photo.id)} alt={`Photo of ${app.fullName}`} />
                <div className="cap">Open full size</div>
              </a>
            </div>
          ) : (
            <div className="no-files">No photo was uploaded with this application.</div>
          )}
        </div>

        <div className="detail-group">
          <h3>Supporting Documents {documents.length > 0 && `(${documents.length})`}</h3>
          {documents.length > 0 ? (
            <div className="attachments">
              {documents.map((d) => (
                <a key={d.id} href={api.fileUrl(d.id)} target="_blank" rel="noreferrer" title={d.originalName}>
                  {d.mimeType.startsWith('image/') ? (
                    <img src={api.fileUrl(d.id)} alt={d.originalName} />
                  ) : (
                    <div className="filedoc" aria-hidden="true">PDF</div>
                  )}
                  <div className="cap">{d.originalName}</div>
                </a>
              ))}
            </div>
          ) : (
            <div className="no-files">No supporting documents were attached.</div>
          )}
        </div>

      </div>

      {/* On a phone this column falls below the record and the action bar pins
          itself to the bottom of the screen. From 1024px up the whole column
          becomes a sticky panel beside the record and the bar sits inside it. */}
      <aside className="detail-side">
        <div className="card">
          <h4>Status</h4>
          <StatusBadge status={app.status} long />
          <div className="dl" style={{ marginTop: 12, gridTemplateColumns: '1fr' }}>
            <Row k="Submitted by" v={app.submittedByName} />
            <Row k="Submitted on" v={formatDate(app.submittedAt, true)} />
            {app.headReviewedAt && <Row k="Verified by" v={app.headReviewedByName} />}
            {app.headReviewedAt && <Row k="Verified on" v={formatDate(app.headReviewedAt, true)} />}
            {app.reviewedAt && <Row k="Decided by" v={app.reviewedByName} />}
            {app.reviewedAt && <Row k="Decided on" v={formatDate(app.reviewedAt, true)} />}
          </div>
        </div>

        {canVerify && (
          <div className="card">
            <h4>Verification</h4>
            <p className="panel-hint">
              Send this to the MLA for approval, or reject it here. Either way a comment is required.
            </p>
            <div className="actionbar">
              <div className="actionbar-inner">
                <button className="btn btn-danger" disabled={busy} onClick={() => setHeadRejecting(true)}>
                  Reject
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => setForwarding(true)}>
                  {busy ? <span className="spinner" /> : 'Send to MLA'}
                </button>
              </div>
            </div>
          </div>
        )}

        {canDecide && (
          <div className="card">
            <h4>Decision</h4>
            <p className="panel-hint">
              Accepting lets you set the amount actually sanctioned — it defaults to the{' '}
              {formatMoney(app.amount)} requested.
            </p>
            <div className="actionbar">
              <div className="actionbar-inner">
                <button className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
                  Reject
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setSanction(String(app.amount));
                    setAccepting(true);
                  }}
                >
                  {busy ? <span className="spinner" /> : 'Accept'}
                </button>
              </div>
            </div>
          </div>
        )}

        {canDistribute && (
          <div className="card">
            <h4>Handover</h4>
            <p className="panel-hint">
              The MLA sanctioned {formatMoney(app.approvedAmount)}. Record it as distributed once
              the applicant has it — a photo taken at handover is required.
            </p>
            <button
              className="btn btn-primary btn-block"
              disabled={busy}
              onClick={() => setHandingOver(true)}
            >
              Mark as distributed
            </button>
          </div>
        )}

        {app.status === 'accepted' && app.distributedAt && (isSupervisor || isHead) && (
          <div className="card">
            <h4>Handover</h4>
            <Banner kind="success">
              Distributed {formatDate(app.distributedAt)} by {app.distributedByName || 'a colleague'}.
            </Banner>
          </div>
        )}

        {mlaBlocked && (
          <div className="card">
            <h4>Decision</h4>
            <Banner kind={app.status === 'head_rejected' ? 'warn' : 'info'}>
              {app.status === 'head_rejected'
                ? 'The Head Sahayak rejected this application, so it does not come to you for a decision.'
                : 'The Head Sahayak has not verified this application yet. It will appear for decision once they send it on.'}
            </Banner>
          </div>
        )}

        {isHead && app.status !== 'pending_head' && (
          <div className="card">
            <h4>Verification</h4>
            <Banner kind="info">
              {app.status === 'head_rejected'
                ? 'You rejected this application. That decision is final.'
                : `You already sent this to the MLA — it is now ${stageLabel(app.status, true).toLowerCase()}.`}
            </Banner>
          </div>
        )}

        {!canVerify && !canDecide && !canDistribute && (
          <button className="btn btn-ghost btn-block" onClick={() => navigate(-1)}>
            Back
          </button>
        )}
      </aside>
      </div>

      {/* ---------------------------------------------- Head Sahayak: forward */}
      {forwarding && (
        <Modal
          title="Send to the MLA"
          description="Your comment goes to the MLA with the application, and is visible to the supervisor who filed it."
          onClose={() => setForwarding(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setForwarding(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || headComment.trim().length < 3}
                onClick={() => verify('forward')}
              >
                {busy ? <span className="spinner" /> : 'Send to MLA'}
              </button>
            </>
          }
        >
          <Field label="Verification comment" required hint="What you checked, and anything the MLA should know">
            <textarea
              data-field="headComment"
              value={headComment}
              onChange={(e) => setHeadComment(e.target.value)}
              placeholder="e.g. Documents verified at panchayat office. Hospital estimate matches the amount."
              autoFocus
            />
          </Field>
        </Modal>
      )}

      {/* ----------------------------------------------- Head Sahayak: reject */}
      {headRejecting && (
        <Modal
          title="Reject this application"
          description="It will not go to the MLA for a decision. The MLA and the supervisor both see your reason."
          onClose={() => setHeadRejecting(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setHeadRejecting(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={busy || headComment.trim().length < 3}
                onClick={() => verify('reject')}
              >
                {busy ? <span className="spinner" /> : 'Reject'}
              </button>
            </>
          }
        >
          <Field label="Reason for rejection" required>
            <textarea
              data-field="headComment"
              value={headComment}
              onChange={(e) => setHeadComment(e.target.value)}
              placeholder="e.g. Income certificate missing; applicant already assisted this year"
              autoFocus
            />
          </Field>
        </Modal>
      )}

      {/* ------------------------------------------------------- MLA: accept */}
      {accepting && (
        <Modal
          title="Accept this application"
          description={`Requested: ${formatMoney(app.amount)}. Change the figure below if you are sanctioning a different amount.`}
          onClose={() => setAccepting(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setAccepting(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || sanctionNum === null}
                onClick={() => decide('accepted')}
              >
                {busy ? <span className="spinner" /> : 'Accept'}
              </button>
            </>
          }
        >
          <Field
            label="Amount sanctioned"
            required
            error={sanction && sanctionNum === null ? 'Enter an amount greater than zero.' : undefined}
            hint={sanctionNum === null ? 'In rupees' : undefined}
          >
            <input
              className="amount-field"
              data-field="approvedAmount"
              type="text"
              inputMode="decimal"
              value={sanction}
              onChange={(e) => setSanction(e.target.value)}
              autoFocus
            />
          </Field>

          {/* Echoed back grouped, with the difference spelled out. A deduction
              of one digit is very easy to type and very hard to spot. */}
          {sanctionNum !== null && (
            <div className="sanction-preview">
              <div>
                <span className="l">Sanctioning</span>
                <span className="v">{formatMoney(sanctionNum, { compact: sanctionNum % 1 === 0 })}</span>
              </div>
              {Math.round((sanctionNum - app.amount) * 100) !== 0 && (
                <div className={`d ${sanctionNum > app.amount ? 'up' : 'down'}`}>
                  {sanctionNum > app.amount ? '+' : '−'}
                  {formatMoney(Math.abs(sanctionNum - app.amount))}{' '}
                  {sanctionNum > app.amount ? 'above' : 'below'} the requested amount
                </div>
              )}
            </div>
          )}

          <Field label="Comment" hint="Optional. Visible to the supervisor who submitted the form">
            <textarea
              data-field="mlaComment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Sanctioned towards hospital bill"
            />
          </Field>
        </Modal>
      )}

      {/* --------------------------------------------- Handover: camera only */}
      {handingOver && (
        <Modal
          title="Distributed to applicant"
          description={`Take a photo at handover. ${formatMoney(app.approvedAmount)} sanctioned to ${app.fullName}.`}
          onClose={() => {
            setHandingOver(false);
            setDistPhoto(null);
          }}
          actions={
            <>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setHandingOver(false);
                  setDistPhoto(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !distPhoto}
                onClick={recordDistribution}
              >
                {busy ? <span className="spinner" /> : 'Confirm distributed'}
              </button>
            </>
          }
        >
          {distPhoto ? (
            <div className="handover-shot">
              <img src={distPhoto.preview} alt="Distribution photo" />
              <div>
                <div className="ok">Photo ready</div>
                <button className="linklike" onClick={() => setDistPhoto(null)}>
                  Take a different one
                </button>
              </div>
            </div>
          ) : (
            <CameraCapture onCaptured={setDistPhoto} onError={setError} disabled={busy} />
          )}

          {/* Said plainly rather than implied: the photo is the record. */}
          <p className="modal-note">
            The photo is stored with the application and is visible to the MLA. Confirming cannot be
            undone.
          </p>
        </Modal>
      )}

      {/* ------------------------------------------------------- MLA: reject */}
      {rejecting && (
        <Modal
          title="Reject this application"
          description="The reason is shown to the supervisor who submitted the form."
          onClose={() => setRejecting(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setRejecting(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => decide('rejected', reason.trim())}
              >
                {busy ? <span className="spinner" /> : 'Reject'}
              </button>
            </>
          }
        >
          <Field label="Reason for rejection" required>
            <textarea
              data-field="rejectReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Income certificate not attached"
              autoFocus
            />
          </Field>
          <Field label="Additional comment" hint="Optional">
            <textarea
              data-field="mlaComment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything further to record"
            />
          </Field>
        </Modal>
      )}
    </>
  );
}
