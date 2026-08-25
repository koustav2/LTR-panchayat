import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { DeskHead, StatusBadge, Banner, Modal, Field, formatDate } from '../components/ui';

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

export default function FormDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

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

  async function decide(status, rejectionReason) {
    setBusy(true);
    try {
      await api.setStatus(id, status, rejectionReason);
      setRejecting(false);
      setReason('');
      setNotice(status === 'accepted' ? 'Application accepted.' : 'Application rejected.');
      await load(revealed);
    } catch (err) {
      setError(err.message);
      setRejecting(false);
    } finally {
      setBusy(false);
    }
  }

  if (error && !app) return <Banner kind="error">{error}</Banner>;
  if (!app) return <div className="skeleton" style={{ height: 320 }} />;

  const isMla = user.role === 'mla';
  const canDecide = isMla && app.status === 'pending';
  const photo = app.files.find((f) => f.kind === 'applicant_photo');
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

        {app.status === 'rejected' && (
          <div className="detail-group">
            <div className="row-reject" style={{ marginTop: 0 }}>
              <strong>Rejection reason:</strong> {app.rejectionReason}
            </div>
          </div>
        )}

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

        {(photo || documents.length > 0) && (
          <div className="detail-group">
            <h3>Photo &amp; Documents</h3>
            <div className="attachments">
              {photo && (
                <a href={api.fileUrl(photo.id)} target="_blank" rel="noreferrer">
                  <img src={api.fileUrl(photo.id)} alt="Applicant" />
                  <div className="cap">Photo</div>
                </a>
              )}
              {documents.map((d) => (
                <a key={d.id} href={api.fileUrl(d.id)} target="_blank" rel="noreferrer">
                  {d.mimeType.startsWith('image/') ? (
                    <img src={api.fileUrl(d.id)} alt={d.originalName} />
                  ) : (
                    <div className="filedoc" aria-hidden="true">📄</div>
                  )}
                  <div className="cap">{d.originalName}</div>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* On a phone this column falls below the record and the action bar pins
          itself to the bottom of the screen. From 1024px up the whole column
          becomes a sticky panel beside the record and the bar sits inside it. */}
      <aside className="detail-side">
        <div className="card">
          <h4>Status</h4>
          <StatusBadge status={app.status} />
          <div className="dl" style={{ marginTop: 12, gridTemplateColumns: '1fr' }}>
            <Row k="Submitted by" v={app.submittedByName} />
            <Row k="Submitted on" v={formatDate(app.submittedAt, true)} />
            {app.reviewedAt && <Row k="Reviewed by" v={app.reviewedByName} />}
            {app.reviewedAt && <Row k="Reviewed on" v={formatDate(app.reviewedAt, true)} />}
          </div>
        </div>

        {canDecide && (
          <div className="card">
            <h4>Decision</h4>
            <div className="actionbar">
              <div className="actionbar-inner">
                <button className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
                  Reject
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => decide('accepted')}>
                  {busy ? <span className="spinner" /> : 'Accept'}
                </button>
              </div>
            </div>
          </div>
        )}

        {!canDecide && (
          <button className="btn btn-ghost btn-block" onClick={() => navigate('/forms')}>
            Back to list
          </button>
        )}
      </aside>
      </div>

      {rejecting && (
        <Modal
          title="Reject this application"
          description="The reason is shown to the supervisor who submitted the form."
          onClose={() => setRejecting(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setRejecting(false)}>
                Cancel
              </button>
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
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Income certificate not attached"
              autoFocus
            />
          </Field>
        </Modal>
      )}
    </>
  );
}
