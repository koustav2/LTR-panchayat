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
  getApplication: (id, reveal) =>
    request('GET', `/applications/${id}${reveal ? '?revealAadhaar=true' : ''}`),
  createApplication: (payload) => request('POST', '/applications', payload),
  setStatus: (id, status, rejectionReason, comment) =>
    request('PATCH', `/applications/${id}/status`, { status, rejectionReason, comment }),

  uploadFile: (file, kind) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    return request('POST', '/files', fd);
  },
  fileUrl: (id) => `/api/files/${id}`,
};

export default api;
