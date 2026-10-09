/* Thin fetch wrapper. `credentials: 'include'` matters — the session lives in
   an httpOnly cookie, which JavaScript cannot read (that is the point), so it
   must be sent automatically with every request. */

async function request(method, path, body, opts = {}) {
  const init = { method, credentials: 'include', headers: {} };

  if (body instanceof FormData) {
    init.body = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, init);

  if (opts.raw) return res;

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b, o),
  patch: (p, b, o) => request('PATCH', p, b, o),

  login: (username, password) => request('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),

  bootstrap: () => request('GET', '/master/bootstrap'),
  lookupAadhaar: (aadhaar) =>
    request('GET', `/beneficiaries/lookup?aadhaar=${encodeURIComponent(aadhaar)}`),

  listApplications: (params) => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== '' && v != null) qs.set(k, v);
    });
    return request('GET', `/applications?${qs.toString()}`);
  },
  summary: () => request('GET', '/applications/summary'),

  // The approval list — every accepted application, for all three roles.
  approved: (params) => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== '' && v != null) qs.set(k, v);
    });
    return request('GET', `/applications/approved?${qs.toString()}`);
  },

  // Head Sahayak hands an accepted application's money over for distribution.
  // Starts the clock on the distribution-photo deadline.
  handover: (id) => request('PATCH', `/applications/${id}/handover`),

  // Records that the money reached the applicant. Sahayak only; the photo is
  // required and the Head Sahayak must have handed the application over first.
  distribute: (id, photoFileId) =>
    request('PATCH', `/applications/${id}/distribute`, { photoFileId }),

  // Records that the money was returned because distribution could not be
  // completed. Sahayak only; photo and remark both required.
  returnMoney: (id, photoFileId, remark) =>
    request('PATCH', `/applications/${id}/return`, { photoFileId, remark }),

  // Handed over, photo not yet uploaded — the Pending Distribution Photo page.
  pendingPhoto: (params) => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== '' && v != null) qs.set(k, v);
    });
    return request('GET', `/applications/pending-photo?${qs.toString()}`);
  },

  // Overdue distribution-photo alerts for the home page. The server applies
  // the right threshold for the caller's role (3 days; 5 for the MLA).
  alerts: () => request('GET', '/applications/alerts'),

  // Sahayak profile management (Head Sahayak only).
  listUsers: () => request('GET', '/users'),
  createUser: (payload) => request('POST', '/users', payload),
  updateUser: (id, payload) => request('PATCH', `/users/${id}`, payload),
  getApplication: (id, reveal) =>
    request('GET', `/applications/${id}${reveal ? '?revealAadhaar=true' : ''}`),
  createApplication: (payload) => request('POST', '/applications', payload),
  // MLA decision. `approvedAmount` is only read on an acceptance; leaving it
  // undefined sanctions the full requested amount.
  setStatus: (id, { status, approvedAmount, rejectionReason, comment }) =>
    request('PATCH', `/applications/${id}/status`, {
      status,
      approvedAmount,
      rejectionReason,
      comment,
    }),

  // Head Sahayak verification. decision is 'forward' or 'reject'; the comment
  // is required either way.
  verifyApplication: (id, decision, comment) =>
    request('PATCH', `/applications/${id}/verify`, { decision, comment }),

  uploadFile: (file, kind) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    return request('POST', '/files', fd);
  },
  fileUrl: (id) => `/api/files/${id}`,
};

export default api;
