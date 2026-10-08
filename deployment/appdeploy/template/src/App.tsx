import { useEffect, useState } from 'react';
import Terminal from '../app/components/TerminalV6';
import { api, auth } from '@appdeploy/client';
import ObservationPanel, { type ObservationClient } from '../app/components/ObservationPanel';
import { collectObservation } from '../services/market-data/observation-features';
import { fetchFuturesPublic } from '../app/lib/binance-public-transport';
import Audit from '../app/audit/page';
import '../app/globals.css';

function apiError(caught: unknown): string {
  const detail = caught as { response?: { data?: { error?: string; message?: string } } };
  return detail?.response?.data?.error ?? detail?.response?.data?.message ?? (caught instanceof Error ? caught.message : 'Запрос не выполнен');
}

export default function App() {
  const [route, setRoute] = useState(location.hash);
  const client: ObservationClient = {
    analyze: async (symbol, save) => {
      try {
        if (save && !auth.isSignedIn()) throw new Error('Сначала войдите для записи в личный журнал.');
        const result = await collectObservation(symbol, async path => {
          const response = await fetchFuturesPublic(path, { browser: false });
          if (!response.ok) throw new Error(`Binance Futures HTTP ${response.status}`);
          return response.json();
        });
        return save ? (await api.post('/api/observations', { symbol, evidence: result.sourceEvidence })).data : { result };
      }
      catch (error) { throw new Error(save && !auth.isSignedIn() ? 'Сначала войдите для записи в личный журнал.' : apiError(error)); }
    },
    history: async (nextToken) => {
      if (!auth.isSignedIn()) throw new Error('Сначала войдите для загрузки личного журнала.');
      return (await api.get('/api/observations' + (nextToken ? '?nextToken=' + encodeURIComponent(nextToken) : ''))).data;
    },
    signIn: async () => { await auth.signIn(); },
    signOut: async () => { await auth.signOut(); },
  };
  useEffect(() => {
    const changed = () => setRoute(location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return (
    <>
      <nav
        style={{
          padding: '8px 18px',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          background: '#081310',
          borderBottom: '1px solid #244039',
        }}
      >
        <a href="#terminal">Терминал</a>
        <a href="#audit">Аудит сделок</a>
        <a href="#brains">Brains и журнал</a>
        <span style={{ color: '#78978c', marginLeft: 'auto' }}>
          USDⓈ-M Futures · PAPER ONLY
        </span>
      </nav>
      {route === '#audit' ? <Audit /> : route === '#brains' ? <ObservationPanel client={client} /> : <Terminal />}
    </>
  );
}
