/**
 * Prime Sync — Cron automático
 * GET /api/cron-sync?secret=SEU_SEGREDO
 *
 * Faz o mesmo trabalho que o botão "Sincronizar tudo" do site, mas roda
 * sozinho — pra ser chamado por um agendador externo (cron-job.org) de
 * tempos em tempos. A deduplicação não depende mais do navegador: cada
 * Apps Script agora checa o Card ID antes de gravar, então mesmo que o
 * mesmo card apareça em duas execuções seguidas, não duplica na planilha.
 *
 * Configuração no cron-job.org:
 *   URL: https://SEU-DOMINIO.vercel.app/api/cron-sync?secret=Tg5_buQbkFeMPn05MUCvEtUVP2KyweJo
 *   Intervalo: a cada 2–5 minutos
 *   Método: GET
 */

const CRON_SECRET = 'Tg5_buQbkFeMPn05MUCvEtUVP2KyweJo';

const TRELLO_KEY   = '97afcc00de05c98554fc78eeee132d0a';
const TRELLO_TOKEN = 'ATTAda0170c83e12dfe5aa231df3ffdacc1f0491a3b18ca0f02bef6366459c08f3d20572412F';

const BOARDS = {
  balzani: {
    board: '0ERCXChY',
    listId: '69d909fa3a907679b3c12295', // lista "LEAD NOVO" — fixo, já não muda
    scriptUrl: 'https://script.google.com/macros/s/AKfycbx2-UVscCVQSSUxW3295V5oDiEaKX1Bvj3rOJkUIf-u1YkqZHS0zzUtwbiQ4hXTyoK9/exec',
    parse: parseStandard,
    payload: l => ({ nome: l.firstName, loteamento: l.code, telefone: l.phone, cardId: l.id })
  },
  cbii: {
    board: '6a723e5ac2393c5abb4f7a0f',
    listId: '6a723e6c4e671cc5ca104614', // lista "LEAD NOVO" — fixo, já não muda
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyx57S0nGXwt9TPhKuujKlmQT2B0Qelz1AQxy76molmoZ3-tqUdS-SYG_dfQ4nCuZwtvA/exec',
    parse: parseCbii,
    payload: l => ({ nome: l.firstName, loteamento: 'CBII', telefone: l.phone, origem: 'Facebook PT', cardId: l.id, campanha: l.campanha || '', conjuntoAnuncios: l.conjuntoAnuncios || '', criativo: l.criativo || '' })
  },
  prime: {
    board: '818YF3D6',
    listId: '6a7b0e12be5ebebf1e2c8c81', // lista "LEAD NOVO" — fixo, já não muda
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyIMEtQoXS7NKIT22X9eWfM07leL95oLtHZYcshfrYTi9hiNCziXu4QoJl79BRoDqT2/exec',
    parse: parsePrime,
    payload: l => ({ nome: l.firstName, interesse: l.code, telefone: l.phone, origem: l.origem, cardId: l.id })
  }
};

// ─── Empreendimentos (mesma lista do site) ─────────────────────────────────
const EMPREENDIMENTOS = [
  { label: 'Caminho das Árvores — S. Gonçalo', code: 'RR',  match: ['são gonçalo','sao goncalo','s. gonçalo','gonçalo','s gonçalo'] },
  { label: 'Caminho das Árvores — Cachoeira',  code: 'CAC', match: ['caminho das arvores cachoeira','caminho das árvores cachoeira','arvores cachoeira','árvores cachoeira'] },
  { label: 'Bom Viver — Conceição da Feira',   code: 'VM1', match: ['conceição','conceicao','bom viver conceição','bom viver conceicao'] },
  { label: 'Belém Cachoeira',                  code: 'BLC', match: ['belém cachoeira','belem cachoeira','belém','belem'] },
  { label: 'Masterville',                      code: 'MVE', match: ['masterville'] },
  { label: 'Alta Vista',                       code: 'AV',  match: ['alta vista','altavista'] },
  { label: 'Bom Viver — Campo Formoso',        code: 'BI',  match: ['bom viver','bomviver'] },
];

