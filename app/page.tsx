import MarketWorkspace from './MarketWorkspace';
import { connection } from 'next/server';
import { preload } from 'react-dom';
import catalog from '../public/recordings/catalog.json';

// SOURCE: MarketWorkspace's default market. Starting its download with the HTML removes
// the HTML → JavaScript → data waterfall on the first visit.
const DEFAULT_RECORDING = catalog.find((item) => item.id === 'recorded-XAUUSD')?.path;

export default async function Home() {
  // SOURCE: check the deployment's runtime configuration, not build-time secrets.
  await connection();
  // fetch() uses CORS mode with same-origin credentials, which matches crossOrigin "anonymous".
  if (DEFAULT_RECORDING) preload(DEFAULT_RECORDING, { as: 'fetch', crossOrigin: 'anonymous' });
  return <MarketWorkspace storedEnabled={Boolean(process.env.DATABASE_URL)} />;
}
