import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { MY_QUEUE, DeskHead, formatDate } from '../components/ui';
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

      {/* Money rolled up by block and panchayat. Both reviewer roles see it —
          the endpoint is role-gated on the server too, not just hidden here. */}
      {(isHead || isMla) && <AmountSummary />}
    </>
  );
}
