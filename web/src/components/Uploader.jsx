import { useRef, useState } from 'react';
import api from '../api';

/**
 * Compresses an image in the browser before it is uploaded.
 *
 * A photo straight from a phone camera is often 4-6 MB. On a patchy rural
 * connection that upload fails or takes minutes, so it is resized to fit
 * within maxDim and re-encoded as JPEG first. PDFs pass through untouched.
 */
async function compressImage(file, maxDim = 1400, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  bitmap.close?.();

  // If compression somehow made it bigger, keep the original.
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function PhotoUploader({ value, onChange, onError }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handle(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file, 1200, 0.72);
      const res = await api.uploadFile(compressed, 'applicant_photo');
      onChange({ id: res.file.id, name: res.file.originalName, preview: URL.createObjectURL(compressed) });
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handle}
        style={{ display: 'none' }}
      />
      {value ? (
        <div className="thumbs">
          <div className="thumb">
            <img src={value.preview || api.fileUrl(value.id)} alt="Applicant" />
            <button type="button" className="x" onClick={() => onChange(null)} aria-label="Remove photo">
              ×
            </button>
          </div>
        </div>
      ) : (
        <div className="file-btn" role="button" tabIndex={0} onClick={() => inputRef.current?.click()}
             onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}>
          {busy ? 'Uploading…' : '📷  Take or choose photo'}
        </div>
      )}
    </div>
  );
}

export function DocumentUploader({ value = [], onChange, onError, max = 5 }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function handle(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const room = max - value.length;
    if (room <= 0) {
      onError(`You can attach at most ${max} documents.`);
      return;
    }

    setBusy(true);
    const added = [];
    try {
      for (const file of files.slice(0, room)) {
        const prepared = await compressImage(file, 1800, 0.8);
        const res = await api.uploadFile(prepared, 'document');
        added.push({
          id: res.file.id,
          name: res.file.originalName,
          isImage: res.file.mimeType.startsWith('image/'),
          preview: prepared.type.startsWith('image/') ? URL.createObjectURL(prepared) : null,
        });
      }
      onChange([...value, ...added]);
    } catch (err) {
      if (added.length) onChange([...value, ...added]);
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handle}
        style={{ display: 'none' }}
      />
      {value.length > 0 && (
        <div className="thumbs">
          {value.map((f) => (
            <div className="thumb" key={f.id}>
              {f.preview ? (
                <img src={f.preview} alt={f.name} />
              ) : (
                <div className="doc">📄<br />{f.name.slice(0, 18)}</div>
              )}
              <button
                type="button"
                className="x"
                onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {value.length < max && (
        <div className="file-btn" role="button" tabIndex={0} onClick={() => inputRef.current?.click()}
             onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}>
          {busy ? 'Uploading…' : `📎  Add documents (${value.length}/${max})`}
        </div>
      )}
    </div>
  );
}
