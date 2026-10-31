# Guia de frontend — Infinity Prospect

Base: skill `frontend-ui-engineering`, adaptada à realidade do repositório `emanuelguilherme678-ux/infinity-prospect-` (branch `main`, commit `f1a8dfa`).

## 1. Stack atual (observada no repositório)

- Frontend em **HTML, CSS e JavaScript puros**, em um único `index.html` (~2,6 MB, com assets embutidos). Não há React, Vue ou build step.
- Funções serverless em `api/` (`api/search.js`, `api/cakto/webhook.mjs`), publicadas na Vercel.
- Supabase para dados e autenticação.
- Fonte Inter carregada do Google Fonts.
- Tema escuro com tokens CSS em `:root` (`--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--line`, `--radius`, etc.).

Implicação: as regras de componente da skill (arquivos colocalizados, hooks, React Query) não se aplicam diretamente. Mantenha a convenção atual: tokens em `:root`, classes com nomes claros e sem valores soltos de cor ou espaçamento.

## 2. Regras de design

- **Use os tokens existentes.** Cores, raios e sidebar já estão definidos. Não introduza hex novo dentro de componentes.
- **Escala de espaçamento consistente.** Use múltiplos de 4 px (0.25rem). Evite valores como `13px` ou `2.3rem`.
- **Hierarquia de títulos.** Um `h1` por tela, `h2` para seções, `h3` para subseções. Não pule níveis.
- **Evite o "visual de IA".** Nada de gradientes exagerados em todos os blocos, sombras pesadas em cada card, grade uniforme de cards sem prioridade de informação, nem texto de exemplo tipo lorem ipsum.
- **Cor nunca é o único indicador.** Status (pago, pendente, erro) precisa de texto ou ícone além da cor.
- **Contraste mínimo:** 4,5:1 para texto normal, 3:1 para texto grande. Verifique especialmente `--muted` (#938da8) sobre `--surface` e `--bg`.

## 3. Acessibilidade (WCAG 2.1 AA)

- Todo elemento interativo deve ser `<button>` ou `<a>`. Hoje a contagem de `<div onclick>` está em zero, o que é bom; mantenha assim.
- Botões só com ícone precisam de `aria-label`.
- Inputs precisam de `<label>` associado ou `aria-label`.
- Ao abrir um diálogo ou painel, mova o foco para dentro dele e devolva o foco ao gatilho ao fechar.
- Estados de foco visíveis: o projeto já tem 3 ocorrências de `focus-visible`. Confirme que todos os controles interativos têm um foco visível.
- Respeite `prefers-reduced-motion` (já há regra global no `index.html`; mantenha para novas animações).
- Imagens precisam de `alt`. A varredura não encontrou `<img>` sem `alt`.

Pontos a verificar (não confirmados nesta leitura):
- Há **14 ocorrências de `<h1>`** no arquivo. Podem estar dentro de strings de template ou de telas ocultas. Se houver mais de um `h1` visível ao mesmo tempo, corrija.
- Há 9 `aria-label` e 3 `role=`. Confirme que os alvos cobrem os controles de ícone da sidebar e dos modais.

## 4. Responsividade

Breakpoints já usados no projeto: 430, 520, 560, 640, 700, 760, 1000, 1080 e 1100 px. Isso é muitos pontos de quebra. Ao criar algo novo, use no máximo dois ou três (por exemplo, 640 px e 1024 px) e reaproveite os existentes.

Teste em 320, 768, 1024 e 1440 px. Garanta que não haja rolagem horizontal no celular e que a sidebar (`--sbw: 264px`) colapse abaixo do breakpoint definido.

## 5. Estados obrigatórios em telas com dados

Toda tela que busca dados precisa tratar:
- **Carregando:** skeleton com `role="status"` e `aria-busy="true"`, não spinner no lugar do conteúdo.
- **Vazio:** mensagem clara e uma ação principal (por exemplo, "Nenhuma empresa encontrada. Tente outro nicho ou cidade.").
- **Erro:** mensagem em texto e botão para tentar de novo.
- **Sucesso** e **sem permissão** (por exemplo, a ação de aprovar pagamento exige administrador).

## 6. Checklist antes de publicar uma tela

- [ ] Sem erros no console do navegador
- [ ] Navegação completa só com teclado (Tab, Enter, Esc)
- [ ] Leitor de tela anuncia título, status e botões corretamente
- [ ] Funciona em 320, 768, 1024 e 1440 px
- [ ] Estados de carregamento, vazio, erro, sucesso e permissão tratados
- [ ] Usa tokens e escala de espaçamento do projeto
- [ ] axe-core ou ferramenta equivalente sem alertas críticos

## 7. Próximos passos sugeridos

1. Revisar os 14 `h1` e os controles sem rótulo.
2. Consolidar os breakpoints em dois ou três.
3. Rodar axe-core na página publicada e registrar os resultados.
