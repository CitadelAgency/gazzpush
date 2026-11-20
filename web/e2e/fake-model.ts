// A fake model for the Story e2e: a local server in place of DeepSeek's chat/completions (the `npm run dev:e2e` Worker
// points to it through DEEPSEEK_URL). A deterministic response by simple rules on the requested paragraph, so the real
// pipeline (prompt, literal passage, per-block storage, streaming) runs at no cost:
// - a sentence with "desvi" or "acus": risk, accusation without conviction;
// - a sentence with a number that appears in a dossier evidence item: with evidence, citing the evidence's sentence with the number;
// - a sentence with a number that does not appear, or with "gasta mais": unsourced.
// It keeps the requested paragraphs (GET /chamadas) so the test can check what was checked again.
// It also answers like the Anthropic API (POST /anthropic/v1/messages, the second opinion of `npm run dev:e2e`), with
// the same rules: the two opinions agree (disagreement is covered by the Worker tests).
// And, for the legal shield (Phase 4): a fake RFC 3161 timestamp authority (POST /tsa, TSA_URL) that really signs with a
// test certificate, and the Wayback Machine (/wayback, WAYBACK_URL): saving answers with the capture's address, and the
// capture returns the page.
// Ask the document (Phase 5, the prompt starts with "ASK THE DOCUMENT"): cites the first line of the pages that
// have a word from the question (4 letters or more), copied literally; with none, "não encontrou".
// Recordings (Phase 6): the fake Whisper (POST /whisper, WHISPER_URL) always returns the same interview (FALA_GRAVADA),
// with each word's time, in the format of @cf/openai/whisper-large-v3-turbo.
// AI keys: the fake Gemini (/gemini, GEMINI_URL) answers generateContent with DeepSeek's same rules, and the fake fal
// (/fal, FAL_URL) generates an image. Key check (the model list, fal's status): a key containing "recusada" answers 401.
import { createServer, type Server } from "node:http";
import { timestamp } from "../../test/fake-tsa";

// Another port through `E2E_PORTA_MODELO` when another worktree is already running its e2e (the e2e Worker points to the same one).
export const GATE_MODEL = Number(process.env.E2E_PORTA_MODELO ?? 8789);
export const SPEECH_RECORDED: [number, string][] = [
  [0, "Bom dia, obrigado por me receber."],
  [72.4, "Olha, eu nunca recebi um centavo das empresas de ônibus. Isso é mentira."],
  [80, "A licitação vai sair em abril do ano que vem."],
];
const whisper = () => ({
  text: SPEECH_RECORDED.map(([, f]) => f).join(" "),
  transcription_info: { language: "pt", duration: 90 },
  segments: SPEECH_RECORDED.map(([ini, text]) => {
    const ws = text.split(" ");
    return { start: ini, end: ini + ws.length * 0.4, text: ` ${text}`, words: ws.map((w, k) => ({ word: ` ${w}`, start: ini + k * 0.4, end: ini + k * 0.4 + 0.35 })) };
  }),
});
let calls: string[] = [];
let server: Server | null = null;

const withoutAccent = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function onDocumentQuestion(user: string) {
  const [pagesText, question = ""] = user.split("\n\nQUESTION: ");
  const words = (withoutAccent(question).match(/\p{L}{4,}/gu) ?? []).filter((p) => !["qual", "quem", "quando", "onde", "como", "quanto", "quais"].includes(p));
  for (const block of pagesText.split(/\n\n(?=\[p\. \d+\]\n)/)) {
    const page = Number(block.match(/^\[p\. (\d+)\]/)?.[1]);
    for (const line of block.split("\n").slice(1)) {
      if (words.some((p) => withoutAccent(line).includes(p))) {
        return { encontrou: true, resposta: `Segundo a página ${page}: ${line.trim()}`, citacoes: [{ pagina: page, trecho: line.trim() }] };
      }
    }
  }
  return { encontrou: false, resposta: "", citacoes: [] };
}

