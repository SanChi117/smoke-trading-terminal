import { useEffect, useState } from 'react';
import Terminal from '../app/components/TerminalV6';
import Audit from '../app/audit/page';
import '../app/globals.css';

export default function App() {
  const [audit, setAudit] = useState(location.hash === '#audit');
  useEffect(() => {
    const changed = () => setAudit(location.hash === '#audit');
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return (
    <>
      <nav
        style={{
          padding: '8px 18px',
          display: 'flex',
          gap: 24,
          background: '#081310',
          borderBottom: '1px solid #244039',
        }}
      >
        <a href="#terminal">Терминал</a>
        <a href="#audit">Аудит сделок</a>
        <span style={{ color: '#78978c', marginLeft: 'auto' }}>
          USDⓈ-M Futures · PAPER ONLY
        </span>
      </nav>
      {audit ? <Audit /> : <Terminal />}
    </>
  );
}
