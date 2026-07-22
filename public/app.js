let links = [];
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${Math.round(number * 100)}¢` : '—';
}

function market(marketData, exchange) {
  const close = marketData.closeTime ? new Date(marketData.closeTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Open date';
  return `<a class="market" href="${escapeHtml(marketData.url)}" target="_blank" rel="noopener noreferrer">
    <div class="exchange ${exchange.toLowerCase().replace(' ', '-')}"><i></i><span>${exchange}</span><b>VIEW MARKET ↗</b></div>
    <h3>${escapeHtml(marketData.title)}</h3>
    <div class="market-meta"><span>YES <strong>${price(marketData.price)}</strong></span><span>VOL <strong>${compact.format(marketData.volume || 0)}</strong></span><span>CLOSE <strong>${close}</strong></span></div>
  </a>`;
}

function render() {
  const confidence = $('#confidence').value;
  const query = $('#search').value.trim().toLowerCase();
  const visible = links.filter((link) => (confidence === 'all' || link.status === confidence) && (!query || `${link.polymarket.title} ${link.kalshi.title}`.toLowerCase().includes(query)));
  $('#links').innerHTML = visible.length ? visible.map((link, index) => `<article class="link-card">
    <div class="score"><small>#${String(index + 1).padStart(2, '0')}</small><div class="score-ring" style="--score:${link.confidence * 3.6}deg"><strong>${link.confidence}</strong><span>% FIT</span></div><b>${link.status === 'high' ? 'HIGH SIGNAL' : 'VERIFY'}</b></div>
    <div class="pair">${market(link.polymarket, 'Polymarket US')}<div class="connector"><span>↔</span></div>${market(link.kalshi, 'Kalshi')}</div>
    <p class="reason"><span>MATCH LOGIC</span>${escapeHtml(link.explanation)}</p>
  </article>`).join('') : '<div class="empty"><strong>No matching contracts</strong><p>Try another search or confidence filter. A live scan may also surface new pairs.</p></div>';
}

function setSource(name, source = {}) {
  $(`#${name}-state`).textContent = source.state === 'online' ? 'API ONLINE' : source.state === 'error' ? 'API ERROR' : 'SYNCING';
  $(`#${name}-dot`).className = source.state || '';
}

async function load() {
  try {
    const response = await fetch('/api/links');
    if (!response.ok) throw new Error('Local API unavailable');
    const data = await response.json();
    links = data.links || [];
    $('#poly-count').textContent = compact.format(data.counts.polymarket || 0);
    $('#kalshi-count').textContent = compact.format(data.counts.kalshi || 0);
    $('#link-count').textContent = compact.format(links.length);
    $('#candidate-count').textContent = compact.format(data.counts.candidates || 0);
    $('#status').textContent = data.scanning ? 'Catalog sync in progress…' : data.updatedAt ? `Last synced ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Ready to scan';
    setSource('poly', data.sources?.polymarket);
    setSource('kalshi', data.sources?.kalshi);
    const notice = $('#notice');
    notice.classList.toggle('hidden', !data.errors?.length);
    notice.innerHTML = data.errors?.length ? `<strong>Partial data</strong><span>${escapeHtml(data.errors.join(' · '))}</span>` : '';
    render();
  } catch (error) {
    $('#links').innerHTML = `<div class="empty"><strong>Connection interrupted</strong><p>${escapeHtml(error.message)}. Refresh to reconnect.</p></div>`;
  }
}

$('#confidence').addEventListener('change', render);
$('#search').addEventListener('input', render);
$('#scan').addEventListener('click', async ({ currentTarget }) => {
  currentTarget.disabled = true;
  await fetch('/api/scan', { method: 'POST' });
  await load();
  setTimeout(() => { currentTarget.disabled = false; load(); }, 3000);
});
load();
setInterval(load, 5000);
