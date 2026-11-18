# Gazzpush

Plataforma pra página/portal de notícias gerar peças a partir de fontes monitoradas:
cada frase presa a um fato com fonte, arte na marca sem foto de terceiro, revisão humana,
publicação nas redes. A instalação própria roda na sua conta Cloudflare. [Instalar e executar](#instalação-própria).

## Decisões

- Cada veículo tem seu próprio espaço de trabalho. A equipe revisa o material e decide quando publicar. A publicação manual e a cobrança via Stripe são configuráveis.
- **Geografia por tenant.** `modo=local` filtra por área (município obrigatório, bairro opcional).
  `modo=tematico` (entretenimento, tech...) filtra por temas e ignora geografia. `modo=autoral` (02/11): a página do
  próprio autor, criada pela URL do Substack; todo texto das fontes dele vira pauta, a redação escreve na voz dele e o
  card assina com o nome dele. Em **Textos**, a mesa revisora confere cada afirmação
  do texto do autor contra um dossiê de links (DeepSeek aponta, o código confere o trecho literal; nada é reescrito)
  e o cron diário `0 9 * * *` relê o dossiê e avisa fonte mudada (migração `0007_mesa.sql`).
- **Sem Supabase.** D1 (metadado), R2 (bruto, texto, artes), KV (config), Queues (monitor),
  Workflows (peça), Browser Rendering (arte), Workers AI + AI Gateway (triagem/redação), Vectorize (dedupe).
- **1 Worker** no MVP. Divide quando doer.
- **Validação determinística** antes da revisão: frase sem fato, número/data/bairro fora da fonte → falha.

## Arquitetura

- **Vite + React SPA** em `web/`, servida como `assets` do mesmo Worker (`not_found_handling: spa`,
  `run_worker_first: ["/api/*","/media/*","/health"]`). Sem SSR. React Router library mode, lazy por tela.
- **Login: Better Auth em D1** (`database: env.DB`), e-mail/senha + Google, cadastro aberto (SaaS). Autorização
  multi-tenant em `membros` via `requireMembro`; rotas `/api/t/:tenantId/...`. `por` da decisão vem do usuário
  autenticado, nunca do body. Sem Cloudflare Access.
- **TanStack Query + Hono RPC** (`hc<AppType>`, `import type`). Query keys começam por `tenantId`.
- **Tailwind + shadcn/ui**, mobile-first. Manifest PWA sem service worker.
- **Polling** em endpoint leve `/status` (só D1): 2 s produzindo, 15–30 s em revisão, para em estado final.
  Decisão de revisão envia `versao` esperada → 409.
- **Mídia:** `/media/*` passa a exigir sessão + tenant; rota assinada efêmera só pro Instagram, criada ao publicar.
- **Dev:** `vite build --watch` + `wrangler dev --live-reload`, mesma origem. **Nunca** proxy 5173→8787.
- Dois tsconfigs (Worker sem DOM, web com DOM). Bundle: limite 64 MiB sem compressão (set/2026).
- Evitar: SSR no Worker, Pages separado, Cloudflare Access como login, auth própria, JWT em localStorage,
  WebSocket/DO pra esperar 60 s, service worker offline, token da Meta fora do servidor.

## Recursos

| Recurso | Nome |
|---|---|
| D1 | `redacao-db` |
| R2 | `redacao-media` |
| KV | `REDACAO_CONFIG` |
| Queues | `redacao-monitor`, `redacao-monitor-dlq` |
| Vectorize | `redacao-dedupe` (1024, cosine, bge-m3), `redacao-documentos` (1024, cosine, bge-m3; um namespace por PDF) |
| Workflows | `redacao-producao` (`ProducaoWorkflow`), `redacao-publicacao` (`PublicacaoWorkflow`) |

## Fluxo

```
cron 15min → fontes vencidas → Queue → fetch + parse RSS → documentos (D1) + bruto (R2)
      → extrair texto → triar (schema restrito) → fatos com span → pauta sugerida
POST /api/t/:tenant/pautas/:id/produzir → ProducaoWorkflow (<peca>-r<n>):
      redigir (DeepSeek, idempotente por versão) → validar (até 3 redações) → ilustrar → renderizar → peça em revisão
POST /api/t/:tenant/pecas/:id/revisao {aprovar|reescrever|rejeitar}   → grava `decisoes` + transição num batch
      aprovar + conta manual  → peça aprovada; operador publica pelo celular → POST …/publicada {url}
      aprovar + outra conta   → PublicacaoWorkflow (<peca>-pub-<n>): sleepUntil(agendado) → publicar → `publicacoes`
      reescrever              → ProducaoWorkflow da rodada seguinte (máx. 3 rodadas)
POST /api/t/:tenant/pecas/:id/reels {musica} → peça formato reels → ProducaoWorkflow: copiar o carrossel → conferir
      → Container do Reels (MP4 no R2) → revisão → mesma aprovação e publicação (REELS na Graph API)
```

Status de peça, pauta e documento só muda em `src/kernel/estados.ts` (`transitar`): tabela de transições, UPDATE
condicional, evento e efeitos extras no mesmo `DB.batch`. Enums ficam em código, não em CHECK do SQLite.

## Comandos

```powershell
npm run check              # tsc (Worker + testes)
npm test                   # vitest no workerd: transições, auth, IDOR, Workflows, idempotência, funções puras
npm run db:migrate:local   # D1 local
npm run auth:schema        # regera migrations/0002_auth.sql pela CLI do Better Auth (só antes do 1º deploy)
npm run dev                # wrangler dev
npm run db:migrate         # D1 remoto
npm run deploy
```

Secrets: copie `.dev.vars.example` → `.dev.vars`. Produção: `wrangler secret put NOME`.

## Reels (Fase 4)

O Reels é o carrossel animado em 9:16, sem narração: os mesmos cards (templates `src/templates/card.html` e
`convite.html` com a classe `r916`) viram uma composição HyperFrames (`src/lib/reelsHtml.ts`) e o Container do Reels
(`container/reels/`, HyperFrames + Chrome sem tela + FFmpeg) devolve o MP4 de 1080×1920. Na Revisão de um carrossel,
"Fazer Reels" abre a tela do Reels; o Reels vira um post novo (formato `reels`) que passa por Para aprovar e Publicar.

### O que o Container exige em produção

1. **Plano Workers Paid** (US$ 5 por mês): Containers não roda no plano grátis.
2. **Docker na máquina do deploy.** `npm run deploy` (wrangler) monta a imagem de `container/reels/Dockerfile` e envia
   para o registro da Cloudflare; sem Docker ligado, o deploy para no passo do container.
3. **Primeiro deploy:** `npm run deploy` cria o Durable Object `ReelsContainer` (migração `v1` do `wrangler.jsonc`) e
   a aplicação do container. Confira com `npx wrangler containers list` e `npx wrangler containers images list`.
4. **Instância:** `standard-3` (2 vCPU, 8 GiB), até 3 ao mesmo tempo (`max_instances`). Dorme 2 min depois do último
   Reels. Custo estimado por vídeo perto de US$ 0,007 (spike).
5. **Medir de novo** o primeiro Reels em produção: o tempo do container vai no evento `peca.reels` (`tempoMs`).

Local: o `wrangler dev` não sobe container no Windows (só Linux ou WSL), e o `wrangler.jsonc` deixa o container
desligado no dev (`dev.enable_containers: false`). Para fazer um Reels de verdade no Windows, suba o mesmo container
no Docker e aponte o Worker para ele:

```sh
cd container/reels && docker build -t redacao-reels . && docker run --rm -d --name reels -p 127.0.0.1:8080:8080 --cpus 2 redacao-reels
# no .dev.vars: REELS_URL_LOCAL=http://localhost:8080   (depois: npm run dev)
```

No Linux ou WSL com Docker, `npx wrangler dev --enable-containers` sobe o container pela classe `ReelsContainer`, sem a
variável. Sem nada disso, tudo funciona, menos montar o vídeo (o Reels falha com o motivo na tela).

### Biblioteca de música do Reels

O repositório não traz música. A biblioteca é curta e fica no R2 (bucket `redacao-media`), montada pelo dono:

1. Escolha só faixas com licença que permita **uso comercial em rede social** (Instagram) e que **não exija crédito**
   (a legenda do Reels não leva crédito de música; faixa com `"exigeCredito": true` fica de fora). Guarde o link da página da licença da faixa (não da loja).
   Onde conferir: a página da faixa no site de onde ela veio (por exemplo a licença de conteúdo da Pixabay, ou a
   licença comprada na Epidemic Sound ou Artlist em nome do veículo). Na dúvida, não entra.
2. Suba o arquivo (MP3 ou M4A, até uns 3 MB) para `musica/<nome>.mp3`:
   `npx wrangler r2 object put redacao-media/musica/manha-calma.mp3 --file manha-calma.mp3 --remote`
3. Escreva o manifesto `musica/biblioteca.json` e suba do mesmo jeito
   (`npx wrangler r2 object put redacao-media/musica/biblioteca.json --file biblioteca.json --content-type application/json --remote`):

```json
{
  "faixas": [
    {
      "id": "manha-calma",
      "titulo": "Manhã calma",
      "autor": "Nome do autor",
      "licenca": "Nome da licença como está no site",
      "licencaUrl": "https://site-da-licenca/da-faixa",
      "arquivo": "musica/manha-calma.mp3",
      "usoComercial": true
    }
  ]
}
```

Faixa sem título, autor, licença, link `https://` da licença ou `"usoComercial": true` (a sua confirmação de que leu
a licença e ela permite uso comercial em rede social), ou com `arquivo` fora de `musica/`, não aparece. A
tela do Reels mostra a licença ao lado de cada faixa; "Sem música" é sempre uma opção. A biblioteca vale para todos os
veículos (o dono responde pela licença).

## Idiomas: português e inglês

São dois idiomas, independentes:

- **Telas, de cada pessoa.** Começa pelo idioma do navegador (português de qualquer lugar fica pt-BR; o resto, inglês) e
  a pessoa troca no menu da conta ou, antes de entrar, no pé da tela de entrar. A escolha fica na conta (`user.idioma`,
  `PUT /api/me/idioma`) e vale em qualquer aparelho. O cliente manda `x-idioma` em todo pedido e a API responde as
  mensagens de erro nele. Texto de tela fica no próprio lugar, em par: `t("Aprovar", "Approve")` na web
  (`web/src/idioma.ts`), `t(c, 'Não encontrado.', 'Not found.')` no Worker (`src/shell/idioma.ts`). Nunca chame `t()` no
  topo de um módulo: trocar o idioma remonta as telas, e uma constante avaliada na importação ficaria no idioma antigo
  (use função ou getter).
- **Conteúdo, do veículo.** `tenants.idioma` (pt-BR ou en) escolhido ao criar o veículo e trocado na Marca (Nome e
  cores). Vale para o que for produzido depois: o prompt da redação, os textos fixos do card ("Fonte:", data,
  editoria, "Siga"), o convite padrão, o fecho da legenda e a conferência (dias da semana e palavras com maiúscula que
  não são nome). Os textos fixos ficam em `src/lib/idiomaConteudo.ts`. A conferência grava os motivos de leigo nos dois
  idiomas (`validacao.en`), e a Revisão mostra no idioma da tela de quem revisa.

Migração: `migrations/0008_idioma.sql` (local já aplicada pelos testes; remota com `npm run db:migrate`).

Limites conhecidos: a triagem das notícias continua pensada para notícia brasileira (cidades do IBGE), então veículo em
inglês faz mais sentido no modo autor ou temático; título em Title Case (todas as palavras com maiúscula) conta como nome
na conferência, e o prompt pede sentence case; o erro de conferência da mesa revisora já gravado no banco e os nomes
de fonte manual criados antes ficam no idioma em que foram gravados.

## A Matéria (veículo de autor)

O jornalista apura uma vez, e tudo o que sai (Substack, carrossel, Reels) leva a prova junto. A Matéria é o registro
de `textos`, com abas na URL da mesa (`/t/:veiculo/textos/:id?aba=`): **Dossiê** (as evidências e o que cada uma
sustenta), **Texto** (a mesa revisora), **Posts** (as peças de todas as pautas que saíram do texto, ligadas por
`pautas.texto_id`) e **Depois** (as fontes do dossiê que mudaram). Só o veículo `autoral` tem a Matéria; `local` e
`tematico` seguem o fluxo de sempre.

- **O carrossel herda as evidências** (`src/lib/materia.ts`, `POST /t/:id/textos/:id/instagram`): a pauta não é mais o
  texto inteiro como relato. Cada afirmação `com_evidencia` da versão conferida vira um fato `afirmacao` (o texto é a
  frase do autor, a fonte é a URL da evidência e `fatos.evidencia_trecho` guarda o trecho literal dela); frase sem
  fonte não vira fato. Versão não conferida dá 409 `nao_conferido`; risco jurídico aberto dá 409 `risco_aberto` com a
  lista em `pendencias`; sem nenhuma afirmação com evidência, 422 `sem_fatos`. A mesma versão mandada de novo devolve a
  pauta ativa. A chamada da legenda continua levando ao texto do autor (a URL da evidência nunca é o link do texto).
- **Revisão:** post de uma Matéria mostra "De onde veio cada frase": por frase do card, o trecho da evidência em fundo
  verde claro e o link.
- Migração `0009_materia.sql` (só colunas novas; a última pauta de cada texto entra em `pautas.texto_id`).

### Editor e conferência por parágrafo (Fase 2)

- **Editor:** Tiptap (ProseMirror), carregado só na rota da mesa (o pedaço `Mesa-*.js`). Formatação permitida:
  parágrafo, intertítulo, negrito, itálico, link e citação; o servidor limpa o resto (`src/lib/doc.ts`, `limparDoc`).
  O documento fica em `textos.doc_json`, com um id estável por bloco; `paragrafos_json` continua, derivado dele, para
  o Docs, o Substack e o Instagram. Texto antigo sem documento abre convertido na leitura (ids `p0`, `p1`…), sem
  reescrever o banco.
- **Salvamento automático:** `PUT /textos/:id` com `{doc, versao, titulo}`, depois de 1,5 s sem digitar ou ao sair do
  parágrafo mexido. Outra pessoa salvou antes: 409 e a tela oferece recarregar (o digitado fica na tela até lá). O
  formato antigo (`{paragrafos}`) continua aceito e confere na hora.
- **Conferência por bloco** (`conferirBlocos` em `src/lib/mesa.ts`, tabela `blocos`): cada bloco guarda o hash do
  texto; só o bloco com hash novo vai ao modelo. Uma chamada por bloco, até 4 ao mesmo tempo, com o dossiê e o texto
  inteiro antes (prefixo igual em todos os blocos, que o DeepSeek cobra mais barato) e o bloco no fim. O resultado só é
  gravado se o bloco ainda tem o mesmo texto. Modelo fora, recusa ou resposta inválida: o bloco fica "não conferido"
  com o motivo, à vista no painel (nunca some calado). As marcas se prendem ao bloco (`afirmacoes.bloco_id`) e à
  posição dentro dele.
- **Streaming:** `POST /textos/:id/conferir` com `accept: application/x-ndjson` devolve uma linha por bloco pronto e a
  última com o estado inteiro; sem esse cabeçalho, o JSON inteiro no fim (o jeito de antes).
- Migração `0010_editor.sql`.

### Assistente do editor (Fase 3)

A IA confere, não escreve: nada do que está abaixo muda uma palavra do texto. Toda decisão fica gravada com quem fez e
quando (`apuracoes`, `assinaturas`).

- **Ações do cartão** (`POST /textos/:id/apuracoes`, `DELETE /textos/:id/apuracoes/:apuracao` para desfazer): **Prender
  fonte** (escolhe a evidência e cola o trecho; o código confere que o trecho está, letra por letra, no texto guardado da
  evidência, senão 422 `trecho_fora`), **Adicionar link** (põe no dossiê e confere de novo), **Procurei o outro lado**
  (quem, quando e por qual meio; só para risco de acusação sem condenação ou sem outro lado; data no futuro dá 400),
  **É opinião** (vira afirmação do autor: sai da conferência e, no carrossel, entra como opinião, nunca "com evidência")
  e **Ignorar**. A decisão fica presa ao parágrafo e ao trecho literal, então sobrevive a uma nova conferência.
- **Citação com @:** no editor, `@` abre "Citar do dossiê"; a citação é um nó `nota` (`[título da evidência]`) que
  aponta para a evidência.
- **Colar um link sozinho** cola no texto e oferece "Adicionar ao dossiê?".
- **Ctrl/⌘K:** paleta de comandos (conferir o parágrafo, pular para a próxima marca aberta, sem fonte ou de risco,
  citar, pôr link no dossiê, checklist, pessoas).
- **Contas refeitas pelo código** (`src/lib/apuracao.ts`, sem modelo): variação percentual ("de X para Y, alta de Z%"),
  parte de um todo ("12 de 40, 30%") e somas, em pt e en, com a tolerância do arredondamento escrito. Conta errada
  aponta "De 10.000.000 para 15.000.000 é alta de 50%, não de 40%."; quem corrige é o autor.
- **Aspas:** trecho entre aspas que não está no dossiê aparece como apontamento (não é marca do modelo).
- **Força da evidência** pelo tipo da fonte (`PATCH /textos/:id/evidencias/:evidencia {tipoFonte}`): documento oficial
  (forte), fonte primária (média), outra matéria (média), fonte anônima (fraca). O endereço sugere (`.gov.br`, `.jus.br`,
  diário oficial…) e a pessoa confirma. Nunca pela linha política de quem publica. Avisos: todas as frases numa fonte
  só; duas fontes que se citam ou repetem o mesmo trecho (não são independentes).
- **Pessoas e instituições** citadas (por código): onde aparecem, grafias diferentes do mesmo nome, quem foi acusado e
  se o outro lado foi procurado.
- **Manual de redação do veículo** (`GET/POST /textos/manual`, `DELETE /textos/manual/:regra`; tela Textos, "Manual
  de redação"): regras mecânicas (grafia, sigla, número, cargo, linguagem) que só apontam no texto.
- **Checklist de publicação:** "Mandar para o Instagram" trava (409 `checklist`) com risco aberto ou incerto, parágrafo
  não conferido, aspa fora do dossiê ou conta errada. O editor pode **assinar** (`POST /textos/:id/assinar
  {versao}`): fica registrado quem, quando e o que estava pendente, e vale só para aquela versão (versão nova pede
  outra assinatura; 409 se a versão mudou).
- **Segunda opinião e desvio por tema** (`src/lib/segunda.ts`, Anthropic pelo AI Gateway): com `ANTHROPIC_API_KEY`,
  (1) parágrafo com risco ou palavra de acusação vai também ao Claude; se as duas opiniões discordam, a marca fica
  **"incerto, confira"** (é risco aberto no checklist); (2) texto de tema que modelos chineses suavizam (Taiwan,
  Xinjiang, Tibete, Tiananmen, governo chinês…) é conferido inteiro pelo Claude. O cartão diz quantas opiniões houve
  ("duas opiniões: DeepSeek e Claude"). Sem a chave, a tela diz que a marca teve uma opinião só. Segunda opinião fora
  do ar: o parágrafo fica conferido com o aviso, nunca some calado. Recusa do modelo: "não conferido" com o motivo.
- **Auditoria** (`GET /textos/auditoria`; tela Textos, "Auditoria"): nos últimos seis meses, as marcas por mês, por
  tema (os eixos da bateria de simetria) e por pessoa citada, e as ignoradas com quem ignorou. Para ver se a conferência
  pesa mais para um lado.
- Migração `0011_assistente.sql` (tabelas novas `apuracoes`, `manual_regras`, `assinaturas`, `marcas_historico`;
  colunas novas `evidencias.tipo_fonte`, `afirmacoes.incerto`, `blocos.fornecedor`). Texto antigo abre igual.

**Segredos novos** (opcionais; sem eles a conferência segue com uma opinião só):

```sh
npx wrangler secret put ANTHROPIC_API_KEY   # liga a segunda opinião e o desvio por tema (passa pelo AI Gateway)
npx wrangler secret put SEGUNDA_MODELO      # opcional: claude-opus-5-5 (padrão) ou claude-haiku-5-5
```

### Escudo jurídico e página de fontes (Fase 4)

Tudo aqui é registro e código; a IA não entra. Rotas novas em `src/shell/textos.ts`, lógica em `src/lib/escudo.ts`.

- **Pedido de outro lado** (aba Dossiê, "Pedir o outro lado"; `POST /textos/:id/pedidos`): para quem, e-mail, prazo,
  assunto e o pedido (um modelo fixo, no idioma do veículo, com a frase de risco escolhida; a pessoa edita). Sai de
  dois jeitos. **Por e-mail pelo app** (Cloudflare Email Service): a hora gravada é a do servidor, e a resposta volta
  para `outro-lado+<token>@<domínio do remetente>`. **Copiado**: a pessoa manda por fora e diz quando e por onde (essa
  hora é a dela; o app grava também a hora em que registrou). A frase do pedido tem de estar, letra por letra, no
  parágrafo (422 `trecho_fora`). Pedido que saiu e trata de uma frase de risco registra "outro lado procurado" nela.
  E-mail que não saiu: o pedido fica com o motivo à vista e o botão de copiar.
- **A resposta entra no dossiê** como evidência (`evidencias.origem = 'resposta'`, fonte primária, sem link nem
  Wayback, fora do monitor diário): chega pelo handler `email` do Worker (`receberEmail`, token desconhecido é
  recusado) ou é colada à mão (`POST /textos/:id/pedidos/:pedido/resposta`). Prazo vencido sem resposta aparece no
  pedido.
- **Wayback Machine** (`src/lib/wayback.ts`): cada link que entra no dossiê vai para a fila do monitor (mensagem
  `wayback`). Sem chave, o `GET https://web.archive.org/save/<url>` público, que devolve o endereço da captura (o
  `POST` da API SPN2 exige login: testado em 03/11, responde 401). Com `WAYBACK_ACCESS_KEY` e `WAYBACK_SECRET` (chaves
  S3 da conta do archive.org, em https://archive.org/account/s3.php), a API SPN2 com job e estado, com limite maior.
  Captura que demora volta para a fila em um minuto, até a última entrega da fila (4); depois disso, ou se a fila não
  aceitou a mensagem, fica "falhou" com o motivo e "Tentar de novo" (`POST /textos/:id/evidencias/:evidencia/wayback`).
- **Versões do texto** (`texto_versoes`, `src/lib/versoes.ts`): retrato da versão na conferência, na assinatura, no
  envio ao Instagram, na página de fontes e no pacote.
- **Pacote de defesa** (aba Dossiê; `GET /textos/:id/pacote`, só editor): zip com `texto/` (atual e versões),
  `dossie/` (o texto salvo de cada fonte, a cópia do Wayback quando houver, as respostas do outro lado,
  `evidencias.json` com hashes e datas), `apuracao/` (marcas, decisões com quem e quando, assinaturas, checklist),
  `outro-lado/pedidos.json`, `posts/` (cada post aprovado com a versão, quem aprovou e quando, as artes e a
  publicação), `pagina-de-fontes.json`, `manifesto.json` (SHA-256 de cada arquivo), `manifesto.json.tsr` (carimbo de
  tempo RFC 3161 do manifesto) e `LEIA-ME.txt`. TSA fora do ar: o pacote sai assim mesmo, sem o `.tsr`, e o LEIA-ME e
  a tela dizem por quê. Cada pacote fica registrado em `pacotes_defesa` (o carimbo também no R2, `pacotes/`).
  O zip é montado na memória do Worker (128 MB): os arquivos binários (PDFs, áudios, artes, cópias do Wayback) têm um
  teto de 40 MB por pacote. O que não cabe, ou sumiu do armazenamento, fica fora, listado em `foraDoPacote` no
  manifesto (com o SHA-256 do envio) e no LEIA-ME; a tela avisa quantos (cabeçalho `x-pacote-fora`).
- **Carimbo de tempo** (`src/lib/carimbo.ts`, `pkijs`): RFC 3161 na FreeTSA (`https://freetsa.org/tsr`, gratuita, sem
  chave); `TSA_URL` troca a autoridade (por exemplo `http://timestamp.digicert.com`), e aí `TSA_RAIZ` (o certificado
  raiz da autoridade em DER, base64) é obrigatório: sem raiz confiável o app não carimba. O app confere o carimbo antes
  de pôr no pacote: o hash é o do manifesto, o nonce é o do pedido, a assinatura vale e a cadeia do certificado chega
  à raiz confiável (a da FreeTSA vem no código), válida na hora do carimbo e com o uso `timeStamping`. **Verificar sem o app:**

  ```sh
  curl -O https://freetsa.org/files/tsa.crt -O https://freetsa.org/files/cacert.pem
  openssl ts -verify -data manifesto.json -in manifesto.json.tsr -CAfile cacert.pem -untrusted tsa.crt   # "Verification: OK"
  openssl ts -reply -in manifesto.json.tsr -text                                                         # a hora da autoridade
  sha256sum dossie/01-*.txt   # cada arquivo tem de bater com o hash no manifesto.json
  ```

  Mudou um arquivo, o hash dele deixa de bater com o manifesto; mudou o manifesto, o carimbo deixa de conferir.
- **Página de fontes pública "Como apuramos"** (`POST`/`DELETE /textos/:id/pagina-fontes`; servida pelo Worker em
  `/fontes/:id`, sem sessão, em `run_worker_first`): só quando o editor publica, da versão conferida, com o mesmo
  checklist do Instagram (pendência sem assinatura dá 409). Retrato congelado: cada frase com fonte, o trecho literal
  da fonte, a opinião do autor marcada como opinião e a lista de fontes com link e cópia do Wayback. Fica de fora:
  frase sem fonte ou de risco, explicação da conferência, pedidos e respostas de outro lado, nomes da equipe, ids.
  Publicar de novo tira a anterior do ar; o endereço é aleatório.
- **Card final "Como apuramos"** no carrossel: com a página no ar, "Mandar para o Instagram" leva (caixa marcada) o
  convite do sistema trocado pelo card com o link da página, e a legenda fecha com ele (`escolherCta`, `pautas.fontes_url`).
- Migração `0012_escudo.sql` (tabelas novas `pedidos_outro_lado`, `texto_versoes`, `paginas_fontes`, `pacotes_defesa`;
  colunas novas em `evidencias` e `pautas`). Dependências novas: `pkijs`, `asn1js`, `fflate`, `postal-mime`.

**Para o dono configurar em produção** (tudo opcional; sem isso o pedido é copiado, o Wayback usa o público e o
carimbo usa a FreeTSA):

```sh
# E-mail de saída (Cloudflare Email Service; mandar para qualquer destinatário exige Workers Paid e o domínio
# cadastrado no Email Service). No wrangler.jsonc: "send_email": [{ "name": "EMAIL" }]
npx wrangler secret put EMAIL_REMETENTE      # remetente de um domínio verificado no Email Service
# Resposta de volta: Email Routing do mesmo domínio com uma regra catch-all (ou outro-lado+*) para este Worker.
npx wrangler secret put WAYBACK_ACCESS_KEY   # opcional: chaves S3 do archive.org (Save Page Now com limite maior)
npx wrangler secret put WAYBACK_SECRET
npx wrangler secret put TSA_URL              # opcional: outra autoridade RFC 3161 (padrão FreeTSA)
npx wrangler secret put TSA_RAIZ             # obrigatório com TSA_URL: o certificado raiz da autoridade, DER em base64
#   ex.: openssl x509 -in raiz.pem -outform DER | base64 -w0
```

### Pergunte ao documento (Fase 5)

O PDF do dossiê vira perguntas com resposta citada. Rotas em `src/shell/textos.ts`, lógica em `src/lib/documento.ts`.

- **Envio** (aba Dossiê, "Enviar PDF"; `POST /textos/:id/documentos`, o PDF cru no corpo e o nome no cabeçalho
  `x-nome`, só editor): até 20 MB e 500 páginas; o que não começa com `%PDF-` dá 422. O mesmo arquivo de novo (mesmo
  SHA-256) é o de antes. O original fica no R2 (`documentos/<veículo>/<id>.pdf`; `GET .../documentos/:arquivo/pdf`
  abre) e a leitura vai para a fila do monitor (mensagem `arquivo`).
- **Leitura** (`processarArquivo`, `unpdf`): o texto de cada página, guardado em `arquivo_paginas` e no índice FTS5
  (`arquivo_paginas_fts`, sem acento). Com o índice Vectorize, pedaços de cada página entram em `redacao-documentos`
  (bge-m3, namespace = id do arquivo); falha no índice deixa a busca só por palavra, com aviso. PDF só de imagem
  (sem texto) ou quebrado: "não deu para ler", com o motivo.
- **Pergunta** (`POST .../documentos/:arquivo/perguntas`): as páginas mais próximas (palavra + sentido, fusão por
  posição) vão ao DeepSeek, que responde em JSON com página e trecho. O código confere cada citação: a página tem de
  estar entre as enviadas e o trecho, letra por letra (espaços à parte, 8+ caracteres), na página. Sem citação que
  confira, a resposta é "não encontrei no documento" e as citações descartadas ficam contadas; pergunta sem nenhuma
  página achada nem chama o modelo. Modelo fora: 502, sem resposta. Cada pergunta fica registrada (`perguntas`).
- **O trecho vira evidência** ("Usar como evidência"; `POST .../documentos/:arquivo/evidencia`): o trecho é conferido
  de novo na página (422 `trecho_fora`); a página inteira entra no dossiê como evidência `origem = 'documento'`
  (título "arquivo.pdf, p. N"), e a conferência da Matéria usa como qualquer fonte. Na página de fontes pública ela
  aparece com o nome do documento, sem link.
- **O que o documento traz**, por código: pessoas e instituições, empresas, valores em reais
  e datas, com as páginas.
- **Cruzamento com o texto**: o total (ou a soma dos valores) de uma página do documento contra o valor que o texto
  diz, na mesma ordem de grandeza; diferente, vira apontamento de conta no editor e pendência no checklist
  ("relatório.pdf, p. 2: o total é R$ 48 milhões; o texto diz R$ 40 milhões").
- **Pacote de defesa**: os PDFs originais em `dossie/documentos/` e `documentos.json` com as perguntas, respostas,
  citações e descartes.
- Migração `0013_documentos.sql` (`arquivos`, `arquivo_paginas`, `arquivo_paginas_fts`, `perguntas`). Dependência
  nova: `unpdf`. Custo por pergunta (DeepSeek, até 5 páginas de contexto, uns 5 mil tokens): cerca de US$ 0,002.

Para criar o índice de documentos na conta da instalação, execute o comando abaixo.

```sh
npx wrangler vectorize create redacao-documentos --dimensions=1024 --metric=cosine
```

Sem o binding `DOCS_VETOR` (ou com `BUSCA_VETORIAL=desligada`) a busca é só por palavra.

### Aspas contra a gravação (Fase 6)

O áudio da entrevista confere as aspas do texto. Rotas em `src/shell/textos.ts`, lógica em `src/lib/gravacao.ts`.

- **Envio** (aba Dossiê, "Enviar áudio"; `POST /textos/:id/gravacoes`, o áudio cru no corpo e o nome em `x-nome`, só
  editor): até 25 MB; o formato é lido pelo começo do arquivo (MP3, M4A/MP4, WAV, OGG, FLAC, WebM, AAC), outro dá
  422. O mesmo arquivo de novo é o de antes. O original fica no R2 (`gravacoes/<veículo>/<id>.<ext>`, na tabela
  `arquivos` com `tipo = 'audio'`) e a transcrição vai para a fila do monitor (mensagem `gravacao`).
- **Transcrição** (`processarGravacao`): Whisper do Workers AI (`@cf/openai/whisper-large-v3-turbo`, no idioma do
  veículo, com filtro de silêncio), guardada como veio, trecho a trecho com o tempo de cada palavra
  (`gravacao_trechos`). O modelo não resume nem corrige nada. Whisper fora do ar ou áudio sem fala: a gravação fica
  "não deu para transcrever", com o motivo.
- **Conferência das aspas** (por código, em `analisar`): cada citação entre aspas do texto (a palavra solta entre
  aspas é destaque e fica de fora, a não ser que seja fala: com a pontuação dentro, “Sim.”, ou depois de dois-pontos ou
  de verbo de dizer) que não está numa fonte do dossiê é procurada nas transcrições prontas, palavra por palavra, sem pontuação,
  maiúsculas nem acentos (que a fala não tem), com três palavras ou mais. Achou: marca verde "bate com a gravação aos
  mm:ss" (o tempo da primeira palavra), com o trecho tocável no cartão; não é pendência. Não achou: segue "aspa sem
  fonte" (âmbar), pendência do checklist, e a explicação diz que não está nem nas gravações. Enquanto uma gravação
  está na fila, a aspa fica aberta e diz que a transcrição ainda não terminou.
- **Tocar** (`GET .../gravacoes/:arquivo/audio`, com `Range`): o navegador pula para o minuto da citação e para no
  fim dela. A transcrição inteira, com o minuto de cada trecho: `GET .../gravacoes/:arquivo/transcricao`.
- **Pacote de defesa**: o áudio original e `NN-nome.transcricao.json` (trechos, palavras com o tempo, modelo) em
  `dossie/gravacoes/`.
- Migração `0014_gravacoes.sql` (colunas `mime` e `duracao` em `arquivos`; tabela `gravacao_trechos`). Nenhum
  segredo novo: usa o binding `AI` que já existe. Custo: US$ 0,000513 por minuto de áudio (uma entrevista de 30
  minutos, cerca de US$ 0,015). Limite: 25 MB por arquivo (o Worker para de ler o corpo ao passar do teto);
  entrevista maior vai em partes. Transcrição que falhou: mandar o mesmo arquivo de novo recomeça.

### Matéria viva e LAI (Fase 7)

Depois de apurada, a matéria continua vigiada. Lógica em `src/lib/viva.ts` (alertas) e `src/lib/lai.ts` (LAI).

- **Alertas na aba Depois** (`alertas`, um por fato, sem repetir): fonte do dossiê que mudou (o monitor diário que já
  existia) ou que não responde há 3 tentativas; pessoa citada numa matéria do veículo (nome de duas palavras ou mais)
  que aparece em notícia nova das fontes do veículo (na fila do monitor, depois da triagem); processo citado no texto
  (número do CNJ com o dígito conferido) com movimento novo no DataJud; prazo de LAI a 3 dias ou vencido. A lista de
  Textos mostra quantos alertas abertos cada matéria tem.
- **O que fazer com o alerta** (só editor): "Atualizei o texto" ou "Ignorar" (registrados, com quem e quando;
  `POST /textos/:id/alertas/:alerta/resolver`), ou **post de Atualização ou Errata**
  (`POST /textos/:id/alertas/:alerta/post`): a pessoa escreve o que mudou (20 a 600 caracteres; vai como afirmação
  dela) e sai um post novo, de uma imagem, com "Atualização:" ou "Errata:" ("Update:"/"Correction:" no veículo em
  inglês) na manchete, na capa e na legenda, posto por código (`pautas.tipo_post`). O post de antes não é tocado: o
  Instagram não troca a imagem de post publicado. O texto só muda quando a pessoa edita.
- **Processos (DataJud)**: a API pública do CNJ (`POST https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search`,
  cabeçalho `Authorization: APIKey <chave>`), com o tribunal tirado do segmento J.TR do número (TJs, TRFs, TRTs,
  TREs, STJ, TST, TSE, STM e TJMs; o STF não está no DataJud). Uma consulta por dia (cron das 06h, pela fila); a
  primeira guarda o último movimento, e movimento mais novo vira alerta. **Atenção:** os termos de uso do DataJud
  falam em uso "para fins legais, não comerciais e autorizados"
  (https://datajud-wiki.cnj.jus.br/api-publica/termo-uso). Por isso o acompanhamento fica desligado até o dono pôr a
  chave, depois de decidir se o uso cabe nos termos.
- **LAI** (aba Dossiê, "Pedidos de LAI"): a frase sem fonte que cita órgão público (Prefeitura, Câmara, Secretaria,
  Ministério, Tribunal…; achado por código) vira candidata. O app monta o pedido em português, com a base legal
  (art. 5º, XXXIII, da Constituição; Lei nº 12.527/2011: sem motivo exigido, art. 10, § 3º; prazo de 20 dias
  prorrogáveis por 10, art. 11, §§ 1º e 2º; parte não sigilosa, art. 7º, § 2º); a frase é conferida letra por letra
  no parágrafo (422 `trecho_fora`). **Envio:** o Fala.BR tem API, mas ela é das ouvidorias dos órgãos, com credencial
  dada pela CGU, e não registra pedido de cidadão (https://wiki.cgu.gov.br/index.php?title=Fala.BR_-_API_Faq).
  Então o pedido sai pronto para copiar e colar no portal (Fala.BR no Executivo federal, o e-SIC do estado ou do
  município), e o app não entra em portal do governo. Depois: o protocolo e a data (o prazo conta daí, em dias
  corridos; o fim que cai em sábado, domingo, feriado nacional ou Sexta-feira Santa passa para o dia útil seguinte, e
  o prazo do órgão federal pula também Carnaval e Corpus Christi; feriado estadual e municipal e ponto facultativo
  decretado no ano o app não conhece, e a tela avisa para conferir; o prazo da pessoa, o do recurso, nunca conta ponto
  facultativo, para ninguém perder o prazo por um dia que não vale), a prorrogação, a
  resposta (vai para o dossiê como fonte oficial, `evidencias.origem = 'lai'`, e não sai do dossiê enquanto o pedido
  existir) e o próximo passo. Resposta que não atende: o **recurso** (art. 15 da Lei 12.527: 10 dias da ciência, à
  autoridade acima). Órgão federal que não respondeu: a **reclamação** (Decreto 7.724/2012, art. 22: à autoridade de
  monitoramento, de 10 dias, contados depois de 30 dias do pedido); o botão só abre quando a janela abre (409 `cedo`),
  e passado o fim a tela diz que o prazo terminou; o recurso só é registrado com data até o último dia (422
  `fora_do_prazo`). Estados e municípios têm regras próprias para a omissão; o app monta o recurso e avisa. A resposta
  ao recurso ou à reclamação também entra no dossiê. Negado de novo, a instância seguinte (CGU, art. 16) fica com a
  pessoa, e a tela diz qual é (Decreto 7.724/2012: recurso negado vai à autoridade máxima do órgão, art. 21, parágrafo
  único, e depois à CGU, art. 23; reclamação sem resultado vai direto à CGU, art. 23). Rotas:
  `POST /textos/:id/lai` e `POST /textos/:id/lai/:pedido/(protocolo|prorrogacao|resposta|recurso)`. O cron diário
  manda um texto por mensagem da fila (mensagem `lai`), e o alerta de prazo aparece sem ninguém abrir a matéria.
- **Pacote de defesa**: `lai/pedidos.json` (com o recurso, a resposta a ele e a evidência dela) e `depois/alertas.json`.
- Migração `0015_viva.sql` (tabelas `alertas`, `processos`, `pedidos_lai`; coluna `pautas.tipo_post`). A redação do
  post agora usa o mesmo endereço do DeepSeek da conferência definido por `urlDeepseek`.

**Para o dono configurar** (opcional):

```sh
# Só depois de decidir que o uso cabe nos termos do DataJud (não comercial). A chave é a pública do wiki do CNJ.
npx wrangler secret put DATAJUD_API_KEY
```

### Revisão da Matéria (03/11)

Uma revisão independente (Codex) das sete fases achou defeitos de concorrência, de fila e de regra; foram corrigidos
com teste. O que muda para quem usa ou opera:

- **Pauta da Matéria**: a chave é a versão do texto mais o estado da apuração (`pautas.materia_chave`, índice único
  parcial). Mudou a apuração na mesma versão, sai outra pauta; dois envios ao mesmo tempo dão uma pauta só; produção
  que falhou recomeça.
- **Assinatura do checklist**: vale para as pendências que o editor viu. Pendência nova na mesma versão (por exemplo,
  a fonte saiu do dossiê) pede outra assinatura. Evidência tirada do dossiê desfaz a "fonte presa" com quem e quando.
- **Outro lado**: o contato só vale para a pessoa que a frase acusa quando a frase acusa uma pessoa só; a data não
  pode ser futura nem inexistente. Mudou ou saiu o parágrafo do outro lado, as acusações voltam a "por conferir".
- **Conferência**: vai por rodadas de até 150 parágrafos por pedido (teto de consultas do Worker); a tela pede a
  rodada seguinte sozinha.
- **Fila**: PDF, áudio e Wayback que esgotam as tentativas, ou que a fila não aceitou, ficam "falhou" com o motivo
  (nunca "lendo" para sempre); mandar o mesmo arquivo de novo recomeça. Entrega duplicada não lê duas vezes
  (`arquivos.processando_em`).
- **Pergunte ao documento**: cada pergunta tem situação (`respondida`, `nao_encontrou`, `invalida`, `falhou`); citação
  inventada na resposta a invalida. Busca por sentido fora do ar: resposta só por palavra, com aviso.
- Migração `0016_revisao.sql` (colunas `pautas.materia_chave`, `arquivos.processando_em`, `perguntas.situacao` e
  `aviso`, `pedidos_lai.recurso_*`). Segredo novo opcional: `TSA_RAIZ` (só com `TSA_URL` de outra autoridade).

Uma segunda revisão do Codex, sobre as correções, achou dez defeitos novos e parte dos antigos ainda aberta. O que
mudou com ela:

- **Fila**: a posse do arquivo tem dono (a hora em que a entrega o pegou); só quem ainda tem a posse grava o fim. Outra
  entrega com o arquivo: esta volta para a fila depois que a posse vence (11 minutos), não é dada como feita. Na última
  entrega, a mensagem só sai da fila com a falha gravada na tela; não deu para gravar, ou o tipo não tem tela (notícia
  do monitor, fonte, LAI), ela vai para a fila morta. Mandar de novo o arquivo que ficou "lendo" sem ninguém lendo (a
  posse venceu, ou ninguém o pegou em 10 minutos) o põe na fila outra vez; dois reenvios juntos mandam uma mensagem só
  (`arquivos.fila_em`, migração `0017_fila.sql`).
- **Post do alerta**: a produção não começou (o banco recusou a peça): o alerta volta a aberto e a pauta que sobrou é
  descartada; tentar de novo faz o post.
- **Conferência por rodadas**: a rodada seguinte (`continuar`) não repete o que falhou e termina; "Conferir de novo"
  tenta outra vez. O mesmo trecho reconferido com outro tipo de risco pede outra assinatura. Dois riscos de tipos
  diferentes na mesma marca ficam os dois na explicação. Mudou ou saiu um parágrafo que cita uma pessoa que uma
  acusação também cita: a acusação volta a "por conferir".
- **Pauta antiga** (de antes da `0016`): da mesma versão e com os mesmos fatos, ganha a chave e é reaproveitada.
- **Carimbo**: o certificado que assinou vem do próprio PKI.js (emissor e série, ou identificador da chave), e o uso
  `timeStamping` tem de estar em extensão crítica (RFC 3161 §2.3). A FreeTSA passa (testado em 03/11).
- **Pacote**: entram o JPG (o que foi ao Instagram) e o PNG de cada arte; a cópia do Wayback é lida em pedaços dentro
  do teto (a grande fica fora, listada); as perguntas ao PDF levam a situação.
- **Pergunte ao documento**: em página longa, o pedaço que a busca por sentido achou vai ao modelo, mesmo sem palavra
  da pergunta; citação inventada entre aspas simples (‘ ’) também é pega.
- **Editor**: citação dentro de citação, ou lista, vira parágrafo ao salvar (o texto não some). Reimportar do Docs
  limpa as marcas só se o texto ainda está na versão lida (duas reimportações juntas não apagam a conferência da outra).

A terceira revisão do Codex, sobre essas correções, achou cinco defeitos novos e alguns pontos ainda parciais:

- **Fila**: o envio inicial que chega depois de um reenvio não manda outra mensagem. A última entrega com outra entrega
  ainda dona do arquivo vai para a fila morta (não sai como feita). Quem perdeu a posse no meio não apaga nem grava
  páginas ou trechos (cada escrita confere a posse). O cron de 15 minutos fecha como "falhou" o arquivo "lendo" que
  ninguém lê há mais de 90 minutos (`encerrarArquivosParados`): nada fica "lendo" para sempre.
- **Post do alerta**: a reabertura depende, na mesma transação, de a pauta ter saído; produção que outra pessoa começou
  nesse meio-tempo segura o alerta.
- **Rodadas**: a tela manda a lista do que falhou nesta conferência (`pular`); falha de antes, ainda não tentada nela,
  entra na rodada.
- **Riscos combinados**: a marca fica com o risco mais grave (vítima ou menor, depois acusação, depois outro lado);
  "Procurei o outro lado" não fecha marca que também expõe vítima, e a troca pede outra assinatura.
- **Aspas**: a palavra única antes de vírgula ou travessão e verbo de dizer ("“Sim”, respondeu") é fala. Na resposta do
  PDF, aspas simples retas também (o apóstrofo de "d'água" não conta). Citação de uma palavra só na resposta do PDF
  continua fora da conferência: o modelo usa aspas para nomear termos ("não usa a palavra 'desvio'").
- **Pacote**: a cópia do Wayback que cai no meio da leitura devolve ao teto o que foi contado dela.
- **Pergunte ao documento**: as janelas do pedaço achado por sentido entram inteiras antes das janelas de palavras.

## Personalização e ideias das dores (05/11)

As seções abaixo descrevem as opções disponíveis para cada veículo.

### Reels sem primeiro quadro vazio

O primeiro quadro já mostra logo e título: só a arte do card 1 entra animada. O QA de layout roda também em 1080 por 1920 (`src/lib/qaLayout.ts`), e o card reprovado para o Reels com o motivo na tela. A capa do Reels é um JPEG salvo no R2 e vai em `cover_url`; sem ela, `thumb_offset` de 1500 ms. Custo: nenhum.

### Foto do celular

Limite de 2 MB por foto, JPEG, redimensionada no navegador. Foto nova exige dizer quem fez e de quem é o direito. O enquadramento é um catálogo de focos, sem posição livre. Custo: nenhum.

### Outras manchetes

`POST /api/t/:tenantId/pecas/:id/ganchos` pede três ângulos ao DeepSeek e devolve só os que passam em `validar`. O custo soma em `pecas.custo_usd`. Custo calculado com tokens simulados (1000 de entrada, 100 de saída): US$ 0,00038 por pedido.

### Post do anunciante

Na folha Nova, aba Anúncio, fora do modo autoral. Anunciante até 80 caracteres e briefing até 4000. Cada frase do post fica presa ao briefing, e preço diferente do briefing reprova (`src/lib/validacao.ts`, número comparado inteiro, então `9,90` não passa dentro de `19,90`). O rótulo sai por código: selo em todo card, abertura e fecho da legenda, em pt-BR e inglês. Tirar o rótulo da legenda na edição manual reprova.

O link de aprovação vale 7 dias, só para a versão em que foi gerado, e o comentário tem até 1000 caracteres. `GET /anuncio/:token` não decide, porque o WhatsApp abre o link para montar a prévia; só o `POST` decide. O aviso na Revisão não trava o Aprovar: quem decide a publicação é o veículo.

O comprovante (`GET /api/t/:tenantId/pecas/:id/comprovante`) sai só de peça publicada, em PDF pelo Browser Rendering; `?html=1` devolve a mesma página. Custo: o de um post comum, mais alguns segundos de Browser Rendering por PDF. Não é nota fiscal.

Produção:

```
npx wrangler d1 migrations apply redacao-db --remote
npm run deploy
```

`/anuncio/*` precisa estar em `assets.run_worker_first` no `wrangler.jsonc` (já está): sem isso, o link cai na tela de página não encontrada do app.

### Composições de gráfica

Quatro moldes além do padrão, em `src/lib/estilo.ts`: Tarja, Coluna, Cartaz e Primeira página. Valem nos dois quadros e em todo layout, menos no convite, que não muda. O CSS entra por `{{?ESTILO_CSS}}`: sem composição, o HTML sai igual e o hash não muda. Cartaz não leva arte. O QA mede contraste só nelas, porque só nelas todo texto fica sobre cor chapada: abaixo de 4,5:1 o card reprova, com o motivo no próprio card. O canto da marca d'água entra na medida de sobreposição, só nelas. Custo: nenhum. Limite conhecido: título do layout número com uma palavra de 16 letras não cabe em 190 px, e quem barra é o QA.

### Modelos do veículo

Até seis modelos ativos por veículo, na aba Marca, seção Modelos. Só catálogo: composição, caixa do título, papel das três cores e sequência sugerida ao redator, com até 6 layouts. A peça nasce no modelo pela ordem: tipo de post, palavras no título e no resumo (até 8), editoria e, por fim, o padrão do veículo. Sem nenhum, sai o visual de hoje.

A peça grava em `conteudo_json` o campo `estilo`, com o modelo e uma cópia de cores, fontes, logo, marca d'água e assinatura. Mudar o modelo ou a marca depois não muda a peça: a Revisão mostra "Modelo mudou" ou "A marca mudou", com Aplicar, que cria versão nova pelo caminho da edição. Peça publicada não muda. Reescrever mantém o modelo. Cartaz pula a ilustração, e a peça não gasta com ela. Modelo arquivado continua valendo nas peças que já nasceram com ele.

Custo: nenhum; Cartaz reduz o custo da peça. Produção: migração `0019_estilos.sql`.

### Cota de patrocínio

Na aba Marca, seção Patrocínios, o admin cadastra nome, logo e período. O modelo liga a faixa em Patrocinador na arte. A faixa diz "Publicidade · Oferecimento" nos dois idiomas, por código, separada do texto, no lugar do selo de publicidade, que toda composição reserva. A legenda ganha uma última linha fixa, "Oferecimento: nome", que só o código escreve e `corpoDaLegenda` reconhece pelo nome exato.

Vencido, ainda por vir ou arquivado não aparece. Ficam sem faixa a editoria `policia` (`EDITORIAS_SEM_PATROCINIO`), publicidade, correção, errata e veículo autoral. O convite também. A peça congela o patrocinador ao nascer, e o Reels herda da peça de origem. O colaborador da Graph API fica fora.

Limites: logo PNG ou SVG até 512 KB, pela mesma validação do logo da marca, em `patrocinios/<tenant>/`; nome com até 60 caracteres. Custo: nenhum. Produção: migração `0020_patrocinios.sql`.

### Site do portal vira fila

Na aba Fontes, "Este é o site do veículo" (admin, fora do modo autoral). Matéria publicada depois da marcação vira pauta com `origem = 'site'`, sem filtro de área, com o corpo inteiro em fatos, pula o dedupe semântico e já entra em produção como carrossel, para chegar em Para aprovar. O que já estava no feed não vira peça: vale a data, `fontes.propria_desde`. Item sem data segue o caminho normal.

Teto: `MAX_AUTO_DIA`, 30 peças por dia em Brasília. Passou disso, a pauta fica em Ideias com "do seu site". Na Revisão, com conferência ok e uma conta só, aparece "Aprovar e ir para a próxima"; o atalho A continua só abrindo.

Custo: o de um carrossel por matéria, redação e ilustração, com o teto `MAX_CUSTO_PECA_USD` por peça. Com 30 peças por dia, esse é o custo que multiplica: confira antes de marcar um site de muito volume. Produção: migração `0021_fonte_propria.sql`.

### Resumo do dia

Na aba Fontes, "Resumo do dia às 18h" (admin). Nas Ideias, "Resumir o dia" (editor) chama a mesma função. As 5 pautas de melhor `score` das últimas 24 horas, só notícia, viram um carrossel com capa e um card por notícia. Com menos de 3, não sai resumo, e o botão diz isso. O id da pauta vem do veículo e do dia, então o mesmo dia não gera dois.

Cada card mostra a fonte da sua notícia e a data de hoje. Card que mistura duas notícias reprova na conferência. Resumo não gasta ilustração: usa a arte padrão da marca. O modelo sai por `tiposPost`, com o valor `resumo`, e pode levar faixa de patrocínio. Limite: o cron é fixo em 18h de Brasília, sem fuso por veículo.

Custo: uma redação por dia, sem ilustração. Produção: migração `0022_resumo.sql` e o cron novo `0 21 * * *`, que entra no `wrangler.jsonc` e vale no deploy.

### Ajuste conferido

Na edição, "Encurtar para caber" aparece por frase e, quando o card volta com erro de "não cabe", também no título. Traz duas versões mais curtas, geradas só com o fato daquela frase. Cada uma passa por `validar` numa cópia e por `LIMITES`; a que inventa ou não encurta some. Nada é gravado até "Salvar e conferir". Ficam de fora convite, citação, documento e frase marcada como do autor.

Custo: entra em `pecas.custo_usd`, dentro de `MAX_CUSTO_PECA_USD`. Não conta como post nos limites do plano.

### Ritmo do Reels

Cada card fica o tempo do texto dele: 2 s, mais 0,35 s por palavra, entre 2,5 e 7 s. O convite fica em 3,75 s. O passo multiplica por 0,8, 1 ou 1,25, e o total fica entre 7,5 e 60 s, com ajuste proporcional. As constantes ficam em `RITMO_REELS`, em `src/lib/reelsHtml.ts`. Movimentos: Manchete, Folha e Seco. O modelo guarda passo e movimento em `params.reels`, e a tela do Reels pode mudar para aquele Reels. Reels mais longo gasta mais tempo de Container na mesma proporção.

### Gravar no app

Na aba Dossiê do texto (modo autoral), "Gravar" mostra o tempo, o nível do microfone e "Salvo até mm:ss", que só anda com a confirmação do servidor. O áudio sobe em fatias de 5 s, em segmentos de 120 s com 1 s de sobreposição, a 48 kbps. Fatia sem confirmação fica no IndexedDB e sobe quando a rede voltar. Teto de 3 horas por sessão. Fechar a aba não perde o que subiu: ao voltar, a tela oferece concluir, e o cron de 15 minutos conclui sessão parada há mais de 2 horas.

Medição do Whisper em 05/11, pelo envio de arquivo, com WebM Opus de 48 kbps: 1,05, 4,20, 8,41, 16,82 e 19,85 MB transcreveram (26 a 253 s de fila). Em 24,90 MB, uma tentativa falhou com `8004: Internal server error` depois de 305 s, e a outra passou em 256 s. O teto de `AUDIO_MAX_BYTES` (25 MB) se sustenta, com falha intermitente perto dele. O envio de arquivo não mudou.

Produção: migração `0023_gravacao_segmentos.sql`. Sem segredo novo. Custo: o mesmo Whisper por minuto de áudio, e o R2 guarda um arquivo por segmento.

### Reels com a voz do dono

Na tela do Reels, "Com a sua voz" mostra o roteiro (títulos e frases dos cards, sem o convite) e grava ou recebe arquivo, até 90 s. O Whisper transcreve, e o código compara a fala com o roteiro: número ou nome ausente ou trocado vira aviso, com o tempo para ouvir, e número por extenso conta, em pt e en. Cada aviso pede "A fala está certa" ou gravar de novo, e "Fazer o Reels" só libera com todos decididos. A transcrição não aparece na tela nem no vídeo.

No vídeo, o tempo de cada card vem do alinhamento e, sem ele, da proporção de palavras. A legenda é a frase aprovada, que entra na hora em que é dita, no lugar que o QA 9:16 já mediu. A voz toca em volume 1, e a música, se houver, em 0,15. O convite fica 3,75 s depois da fala. A chave do MP4 inclui o SHA-256 da voz.

Produção: migração `0024_narracoes.sql`. Sem segredo novo. Custo: Whisper de até 90 s por gravação e o tempo de Container do vídeo; gravar de novo transcreve de novo. O custo do Whisper não entra em `pecas.custo_usd`, porque o Workers AI não devolve preço por chamada.

### Cards de prova

Três layouts novos no carrossel. Documento traz o nome do documento e um trecho copiado do fato, palavra por palavra, composto em tipo: não há imagem do papel, a fonte e a data no card vêm do fato da frase, e `validar` reprova trecho que não seja literal. Comparação tem dois lados e linha do tempo tem de 2 a 4 momentos. Em ambos, cada frase tem um rótulo de até 24 caracteres, obrigatório, que passa pelas mesmas conferências de número e data que o texto. O rótulo entra no tempo do Reels e no roteiro da narração. "Encurtar para caber" não aparece em documento, porque trecho literal não se reescreve.

Sem migração e sem custo novo: documento não usa ilustração. Card e peça antigos saem iguais, com o CSS novo só no card desses layouts.

### Técnica e troca de ilustração

A técnica fica no modelo: Xilogravura, Retícula, Nanquim ou "Só a imagem da marca", que segue a imagem de referência sem nomear técnica no prompt. Sem modelo, sai `TECNICA_PADRAO`, que é retícula. "Só a imagem da marca" sem imagem também sai em retícula.

O Kie exige imagem. A ordem é a referência da marca, depois `referencias/<tecnica>.png` no R2 e, sem nenhuma, o Workers AI com a técnica em texto. Na edição, "Outra ilustração" gera uma imagem para o card, até `MAX_ILUSTRACOES_CARD` (3), com o mesmo `qaImagem`. A cena sai do texto do card, e na capa sai da cena da peça. A escolhida vai no "Salvar e conferir". No render, a foto vence a ilustração do card, que vence a da peça. Convite, documento e a composição Cartaz não mostram ilustração.

Custo: no Kie, a reserva é `KIE_RESERVA_USD` (US$ 0,02 por imagem) e o gasto vem dos créditos da resposta. Em 05/11 a conta estava sem saldo (`402`), então esse valor não foi medido. No Workers AI, que levou de 5 a 9 s, o custo na peça é zero. Entra em `pecas.custo_usd`, dentro de `MAX_CUSTO_PECA_USD`, e não conta como post nos limites do plano. Produção: gerar e subir as três imagens de referência:

```sh
npx wrangler r2 object put redacao-media/referencias/xilogravura.png --file=xilogravura.png --remote
npx wrangler r2 object put redacao-media/referencias/reticula.png --file=reticula.png --remote
npx wrangler r2 object put redacao-media/referencias/nanquim.png --file=nanquim.png --remote
```

Sem elas tudo funciona, com o Workers AI.

### Piloto automático

Na aba Fontes, "Piloto automático", só admin e desligado por padrão. Sem conta que poste sozinha, o controle fica desligado e a tela diz o que falta. Depois da revisão, o step `piloto` aprova a peça só com todas as condições: piloto ligado, primeira rodada, pauta com `origem = 'site'`, `tipoPost` vazio, conferência sem erro e sem aviso, conta padrão `real`, `intermediario` ou `simulada`, e menos de `piloto_por_dia` (6) aprovações nas últimas 24 horas. Fora disso, a peça fica em Para aprovar, com o motivo no evento `peca.piloto_barrou`.

Entre posts há pelo menos `INTERVALO_PILOTO_MIN` (60). O horário é reservado em `tenants.piloto_vez_em`, num UPDATE só, para duas peças prontas ao mesmo tempo não saírem juntas. A decisão fica com `por = 'piloto'` e `ligadoPor` no payload. Postados mostra "Aprovado pelo piloto".

Custo: nenhum além da produção. Produção: migração `0025_piloto.sql`. Sem segredo novo.

### Se a conta cair

Cada post publicado de verdade ganha uma certidão: `registrarPublicacao` e `/pecas/:id/publicada` enfileiram `{ tipo: 'certidao' }`, e a publicação nunca espera por isso. Conta simulada não ganha. O manifesto traz fontes (URL, SHA-256 e data da captura), SHA-256 de cada arte, `visualBrief` e modelo da ilustração, quem aprovou, ou piloto e quem ligou, e a publicação. O carimbo é RFC 3161 sobre o manifesto, pela mesma autoridade do pacote de defesa. Autoridade fora do ar volta para a fila. Esgotadas as tentativas, a falha aparece em Postados. "Gerar certidão" serve a isso e ao post antigo, e o documento diz que o carimbo é posterior à publicação. O manifesto lista, por card, a origem da arte: foto com autor e tipo, ilustração gerada com o modelo, ou card sem arte. Foto gravada antes do campo sai como "não registrado"; certidão já emitida não muda.

O download é um zip por peça, com `certidao.pdf`, `manifesto.json`, `carimbo.tsr` e `LEIA-ME.txt`. A aba "Se a conta cair", na tela do veículo, tem o que fazer agora, o caso aberto com os dias contados, três modelos fixos para copiar e as certidões do mês. O prazo vem do aviso que a pessoa recebeu: o app não tem prazo da Meta.

Custo: um carimbo por post, grátis na FreeTSA, e um PDF no Browser Rendering por download. Produção: migração `0026_kit.sql`. Sem segredo novo.

### Raio-X e reserva

Raio-X: a pessoa pede o arquivo em Baixar suas informações, em JSON, e escolhe o zip na aba do kit. O navegador lê em streaming, com duas passadas sobre o arquivo: a primeira só nos JSON, a segunda só nas mídias. O leitor procura objetos com `uri` e `creation_timestamp` em qualquer JSON, resolve o `uri` pela raiz do zip e conserta o acento. Mensagens privadas não são lidas. Cada imagem vira JPEG de até 512 px, e vídeo vira um quadro. O app sobe só isso e a legenda, até `MAX_ITENS_LOTE` (2.000). Um veículo tem um raio-X por vez. A fila `raiox` usa `@cf/meta/llama-3.2-11b-vision-instruct`, e o código procura crédito na legenda. O app não apaga nada e não sugere apagar.

Reserva: "Mandar para o Canal" em Prontos para postar, sem API. Página pública em `/v/:slug`, desligada por padrão e ligada pelo admin no kit, com 30 posts por página, sem conta simulada e com publicidade rotulada. "Baixar o mês" monta o zip em streaming, com artes, legenda, link e certidão (`manifesto.json` e `carimbo.tsr`, sem o PDF, para não abrir um navegador por post).

Custo medido em 06/11 com três imagens reais: 8,55 neurons por imagem (1.702 tokens de entrada e 17 de saída), de 1,2 a 1,9 s. No preço da Cloudflare de 20/10/2026, são US$ 0,000094 por imagem, ou US$ 0,19 por 2.000 imagens, antes dos 10.000 neurons grátis por dia. Produção: migração `0027_raiox.sql`. `/v/*` entrou em `run_worker_first`, e vale no deploy. Sem segredo novo.

### Folha para o advogado

No modo autoral, ao lado do pacote de defesa, "Folha para o advogado" baixa um PDF curto: só as frases com marca de risco, o tipo do risco, a evidência (trecho literal e link, conferidos contra o texto salvo da fonte) e o outro lado (quem, data e resposta). Traz versão, data e SHA-256 do conteúdo. A nota do modelo não entra, nenhuma frase é reescrita e nada é sugerido. Texto não conferido na versão atual recebe a mensagem para conferir antes. Sem risco, a folha diz isso.

Custo: um PDF no Browser Rendering por download. Sem migração e sem segredo novo.

### Veículo novo com estilo pronto

No passo da marca do veículo local ou temático, "Já tem site? Cole o endereço" abre o site no Browser Rendering e sugere nome, logo, cores e um par de `PARES_FONTES`. Nada é salvo até a pessoa conferir e salvar. Só http e https em endereço público (`urlSegura`), prazo de 20 s, imagem, vídeo e fonte não carregam, e o logo sai do cabeçalho ou de elemento marcado como logo, nunca de dentro de `<article>`. Logo SVG passa por `sanitizarSvg`. JPEG e WebP não entram, porque a marca só aceita PNG ou SVG: a tela avisa para escolher o arquivo. Teto de `MAX_PUXADAS_DIA` (10) leituras por veículo em 24 horas.

`POST /t/:destino/estilos/copiar` e o bloco "Copiar de outro veículo" na seção de modelos: admin nos dois veículos, 404 se não for membro da origem. Copia nome, `vale_para` e `params`, com id novo e sem vínculo. Patrocinador fica para trás, e a cópia nunca entra como padrão.

Custo: uma sessão curta de Browser Rendering por leitura. Sem migração e sem segredo novo.

### Preço por veículo

Cada veículo tem o seu plano, em reais. `teste`: produção bloqueada até a assinatura. `pagina`: R$ 99, 60 posts por mês. `portal`: R$ 210, 150 posts por mês. `cortesia`: sem limite, dado no banco. No serviço com cobrança, veículo novo entra em `teste`. Na instalação própria, entra em `cortesia`. A migração 0028 põe todos os que já existem em `cortesia`, para nada parar no deploy. Preços e limites são proposta: mudam em `PLANOS`, em `src/lib/planos.ts`, e o valor cobrado de verdade é o `price` da Stripe.

Conta post e carrossel novos, por mês do calendário em Brasília. Reescrita, Reels, correção e produzir de novo depois de falha não contam. Gancho, ajuste e outra ilustração não são post: o custo deles entra no teto da peça. A porta é `produzirPauta`: guarda e soma vão no batch da transição, então transição que não aconteceu não gasta cota, e dois pedidos ao mesmo tempo não passam do limite.

No limite, a rota responde 402 com a mensagem nos dois idiomas. Fila do site, resumo do cron e início do veículo de autor deixam a pauta em Ideias e gravam `uso.limite`. O que está pronto continua podendo ser aprovado e publicado. Pagamento atrasado para post novo depois de 7 dias.

Aba Plano, só admin: plano, uso, aviso a 80 %, comparação, assinar e gerenciar. Sem os quatro segredos, a aba diz que a cobrança não está configurada, os limites seguem valendo e o resto do app não muda.

Produção, depois de `npm run db:migrate`:

1. Na Stripe, crie um produto com dois preços mensais em BRL, R$ 99 e R$ 210, e ative o Customer Portal.
2. Crie o webhook em `<PUBLIC_BASE_URL>/stripe/webhook` com `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` e `invoice.payment_failed`.
3. `npx wrangler secret put` para `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRECO_PAGINA` e `STRIPE_PRECO_PORTAL`, os dois últimos com o id `price_...`.

Custo: a taxa da Stripe por cobrança. Sem SDK e sem dependência nova.

## Google Docs (passo a passo para o dono)

Sem as quatro variáveis abaixo o app funciona igual, só sem o Google Docs (as opções somem e as rotas respondem 404).
O escopo é `drive.file`: o app só enxerga os documentos que a pessoa escolhe no Picker, e ele é pedido só quando a
pessoa clica em "Conectar Google Docs" (o login com Google continua só com e-mail e perfil).

1. **Projeto.** No [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto. Anote o
   **número do projeto** (Painel → Informações do projeto → Número do projeto).
2. **APIs.** Em APIs e serviços → Biblioteca, ative **Google Docs API** e **Google Picker API**.
3. **Tela de consentimento.** APIs e serviços → Tela de consentimento OAuth: tipo **Externo**, nome "Gazzpush",
   e-mail de suporte, domínio autorizado da sua instalação, links de política de privacidade e termos. Em Escopos,
   acrescente `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid` e
   `https://www.googleapis.com/auth/drive.file`. Enquanto estiver em "Teste", só os e-mails da lista de usuários de
   teste conseguem conectar; para abrir a todos, "Publicar app" (com `drive.file`, escopo não restrito, a verificação
   do Google é a leve: marca e domínio).
4. **Cliente OAuth.** APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web.
   Origens JavaScript autorizadas: `<PUBLIC_BASE_URL>` (e `http://localhost:8787` para testar local). URIs de
   redirecionamento: `<PUBLIC_BASE_URL>/api/auth/callback/google` (e `http://localhost:8787/api/auth/callback/google`).
   Guarde o ID e a chave secreta.
5. **Chave de API (Picker).** Credenciais → Criar credenciais → Chave de API. Restrinja: Restrições de aplicativo →
   Referenciadores HTTP → `<PUBLIC_BASE_URL>/*` (e `http://localhost:8787/*`); Restrições de API → só Google Picker
   API.
6. **Variáveis.** Local, no `.dev.vars` (modelo em `.dev.vars.example`); produção, uma a uma com
   `npx wrangler secret put NOME`:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY` (a chave do passo 5) e `GOOGLE_PROJECT_NUMBER` (o
   número do passo 1).
7. **Banco.** `npm run db:migrate` aplica `0006` (origem do documento) e as migrações seguintes no D1 remoto.
8. **Conferir.** Entre no app, abra Veículo › Contas → "Conectar Google Docs", aceite no Google e volte: o bloco diz
   "conectado". Na Nova ideia, a aba Docs abre o Picker com os seus documentos.

## Instalação própria

O `wrangler.jsonc` desta edição vem com `INSTALACAO_PROPRIA=1`. Quem cria um veículo pode usar as próprias chaves de IA e produzir sem contratar um plano do Gazzpush. Na aba **Veículo › Chaves de IA**, o administrador configura DeepSeek ou Gemini para texto, Anthropic para a segunda opinião e Kie ou fal para imagens. As chaves do veículo são cifradas com `TOKEN_ENC_KEY`.

O cadastro de contas é aberto. Quando o administrador configura uma chave de provedor no servidor, os veículos que usam essa chave consomem a cota do administrador. Para que cada veículo pague pelo próprio uso, deixe as chaves de provedores do servidor em branco.

### Rodar no computador

Use Node.js 24 e execute `npm ci` na raiz do projeto. Copie `.dev.vars.example` para `.dev.vars`. Defina `PUBLIC_BASE_URL=http://localhost:8787` e gere dois valores diferentes para `BETTER_AUTH_SECRET` e `TOKEN_ENC_KEY`. Para gerar cada valor, execute `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Guarde a chave de cifra para conseguir ler as credenciais após uma reinstalação.

```sh
npm run types
npm run db:migrate:local
npm run web:build
npm run dev -- --local
```

Abra `http://localhost:8787` e crie a primeira conta. O banco começa vazio. Para usar os serviços remotos de IA, Browser e Vectorize durante o desenvolvimento, configure os recursos da sua conta e inicie com `npm run dev`.

### Publicar na sua Cloudflare

1. Autentique o Wrangler com `npx wrangler login`. Na sua conta, crie o D1 `redacao-db`, o namespace KV do binding `CONFIG`, o bucket R2 `redacao-media`, as filas `redacao-monitor` e `redacao-monitor-dlq` e os dois índices Vectorize da seção Recursos. Os índices usam 1024 dimensões e distância cosseno.
2. Substitua `<D1_DATABASE_ID>` e `<KV_NAMESPACE_ID>` no `wrangler.jsonc` pelos IDs que você criou. Escolha o endereço público do Worker. Para um domínio próprio, configure `routes` conforme o comentário no arquivo.
3. Cadastre `BETTER_AUTH_SECRET`, `TOKEN_ENC_KEY` e `PUBLIC_BASE_URL` na sua conta com `npx wrangler secret put NOME`. Use a origem HTTPS definitiva em `PUBLIC_BASE_URL`. Para os provedores que passam pelo AI Gateway, configure também o gateway da sua conta e as variáveis indicadas em `.dev.vars.example`.
4. Com Docker funcionando para construir o contêiner de Reels, execute `npm run web:build`, `npm run db:migrate` e `npm run deploy`. Abra `/health` para conferir o Worker e entre no app para cadastrar o primeiro veículo.

### Verificar a instalação

`npm run check` verifica os tipos. `npm test` exercita as regras e as rotas do Worker com armazenamento local. Instale o Chromium com `npx playwright install chromium` e rode `npm run e2e` para verificar as telas públicas no computador e no celular.

## Licença

Código sob [AGPL-3.0-only](LICENSE). A atribuição do projeto está em [NOTICE](NOTICE).
