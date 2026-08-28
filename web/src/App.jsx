import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import api from './api';
import { useAuth } from './auth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SahayakForm from './pages/SahayakForm';
import FormList from './pages/FormList';
import FormDetail from './pages/FormDetail';
import { MY_QUEUE, ROLE_LABEL } from './components/ui';

const TITLES = {
  '/': 'Sahayak Form Portal',
  '/form': 'Sahayak Form',
  '/forms': 'List of Form Uploaded',
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

  const isForms = location.pathname.startsWith('/forms');

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
