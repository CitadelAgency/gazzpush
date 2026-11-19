// Seeds Portal Litoral's test reporter into local D1: reporter@redacao.dev / senha-forte-123, role `reporter`.
// Better Auth stores the password (scrypt), so sign-up goes through the API and not through SQL. Idempotent.
// Usage: with `npm run dev` running, then `node seeds/reporter.mjs` (or with another base: `node seeds/reporter.mjs http://localhost:8787`).
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8787";
const email = "reporter@redacao.dev";
const tenant = "portal-litoral";

const r = await fetch(`${base}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email, password: "senha-forte-123", name: "Repórter" }),
});
const corpo = await r.json().catch(() => ({}));
if (!r.ok && corpo.code !== "USER_ALREADY_EXISTS" && corpo.code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
  console.error("cadastro falhou", r.status, corpo);
  process.exit(1);
}
console.log(r.ok ? "usuário criado" : "usuário já existia");

const sql = `INSERT OR IGNORE INTO membros (id, tenant_id, user_id, papel)
  SELECT 'm-reporter-bng', '${tenant}', id, 'reporter' FROM "user" WHERE email = '${email}';
  SELECT m.papel FROM membros m JOIN "user" u ON u.id = m.user_id WHERE u.email = '${email}' AND m.tenant_id = '${tenant}';`;
// Through a file: on Windows, SQL with line breaks does not survive `--command` through the shell.
const arquivo = join(mkdtempSync(join(tmpdir(), "redacao-seed-")), "reporter.sql");
writeFileSync(arquivo, sql);
const saida = execSync(`npx wrangler d1 execute redacao-db --local --json --file "${arquivo}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const papel = JSON.parse(saida.slice(saida.indexOf("[")))?.at(-1)?.results?.[0]?.papel;
if (papel !== "reporter") { console.error("membro não ficou como repórter:", saida); process.exit(1); }
console.log(`${email} é reporter de ${tenant}`);
