import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import {
  DeskHead, Empty, Skeletons, Banner,
  formatDate, formatMoney,
} from '../components/ui';

/**
 * Pending Distribution Photo — every application the Head Sahayak has handed
 * over for distribution where the Sahayak has not yet uploaded the photo.
 *
 * Shown to the Sahayaks and the Head Sahayak, but only a Sahayak can act: the
 * photo (or a return of the money) is recorded on the application's detail
 * page. Oldest handover first, because that is the one nearest the alert line —
 * after 3 days an item is flagged on everyone's home page, after 5 the MLA's.
 */
export default function PendingPhotoList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const page = Number(params.get('page') || 1);
  const isSupervisor = user.role === 'supervisor';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.pendingPhoto({ page });
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <DeskHead crumb="Handover · distribution photo" title="Pending Distribution Photo">
        {data && (
          <span style={{ fontSize: 14, color: '#64748b' }}>
            {data.total} {data.total === 1 ? 'application' : 'applications'}
          </span>
        )}
      </DeskHead>

      {data && data.overdue > 0 && (
        <Banner kind="error" icon="⏰">
          <strong>
            {data.overdue} {data.overdue === 1 ? 'photo is' : 'photos are'} overdue
          </strong>{' '}
          — handed over more than {data.alertDays} days ago. These are flagged on every home page
          until the photo is uploaded.
        </Banner>
      )}

      <Banner kind="info">
        {isSupervisor
          ? 'Open an application and upload the photo taken when the applicant received the money. If distribution is not possible, return the money with a photo and remark.'
          : 'Only a Sahayak can upload the distribution photo. This list shows what is still waiting on them.'}
      </Banner>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && !data ? (
        <Skeletons count={4} />
      ) : !data ? null : data.applications.length === 0 ? (
        <Empty icon="📷" title="No distribution photos pending">
          Every handed-over application has its photo, or the money was returned.
        </Empty>
      ) : (
        <>
          <div className="rows" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
            {data.applications.map((a) => (
              <button className="row" key={a.id} onClick={() => navigate(`/forms/${a.id}`)}>
                <div className="row-top">
                  <span className="row-ref">{a.referenceNo}</span>
                  <span style={{ flex: 1 }} />
                  {a.daysWaiting >= data.alertDays ? (
                    <span className="badge overdue">
                      {a.daysWaiting} {a.daysWaiting === 1 ? 'day' : 'days'} — overdue
                    </span>
                  ) : (
                    <span className="badge photo-pending">
                      Day {a.daysWaiting} of {data.alertDays}
                    </span>
                  )}
                </div>
                <div className="row-name">{a.fullName}</div>
                <div className="row-meta">{a.supportType} · {a.supportReason}</div>
                <div className="row-money">
                  <div>
                    <span className="ml">Sanctioned</span>
                    <span className="mv granted">{formatMoney(a.approvedAmount)}</span>
                  </div>
                </div>
                <div className="row-meta">
                  {a.panchayatName} · {a.zoneName} · {a.blockName}
                </div>
                <div className="row-meta">
                  Handed over {formatDate(a.handedOverAt)} by {a.handedOverByName || '—'}
                </div>
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
                  <th>Handed over</th>
                  <th>Waiting</th>
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
                    <td className="num right c-sanctioned">{formatMoney(a.approvedAmount)}</td>
                    <td>
                      <div>{a.panchayatName}</div>
                      <div className="c-sub">{a.zoneName} · {a.blockName}</div>
                    </td>
                    <td className="num">
                      {formatDate(a.handedOverAt)}
                      <div className="c-sub">by {a.handedOverByName || '—'}</div>
                    </td>
                    <td>
                      {a.daysWaiting >= data.alertDays ? (
                        <span className="badge overdue">{a.daysWaiting} days — overdue</span>
                      ) : (
                        <span className="badge photo-pending">
                          {a.daysWaiting} {a.daysWaiting === 1 ? 'day' : 'days'}
                        </span>
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
                onClick={() => setParams({ page: String(page - 1) }, { replace: true })}
              >
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                className="btn btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setParams({ page: String(page + 1) }, { replace: true })}
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
