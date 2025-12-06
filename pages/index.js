import { useState, useEffect } from 'react';

export default function Home() {
  const [seconds, setSeconds] = useState(60);
  const [status, setStatus] = useState({ active: false, progress: 0, message: '', error: null });
  const [videoSrc, setVideoSrc] = useState(null);

  // Check initial video availability
  useEffect(() => {
    // We check if video is available by trying to fetch a byte
    fetch('/api/video', { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          setVideoSrc('/api/video');
        }
      })
      .catch(err => console.error(err));
  }, []);

  // Poll status
  useEffect(() => {
    let interval;
    if (status.active || status.message === 'Starting processing...') {
      interval = setInterval(async () => {
        const res = await fetch('/api/process');
        const data = await res.json();
        setStatus(data);
        if (!data.active && data.progress === 100) {
            // Job finished
            setVideoSrc(null); // Original deleted
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status.active, status.message]);

  const startProcessing = async () => {
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seconds }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(data.jobStatus);
      } else {
        alert(data.error);
      }
    } catch (err) {
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
