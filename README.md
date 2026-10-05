Infinity Prospect — V52 Vercel Ready

Pacote de publicação baseado no frontend V51, com endpoint "/api/search" para Tavily no Vercel.

Arquivos principais

- "index.html" — frontend V51 consolidado.
- "api/search.js" — busca autenticada via Tavily, com a chave somente no servidor.
- "vercel.json" — rota "/dashboard" e configuração da Function.
- "brand-logo.svg" — asset de marca.
- "analytics-config.js" — placeholder opcional.
- "llms.txt" — contexto público básico.

Variáveis necessárias na Vercel

- "TAVILY_API_KEY"
- "SUPABASE_URL"
- "SUPABASE_PUBLISHABLE_KEY"

Não coloque chaves dentro do "index.html".
