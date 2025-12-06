import { useState, useEffect } from 'react';

export default function Home() {
  const [seconds, setSeconds] = useState(60);
  const [status, setStatus] = useState({ active: false, progress: 0, message: '', error: null });
  const [videoSrc, setVideoSrc] = useState(null);

  // Check initial video availability
  useEffect(() => {
    console.log('[Home] Mounting and checking video availability');
    // We check if video is available by trying to fetch a byte
    fetch('/api/video', { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          console.log('[Home] Video found at /api/video');
          setVideoSrc('/api/video');
        } else {
          console.log('[Home] No video found');
        }
      })
      .catch(err => console.error('[Home] Error checking video:', err));
  }, []);

  // Poll status
  useEffect(() => {
    let interval;
    if (status.active || status.message === 'Starting processing...') {
      console.log('[Home] Starting polling for status...');
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/process');
          const data = await res.json();
          console.log('[Home] Polling status:', data);
          setStatus(data);
          if (!data.active && data.progress === 100) {
              console.log('[Home] Job finished, clearing video source');
              // Job finished
              setVideoSrc(null); // Original deleted
          }
        } catch (pollErr) {
          console.error('[Home] Polling error:', pollErr);
        }
      }, 1000);
    }
    return () => {
      if (interval) {
         console.log('[Home] Stopping polling');
         clearInterval(interval);
      }
    };
  }, [status.active, status.message]);

  const startProcessing = async () => {
    console.log(`[Home] Starting processing with ${seconds} seconds split`);
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seconds }),
      });
      const data = await res.json();
      console.log('[Home] Start processing response:', data);
      if (res.ok) {
        setStatus(data.jobStatus);
      } else {
        console.error('[Home] Error response from start processing:', data.error);
        alert(data.error);
      }
    } catch (err) {
      console.error('[Home] Exception starting process:', err);
      alert('Error starting process');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Cortador de Vídeo</h1>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ marginRight: '10px' }}>
          Segundos por parte:
          <input
            type="number"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            style={{ marginLeft: '10px', padding: '5px' }}
          />
        </label>
        <button
          onClick={startProcessing}
          disabled={status.active}
          style={{ padding: '5px 15px', cursor: 'pointer' }}
        >
          {status.active ? 'Processando...' : 'Iniciar'}
        </button>
      </div>

      {status.message && (
        <div style={{ marginBottom: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
          <strong>Status:</strong> {status.message}
          {status.error && <div style={{ color: 'red' }}>Error: {status.error}</div>}
          <div style={{ width: '100%', backgroundColor: '#ddd', height: '20px', marginTop: '5px' }}>
             <div style={{ width: `${status.progress || 0}%`, backgroundColor: 'green', height: '100%', transition: 'width 0.5s' }}></div>
          </div>
        </div>
      )}

      {videoSrc ? (
        <div>
          <h2>Vídeo Original (Preview)</h2>
          <video controls width="600" src={videoSrc}>
            Your browser does not support the video tag.
          </video>
        </div>
      ) : (
        <p>Nenhum vídeo original encontrado (ou foi processado e deletado).</p>
      )}
    </div>
  );
}
