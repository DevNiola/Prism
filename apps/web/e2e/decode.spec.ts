import { expect, test } from "@playwright/test";

const transactionHash = "a".repeat(64);
const diagnosticReport = {
  error_category: "Contract",
  error_code: 3,
  error_name: "AlreadyInitializedError",
  summary: "The contract instance has already been initialized.",
  detailed_explanation: "Initialization can only be performed once.",
  severity: "error",
  root_causes: [],
  suggested_fixes: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/decode", async (route) => {
    const body = route.request().postDataJSON() as {
      txHash: string;
      network: string;
    };

    if (body.txHash === "invalid") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Transaction hash was not found." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(diagnosticReport),
    });
  });
});

test("decodes a transaction hash and renders the result", async ({ page }) => {
  await page.goto("/decode");
  await page.getByLabel("Transaction hash").fill(transactionHash);
  await page.getByRole("button", { name: "Decode transaction" }).click();

  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
  await expect(page.getByText(diagnosticReport.summary)).toBeVisible();
});

test("network switcher updates the selected network", async ({ page }) => {
  await page.goto("/decode");
  const network = page.getByRole("combobox", { name: "Network" });

  await network.selectOption("mainnet");

  await expect(network).toHaveValue("mainnet");
});

test("share link restores a decoded session", async ({ page }) => {
  await page.goto("/decode");
  await page.getByLabel("Transaction hash").fill(transactionHash);
  await page.getByRole("button", { name: "Decode transaction" }).click();
  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]txHash=${transactionHash}`));

  await page.reload();

  await expect(page.getByText("AlreadyInitializedError")).toBeVisible();
});

test("invalid transaction hash shows an error", async ({ page }) => {
  await page.goto("/decode");
  await page.getByLabel("Transaction hash").fill("invalid");
  await page.getByRole("button", { name: "Decode transaction" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Transaction hash was not found."
  );
});