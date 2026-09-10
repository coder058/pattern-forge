import MarketWorkspace from './MarketWorkspace';
import { connection } from 'next/server';

export default async function Home() {
  // SOURCE: check the deployment's runtime configuration, not build-time secrets.
  await connection();
  return <MarketWorkspace storedEnabled={Boolean(process.env.DATABASE_URL)} />;
}
