// Servidor do Container do Reels. POST /render {html, duracao, arquivos?: [{nome, base64}]} → video/mp4.
// `arquivos`: as imagens e a música da composição, uma vez cada (o HTML as cita pelo nome). Um render por vez (o Worker
// manda um pedido por instância); o tempo de cada etapa vai no cabeçalho x-tempo-ms. Sem internet: o HyperFrames e o
// Chrome já estão na imagem e são chamados pelo caminho instalado.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const APP = path.dirname(new URL(import.meta.url).pathname);
const GSAP = path.join(APP, 'node_modules/gsap/dist/gsap.min.js');
const HYPERFRAMES = path.join(APP, 'node_modules/.bin/hyperframes');
const MAX_CORPO = 40 * 1024 * 1024;
const PRAZO_MS = 6 * 60 * 1000;          // render travado (Chrome ou FFmpeg) é encerrado
const MAX_LOG = 64 * 1024;
// Só nomes simples, gerados pelo Worker (a1.png, a2.svg, musica.mp3, voz.webm): nada de caminho.
const NOME = /^[a-z0-9]{1,16}\.(png|jpe?g|svg|webp|mp3|m4a|webm|ogg|wav|flac|aac)$/;
let ocupado = false;

function rodar(cmd, args, cwd) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { cwd, env: process.env, detached: true });
    let saida = '';
    const juntar = (d) => { saida = (saida + d).slice(-MAX_LOG); };
    p.stdout.on('data', juntar);
    p.stderr.on('data', juntar);
    const prazo = setTimeout(() => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); }
      falha(Object.assign(new Error(`render passou de ${PRAZO_MS / 1000}s e foi encerrado`), { status: 504 }));
    }, PRAZO_MS);
    p.on('error', (e) => { clearTimeout(prazo); falha(e); });
    p.on('close', (code) => {
      clearTimeout(prazo);
      if (code === 0) ok(saida); else falha(new Error(`${cmd} saiu com ${code}: ${saida.slice(-2000)}`));
    });
  });
}

async function lerCorpo(req) {
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > MAX_CORPO) throw Object.assign(new Error('corpo grande demais'), { status: 413 });
    partes.push(p);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

async function render(pedido) {
  const t0 = Date.now();
  if (typeof pedido.html !== 'string' || !pedido.html.includes('data-composition-id')) throw Object.assign(new Error('html: composição HyperFrames'), { status: 400 });
  const arquivos = Array.isArray(pedido.arquivos) ? pedido.arquivos : [];
  for (const a of arquivos) {
    if (typeof a?.nome !== 'string' || !NOME.test(a.nome) || typeof a.base64 !== 'string') throw Object.assign(new Error(`arquivo inválido: ${String(a?.nome).slice(0, 40)}`), { status: 400 });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reels-'));
  try {
    await fs.writeFile(path.join(dir, 'index.html'), pedido.html);
    await fs.copyFile(GSAP, path.join(dir, 'gsap.min.js'));
    for (const a of arquivos) await fs.writeFile(path.join(dir, a.nome), Buffer.from(a.base64, 'base64'));
    const saida = path.join(dir, 'reels.mp4');
    const t1 = Date.now();
    await rodar(HYPERFRAMES, ['render', dir, '--output', saida, '--fps', '30', '--quality', 'standard', '--quiet'], APP);
    const mp4 = await fs.readFile(saida);
    return { mp4, tempo: { preparo: t1 - t0, render: Date.now() - t1 } };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/saude') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (req.method !== 'POST' || req.url !== '/render') { res.writeHead(404); return res.end(); }
    if (ocupado) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"erro":"render em andamento"}'); }
    ocupado = true;
    try {
      const { mp4, tempo } = await render(await lerCorpo(req));
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length, 'x-tempo-ms': JSON.stringify(tempo) });
      res.end(mp4);
    } finally {
      ocupado = false;
    }
  } catch (e) {
    res.writeHead(e.status ?? 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ erro: String(e.message ?? e).slice(0, 2000) }));
  }
}).listen(8080, () => console.log('reels: ouvindo na 8080'));