/** Checked hook: the first passes (it is the start of a fact); the second invents a number, for the check to remove. */
function headlines(user: string) {
  const facts = user.split("Facts:\n")[1]?.split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean) ?? [];
  const short = (s: string) => s.slice(0, 80).replace(/\s+\S*$/, "");
  return { manchetes: [
    { angulo: "numero", titulo: short(facts[0] ?? "") },
    { angulo: "consequencia", titulo: "Moradores esperam 9871 dias" },
    { angulo: "servico", titulo: short(facts[1] ?? facts[0] ?? "") },
  ] };
}

/** Two versions: the text's first words, and one that invents a number, for the check to remove. */
function shorten(user: string) {
  const text = user.split("\n")[0]?.replace(/^Text: /, "") ?? "";
  return { opcoes: [text.split(/\s+/).slice(0, -2).join(" "), "Texto curto com 9871 dias"] };
}

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

function answer(user: string, second = false) {
  const block = user.split("CHECK ONLY THIS PARAGRAPH\n[P0] ")[1] ?? "";
  if (!second) calls.push(block);
  const dossier = user.slice(0, user.indexOf("WHOLE TEXT"));
  const evidence = [...dossier.matchAll(/\[E:([^\]]+)\][^\n]*\n([\s\S]*?)(?=\n\n\[E:|\n\nWHOLE TEXT|$)/g)].map((m) => ({ id: m[1], texto: m[2] }));
  const claims = [];
  for (const f of sentences(block)) {
    if (/desvi|acus/i.test(f)) {
      claims.push({ paragrafo: 0, trecho: f, estado: "risco", risco: "acusacao_sem_condenacao", evidencia: null, trecho_evidencia: null, explicacao: "Acusa pessoa identificada de crime sem condenação nem fonte oficial." });
      continue;
    }
    const number = f.match(/\d+/)?.[0];
    const ev = number ? evidence.find((e) => e.texto.includes(number)) : undefined;
    if (ev) {
      const passage = sentences(ev.texto).find((x) => x.includes(number!))!.replace(/[.]$/, "");
      claims.push({ paragrafo: 0, trecho: f, estado: "com_evidencia", risco: null, evidencia: ev.id, trecho_evidencia: passage, explicacao: "A evidência traz o número." });
    } else if (number || /gasta mais/i.test(f)) {
      claims.push({ paragrafo: 0, trecho: f, estado: "sem_fonte", risco: null, evidencia: null, trecho_evidencia: null, explicacao: "Nenhuma evidência do dossiê sustenta esta afirmação." });
    }
  }
  return { afirmacoes: claims };
}

