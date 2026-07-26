// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import UpdateModal from "../../src/components/update/UpdateModal";
import type {
  IActionResult,
  IYtDlpUpdateCheckResult,
  IYtDlpUpdateResult,
} from "../../src/types";

vi.mock("../../src/lib/api", () => ({
  performYtDlpUpdate: vi.fn(),
}));

const availableResult: IYtDlpUpdateCheckResult = {
  status: "available",
  currentVersion: "2026.07.20",
  latestVersion: "2026.07.25",
};

const currentResult: IYtDlpUpdateCheckResult = {
  status: "current",
  currentVersion: "2026.07.25",
  latestVersion: "2026.07.25",
};

const updateResult: IYtDlpUpdateResult = {
  updated: true,
  currentVersion: "2026.07.25",
  output: "Updated yt-dlp to 2026.07.25",
};

function result(
  data: IYtDlpUpdateCheckResult,
): IActionResult<IYtDlpUpdateCheckResult> {
  return { success: true, data };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("renders updated state only after post-update check confirms current", async () => {
  const checks: IActionResult<IYtDlpUpdateCheckResult>[] = [
    result(availableResult),
    result(currentResult),
  ];
  const onCheck = vi.fn(async () => checks.shift() || result(currentResult));
  const performUpdate = vi.fn(async () => ({
    success: true,
    data: updateResult,
  } satisfies IActionResult<IYtDlpUpdateResult>));

  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "available",
      checkResult: availableResult,
      checkError: "",
      onCheck,
      performUpdate,
    }),
  );

  await fireEvent.click(
    screen.getByRole("button", { name: "ACTUALIZAR AHORA" }),
  );

  await waitFor(() => {
    expect(screen.getByText("yt-dlp actualizado")).toBeTruthy();
  });
  expect(onCheck).toHaveBeenCalledTimes(2);
  expect(performUpdate).toHaveBeenCalledTimes(1);
});

test("ignores rapid duplicate update clicks during preliminary recheck", async () => {
  let resolveInitialCheck!: (
    value: IActionResult<IYtDlpUpdateCheckResult>,
  ) => void;
  const initialCheck = new Promise<IActionResult<IYtDlpUpdateCheckResult>>(
    (resolve) => {
      resolveInitialCheck = resolve;
    },
  );
  let checkCount = 0;
  const onCheck = vi.fn(() => {
    checkCount += 1;
    return checkCount === 1
      ? initialCheck
      : Promise.resolve(result(currentResult));
  });
  const performUpdate = vi.fn(async () => ({
    success: true,
    data: updateResult,
  } satisfies IActionResult<IYtDlpUpdateResult>));

  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "available",
      checkResult: availableResult,
      checkError: "",
      onCheck,
      performUpdate,
    }),
  );

  const updateButton = screen.getByRole("button", {
    name: "ACTUALIZAR AHORA",
  });
  const firstClick = fireEvent.click(updateButton);
  await Promise.resolve();
  await fireEvent.click(updateButton);

  expect(onCheck).toHaveBeenCalledTimes(1);
  expect(updateButton).toHaveProperty("disabled", true);

  resolveInitialCheck(result(availableResult));
  await firstClick;

  await waitFor(() => {
    expect(screen.getByText("yt-dlp actualizado")).toBeTruthy();
  });
  expect(performUpdate).toHaveBeenCalledTimes(1);
});

test("shows an inconclusive warning when post-update versions differ", async () => {
  const differentResult: IYtDlpUpdateCheckResult = {
    status: "different",
    currentVersion: "2026.07.26",
    latestVersion: "2026.07.25",
  };
  const checks: IActionResult<IYtDlpUpdateCheckResult>[] = [
    result(availableResult),
    result(differentResult),
  ];
  const onCheck = vi.fn(async () => checks.shift() || result(differentResult));
  const performUpdate = vi.fn(async () => ({
    success: true,
    data: updateResult,
  } satisfies IActionResult<IYtDlpUpdateResult>));

  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "available",
      checkResult: availableResult,
      checkError: "",
      onCheck,
      performUpdate,
    }),
  );

  await fireEvent.click(
    screen.getByRole("button", { name: "ACTUALIZAR AHORA" }),
  );

  await waitFor(() => {
    expect(screen.getByText("Actualización no confirmada")).toBeTruthy();
  });
  expect(screen.queryByText("No se pudo actualizar yt-dlp")).toBeNull();
  expect(
    screen.getByText(/no puede confirmar que la versión instalada/),
  ).toBeTruthy();
  expect(performUpdate).toHaveBeenCalledTimes(1);
});

test("shows an inconclusive warning when post-update check fails", async () => {
  const checks: IActionResult<IYtDlpUpdateCheckResult>[] = [
    result(availableResult),
    { success: false, error: "GitHub no disponible" },
  ];
  const onCheck = vi.fn(async () => checks.shift() || result(currentResult));
  const performUpdate = vi.fn(async () => ({
    success: true,
    data: updateResult,
  } satisfies IActionResult<IYtDlpUpdateResult>));

  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "available",
      checkResult: availableResult,
      checkError: "",
      onCheck,
      performUpdate,
    }),
  );

  await fireEvent.click(
    screen.getByRole("button", { name: "ACTUALIZAR AHORA" }),
  );

  await waitFor(() => {
    expect(screen.getByText("Actualización no confirmada")).toBeTruthy();
  });
  expect(screen.queryByText("No se pudo actualizar yt-dlp")).toBeNull();
  expect(screen.getByText("GitHub no disponible")).toBeTruthy();
  expect(performUpdate).toHaveBeenCalledTimes(1);
});

test("renders reconciliation error when post-update check still reports available", async () => {
  const onCheck = vi.fn(async () => result(availableResult));
  const performUpdate = vi.fn(async () => ({
    success: true,
    data: updateResult,
  } satisfies IActionResult<IYtDlpUpdateResult>));

  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "available",
      checkResult: availableResult,
      checkError: "",
      onCheck,
      performUpdate,
    }),
  );

  await fireEvent.click(
    screen.getByRole("button", { name: "ACTUALIZAR AHORA" }),
  );

  await waitFor(() => {
    expect(screen.getByText("No se pudo actualizar yt-dlp")).toBeTruthy();
    expect(screen.getByText(/todavía aparece desactualizado/)).toBeTruthy();
  });
  expect(onCheck).toHaveBeenCalledTimes(2);
  expect(performUpdate).toHaveBeenCalledTimes(1);
});

test("explains that downloads remain available during a check", () => {
  render(() =>
    UpdateModal({
      isOpen: true,
      onOpenChange: () => {},
      hasActiveDownloads: false,
      checkStatus: "checking",
      checkError: "",
      onCheck: vi.fn(async () => result(currentResult)),
    }),
  );

  expect(
    screen.getByText("La comprobación es de solo lectura y no bloquea las descargas."),
  ).toBeTruthy();
});
