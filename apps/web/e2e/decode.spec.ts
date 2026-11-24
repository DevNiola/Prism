import { expect, test, type Page } from "@playwright/test";

async function diagnoseContractError(page: Page, code: string) {
  await page.getByLabel("Error Code (Numeric)").fill(code);
  await page.getByRole("button", { name: "Diagnose Error" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("prism_onboarding_completed", "true");
  });
  await page.goto("/decode");
});

test("diagnoses a contract error code and renders the result", async ({ page }) => {
  await diagnoseContractError(page, "3");

  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
  await expect(
    page.getByText(
      "The contract instance has already been initialized and cannot be re-initialized.",
    ),
  ).toBeVisible();
});

test("network switcher updates the selected network", async ({ page }) => {
  await page.route("**/v1/health", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );
  const network = page.getByRole("combobox", { name: "Select Stellar network" });

  await network.selectOption("mainnet");

  await expect(network).toBeEnabled();
  await expect(network).toHaveValue("mainnet");
});

test("recent transactions reopen a prior diagnosis", async ({ page }) => {
  await diagnoseContractError(page, "3");
  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /AlreadyInitializedError/ }).click();

  await expect(page).toHaveURL(/\/decode\?txHash=/);
  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
  await page.reload();
  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
});

test("the form rejects negative error codes", async ({ page }) => {
  const code = page.getByLabel("Error Code (Numeric)");
  await code.fill("-1");
  await page.getByRole("button", { name: "Diagnose Error" }).click();

  await expect(code).toHaveJSProperty("value", "-1");
  await expect(page.locator("#decode-error-code:invalid")).toBeVisible();
});
