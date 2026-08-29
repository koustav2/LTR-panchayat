import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import {
  MY_QUEUE, DeskHead, StatusBadge, Empty, Skeletons, Banner,
  formatDate, formatMoney, formatDelta, deltaDirection,
} from '../components/ui';

/**
 * The filter chips, in pipeline order. `mine` marks the stage that is waiting
 * on the signed-in role — it is pulled to the front and labelled as a task
 * ("To verify", "To decide") rather than a state, because for that person it is
 * the only chip that means work.
 */
const FILTERS = [
  { key: '',              label: 'All' },
  { key: 'pending_head',  label: 'With Head',     mine: { head_sahayak: 'To verify' } },
  { key: 'pending_mla',   label: 'With MLA',      mine: { mla: 'To decide' } },
  { key: 'accepted',      label: 'Accepted' },
  { key: 'head_rejected', label: 'Head Rejected' },
  { key: 'rejected',      label: 'MLA Rejected' },
];

export default function FormList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [q, setQ] = useState(params.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(q);
  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.listApplications({ q: debouncedQ, status, page });
      if (mine === seq.current) setData(res);
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const isMla = user.role === 'mla';
  const isSupervisor = user.role === 'supervisor';
  // Both reviewer roles see every form and can export; only supervisors are
  // scoped to their own.
  const isReviewer = !isSupervisor;
  const queue = MY_QUEUE[user.role];

  // The chip for the stage waiting on this role comes first, so the queue that
  // matters is the one under the thumb on a phone. A partition, not a sort —
  // "one element floats to the front" is not a comparison.
  const chips = queue
    ? [...FILTERS.filter((f) => f.key === queue), ...FILTERS.filter((f) => f.key !== queue)]
    : FILTERS;

  return (
    <>
      <DeskHead
        crumb={isSupervisor ? 'Your submissions' : 'All supervisors'}
        title="List of Form Uploaded"
      >
        {data && (
          <span style={{ fontSize: 14, color: '#64748b' }}>
            {data.total} {data.total === 1 ? 'form' : 'forms'}
          </span>
        )}
      </DeskHead>

      <div className="list-toolbar">
        <div className="searchbar">
          <span className="icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference no., name, phone or last 4 of Aadhaar"
            aria-label="Search forms"
            autoComplete="off"
          />
          {q && (
            <button className="clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
          )}
        </div>

        <div className="chips">
          {chips.map((f) => (
            <button
              key={f.key || 'all'}
              className={`chip ${f.key && f.key === queue ? 'chip-mine' : ''}`}
              aria-pressed={status === f.key}
              onClick={() => setParam('status', f.key)}
            >
              {(f.mine && f.mine[user.role]) || f.label}
              {data && f.key && <> ({data.counts[f.key]})</>}
            </button>
          ))}
          {isReviewer && (
            <a
              className="chip"
              href={`/api/applications/export.csv?${new URLSearchParams({ q: debouncedQ, status }).toString()}`}
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              ⤓ Export CSV
            </a>
          )}
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && !data ? (
        <Skeletons count={5} />
      ) : !data ? null : data.applications.length === 0 ? (
        <Empty
          icon="📭"
          title={debouncedQ || status ? 'No matching forms' : 'No forms yet'}
        >
          {debouncedQ || status
            ? 'Try a different search or filter.'
            : isSupervisor
            ? 'Submitted forms will appear here.'
            : isMla
            ? 'Forms verified by the Head Sahayak will appear here.'
            : 'Forms submitted by supervisors will appear here.'}
        </Empty>
      ) : (
        <>
          <div className="rows" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
            {data.applications.map((a) => (
              <button className="row" key={a.id} onClick={() => navigate(`/forms/${a.id}`)}>
                <div className="row-top">
                  <span className="row-ref">{a.referenceNo}</span>
                  <span style={{ flex: 1 }} />
                  <StatusBadge status={a.status} />
                </div>
                <div className="row-name">{a.fullName}</div>
                <div className="row-meta">
                  {a.supportType} · {a.supportReason}
                </div>
                {/* Requested and sanctioned side by side. Sanctioned stays a
                    dash until the MLA decides — a zero would read as "granted
                    nothing", which is a different thing entirely. */}
                <div className="row-money">
                  <div>
                    <span className="ml">Requested</span>
                    <span className="mv">{formatMoney(a.amount)}</span>
                  </div>
                  <div>
                    <span className="ml">Sanctioned</span>
                    <span className={`mv ${a.approvedAmount == null ? 'pendingv' : 'granted'}`}>
                      {a.approvedAmount == null ? '—' : formatMoney(a.approvedAmount)}
                    </span>
                  </div>
                  {formatDelta(a.amount, a.approvedAmount) && (
                    <div className={`row-delta ${deltaDirection(a.amount, a.approvedAmount)}`}>
                      {formatDelta(a.amount, a.approvedAmount)}
                    </div>
                  )}
                </div>
                <div className="row-meta">
                  {a.panchayatName} · {a.zoneName} · {a.blockName}
                </div>
                <div className="row-meta">{formatDate(a.submittedAt)}</div>
                {isReviewer && (
                  <div className="row-meta">Submitted by {a.submittedByName}</div>
                )}
                {a.status === 'accepted' && a.distributedAt && (
                  <div className="row-done">
                    Distributed {formatDate(a.distributedAt)}
                  </div>
                )}
                {a.status === 'head_rejected' && a.headComment && (
                  <div className="row-reject">
                    <strong>Head Sahayak:</strong> {a.headComment}
                  </div>
                )}
                {a.status === 'rejected' && a.rejectionReason && (
                  <div className="row-reject">
                    <strong>MLA reason:</strong> {a.rejectionReason}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Same data as the cards above — CSS shows one or the other by width.
              A table earns its place on desktop: columns line up, so the eye can
              scan down a single field instead of re-reading every card. */}
          <div className="table-wrap" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Reference No.</th>
                  <th>Applicant</th>
                  <th>Support</th>
                  <th className="right">Requested</th>
                  <th className="right">Sanctioned</th>
                  <th>Panchayat</th>
                  <th>Zone</th>
                  {isReviewer && <th>Submitted by</th>}
                  <th>Submitted</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.applications.map((a) => (
                  <tr
                    key={a.id}
                    className="clickable"
                    onClick={() => navigate(`/forms/${a.id}`)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/forms/${a.id}`)}
                  >
                    <td className="c-ref">{a.referenceNo}</td>
                    <td>
                      <div className="c-name">{a.fullName}</div>
                      <div className="c-sub">{a.guardianName}</div>
                      {a.status === 'head_rejected' && a.headComment && (
                        <div className="c-reject">
                          <strong>Head Sahayak:</strong> {a.headComment}
                        </div>
                      )}
                      {a.status === 'rejected' && a.rejectionReason && (
                        <div className="c-reject">
                          <strong>MLA reason:</strong> {a.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{a.supportType}</div>
                      <div className="c-sub">{a.supportReason}</div>
                    </td>
                    <td className="num right c-requested">{formatMoney(a.amount)}</td>
                    <td className="num right c-sanctioned">
                      {a.approvedAmount == null ? (
                        <span className="c-pendingv">—</span>
                      ) : (
                        <>
                          {formatMoney(a.approvedAmount)}
                          {formatDelta(a.amount, a.approvedAmount) && (
                            <div className={`c-delta ${deltaDirection(a.amount, a.approvedAmount)}`}>
                              {formatDelta(a.amount, a.approvedAmount)}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td>{a.panchayatName}</td>
                    <td>
                      <div>{a.zoneName}</div>
                      <div className="c-sub">{a.blockName}</div>
                    </td>
                    {isReviewer && <td>{a.submittedByName}</td>}
                    <td className="num">{formatDate(a.submittedAt)}</td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 18 }}>
              <button
                className="btn btn-ghost"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: 14, color: '#64748b' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </button>
            </div>
          )}

          <div style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8', marginTop: 14 }}>
            {data.total} {data.total === 1 ? 'form' : 'forms'}
          </div>
        </>
      )}
    </>
  );
}
