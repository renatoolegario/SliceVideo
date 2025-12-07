import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Join() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Poll for status
  useEffect(() => {
    let interval;
    if (loading || (status && status.active)) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/join');
          const data = await res.json();
          setStatus(data);

          if (!data.active && data.progress === 100) {
            setLoading(false);
          }
          if (data.error) {
            setError(data.error);
            setLoading(false);
          }
        } catch (err) {
          console.error(err);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [loading, status]);

  const startJoin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start');
      }
      const data = await res.json();
      setStatus(data.jobStatus);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <Head>
        <title>Smart Video Joiner</title>
      </Head>

      <h1>Smart Video Joiner</h1>
      <p>
        Places videos from <code>arquivos/join</code> in order, removes silence,
        and applies dynamic zoom effects.
      </p>

      {error && (
        <div style={{ color: 'red', marginBottom: '20px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <button
        onClick={startJoin}
        disabled={loading || (status && status.active)}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          backgroundColor: loading ? '#ccc' : '#0070f3',
          color: 'white',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          borderRadius: '5px'
        }}
      >
        {loading ? 'Processing...' : 'Start Join Process'}
      </button>

      {status && (
        <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Status</h3>
          <p><strong>Step:</strong> {status.step}</p>
          <p><strong>Message:</strong> {status.message}</p>

          <div style={{ width: '100%', height: '20px', backgroundColor: '#eee', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{
              width: `${status.progress}%`,
              height: '100%',
              backgroundColor: status.error ? 'red' : '#4caf50',
              transition: 'width 0.5s ease'
            }} />
          </div>
          <p style={{ textAlign: 'right' }}>{status.progress}%</p>

          {status.outputFile && (
            <div style={{ marginTop: '20px', color: 'green' }}>
              <strong>Success!</strong> File created at:
              <br />
              <code>arquivos/final/{status.outputFile}</code>
            </div>
          )}
        </div>
      )}

      <div style={{marginTop: '40px'}}>
        <a href="/">← Back to Home</a>
      </div>
    </div>
  );
}
