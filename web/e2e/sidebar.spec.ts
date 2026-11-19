// Sidebar 2: the "Today" row (desktop), the mark in the mobile bar and the reporter (New idea is the blue action; does
// not approve). Real data from the local D1: design@redacao.dev (admin) and reporter@redacao.dev (seeds/reporter.mjs).
// Axe 0. Screenshots in design/telas/lateral/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/lateral";
const OUTLET = "portal-litoral";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123" };
const REPORTER = { email: "reporter@redacao.dev", senha: "senha-forte-123" };

async function look(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page, who: { email: string; senha: string }) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Senha").fill(who.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${OUTLET}`);
}

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Veículo e seções" });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("on a short screen the top stays fixed: the sidebar scrolls under the outlet and New idea", async ({ page }) => {
    await signIn(page, DESIGN);
    // Round 4: at 1440 × 900 the whole sidebar fits, without scrolling inside (34 px rows, Sources on the Outlet group's row).
    await expect(sidebar(page).getByRole("link", { name: /^Plano/ })).toBeVisible();
    expect(await sidebar(page).evaluate((a) => a.scrollHeight - a.clientHeight)).toBeLessThanOrEqual(0);
    // On a very short screen it scrolls, and the top stays pinned.
    await page.setViewportSize({ width: 1366, height: 480 });
    const outlet = sidebar(page).getByRole("button", { name: /Portal Litoral/ }).first();
    await sidebar(page).evaluate((a) => { a.scrollTop = a.scrollHeight; });
    await expect.poll(() => sidebar(page).evaluate((a) => a.scrollTop)).toBeGreaterThan(100);
    expect((await outlet.boundingBox())!.y).toBeLessThan(40);
    await sidebar(page).getByRole("link", { name: "Postados" }).click();
    await expect(page).toHaveURL(/\/postados$/);
    expect((await outlet.boundingBox())!.y).toBeLessThan(40);
    await expect(sidebar(page).getByRole("button", { name: "Nova ideia" })).toBeInViewport();
  });

  test("dense Today: the week in bars, the oldest wait of each queue; collection stays on the Sources row", async ({ page }) => {
    await signIn(page, DESIGN);
    const today = sidebar(page).getByRole("region", { name: "Hoje" });
    await expect(today).toBeVisible();
    await expect(today).toHaveText(/hoje \d+ · semana \d+/);
    await expect(today).toHaveText(/\d+ para aprovar · há \d+ (min|h|dias)/);
    await expect(today).not.toHaveText(/próxima coleta/);
    expect(await today.locator("svg rect").count()).toBe(7);
    // The Sources row comes before the Outlet group (which has another "Sources" link).
    const lineSources = sidebar(page).getByRole("link", { name: /^Fontes/ }).first();
    await expect(lineSources).toHaveText(/(coleta \d\d:\d\d|indispon)/);
    // Labels in a single system: no "Flow" above the navigation; the cards get an upper-case mono label.
    await expect(sidebar(page).getByText("Fluxo", { exact: true })).toHaveCount(0);
    await expect(today.getByRole("heading", { level: 2 })).toHaveCSS("text-transform", "uppercase");
    // Order (round 4): Today, the Outlet group (with the collection status on the Sources row), account.
    const top = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!.y;
    const [sources, cardToday, account] = await Promise.all([
      top(lineSources), top(today), top(sidebar(page).getByRole("button", { name: /^Conta:/ })),
    ]);
    expect(cardToday).toBeLessThan(sources);
    expect(sources).toBeLessThan(account);
    await look(page, "hoje");
  });

  test("reporter: New idea is the blue button; sees To approve with no counter or approve action", async ({ page }) => {
    await signIn(page, REPORTER);
    const created = sidebar(page).getByRole("button", { name: "Nova ideia" });
    await expect(created).toHaveCSS("background-color", "rgb(11, 92, 196)");
    // No blue counter: the reporter neither approves nor posts, so nothing "waits" for them.
    await expect(sidebar(page).getByRole("link", { name: /^Para aprovar/ })).toHaveAccessibleName("Para aprovar", { exact: true });
    await expect(sidebar(page).getByRole("link", { name: /^Prontos para postar/ })).toHaveAccessibleName("Prontos para postar", { exact: true });
    await expect(sidebar(page).getByText("repórter", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Produzir" })).toHaveCount(0);
    await look(page, "reporter");
    // Can see the list, does not approve: the API blocks it (requireMember('editor')).
    await sidebar(page).getByRole("link", { name: "Para aprovar" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${OUTLET}/aprovar$`));
    const list = await page.request.get(`/api/t/${OUTLET}/pecas?status=revisao`);
    const piece = (await list.json()).pecas[0];
    const r = await page.request.post(`/api/t/${OUTLET}/pecas/${piece.id}/revisao`, { data: { decisao: "aprovar", versao: piece.versao ?? 0 }, headers: { origin: "http://localhost:8787" } });
    expect(r.status()).toBe(403);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("the top bar has the brand square beside the name", async ({ page }) => {
    await signIn(page, DESIGN);
    const bar = page.getByRole("banner");
    const brand = bar.locator("span[aria-hidden='true'], img").first();
    await expect(brand).toBeVisible();
    const box = await brand.boundingBox();
    expect(box?.width).toBe(32);
    await expect(bar.getByText("Portal Litoral")).toBeVisible();
    await expect(bar.getByText("@portal.litoral")).toHaveCount(0);
    await look(page, "barra");
  });
});
