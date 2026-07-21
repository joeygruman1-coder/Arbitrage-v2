const STOP = new Set('a an and are as at be before by does for from in is it of on or the to vs versus will with yes no who what which market event upcoming scheduled official officially that'.split(' '));
const MONTH = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
const MON3 = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};

export function normalizeText(value='') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/u\s*\.?\s*s\s*\.?|united states|usa/g,' us ')
    .replace(/new york/g,' ny ').replace(/california/g,' ca ').replace(/brazilian/g,' brazil ')
    .replace(/donald j\.? trump|donald trump/g,' trump ').replace(/joseph r\.? biden|joe biden/g,' biden ')
    .replace(/grand theft auto vi|gta vi/g,' gta6 ')
    .replace(/confirmed|confirms|confirmation/g,' confirm ')
    .replace(/released|releases/g,' release ').replace(/companies/g,' company ')
    .replace(/,/g,'').replace(/&/g,' and ').replace(/[^a-z0-9+.%$-]+/g,' ').replace(/\s+/g,' ').trim();
}
export function tokenSet(value='') { return new Set(normalizeText(value).split(/\s+/).filter(x=>x.length>1&&!STOP.has(x))); }
export function tokenJaccard(a,b) { a=a instanceof Set?a:tokenSet(a); b=b instanceof Set?b:tokenSet(b); if(!a.size||!b.size)return 0; let n=0; for(const x of a)if(b.has(x))n++; return n/(a.size+b.size-n); }
const first=(...v)=>{for(const x of v){const s=String(x??'').trim();if(s)return s;}return'';};
const dateISO=v=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null;};
const day=(y,m,d)=>new Date(Date.UTC(+y,+m-1,+d)).toISOString().slice(0,10);
const shift=(d,n)=>{const x=new Date(`${d}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
function boundary(text='') {
  const n=normalizeText(text);
  let m=n.match(/\b(before|by|through|until)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(20\d{2})\b/);
  if(m){const d=day(m[4],MONTH[m[2]],m[3]);return m[1]==='before'?shift(d,-1):d;}
  m=n.match(/\bbefore\s+(20\d{2})\b/); if(m)return day(+m[1]-1,12,31);
  m=n.match(/\b(?:by|through|until)\s+(20\d{2})\b/); if(m)return day(m[1],12,31);
  if(/\b(ipo|release|confirm|announce|exist)\b/.test(n)){m=n.match(/\bin\s+(20\d{2})\b/);if(m)return day(m[1],12,31);}
  return null;
}
function slugDate(id=''){const m=String(id).match(/(20\d{2})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;}
function tickerDate(id=''){const m=String(id).toUpperCase().match(/(?:^|-)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/);return m?day(2000+ +m[1],MON3[m[2]],m[3]):null;}
function nthSunday(y,mi,n){const f=new Date(Date.UTC(y,mi,1));return 1+((7-f.getUTCDay())%7)+(n-1)*7;}
function eastOffset(y,m,d){return (m>3||(m===3&&d>=nthSunday(y,2,2)))&&(m<11||(m===11&&d<nthSunday(y,10,1)))?4:5;}
function tickerTime(id=''){const m=String(id).toUpperCase().match(/(?:^|-)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{2})(\d{2})/);if(!m)return null;const y=2000+ +m[1],mo=MON3[m[2]],d=+m[3];return new Date(Date.UTC(y,mo-1,d,+m[4]+eastOffset(y,mo,d),+m[5])).toISOString();}
function parseJSON(v){if(Array.isArray(v))return v;if(typeof v!=='string')return[];try{const x=JSON.parse(v);return Array.isArray(x)?x:[];}catch{return[];}}
function sideName(s={}){const t=s.team||{},p=s.participant||{};return first(p.name,p.displayName,p.safeName,p.abbreviation,t.name,t.displayName,t.safeName,t.abbreviation,s.participantName,s.teamName,s.description,s.name,s.title,s.label,s.identifier);}
function isLong(s={}){return s.long===true||['YES','LONG','OUTCOME_SIDE_YES'].includes(String(s.outcomeSide||s.side||'').toUpperCase());}
function isShort(s={}){return s.long===false||['NO','SHORT','OUTCOME_SIDE_NO'].includes(String(s.outcomeSide||s.side||'').toUpperCase());}
function participants(text=''){
  const all=[...String(text).replace(/\?/g,' ').matchAll(/([A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5})\s+vs\.?\s+([A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,5})/g)];
  if(!all.length)return[]; const m=all.at(-1), stop=new Set(['UFC','Fight','Night','Winner','Total','Runs','Scheduled','Be','In']);
  const clean=x=>{const out=[];for(const w of String(x).trim().split(/\s+/)){if(stop.has(w)&&out.length)break;out.push(w);}return out.join(' ');};
  return [clean(m[1]),clean(m[2])].filter(Boolean);
}
const unique=v=>{const seen=new Set;return v.filter(Boolean).filter(x=>{const k=normalizeText(x);if(!k||seen.has(k))return false;seen.add(k);return true;});};
function sector(raw,text,sport){const n=normalizeText(`${raw.category||''} ${text} ${sport}`),id=String(raw.ticker||raw.id||'');if(sport||/\b(nfl|nba|mlb|nhl|wnba|soccer|football|baseball|basketball|hockey|tennis|golf|ufc|mma|esports|fight|game| vs )\b/.test(` ${n} `)||/(GAME|MATCH|TENNIS|GOLF|UFC)/i.test(id))return'sports';if(/\b(alien|science|space|fda|drug|vaccine|climate|temperature)\b/.test(n))return'science';if(/\b(election|president|governor|senate|congress|nominee|primary|republican|democrat|politic)\b/.test(n))return'politics';if(/\b(fed|inflation|gdp|recession|stock|ipo|interest rate|bitcoin|ethereum|crypto|unemployment)\b/.test(n))return'finance';if(/\b(oscar|grammy|emmy|nobel|award|movie|film|album|gta6)\b/.test(n))return'culture';return normalizeText(raw.category||'other')||'other';}
function kind(raw,text,id,sport){const n=normalizeText(`${sport} ${raw.marketType||''} ${text} ${id}`);if(/sports market type spread|\bspread\b|\bcover\b|\basc\b/.test(n))return'spread';if(/sports market type total|\btotal\b|over under|o\/u/.test(n))return'total';if(/sports market type prop|method of victory|\bwin by\b|set score|exact score|ko\/tko|ko tko|\bsubmission\b|\bstrikeouts\b/.test(n))return'prop';if(/\bdraw\b/.test(n)&&!/winner|moneyline/.test(n))return'draw';if(/sports market type moneyline|drawable outcome|\bmoneyline\b|\bwho will win\b|\bwinner\b|\bto win\b|\bnominee\b|\bwill .+ win\b|\baec\b/.test(n))return'winner';if(/\babove\b|\bbelow\b|more than|less than|at least|at most|reach|hit|exceed/.test(n))return'threshold';return'binary';}
function threshold(text,id,k){if(!['spread','total','threshold','prop'].includes(k))return null;const s=String(id).match(/(?:pos|neg)-(\d+)pt(\d+)/i);if(s)return +`${s[1]}.${s[2]}`;const n=normalizeText(text);if(k==='prop'&&/ko|submission|decision|method/.test(n))return null;for(const m of String(text).replace(/,/g,'').matchAll(/[+-]?\d+(?:\.\d+)?/g)){const x=Math.abs(+m[0]);if(Number.isFinite(x)&&!(x>=1900&&x<=2100))return x;}return null;}
function comparator(text,id,k){const n=normalizeText(`${text} ${id}`);if(/\bover\b|\babove\b|more than|at least|\bpos\b/.test(n))return'gt';if(/\bunder\b|\bbelow\b|less than|at most|\bneg\b/.test(n))return'lt';return k==='winner'?'eq':'';}
function segment(text){const n=normalizeText(text);for(const [r,v] of [[/first quarter|\bq1\b/,'q1'],[/second quarter|\bq2\b/,'q2'],[/first half|\b1h\b/,'first_half'],[/second half|\b2h\b/,'second_half']])if(r.test(n))return v;let m=n.match(/map\s*(\d+)/);if(m)return`map_${m[1]}`;m=n.match(/set\s*(\d+)/);if(m)return`set_${m[1]}`;return'full_event';}
function ordinal(text){const m=normalizeText(text).match(/(?:game|match|map|set)\s*(\d+)/);return m?+m[1]:null;}
function action(text){const n=normalizeText(text);if(/\bipo\b/.test(n))return/announce/.test(n)?'ipo_announce':/confirm/.test(n)?'ipo_confirm':'ipo_complete';if(/\brelease\b/.test(n))return'release';if(/aliens? exist/.test(n)&&/confirm/.test(n))return'confirm_alien_existence';return'';}
function propType(text){const n=normalizeText(text);if(/ko\/tko|ko tko|knockout/.test(n))return'ko_tko_dq';if(/\bsubmission\b/.test(n))return'submission';if(/decision.*draw.*no contest|go to a decision/.test(n))return'decision_draw_no_contest';if(/\bstrikeouts\b/.test(n))return'strikeouts';return'';}
function scope(text,k){if(!['prop','draw'].includes(k))return'';const n=normalizeText(text);if(/either competitor|fight result|go to a decision|draw no contest/.test(n))return'event';if(/\bwin by\b|\bby ko\b|\bby submission\b/.test(n))return'participant';return'';}
function subject(title,outcome){const o=normalizeText(outcome);if(outcome&&!boundary(outcome)&&!['yes','no','over','under','draw'].includes(o))return outcome;const n=normalizeText(title),m=n.match(/^(.+?)\s+(?:ipo|release|confirm)\b/);if(m)return m[1];if(/aliens? exist/.test(n))return'us aliens';return'';}
function normalize(raw,venue){
  const meta=raw.metadata&&typeof raw.metadata==='object'?raw.metadata:{}, id=String(raw.market_id||raw.marketId||raw.slug||raw.ticker||raw.id||'').trim();
  const title=first(raw.title,raw.question,raw.display_title,id), parentTitle=first(raw.parent_event_title,raw.parentEventTitle,raw.eventTitle,meta.eventTitle,raw.event?.title,raw.seriesTitle,title), subtitle=first(raw.subtitle,raw.titleShort,raw.yes_sub_title,raw.groupItemTitle);
  const sport=first(raw.sportsMarketType,meta.sportsMarketType,raw.market_sport_type,raw.sportsMarketTypeV2), sides=Array.isArray(raw.marketSides)?raw.marketSides:Array.isArray(raw.sides)?raw.sides:[], outs=parseJSON(raw.outcomes);
  let outcome=first(raw.outcome_label,raw.outcomeLabel,sideName(sides.find(isLong)),raw.yes_sub_title,raw.groupItemTitle,outs[0],subtitle); let oppositeOutcome=first(raw.opposite_outcome_label,raw.oppositeOutcomeLabel,sideName(sides.find(isShort)),raw.no_sub_title,outs[1]);
  if(!oppositeOutcome)oppositeOutcome=/\bover\b|above|more than/.test(normalizeText(`${outcome} ${title}`))?'Under':/\bunder\b|below|less than/.test(normalizeText(`${outcome} ${title}`))?'Over':'No';
  const people=unique([...(Array.isArray(raw.participants)?raw.participants:[]),...sides.map(sideName),...participants(parentTitle),...participants(title)]).filter(x=>!['yes','no','over','under','draw'].includes(normalizeText(x)));
  const providerTime=dateISO(first(raw.event_time,raw.eventTime,raw.gameStartTime,meta.gameStartTime,raw.startDate)), tickTime=venue==='kalshi'?tickerTime(id):null, eventTime=tickTime||providerTime;
  const text=`${title} ${parentTitle} ${subtitle} ${outcome} ${oppositeOutcome}`, sec=sector(raw,text,sport), contractKind=kind(raw,text,id,sport), bound=sec==='sports'?null:boundary(`${outcome} ${title} ${parentTitle} ${subtitle} ${id}`), date=sec==='sports'?(eventTime?.slice(0,10)||(venue==='kalshi'?tickerDate(id):slugDate(id))):(/\b(election|primary|award|prize)\b/.test(normalizeText(text))?(eventTime?.slice(0,10)||slugDate(id)):null);
  const subj=subject(title,outcome), eventTokens=tokenSet(`${parentTitle} ${title}`); for(const x of [...eventTokens])if(/^20\d{2}$/.test(x)||MONTH[x])eventTokens.delete(x);
  return {...raw,venue,id,title,parentTitle,subtitle,outcome,oppositeOutcome,subject:subj,participants:people,participantTokens:tokenSet(people.join(' ')),eventTokens,outcomeTokens:tokenSet(outcome),oppositeOutcomeTokens:tokenSet(oppositeOutcome),subjectTokens:tokenSet(subj),sector:sec,sportsType:sport,contractKind,propType:propType(text),selectionScope:scope(text,contractKind),resolutionAction:action(text),threshold:threshold(text,id,contractKind),comparator:comparator(text,id,contractKind),segment:segment(text),ordinal:ordinal(text),eventTime,eventTimeReliable:venue!=='kalshi'||Boolean(tickTime),closeTime:dateISO(first(raw.close_time,raw.closeTime,raw.endDate,raw.expiration_time)),date,boundaryDate:bound,eventId:first(raw.event_id,raw.eventId,raw.gameId,meta.gameId,raw.event?.id),seriesId:first(raw.series_id,raw.seriesId,meta.seriesId)};
}
export const normalizePolymarket=raw=>normalize(raw,'polymarket_us');
export const normalizeKalshi=raw=>normalize(raw,'kalshi');
export function marketToPublic(m){const{eventTokens,outcomeTokens,oppositeOutcomeTokens,participantTokens,subjectTokens,...safe}=m;return{...safe,participants:[...m.participants],eventTokenList:[...eventTokens],outcomeTokenList:[...outcomeTokens],participantTokenList:[...participantTokens],subjectTokenList:[...subjectTokens]};}
