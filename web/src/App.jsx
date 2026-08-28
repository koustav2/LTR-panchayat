import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import api from './api';
import { useAuth } from './auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SahayakForm from './pages/SahayakForm';
import FormList from './pages/FormList';
import FormDetail from './pages/FormDetail';
import ApprovalList from './pages/ApprovalList';
import { MY_QUEUE, ROLE_LABEL } from './components/ui';

const TITLES = {
  '/': 'Sahayak Form Portal',
  '/form': 'Sahayak Form',
  '/forms': 'List of Form Uploaded',
  '/approvals': 'Approval List',
};

/**
 * Sidebar — only rendered from 1024px up (CSS hides it below that, where the
 * mobile top bar takes over). The badge counts the applications waiting on
 * *this* role, and is refreshed whenever the route changes, so a decision made
 * on the detail page is reflected here immediately.
 */
function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(null);
  const [handover, setHandover] = useState(null);
  const queue = MY_QUEUE[user.role];

  useEffect(() => {
    if (!queue) return undefined;
    let alive = true;
    api
      .listApplications({ page: 1 })
      .then((d) => alive && setWaiting(d.counts[queue]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [location.pathname, queue]);

  // How many approved applications are still waiting to be handed over. Only
  // the two field roles can act on them, so only they are asked to count them.
  useEffect(() => {
    if (user.role === 'mla') return undefined;
    let alive = true;
    api
      .approved({ distributed: 'no', page: 1 })
      .then((d) => alive && setHandover(d.counts.pendingHandover))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [location.pathname, user.role]);

  const isForms = location.pathname.startsWith('/forms');
  const isApprovals = location.pathname.startsWith('/approvals');
  // The MLA decides; they do not hand money over, so the queue is not theirs.
  const canDistribute = user.role === 'supervisor' || user.role === 'head_sahayak';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="mark" aria-hidden="true">LRT</div>
        <div>
          <div className="t">Sahayak Form Portal</div>
          <div className="s">Panchayat Support</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          onClick={() => navigate('/')}
          aria-current={location.pathname === '/' ? 'page' : undefined}
        >
          <span className="ico" aria-hidden="true">⌂</span> Dashboard
        </button>

        {user.role === 'supervisor' && (
          <button
            onClick={() => navigate('/form')}
            aria-current={location.pathname === '/form' ? 'page' : undefined}
          >
            <span className="ico" aria-hidden="true">✎</span> Sahayak Form
          </button>
        )}

        <button onClick={() => navigate('/forms')} aria-current={isForms ? 'page' : undefined}>
          <span className="ico" aria-hidden="true">☰</span>
          {user.role === 'supervisor' ? 'My Forms' : 'All Forms'}
          {waiting > 0 && <span className="pill-count">{waiting}</span>}
        </button>

        {canDistribute && (
          <button
            onClick={() => navigate('/approvals')}
            aria-current={isApprovals ? 'page' : undefined}
          >
            <span className="ico" aria-hidden="true">✔</span> Approval List
            {handover > 0 && <span className="pill-count">{handover}</span>}
          </button>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <div className="n">{user.fullName}</div>
          <div className="r">{ROLE_LABEL[user.role] || user.role}</div>
        </div>
        <button onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isRoot = location.pathname === '/';
  const title = TITLES[location.pathname] || 'Application Details';

  // On phones the form and the detail view pin an action bar to the bottom, so
  // the page needs padding underneath. On desktop that bar is in the sidebar
  // column instead and the padding is dropped (see the media query).
  const hasActionBar = location.pathname === '/form' || /^\/forms\/\d+$/.test(location.pathname);

  return (
    <div className="app">
      <Sidebar />

      <header className="topbar">
        <div className="topbar-inner">
          {!isRoot && (
            <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
              ‹
            </button>
          )}
          <div>
            <h1>{title}</h1>
            {isRoot && <div className="sub">{ROLE_LABEL[user.role] || user.role}</div>}
          </div>
          <div className="spacer" />
          {isRoot && (
            <button className="linklike" onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className={hasActionBar ? 'has-actionbar' : undefined}>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-wrap">
        <div className="spinner" style={{ borderColor: '#cbd5e1', borderTopColor: '#15803d' }} />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route
          path="/form"
          element={
            <RequireRole role="supervisor">
              <SahayakForm />
            </RequireRole>
          }
        />
        <Route path="/forms" element={<FormList />} />
        <Route path="/forms/:id" element={<FormDetail />} />
        <Route
          path="/approvals"
          element={
            user.role === 'mla' ? <Navigate to="/forms?status=accepted" replace /> : <ApprovalList />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
