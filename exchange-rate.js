const RATE_URL = 'https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv&lastNObservations=1';
let lastRate = null;
let refreshAfter = 0;
let pending;

async function loadRate() {
  try {
    const response = await fetch(RATE_URL, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('Exchange rate unavailable');
    const [header, row] = (await response.text()).trim().split(/\r?\n/);
    const columns = header.split(';');
    const values = row.split(';');
    const date = values[columns.indexOf('TIME_PERIOD')];
    const nokPerUsd = Number(values[columns.indexOf('OBS_VALUE')]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nokPerUsd) || nokPerUsd <= 0) {
      throw new Error('Invalid exchange rate');
    }
    lastRate = { date, nokPerUsd };
    refreshAfter = Date.now() + 60 * 60 * 1000;
  } catch {
    refreshAfter = Date.now() + 60 * 1000;
  }
  return lastRate;
}

function getUsdNokRate() {
  if (Date.now() < refreshAfter) return lastRate;
  pending ??= loadRate().finally(() => { pending = undefined; });
  return pending;
}

module.exports = { getUsdNokRate };