export async function uploadModel() {
  if (server) return;
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/chamadas") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(calls)); return; }
    if (req.method === "POST" && req.url === "/zerar") { calls = []; res.end("{}"); return; }
    // Key check: model list (DeepSeek, Gemini, Anthropic), Kie credit balance and the status of a fal request that does not exist.
    if (req.method === "GET" && /^\/(models|gemini\/v1beta\/models|anthropic\/v1\/models|api\/v1\/chat\/credit|fal\/.+\/status)(\?|$)/.test(req.url ?? "")) {
      const key = String(req.headers.authorization ?? req.headers["x-goog-api-key"] ?? req.headers["x-api-key"] ?? "");
      res.setHeader("content-type", "application/json");
      if (key.includes("recusada")) { res.statusCode = 401; res.end('{"error":"invalid key"}'); return; }
      if (req.url?.startsWith("/fal/")) { res.statusCode = 404; res.end('{"detail":"request not found"}'); return; }
      if (req.url?.startsWith("/api/v1/chat/credit")) { res.end('{"code":200,"data":100}'); return; }
      res.end('{"data":[],"models":[]}');
      return;
    }
    if (req.url?.startsWith("/wayback/")) {
      const path = req.url.slice("/wayback".length);
      const save = path.match(/^\/save\/(.+)$/);
      if (save) { res.writeHead(302, { location: `http://127.0.0.1:${GATE_MODEL}/wayback/web/20261103101112/${save[1]}` }); res.end(); return; }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<html><body><p>Cópia arquivada da página.</p></body></html>");
      return;
    }
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => { parts.push(c); });
    req.on("end", () => {
      if (req.url === "/tsa") {
        void timestamp(new Uint8Array(Buffer.concat(parts))).then((tsr) => { res.setHeader("content-type", "application/timestamp-reply"); res.end(Buffer.from(tsr)); });
        return;
      }
      const body = Buffer.concat(parts).toString("utf8");
      res.setHeader("content-type", "application/json");
      // Fake Stripe (Phase 10): the payment and portal sessions return a page from here; the subscription always comes out on the Página plan.
      if (req.url === "/stripe/v1/checkout/sessions") { res.end(JSON.stringify({ id: "cs_falsa", url: `http://127.0.0.1:${GATE_MODEL}/stripe/pagar` })); return; }
      if (req.url === "/stripe/v1/billing_portal/sessions") { res.end(JSON.stringify({ url: `http://127.0.0.1:${GATE_MODEL}/stripe/portal` })); return; }
      if (req.url?.startsWith("/stripe/v1/subscriptions/")) {
        res.end(JSON.stringify({ id: req.url.split("/").pop(), status: "active", customer: "cus_falso", current_period_end: 1_800_000_000, items: { data: [{ price: { id: "price_pagina" } }] } }));
        return;
      }
      if (req.url === "/stripe/pagar" || req.url === "/stripe/portal") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end("<html><body><h1>Stripe falsa</h1></body></html>"); return; }
      if (req.url === "/whisper") { res.end(JSON.stringify(whisper())); return; }
      if (req.url?.startsWith("/anthropic/v1/messages")) {
        const request = JSON.parse(body || "{}") as { model: string; messages: { content: { text: string }[] }[] };
        const json = answer(request.messages[0].content.map((c) => c.text).join("\n\n"), true);
        res.end(JSON.stringify({
          id: "msg_falso", type: "message", role: "assistant", model: request.model, stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 200, output_tokens: 120, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
        }));
        return;
      }
      if (req.url?.startsWith("/fal/")) { res.end(JSON.stringify({ images: [{ url: `http://127.0.0.1:${GATE_MODEL}/fal/imagem.png` }] })); return; }
      // Gemini: DeepSeek's same request in another envelope (systemInstruction + contents), the same JSON answer.
      const gemini = req.url?.startsWith("/gemini/") ? JSON.parse(body || "{}") as { systemInstruction?: { parts: { text: string }[] }; contents?: { parts: { text: string }[] }[] } : null;
      const request = gemini
        ? { messages: [{ content: gemini.systemInstruction?.parts[0]?.text ?? "" }, { content: gemini.contents?.[0]?.parts[0]?.text ?? "" }] }
        : JSON.parse(body || "{}") as { messages?: { content: string }[] };
      const systemRequest = request.messages?.[0]?.content ?? "";
      const json = systemRequest.startsWith("You help a journalist promote")
        ? { assuntos: ["12 contratos de ônibus sem licitação", "R$ 40 milhões sem licitação", "A Câmara e os ônibus"], mensagem: "A Câmara renovou 12 contratos de ônibus sem licitação." }
        : systemRequest.startsWith("You are an experienced editor")
        ? { notas: [{ tipo: "pergunta", trecho: "vai analisar o relatório", nota: "O texto não diz até quando." }, { tipo: "sobra", trecho: "frase que não existe", nota: "Inventada." }] }
        : request.messages?.[0]?.content.startsWith("SHORTEN TO FIT.")
        ? shorten(request.messages[1]?.content ?? "")
        : request.messages?.[0]?.content.startsWith("COVER HEADLINES.")
        ? headlines(request.messages[1]?.content ?? "")
        : request.messages?.[0]?.content.startsWith("ASK THE DOCUMENT")
        ? onDocumentQuestion(request.messages[1]?.content ?? "")
        : answer(request.messages?.[1]?.content ?? "");
      if (gemini) { res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 80 } })); return; }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 1000, completion_tokens: 80 } }));
    });
  });
  await new Promise<void>((ok, failure) => { server!.once("error", failure); server!.listen(GATE_MODEL, "127.0.0.1", ok); });
}

export const resetCalls = () => { calls = []; };
export const callsModel = () => [...calls];
export async function goDownModel() {
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
  server = null;
}
