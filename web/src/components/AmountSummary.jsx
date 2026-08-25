import { Fragment, useEffect, useState } from 'react';
import api from '../api';
import { Banner, formatMoney } from './ui';

/**
 * Money rolled up by block, and by panchayat within each block.
 *
 * The rule the MLA asked for:
 *
 *   requested = accepted + pending
 *
 * A rejected application is *not* part of "requested" — once it has been turned
 * down it is no longer money being asked for. It gets its own column so the
 * figure is still visible rather than silently dropped.
 *
 * Blocks start expanded; panchayat rows sit underneath and can be collapsed,
 * because two blocks × twelve panchayats is a lot of rows on a phone.
 */
function Totals({ row, className = '' }) {
  return (
    <>
      <td className={`num right requested ${className}`}>{formatMoney(row.requested)}</td>
      <td className={`num right accepted ${className}`}>{formatMoney(row.accepted)}</td>
      <td className={`num right pending ${className}`}>{formatMoney(row.pending)}</td>
      <td className={`num right rejected ${className}`}>{formatMoney(row.rejected)}</td>
    </>
  );
}

export default function AmountSummary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});

  useEffect(() => {
    let alive = true;
    api
      .summary()
      .then((d) => {
        if (!alive) return;
        setData(d);
        // Expand every block by default — there are only two.
        setOpen(Object.fromEntries(d.blocks.map((b) => [b.blockId, true])));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return <div className="skeleton" style={{ height: 200, marginTop: 16 }} />;

  if (data.blocks.length === 0) {
    return (
      <div className="card summary-card">
        <div className="summary-head">
          <h3>Amount Summary</h3>
        </div>
        <div className="no-files" style={{ padding: 16 }}>
          No applications yet, so there is nothing to total.
        </div>
      </div>
    );
  }

  const { overall } = data;

  return (
    <div className="card summary-card">
      <div className="summary-head">
        <h3>Amount Summary</h3>
        <span className="summary-note">Requested = Accepted + Pending. Rejected is excluded.</span>
      </div>

      {/* Headline figures, before the per-block breakdown. */}
      <div className="summary-tiles">
        <div className="stat requested">
          <div className="l">Total Requested</div>
          <div className="n">{formatMoney(overall.requested)}</div>
          <div className="c">{overall.acceptedCount + overall.pendingCount} applications</div>
        </div>
        <div className="stat accepted">
          <div className="l">Accepted</div>
          <div className="n">{formatMoney(overall.accepted)}</div>
          <div className="c">{overall.acceptedCount} applications</div>
        </div>
        <div className="stat pending">
          <div className="l">Pending</div>
          <div className="n">{formatMoney(overall.pending)}</div>
          <div className="c">{overall.pendingCount} applications</div>
        </div>
        <div className="stat rejected">
          <div className="l">Rejected</div>
          <div className="n">{formatMoney(overall.rejected)}</div>
          <div className="c">{overall.rejectedCount} applications</div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data summary-table">
          <thead>
            <tr>
              <th>Block / Panchayat</th>
              <th className="right">Requested</th>
              <th className="right">Accepted</th>
              <th className="right">Pending</th>
              <th className="right">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {data.blocks.map((b) => (
              <Fragment key={b.blockId}>
                <tr
                  className="block-row clickable"
                  onClick={() => setOpen((o) => ({ ...o, [b.blockId]: !o[b.blockId] }))}
                >
                  <td>
                    <span className="caret" aria-hidden="true">{open[b.blockId] ? '▾' : '▸'}</span>
                    <strong>{b.blockName}</strong>
                    <span className="c-sub"> · {b.totalCount} forms</span>
                  </td>
                  <Totals row={b} />
                </tr>

                {open[b.blockId] &&
                  b.panchayats.map((p) => (
                    <tr key={`p-${p.panchayatId}`} className="panchayat-row">
                      <td className="indent">
                        {p.panchayatName}
                        <span className="c-sub"> · {p.totalCount}</span>
                      </td>
                      <Totals row={p} className="soft" />
                    </tr>
                  ))}
              </Fragment>
            ))}

            <tr className="grand-row">
              <td><strong>All blocks</strong></td>
              <Totals row={overall} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
