let links = [];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const volume = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function marketCard(market, exchange) {
  return `<a class="market" href="${escapeHtml(market.url)}" target="_blank" rel="noopener noreferrer">
    <div class="source ${exchange.toLowerCase()}"><i></i>${exchange}<span>OPEN ↗</span></div>
    <h3>${escapeHtml(market.title)}</h3>
    <p>${market.closeTime ? `Closes ${new Date(market.closeTime).toLocaleDateString()}` : 'Close date unavailable'} · ${volume.format(market.volume || 0)} volume</p>
  </a>`;
}

function render() {
  const filter = document.querySelector('#confidence').value;
  const visible = links.filter((link) => filter === 'all' || link.status === filter);
  document.querySelector('#links').innerHTML = visible.length ? visible.map((link) => `<article class="link-card">
    <div class="score"><strong>${link.confidence}%</strong><span>${link.status === 'high' ? 'HIGH CONFIDENCE' : 'REVIEW'}</span></div>
    <div class="pair">${marketCard(link.polymarket, 'Polymarket')}<div class="connector"><span>↔</span></div>${marketCard(link.kalshi, 'Kalshi')}</div>
    <p class="reason">Why it was linked: ${escapeHtml(link.explanation)}</p>
  </article>`).join('') : '<div class="empty">No links match this filter yet.</div>';
}

async function load() {
  try {
    const response = await fetch('/api/links');
    if (!response.ok) throw new Error('The local server did not respond.');
    const data = await response.json();
    links = data.links || [];
    document.querySelector('#poly-count').textContent = data.counts.polymarket.toLocaleString();
    document.querySelector('#kalshi-count').textContent = data.counts.kalshi.toLocaleString();
    document.querySelector('#link-count').textContent = links.length.toLocaleString();
    document.querySelector('#status').textContent = data.scanning ? 'Scanning all open markets…' : data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : 'Waiting for first scan…';
    const notice = document.querySelector('#notice');
    notice.classList.toggle('hidden', !data.errors?.length);
    notice.textContent = data.errors?.length ? `A source could not be read: ${data.errors.join(' · ')}` : '';
    render();
  } catch (error) {
    document.querySelector('#links').innerHTML = `<div class="empty">${escapeHtml(error.message)} Try refreshing this page.</div>`;
  }
}

document.querySelector('#confidence').addEventListener('change', render);
document.querySelector('#scan').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  await fetch('/api/scan', { method: 'POST' });
  await load();
  setTimeout(() => { event.currentTarget.disabled = false; load(); }, 2500);
});
load();
setInterval(load, 5000);
