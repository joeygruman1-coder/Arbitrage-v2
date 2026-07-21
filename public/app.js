let matches = [];
let minimum = 0;
let category = 'all';

const money = new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 });
const escapeHtml = (text = '') => String(text).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function price(value) { return value ? `${Math.round(value * 100)}¢` : '—'; }

function render() {
  const sort = document.querySelector('#sort').value;
  const visible = matches.filter((match) => match.score >= minimum && (category === 'all' || match.arbitrage?.category === category)).sort((a, b) => sort === 'volume'
    ? (b.polymarket.volume + b.kalshi.volume) - (a.polymarket.volume + a.kalshi.volume)
    : b.score - a.score);
  const list = document.querySelector('#match-list');
  if (!visible.length) {
    list.innerHTML = '<div class="empty"><b>No matches cleared this filter.</b><p>Try “All matches” or refresh as new markets open.</p></div>';
    return;
  }
  list.innerHTML = visible.map((match, index) => {
    const confidence = Math.round(match.score * 100);
    const arb = match.arbitrage || {};
    const arbLabel = { profitable: 'Profitable after fees', fee_blocked: 'Under $1, fees remove profit', overpriced: 'Over $1', unpriced: 'Quotes unavailable' }[arb.category] || 'Quotes unavailable';
    return `<article class="match-card" style="--delay:${Math.min(index * 45, 300)}ms">
      <div class="confidence"><div class="ring" style="--score:${confidence}"><span>${confidence}%</span></div><small>match<br>confidence</small></div>
      <div class="pair">
        ${market(match.polymarket, 'poly', 'Polymarket')}
        <div class="link-line"><span>⇄</span></div>
        ${market(match.kalshi, 'kalshi', 'Kalshi')}
        <div class="arb-summary"><b>${arbLabel}</b><span>${escapeHtml(arb.direction || '')}</span><span>Net cost ${price(arb.netCost)} · Profit ${price(arb.profit)}</span></div>
      </div>
    </article>`;
  }).join('');
}

function market(item, type, label) {
  return `<a class="market" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
    <div class="market-top"><span class="exchange ${type}"><i></i>${label}</span><span class="external">↗</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <div class="market-meta"><span><small>YES ASK</small>${price(item.yesAsk)}</span><span><small>NO ASK</small>${price(item.noAsk)}</span><span><small>24H VOLUME</small>${money.format(item.volume)}</span></div>
  </a>`;
}

async function load() {
  const button = document.querySelector('#refresh');
  button.disabled = true; button.textContent = '↻  Scanning…';
  try {
    const response = await fetch('/api/markets');
    if (!response.ok) throw new Error('The market feed did not respond.');
    const data = await response.json();
    matches = data.matches;
    document.querySelector('#poly-count').textContent = data.counts.polymarket;
    document.querySelector('#kalshi-count').textContent = data.counts.kalshi;
    document.querySelector('#match-count').textContent = matches.length;
    document.querySelector('#updated').textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const notice = document.querySelector('#notice');
    notice.classList.toggle('hidden', !data.errors.length);
    notice.textContent = data.errors.length ? `One source is temporarily unavailable: ${data.errors.join(' · ')}` : '';
    render();
  } catch (error) {
    document.querySelector('#match-list').innerHTML = `<div class="empty"><b>We couldn't load live markets.</b><p>${escapeHtml(error.message)} Check your internet connection, then try again.</p></div>`;
  } finally { button.disabled = false; button.textContent = '↻  Refresh data'; }
}

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); minimum = Number(button.dataset.min); render();
}));
document.querySelectorAll('.category').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.category').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); category = button.dataset.category; render();
}));
document.querySelector('#sort').addEventListener('change', render);
document.querySelector('#refresh').addEventListener('click', async () => { await fetch('/api/scan', { method: 'POST' }); setTimeout(load, 1000); });
load();
setInterval(load, 30000);
