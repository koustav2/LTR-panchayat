import { Fragment, useEffect, useState } from 'react';
import api from '../api';
import { Banner, formatMoney } from './ui';

/**
 * Money rolled up three levels deep: block, then zone, then panchayat.
 *
 * Two different quantities live here and they must never be read as one:
 *
 *   Requested   what the supervisor filed for          (applications.amount)
 *   Sanctioned  what the MLA actually granted          (approved_amount)
 *
 * The MLA sets the sanctioned amount when accepting and may raise or lower it,
 * so the gap between the two columns is real and is shown as its own figure
 * rather than left for the reader to subtract.
 *
 *   Requested = With Head + With MLA + (requested on accepted forms)
 *
 * Rejections — by the Head Sahayak or by the MLA — are excluded from Requested:
 * once turned down that is no longer money being asked for. Each gets its own
 * column so the figure stays visible rather than silently vanishing.
 *
 * Nothing is sanctioned until the MLA decides, so a panchayat whose forms are
 * all still in verification shows a real Requested figure and a zero
 * Sanctioned one. That is the honest picture, not a gap in the data.
 *
 * Blocks start expanded and zones start collapsed. Two blocks is a glance;
 * two blocks x three zones x sixty panchayats is not, so the middle level is
 * where the tree is opened deliberately rather than by default.
 */
function Totals({ row, className = '' }) {
  return (
    <>
      <td className={`num right requested ${className}`}>{formatMoney(row.requested)}</td>
      <td className={`num right sanctioned ${className}`}>{formatMoney(row.sanctioned)}</td>
      <td className={`num right wait ${className}`}>{formatMoney(row.awaitingHead)}</td>
      <td className={`num right sent ${className}`}>{formatMoney(row.awaitingMla)}</td>
      <td className={`num right handed ${className}`}>{formatMoney(row.distributed)}</td>
      <td className={`num right rejected ${className}`}>
        {formatMoney(row.headRejected + row.mlaRejected)}
      </td>
    </>
  );
}

/** The MLA's net adjustment across a group of accepted forms. */
function Variance({ value }) {
  if (!value) return <span className="var-none">no change</span>;
  const up = value > 0;
  return (
    <span className={`var ${up ? 'up' : 'down'}`}>
      {up ? '+' : '−'}
      {formatMoney(Math.abs(value))}
    </span>
  );
}

export default function AmountSummary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});     // blocks
  const [openZones, setOpenZones] = useState({});

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
        <span className="summary-note">
          Sanctioned is what the MLA granted, and is only counted once they decide. Rejected forms
          are excluded from Requested.
        </span>
      </div>

      {/* Headline figures, before the per-block breakdown. */}
      <div className="summary-tiles">
        <div className="stat requested">
          <div className="l">Total Requested</div>
          <div className="n">{formatMoney(overall.requested)}</div>
          <div className="c">{overall.openCount + overall.acceptedCount} applications</div>
        </div>

        <div className="stat sanctioned">
          <div className="l">Sanctioned by MLA</div>
          <div className="n">{formatMoney(overall.sanctioned)}</div>
          <div className="c">
            {overall.acceptedCount} accepted · <Variance value={overall.variance} /> vs requested
          </div>
        </div>

        <div className="stat wait">
          <div className="l">With Head Sahayak</div>
          <div className="n">{formatMoney(overall.awaitingHead)}</div>
          <div className="c">{overall.awaitingHeadCount} awaiting verification</div>
        </div>

        <div className="stat sent">
          <div className="l">With MLA</div>
          <div className="n">{formatMoney(overall.awaitingMla)}</div>
          <div className="c">{overall.awaitingMlaCount} awaiting decision</div>
        </div>

        <div className="stat handed">
          <div className="l">Distributed</div>
          <div className="n">{formatMoney(overall.distributed)}</div>
          <div className="c">
            {overall.distributedCount} of {overall.acceptedCount} handed over
          </div>
        </div>

        <div className="stat rejected">
          <div className="l">Rejected</div>
          <div className="n">{formatMoney(overall.headRejected + overall.mlaRejected)}</div>
          <div className="c">
            {overall.headRejectedCount} by Head · {overall.mlaRejectedCount} by MLA
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data summary-table">
          <thead>
            <tr>
              <th>Block / Zone / Panchayat</th>
              <th className="right">Requested</th>
              <th className="right">Sanctioned</th>
              <th className="right">With Head</th>
              <th className="right">With MLA</th>
              <th className="right">Distributed</th>
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
                  b.zones.map((z) => (
                    <Fragment key={`z-${z.zoneId}`}>
                      <tr
                        className="zone-row clickable"
                        onClick={() => setOpenZones((o) => ({ ...o, [z.zoneId]: !o[z.zoneId] }))}
                      >
                        <td className="indent">
                          <span className="caret" aria-hidden="true">
                            {openZones[z.zoneId] ? '▾' : '▸'}
                          </span>
                          {z.zoneName}
                          <span className="c-sub"> · {z.totalCount} forms</span>
                        </td>
                        <Totals row={z} />
                      </tr>

                      {openZones[z.zoneId] &&
                        z.panchayats.map((p) => (
                          <tr key={`p-${p.panchayatId}`} className="panchayat-row">
                            <td className="indent-2">
                              {p.panchayatName}
                              <span className="c-sub"> · {p.totalCount}</span>
                            </td>
                            <Totals row={p} className="soft" />
                          </tr>
                        ))}
                    </Fragment>
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
