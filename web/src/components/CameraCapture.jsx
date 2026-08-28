import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';

/**
 * Camera-only photo capture for recording a distribution.
 *
 * WHY getUserMedia AND NOT <input capture>
 * ---------------------------------------
 * `<input type="file" accept="image/*" capture="environment">` is only a *hint*.
 * iOS Safari honours it, Android Chrome mostly honours it, several OEM Android
 * browsers still show a "Camera / Gallery / Files" chooser, and every desktop
 * browser ignores it completely and opens a file picker. So it cannot be the
 * primary path when the requirement is "camera, not gallery".
 *
 * getUserMedia opens a live video stream and we grab a frame off a canvas. There
 * is no file picker anywhere in that flow, so the gallery is genuinely not an
 * option — not merely discouraged.
 *
 * Two honest limitations, stated here so nobody assumes more than this gives:
 *
 *   1. getUserMedia needs a secure context. It works on https:// and on
 *      localhost, and is unavailable over plain http:// — which is why the
 *      fallback below exists at all, and why the app must be served over TLS.
 *   2. It proves the bytes came from a camera *device*, not that the scene in
 *      front of it is real. A virtual camera can feed it a saved image. This
 *      raises the effort of faking a handover from "pick a file" to "install
 *      software"; it is a deterrent, not proof.
 *
 * The `<input capture>` path is kept strictly as a fallback for when
 * getUserMedia is missing or the user has blocked camera access at the OS
 * level — better a hinted picker than a dead end in the field.
 */

const MAX_DIM = 1400;
const JPEG_QUALITY = 0.78;

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

const supportsGetUserMedia = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

export default function CameraCapture({ onCaptured, onError, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const [phase, setPhase] = useState('idle'); // idle | starting | live | shot | uploading | blocked
  const [preview, setPreview] = useState(null); // { url, blob }
  const [message, setMessage] = useState('');

  const teardown = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // A live camera left running behind a closed panel is a battery drain and a
  // privacy smell. Always release it on unmount.
  useEffect(() => teardown, [teardown]);

  async function start() {
    setMessage('');
    if (!supportsGetUserMedia()) {
      setPhase('blocked');
      setMessage(
        window.isSecureContext === false
          ? 'The camera needs a secure (https) connection. Use the button below instead.'
          : 'This browser cannot open the camera directly. Use the button below instead.'
      );
      return;
    }
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera is the one pointing at the applicant and the money.
        // `ideal` rather than `exact` so a laptop with only a front camera still
        // works instead of throwing.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('live');
      // The <video> only exists once phase is 'live', so attach on the next tick.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      teardown();
      setPhase('blocked');
      setMessage(
        err && err.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow it in your browser settings, or use the button below.'
          : 'The camera could not be opened. Use the button below instead.'
      );
    }
  }

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setMessage('The photo could not be saved. Please try again.');
          return;
        }
        // Freeze the frame and release the camera immediately — the user is
        // now deciding whether to keep it, not still framing a shot.
        teardown();
        setPreview({ url: URL.createObjectURL(blob), blob });
        setPhase('shot');
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    start();
  }

  async function upload(blob, previewUrl) {
    setPhase('uploading');
    try {
      const file = new File([blob], `distribution-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const res = await api.uploadFile(file, 'distribution_photo');
      onCaptured({
        id: res.file.id,
        name: res.file.originalName,
        sizeBytes: res.file.sizeBytes,
        preview: previewUrl,
      });
      setPhase('idle');
      setPreview(null);
    } catch (err) {
      setPhase('shot');
      setMessage(err.message);
      if (onError) onError(err.message);
    }
  }

  /* The fallback: a capture-hinted file input. Only offered once the live
     camera has failed, never as a first choice. */
  async function handleFallbackFile(e) {
    const picked = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/')) {
      setMessage('That is not an image. Please take a photo.');
      return;
    }
    // Re-encode through a canvas so the upload is a manageable size, the same
    // way the live capture path does.
    const bitmap = await createImageBitmap(picked).catch(() => null);
    if (!bitmap) {
      upload(picked, URL.createObjectURL(picked));
      return;
    }
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    canvas.toBlob(
      (blob) => {
        const use = blob && blob.size < picked.size ? blob : picked;
        upload(use, URL.createObjectURL(use));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }

  const busy = phase === 'uploading' || phase === 'starting';

  return (
    <div className="camera">
      {phase === 'idle' && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={start}
          disabled={disabled}
        >
          <span aria-hidden="true">📷</span> Open camera
        </button>
      )}

      {phase === 'starting' && (
        <div className="camera-wait">
          <span className="spinner" /> Opening the camera…
        </div>
      )}

      {phase === 'live' && (
        <>
          <div className="camera-stage">
            {/* playsInline keeps iOS from taking the video fullscreen, which
                would hide the shutter button. */}
            <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" />
          </div>
          {/* One button, full width. The dialog around this already has a
              Cancel, and two Cancels a thumb-width apart is worse than none —
              closing the dialog unmounts this and releases the camera anyway. */}
          <div className="camera-actions single">
            <button type="button" className="btn btn-primary" onClick={shoot}>
              Take photo
            </button>
          </div>
        </>
      )}

      {(phase === 'shot' || phase === 'uploading') && preview && (
        <>
          <div className="camera-stage">
            <img src={preview.url} alt="Captured distribution photo" />
          </div>
          <div className="camera-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={retake}>
              Retake
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => upload(preview.blob, preview.url)}
            >
              {phase === 'uploading' ? <span className="spinner" /> : 'Use this photo'}
            </button>
          </div>
        </>
      )}

      {phase === 'blocked' && (
        <div className="camera-fallback">
          <p>{message}</p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={disabled}
          >
            <span aria-hidden="true">📷</span> Take a photo
          </button>
          <button type="button" className="linklike" onClick={start}>
            Try the camera again
          </button>
        </div>
      )}

      {message && phase !== 'blocked' && <div className="camera-msg">{message}</div>}

      {/* Present but never the first path. `capture` asks the OS for the camera;
          where the browser ignores it the user gets a picker, which is why this
          is the fallback and not the default. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFallbackFile}
        style={{ display: 'none' }}
        tabIndex={-1}
      />
    </div>
  );
}
