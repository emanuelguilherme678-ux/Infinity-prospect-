# Infinity Prospect — preparação da integração Cakto

Branch de destino planejada: `feature/cakto-subscriptions`. Este é um pacote candidato para revisão. Não foi possível escrever os arquivos diretamente no GitHub nesta sessão; eles ainda precisam ser adicionados à branch. Nada foi mesclado na `main`, publicado em produção ou aplicado no Supabase.

## Endpoint

Após revisão e publicação deliberada da branch, a URL de produção prevista é:

`https://infinity-prospect.vercel.app/api/cakto/webhook`

Ela **não estará funcionando na produção até que o código seja publicado**. Não a cadastre ainda como webhook ativo de produção.

## O que o receptor faz

- Recebe `POST /api/cakto/webhook`, limita o corpo e não armazena o JSON inteiro.
- Confere o `secret` do corpo e valida os cabeçalhos HMAC `X-Cakto-Timestamp` e `X-Cakto-Signature` quando presentes.
- Aceita `data` como objeto ou lista.
- Só considera `purchase_approved` e `subscription_renewed` para ativação, e só com status `paid`.
- Associa planos por IDs exatos de produto/oferta; não adivinha por nome.
- Usa RPC do Supabase com chave de serviço somente no servidor.
- Tem rascunho de idempotência no SQL para evitar ativação duplicada; essa parte ainda precisa de revisão e validação com o banco real.

## Variáveis de ambiente necessárias na Vercel

Configure como variáveis **server-side**, não no frontend nem com prefixo `NEXT_PUBLIC_`/`VITE_`:

- `CAKTO_WEBHOOK_SECRET` — segredo novo criado na configuração do webhook da Cakto.
- `SUPABASE_URL` — URL correta do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — chave de serviço; jamais a envie no chat ou coloque em `index.html`.
- Para mapear os produtos/ofertas, preencha pelo menos um ID exato para cada plano vendido:
  - Basic: `CAKTO_BASIC_PRODUCT_ID` e/ou `CAKTO_BASIC_OFFER_ID`
  - Pro: `CAKTO_PRO_PRODUCT_ID` e/ou `CAKTO_PRO_OFFER_ID`
  - Premium: `CAKTO_PREMIUM_PRODUCT_ID` e/ou `CAKTO_PREMIUM_OFFER_ID`
- IDs internos opcionais: `CAKTO_BASIC_PLAN_ID` (padrão `basico`), `CAKTO_PRO_PLAN_ID` (padrão `pro`), `CAKTO_PREMIUM_PLAN_ID` (padrão `premium`). Só use esses padrões após confirmar `public.plans.id` no banco real.

Use os IDs encontrados na área de produto/oferta da Cakto. O payload de teste genérico não corresponde necessariamente aos seus produtos. Se produto/oferta estiverem ambíguos, o sistema deve recusar a ativação em vez de escolher um plano por suposição.

## Eventos da Cakto

Selecionar os eventos que realmente serão utilizados:

- `purchase_approved`
- `subscription_renewed`
- `refund`
- `chargeback`
- `subscription_canceled`

O cancelamento/reembolso só pode revogar a assinatura que estiver associada aos identificadores externos correspondentes. Essa lógica ainda depende de revisão do SQL.

## Banco Supabase — bloqueio atual

`db/CAKTO_WEBHOOK_SQL_DRAFT.sql` é **somente um rascunho, não é migração formal e não foi executado**. O Supabase conectado apareceu como inativo e não foi possível ler as tabelas para confirmar o schema.

Antes de aplicar qualquer SQL:

1. A pessoa responsável deve entrar no painel do Supabase e confirmar/restaurar o projeto correto, se estiver pausado.
2. Confirmar a estrutura real de `plans` e `subscriptions`, os IDs dos planos e os índices/funções existentes.
3. Criar uma migração formal com `supabase migration new cakto_webhook`, adaptar/revisar o SQL com base no schema real e executar os testes PostgreSQL.
4. Aplicar ao banco somente após revisão humana e aprovação explícita. Não executar o rascunho diretamente no SQL Editor de produção.

## Correspondência de conta

O e-mail usado na compra da Cakto deve corresponder ao e-mail da conta criada no Infinity Prospect. Para testar a compra, crie/entre na conta antes do checkout. Se o usuário ainda não existir, o receptor retorna erro e não concede acesso automaticamente; corrija o e-mail/crie a conta e reenvie o webhook pela Cakto.

## Testes executados nesta branch

- `node --test tests/cakto-webhook.test.mjs` (Node 22): **15 testes passaram, 0 falharam**. Os testes usam mocks do RPC; não consultam a Cakto nem o Supabase.
- SQL (`db/CAKTO_WEBHOOK_SQL_DRAFT.sql`) aplicado em um PostgreSQL 16 **local e descartável**, com um schema-stub mínimo (`auth.users`, `auth.jwt()`, `plans`, `subscriptions`). Cenários verificados: aprovação, duplicata, renovação repetida, reembolso após aprovação, reembolso antes da aprovação (a aprovação vira `revoked`), cancelamento por ID de assinatura, usuário inexistente seguido de sucesso após criar a conta, divergência de preço de catálogo, plano inativo, moeda diferente de BRL, ID de compra inválido e chamada sem `service_role`. Todos se comportaram como esperado.
- **Não testado**: o schema real do Supabase de produção, a execução do SQL nele, a Cakto real (payload e assinatura reais) e a Vercel. Nada disso foi executado.

## Correções aplicadas em relação ao pacote original

- Cancelamentos (`subscription_canceled`) agora enviam `subscription.id` independentemente de `product.type`; antes, o cancelamento podia nunca encontrar a assinatura.
- O lock consultivo por compra passou a ser adquirido antes da leitura do evento no SQL.
- `vercel.json` manteve a rota `/dashboard` e a função `api/search.js`, e apenas acrescentou `api/cakto/webhook.mjs`.

## Pendências antes de ativar

1. Confirmar no Supabase real o schema de `plans` (`active`, `price_cents`) e `subscriptions`.
2. Criar a migração formal com `supabase migration new cakto_webhook`, revisada por uma pessoa, e só então aplicar. O arquivo em `db/` é rascunho.
3. Confirmar o formato real do payload e da assinatura da Cakto antes de exigir a assinatura HMAC (hoje ela é validada quando presente, e o segredo no corpo é obrigatório).
4. O RPC expira a assinatura ativa anterior do usuário ao aprovar uma nova. Verificar se isso conflita com o fluxo Asaas Pix já existente.
