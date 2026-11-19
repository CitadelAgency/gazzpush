// The proof desk (DESIGN.md §8, 05/11): the proof grid of To approve, Ready to post and Posted; the ⌘K palette; the
// queue's pager, the strips and review's shortcuts; the sign-in screen's demo. Against `wrangler dev` with the seeded
// local D1 (README, Local testing). Axe 0 on every screen. Screenshots in design/telas/mesa-de-provas/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/mesa-de-provas";
const SCREENS = { celular: { width: 390, height: 844 }, computador: { width: 1440, height: 900 } } as const;
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };

async function look(page: Page, label: string, wait = 700) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(wait);   // the stair entrance and pencil strokes finish
  await page.screenshot({ path: `${PRINTS}/${label}-${page.viewportSize()!.width}.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .setLegacyMode(true).options({ iframes: false }).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function signIn(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(DESIGN.email);
  await page.getByLabel("Senha").fill(DESIGN.senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Sign-in lands on the first outlet by name, which depends on what other specs created: open this one.
  await expect(page).toHaveURL(/\/t\/[^/]+$/);
  await page.goto(`/t/${DESIGN.veiculo}`);
}

type PieceQueue = { id: string; status: string; formato: string; ncards: number | null };
async function inReview(page: Page): Promise<PieceQueue[]> {
  const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
  const ready = (list.pecas as PieceQueue[]).filter((p) => p.status === "revisao");
  expect(ready.length, "D1 local precisa de posts em revisão (README, Teste local)").toBeGreaterThan(1);
  return ready;
}

for (const [view, viewport] of Object.entries(SCREENS)) {
  test.describe(view, () => {
    test.use({ viewport, deviceScaleFactor: view === "celular" ? 2 : 1 });
    const desktop = view === "computador";

    test("To approve is a proof desk: large cover, queue number, wait ruler and the next one marked", async ({ page }) => {
      await signIn(page);
      const ready = await inReview(page);
      await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
      await expect(page.getByRole("heading", { level: 1, name: "Para aprovar" })).toBeVisible();
      const proofs = page.getByRole("main").getByRole("listitem");
      await expect(proofs).toHaveCount(ready.length);
      // The art is the product: the cover is not a thumbnail (on mobile two columns; on desktop, four).
      const cover = (await proofs.first().locator("img").boundingBox())!;
      expect(cover.width).toBeGreaterThanOrEqual(desktop ? 220 : 150);
      expect(cover.height / cover.width).toBeCloseTo(1.25, 1);   // 4:5
      // Queue number in the caption, a wait ruler on each proof and only one proof marked as the next.
      await expect(proofs.first()).toContainText("01");
      await expect(page.locator(".regua")).toHaveCount(ready.length);
      await expect(page.locator(".prova[data-proxima]")).toHaveCount(1);
      await expect(page.locator(".lapis-volta")).toHaveCount(1);
      // The whole proof is the link and the accessible name ends with the action.
      await expect(page.getByRole("link", { name: /Revisar a próxima$/ })).toHaveCount(1);
      await look(page, "aprovar");
    });

    test("Posted: the stamped proofs, with the status stamp", async ({ page }) => {
      await signIn(page);
      await page.goto(`/t/${DESIGN.veiculo}/postados`);
      await expect(page.getByRole("heading", { level: 1, name: "Postados" })).toBeVisible();
      const items = page.getByRole("main").getByRole("listitem");
      await expect(items.first()).toBeVisible();
      // The stamp is decoration (the state is in the caption): it stays hidden from the screen reader.
      await expect(items.first().locator(".carimbo")).toHaveAttribute("aria-hidden", "true");
      await expect(items.first().locator(".carimbo")).toHaveText(/^(Postado|Simulado)$/);
      await look(page, "postados");
    });

    // round 4: the proof rail left Ideas. Posts in progress are the "Now" block: the next action, with the cover as a
    // proof, and the short queue in rows.
    test("Ideas: posts in progress are the next action and the short queue, without overflowing the screen width", async ({ page }) => {
      await signIn(page);
      await inReview(page);
      const now = page.getByRole("region", { name: "Agora" });
      await expect(now).toBeVisible();
      // The next one's cover is the kit's proof, in 4:5, and the whole block is the link (the name ends with the action).
      const next = now.getByRole("link", { name: /Revisar a próxima$/ });
      await expect(next).toHaveCount(1);
      const cover = (await next.locator(".prova-arte").boundingBox())!;
      expect(cover.height / cover.width).toBeCloseTo(1.25, 1);
      // Nothing scrolls sideways: the page never gets horizontal scrolling.
      const slack = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(slack).toBeLessThanOrEqual(0);
      await expect(now.locator("a.fila-linha")).not.toHaveCount(0);
      await look(page, "ideias");
    });

    test("review: proof strips, ← →, queue (J and K) and A opens Approve without deciding", async ({ page }) => {
      await signIn(page);
      const ready = await inReview(page);
      const car = ready.find((p) => p.formato === "carrossel")!;
      const n = car.ncards ?? 4;
      let decided = false;
      await page.route("**/api/t/*/pecas/*/revisao", (route) => { decided = true; return route.abort(); });
      await page.goto(`/t/${DESIGN.veiculo}/p/${car.id}`);
      await expect(page.getByRole("img", { name: new RegExp(`^Card 1 de ${n}: Capa`) })).toBeVisible();
      // Strips: one per card, the current one marked; the counter keeps saying where it is.
      const strips = page.locator(".tira");
      await expect(strips).toHaveCount(n);
      await expect(strips.first()).toHaveAttribute("aria-current", "true");
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      // The queue's thread: "i of N" and the neighbours.
      const queue = page.getByRole("navigation", { name: "Fila para aprovar" });
      await expect(queue).toContainText(new RegExp(`\\d+ de ${ready.length}`));
      // ← and → move through the cards anywhere on the screen.
      await page.keyboard.press("ArrowRight");
      await expect(page.getByText(new RegExp(`^2 / ${n} · `))).toBeVisible();
      await expect(strips.nth(1)).toHaveAttribute("aria-current", "true");
      // Card 2 comes into view before ←, as a person would do (→ and ← back to back have their own test, just below).
      await expect(page.getByRole("img", { name: new RegExp(`^Card 2 de ${n}`) })).toBeInViewport({ ratio: 0.98 });
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await look(page, "revisao");
      // A opens the approve step (and only opens it: no decision goes out).
      await page.keyboard.press("a");
      await expect(page.getByRole("heading", { name: "Aprovar este post" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Aprovar" })).toBeFocused();
      expect(decided, "atalho só abre o passo").toBe(false);
      // Typing in a field, the key belongs to the field: X does not open Reject.
      await page.keyboard.press("x");
      await expect(page.getByRole("heading", { name: "Rejeitar este post" })).toBeVisible();
      await expect(page.getByLabel("Por quê?")).toBeFocused();
      await page.keyboard.type("a e x j k");
      await expect(page.getByLabel("Por quê?")).toHaveValue("a e x j k");
      await expect(page).toHaveURL(new RegExp(`/p/${car.id}$`));
      await page.keyboard.press("Escape");
      // J goes to the next in the queue, K goes back.
      const position = ready.findIndex((p) => p.id === car.id);
      const neighbor = ready[position + 1] ?? ready[position - 1];
      await page.keyboard.press(position + 1 < ready.length ? "j" : "k");
      await expect(page).toHaveURL(new RegExp(`/p/${neighbor.id}$`));
      expect(decided, "nenhuma decisão em todo o caminho").toBe(false);
    });

    test("review: → and ← then stay on the first card (the scroll that was heading to the second does not win)", async ({ page }) => {
      await signIn(page);
      const car = (await inReview(page)).find((p) => p.formato === "carrossel")!;
      const n = car.ncards ?? 4;
      await page.goto(`/t/${DESIGN.veiculo}/p/${car.id}`);
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await expect(page.locator(".tira")).toHaveCount(n);
      // Both keys inside the page, with only React's render between them: the strip has not moved yet when ← arrives. It
      // was the case where ← got lost: →'s scroll went on to card 2 and took the current one with it.
      await page.evaluate(async () => {
        const keyName = (key: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        const inSecond = () => document.querySelectorAll(".tira")[1]?.getAttribute("aria-current") === "true";
        keyName("ArrowRight");
        for (let i = 0; i < 50 && !inSecond(); i++) await new Promise((r) => setTimeout(r, 0));
        keyName("ArrowLeft");
      });
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await page.waitForTimeout(900);   // the time of a whole smooth scroll and of it settling
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await expect(page.locator(".tira").first()).toHaveAttribute("aria-current", "true");
      // The strip stays on card 1. On mobile the scroll swapped midway still takes a step (2 or 3 px) before stopping.
      expect(await page.locator(".palco ul[tabindex]").evaluate((el) => el.scrollLeft)).toBeLessThan(20);
    });

    test("review: the requested card stays marked through the whole swipe, even when the scroll only signals on exit", async ({ page }) => {
      await signIn(page);
      const car = (await inReview(page)).find((p) => p.formato === "carrossel")!;
      const n = car.ncards ?? 4;
      await page.goto(`/t/${DESIGN.veiculo}/p/${car.id}`);
      await expect(page.getByText(`1 / ${n} · Capa`)).toBeVisible();
      await expect(page.locator(".tira")).toHaveCount(n);
      // Like WebKit on a requested slide: the scroll sends its first notice and no other until the end (here not even the
      // arrival one; `scrollend` remains). Without a notice for 120 ms, review took the strip as stopped midway and marked
      // the card passing by: the counter flickered and the back arrow switched off with it.
      await page.evaluate(() => {
        const band = document.querySelector(".palco ul[tabindex]")!;
        let warnings = 0;
        document.addEventListener("scroll", (e) => { if (e.target === band && warnings++ > 0) e.stopPropagation(); }, true);
        const counter = document.querySelector(".palco-baixo p")!;
        const seen: string[] = ((window as unknown as { visto: string[] }).visto = []);
        new MutationObserver(() => seen.push(counter.textContent ?? "")).observe(counter, { childList: true, characterData: true, subtree: true });
      });
      await page.locator(".tira").last().click();
      await expect(page.getByRole("img", { name: new RegExp(`^Card ${n} de ${n}`) })).toBeInViewport({ ratio: 0.98 });
      await page.waitForTimeout(400);   // more than the guess's 120 ms, with the strip already still
      const seen = await page.evaluate(() => (window as unknown as { visto: string[] }).visto);
      expect(seen.map((t) => t.split(" · ")[0]), "o contador muda uma vez só, para o card pedido").toEqual([`${n} / ${n}`]);
      await expect(page.locator(".tira").last()).toHaveAttribute("aria-current", "true");
    });

    if (desktop) {
      test("⌘K palette: opens from the keyboard and the button, accent-insensitive search, goes and closes", async ({ page }) => {
        await signIn(page);
        const palette = page.getByRole("dialog", { name: "Ir para…" });
        // round 4: the URL changes before the shell mounts; without waiting for it, the first ⌘K sometimes landed on a page with no listener.
        await expect(page.getByRole("complementary", { name: "Veículo e seções" }).getByRole("button", { name: /^Ir para…/ })).toBeVisible();
        await expect(palette).toBeHidden();
        await page.keyboard.press("Control+k");
        await expect(palette).toBeVisible();
        const field = palette.getByRole("combobox");
        await expect(field).toBeFocused();
        await look(page, "paleta");
        // Without accents or capitals: "veiculo" finds the outlet's parts.
        await field.fill("MARCA");
        await expect(palette.getByRole("option").first()).toHaveText(/^Marca/);
        await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Enter");
        await expect(palette).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/veiculo\\?aba=marca$`));
        // Opens again from the sidebar button, chooses with the arrows and Esc closes without going anywhere.
        await page.getByRole("complementary", { name: "Veículo e seções" }).getByRole("button", { name: /^Ir para…/ }).click();
        await expect(palette).toBeVisible();
        await field.fill("");
        await page.keyboard.press("ArrowDown");
        await expect(palette.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Escape");
        await expect(palette).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/veiculo\\?aba=marca$`));
        // A post opens by its title.
        await page.keyboard.press("Control+k");
        const list = await (await page.request.get(`/api/t/${DESIGN.veiculo}/pecas`)).json();
        const posts = (list.pecas as { id: string; status: string; manchete: string | null; titulo: string }[]).map((p) => ({ id: p.id, nome: p.manchete ?? p.titulo, status: p.status }));
        // The first post whose title does not repeat (the Reels has the same title as the carousel it came from).
        const target = posts.find((p) => p.status === "revisao" && posts.filter((q) => q.nome === p.nome).length === 1)!;
        await field.fill(target.nome);
        await expect(palette.getByRole("option").first()).toContainText(target.nome);   // posts in review come before ready ones
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`/p/${target.id}$`));
        // No result: the palette says it found nothing (outside the list, which goes away) and nothing stays marked as open.
        await page.keyboard.press("Control+k");
        await field.fill("zzzzzz");
        await expect(palette.getByRole("listbox")).toHaveCount(0);
        await expect(palette.getByText("Nada com esse texto.")).toBeVisible();
        await expect(field).toHaveAttribute("aria-expanded", "false");
        await look(page, "paleta-vazia", 300);
      });

      // round 4: the card-style lead sheets and the rail left. A list row enters in a stair and, after that, responds to the
      // pointer (the background changes); what lifts on hover is the next action: the block rises and its art turns.
      test("pointing marks the idea's row and raises the next action (the staircase entrance does not hold the motion)", async ({ page }) => {
        await signIn(page);
        // The real list (li): the loading skeleton uses the same class, in a div, and goes away when the ideas arrive.
        await expect(page.locator("li.pauta-linha[aria-current]")).toBeVisible();
        const line = page.locator("li.pauta-linha:not([aria-current])").first();
        await line.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1300);   // the entrance stair finishes
        await expect(line).toHaveCSS("transform", "none");
        const background = await line.evaluate((el) => getComputedStyle(el).backgroundColor);
        await line.hover();
        await expect.poll(() => line.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(background);
        const next = page.locator("a.proxima");
        await next.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);   // the pointer leaves the list before measuring the resting state
        await expect(next).toHaveCSS("transform", "none");
        await next.hover();
        await expect.poll(() => next.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
        const art = next.locator(".prova-arte");
        await expect.poll(() => art.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
      });

      test("sidebar: the margin mark follows the open section", async ({ page }) => {
        await signIn(page);
        const sidebar = page.getByRole("complementary", { name: "Veículo e seções" });
        await expect(sidebar.locator(".marca-margem")).toHaveCount(1);
        await sidebar.getByRole("link", { name: /^Para aprovar/ }).click();
        await expect(page).toHaveURL(new RegExp(`/aprovar$`));
        await expect(sidebar.getByRole("link", { name: /^Para aprovar/ }).locator(".marca-margem")).toHaveCount(1);
        await expect(sidebar.locator(".marca-margem")).toHaveCount(1);
      });
    }

    test("sign in: the promise demo appears (escalated on mobile) and is never read or focusable", async ({ page }) => {
      await page.goto("/entrar");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const demo = page.locator(".demo");
      await expect(demo).toBeVisible();
      await expect(demo).toHaveAttribute("aria-hidden", "true");
      await expect(demo.locator("a, button, input, select, textarea, [tabindex]")).toHaveCount(0);
      // Fits on screen: never horizontal scrolling, and the source card does not go past the right edge.
      const slack = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(slack).toBeLessThanOrEqual(0);
      const sheet = (await page.locator(".demo-fonte").boundingBox())!;
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      // The form stays in view without scrolling (the demo comes after it on mobile).
      if (!desktop) expect((await page.getByRole("button", { name: "Entrar", exact: true }).boundingBox())!.y).toBeLessThan(page.viewportSize()!.height);
      await look(page, "entrar", 4600);   // the sequence (card, underline, link, source, check) takes about 4 s
    });
  });
}
