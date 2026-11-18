# DESIGN.md: o desenho do Redação

Fonte única do design a partir de 2026-11-01. Mudança de design passa por este arquivo. Protótipo de referência:
`design/direcoes/5/` (Fila e Revisão, dado real); galeria e histórico das outras direções em
`design/direcoes/index.html`; crítica e decisões em `design/direcoes/CRITICA.md`.

## 1. A escolha: Lápis azul

A tela como **mesa do revisor**. O operador recebe pautas, manda produzir, confere e aprova; a UI fala a língua de
quem revisa texto: papel limpo, grafite, e o **lápis azul do editor** marcando o que fazer em seguida.

Escolhida pelo dono em 2026-11-01, depois de duas rodadas:
- Rodada 1 ("jornal de vidro" com aquarela): layout aprovado, linguagem reprovada por lembrar o imob-intel.
- Rodada 2: Rotativa, **Lápis azul**, Teletipo. Escolhida a Lápis azul, com o quadriculado mais fraco (a 7% atrapalhava
  a leitura) e lateral no computador.

**Fora, por decisão do dono:** aquarela, manchas, pincel seco, arte em multiply, vidro fosco. A ilustração da peça
aparece só onde ela é o produto (carrossel, miniatura).

**Rodada 3, a Mesa de provas (05/11):** o dono pediu uma UI "SOTA, sem ser genérica". A pele continua a do Lápis azul
(papel, grafite, azul só ação); o que muda é o material e o lugar da arte. O produto é o post, então ele deixa de ser
miniatura de 32 px e vira **prova de gráfica sobre a mesa**: capa grande, marcas de corte, régua de espera, carimbo de
estado, sombras de papel em camadas, grão de papel. O vocabulário vem do domínio (gráfica e revisor), não de um
tema: está em §8.

## 2. Tokens

**Marca do produto.** A assinatura Lombada identifica o Gazzpush na abertura, nas telas de entrada e na criação de veículo.
Na redação, fica ao pé da lateral no computador e no menu da conta no celular. A assinatura usa azul-tinta no papel
e marfim no modo À noite. O símbolo sozinho identifica a aba do navegador e o app instalado.

| Token | Valor | Uso |
|---|---|---|
| `--papel` | `#F7F9FA` | fundo |
| `--papel-2` | `#EAEEF1` | lateral, seletor, faixas de tom |
| quadrícula | `rgb(11 92 196 / .03)`, 32 px | textura do fundo; nunca mais forte que 3% |
| `--texto` / `--texto-forte` | `#2A2D33` / `#15171B` | corpo / títulos, aba ativa, contadores |
| `--apoio` | `#5A5E66` | metadado, rótulo |
| `--fio` / `--fio-forte` | `rgb(21 23 27 / .11)` / `.22` | separação (no lugar de contorno) |
| `--tinta` (lápis azul) | `#0B5CC4` | **só ação**: link, Produzir, Aprovar, marca à mão; e, desde 01/11 (lateral), a seção ativa (`--tinta-clara` + texto em tinta) e o contador do que espera você |
| `--tinta-clara` | `#E4EEFB` | fundo de botão secundário de ação |
| verde | `#17663F` sobre `#E0F0E6` | só validação ok |
| âmbar | `#6E4A00` sobre `#F8EDCF` | só aviso (fonte indisponível etc.) |
| terracota | `#A23E1C` sobre `#F9E2D7` | só erro e rejeição |
| raio | 4 px (card), 8 px (botão), 6 px (faixa) | canto pequeno, sem contorno |
| `--papel-3` | `#E0E5E9` | um degrau abaixo do `--papel-2`: campo e faixa em hover |
| sombras | `--shadow-curta` · `--shadow-eleva` · `--shadow-prova` | em camadas (anel de 1 px = o fio, sombra de contato, sombra longa). **curta** = card em repouso; **eleva** = card levantado (hover, foco, folha de decisão, menus, folhas); **prova** = a arte da peça, que é o produto |
| grão | ruído fino a ~3 % sob a quadrícula | papel de verdade; sem cor e sem direção (não é pincel). Não entra em contraste: é textura |
| movimento | `--ease-saida` `cubic-bezier(.2,.8,.2,1)` · `--ease-mola` | saída suave para o que entra; mola curta para o que responde ao toque. Tudo some com `prefers-reduced-motion` |

Contraste medido (AA para texto pequeno em todos): texto 13,1 · apoio 6,2 (5,6 sobre papel-2) · tinta 6,0 ·
branco sobre tinta 6,3 · verde 5,9 · âmbar 6,8 · terracota 6,1.

## 3. Tipografia

- **Atkinson Hyperlegible Next** (400, 700) em tudo: manchete, título de tela e corpo. Sem serifa. Manchete em 700 com
  `letter-spacing: -.015em`; nome do veículo em `-.03em`.
- **Fragment Mono** (400) só em metadado curto: editoria, fonte, hora, contagens, número na margem. Em caixa normal;
  caixa-alta só nos títulos de seção (`NESTA EDIÇÃO`).
- Subset latino, `font-display: swap`: 50 KB as três faces (Next 400 e 700 com 12 KB cada, Fragment Mono 25 KB), em
  `web/src/estilo/fontes/`.
- Fase C: a Next entrou no lugar da Atkinson original (mesmo desenho, 12 KB por peso contra 17). Ela **também corta o
  zero** nos dois pesos (o subconjunto não traz zero sem corte). Pendência do dono: aceitar o zero cortado ou escolher
  outra fonte só para os números.

## 4. A marca à mão (uma por tela)

O lápis azul é o gesto da direção, e aparece **uma vez por tela**, na próxima ação:
- **Fila:** volta de lápis em torno de "Revisar a próxima" (ou de "Produzir", quando não há peça para revisar). As
  outras ações são texto sublinhado.
- **Revisão:** visto à mão no botão Aprovar (branco sobre lápis azul).
- **Mesa revisora:** volta de lápis em "Mandar para o Instagram". As marcas das afirmações nunca são de lápis. Enquanto houver
  nota do revisor aberta, a próxima ação é a nota e a volta sai; resolvida a nota, ela volta.
- **Editor, a exceção:** a nota do revisor (§10) tem sublinhado de lápis e pode aparecer mais de uma vez na tela, porque cada
  uma é um pedido de ação. As marcas do texto seguem sem lápis, e o traço continua sem marcar estado.
- O visto da validação é de lápis também, mas **verde** (validação é verde; azul é só ação).
- Traço gerado em SVG com grão de grafite (`ARTE.circuloLapis`, `ARTE.vistoLapis` em `design/direcoes/_base/arte.js`).
  Movimento previsto: a volta se desenha ao entrar (dashoffset) e o visto se traça ao aprovar; tudo instantâneo com
  `prefers-reduced-motion`.

## 5. Casca

- **Menu em linguagem de leigo** (01/11): Ideias · Para aprovar · Prontos para postar · Postados (+ Conta). Os
  protótipos ainda mostram Edição · Revisar · Publicar; a Fase C já nasce com os nomes novos. Veículo de autor
  (02/11): **Textos** abre o grupo Fluxo da lateral (ícone de folha com linhas, marcado também dentro de um texto); no
  celular a barra de baixo não muda (cinco lugares) e Textos fica no menu da conta, acima do grupo Veículo.
- **Celular (< 1024 px):** barra no alto (veículo, avatar da conta) e navegação embaixo (Ideias · Aprovar · **+** ·
  Postar · Postados), opacas, separadas por fio. O **+** abre a folha "Nova" (link, texto ou foto). Aba ativa: fio de grafite sob o item, contador em grafite.
