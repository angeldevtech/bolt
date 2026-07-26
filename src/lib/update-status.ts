import type {
  IActionResult,
  IYtDlpUpdateCheckResult,
  IYtDlpUpdateResult,
} from "../types";

export type TPostUpdateStatus =
  | "updated"
  | "current"
  | "different"
  | "inconclusive"
  | "error";

export interface IPostUpdateStatus {
  status: TPostUpdateStatus;
  error?: string;
}

export function reconcilePostUpdateCheck(
  update: IYtDlpUpdateResult,
  check: IActionResult<IYtDlpUpdateCheckResult>,
): IPostUpdateStatus {
  if (!check.success || !check.data) {
    return {
      status: "inconclusive",
      error:
        check.error ||
        "La actualización terminó, pero no se pudo comprobar la versión instalada.",
    };
  }

  if (check.data.status === "current") {
    return { status: update.updated ? "updated" : "current" };
  }

  if (check.data.status === "available") {
    return {
      status: "error",
      error:
        "La actualización terminó, pero yt-dlp todavía aparece desactualizado. Comprueba de nuevo o reintenta.",
    };
  }

  return {
    status: "different",
    error:
      "La actualización terminó, pero Bolt no puede confirmar que la versión instalada corresponda a la publicada.",
  };
}