function stripAccents(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function detectLot(text) {
  const hay = stripAccents(text);
  const hayOrig = (text || '').toLowerCase();
  for (const emp of EMPREENDIMENTOS) {
    for (const term of emp.match) {
      if (hay.includes(stripAccents(term)) || hayOrig.includes(term)) return emp;
    }
  }
  return { label: 'Outro', code: 'OUTRO' };
}

function extractEmpCode(card) {
  for (const line of (card.desc || '').split('\n')) {
    const m = line.match(/^\s*empreendimento\s*:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return '';
}

function detectLotForPrime(card) {
  const raw = extractEmpCode(card);
  if (raw) {
    const rawUp = raw.toUpperCase();
    const found = EMPREENDIMENTOS.find(e => e.code.toUpperCase() === rawUp);
    if (found) return found;
    return { label: raw, code: rawUp };
  }
  return detectLot((card.name || '') + ' ' + (card.desc || ''));
}

function formatPhone(n) {
  if (n.length === 11) return `(${n.slice(0,2)}) ${n[2]}${n.slice(3,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return n;
}

function extractPhone(card) {
  for (const line of (card.desc || '').split('\n')) {
    const up = line.toUpperCase();
    if ((up.includes('WHATSAPP:') || up.includes('TELEFONE:') || up.includes('FONE:') || up.includes('CELULAR:')) && !up.includes('DIRETO')) {
      const n = line.replace(/[^0-9]/g, '').replace(/^55/, '');
      if (n) return formatPhone(n);
    }
  }
  const hay = (card.name || '') + ' ' + (card.desc || '');
  const m = hay.match(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/);
  if (m) return formatPhone(m[0].replace(/[^0-9]/g, '').replace(/^55/, ''));
  return '';
}

const ORIGEM_MAP = {
  'canal pro': 'Canal Pro', 'chaves na mao': 'Chaves na Mão', 'olx': 'OLX',
  'viva real': 'Viva Real', 'zap': 'Zap Imóveis', 'zap imoveis': 'Zap Imóveis',
  'whatsapp': 'WhatsApp', 'facebook': 'Facebook', 'instagram': 'Instagram',
  'chat bot': 'Chat Bot', 'chatbot': 'Chat Bot', 'site': 'Site', 'indicacao': 'Indicação'
};
function detectOrigem(card) {
  if (card.labels && card.labels.length) {
    const raw = card.labels[0].name || '';
    const key = stripAccents(raw).trim();
    if (ORIGEM_MAP[key]) return ORIGEM_MAP[key];
    if (raw.trim()) return raw.trim();
  }
  const hay = stripAccents((card.name || '') + ' ' + (card.desc || ''));
  for (const k in ORIGEM_MAP) { if (hay.includes(k)) return ORIGEM_MAP[k]; }
  return 'Outro';
}

function firstNameOf(card) {
  const raw = card.name || '';
  return raw.split(/[\s|–\-]/)[0].replace(/[^\wÀ-ú]/g, '').trim() || raw.slice(0, 10);
}

function extractCampanha(card) {
  for (const line of (card.desc || '').split('\n')) {
    const m = line.match(/^\s*\**campanha\**\s*:\s*(.+)$/i);
    if (m) return m[1].replace(/\*/g, '').trim();
  }
  return '';
}

function extractConjuntoAnuncios(card) {
  for (const line of (card.desc || '').split('\n')) {
    const m = line.match(/^\s*\**conjunto de an[uú]ncios\**\s*:\s*(.+)$/i);
    if (m) return m[1].replace(/\*/g, '').trim();
  }
  return '';
}

function extractCriativo(card) {
  for (const line of (card.desc || '').split('\n')) {
    const m = line.match(/^\s*\**criativo\**\s*:\s*(.+)$/i);
    if (m) return m[1].replace(/\*/g, '').trim();
  }
  return '';
}

function parseStandard(card) {
  const firstName = firstNameOf(card);
  const emp = detectLot((card.name || '') + ' ' + (card.desc || ''));
  return { id: card.id, firstName, code: emp.code, phone: extractPhone(card) };
}

function parseCbii(card) {
  const firstName = firstNameOf(card);
  return {
    id: card.id,
    firstName,
    code: 'CBII',
    phone: extractPhone(card),
    campanha: extractCampanha(card),
    conjuntoAnuncios: extractConjuntoAnuncios(card),
    criativo: extractCriativo(card)
  };
}

function parsePrime(card) {
  const firstName = firstNameOf(card);
  const emp = detectLotForPrime(card);
  return { id: card.id, firstName, code: emp.code, phone: extractPhone(card), origem: detectOrigem(card) };
}

async function listId(boardId) {
  const r = await fetch(`https://api.trello.com/1/boards/${boardId}/lists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
  if (!r.ok) throw new Error(`Trello lists ${r.status}`);
  const lists = await r.json();
  const found = lists.find(l => l.name.toUpperCase().includes('LEAD NOVO'));
  if (!found) throw new Error('Lista "LEAD NOVO" não encontrada.');
  return found.id;
}

async function getCards(lid) {
  const r = await fetch(`https://api.trello.com/1/lists/${lid}/cards?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&fields=name,desc,labels`);
  if (!r.ok) throw new Error(`Trello cards ${r.status}`);
  return r.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function attemptSend(cfg, lead) {
  const first = await fetchWithTimeout(cfg.scriptUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg.payload(lead))
  }, 8000);

  let finalText;
  if (first.status === 302 || first.status === 303 || first.status === 301) {
    const location = first.headers.get('location');
    if (!location) throw new Error(`Redirect ${first.status} sem header location`);
    const second = await fetchWithTimeout(location, { method: 'GET' }, 8000);
    finalText = await second.text();
  } else {
    finalText = await first.text();
  }

  let parsed;
  try { parsed = JSON.parse(finalText); }
  catch (e) { throw new Error('Resposta não é JSON: ' + finalText.slice(0, 150)); }
  return parsed;
}

// O Google às vezes serve uma página intermediária em vez do JSON esperado
// (falha momentânea do lado dele). Como o dedup por Card ID já protege
// contra duplicidade, é seguro tentar de novo em vez de desistir na hora.
async function warnOnCard(cardId, message) {
  try {
    // Evita spam: só comenta se ainda não tiver um aviso nosso nesse card.
    const commentsRes = await fetch(
      `https://api.trello.com/1/cards/${cardId}/actions?filter=commentCard&key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`
    );
    const comments = await commentsRes.json();
    const already = Array.isArray(comments) && comments.some(c =>
      c.data && c.data.text && c.data.text.includes('⚠️ Falha ao sincronizar')
    );
    if (already) return;

    await fetch(
      `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message })
      }
    );
  } catch (e) {
    // Silencioso de propósito — um aviso que falha não pode derrubar o fluxo principal.
  }
}

async function sendLead(cfg, lead) {
  const MAX_TRIES = 2;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const parsed = await attemptSend(cfg, lead);
      if (parsed.status === 'duplicate') return { outcome: 'duplicate', leadId: lead.id };
      if (parsed.status === 'ok') return { outcome: 'ok', leadId: lead.id };
      lastError = parsed.message || JSON.stringify(parsed);
    } catch (e) {
      lastError = e.message;
    }
    if (attempt < MAX_TRIES) await sleep(250);
  }

  const warnMsg = `⚠️ Falha ao sincronizar com a planilha (Prime Sync)\n\nEsse card tentou ser enviado ${MAX_TRIES}x e não conseguiu.\nMotivo: ${lastError}\n\nVerifique manualmente ou avise o responsável pelo sistema.`;
  await warnOnCard(lead.id, warnMsg);

  return { outcome: 'fail', reason: `Após ${MAX_TRIES} tentativas: ${lastError}`, leadId: lead.id };
}

async function syncOne(id, cfg) {
  const cards = await getCards(cfg.listId);
  const leads = cards.map(cfg.parse);

  const outcomes = await Promise.all(leads.map(lead => sendLead(cfg, lead)));

  const ok  = outcomes.filter(o => o.outcome === 'ok').length;
  const dup = outcomes.filter(o => o.outcome === 'duplicate').length;
  const failures = outcomes.filter(o => o.outcome === 'fail');

  return {
    board: id,
    boardId: cfg.board,
    scriptUrlUsed_last12: cfg.scriptUrl.slice(-12), // raio-x: confirma qual URL foi usada de verdade
    total: leads.length,
    sent: ok,
    duplicates: dup,
    failed: failures.length,
    failureReasons: failures.map(f => ({ leadId: f.leadId, reason: f.reason }))
  };
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Os 3 boards também rodam em paralelo entre si.
  const entries = Object.entries(BOARDS);
  const settled = await Promise.all(entries.map(([id, cfg]) =>
    syncOne(id, cfg).catch(e => ({ board: id, error: e.message }))
  ));

  const results = {};
  entries.forEach(([id], i) => { results[id] = settled[i]; });

  return res.status(200).json({ status: 'done', timestamp: new Date().toISOString(), results });
}
