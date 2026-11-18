// Gera web/src/dados/municipios.ts (lista do IBGE para a busca de município no "Criar veículo").
// Fonte: CSV de github.com/kelvins/municipios-brasileiros (códigos do IBGE), porque a API do IBGE não respondeu daqui.
// Uso: node scripts/municipios.mjs <municipios.csv> <estados.csv>
import { readFileSync, writeFileSync } from "node:fs";

const [munCsv, ufCsv] = process.argv.slice(2);
const linhas = (f) => readFileSync(f, "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const uf = Object.fromEntries(linhas(ufCsv).map(([cod, sigla]) => [cod, sigla]));
const muns = linhas(munCsv)
  .map(([ibge, nome, , , , codUf]) => [ibge, nome, uf[codUf]])
  .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
if (muns.length < 5500 || muns.some(([i, n, u]) => !/^\d{7}$/.test(i) || !n || !u)) throw new Error("lista incompleta");
writeFileSync("web/src/dados/municipios.ts",
  "// Gerado por scripts/municipios.mjs (não editar). Uma linha por município: código IBGE|nome|UF.\n" +
  `export default ${JSON.stringify(muns.map((m) => m.join("|")).join("\n"))};\n`);
console.log(muns.length, "municípios");
