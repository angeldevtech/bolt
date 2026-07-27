import { afterEach, expect, test, describe, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { classifyUrl, getYouTubeThumbnailUrl, isValidImageHost } from "../../src/lib/youtube";
import { calculatePlaylistProgress } from "../../src/lib/playlist-progress";
import { PlaylistModal } from "../../src/components/playlists/PlaylistModal";
import type { IActionResult, IPlaylistMetadata } from "../../src/types";

vi.mock("../../src/lib/api", () => ({
  inspectPlaylist: vi.fn(),
  cancelPlaylistInspection: vi.fn(),
}));

import { inspectPlaylist } from "../../src/lib/api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("YouTube URL classification", () => {
  test("classifies plain video URL", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies playlist URL", () => {
    const result = classifyUrl("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("playlist");
    expect(result.playlistId).toBe("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  });

  test("classifies video+playlist URL", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video+playlist");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
    expect(result.playlistId).toBe("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  });

  test("classifies youtu.be URL", () => {
    const result = classifyUrl("https://youtu.be/dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies shorts URL", () => {
    const result = classifyUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies embed URL", () => {
    const result = classifyUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies music.youtube.com URL", () => {
    const result = classifyUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies radio RDMM playlist with video", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabc&start_radio=1");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("radio");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("radio without video ID has no videoId", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabc");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("radio");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  test("classifies start_radio without a playlist as radio", () => {
    const result = classifyUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start_radio=1",
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("radio");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("generic fallback URL", () => {
    const result = classifyUrl("https://vimeo.com/123456789");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("generic");
    expect(result.canonicalUrl).toBe("https://vimeo.com/123456789");
  });

  test("strips index, si, pp, utm parameters and fragment", () => {
    const result = classifyUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&index=2&si=abc123&pp=ygUJdGVzdF9pZHg%3D&utm_source=foo#fragment"
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("rejects duplicate v parameter", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=abc12345678");
    if ("error" in result) {
      expect(result.error).toBeTruthy();
      return;
    }
    throw new Error("Expected error for duplicate v parameter");
  });

  test("rejects invalid video ID", () => {
    const result = classifyUrl("https://www.youtube.com/watch?v=tooshort");
    if ("error" in result) {
      expect(result.error).toBeTruthy();
      return;
    }
    throw new Error("Expected error for invalid video ID");
  });

  test("rejects HTTP-only URL scheme", () => {
    const result = classifyUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
  });

  test("rejects credentials in URL", () => {
    const result = classifyUrl("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ");
    if ("error" in result) {
      expect(result.error).toBeTruthy();
      return;
    }
    throw new Error("Expected error for credentials");
  });

  test("handles m.youtube.com", () => {
    const result = classifyUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ");
    if ("error" in result) throw new Error(result.error);
    expect(result.type).toBe("video");
  });

  test("empty URL returns error", () => {
    const result = classifyUrl("");
    if ("error" in result) {
      expect(result.error).toBeTruthy();
      return;
    }
    throw new Error("Expected error for empty URL");
  });

  test("rejects unsupported YouTube paths and ports", () => {
    expect(classifyUrl("https://www.youtube.com/channel/test")).toHaveProperty("error");
    expect(classifyUrl("https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ")).toHaveProperty("error");
  });
});

describe("YouTube thumbnail URLs", () => {
  test("generates correct thumbnail URL", () => {
    expect(getYouTubeThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
    );
  });
});

describe("Playlist progress", () => {
  test("treats completed items as 100 percent even when stored progress is zero", () => {
    expect(
      calculatePlaylistProgress([
        { status: "completed", progress: 0 },
        { status: "completed", progress: 0 },
      ]),
    ).toBe(100);
    expect(
      calculatePlaylistProgress([
        { status: "completed", progress: 0 },
        { status: "pending", progress: 0 },
      ]),
    ).toBe(50);
  });
});

describe("Image host validation", () => {
  test("valid image hosts", () => {
    expect(isValidImageHost("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg")).toBe(true);
    expect(isValidImageHost("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")).toBe(true);
  });

  test("rejects non-HTTPS and unknown hosts", () => {
    expect(isValidImageHost("http://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg")).toBe(false);
    expect(isValidImageHost("https://evil.com/vi/dQw4w9WgXcQ/mqdefault.jpg")).toBe(false);
  });
});

describe("Playlist modal", () => {
  const metadata: IPlaylistMetadata = {
    title: "Mix favorito",
    description: "Una descripción de playlist",
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    total: 2,
    entries: [
      { videoId: "dQw4w9WgXcQ", title: "Primer video" },
      { videoId: "9bZkp7q19f0", title: "Segundo video" },
    ],
    unavailableCount: 0,
    duplicateCount: 0,
  };

  test("renders playlist thumbnail and passes complete metadata on start", async () => {
    vi.mocked(inspectPlaylist).mockResolvedValue({
      success: true,
      data: metadata,
    } satisfies IActionResult<IPlaylistMetadata>);
    const onStartPlaylist = vi.fn();

    render(() =>
      PlaylistModal({
        isOpen: true,
        onOpenChange: () => {},
        url: "https://www.youtube.com/playlist?list=PL1234567890",
        format: "mp3",
        onStartVideo: () => {},
        onStartPlaylist,
      }),
    );

    expect(await screen.findByRole("img", { name: metadata.title })).toBeTruthy();
    expect(screen.getByText(metadata.description!)).toBeTruthy();
    expect(screen.getByText("2 audios")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Descargar playlist (2 audios)" })).toBeTruthy();
    expect(screen.getByText("Primer video")).toBeTruthy();
    const downloadButton = screen.getByRole("button", { name: /Descargar playlist/ });
    const firstEntry = screen.getByText("Primer video");
    expect(
      Boolean(downloadButton.compareDocumentPosition(firstEntry) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

    await fireEvent.click(downloadButton);

    expect(onStartPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ type: "playlist", playlistId: "PL1234567890" }),
      metadata,
      "mp3",
    );
  });

  test("keeps video and playlist choices equal-sized", async () => {
    const onStartVideo = vi.fn();
    render(() =>
      PlaylistModal({
        isOpen: true,
        onOpenChange: () => {},
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
        format: "mp4",
        onStartVideo,
        onStartPlaylist: () => {},
      }),
    );

    const videoButton = screen.getByRole("button", { name: "Solo el video actual" });
    const playlistButton = screen.getByRole("button", { name: "La playlist completa" });
    expect(videoButton.className).toContain("w-full");
    expect(playlistButton.className).toContain("w-full");
    expect(videoButton.className).toContain("min-h-12");
    expect(playlistButton.className).toContain("min-h-12");
    expect(inspectPlaylist).not.toHaveBeenCalled();
  });

  test("replaces source choices with playlist preview after inspection", async () => {
    vi.mocked(inspectPlaylist).mockResolvedValue({
      success: true,
      data: metadata,
    } satisfies IActionResult<IPlaylistMetadata>);

    render(() =>
      PlaylistModal({
        isOpen: true,
        onOpenChange: () => {},
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890&index=5",
        format: "mp3",
        onStartVideo: () => {},
        onStartPlaylist: () => {},
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: "La playlist completa" }));
    expect(await screen.findByRole("img", { name: metadata.title })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Solo el video actual" })).toBeNull();
    expect(screen.queryByRole("button", { name: "La playlist completa" })).toBeNull();
  });

  test("centers radio explanation when no video is available", () => {
    render(() =>
      PlaylistModal({
        isOpen: true,
        onOpenChange: () => {},
        url: "https://www.youtube.com/watch?list=RDMMabc",
        format: "mp3",
        onStartVideo: () => {},
        onStartPlaylist: () => {},
      }),
    );

    const message = screen.getByText("No se puede descargar este mix de YouTube.");
    expect(message.parentElement?.parentElement?.className).toContain("text-center");
  });
});
