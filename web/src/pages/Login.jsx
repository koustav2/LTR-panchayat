import { useState } from 'react';
import { useAuth } from '../auth';
import { Field, Banner } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="mark" aria-hidden="true">LRT</div>
          <h1>Sahayak Form Portal</h1>
          <p>Dharmasala &amp; Rasulpur Dharasamal</p>
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        <form onSubmit={submit} noValidate>
          <Field label="Username" required>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </Field>

          <Field label="Password" required>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !username || !password}>
            {busy ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
