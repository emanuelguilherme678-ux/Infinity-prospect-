/* Infinity Prospect — Vercel search endpoint (Tavily)
 * Secrets live only in Vercel Environment Variables.
 * Expected env:
 *   TAVILY_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY
 */

const MAX_TAVILY_RESULTS = 20;
const MAX_CLIENT_RESULTS = 6;
const MAX_QUERY_CHARS = 390;

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');

function json(res, status, payload) {
  return res.status(status).json(payload);
}

function clean(value, max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSocialHost(host) {
  return /(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)linkedin\.com$|(^|\.)tiktok\.com$|(^|\.)youtube\.com$|(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host);
}

function isDirectoryHost(host) {
  return /(^|\.)google\.[^/]+$|(^|\.)google\.com$|(^|\.)maps\.apple\.com$|(^|\.)yelp\.[^/]+$|(^|\.)tripadvisor\.[^/]+$|(^|\.)foursquare\.com$|(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)linkedin\.com$|(^|\.)guias\.|(^|\.)telelistas\.|(^|\.)solutudo\.com\.br$|(^|\.)cnpj\.biz$/.test(host);
}

function extractPhone(text) {
  const m = String(text || '').match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\d{4}|\d{4})[-.\s]?\d{4}/);
  return m ? clean(m[0], 40) : '';
}

function extractInstagram(text) {
  const m = String(text || '').match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.-]+/i);
  return m ? m[0] : '';
}

function extractAddress(text) {
  const source = String(text || '');
  const m = source.match(/\b(?:Rua|R\.|Avenida|Av\.|Alameda|Travessa|Tv\.|Rodovia|Rod\.|Estrada|Praça|Largo)\s+[^\n.;|]{5,130}/i);
  return m ? clean(m[0], 150) : '';
}

function deriveName(title, url) {
  const t = clean(title, 140)
    .replace(/\s*\|.*$/,'')
    .replace(/\s+[-–—]\s+.*$/,'')
    .replace(/^\d+\s*[-.)]\s*/, '');
  if (t && t.length >= 3) return t;
  const host = hostOf(url);
  return host ? host.split('.')[0].replace(/[-_]+/g, ' ') : 'Empresa encontrada';
}

function tokenize(value) {
  return clean(value, 180)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3);
}

function imageMatchesCompany(image, companyName) {
  if (!image || !companyName) return false;
  const text = [image.url, image.description, image.title, image.alt].filter(Boolean).join(' ');
  const hay = tokenize(text);
  const wanted = [...new Set(tokenize(companyName))];
  if (!wanted.length) return false;
  const hits = wanted.filter(w => hay.includes(w)).length;
  if (wanted.length <= 2) return hits === wanted.length;
  return hits / wanted.length >= 0.6 || wanted.slice(0,2).every(w => hay.includes(w));
}

function likelyArticle(title, content, url) {
  const text = `${title} ${content}`.toLowerCase();
  const host = hostOf(url);
  if (/^(10|15|20|25|30)\b/.test(clean(title,100))) return true;
  if (/top\s+\d+|melhores|melhor|lista|ranking|not[ií]cias?|blog|artigo|como escolher|o que [eé]|pre[cç]os?/.test(text)) return true;
  return isDirectoryHost(host) && /\/(blog|noticias|article|articles|lista|ranking)\b/i.test(url);
}

function businessScore(result, niche, city) {
  const title = clean(result.title, 180);
  const content = clean(result.content, 360);
  const url = clean(result.url, 500);
  const host = hostOf(url);
  const hay = `${title} ${content} ${url}`.toLowerCase();
  let score = 0;
  if (niche && hay.includes(String(niche).toLowerCase())) score += 3;
  if (city && hay.includes(String(city).toLowerCase())) score += 4;
  if (extractPhone(`${title} ${content}`)) score += 2;
  if (extractAddress(`${title} ${content}`)) score += 2;
  if (/instagram\.com/i.test(content)) score += 1;
  if (!isSocialHost(host) && !isDirectoryHost(host)) score += 2;
  if (likelyArticle(title, content, url)) score -= 5;
  return score;
}

async function validateSupabaseToken(token) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, status: 500, message: 'Supabase não configurado no servidor. Adicione SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY na Vercel.' };
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return { ok: false, status: 401, message: 'Sessão inválida ou expirada.' };
    const user = await r.json();
    return { ok: true, user };
  } catch {
    return { ok: false, status: 502, message: 'Não foi possível validar a sessão agora.' };
  }
}

