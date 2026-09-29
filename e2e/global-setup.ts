import { startBlackhole } from './offline/blackhole.js';

// Starts the blackhole proxy every browser of the run goes through (specs/10-testing-acceptance.md
// §6, D-127), and answers the function that stops it once the run is over.
export default async function globalSetup(): Promise<() => Promise<void>> {
  const blackhole = await startBlackhole(
    Number(process.env.EMBERGLASS_E2E_BLACKHOLE_PORT),
    process.env.EMBERGLASS_E2E_OUTBOUND_LOG!,
  );
  return blackhole.close;
}
