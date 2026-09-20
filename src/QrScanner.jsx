import React, { useEffect, useRef, useState } from 'react';

function cameraMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Camera permission was denied. Allow camera access in browser settings or use manual entry.';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'No usable camera was found on this device.';
  if (!globalThis.isSecureContext) return 'Camera scanning requires HTTPS or localhost.';
  return 'The camera could not be started. Retry or use manual entry.';
}

export default function QrScanner({ active, restartKey, onDetected }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera scanning is not supported by this browser. Use manual entry.');
      return undefined;
    }
    let cancelled = false;
    let controls;
    let handled = false;
    setError('');
    import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (cancelled) return null;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      return reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result, scanError, scannerControls) => {
          if (!result || handled || cancelled) return;
          handled = true;
          scannerControls.stop();
          onDetected(result.getText());
        },
      );
    }).then((nextControls) => { if (nextControls) { controls = nextControls; if (cancelled) controls.stop(); } })
      .catch((cameraError) => { if (!cancelled) setError(cameraMessage(cameraError)); });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active, restartKey, onDetected]);

  return <div className="qr-scanner"><div className="scanner-viewport"><video ref={videoRef} muted playsInline aria-label="QR scanner camera preview" /><span className="scanner-frame" aria-hidden="true" /></div>{error && <div className="scanner-error" role="alert">{error}</div>}</div>;
}
