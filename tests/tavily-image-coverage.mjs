// Mede quantas empresas encontradas pelo Tavily recebem imagem que combine com o nome.
// Uso (precisa da chave; não é executado no build):
//   TAVILY_API_KEY=tvly-... node tests/tavily-image-coverage.mjs "padaria" "Caruaru"
import { imageMatchesCompany } from '../api/search.js';

const key = process.env.TAVILY_API_KEY;
const niche = process.argv[2] || 'padaria';
const city = process.argv[3] || 'Caruaru';
if (!key) {
  console.error('Defina TAVILY_API_KEY antes de rodar.');
  process.exit(1);
}

const query = `${niche} ${city} telefone endereço site empresa`;
const r = await fetch('https://api.tavily.com/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    query,
    search_depth: 'fast',
    topic: 'general',
    max_results: 20,
    include_images: true,
    include_image_descriptions: true,
    include_favicon: true,
    include_answer: false,
    include_raw_content: false,
  }),
});
if (!r.ok) {
  console.error(`Tavily respondeu HTTP ${r.status}`);
  process.exit(1);
}
const payload = await r.json();
const results = Array.isArray(payload.results) ? payload.results : [];
const images = Array.isArray(payload.images) ? payload.images : [];

// Nome aproximado da empresa = primeiro trecho do título antes de separadores comuns.
const nameOf = t => String(t || '').split(/\s[-|–—:]\s|\|/)[0].trim();

let withImage = 0;
const rows = results.map(item => {
  const name = nameOf(item.title);
  const match = images.find(img => imageMatchesCompany(img, name));
  if (match) withImage++;
  return { name, site: item.url, image: match ? match.url : '' };
});

console.log(`Consulta: "${query}"`);
console.log(`Resultados: ${results.length} | Imagens recebidas: ${images.length}`);
console.log(`Com imagem que combina com o nome: ${withImage}/${results.length} (${results.length ? Math.round((100 * withImage) / results.length) : 0}%)`);
console.log('');
for (const row of rows) {
  console.log(`${row.image ? 'OK  ' : '---  '}${row.name || '(sem nome)'}  ${row.site}`);
}
