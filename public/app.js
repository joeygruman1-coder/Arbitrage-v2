let matches = []; let category = 'all'; let pollTimer;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const escapeHtml = (text = '') => String(text).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const cents = (value) => value > 0 ? `${(value * 100).toFixed(value < .1 ? 1 : 0)}¢` : '—';

function render() {
  const sort = document.querySelector('#sort').value;
  const visible = matches.filter((match) => category === 'all' || match.category === category).sort((a, b) => sort === 'volume'
    ? (b.polymarket.volume + b.kalshi.volume) - (a.polymarket.volume + a.kalshi.volume)
    : category === 'profitable' ? b.bestRoute.profit - a.bestRoute.profit : b.score - a.score);
  const list = document.querySelector('#match-list');
  if (!visible.length) { list.innerHTML = '<div class="empty"><b>No pairs in this category yet.</b><p>The scanner keeps looking automatically. Matching exact contract rules is intentionally conservative.</p></div>'; return; }
  const displayed = visible.slice(0, 100);
  list.innerHTML = `${visible.length > displayed.length ? `<div class="result-limit">Showing the first 100 of ${visible.length} results. Use a category or volume sort to narrow the list.</div>` : ''}${displayed.map((match, index) => `<article class="match-card ${match.category}" style="--delay:${Math.min(index * 35, 250)}ms">
    <div class="confidence"><div class="ring" style="--score:${Math.round(match.score * 100)}"><span>${Math.round(match.score * 100)}%</span></div><small>match<br>confidence</small></div>
    <div><div class="pair">${market(match.polymarket, 'poly', 'Polymarket')}<div class="link-line"><span>⇄</span></div>${market(match.kalshi, 'kalshi', 'Kalshi')}</div>${routePanel(match)}</div>
  </article>`).join('')}`;
}

function market(item, type, label) {
  return `<a class="market" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><div class="market-top"><span class="exchange ${type}"><i></i>${label}</span><span class="external">↗</span></div><h3>${escapeHtml(item.title)}</h3><div class="market-meta"><span><small>YES ASK</small>${cents(item.yesAsk)}</span><span><small>NO ASK</small>${cents(item.noAsk)}</span><span><small>24H VOL</small>$${compact.format(item.volume)}</span></div></a>`;
}

function routePanel(match) {
  if (!match.bestRoute) return '<div class="route-panel"><span class="route-badge">Prices unavailable</span></div>';
  const best = match.bestRoute;
  const labels = { profitable: 'True arbitrage', fee_blocked: 'Under $1 · not profitable after fees', overpriced: 'Combined price over $1' };
  return `<div class="route-panel"><span class="route-badge ${match.category}">${labels[match.category] || 'Review'}</span><b>${escapeHtml(best.name)}</b><div class="route-math"><span>Contracts <strong>${money.format(best.rawCost)}</strong></span><span>Est. taker fees <strong>+${money.format(best.fees)}</strong></span><span>Net cost <strong>${money.format(best.netCost)}</strong></span><span class="${best.profit > 0 ? 'positive' : 'negative'}">Profit / contract <strong>${best.profit > 0 ? '+' : ''}${money.format(best.profit)}</strong></span></div></div>`;
}

function counts() {
  const count = (name) => matches.filter((m) => m.category === name).length;
  document.querySelector('#all-tab').textContent = matches.length; document.querySelector('#profit-tab').textContent = count('profitable');
  document.querySelector('#fee-tab').textContent = count('fee_blocked'); document.querySelector('#over-tab').textContent = count('overpriced');
}

async function load() {
  try {
    const response = await fetch('/api/markets'); if (!response.ok) throw new Error('Scanner did not respond'); const data = await response.json();
    matches = data.matches || []; counts(); render();
    document.querySelector('#poly-count').textContent = compact.format(data.counts?.polymarket || data.scan?.polymarket || 0);
    document.querySelector('#kalshi-count').textContent = compact.format(data.counts?.kalshi || data.scan?.kalshi || 0);
    document.querySelector('#match-count').textContent = data.counts?.matches ?? matches.length;
    document.querySelector('#updated').textContent = data.scan?.active ? `${data.scan.phase} · ${(data.scan.polymarket || 0) + (data.scan.kalshi || 0)} downloaded` : `Last full scan ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const notice = document.querySelector('#notice'); notice.classList.toggle('hidden', !data.errors?.length); notice.textContent = data.errors?.join(' · ') || '';
    clearTimeout(pollTimer); pollTimer = setTimeout(load, data.scan?.active ? 3000 : 30000);
  } catch (error) { document.querySelector('#match-list').innerHTML = `<div class="empty"><b>Scanner connection lost.</b><p>${escapeHtml(error.message)}. Retrying automatically…</p></div>`; clearTimeout(pollTimer); pollTimer = setTimeout(load, 5000); }
}

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active')); button.classList.add('active'); category = button.dataset.category; render(); }));
document.querySelector('#sort').addEventListener('change', render);
document.querySelector('#refresh').addEventListener('click', async () => { await fetch('/api/scan', { method: 'POST' }); load(); });
load();
