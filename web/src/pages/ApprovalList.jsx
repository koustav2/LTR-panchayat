import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import {
  DeskHead, Empty, Skeletons, Banner,
  formatDate, formatMoney,
} from '../components/ui';

/**
 * Every application the MLA has accepted, for Sahayaks and the Head Sahayak.
 *
 * This is a work queue, not a report: the job is to get sanctioned money to the
 * applicant and record that it happened. So undistributed rows come first (the
 * server orders them that way), the default filter is "Pending handover", and
 * the row leads with the sanctioned amount rather than the requested one —
 * that is the figure being handed over.
 *
 * The Block / Zone / Panchayat filters cascade the same way the form's do,
 * because a Sahayak working one panchayat wants exactly that panchayat.
 */

/* 'all' is a URL-only value: the server understands 'yes' and 'no', and treats
   anything else as no filter. Keeping an explicit 'all' in the query string is
   what lets the chip render as selected — an empty string would be
   indistinguishable from the unset default. */
const HANDOVER = [
  { key: 'no', label: 'Pending handover' },
  { key: 'yes', label: 'Distributed' },
  { key: 'all', label: 'All approved' },
];

export default function ApprovalList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [master, setMaster] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  // Default to the work rather than the archive.
  const handover = params.has('distributed') ? params.get('distributed') : 'no';
  const distributed = handover === 'all' ? '' : handover;
  const blockId = params.get('blockId') || '';
  const zoneId = params.get('zoneId') || '';
  const panchayatId = params.get('panchayatId') || '';
  const page = Number(params.get('page') || 1);

  const [q, setQ] = useState(params.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.bootstrap().then(setMaster).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.approved({ distributed, blockId, zoneId, panchayatId, q: debouncedQ, page });
      if (mine === seq.current) setData(res);
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [distributed, blockId, zoneId, panchayatId, debouncedQ, page]);

  useEffect(() => {
    load();
  }, [load]);

  function setParam(patch) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v == null) next.delete(k);
      else next.set(k, v);
    });
    // Any filter change invalidates the page number.
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }

  const zones = useMemo(
    () => (master && blockId ? master.zones.filter((z) => String(z.block_id) === String(blockId)) : []),
    [master, blockId]
  );
  const panchayats = useMemo(
    () => (master && zoneId ? master.panchayats.filter((p) => String(p.zone_id) === String(zoneId)) : []),
    [master, zoneId]
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const roleWord = user.role === 'head_sahayak' ? 'Head Sahayak' : 'Sahayak';

  return (
    <>
      <DeskHead crumb={`${roleWord} · handover`} title="Approval List">
        {data && (
          <span style={{ fontSize: 14, color: '#64748b' }}>
            {data.total} {data.total === 1 ? 'application' : 'applications'}
          </span>
        )}
      </DeskHead>

      {data && (
        <div className="counts counts-3">
          <div className="count wait">
            <div className="n">{data.counts.pendingHandover}</div>
            <div className="l">Pending handover</div>
          </div>
          <div className="count accepted">
            <div className="n">{data.counts.distributed}</div>
            <div className="l">Distributed</div>
          </div>
          <div className="count">
            <div className="n">{formatMoney(data.totals.distributed)}</div>
            <div className="l">of {formatMoney(data.totals.sanctioned)} handed over</div>
          </div>
        </div>
      )}

      <div className="list-toolbar">
        <div className="searchbar">
          <span className="icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference no., name, phone or last 4 of Aadhaar"
            aria-label="Search approved applications"
            autoComplete="off"
          />
          {q && <button className="clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>

        <div className="chips">
          {HANDOVER.map((h) => (
            <button
              key={h.key || 'all'}
              className="chip"
              aria-pressed={handover === h.key}
              onClick={() => setParam({ distributed: h.key })}
            >
              {h.label}
            </button>
          ))}
        </div>

        {/* Block -> Zone -> Panchayat, cascading. Each level clears the ones
            below it, so a stale panchayat from another zone can never sit in
            the query string. */}
        <div className="filter-row">
          <label>
            <span>Block</span>
            <select
              value={blockId}
              onChange={(e) => setParam({ blockId: e.target.value, zoneId: '', panchayatId: '' })}
            >
              <option value="">All blocks</option>
              {master && master.blocks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Zone</span>
            <select
              value={zoneId}
              disabled={!blockId}
              onChange={(e) => setParam({ zoneId: e.target.value, panchayatId: '' })}
            >
              <option value="">{blockId ? 'All zones' : 'Choose a block'}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Panchayat</span>
            <select
              value={panchayatId}
              disabled={!zoneId}
              onChange={(e) => setParam({ panchayatId: e.target.value })}
            >
              <option value="">{zoneId ? 'All panchayats' : 'Choose a zone'}</option>
              {panchayats.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && !data ? (
        <Skeletons count={4} />
      ) : data && data.applications.length === 0 ? (
        <Empty
          icon="✅"
          title={handover === 'no' ? 'Nothing waiting to be handed over' : 'No approved applications match'}
        >
          {handover === 'no'
            ? 'Every approved application in this view has been distributed.'
            : 'Try a different filter or search.'}
        </Empty>
      ) : (
        <>
          <div className="rows" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
            {data.applications.map((a) => (
              <button className="row" key={a.id} onClick={() => navigate(`/forms/${a.id}`)}>
                <div className="row-top">
                  <span className="row-ref">{a.referenceNo}</span>
                  <span style={{ flex: 1 }} />
                  <span className={`badge ${a.distributedAt ? 'distributed' : 'to-hand-over'}`}>
                    {a.distributedAt ? 'Distributed' : 'To hand over'}
                  </span>
                </div>
                <div className="row-name">{a.fullName}</div>
                <div className="row-meta">{a.supportType} · {a.supportReason}</div>

                {/* Sanctioned leads here: it is the amount being handed over.
                    The requested figure is shown only when they differ. */}
                <div className="row-money">
                  <div>
                    <span className="ml">Sanctioned</span>
                    <span className="mv granted">{formatMoney(a.approvedAmount)}</span>
                  </div>
                  {a.approvedAmount != null && a.approvedAmount !== a.amount && (
                    <div>
                      <span className="ml">Requested</span>
                      <span className="mv pendingv">{formatMoney(a.amount)}</span>
                    </div>
                  )}
                </div>

                <div className="row-meta">
                  {a.panchayatName} · {a.zoneName} · {a.blockName}
                </div>
                <div className="row-meta">
                  Approved {formatDate(a.reviewedAt)} · filed by {a.submittedByName}
                </div>
                {a.distributedAt && (
                  <div className="row-done">
                    Handed over {formatDate(a.distributedAt)} by {a.distributedByName}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Same data as the cards; CSS shows one or the other by width. */}
          <div className="table-wrap" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Reference No.</th>
                  <th>Applicant</th>
                  <th className="right">Sanctioned</th>
                  <th>Panchayat</th>
                  <th>Zone</th>
                  <th>Approved</th>
                  <th>Handover</th>
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
                      <div className="c-sub">{a.supportType} · {a.supportReason}</div>
                    </td>
                    <td className="num right c-sanctioned">
                      {formatMoney(a.approvedAmount)}
                      {a.approvedAmount != null && a.approvedAmount !== a.amount && (
                        <div className="c-sub">of {formatMoney(a.amount)} asked</div>
                      )}
                    </td>
                    <td>{a.panchayatName}</td>
                    <td><div>{a.zoneName}</div><div className="c-sub">{a.blockName}</div></td>
                    <td className="num">{formatDate(a.reviewedAt)}</td>
                    <td>
                      <span className={`badge ${a.distributedAt ? 'distributed' : 'to-hand-over'}`}>
                        {a.distributedAt ? 'Distributed' : 'To hand over'}
                      </span>
                      {a.distributedAt && (
                        <div className="c-sub">{formatDate(a.distributedAt)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pager">
              <button
                className="btn btn-ghost"
                disabled={page <= 1}
                onClick={() => setParam({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                className="btn btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setParam({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
