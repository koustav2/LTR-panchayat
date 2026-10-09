import { useEffect, useState } from 'react';
import api from '../api';
import {
  DeskHead, Empty, Skeletons, Banner, Modal, Field,
  formatDate,
} from '../components/ui';
import { PhotoUploader } from '../components/Uploader';

/**
 * Sahayak Profiles — the Head Sahayak creates and manages Sahayak (supervisor)
 * accounts: login id, password, block, and optional email / phone / profile
 * photo. Reviewer accounts are still managed in the database, on purpose.
 *
 * Accounts are deactivated rather than deleted — their name is on submitted
 * applications and in the audit log forever.
 */

const EMPTY_FORM = {
  fullName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirm: '',
  blockId: '',
  photo: null,
};

export default function SahayakUsers() {
  const [users, setUsers] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Password reset, one account at a time.
  const [resetting, setResetting] = useState(null); // user object
  const [newPassword, setNewPassword] = useState('');

  async function load() {
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    api.bootstrap().then((m) => setBlocks(m.blocks || [])).catch(() => {});
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const formValid =
    form.fullName.trim().length >= 2 &&
    form.username.trim().length >= 3 &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    form.blockId;

  async function create() {
    setBusy(true);
    setError('');
    try {
      await api.createUser({
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password,
        blockId: form.blockId,
        profilePhotoFileId: form.photo ? form.photo.id : undefined,
      });
      setCreating(false);
      setForm(EMPTY_FORM);
      setNotice('Sahayak profile created. They can sign in with the login id and password you set.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u) {
    setBusy(true);
    setError('');
    try {
      await api.updateUser(u.id, { isActive: !u.isActive });
      setNotice(
        u.isActive
          ? `${u.fullName} can no longer sign in. Their submitted forms are untouched.`
          : `${u.fullName} can sign in again.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    setError('');
    try {
      await api.updateUser(resetting.id, { password: newPassword });
      setResetting(null);
      setNewPassword('');
      setNotice('Password changed. Share it with the Sahayak directly.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DeskHead crumb="Head Sahayak · accounts" title="Sahayak Profiles">
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New Sahayak
        </button>
      </DeskHead>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}

      {/* The desktop heading is hidden on phones; give them the button too. */}
      <div className="mobile-only" style={{ margin: '12px 0' }}>
        <button className="btn btn-primary btn-block" onClick={() => setCreating(true)}>
          + New Sahayak
        </button>
      </div>

      {!users ? (
        <Skeletons count={4} />
      ) : users.length === 0 ? (
        <Empty icon="👤" title="No Sahayak accounts yet">
          Create one with the button above — login id, password and block are all it needs.
        </Empty>
      ) : (
        <div className="rows">
          {users.map((u) => (
            <div className="row" key={u.id} style={{ cursor: 'default' }}>
              <div className="row-top" style={{ alignItems: 'center', gap: 10 }}>
                {u.profilePhotoFileId ? (
                  <img
                    src={api.fileUrl(u.profilePhotoFileId)}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 40, height: 40, borderRadius: '50%', background: '#e2e8f0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, color: '#475569',
                    }}
                  >
                    {u.fullName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div className="row-name" style={{ margin: 0 }}>{u.fullName}</div>
                  <div className="row-meta">
                    {u.username}
                    {u.email ? ` · ${u.email}` : ''}
                    {u.phone ? ` · ${u.phone}` : ''}
                  </div>
                </div>
                <span className={`badge ${u.isActive ? 'accepted' : 'rejected'}`}>
                  {u.isActive ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div className="row-meta">
                {u.blockName || 'No block'} · last sign-in{' '}
                {u.lastLoginAt ? formatDate(u.lastLoginAt, true) : 'never'}
                {u.createdByName ? ` · created by ${u.createdByName}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setNewPassword('');
                    setResetting(u);
                  }}
                >
                  Reset password
                </button>
                <button
                  className={`btn ${u.isActive ? 'btn-danger' : 'btn-primary'}`}
                  disabled={busy}
                  onClick={() => toggleActive(u)}
                >
                  {u.isActive ? 'Disable sign-in' : 'Enable sign-in'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------- Create a Sahayak */}
      {creating && (
        <Modal
          title="New Sahayak profile"
          description="They sign in with this login id and password. Email, phone and photo are optional."
          onClose={() => setCreating(false)}
          actions={
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !formValid} onClick={create}>
                {busy ? <span className="spinner" /> : 'Create profile'}
              </button>
            </>
          }
        >
          <Field label="Full name" required>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
              autoFocus
            />
          </Field>

          <Field
            label="Login id"
            required
            hint="What they type to sign in — a short handle (sup.dharma) or an email address"
          >
            <input
              type="text"
              autoCapitalize="none"
              autoComplete="off"
              value={form.username}
              onChange={(e) => set({ username: e.target.value })}
            />
          </Field>

          <Field label="Email" hint="Optional">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>

          <Field label="Phone" hint="Optional, 10 digits">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '') })}
            />
          </Field>

          <Field label="Block" required>
            <select value={form.blockId} onChange={(e) => set({ blockId: e.target.value })}>
              <option value="">Choose a block</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Password" required hint="At least 8 characters">
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </Field>

          <Field
            label="Confirm password"
            required
            error={
              form.confirm && form.confirm !== form.password
                ? 'The passwords do not match.'
                : undefined
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => set({ confirm: e.target.value })}
            />
          </Field>

          <Field label="Profile photo" hint="Optional">
            <PhotoUploader
              kind="profile_photo"
              value={form.photo}
              onChange={(photo) => set({ photo })}
              onError={setError}
            />
          </Field>
        </Modal>
      )}

      {/* ------------------------------------------------- Reset a password */}
      {resetting && (
        <Modal
          title={`Reset password — ${resetting.fullName}`}
          description="Set a new password and share it with them directly. The old one stops working immediately."
          onClose={() => setResetting(null)}
          actions={
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setResetting(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || newPassword.length < 8}
                onClick={resetPassword}
              >
                {busy ? <span className="spinner" /> : 'Change password'}
              </button>
            </>
          }
        >
          <Field label="New password" required hint="At least 8 characters">
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
          </Field>
        </Modal>
      )}
    </>
  );
}
