import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { MY_QUEUE, DeskHead, Banner, formatDate, formatMoney } from '../components/ui';
import AmountSummary from '../components/AmountSummary';

/**
 * The five stages, in pipeline order, as counter tiles.
 *
 * Every role sees the same five — a supervisor needs to know their form is
 * sitting with the Head Sahayak just as much as the head needs to know how many
 * are waiting on them. What changes by role is which tile is highlighted as
 * "yours" and what the call to action underneath says.
 */
const TILES = [
  { key: 'pending_head',  label: 'With Head',     cls: 'wait' },
  { key: 'pending_mla',   label: 'With MLA',      cls: 'sent' },
  { key: 'accepted',      label: 'Accepted',      cls: 'accepted' },
  { key: 'head_rejected', label: 'Head Rejected', cls: 'rejected' },
  { key: 'rejected',      label: 'MLA Rejected',  cls: 'rejected' },
];

export default function Dashboard() {
  const { user, serverDate } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);
  const [handover, setHandover] = useState(null);
  const [photoQueue, setPhotoQueue] = useState(null);
  const [alerts, setAlerts] = useState(null);

  const isSupervisor = user.role === 'supervisor';
  const isHead = user.role === 'head_sahayak';
  const isMla = user.role === 'mla';
  const queue = MY_QUEUE[user.role];
  const waiting = counts && queue ? counts[queue] : 0;

  useEffect(() => {
    let alive = true;
    api
      .listApplications({ page: 1 })
      .then((d) => alive && setCounts(d.counts))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The handover queue. Only the two field roles can act on it, so only they
  // are asked to fetch it.
  useEffect(() => {
    if (isMla) return undefined;
    let alive = true;
    api
      .approved({ distributed: 'no', page: 1 })
      .then((d) => alive && setHandover({ counts: d.counts, totals: d.totals }))
      .catch(() => {});
    api
      .pendingPhoto({ page: 1 })
      .then((d) => alive && setPhotoQueue(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isMla]);

  // Overdue distribution photos. Every role asks; the server applies the right
  // threshold — 3 days after handover for the field roles, 5 for the MLA — and
  // the banner stays until the photo is uploaded or the money is returned.
  useEffect(() => {
    let alive = true;
    api
      .alerts()
      .then((d) => alive && setAlerts(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <DeskHead crumb={formatDate(serverDate)} title={`Welcome, ${user.fullName}`} />

      <div className="datestrip dash-only">
        <div>
          <div className="label">Today</div>
          <div className="value">{formatDate(serverDate)}</div>
        </div>
        <div className="note">Signed in as {user.fullName}</div>
      </div>

      {/* Distribution photos running late. Listed by name so nobody has to go
          looking for which ones; each line opens the application. */}
      {alerts && alerts.count > 0 && (
        <Banner kind="error" icon="⏰">
          <strong>
            {alerts.count === 1
              ? 'A distribution photo is overdue'
              : `${alerts.count} distribution photos are overdue`}
          </strong>{' '}
          — handed over more than {alerts.alertDays} days ago and still waiting on the Sahayak's
          photo.
          <div className="alert-rows">
            {alerts.alerts.map((a) => (
              <Link key={a.id} to={`/forms/${a.id}`}>
                <span className="ref">{a.referenceNo}</span>
                <span>{a.fullName}</span>
                <span>· {a.panchayatName}</span>
                <span className="days">
                  {a.daysWaiting} {a.daysWaiting === 1 ? 'day' : 'days'}
                </span>
              </Link>
            ))}
          </div>
        </Banner>
      )}

      <div className="tiles">
        {isSupervisor && (
          <button className="tile" onClick={() => navigate('/form')}>
            <span className="tile-icon" aria-hidden="true">📝</span>
            <span>
              <span className="tile-title">Sahayak Form</span>
              <span className="tile-desc">Record a new support application</span>
            </span>
          </button>
        )}

        <button className="tile" onClick={() => navigate('/forms')}>
          <span className="tile-icon" aria-hidden="true">📋</span>
          <span>
            <span className="tile-title">List of Form Uploaded</span>
            <span className="tile-desc">
              {isSupervisor
                ? 'Your submissions and where each one has reached'
                : isHead
                ? 'Verify forms and send them on to the MLA'
                : 'Forms the Head Sahayak has verified — accept or reject'}
            </span>
          </span>
        </button>

        {/* The handover queue, for whoever is in the field. */}
        {!isMla && (
          <button className="tile" onClick={() => navigate('/approvals')}>
            <span className="tile-icon" aria-hidden="true">✅</span>
            <span>
              <span className="tile-title">Approval List</span>
              <span className="tile-desc">
                {handover && handover.counts.pendingHandover > 0
                  ? `${handover.counts.pendingHandover} approved ${
                      handover.counts.pendingHandover === 1 ? 'application' : 'applications'
                    } waiting to be handed over${isHead ? ' for distribution' : ''}`
                  : 'Approved applications — handover and distribution'}
              </span>
            </span>
          </button>
        )}

        {/* Handovers still waiting on their distribution photo. */}
        {!isMla && (
          <button className="tile" onClick={() => navigate('/pending-photos')}>
            <span className="tile-icon" aria-hidden="true">📷</span>
            <span>
              <span className="tile-title">Pending Distribution Photo</span>
              <span className="tile-desc">
                {photoQueue && photoQueue.total > 0
                  ? `${photoQueue.total} ${
                      photoQueue.total === 1 ? 'handover waits' : 'handovers wait'
                    } for the distribution photo${
                      photoQueue.overdue > 0 ? ` — ${photoQueue.overdue} overdue` : ''
                    }`
                  : 'Handed-over applications waiting on the photo'}
              </span>
            </span>
          </button>
        )}
      </div>

      {counts && (
        <div className="counts counts-5">
          {TILES.map((t) => (
            <button
              key={t.key}
              className={`count ${t.cls} ${t.key === queue ? 'mine' : ''}`}
              onClick={() => navigate(`/forms?status=${t.key}`)}
            >
              <div className="n">{counts[t.key]}</div>
              <div className="l">{t.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* The one number that is work rather than status. */}
      {counts && waiting > 0 && (
        <button className="btn btn-primary btn-block" onClick={() => navigate(`/forms?status=${queue}`)}>
          {isHead
            ? `Verify ${waiting} ${waiting === 1 ? 'application' : 'applications'}`
            : `Review ${waiting} ${waiting === 1 ? 'application' : 'applications'}`}
        </button>
      )}

      {/* Handover progress, for the roles that can do something about it. */}
      {!isMla && handover && (
        <div className="card handover-card">
          <div className="summary-head">
            <h3>Handover</h3>
            <span className="summary-note">
              Counted only once the MLA has accepted and set the sanctioned amount.
            </span>
          </div>
          <div className="summary-tiles two">
            <div className="stat wait">
              <div className="l">Waiting to hand over</div>
              <div className="n">{handover.counts.pendingHandover}</div>
              <div className="c">
                {formatMoney(handover.totals.sanctioned - handover.totals.distributed)} sanctioned
              </div>
            </div>
            <div className="stat handed">
              <div className="l">Distributed</div>
              <div className="n">{handover.counts.distributed}</div>
              <div className="c">{formatMoney(handover.totals.distributed)} handed over</div>
            </div>
          </div>
          <div className="summary-foot">
            <button className="btn btn-primary btn-block" onClick={() => navigate('/approvals')}>
              Open the Approval List
            </button>
          </div>
        </div>
      )}

      {/* Money rolled up by block, zone and panchayat. Both reviewer roles see
          it — the endpoint is role-gated on the server too, not just hidden. */}
      {(isHead || isMla) && <AmountSummary />}
    </>
  );
}