async function searchTavily(query) {
  const key = String(process.env.TAVILY_API_KEY || '');
  if (!key) return { ok: false, status: 500, message: 'TAVILY_API_KEY não configurada na Vercel.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'fast',
        topic: 'general',
        max_results: MAX_TAVILY_RESULTS,
        include_images: true,
        include_image_descriptions: true,
        include_favicon: true,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const message = r.status === 429
        ? 'Limite do Tavily atingido. Tente novamente em alguns instantes.'
        : clean(data?.detail || data?.message || `Tavily respondeu HTTP ${r.status}.`, 220);
      return { ok: false, status: r.status, message };
    }
    return { ok: true, data };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, status: 504, message: 'A busca demorou demais. Tente novamente.' };
    return { ok: false, status: 502, message: 'Não foi possível consultar o Tavily agora.' };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResults(payload, niche, city) {
  const raw = Array.isArray(payload?.results) ? payload.results : [];
  const images = Array.isArray(payload?.images) ? payload.images : [];
  const seen = new Set();
  const normalized = [];

  for (const item of raw) {
    const url = clean(item?.url, 600);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const host = hostOf(url);
    const title = clean(item?.title || '', 160);
    const content = clean(item?.content || item?.snippet || '', 420);
    const name = deriveName(title, url);
    const key = `${name.toLowerCase()}|${host}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mergedText = `${title}\n${content}`;
    const phone = extractPhone(mergedText);
    const instagram = extractInstagram(mergedText);
    const address = extractAddress(mergedText);
    const social = isSocialHost(host);
    const directory = isDirectoryHost(host);
    if (likelyArticle(title, content, url)) continue;
    const score = businessScore(item, niche, city);
    if (score < 1) continue;

    let site = '';
    let siteType = 'web';
    if (!social && !directory) {
      site = url;
      siteType = 'site';
    } else if (social) {
      siteType = 'social';
    } else {
      siteType = 'directory';
    }

    let matchedImage = null;
    for (const image of images) {
      if (imageMatchesCompany(image, name)) {
        matchedImage = image;
        break;
      }
    }

    const mapsQuery = encodeURIComponent([name, address, city, 'Brasil'].filter(Boolean).join(', '));
    normalized.push({
      name,
      address,
      tel: phone,
      phone,
      instagram,
      site,
      siteType,
      status: 'found',
      nicho: clean(niche, 100),
      cidade: clean(city, 100),
      estado: '',
      maps: mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : '',
      rating: null,
      reviews: null,
      context: content,
      sourceUrl: url,
      sourceTitle: title,
      image: matchedImage?.url || '',
      imageDescription: matchedImage?.description || matchedImage?.title || '',
      favicon: item?.favicon || '',
      relevance: Number(item?.score || 0),
      businessScore: score,
    });
  }

  normalized.sort((a,b) => (b.businessScore + b.relevance) - (a.businessScore + a.relevance));
  return normalized.slice(0, MAX_CLIENT_RESULTS);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return json(res, 405, { ok: false, message: 'Método não permitido.' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token) return json(res, 401, { ok: false, message: 'Autenticação necessária.' });

  const authResult = await validateSupabaseToken(token);
  if (!authResult.ok) return json(res, authResult.status, { ok: false, message: authResult.message });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nicho = clean(body.nicho, 100);
  const cidade = clean(body.cidade, 100);
  const servico = clean(body.servico, 100);
  const explicitQuery = clean(body.query, MAX_QUERY_CHARS);

  if (!nicho || !cidade) {
    return json(res, 400, { ok: false, message: 'Informe o nicho e a cidade para pesquisar.' });
  }

  const query = clean(
    explicitQuery || `${nicho} em ${cidade}, Brasil${servico ? ` ${servico}` : ''} empresas endereço telefone site Instagram`,
    MAX_QUERY_CHARS
  );

  const result = await searchTavily(query);
  if (!result.ok) return json(res, result.status, { ok: false, message: result.message });

  const data = normalizeResults(result.data, nicho, cidade);
  return json(res, 200, { ok: true, data, meta: { count: data.length, authenticatedUser: !!authResult.user?.id } });
}
