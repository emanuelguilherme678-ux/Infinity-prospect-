# Direção visual — Infinity Prospect

Complemento do guia de frontend. Aplica a skill `frontend-design` ao briefing do produto.

## Briefing e assunto

- Produto: ferramenta de prospecção B2B. Encontra empresas com potencial que ainda não têm site, estima o preço de um site e a chance de fechar a venda, e gera a abordagem de contato.
- Público: desenvolvedores e pessoas que vendem sites feitos com IA para pequenos negócios. Usam a ferramenta com frequência, quase sempre no computador, para trabalhar uma lista.
- Trabalho principal da tela: decidir quem abordar primeiro. A lista de oportunidades ordenada por potencial é o centro do produto.
- Matéria-prima do assunto: fichas de empresa, endereços, nichos, avaliações, sinais de que o negócio não tem site. É um ofício de pesquisa comercial, não de consumo.

## Ponto de partida que não vou trocar

A marca já existe no repositório: fundo escuro `#0b0a10`, acento `#a557ff`, fonte Inter. Essa é a identidade atual e deve ser preservada. Uma reformulação completa não foi pedida.

Ao revisar contra o briefing, a combinação de fundo escuro com acento roxo é um dos padrões genéricos de interface. Por isso, a decisão é mantê-la como âncora de marca e reduzir o uso do roxo a um único elemento, não espalhá-lo em botões, bordas e ícones.

## Plano (primeira passagem)

**Cor (6 valores nomeados)**
- `fundo` #0b0a10: base escura atual.
- `superfície` #141220: linhas e painéis.
- `texto` #f3f1f9: texto principal.
- `muted` #938da8: texto secundário. Verificar contraste sobre superfície antes de usar em corpo.
- `acento` #a557ff: uso restrito, apenas no elemento de destaque (ver "elemento memorável").
- `sinal` #3ecf8a: verde para "boa chance de fechar". Usar sempre junto de texto.

**Tipografia**
- Uma família só. Manter Inter para corpo e interface, para não quebrar a identidade atual.
- Números em alinhamento tabular (`font-variant-numeric: tabular-nums`) em colunas de preço e probabilidade. Isso faz a ferramenta parecer uma planilha bem feita, que é o que o público espera.
- Sem título em caixa-alta, sem rótulo acima de título, sem uso de monoespaçada para "dados".

**Layout**
- Conceito: uma lista ordenada de oportunidades no lugar de grade de cards. Cada linha mostra empresa, nicho, cidade, potencial, preço estimado, chance de fechar. Um painel lateral mostra a ficha e a abordagem gerada.
- Alinhamento: texto à esquerda, números à direita.

```
+----------------------------------------------------------------+
| Empresa          Nicho      Cidade    Preço est.  Chance      |
|----------------------------------------------------------------|
| Padaria Sol      Alimentos  Caruaru   R$ 1.200    ||||  alta  |  | painel
| Oficina Dias     Automotivo Recife    R$ 900      |||   média | |  Ficha
| Clínica Vida     Saúde      Olinda    R$ 2.400    |     baixa | |  Abordagem
+----------------------------------------------------------------+
```

**Princípios**
1. A lista é o produto. Tudo que não ajuda a ordenar ou decidir sai da tela principal.
2. O elemento memorável é a barra de chance de fechar. Ela é a única parte com cor de destaque e a única animada, e a animação só acontece quando a lista é reordenada pelo usuário.
3. Estrutura com informação: divisores entre linhas separam oportunidades, não decoram. Sem numeração de posição, a não ser que a lista seja de fato uma sequência de passos (como a abordagem em etapas).

## Revisão contra o briefing (segunda passagem)

Itens que pareciam padrão genérico e foram revisados:

- **Grade de cards** → trocada por lista. Cards iguais escondem a prioridade, e o trabalho aqui é priorizar.
- **Roxo espalhado** → reduzido a um elemento. Mantido por ser a marca.
- **Gradiente e sombra** → fora. Não acrescentam informação nesta ferramenta.
- **Rótulo em caixa-alta** e **metadados com "·"** → proibidos pelo plano.
- **Seta em links e botões** → proibida. O texto do botão diz a ação: "Gerar abordagem", "Salvar na lista".

Resultado da revisão: a decisão mais particular é a lista com colunas numéricas alinhadas e a barra de chance como único ponto de cor. Isso é coerente com quem usa e com o que ela decide.

## Escrita da interface

- Verbos diretos e frase em caixa normal: "Gerar abordagem", "Salvar na lista", "Marcar como contatada".
- Mesmo nome da ação em toda a jornada: o botão "Gerar abordagem" produz um aviso "Abordagem gerada", não outro termo.
- Estado vazio com ação: "Nenhuma empresa nesta cidade ainda. Tente outro nicho." com um botão.
- Erro explica o que aconteceu e como resolver, sem pedir desculpa: "A busca falhou. Verifique a conexão e tente de novo."

## Verificação antes de publicar

- [ ] Roxo usado apenas no elemento memorável
- [ ] Números alinhados à direita com espaçamento tabular
- [ ] Lista legível em 320 px (colunas secundárias recolhem em linha)
- [ ] Chance sempre acompanhada de texto, não só de cor
- [ ] Contraste de `muted` verificado
