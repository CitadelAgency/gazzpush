// The screens in parts (web/src/kit/Parts.tsx): the accordion row or the master-detail list item, the same button.
import { expect, type Page } from "@playwright/test";

export const partLine = (page: Page, name: string | RegExp) => {
  const source = typeof name === "string" ? name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : name.source.replace(/^\^/, "");
  return page.getByRole("button", { name: new RegExp(`^${source}`, "i") }).first();
};

/** Opens the part, if it is not open yet. */
export async function part(page: Page, label: string | RegExp) {
  const b = partLine(page, label);
  await expect(b).toBeVisible();
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(b).toHaveAttribute("aria-expanded", "true");
}