- **Computador (≥ 1024 px):** **lateral de 256 px** em `--papel-2`, redesenhada em 01/11 depois que o dono reprovou
  seis variações só de texto ("quero um layout mais SaaS, não tão minimalista"). Base: conceito S1 do Codex
  (`design/lateral/codex-s1.png`) passado pelo Revenue-Centric Design. De cima para baixo: seletor de veículo com o
  quadrado da marca (logo ou inicial em tinta), nome e @; "Nova ideia" (secundário; primário só para repórter, que
  só traz ideias) com, ao lado, o botão quadrado **Ir para…** (lupa; ⌘K / Ctrl K, §8); grupo **Fluxo** com ícones de
  linha, seção ativa em `--tinta-clara` com a **marca de margem** (risco de 3 px em tinta no canto esquerdo, que
  escorrega até a seção nova na troca de tela, §8), contador em tinta **só no que
  espera você** (Para aprovar, Prontos para postar; Ideias mostra "n novas", Postados nada: contador é de mudança,
  nunca de total); um card de papel com o que está acontecendo: **Primeiros passos** (1 de 4 já feito, até o
  primeiro post sair) ou **Em produção** (o post mais antigo produzindo: manchete, etapa, 4 traços, "depois: Para
  aprovar"; com mais de um, "+n produzindo" como link para Ideias); **Fontes em uma linha** (02/11, Rams 4): o rótulo
  e, à direita, "coleta 08:37" ou "1 indisponível" em âmbar, a linha inteira levando à aba Fontes, que tem o detalhe
  (a lateral não cresce com o número de feeds); quando não há Primeiros passos nem Em produção, o card **Hoje denso**
  (02/11, Tufte 16): a semana em sete barras com hoje marcada e os totais de hoje e da semana, e embaixo "esperam · o mais
  antigo" com "4 para aprovar · há 23 h" e "2 para postar · há 14 h" (o horário anotado entra no lugar da espera);
  ritmo e espera, nunca total acumulado (05/11: sete barras sempre à vista, o dia sem post é um toco de 3 px; "o que
  espera" à esquerda e "há quanto tempo" à direita, em duas colunas); a próxima coleta fica só na linha Fontes. Rótulos num sistema só (Rams 6):
  todo grupo que não é a navegação principal (Veículo, Fontes, Em produção, Primeiros passos, Hoje) leva rótulo mono
  em caixa-alta; a navegação principal não tem rótulo (ela é a lateral); seletor e conta são nomes próprios, em sans;
  a seta da conta aponta para cima, porque o menu abre para cima. Grupo **Veículo** (Marca · Contas · Fontes ·
  Equipe, ícones de linha, aba ativa em `--tinta-clara`, como na S1); conta no pé (menu com sair). Sem produto no
  topo, sem busca (volta quando houver o que buscar). Para o repórter, que só traz ideias, "Nova ideia" é o bloco azul
  e os contadores não aparecem (nada espera por ele). No celular, as quatro partes do veículo ficam no menu do avatar.
- **Um nome por tela** (02/11, Rams 1): o título de cada tela é o texto do item do menu que a abriu (Ideias, Para
  aprovar, Prontos para postar, Postados; no veículo, Marca, Contas, Fontes ou Equipe), sempre em 32 px no celular e 44
  no computador. O nome do veículo fica só no seletor da lateral e na barra do celular, nunca como título. No
  computador a tela do veículo não tem a fila de abas (o grupo Veículo da lateral é a fila); no celular as abas
  ficam, porque não há lateral.
- **Tela do veículo** (`/t/:veiculo/veiculo`): abas na URL, uma por vez; "Só o admin altera" para quem não é admin;
  formulários no padrão do Criar veículo (campo sem contorno, fio embaixo), listas em cards de papel com sombra
  curta, um bloco de lápis azul por formulário; estado em Fragment Mono ("você posta pelo celular", "pausada",
  "coleta parada: muitas falhas seguidas"; "lida pelo navegador" quando o site barra a leitura comum e a coleta foi
  pelo Browser Rendering, lote I). Prints em `design/telas/veiculo/` e `design/telas/melhora/`.
  Lote I: **Contas** liga manual, Instagram direto ou por intermediário (rádios no padrão do "O que ele cobre";
  segredo em campo de senha; PostPeer e Zernio desabilitados "em breve"). **Fontes** tem a **Cobertura**:
  cidades em chips de papel ("Santos · SP", "Tirar" só com mais de uma) e o campo de município; o botão de
  acrescentar é secundário para a aba não ter dois blocos azuis. **Marca** (02/11, em seções): quatro seções (Nome e
  cores · Ilustração · Convite do fim · Marca d'água; a escolhida vai para a URL, `?secao=`). De 1280 px para cima,
  **mestre-detalhe**: a lista fixa das seções à esquerda (nome e resumo; a escolhida em `papel-2` e negrito, sem azul),
  os campos no meio, a prévia à direita; trocar de seção não move a lista. Abaixo de 1280, acordeão (uma aberta, as
  fechadas numa linha com o resumo). Resumo em mono ("canto · 50 %"; "sem imagem de referência" e "contraste baixo" em
  âmbar; "alterado" em grafite quando difere do salvo, e ao lado do Salvar "Alterações não salvas em …", com aviso do
  navegador ao sair); no Convite do fim, um convite aberto por vez. A prévia do card que a seção altera (capa; capa com
  a referência, que orienta o estilo e não sai no post; o card de convite) fica à direita no computador e logo abaixo
  dos campos no celular. Um "Salvar a marca" só, preso ao pé. Os convites não levam número nem
  dia da semana (a checagem de fatos recusaria o post); a ajuda da seção diz isso antes de salvar. **Fontes e Contas em partes** (06/11, §9): a ação vem na primeira linha ("Adicionar um feed RSS", "Ligar uma conta") e a lista abre por padrão; sem nenhuma fonte ou conta, abre a ação. Adicionar ou ligar leva de volta à lista, com a confirmação em cima. Fontes: De onde vêm as ideias ("3 fontes · 1 indisponível", em âmbar, abre sozinha), Cobertura, Resumo do dia e Piloto automático. Contas: Onde os posts saem e Google Docs (erro do Google abre sozinho). **Marca**: "Salvar a marca" presa ao pé também no celular, e Fontes do card com Idioma dos posts numa parte fechada, "Letra e idioma" (`?letra=aberta`), dentro de Nome e cores. O passo 1 e o passo 2 do Criar veículo têm a barra presa com Continuar e Salvar.
- **Criar veículo de autor** (02/11, modo `autoral`): terceiro rádio em "O que ele cobre", **Autor** ("Os seus textos
  do Substack e do Google Docs, no Instagram na sua voz."), no mesmo padrão dos outros dois. Marcado, o município sai e
  entra o campo "Endereço do seu Substack" (URL); o nome do veículo fica opcional ("Em branco, vale o nome da sua
  publicação no Substack"). O erro de leitura do feed fica no campo, em terracota, com o foco nele e o digitado
  mantido; o botão diz "Lendo o seu Substack…". No passo 2 a marca já vem preenchida (nome, logo, cor) e ganha o campo
  **Assinatura**, que também aparece em Nome e cores na aba Marca de um veículo de autor. Prints em
  `design/telas/autoral/`.
- **Card de autor** (veículo `autoral`): o mesmo `card.html`, sem o rótulo de data e sem eyebrow de notícia ("O que
  aconteceu", "Contexto"; fica só a editoria, quando há); no rodapé à esquerda, a assinatura no lugar de "Fonte:
  <site>", ligada ao texto. O convite padrão do autor é "Leia o texto completo" e a legenda fecha com "Texto completo:
  <link do post>", sem a linha "Fonte:". A prévia do navegador (`htmlPrevia` com `autoral`) mostra o mesmo card.
- **Conectar Google Docs** (02/11, só com a configuração do Google no servidor): bloco "Google Docs" no fim da aba
  Contas, em card de papel, com o botão secundário "Conectar Google Docs" ("Conectar de novo" quando já conectado, com
  "conectado" em verde mono). A conexão é da pessoa, não do veículo, e pede só `drive.file`. Na folha "Nova ideia",
  quarta aba **Docs** (Link · Texto · Print · Docs): "Escolher no Google Docs" abre o Picker (a folha sai da frente
  enquanto ele está aberto e volta com o nome do documento); acesso vencido vira a faixa de erro com "Conectar de novo"
  na própria folha. Sem a configuração do Google, a aba e o bloco não existem.
- **Textos** (02/11, veículo de autor; prints em `design/telas/autoral/textos-*`): título, a frase "A conferência
  aponta, não reescreve", o botão **Novo texto** (06/11: abre o editor numa folha em branco, com foco no título; o editor é o caminho padrão),
  ao lado **Colar ou trazer do Google Docs** (`?novo=colar`, abre o bloco Texto pronto em `--papel-2`: "Trazer do Google Docs" quando conectado; Título,
  Texto em textarea, "Abrir na mesa"; vazio, o erro fica no campo) e a lista "Na mesa": título, origem e quando, a
  contagem da última conferência em mono com o ícone de cada estado e, se uma fonte do dossiê mudou, a faixa âmbar
  curta. Repórter vê a lista sem os dois botões. A folha que ficou vazia é reaproveitada: Novo texto não
  enche a lista. Sem título digitado, a primeira linha dá o nome (o campo fica vazio e o nome acompanha o texto). Na folha vazia, Conferir, Instagram e Substack ficam desligados.
- **Mesa revisora** (02/11; prints `mesa-conferida-*`, `mesa-marcas-390`): no computador, o texto à esquerda (coluna
  fluida, 19 px, entrelinha 1,65) e uma coluna de 380 px fixa ao rolar com o card **Afirmação** (estado com ícone, a
  frase marcada entre aspas, a explicação de uma frase, a evidência com link e o trecho dela em fundo verde claro) e o
  **Dossiê** (cada evidência em card de papel: título com link, domínio, "conferida agora · sustenta 1 afirmação",
  Tirar; embaixo, "Acrescentar link"). No celular, uma coluna (texto, depois dossiê) e a afirmação abre numa folha de
  baixo com Fechar. Em cima do texto: origem (link para o Docs), versão e hora da conferência; ações Editar o texto,
  Conferir, Devolver ao Docs (só texto do Docs), Copiar para o Substack (secundários em `--papel-2`) e a marca à mão.
  Desde a Fase 2 da Matéria o texto é o editor (abaixo, "Editor da Matéria") e o card Afirmação virou o painel Marcas.
- **A Matéria** (02/11; prints em `design/telas/materia/`): a mesa ganha abas logo abaixo do título, **Dossiê ·
  Texto · Posts · Depois** (na URL, `?aba=`; Texto é o padrão), no estilo das abas do veículo (a ativa em
  `--tinta-clara`, texto em tinta), com a contagem em mono ao lado de Dossiê (evidências) e de Depois (fontes que
  mudaram). **Dossiê:** o dossiê e "O que cada fonte sustenta" (por evidência, as frases do texto com o trecho dela em
  verde claro). **Posts:** um card de papel por peça (manchete, "carrossel · para aprovar · há 2 h · da versão 1 do
  texto", link para a peça; "Ver no Instagram" quando postado). **Depois:** "Fontes que mudaram", com a faixa âmbar e as
  frases que a fonte sustentava. "Mandar para o Instagram" com risco aberto: faixa terracota com a lista das frases em
  risco; cada uma leva à marca. Na Revisão de um post da Matéria, a seção **De onde veio cada frase** (card em mono, a
  frase, o trecho da evidência em verde claro e o link). **Aba Dossiê em partes** (06/11, §9): Dossiê, Documentos, Gravações, Pedidos de LAI, Outro lado e o que mais a aba tiver, cada um com a contagem ou a situação; a parte com erro ou aviso sobe e abre sozinha (ordem: erro, aviso, resto; LAI avisa com 5 dias ou menos; frase de risco sem pedido conta como aviso em Outro lado). Parte vazia é uma linha com a sua ação; no mestre-detalhe, a ação fica no fim do painel. Na aba Texto do celular, o dossiê depois do texto vira uma parte fechada (`?dossie=aberto`), que abre sozinha com aviso; no computador continua na coluna ao lado.
- **As três marcas:** fundo claro e fio reto de 2 px embaixo na cor do estado (**âmbar** sem fonte, **terracota**
  risco jurídico); **com evidência** fica discreta, só um fio verde de 1 px, para não poluir o texto. Sempre com ícone
  antes (visto, interrogação, triângulo) e o nome do estado para leitor de tela; nunca sublinhado ondulado, nunca
  lápis. A marca é camada por cima do texto (decoration do editor, nunca entra no documento), acompanha a digitação
  e a escolhida ganha contorno de grafite. Acima do texto, a contagem em mono: "1 com evidência · 1 sem fonte · 1 risco
  jurídico".
- **Fonte mudou:** faixa âmbar "Uma fonte do dossiê mudou desde que você conferiu" na mesa, na evidência e na lista.
- **Editor da Matéria** (02/11, Fase 2; prints `design/telas/materia/editor-*`): substitui o textarea (decisão do dono:
  Tiptap, carregado só na rota da mesa). Um editor só, sem modo editar e modo ler. O título é o próprio campo (o h1 fica
  para leitor de tela); na linha mono de cima, "salvo às 23:20", "salvando…" ou "alterações não salvas". Barra de
  formatação em texto (Parágrafo · Intertítulo · N · I · Citação · Link; a ativa em `papel-2` e negrito, sem azul), o
  link num campo logo abaixo. Citação: recuo com fio de 2 px em `fio-forte` (não é card). No computador, a coluna de
  380 px fixa ao rolar traz o painel **Marcas** (a contagem, os filtros Todos · Sem fonte · Risco como botões com a
  contagem em mono, os parágrafos "não conferidos" em faixa terracota com "Conferir de novo", e um cartão de papel por
  marca: ícone, estado em negrito, categoria em apoio e a frase em duas linhas; o escolhido abre a explicação e a
  evidência com o trecho em verde claro) e o Dossiê embaixo. Clicar na marca escolhe o cartão; clicar no cartão leva à
  frase; F8 e Shift+F8 pulam entre as marcas abertas (a dica fica em mono acima do texto). No canto de baixo do texto,
  o **contador** (card de papel em mono): "conferindo…", "2 por conferir", "1 não conferido" ou "conferido", e "2
  marcas abertas". No celular, tocar na marca só a escolhe (o foco fica no texto) e o contador ganha "ver a marca";
  ele abre a folha de baixo com o painel. Outra pessoa salvou antes: faixa de erro com "Recarregar a versão nova", e o
  digitado fica até a pessoa recarregar. **Folha do documento** (06/11, pedido do dono: "experiência meio Notion / Google Docs"): o texto fica numa folha branca e lisa (`.folha-doc`), sem o papel quadriculado, que atrapalhava a leitura; coluna de 680 px, entrelinha 1,75, margem entre parágrafos e barra de formatação presa ao topo da folha. Duas colunas só de 1180 px para cima; abaixo, marcas na folha de baixo e dossiê depois do texto. No celular, ações e formatação ficam em fileiras que rolam de lado, com Mandar para o Instagram na primeira dobra, e o texto começa na primeira tela. No foco, o fio da barra escurece.
- **Painel do computador** (06/11, pedido do dono: "sidebar grande demais"): 300 px, uma parte de cada vez em `?painel=`: **Marcas** (padrão, com Pessoas embaixo), **Dossiê** (com a página de
  fontes) e **Ferramentas** (a Bancada). A contagem fica no botão de cada parte, e o Dossiê com aviso muda de cor fechado. Clicar numa marca, F8 e o contador do pé voltam para Marcas; alerta em
  parte fechada abre a parte. Sem marca, somem contagem e filtros; sem nome no texto, some Pessoas. Hierarquia de atenção: o que a pessoa veio resolver primeiro, o resto a um clique.
- **Bancada do editor** (06/11, prints `design/telas/bancada/`): no computador, na parte Ferramentas do painel; no celular, depois do texto. Partes, uma aberta por vez, em
  `?ferramenta=`: **Aspas da entrevista** (transcrição com busca; "Inserir" põe a fala entre aspas no cursor, ou só o pedaço selecionado, e a conferência liga ao minuto); **Apoio**
  (patrocínio no período vira bloco com o rótulo de publicidade, fora da conferência, e sai no Copiar para o Substack); **Divulgar** (3 assuntos de e-mail e uma mensagem de WhatsApp,
  só copiar; sugestão com número fora do texto cai); **Segunda leitura** (notas de editor que levam ao trecho, sem reescrever); **Versões** (um ponto a cada 10 minutos, os 30 mais
  novos; restaurar é um salvamento comum e guarda o de agora antes). Nada do modelo entra no documento. Barra da folha: **Imagem** (JPEG ou PNG até 2 MB, descrição obrigatória),
  **Aspas** (abre a parte) e **Foco** (`?foco=1`, de 1180 px para cima: sem a lateral e sem o painel, a folha no centro; abrir uma ferramenta sai do foco). **Pé da folha**, preso ao fim
  da tela: palavras, tempo de leitura e o contador, que antes pousava em cima do texto. A página de fontes foi para o painel, com o dossiê; no celular, depois do texto.
- **Assistente do editor** (03/11, Fase 3; prints `design/telas/materia/assistente-*`, `textos-manual-*`,
  `textos-auditoria-*`): o cartão escolhido no painel Marcas ganha, abaixo da explicação, a linha das opiniões em mono
  ("duas opiniões: DeepSeek e Claude", "uma opinião: DeepSeek") e as ações em botões secundários retos: Prender fonte ·
  Adicionar link · Procurei o outro lado · É opinião · Ignorar. Cada uma abre um formulário curto dentro do cartão
  (evidência e trecho; link; quem, quando e por qual meio); decidida, o cartão mostra em mono o que foi feito, por quem
  e quando, com Desfazer. A marca decidida vira **resolvida**: fio de 1 px em `fio-forte`, sem fundo. Quarto estado,
  **incerto, confira** (as duas opiniões discordam): mesmo tratamento do risco, com o rótulo em texto. Os apontamentos
  feitos por código têm marca e ícone próprios e a explicação de uma frase, sem ações de modelo: **conta que não fecha**
  como o risco (terracota claro, fio de 2 px terracota, ícone de diferente), **aspa sem fonte** como o sem fonte (âmbar,
  ícone de aspas) e **manual de redação** só com fio de 1 px em tinta, sem fundo (ícone de livro). A citação com @ é um trecho em mono `[título da evidência]` em
  `papel-2`, sem cor de link; o menu do @ e a paleta do Ctrl/⌘K são cards de papel com a lista em texto e a opção
  ativa em `papel-2` (sem azul). Colar um link: faixa curta "Adicionar ao dossiê?" com Adicionar · Agora não. Abaixo do
  painel, **Pessoas e instituições** (nome em negrito, menções em mono, "acusado · outro lado procurado" ou "sem outro
  lado" em terracota). No Dossiê, cada evidência mostra a força em mono e o select "Tipo da fonte"; fonte única e
  fontes circulares em faixa âmbar. **Checklist de publicação:** seção sobre o texto, aberta por "checklist: 2
  pendentes" (mono) ou pelo Instagram travado; uma linha por pendência que leva à frase, e "Assinar a publicação"
  (secundário); assinada, "Publicação assinada por" quem e quando, em mono. Na tela Textos, **Manual de redação**
  (regra: a forma a evitar riscada em terracota → a pedida em negrito; tipo em mono) e **Auditoria** (tabelas por mês,
  tema e pessoa, números em mono à direita; ignoradas em cards com quem e quando). Tabela larga rola de lado no
  celular e recebe foco.
- **Escudo jurídico** (03/11, Fase 4; prints `design/telas/materia/escudo-*`, `pagina-de-fontes-*`): na aba Dossiê,
  cada link ganha a linha mono do Wayback ("cópia no Wayback · hoje, 10:11 · ver a cópia", "salvando no Wayback
  Machine…" ou "o Wayback não salvou (HTTP 429) · Tentar de novo"); a resposta do outro lado é um card de papel sem
  link, com o nome em negrito e "resposta do outro lado" em mono. Abaixo do dossiê, **Outro lado**: um card de papel por
  pedido (para quem em negrito, e-mail em mono, assunto, a frase entre aspas em apoio, como e quando saiu em mono,
  prazo em mono, "respondeu … a resposta está no dossiê" em verde, prazo vencido em faixa âmbar, e-mail que não saiu em
  faixa terracota com "Copiar o pedido") e "Pedir o outro lado" (secundário) que abre o formulário em `papel-2`: a
  frase, quem, e-mail, prazo, assunto e o pedido num textarea já preenchido com o modelo; "Mandar por e-mail" só com o
  Email Service ligado (sem ele, a linha mono diz que não está configurado), "Copiar e mandar por fora" abre o "por onde
  e quando mandou" e "Registrar o envio". No fim da aba, **Pacote de defesa**: um parágrafo do que vem no zip e "Baixar
  o pacote de defesa" (secundário); baixado, a linha verde com a hora do carimbo, ou faixa âmbar "sem carimbo de tempo"
  com o motivo. Na aba Texto, abaixo das ações, "Publicar a página de fontes" (secundário); no ar, a linha mono
  "página de fontes no ar (versão 1) · ver · tirar do ar" e a caixa "card final “Como apuramos”" do Instagram. A
  **página pública** é uma coluna de leitura de 680 px em `papel`, sem a casca do app: veículo e "Como apuramos" em
  mono, o título, uma linha do que é, "Frases e fontes" (a frase com o número da fonte e, embaixo, "o que a fonte
  diz" em mono verde e o trecho em fundo verde claro), a opinião do autor numa seção à parte e a lista de fontes com
  link e cópia no Wayback; fio fino entre as seções, nada de cor de marca. O card final do carrossel é o convite do
  sistema com título "Como apuramos" e o link.
- **Pergunte ao documento** (03/11, Fase 5; prints `design/telas/materia/documento-*`): na aba Dossiê, entre o dossiê
  e o Outro lado, **Documentos**: um card branco por PDF (nome em negrito e "abrir o PDF" como link; "3 páginas ·
  busca por palavra" em mono; "lendo o PDF…" em mono enquanto a fila lê; falha em faixa terracota), o campo "Pergunte
  ao documento" em `papel` e "Perguntar" (secundário). Cada pergunta, separada por fio: a pergunta em negrito, a
  resposta, a linha mono "resposta do modelo, presa às citações abaixo (conferidas no documento)", e cada citação com
  "p. N" em mono e o trecho em fundo verde claro, com "Usar como evidência" como link de ação. Sem citação que
  confira, só "Não encontrei no documento." (e em mono quantos trechos foram descartados). "O que o documento traz"
  abre uma lista de definições (rótulo em mono, valores com as páginas em mono). "Enviar PDF" (secundário) fica
  abaixo dos cards, com a ajuda dos limites. A evidência de documento no dossiê é um card sem link, com "página de
  documento do dossiê" em mono.
- **Aspas contra a gravação** (03/11, Fase 6; prints `design/telas/materia/gravacao-*`): na aba Dossiê, depois de
  Documentos, **Gravações**: um card branco por áudio (nome em negrito; "transcrevendo…" em mono enquanto a fila
  trabalha; "01:30 de áudio · transcrito" em mono; o player nativo do navegador; "Ler a transcrição" abre a lista com
  o minuto em mono à esquerda e o trecho como o Whisper devolveu; falha em faixa terracota). Abaixo, **Aspas do
  texto** (título de seção em negrito): cada citação, separada por fio, com "bate com a gravação aos 01:13 · nome" em
  mono verde e "Ouvir o trecho" (secundário, que vira "Parar" enquanto toca), ou "não encontrada nas gravações nem no
  dossiê" em mono âmbar. "Enviar áudio" (secundário) com a ajuda dos limites. No editor, a aspa que bate tem a marca
  da evidência (fio verde fino, sem fundo) com o ícone de onda de som; o cartão diz "Bate com a gravação aos 01:13
  (nome), palavra por palavra." e traz "Ouvir o trecho". A aspa que não bate continua com a marca âmbar de aspa sem
  fonte.
- **Matéria viva e LAI** (03/11, Fase 7; prints `design/telas/materia/depois-*`, `lai-*`): a aba **Depois** agrupa os
  alertas em seções mono ("Fontes que mudaram", "Pessoas e processos", "Prazos de LAI"): um card branco por alerta
  (o que aconteceu em negrito; o detalhe em faixa âmbar quando pede ação; o link da fonte ou da notícia; "alerta de
  …" em mono) com "Abrir o texto", "Atualizei o texto", "Post de atualização", "Post de errata" (secundários) e
  "Ignorar" (link de ação). O post abre o formulário em `papel-2` ("O que foi corrigido", a ajuda de que o post de antes
  não muda, "Criar o post de errata"). Tratado, o card fica em `papel-2` com a linha mono de quem fez e quando e "ver o
  post". No fim, "Processos citados no texto": número em mono com o tribunal e o último movimento, ou
  "acompanhamento desligado". O número na aba Depois conta os alertas abertos; a lista de Textos mostra "N alertas
  na aba Depois" em faixa âmbar. No Dossiê, **Pedidos de LAI**: as frases sem fonte com órgão público e "Pedir por
  LAI a …" (secundário); o formulário em `papel-2` (órgão, esfera, o pedido num textarea já com a base legal); cada
  pedido é um card com órgão em negrito e esfera em mono, a frase entre aspas em apoio, a situação em mono (terracota
  quando venceu ou não atendeu, verde quando respondeu), o prazo e os dias que faltam em mono, a faixa âmbar "Dá para
  recorrer até …", e os passos ("Copiar o pedido", "abrir o Fala.BR", "Registrar o protocolo", "O órgão prorrogou",
  "Registrar a resposta", "Preparar o recurso") como secundários.
- **Revisão da Matéria** (03/11; sem tela nova, os prints `lai-recurso-*` mostram o card atualizado): no card de LAI,
  órgão federal sem resposta mostra "Dá para reclamar até …" (a reclamação do art. 22 do Decreto 7.724) no lugar do
  recurso, e o botão "Preparar a reclamação" só aparece quando a janela abre; passado o fim, a faixa vira terracota
  ("O prazo para recorrer terminou em …. Se você protocolou a tempo, registre com a data do protocolo."). Estadual e
  municipal trazem, em mono, a nota de conferir a regra local; federal, a de que o prazo conta Carnaval e Corpus Christi
  mas não o ponto facultativo decretado no ano. Negado de novo depois do recurso: faixa âmbar dizendo qual é a instância
  seguinte e que ela é com a pessoa (recurso negado: a autoridade máxima do órgão e depois a CGU; reclamação sem
  resultado: a CGU). Em recurso, "Registrar a resposta ao recurso" (ou "à reclamação") e, depois,
  a linha mono da resposta. A resposta da LAI no dossiê não tem "Tirar". Em Documentos, a pergunta que falhou, que
  veio com citação inventada ou sem citação válida mostra a situação em mono terracota, e a busca só por palavra
  traz o aviso em faixa âmbar. No editor, o painel lista em faixa âmbar os parágrafos cuja conferência voltou com
  aviso, cada um com "Conferir de novo"; texto longo confere em rodadas sem a pessoa pedir. O resultado do pacote de
  defesa avisa, em faixa âmbar, quantos arquivos ficaram fora (o LEIA-ME diz quais).
- **Devolver ao Docs:** card de confirmação que diz o que acontece (só os parágrafos mudados; formatação de dentro deles
  se perde; nada é sobrescrito se o Docs mudou). Recusa por revisão: card "O Docs mudou depois que você importou" com
  o que mudou lá (o de antes riscado em cinza, o de agora, e "parágrafo alterado/novo/tirado no Docs" em mono), aviso
  âmbar de que reimportar perde as edições da mesa, e Reimportar do Docs · Cancelar.
- **Ideias com mais de uma cidade:** a cidade entra no metadado de cada ideia e há chips "Todas · Guarujá · SP ·
  Santos · SP" acima das sugeridas (`?cidade=`); o chip ativo usa o estilo da aba ativa.
- **Revisão:** quando a ilustração caiu no estilo padrão, faixa âmbar curta acima do carrossel ("Ilustração simples:
  o serviço de ilustração está sem crédito.").
  No celular, a barra de cima tem o quadrado da marca (32 px) ao lado do nome (o @ não cabe); o aviso de fonte
  indisponível é a faixa âmbar curta na fila.
- **Layouts do card** (02/11, Fase 3; `src/lib/cards.ts`, `src/templates/card.html`): o card é `{layout, título,
  frases, foto}`, de 2 a 10 por carrossel, o último sempre o convite do dono. Cinco layouts nossos: **Capa** (a
  manchete), **Texto** (título e 1 ou 2 frases), **Citação** (aspas grandes no acento, a fala em 46 px e, embaixo, de quem
  é, em caixa-alta no acento), **Número em destaque** (o número em 190 px no acento, até 16 caracteres, e a frase que o
  explica) e **Lista** (2 a 4 itens numerados "01, 02" no acento, separados por fio de 2 px). O modelo escolhe o layout
  de cada card; o editor pode trocar. Foto própria entra no lugar da ilustração, com a sombra de leitura um pouco mais
  forte. Peça antiga (papel fixo) sai igual ao que saía.
- **Editar os cards** (Revisão, editor para cima; prints em `design/telas/carrossel/`): botão secundário "Editar os
  cards" sob o carrossel ("Texto, ordem, tipo de card e foto. Não gasta versão."). A edição fica na URL (`?editar=1`) e
  ocupa a área da revisão, com título "Editar os cards" e "Fechar a edição". No computador, à esquerda a lista dos cards
  (número em mono, título, layout em mono; o escolhido em `papel-2` e negrito, sem azul; subir, descer e tirar em ícone
  de linha com rótulo; "corrigir" em terracota mono no card que a conferência apontou), "Adicionar card" (até 10; o
  convite fica no fim) e a prévia do card no mesmo template do render; à direita "Card n · Layout" (rótulo mono), o erro
  da conferência no próprio card (faixa terracota), o tipo do card (rádios), na capa, "Ver outras manchetes" (três ângulos conferidos com os fatos, cada um com "Usar"; a que reprova some; "Nenhuma manchete passou na conferência" em âmbar; print em `design/telas/carrossel/outras-manchetes-*.png`), o título com a contagem "61 de 110"
  (terracota quando passa), as frases em blocos de `papel-2` (texto e "Presa a": o fato com o trecho e a fonte embaixo,
  ou, no veículo de autor, "Afirmação minha (eu sou a fonte)"), a foto própria (a do celular entra: o navegador reduz para 1620 px em JPEG, até 2 MB, e tira a localização; com a foto, os cinco rádios de "Enquadramento", "Quem fez a foto" e "De quem é o direito", que ficam na peça para a certidão) e, no pé, o bloco
  de lápis azul "Salvar e conferir" com o estado ao lado. O convite não se edita: o editor escolhe qual dos convites da
  marca entra. No celular, uma coluna (lista, prévia, campos). Salvou e a conferência apontou algo: a edição continua
  aberta no card com erro; fora dela, a faixa terracota diz "Card 2 (Texto): motivo" com "Corrigir nos cards", e o
  Aprovar fica desabilitado com "Aprovar espera: corrija os cards…" em terracota no lugar da nota. O que não é de um
  card (manchete, legenda, convite fora do fim) aparece na mesma faixa, antes dos cards. Outra pessoa salvou enquanto
  esta editava: a tela fica na versão aberta (o que foi digitado não some), faixa de erro no topo "Outra pessoa salvou
  uma versão nova…" com "Abrir a versão nova"; salvar daqui é recusado. Enquanto salva, os campos travam; enquanto a
  foto sobe, "Salvar e conferir" espera. **Um card de cada vez** (06/11, §9): `?card=` guarda o card aberto e as ferramentas só aparecem na linha dele; Tipo do card e Imagem do card são partes (`?ferramenta=`); a prévia fica presa à esquerda de 1280 px para cima e tem 300 px por padrão (`?previa=grande` amplia); a barra de salvar fica presa ao pé; o card com erro abre sozinho na chegada.
- **Reels** (02/11, Fase 4; prints em `design/telas/reels/`): o carrossel animado em 9:16, sem narração. Na Revisão de
  um carrossel, "Fazer Reels" (botão secundário, ao lado de "Editar os cards"; "Os mesmos cards em vídeo, em pé. Vira um
  post novo.") abre a tela **Fazer o Reels**: título, linha mono "4 cards · 18,9 s · 9:16 · sem narração" (a duração muda com o ritmo; com voz, "com a sua voz"), uma
  frase do que acontece, que acompanha o movimento, e, à esquerda, os cards em pé (1080×1920, mesmo template com a classe `r916`) numa faixa que rola de
  lado, com o número e o título em mono embaixo. Cada card fica o tempo de ler (2 s, mais 0,35 s por palavra, entre 2,5
  e 7 s; convite em 3,75 s; total entre 7,5 e 60 s). A arte sempre aproxima de 1,08 para 1, e a entrada depende do
  movimento: **Manchete** (o topo aparece, o título sobe 48 px, as frases aparecem uma a uma), **Folha** (o card seguinte
  desliza por cima do anterior, sem blur) e **Seco** (corte direto). Número nunca conta na tela. O primeiro card abre
  inteiro nos três. A prévia só anda sem "reduzir movimento". À direita, as seções "Ritmo" (Mais rápido, Normal, Mais
  calmo: 0,8, 1 ou 1,25 vez) e "Movimento", preenchidas pelo modelo do carrossel, e "Música" (seção) com rádios: "Sem música" e as faixas da biblioteca (título em negrito, autor em apoio, a licença em mono sublinhada,
  link para a página da licença); biblioteca vazia diz que o Reels sai sem música. No pé, o bloco de lápis azul "Fazer
  o Reels" com "Leva de 1 a 2 minutos…" ao lado. O Reels vira um post novo: produzindo mostra só "Conferir cada frase
  com as fontes" e "Montar o vídeo"; na revisão, o vídeo em pé com os controles do navegador e a capa do carrossel
  (toca mudo e em laço só sem "reduzir movimento"), sem Reescrever e sem editar (o Reels se refaz a partir do
  carrossel). Em Publicar, conta manual: o vídeo pequeno, "Mande o vídeo" (celular: compartilhar, escolher Instagram e
  Reels) ou "Baixe o vídeo" (computador, o MP4). Nos cards 9:16, topo e pé ficam fora da área que a interface do Reels
  cobre: cabeçalho a 200 px do topo, texto a 420 px do pé e a 150 px da direita, rodapé a 300 px do pé. **Ajustes em partes** (06/11, §9): Voz, Ritmo, Movimento e Música são linhas com o que está valendo, uma aberta por vez (`?ajuste=`, Voz aberta na chegada); "Fazer o Reels" fica numa barra presa ao pé, com o motivo quando está parado. No celular a coluna de ajustes usa `display: contents`, para a barra ter como contêiner a tela inteira e não sumir sob a navegação.
- **Fontes do card** (aba Marca, seção Nome e cores): rádios com os três pares do catálogo (Nunito e Quicksand ·
  padrão; Source Serif e Source Sans; Archivo e Inter), nome em negrito e uma linha de descrição; a prévia da capa muda
  na hora e o resumo da seção diz o par. O par é do veículo, não do card.
- Revisão no computador (05/11, **mesa da prova**, §8): a arte à esquerda sobre o palco (papel-2 com grade de pontos,
  a prova de 404 px com marcas de corte, a cota "prova · 4:5 · 1080 × 1350 px" e, no canto, Editar os cards e Fazer
  Reels), o contador com as setas e, embaixo, as tiras de prova; coluna de 420 px à direita com validação, manchete, legenda (3 linhas + "ver
  inteira"), fatos recolhidos e a folha de decisão (branca, sombra `eleva`) no fluxo logo depois do último bloco, nunca
  cobrindo texto. Em tela com 820 px de altura ou mais, o palco acompanha a rolagem (sticky) para ler fatos e legenda com
  o card à vista. Acima, o pager da fila ("2 de 5", J e K).
- Folha de decisão no celular: tira de papel fixa embaixo, sem alça. Rejeitar (terracota) e Reescrever em texto,
  Aprovar em bloco de lápis azul. Frase fixa: "Aprovar não publica: a peça vai para Publicar…".
- **Post do anunciante** (`design/telas/anuncio/`): aba "Anúncio" na folha Nova, fora do modo autoral, com Anunciante e Briefing. Nas Ideias e em Postados, carimbo "Publicidade"; em Postados, "Comprovante" para editor. Na Revisão, painel "Publicidade de <anunciante>" em `faixa-aviso` enquanto não aprovado, com a frase do estado e "Copiar link"; sem permissão de área de transferência, o link fica à vista. Não trava o Aprovar. A página pública `/anuncio/:token` é HTML do Worker, sem a casca: arte, legenda, "O que precisa mudar", Aprovar e Pedir ajuste. O comprovante é uma folha A4 sóbria.
- **Composições de gráfica** (`design/telas/composicoes/`): Tarja (faixa chapada rente ao pé, sobre a arte inteira), Coluna (arte na metade de cima, bloco chapado embaixo), Cartaz (só tipografia sobre o Fundo) e Primeira página (nome do veículo como cabeçalho de jornal, fio duplo, manchete em cima, arte embaixo). Sem gradiente. Só com as três cores da marca. O selo de publicidade fica sob o cabeçalho, à esquerda, nas quatro. Tela de escolha: seção Modelos.
- **Modelos** (`design/telas/modelos/`): seção da aba Marca, com a prévia ao vivo do modelo aberto na mesma coluna da prévia da marca. Lista com nome, composição e "padrão"; Editar e Arquivar só para admin; repórter só vê. O formulário salva sozinho, com "Salvar o modelo", sem a barra "Salvar a marca". Na Revisão, o seletor "Modelo" fica sob as ações dos cards; em peça que mudou de modelo ou de marca, faixa âmbar com "Aplicar". **Formulário em grupos** (06/11, §9): "Como o modelo é" e "Quando ele vale", com os grupos fechados na chegada (`?grupo=`), o modelo aberto em `?modelo=` (ou `novo`) e a lista fora de vista enquanto se edita. Salvar, Cancelar e a prévia ficam na barra presa; no celular a prévia tem 72 px e "Prévia maior" (`?previa=grande`). Nome vazio ou palavras acima do limite abrem o grupo e focam o campo.
- **Patrocínios** (`design/telas/modelos/patrocinios-*`): seção da aba Marca com a lista (nome e período em mono) e o formulário de nome, início, fim e logo. No modelo, o campo "Patrocinador na arte" só aparece quando há patrocinador. Na arte, a faixa fica no lugar do selo de publicidade.
- **Fila do site** (`design/telas/fila-do-site/`): em cada fonte, a caixa "Este é o site do veículo" (só admin altera; não aparece no modo autoral), e abaixo da lista a frase do que acontece. Nas Ideias, a origem "do seu site". Na folha de decisão, com conferência ok e uma conta só, "Aprovar e ir para a próxima" em bloco de lápis azul, abaixo dos botões de sempre. Fica na parte "De onde vêm as ideias" da aba Fontes (06/11, §9).
- **Resumo do dia** (`design/telas/resumo/`): caixa "Resumo do dia às 18h" na aba Fontes (só admin altera; não aparece no modo autoral). Nas Ideias, "Resumir o dia" à direita do título, com a frase do que aconteceu logo abaixo: em produção, já feito, ou âmbar quando faltam notícias. Virou a parte "Resumo do dia" da aba Fontes (06/11, §9), com "ligado · às 18h" ou "desligado" na linha.
- **Encurtar para caber** (`design/telas/carrossel/encurtar-*.png`): botão por frase na edição do card, e no título quando o card volta com "não cabe". Lista "Versões conferidas", no mesmo desenho de "Outras manchetes", com "Usar". Nenhuma passou: frase em âmbar.
- **Gravar no app** (`design/telas/gravador/`): na seção Gravações do Dossiê, "Gravar" (botão secundário) com o aviso de que a tela apagada pode cortar a gravação. Gravando, um bloco branco com o tempo em mono de 24 px, "Salvo até mm:ss" em mono de apoio, a barra de nível (papel-2 com texto-forte, sem cor de estado) e "Parar e concluir" em tinta. Avisos em faixa de erro, com som curto e vibração: sem confirmação há 15 s, gravação parada, microfone cortado, 20 s sem som e app fora da frente. Sessão aberta volta em faixa âmbar com "Concluir". Na lista, "Transcrevendo 7 de 30"; trecho que falhou fica em faixa de erro com "Tentar de novo"; o que não chegou diz "Faltou de 12:30 a 12:35"; o áudio se ouve por trecho, num seletor "a partir de 02:00".
- **Reels com a sua voz** (`design/telas/reels-voz/`): seção "Voz" na tela do Reels, com os rádios "Sem narração" e "Com a sua voz". Com voz, some "Ritmo", porque o tempo vem da fala; aparecem "Roteiro" (lista aberta, sem o convite), "Gravar a voz" e "Enviar arquivo". Gravando, tempo em mono com "/ 01:30", barra de nível e "Parar". Lista "Avisos da fala": cada linha diz o número ou nome, com o tempo em mono, "Ouvir" e "A fala está certa". "Fazer o Reels" fica parado, com a nota do motivo, até tudo decidido. Nada da transcrição aparece. Na Revisão, a legenda do vídeo troca "sem narração" por "com a sua voz". Dentro da parte Voz (06/11, §9): voz por gravar ou aviso por decidir aparece em âmbar na linha fechada, e o motivo continua na barra do botão.
- **Cards de prova** (`design/telas/composicoes/prova-*`, `design/telas/carrossel/prova-*`): três opções novas em Layout na edição do card. Documento troca os rótulos para "Documento ou órgão" e "Trecho" e esconde "Encurtar para caber". Comparação e Linha do tempo ganham, acima de cada frase, o campo "Rótulo" ou "Data". Na arte, o documento é tipo sobre o fundo com o trecho grifado na cor de destaque, sem arte; comparação são duas colunas e linha do tempo são linhas com a data à esquerda, as duas com filete fino.
- **Técnica e Outra ilustração** (`design/telas/modelos/`, `design/telas/carrossel/outra-ilustracao-*`): no modelo, rádios "Técnica da ilustração", que somem na composição Cartaz. Na edição do card, abaixo da foto própria, "Outra ilustração" (botão secundário) com a frase do limite, que vira "Pode levar até um minuto" e "Pode pedir mais 2 para este card". Com ilustração nova, aparece "Voltar à do post". Com foto própria, ou em card sem arte, o bloco some.
- **Piloto automático** (`design/telas/piloto/`): seção da aba Fontes, só para admin e fora do modo autoral, abaixo do resumo, com fio em cima. Uma caixa de marcar, o risco em uma frase e o que nunca passa pelo piloto. Sem conta que poste sozinha, a caixa fica desativada e a frase do risco dá lugar ao que falta. Em Postados, "Aprovado pelo piloto" na linha mono. Virou uma parte da aba Fontes (06/11, §9), sem o fio de cima. Linha: "desligado", "desligado · falta conta que posta sozinha" ou, em âmbar, "ligado · até 6 por dia sem ninguém ler". Ligado é risco em curso: a parte sobe e abre sozinha.
- **Se a conta cair** (`design/telas/kit/`): aba da tela do veículo, com entrada na lateral. Quatro blocos em coluna de leitura: O que fazer agora, lista numerada de texto; Caso aberto, com a contagem em mono e o formulário; Modelos para copiar, com texto à vista e "Copiar"; Certidões do mês. Em Postados, "Certidão" ou "Gerar certidão", com a falha em terracota. **Em partes** (06/11, §9): sem caso aberto, a ordem é Caso aberto, O que fazer agora, Modelos, Certidões, Reserva e Raio-X; com caso, o bloco do caso fica no alto, com o prazo em 18 px e o próximo passo por tipo de caso, e a ordem passa a Modelos, Certidões, O que fazer agora, Reserva, Raio-X e Caso. Cada modelo é uma parte com Copiar ao lado da linha (`?texto=`). Alerta do Raio-X abre sozinho.
- **Raio-X e reserva** (`design/telas/kit/`): na aba do kit, "Reserva", com a caixa da página pública e o endereço em mono, e "Raio-X dos posts antigos", com a escolha do zip, o andamento em mono e a lista de miniatura, data e motivo, sem ação de apagar post. "Apagar este raio-X" é botão secundário no fim. Em Prontos para postar, abaixo dos passos, "Mandar para o Canal". A página pública é HTML do Worker, no padrão da página de fontes. As duas viram partes da aba (06/11, §9); o Raio-X carrega antes de a tela escolher a parte aberta, para o alerta dele abrir sozinho.
- **Folha para o advogado** (`design/telas/materia/folha-*`): botão secundário logo abaixo do pacote de defesa, só para editor, com uma frase do que vem. A falha aparece em faixa, como a do pacote.
- **Veículo novo com estilo pronto** (`design/telas/veiculo/novo-site-*`, `copiar-modelo-*`): no passo 2, antes dos campos da marca, um campo de endereço e um botão secundário. A sugestão preenche os campos de sempre e abre "Nome nos cards" e "Fontes do card", que só aparecem depois de colar o site. O status diz para conferir e, sem logo, para escolher o arquivo. Copiar modelo é um bloco no fim da seção de modelos, só para quem é admin em outro veículo.
- **Sem plano** (06/11, decisão do dono: nada grátis): veículo sem assinatura não produz, não confere, não transcreve e não coleta fontes; ler e escrever o texto seguem. Em toda tela, faixa âmbar presa embaixo, com "Ver os planos" para o admin. O id `teste` fica no banco, com limite zero.
- **Plano** (`design/telas/plano/`): aba da tela do veículo, com entrada na lateral, só admin. Coluna de leitura: o plano como título, o uso em texto com uma barra fina, aviso a 80 % e faixa no limite; a comparação é lista com fio entre as linhas, sem cards nem selo de plano recomendado. Em Ideias, o erro do "Produzir" explica e leva ao plano, e quem não é admin lê "Peça ao admin do veículo".

## 6. Regras (vêm do handoff §1.4, ajustadas)

1. Aplicativo, não site: uma parte de cada vez, detalhe sob demanda.
2. Quem volta vê só o que mudou ("Desde a sua última visita", contadores de mudança, nunca total).
3. Movimento com sentido, sempre com `prefers-reduced-motion`.
4. Sem contorno + canto arredondado: separar por tom, fio e sombra curta.
5. Cor tem um significado só (tabela do §2). O lápis azul nunca marca estado: a nota do revisor é azul porque pede uma ação,
   e o risco que a corta diz que o pedido acabou, não que a frase está boa.
6. **Uma marca à mão por tela** (substitui "um pincel por tela"). Exceção: as notas do revisor, uma por parágrafo, cada uma um
   pedido de ação (§10).
7. Toda tela aponta a próxima ação.
8. Falha de carga nunca vira fato ("Não carregou · tentar de novo"; "1 fonte indisponível", nunca "fonte fora do ar").
9. Olhar o print antes de mostrar.
10. Toda tela em português e inglês (README, Idiomas): texto em par no lugar (`t(pt, en)`), o português primeiro e
    igual ao de sempre; o inglês curto, em sentence case, com o mesmo tom. O conteúdo do post (card, legenda, convite,
    prévia do card) segue o idioma do veículo, não o da tela. Prints em inglês em `design/telas/idioma/`.
11. A arte do post aparece como prova (grande, com sombra de papel), não como ícone de 32 px; a miniatura só existe onde
    ela identifica e não se confere (a lista de andamento da lateral, por exemplo).
12. Atalho de uma tecla só vale fora de campo de texto, sem Ctrl/Alt/⌘, e **abre**; quem decide é o botão. Atalho que
    tem tecla própria no editor (⌘K) fica com o editor quando o foco está nele.
13. Textura é papel, não pincel: o grão não tem cor nem direção e nunca entra na conta de contraste. Onde se lê texto longo (a folha do editor), a superfície é branca e lisa.

## 7. Para as próximas fases

- Separar pautas novas de já vistas — feito na Fase D (visita anterior guardada no aparelho; ver handoff §8, bloco D).
- "Validação ok" abre as checagens; setas do carrossel no celular — feito na Fase E (handoff §8, bloco E). Na
  revisão do computador a folha de decisão fica no fluxo da coluna, sem `sticky` (com um passo aberto ela cobria texto).
- Fase F: troca de tela por View Transitions só na área do conteúdo (sai 120 ms, entra 180 ms subindo 6 px; casca
  parada; seca com `prefers-reduced-motion`), foco no conteúdo ao trocar. No publicar, a volta de lápis fica em
  "Compartilhar no Instagram" (celular) ou "Baixar as imagens" (computador); "Confirmar que postei" é bloco de lápis
  azul (formulário). Conta de teste dita como "Simulação" (handoff §8, bloco F).
- Fase D2: a folha "Nova ideia" é um `<dialog>` nativo (classe `.folha` em `tokens.css`): no celular, tira de papel que
  sobe de baixo; no computador, no alto e centrada; fundo escurecido, sem contorno. Envio é bloco de lápis azul
  (formulário). Post vindo de print mostra na revisão uma faixa âmbar (aviso: texto lido por um modelo) com o link
  para a imagem (handoff §8, bloco D2).
- Prints de vidro/blur no Playwright exigem `channel: "chromium"` (não vale mais para esta direção, que é opaca, mas
  vale para qualquer teste visual).

## 8. Mesa de provas (05/11)

O vocabulário da rodada 3. Código: `web/src/estilo/prova.css` (classes), `web/src/kit/Prova.tsx` (cartão de prova, mesa
vazia, esqueleto), `web/src/casca/Paleta.tsx`.

- **Mesa** (`.mesa`): grade de provas, `auto-fill` com mínimo de 232 px (4 colunas no computador a 1440; 2 no celular,
  como a grade do Instagram). Para aprovar, Prontos para postar e Postados usam a mesa; o contêiner passou de 880 para
  1280 px. Sem a frase de contagem (a espera está em cada prova).
- **Prova** (`ProvaPost`, `.prova`): a capa em 4:5 com `--shadow-prova`; embaixo, um chip com o **número da fila**
  (grafite, mono) e a legenda mono (editoria · formato), a manchete em 18 px (até 4 linhas), a **régua de espera** e a
  ação, que fica sempre no pé do cartão (as ações se alinham na fileira). O cartão inteiro é um link; o nome acessível
  termina na ação ("… Revisar a próxima"). Ao apontar ou focar, a arte sobe 5 px, torce -0,35° e ganha `--shadow-eleva`
  (só em aparelho com hover; no toque, só o foco). **Carrossel** leva uma segunda folha atrás da capa (a pilha de
  cards); post e Reels, não. No celular (coluna de 168 px) a legenda vira o número e, ao lado, uma parte por linha
  (cortada com reticências se não couber), sem o ponto de separação pendurado; a espera também vira duas linhas
  ("espera há 5 dias" / "pronto 31/10"). A ação ocupa 44 px de linha, com ou sem a volta de lápis.
  **Aquecer** (`src/aquecer.ts`): 90 ms depois de apontar (ou focar com o teclado) numa prova, o status e a peça
  completa (ou o pacote de imagens) entram no cache, e a revisão abre pronta, sem o esqueleto.
- **Régua de espera** (`.regua`): 24 divisões; a parte cheia (grafite) é a espera desta prova em relação à mais antiga da
  fila. Substitui o fio de 3 px. Tem `aria-hidden`: a espera está escrita em mono ao lado.
- **Marcas de corte** (`.corte`): quatro cantos fora da arte, como numa prova. Aparecem ao apontar e **ficam sempre na
  prova que é a próxima ação** (junto da volta de lápis; as duas dizem "esta é a próxima"). Só decoração. Na mesa da
  revisão e na prévia do card (Marca, edição dos cards, Reels), só de 1024 px para cima.
- **Carimbo** (`.carimbo`): o estado de uma prova em mono, caixa-alta, 1,5 px de borda, -2° de giro, em grafite (carimbo
  não é ação, então não é azul; não é validação, então não é verde). Hoje: "Postado" e "Simulado" na mesa de Postados,
  a cavaleiro da borda de baixo da capa para não cobrir o texto do card.
- **Trilho** (`.trilho`, Ideias): os posts em andamento como uma fileira de provas de 198 px (156 no celular) que rola de
  lado com encaixe; no computador cabem cinco. Quem ainda está sendo feito é uma prova em branco, hachurada, com
  "produzindo". É a única seção de Ideias com arte grande. **Trilho curto** (`.trilho-curto`, 06/11): em Ideias, a prova de 76 px ao lado do texto, com a manchete em duas linhas, para os posts prontos não disputarem a primeira dobra com as ideias; a arte ali identifica, a conferência é na revisão.
- **Folha de pauta** (`.pauta`, Ideias): a ideia sugerida em papel branco com `--shadow-curta` (sobe 2 px ao focar);
  chip com o número, legenda mono, manchete em 20/21 px, resumo em até 3 linhas e, no pé, separadas por um fio, as
  ações (Produzir, post | carrossel, descartar), alinhadas entre as folhas da fileira. Filtro por cidade e a ajuda dos
  formatos ficam numa barra logo abaixo do título da seção. Cabeçalho da tela: o **fólio** (data e praça, em mono)
  vem em cima do título, como no alto de uma página impressa. **À vista** (06/11, §9): com ideia nova, só as novas, e "Já vistas" numa parte fechada com a contagem; sem ideia nova, três ideias (duas entre 1024 e 1345 px, onde a grade tem duas colunas) e o resto em "Mais ideias". `?ideias=todas` guarda a parte aberta; ideia com falha, ou trazida agora, abre a parte. A próxima ação nunca cai numa parte fechada.
- **Palco** (`.palco`, Revisão e Publicar): mesa de desenho em `--papel-2` com grade de pontos (14 px, 10 %), só de 1024
  px para cima. A arte do carrossel ocupa a prova inteira, um card por vez (no celular segue a faixa que arrasta com o
  vizinho à vista). **Tiras de prova** (`.tira`): a capa de cada card em 44 px, a atual levantada e com o fio de grafite,
  numa fileira de ponta a ponta (centrada quando cabe, rolável quando não); o contador "1 / 4 · Capa" e as setas ficam
  numa linha em cima delas, no celular e no computador, para o contador (de largura variável) não empurrar as tiras
  a cada card. ← e → passam os cards (ver Atalhos).
- **Atalhos de uma tecla** (`atalhoLivre`, em `comum.tsx`): na Revisão, **A** abre o Aprovar, **E** o Reescrever, **X**
  o Rejeitar (abrem o passo, nunca decidem), **J** e **K** vão ao post seguinte e ao anterior da fila, **← →** passam os
  cards (as setas valem segurando; as letras, uma vez por toque). Só valem com o foco no conteúdo da tela (ou solto no
  corpo), sem Ctrl/Alt/⌘, fora de campo de texto, sem diálogo ou menu aberto e se ninguém tratou o evento antes: nunca
  com o foco na lateral, num menu ou numa folha (WCAG 2.1.4, atalho de caractere só age onde a pessoa está). A dica fica
  em mono na folha de decisão, só no computador.
- **Paleta de comandos** (⌘K / Ctrl K, `Paleta.tsx`): diálogo nativo com a lista em combobox. Vai a qualquer seção
  (Ideias… Marca, Contas, Fontes, Equipe, Textos), abre um post pelo título (os que estão em Para aprovar, Prontos para
  postar e produzindo), troca de veículo ou de idioma, cria veículo, sai. Opção ativa em `--papel-2` com risco de
  grafite (sem azul, como a paleta do editor). Busca sem acento e sem maiúscula; cada post traz o formato e o estado na
  dica (o carrossel e o Reels de mesmo título se distinguem). Sem resultado, a lista some e fica só "Nada com esse
  texto." (e `aria-expanded="false"` no campo); a cada letra um aviso de leitor de tela diz quantos resultados. Na mesa
  de um texto da Matéria (`/textos/:id`) o ⌘K é sempre o do editor, com o foco dentro do texto ou fora dele.
- **Marca de margem** (`.marca-margem`): o risco de 3 px em tinta ao lado da seção aberta da lateral. Tem
  `view-transition-name`, então ao trocar de tela ele **escorrega** até a nova seção (320 ms). **Não conta** como a marca
  à mão da tela (§4): é indicador de posição, reto, sem traço de lápis.
- **Lista de espera** (`/lista-de-espera`, para onde "/" leva quem não tem sessão): a mesma promessa do Entrar (`Promessa`) com a folha do
  cadastro. Só o e-mail é obrigatório; nome e plano são opcionais. Nada de plano grátis aqui: só Página e Portal (decisão do dono, 06/11). Os preços são as opções do formulário e vêm de `src/lib/planosTabela.ts`,
  a mesma tabela da cobrança: nada de número repetido na tela. No celular a frase de apoio desce para depois do formulário, para o botão
  ficar à vista a 390 × 844. A confirmação recebe o foco. E-mail repetido tem a resposta de sempre: a página não diz quem já está na lista.
- **Entrar** reúne a apresentação do produto, a escolha de idioma e o formulário de acesso. No computador o formulário aparece sobre uma folha branca.
- **Largura**: a Revisão e o Publicar só vão para duas colunas (arte + coluna de 420 px) de **1180 px** para cima
  (breakpoint `xl`, novo); entre 1024 e 1179 a mesa fica em cima e o texto embaixo, e a folha de decisão fecha a coluna.
- **Página não encontrada**: uma prova em branco tracejada, com as marcas de corte e "404", ao lado do texto; a volta de
  lápis fica em "Ir para o início".
- **Entrada de lista** (`.entra`): sobe 10 px e aparece em escada de 55 ms (até 8 itens); só o que nasce anima, o que já
  estava na tela não repete quando a lista atualiza. **Esqueleto**: brilho que varre, em vez de piscar.
- **Botões**: o bloco de lápis azul (`.btn-tinta`) tem corpo (brilho de 1 px no topo, sombra azul embaixo) e afunda 1 px
  ao apertar; o campo (`.entrada`) clareia para branco ao focar e escurece um degrau ao apontar. A cor de seleção de texto
  é a `--tinta-clara`.

## 9. Partes: detalhe sob demanda (06/11)

Pedido do dono: encurtar as telas longas sem mudar a aparência e sem tirar recurso. O vocabulário é o que a aba Marca já
tinha, levado para `web/src/kit/Partes.tsx`. Mede-se no estado inicial, com os formulários vazios: até 1400 px no computador
e 2000 px no celular, com a ação principal sem rolagem a 1440 × 900 e 390 × 844. Listas de dados reais (Postados, a mesa de
Para aprovar) ficam fora do limite.

- **`Partes`, a tela dividida:** de 1280 px para cima, **mestre-detalhe**: lista parada de 260 px à esquerda (nome e resumo;
  a escolhida em `papel-2` e negrito, sem azul) e a parte ao lado, com título de 22 px. Abaixo, **acordeão**: uma aberta, as
  outras numa linha de pelo menos 56 px com o resumo. No mestre-detalhe há sempre uma escolhida; no acordeão dá para fechar
  todas.
- **`Parte`, uma linha solta:** para o que não ocupa a tela inteira (grupos do Modelo, Já vistas, Letra e idioma, ajustes
  do Reels, Tipo do card). `fixa`: a aberta não fecha com o clique (Marca). `manter={false}`: desmonta ao fechar, para a tela
  que guarda o estado acima dela.
- **Resumo:** em Fragment Mono, uma linha, com o que está valendo ou a contagem ("3 fontes", "ligado · às 18h"). Nunca uma
  parte fechada sem resumo. A seta fica parada; o estado está em `aria-expanded`.
- **Alerta não se esconde:** `tom` (`aviso` em âmbar, `erro` em terracota) mostra o resumo inteiro, sem o corte de uma linha,
  e a tela escolhe `padrao` para a parte com alerta abrir sozinha; `alertaPrimeiro` ordena erro, aviso, resto. O padrão vale
  **na chegada**: a parte não fecha na mão de quem está nela quando o alerta dali se resolve. Alerta novo que chega depois
  abre a parte dele se a pessoa ainda não escolheu outra, e um `role="alert"` que surge num painel escondido (a ação falhou
  depois de a pessoa sair dali) sempre abre. Parte com ação da tela
  (Adicionar, Ligar) fica antes do alerta, porque precisa ficar à vista.
- **Campo inválido:** ao salvar, a tela abre o grupo do campo e dá o foco nele (Modelos, Convite do fim).
- **Na URL:** `useParte(param, padrao)` guarda a parte aberta com `replace` e `preventScrollReset`; `nenhuma` registra que a
  pessoa fechou tudo. Parâmetros: `parte`, `grupo`, `modelo`, `previa`, `texto`, `pedir`, `card`, `ferramenta`, `ideias`,
  `ajuste`, `letra`, `dossie`, `lai`. Parâmetro antigo ou de parte que sumiu cai no padrão.
- **O que foi aberto continua vivo:** o painel monta na primeira abertura e depois só se esconde com `hidden`, e mestre-detalhe
  e acordeão são a mesma árvore. Nada do que foi digitado ou gravado se perde ao trocar de parte nem ao cruzar 1280 px, e uma
  gravação em andamento continua.
- **Foco e leitor de tela:** botão real, título real (`h2` a `h5`, conforme o lugar), `aria-controls` e região nomeada. Fechar
  a parte de cima empurra a de baixo: a linha clicada volta para a tela com `scrollIntoView({ block: "nearest" })`.
- **Barra presa:** a ação principal de formulário longo fica presa ao pé, com fundo `papel` e fio em cima, acima da navegação
  do celular (`bottom-[calc(66px+env(safe-area-inset-bottom))]`; `bottom-0` onde não há navegação, como na peça e no Criar
  veículo). A barra só alcança a posição se o contêiner começar acima dela: por isso a cabeça de Modelos sai com um modelo
  aberto e a coluna do Reels usa `display: contents` no celular.
- **Fora do padrão:** wizard onde basta uma tela, modal para o que se consulta enquanto trabalha, tooltip como único lugar de
  uma informação, rolagem interna para fingir tela curta, texto reduzido para caber. Nas prévias, quem encolhe é a arte, e
  "Prévia maior" (`?previa=grande`) devolve o tamanho.
- **No print:** `fullPage` desenha a barra presa no lugar da janela, no meio da imagem; é efeito da captura, não da tela.

## 10. O revisor de lápis azul (06/11)

Um editor experiente lendo por cima do ombro, sem chat e sem modo separado: pergunta na margem, percebe quando a pessoa respondeu
e fecha a prova. As regras ficam em `src/lib/revisor.ts`; o que depende de navegador, em `web/src/materia/Revisor.tsx`.

- **A pergunta é fixa, por código.** Nunca vem do modelo: não custa, não alucina, é igual para qualquer pessoa citada e o teste é
  exato. A IA continua sem escrever. A única inserção automática é a fala literal da transcrição, a pedido da pessoa.
- **Uma nota por parágrafo:** só de marca aberta, na ordem vítima ou menor, acusação, outro lado, conta, aspa, sem fonte, manual.
  A frase sem fonte pergunta "Quem disse isso?"; com número, "Quem disse esse número?"; já atribuída, "Tem o link? Cole no Dossiê.".
  Frase atribuída sem link segue `sem_fonte`: quem resolve é a fonte no dossiê.
- **Quando aparece:** ao sair do parágrafo, nunca no parágrafo em que a pessoa escreve. Abrir um texto mostra as notas prontas; só
  a que nasce na sessão se desenha. Sem conferência válida no parágrafo (mexido, conferindo, com falha), a nota de antes fica como
  está e nenhuma nova nasce: conferência que não rodou não vira nota nem ausência de nota.
- **Quando sai:** pergunta igual fica; pergunta diferente, a antiga se risca e a nova se desenha; sem pergunta, ela se risca e sai,
  seja por texto novo, por fonte nova ou por decisão no cartão. Com o cursor no parágrafo, a nova espera ele sair.
- **Onde:** de 1180 px para cima, o painel Marcas é a margem: a coluna rola com o texto, cada cartão fica na altura do seu parágrafo
  e o que colidiria desce até caber. A nota é a primeira linha do cartão. Abas, contagem e filtros ficam presos no topo; Dossiê e
  Ferramentas continuam como eram, e nota nova não troca a parte aberta. Abaixo de 1180 px e no foco, a nota é um widget logo
  abaixo do parágrafo, fora do documento. Clicar nela abre o cartão, como clicar na marca.
- **Aparência:** fonte do produto, em azul de ação. Entra revelada da esquerda para a direita em 300 ms, com um `sublinhado` do kit;
  o risco é o mesmo traço, na altura do meio do texto, seguido de uma saída curta. Sem fonte manuscrita: é dependência nova e lê mal
  a 15 px.
- **Fonte que acende:** link novo no dossiê confere de novo só os parágrafos com `sem_fonte` aberto. Com o editor, por streaming: a
  frase que ganhou evidência acende em verde claro, uma depois da outra. Na aba Dossiê, sem editor, só atualiza o estado.
- **Fala da gravação:** depois de uma aspa aberta e 3 palavras, a oferta segue o padrão do menu do `@`, com minuto, gravação e fala.
  Tab ou clique insere só o resto da fala, literal, e fecha a aspa; Esc dispensa para aquela aspa. Tab só é capturado com a oferta à vista.
- **Carimbo "Pode publicar":** em grafite, no pé da folha (`.carimbo-prova`), quando há palavras, nada conferindo ou por conferir,
  nenhum parágrafo não conferido ou com aviso, nenhuma marca aberta e nenhuma pendência no checklist. A assinatura do editor não dá
  carimbo: ela assume a pendência, não a resolve. Bate uma vez (180 ms) quando a prova fecha na sessão; ao abrir um texto fechado,
  está pronto; mudou o texto, ele sai. Carimbo não é ação nem validação: nem azul, nem verde.
- **Interruptor:** "Notas", na barra de formatação, guardado neste navegador (`redacao:revisor`). Desligado, somem nota, oferta da
  fala e animações; conferência, marcas, contador e carimbo seguem. Quem não edita não vê nota, oferta nem interruptor.
- **Movimento:** com `prefers-reduced-motion`, tudo aparece pronto: a nota resolvida sai sem risco e a nova entra sem traçado.
- **Fora do padrão:** balão de chat, avatar, mascote, brilho ou estrelas de IA, confete, som, gradiente, texto digitando letra a
  letra, pop-up sobre o texto (a oferta da fala é a exceção, no padrão do `@`), sugestão de frase ou reescrita.

## 11. Consumo de tokens (07/11)

Painel interno em `/admin/uso`, só para quem está em `ADMIN_USER_IDS`; para os outros, a rota não existe. O item fica no menu da
conta. Uma linha por chamada em `uso_modelo` (`src/lib/uso.ts`), com DeepSeek, Claude e Kie; Workers AI não informa tokens e fica de
fora, e a tela diz isso. A tela pergunta de novo a cada 3 s; se falhar, o número velho fica à vista dizendo de quando é. Sem gráfico:
aqui o que importa é o número exato. O jornalista não vê token.

## 12. Rodada 4: a folha sobre a mesa (10/11)

O dono pediu de novo uma UI "SOTA", desta vez aprovando um protótipo antes do porte (`design/rodada-4/`, com as notas da
proposta dentro dele; o combinado do porte está em `design/rodada-4/PORTE.md`). O Lápis azul e a Mesa de provas ficam
inteiros: papel, grafite, azul só em ação, uma marca à mão por tela, prova, régua, corte, carimbo, palco. Muda a
estrutura (densidade de ferramenta de trabalho) e o movimento. Onde este § diz diferente dos §§ 2 a 8, vale este.
Código: `web/src/estilo/rodada4.css`, `web/src/casca/Folio.tsx`, `web/src/movimento.ts`, `web/src/dica.ts`.

- **Folha sobre a mesa** (computador): a lateral e a moldura são a mesa (`--color-mesa`); o conteúdo é uma folha de papel
  por cima, com 8 px de mesa em volta, canto de 10 px e sombra de papel. A página continua rolando inteira (nada de
  rolagem por dentro): quem dá a forma é a `.moldura`, um retângulo fixo e vazado que pinta a mesa por fora. `--topo` e
  `--pe` dizem quanto a casca prende no alto e no pé; todo `sticky` de tela soma um deles. O lugar da barra de rolagem
  fica sempre reservado (`scrollbar-gutter: stable`, para a folha não andar de lado entre uma tela curta e uma longa) e
  o fundo da página também é mesa, que é o que aparece atrás da barra.
- **Lateral**: linhas de 34 px com ícone de 18; cabe inteira a 1440 × 900, sem rolar por dentro. "Nova ideia" tem a
  tecla N; "Ir para…" virou campo, com o atalho à vista. O grupo Veículo recolhe (a escolha fica no navegador; com uma
  parte dele aberta, não fecha) e a linha Fontes dele diz a situação da coleta ("coleta 08:37", "1 indisponível" em
  âmbar): a linha Fontes solta saiu. As etapas do card Em produção são grafite (andamento não é ação), com a cruz de
  registro girando no lugar do ponto azul. Ordem: seções, o card, grupo Veículo, conta.
- **Fólio**: a linha presa no alto da folha, como no alto de uma página de jornal. À esquerda, onde estou: o nome da tela
  aparece quando o título rola para fora, e a tela de um post ou de um texto põe ali o caminho de volta (`NoFolio`). À
  direita, o que está acontecendo ("2 produzindo", "1 fonte indisponível" em âmbar), a data e a praça; a tela pode
  trocar esse lado (`NoFolioDir`: o pager da fila). No celular o fólio só existe quando há caminho de volta. A data e a
  praça saíram de dentro das Ideias.
- **Tipografia**: entram os pesos 500 e 600 da Atkinson Next (rótulo de linha, botão pequeno, manchete de lista), o
  degrau que faltava entre o texto e o negrito. **Zero sem corte**: só o algarismo 0 vem de `zero-<peso>.woff2` (0,6 KB
  cada, feito da própria Atkinson por `design/rodada-4/zero.py`, com `unicode-range: U+30`). Fecha a pendência do §3. O
  mono continua com o zero cortado, e o `.mono` desce para 12 px.
- **Movimento**:
  - O que nasce do teclado não anima: paleta (que abre sempre pronta), atalho de uma tecla, Enter. O `<html>` leva
    `data-tecla` enquanto a última ação foi do teclado, e o CSS tira a troca de tela, a entrada de lista, a folha, o menu
    e o carimbo. A nota do revisor (§10) continua se desenhando: ela é resposta ao texto, não ao atalho.
  - Com o ponteiro: a tela velha sai em 90 ms e a nova entra a partir de 70 ms (quase sem sobrepor); a arte da prova
    viaja da mesa para o palco e de volta em 300 ms (`web/src/kit/arteVT.ts`); entrada de lista em 260 ms com escada de
    30 ms; marca de margem em 220 ms; a volta de lápis se desenha em 300 ms (eram 700; pedido do dono). Nada de `ease-in`.
  - **Aperto**: todo botão encolhe um pouco ao ser apertado (`scale`, que soma com o afundar do bloco de lápis azul);
    linha de lista (`data-linha`) não encolhe, escurece um tom.
  - Hover só onde há ponteiro (`@media (hover: hover)`), para o realce não ficar preso depois do toque.
  - "Reduzir movimento" não é zero: cor e opacidade continuam avisando; o que desloca, gira ou cresce para.
- **Dica** (`data-dica`, `data-tecla`): o nome e o atalho do botão que só tem ícone. A primeira espera 450 ms; com uma
  já à vista, a vizinha abre seca. Nasce do botão. Nunca é o único lugar de uma informação (§9): o botão tem rótulo.
- **Atalhos**: N (Nova ideia) e ? (folha de atalhos, também no menu da conta) entram na lista do §8.
- **Cruz de registro**: o sinal de "trabalhando" (no lugar de um spinner), vocabulário de gráfica como o resto.
- **Título de tela**: 34 px no computador (eram 44) e 12 px de respiro sob o fólio, que já ocupa 44 px. No celular, 32.
- **Ideias**: em cima, "Agora": a próxima ação num bloco só (a capa com as marcas de corte, "Para aprovar · n esperam
  você", a manchete e a volta de lápis em "Revisar a próxima") e, ao lado, a fila curta, com os três posts seguintes e
  o que está produzindo, com as quatro etapas; passando de quatro, "ver os N". Embaixo, as ideias em lista e, de 1180 px
  para cima, a **folha de pauta** da escolhida (`?ideia=`), com os fatos que a fonte traz (o GET das pautas passou a
  mandar `fatos`), o formato em dois botões e o pé preso com Produzir e Descartar; abaixo disso, cada linha traz o
  resumo e as ações dela. Atalhos só onde há a folha: J/K e as setas andam, 1 e 2 trocam o formato, P leva o foco ao
  Produzir, X abre o passo de tirar (a letra abre, o Enter decide). Sem post para revisar, a volta passa para o Produzir
  da ideia escolhida. Sem ideia nova, ficam seis à vista com a folha e três sem ela.
- **Para aprovar**: sob o título, quantos esperam e há quanto tempo ("4 esperam você · o mais antigo espera há 3 dias";
  para o repórter, "esperam aprovação"), e o seletor Mesa | Lista, guardado em `?vista=lista`. A lista é uma tabela (nº,
  miniatura, manchete, editoria, formato, espera com régua, Revisar); no celular ficam nº, miniatura, manchete e ação, e
  o resto desce para uma linha mono sob a manchete. A volta de lápis segue só na próxima; as outras provas levam
  "Revisar" com a seta (`.acao-seta`, que anda 3 px ao apontar). Embaixo, "Em produção": uma linha por rascunho, com as
  quatro etapas, que leva ao post.
- **Revisão em três colunas**: de 1180 px para cima, a fila à vista (miniaturas numeradas, a aberta marcada, até sete e
  "+n"), o palco e a coluna da conferência; o caminho de volta, o formato com a versão e o pager ficam no fólio, e a
  prova encolhe com a altura da janela para palco, tiras e barra caberem sem rolar. **Frases e fontes** entra no lugar
  de "Fatos usados" e de "De onde veio cada frase": cada frase com a fonte e, ao apontar, focar ou tocar, o trecho que a
  sustenta; o palco vai ao card dela e, onde a frase foi medida no template do render (o card redesenhado escondido, sem
  imagens), ela ganha a caixa na arte (`.chamada`). Sem medida segura (fonte do card não carregou, capa, Reels, abaixo
  de 1024 px), nenhuma caixa: posição chutada, nunca. **A decisão é a barra presa ao pé** (`.barra-decisao`), no
  computador e no celular: o passo abre dentro dela com os botões no lugar dos três (uma decisão à vista por vez), os
  motivos prontos são chips que preenchem o campo, e o carimbo "Aprovado" bate na prova por 400 ms só quando o Aprovar
  vem do ponteiro (no Publicar ele já chega assentado).
- **Prontos para postar e Publicar**: na conta manual, publicar é um **roteiro numerado** (mandar ou baixar as imagens,
  copiar a legenda, postar no Instagram, avisar com o link). O passo feito nesta visita encolhe para uma linha com o
  visto e o título o reabre; é estado de tela, por post, e nada vai para a API. A volta de lápis fica na ação do passo
  da vez; depois dos três, a vez é do bloco "Confirmar que postei". De 1180 px para cima a lista tem duas colunas: a
  mesa e, ao lado, o mesmo painel da tela do post (`PainelPublicar`) para o post escolhido (`?post=`, `aria-current` e
  aro de grafite na prova; clique simples escolhe, "Abrir o post" leva às imagens todas e ao Reels). Sob o título, a
  contagem e, quando todos os manuais vão para a mesma conta, onde se posta.
- **Postados**: a faixa de ritmo (`.ritmo`) abre a tela: sete barras dos últimos sete dias (hoje em grafite, dia sem
  post como toco) e as cifras hoje, na semana e prontos para sair. Conta só o que saiu de verdade (sem simulação), como
  o card Hoje. "Postar a próxima" fica junto do número que a pede. Certidão e Comprovante são links de texto ao lado de
  "Ver no Instagram".
- **Viagem da arte**: `levarArte` no clique e `arteQueVolta` ao desenhar (`kit/Prova.tsx`): só a arte da prova clicada
  leva o nome, e na volta só a do último post aberto. Quando só uma das telas tem a arte, ela sai e entra junto com o
  conteúdo (`:only-child`), em vez de ficar sozinha por cima da tela nova. Vale de Para aprovar e das Ideias para a
  Revisão; em Prontos para postar não há viagem.
- **Do protótipo, ficou de fora por falta de dado na API** (não se inventa): "Desfazer" depois de decidir ou postar (não
  há rota), "conferido / 1 aviso" em cada prova da lista (a lista de posts não traz a conferência), "2 fontes falam
  disso" e a contagem por cidade nas Ideias, o link para a fonte na folha de pauta, o uso do plano na linha Plano da
  lateral. O topo do editor de texto (caminho de volta no fólio, uma linha só, formatação em ícones) ficou com outra
  sessão, a pedido do dono.
- **À noite**: tema escuro, escolhido no menu da conta (Aparência: Papel · À noite), guardado neste navegador
  (`web/src/mesa.ts`). Nunca liga sozinho, nem pelo tema do sistema: a identidade é papel. `data-mesa="noite"` no
  `<html>` troca os tokens: a mesa escurece, a folha vira grafite claro, a tinta clareia e o texto sobre ela escurece
  (`--color-sobre-tinta`, no lugar do branco que antes servia de superfície e de letra). A arte do post não muda. O
  grafite escrito à mão no CSS (corte, carimbo, hachura, pontos do palco) passou a sair de `--color-texto-forte`.

## 13. Material ao lado (10/11)

A mesa do repórter com a pasta aberta ao lado da prova: as fontes, os PDFs, as gravações e os recortes do texto, lidos sem sair
dele. O componente é `web/src/materia/Material.tsx`; o encaixe na página, `TextoMateria.tsx`. O Material não confere nem escreve:
guarda trechos literais da fonte e os põe no texto onde o cursor está, com a citação já resolvida.

- **Onde:** de 1180 a 1535 px, coluna de 360 px à esquerda da folha, e o painel sai (as notas do revisor vão para baixo do
  parágrafo, como no foco); de 1536 px para cima, três colunas: Material 360, folha, painel 300. A coluna é `sticky` e rola
  sozinha, e só ela: o leitor centra o trecho dentro da coluna, nunca a página. Abaixo de 1180 px, a `Folha` de baixo.
  Material e foco se excluem: ligar um desliga o outro. `html[data-sem-lateral]` (antes `data-foco`) tira a lateral da casca
  nos dois casos, e a moldura da rodada 4 (§12) encosta na esquerda. A coluna fica abaixo do fólio e acima do pé da moldura:
  soma `--topo` e `--pe`, como todo `sticky` de tela.
- **Entradas:** botão **Material** na barra de formatação (`aria-pressed`; quem só lê tem a barra só com ele), "Abrir o
  material" e "Procurar no material" na paleta Ctrl/⌘K, e "Ler ao lado" em cada fonte do Dossiê. Na URL: `material=aberto`,
  `fonte=<tipo>:<id>` (o leitor aberto) e `material-parte` (a parte aberta), sempre com `replace` e `preventScrollReset`.
- **O cursor não sai do lugar.** Botão que insere não pega o foco ao apertar (`onMouseDown` com `preventDefault`), e o
  ProseMirror guarda a seleção no blur; o trecho entra onde o cursor estava. No celular, a folha de baixo guarda a seleção ao
  abrir, fecha ao inserir e a devolve antes de pôr o trecho. Quem ainda não pôs o cursor no texto (abriu e foi direto à
  fonte) recebe o trecho no fim do texto: o editor nasce com o cursor no começo, e ali o trecho colaria na primeira linha.
- **Uma busca só, no topo:** sem acento, nos recortes, nas fontes, nos PDFs e nas gravações. Os resultados vêm por tipo e por
  fonte, com o termo em negrito sobre `papel-3`; enquanto a busca nova não chega, os de antes ficam esmaecidos (não somem).
  Busca cortada no teto diz que parou. Digitar na busca com o leitor aberto volta aos resultados.
- **Cinco partes** (§9, em acordeão, `h3`): Recortes, Fontes, Documentos, Gravações, Acervo do veículo. Resumo em mono; fonte
  que mudou deixa Fontes em âmbar. Na chegada abre Recortes se houver algum; senão, Fontes.
- **O recorte é uma tira de papel:** cartão branco com o trecho entre aspas (até 4 linhas), a origem em mono ("· no texto"
  quando já está nele), a anotação com fio à esquerda e, de quem edita, subir e descer empilhados ao lado. Uma linha tracejada
  separa o recorte do que se faz com ele: **Inserir** (o único botão cheio), Só citar, Abrir na fonte; embaixo, mais
  baixos, Anotar, Guardar no acervo (`aria-pressed`) e Tirar. Fonte que saiu do dossiê: o recorte fica, em âmbar, e dá para
  inserir o trecho, não para citar. Fala de menos de 3 palavras não se insere: a conferência não a acharia na gravação.
- **O leitor:** a fonte numa folha branca, um parágrafo (página do PDF, trecho da gravação) por vez, com "Guardar recorte" e
  "Inserir" em cada um: com seleção dentro do parágrafo vale a seleção; sem, o parágrafo inteiro. O que sustenta uma
  afirmação do texto aparece em `verde-claro`. O ponto de chegada (do recorte, do achado) fica em `papel-2` e centrado. PDF
  em janelas de páginas com "Mais páginas"; gravação com o trecho tocável. "Procurar nesta fonte" filtra os parágrafos.
- **Acervo do veículo:** as fontes e os recortes guardados nos outros textos, com de onde vieram e quando. "Trazer" copia sem
  ler, processar ou transcrever de novo; o que já está no texto diz isso e não repete.
- **Custo:** digitar não desenha o Material de novo. Ele é `memo`, recebe ações estáveis (uma ponte com `useRef`) e o estado
  salvo, nunca o documento vivo; desenha uma vez por salvamento, porque "no texto" depende do texto salvo.
- **Botões da barra:** com o Material, a barra de formatação passou a ter 8 px de lado por botão (eram 10) e, no computador,
  2 px entre eles (eram 4), para caber numa linha a 1440 px (com a lateral e o painel à vista, na folha mais estreita da
  rodada 4) e nas três colunas de 1600 px. O e2e da matéria confere a linha única a 1440.
- **Fora do padrão:** modal no computador, gaveta por cima do texto, cor de lápis no Material (o lápis é do revisor), resumo
  feito por IA, trecho reescrito, arrastar para o texto (o cursor é o lugar), ícone sem rótulo.
