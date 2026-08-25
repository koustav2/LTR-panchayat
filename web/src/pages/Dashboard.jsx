import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { DeskHead, formatDate } from '../components/ui';

export default function Dashboard() {
  const { user, serverDate } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);

  const isSupervisor = user.role === 'supervisor';

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
              {isSupervisor ? 'Your submissions and their status' : 'All submissions — review and decide'}
            </span>
          </span>
        </button>
      </div>

      {counts && (
        <div className="counts">
          <div className="count pending">
            <div className="n">{counts.pending}</div>
            <div className="l">Pending</div>
          </div>
          <div className="count accepted">
            <div className="n">{counts.accepted}</div>
            <div className="l">Accepted</div>
          </div>
          <div className="count rejected">
            <div className="n">{counts.rejected}</div>
            <div className="l">Rejected</div>
          </div>
        </div>
      )}

      {!isSupervisor && counts && counts.pending > 0 && (
        <button className="btn btn-primary btn-block" onClick={() => navigate('/forms?status=pending')}>
          Review {counts.pending} pending {counts.pending === 1 ? 'application' : 'applications'}
        </button>
      )}
    </>
  );
}
