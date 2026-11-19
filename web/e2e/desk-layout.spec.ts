// Round 4 (DESIGN.md §12): the new shell (sheet on the desk, folio, shortcuts, tooltip), the motion rules and the
// "Night" theme. The screens have their own specs (phase-d, phase-e, phase-f, proof-desk); here goes what belongs to the
// shell and what applies to all. Against `wrangler dev` with the seeded local D1 (README, Local testing). Axe 0 on every
// screen. Screenshots in design/telas/rodada-4/.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PRINTS = "design/telas/rodada-4";
const DESIGN = { email: "design@redacao.dev", senha: "senha-forte-123", veiculo: "portal-litoral" };

async function look(page: Page, label: string, wait = 500) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(wait);
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

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Veículo e seções" });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sheet on the desk: the frame stays still and the page scrolls entirely; the folio shows the date, the place and, on scroll, the screen", async ({ page }) => {
    // A shorter window: the screen scrolls even with few ideas in the list (what is in the local D1 changes from one run to another).
    await page.setViewportSize({ width: 1440, height: 640 });
    await signIn(page);
    const frame = page.locator(".moldura");
    await expect(frame).toBeVisible();
    const before = (await frame.boundingBox())!;
    expect(before.x).toBe(256);
    expect(before.y).toBe(8);
    const folio = page.locator(".folio");
    await expect(folio).toContainText(/\d{4} · Guarujá, SP/);
    // The screen's name only appears in the folio once the title has scrolled out.
    await expect(folio.locator(".folio-titulo")).toHaveCSS("opacity", "0");
    await expect(page.getByRole("region", { name: "Agora" })).toBeVisible();   // the screen loaded: it already has something to scroll
    await page.mouse.move(800, 400);   // the pointer over the sheet: the wheel scrolls the page, not the sidebar
    // The wheel takes the page to the end: one turn or two, the screenshot always comes out from the same point.
    await expect.poll(async () => { await page.mouse.wheel(0, 400); return page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight); }).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(folio.locator(".folio-titulo")).toHaveText("Ideias");
    await expect(folio.locator(".folio-titulo")).toHaveCSS("opacity", "1");
    // The window is what scrolls: the frame does not move and the folio stays pinned right below it.
    expect((await frame.boundingBox())!.y).toBe(before.y);
    expect((await folio.boundingBox())!.y).toBe(8);
    await look(page, "folio-rolado");
  });

  test("the post puts the way back and the pager in the folio", async ({ page }) => {
    await signIn(page);
    await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
    await page.locator("a.prova").first().click();
    await expect(page).toHaveURL(/\/p\//);
    const folio = page.locator(".folio");
    await expect(folio.getByRole("link", { name: "Para aprovar" })).toBeVisible();
    await expect(folio.locator(".folio-titulo")).toBeHidden();
    await expect(folio).toContainText(/\d+ de \d+/);
    await folio.getByRole("link", { name: "Para aprovar" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${DESIGN.veiculo}/aprovar$`));
  });

  test("shortcuts: N opens New idea, ? opens the shortcut sheet, and none of it applies inside a field", async ({ page }) => {
    await signIn(page);
    await page.locator("#conteudo").focus();
    await page.keyboard.press("?");
    const shortcuts = page.getByRole("dialog", { name: "Atalhos do teclado" });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts).toContainText("Nova ideia");
    await look(page, "atalhos");
    await page.keyboard.press("Escape");
    await expect(shortcuts).toBeHidden();
    await page.locator("#conteudo").focus();
    await page.keyboard.press("n");
    await expect(page).toHaveURL(/[?&]nova=link/);
    // Inside the sheet's field the key is text, not a shortcut.
    const field = page.getByRole("dialog").getByRole("textbox").first();
    await field.fill("");
    await field.type("n?");
    await expect(field).toHaveValue("n?");
    await expect(page.getByRole("dialog", { name: "Atalhos do teclado" })).toBeHidden();
    // From the account menu too.
    await page.keyboard.press("Escape");
    await sidebar(page).getByRole("button", { name: /^Conta:/ }).click();
    await page.getByRole("menuitem", { name: /Atalhos do teclado/ }).click();
    await expect(shortcuts).toBeVisible();
  });

  test("what starts from the keyboard does not animate: the palette opens ready and the html carries data-tecla until the next click", async ({ page }) => {
    await signIn(page);
    await page.locator("#conteudo").focus();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Ir para…" });
    await expect(palette).toBeVisible();
    expect(await palette.evaluate((d) => getComputedStyle(d).animationName)).toBe("none");
    await expect(page.locator("html")).toHaveAttribute("data-tecla", "");
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { level: 1 }).click();   // a click that leads nowhere
    await expect(page.locator("html")).not.toHaveAttribute("data-tecla", "");
    // With the pointer, the shortcuts sheet rises animated; by keyboard, it appears ready.
    await sidebar(page).getByRole("button", { name: /^Conta:/ }).click();
    await page.getByRole("menuitem", { name: /Atalhos do teclado/ }).click();
    const shortcuts = page.getByRole("dialog", { name: "Atalhos do teclado" });
    expect(await shortcuts.evaluate((d) => getComputedStyle(d).animationName)).not.toBe("none");
    await page.keyboard.press("Escape");
    await page.locator("#conteudo").focus();
    await page.keyboard.press("?");
    expect(await shortcuts.evaluate((d) => getComputedStyle(d).animationName)).toBe("none");
  });

  test("tip: the icon-only button says its name and shortcut; the first wait, the neighbor opens at once", async ({ page }) => {
    await signIn(page);
    await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
    // The second in the queue: there is a post before and after, so both pager arrows are on.
    await page.locator("a.prova").nth(1).click();
    await expect(page).toHaveURL(/\/p\//);
    const after = page.locator(".folio [data-dica][data-tecla='J']");
    const before = page.locator(".folio [data-dica][data-tecla='K']");
    await expect(after).toBeVisible();
    await after.hover();
    const tip = page.locator(".dica[data-on]");
    await expect(tip).toHaveCount(0);   // still waiting
    await expect(tip).toHaveText(/^Próximo postJ$/, { timeout: 2000 });
    await before.hover();
    await expect(tip).toHaveText(/^Post anteriorK$/, { timeout: 300 });
    await expect(page.locator(".dica")).toHaveAttribute("data-seco", "");
    // Goes away when the pointer leaves.
    await page.mouse.move(700, 500);
    await expect(tip).toHaveCount(0);
  });

  test("press: the button shrinks while pressed", async ({ page }) => {
    await signIn(page);
    const created = sidebar(page).getByRole("button", { name: "Nova ideia" });
    const box = (await created.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await expect.poll(() => created.evaluate((b) => getComputedStyle(b).scale)).toBe("0.97");
    await page.mouse.move(700, 500);
    await page.mouse.up();
  });

  test("at night: turns on from the account menu, stays in the browser and passes contrast on the flow's screens", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-mesa", "noite");
    await sidebar(page).getByRole("button", { name: /^Conta:/ }).click();
    await page.getByRole("menuitemradio", { name: "À noite" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mesa", "noite");
    await look(page, "noite-ideias");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mesa", "noite");
    for (const [route, name, title] of [["aprovar", "noite-aprovar", "Para aprovar"], ["postar", "noite-postar", "Prontos para postar"], ["postados", "noite-postados", "Postados"],
      ["veiculo?aba=fontes", "noite-fontes", "Fontes"], ["veiculo?aba=marca", "noite-marca", "Marca"]] as const) {
      await page.goto(`/t/${DESIGN.veiculo}/${route}`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await look(page, name, 900);
    }
    await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
    await page.locator("a.prova").first().click();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByRole("complementary", { name: "Decisão" })).toBeVisible();
    await look(page, "noite-revisao", 900);
    // Back to paper through the same menu.
    await sidebar(page).getByRole("button", { name: /^Conta:/ }).click();
    await page.getByRole("menuitemradio", { name: "Papel" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-mesa", "noite");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("no frame and no folio on the lists; the folio appears with the way back on the post", async ({ page }) => {
    await signIn(page);
    await expect(page.locator(".moldura")).toBeHidden();
    await expect(page.locator(".folio")).toBeHidden();
    await page.goto(`/t/${DESIGN.veiculo}/aprovar`);
    await page.locator("a.prova").first().click();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.locator(".folio").getByRole("link", { name: "Para aprovar" })).toBeVisible();
    await look(page, "folio-post");
  });

  test("on touch there is no stuck hover highlight: no :hover rule applies outside @media (hover: hover)", async ({ page }) => {
    await signIn(page);
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    // Every :hover rule lives inside the query: on touch none of them applies, and the highlight does not stay after the tap.
    const loose = await page.evaluate(() => {
      const outside: string[] = [];
      const see = (rules: CSSRuleList, saved: boolean) => {
        for (const r of Array.from(rules)) {
          const inside = saved || (r instanceof CSSMediaRule && /hover:\s*hover/.test(r.conditionText));
          if (r instanceof CSSStyleRule) {
            const sel = r.selectorText.replace(/:not\([^()]*\)/g, "");
            if (!inside && sel.includes(":hover")) outside.push(r.selectorText);
          }
          const children = (r as CSSGroupingRule).cssRules;
          if (children) see(children, inside);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) { try { see(sheet.cssRules, false); } catch { /* a sheet from another origin */ } }
      return outside;
    });
    expect(loose).toEqual([]);
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("color and opacity continue; what rotates and what shifts stops", async ({ page }) => {
    await signIn(page);
    const created = sidebar(page).getByRole("button", { name: "Nova ideia" });
    const properties = await created.evaluate((b) => getComputedStyle(b).transitionProperty);
    expect(properties).toContain("background-color");
    expect(properties).not.toContain("scale");
    expect(properties).not.toContain("transform");
  });
});
