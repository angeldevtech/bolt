import type { IYouTubeSource } from "../types";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const YOUTUBE_IMAGE_HOSTS = [
  "img.youtube.com",
  "i.ytimg.com",
];

const VALID_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const VALID_PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{2,100}$/;
const MAX_URL_LENGTH = 2048;

function isYouTubeHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(lower);
}

export function classifyUrl(input: string): IYouTubeSource | { error: string } {
  if (!input || input.length > MAX_URL_LENGTH) {
    return { error: "URL demasiado larga o vacía." };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: "URL no válida." };
  }

  if (url.protocol === "http:") {
    url.protocol = "https:";
  }

  if (url.protocol !== "https:") {
    return { error: "Solo se aceptan URLs HTTPS." };
  }

  if (url.username || url.password) {
    return { error: "La URL no debe contener credenciales." };
  }
  if (url.port) {
    return { error: "La URL no debe contener puertos." };
  }

  const hostname = url.hostname.toLowerCase();

  if (!isYouTubeHost(hostname)) {
    return genericSource(url);
  }

  return classifyYouTube(url, hostname);
}

function genericSource(url: URL): IYouTubeSource {
  url.hash = "";
  return { type: "generic", canonicalUrl: url.toString() };
}

function classifyYouTube(url: URL, hostname: string): IYouTubeSource | { error: string } {
  const params = new URLSearchParams(url.search);

  if (params.getAll("v").length > 1) return { error: "Parámetro 'v' duplicado." };
  if (params.getAll("list").length > 1) return { error: "Parámetro 'list' duplicado." };

  const rawVideoId = params.get("v") || undefined;
  const rawPlaylistId = params.get("list") || undefined;
  const startRadio = params.get("start_radio") === "1";

  let videoId: string | undefined;
  let playlistId: string | undefined;

  if (hostname === "youtu.be") {
    const path = url.pathname.slice(1).replace(/\/$/, "");
    if (!VALID_VIDEO_ID_RE.test(path)) {
      return { error: "ID de video de youtu.be no válido." };
    }
    videoId = path;
    if (rawPlaylistId) {
      if (!VALID_PLAYLIST_ID_RE.test(rawPlaylistId)) {
        return { error: "ID de playlist no válido." };
      }
      playlistId = rawPlaylistId;
    }
  } else {
    if (rawVideoId && !VALID_VIDEO_ID_RE.test(rawVideoId)) {
      return { error: "ID de video no válido." };
    }

    if (rawPlaylistId) {
      if (!VALID_PLAYLIST_ID_RE.test(rawPlaylistId)) {
        return { error: "ID de playlist no válido." };
      }
      playlistId = rawPlaylistId;
    }

    const path = url.pathname;
    const isWatchPath = path === "/watch" || path === "/watch/";
    const isPlaylistPath = path === "/playlist" || path === "/playlist/";

    if (isWatchPath) {
      if (rawVideoId) {
        videoId = rawVideoId;
      }
    } else if (isPlaylistPath) {
      if (!playlistId) {
        return { error: "Falta el parámetro 'list' en la URL de playlist." };
      }
    } else {
      let prefix = "";
      let label = "";
      if (path.startsWith("/shorts/")) {
        prefix = "/shorts/";
        label = "Shorts";
      } else if (path.startsWith("/embed/")) {
        prefix = "/embed/";
        label = "Embed";
      } else {
        return { error: "Ruta de YouTube no compatible." };
      }

      const id = path.slice(prefix.length).replace(/\/$/, "");
      if (!VALID_VIDEO_ID_RE.test(id) || id.includes("/")) {
        return { error: `ID de ${label} no válido.` };
      }
      if (rawVideoId && rawVideoId !== id) {
        return { error: "La URL contiene IDs de video diferentes." };
      }
      videoId = id;
    }
  }

  const isRadioPlaylist = Boolean(
    startRadio || (playlistId && playlistId.startsWith("RD")),
  );

  if (isRadioPlaylist) {
    if (videoId) {
      return {
        type: "radio",
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        playlistId,
      };
    }
    return { type: "radio", canonicalUrl: "", playlistId };
  }

  const isDirectPlaylist = url.pathname === "/playlist" || url.pathname === "/playlist/";

  if (isDirectPlaylist) {
    if (!playlistId) {
      return { error: "Falta el ID de playlist." };
    }
    return {
      type: "playlist",
      canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      playlistId,
    };
  }

  if (videoId && playlistId) {
    return {
      type: "video+playlist",
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      playlistId,
    };
  }

  if (videoId) {
    return {
      type: "video",
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
    };
  }

  if (playlistId) {
    return {
      type: "playlist",
      canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      playlistId,
    };
  }

  return { error: "No se pudo identificar un video o playlist en la URL." };
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

export function isValidImageHost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && YOUTUBE_IMAGE_HOSTS.includes(url.hostname.toLowerCase())
      && url.pathname.length < 200;
  } catch {
    return false;
  }
}
