pub(super) const YOUTUBE_HOSTS: &[&str] = &[
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];

const YOUTUBE_IMAGE_HOSTS: &[&str] = &["img.youtube.com", "i.ytimg.com"];

const VALID_VIDEO_ID_RE: &str = r"^[a-zA-Z0-9_-]{11}$";

#[derive(Clone, Debug, PartialEq)]
pub(super) enum YouTubeSourceType {
    Video,
    Playlist,
    VideoPlusPlaylist,
    Radio,
    Generic,
}

#[derive(Clone, Debug)]
pub(super) struct YouTubeSource {
    pub source_type: YouTubeSourceType,
    pub canonical_url: String,
}

pub(super) fn is_youtube_host(hostname: &str) -> bool {
    YOUTUBE_HOSTS.contains(&hostname.to_lowercase().as_str())
}

pub(super) fn validate_video_id(id: &str) -> bool {
    regex_lite::Regex::new(VALID_VIDEO_ID_RE)
        .map(|re| re.is_match(id))
        .unwrap_or(false)
}

pub(super) fn validate_playlist_id(id: &str) -> bool {
    if id.len() < 2 || id.len() > 100 {
        return false;
    }
    id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub(super) fn is_radio_playlist(playlist_id: &str) -> bool {
    playlist_id.starts_with("RD") || playlist_id.starts_with("RDMM")
}

pub(super) fn validate_thumbnail_url(url: &str) -> bool {
    if !url.starts_with("https://") {
        return false;
    }
    if url.len() > 500 {
        return false;
    }
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = parsed.host_str().unwrap_or("");
    if parsed.username() != "" || parsed.password().is_some() || parsed.port().is_some() {
        return false;
    }
    if parsed.path().len() >= 200 {
        return false;
    }
    YOUTUBE_IMAGE_HOSTS.contains(&host.to_lowercase().as_str())
}

pub(super) fn classify_url(input: &str) -> Result<YouTubeSource, String> {
    let input = input.trim();
    if input.is_empty() || input.len() > 2048 {
        return Err("URL demasiado larga.".into());
    }
    if input.chars().any(|character| character.is_control()) {
        return Err("La URL contiene caracteres de control no válidos.".into());
    }

    let mut url = url::Url::parse(input).map_err(|_| "URL no válida.".to_string())?;

    if url.scheme() == "http" {
        url.set_scheme("https").map_err(|_| "No se pudo cambiar a HTTPS.".to_string())?;
    }

    if url.scheme() != "https" {
        return Err("Solo se aceptan URLs HTTPS.".into());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("La URL no debe contener credenciales.".into());
    }
    if url.port().is_some() {
        return Err("La URL no debe contener puertos.".into());
    }

    let hostname = url
        .host_str()
        .ok_or_else(|| "La URL no contiene un host válido.".to_string())?
        .to_lowercase();

    if !is_youtube_host(&hostname) {
        url.set_fragment(None);
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::Generic,
            canonical_url: url.to_string(),
        });
    }

    classify_youtube(&url, &hostname)
}

fn classify_youtube(url: &url::Url, hostname: &str) -> Result<YouTubeSource, String> {
    let params: std::collections::HashMap<String, Vec<String>> =
        url.query_pairs().fold(
            std::collections::HashMap::new(),
            |mut acc, (k, v)| {
                acc.entry(k.to_string())
                    .or_default()
                    .push(v.to_string());
                acc
            },
        );

    if params.get("v").map_or(false, |v| v.len() > 1) {
        return Err("Parámetro 'v' duplicado.".into());
    }
    if params.get("list").map_or(false, |v| v.len() > 1) {
        return Err("Parámetro 'list' duplicado.".into());
    }

    let raw_video_id = params.get("v").and_then(|v| v.first().cloned());
    let raw_playlist_id = params.get("list").and_then(|v| v.first().cloned());
    let start_radio = params.get("start_radio").and_then(|v| v.first()).map(|s| s == "1").unwrap_or(false);

    let mut video_id: Option<String> = None;
    let mut playlist_id: Option<String> = None;

    if hostname == "youtu.be" {
        let path = url.path().strip_prefix('/').unwrap_or("");
        let path = path.strip_suffix('/').unwrap_or(path);
        let id = path;
        if !validate_video_id(id) {
            return Err("ID de video de youtu.be no válido.".into());
        }
        video_id = Some(id.to_string());
        if let Some(pid) = &raw_playlist_id {
            if !validate_playlist_id(pid) {
                return Err("ID de playlist no válido.".into());
            }
            playlist_id = Some(pid.clone());
        }
    } else {
        if let Some(vid) = &raw_video_id {
            if !validate_video_id(vid) {
                return Err("ID de video no válido.".into());
            }
        }

        if let Some(pid) = &raw_playlist_id {
            if !validate_playlist_id(pid) {
                return Err("ID de playlist no válido.".into());
            }
            playlist_id = Some(pid.clone());
        }

        let path = url.path();

        let is_watch_path = path == "/watch" || path == "/watch/";
        let is_playlist_path = path == "/playlist" || path == "/playlist/";
        if is_watch_path {
            if let Some(vid) = &raw_video_id {
                if !validate_video_id(vid) {
                    return Err("ID de video no válido.".into());
                }
                video_id = Some(vid.clone());
            }
        } else if is_playlist_path {
            if playlist_id.is_none() {
                return Err("Falta el parámetro 'list' en la URL de playlist.".into());
            }
        } else {
            let (label, prefix) = if path.starts_with("/shorts/") {
                ("Shorts", "/shorts/")
            } else if path.starts_with("/embed/") {
                ("Embed", "/embed/")
            } else {
                return Err("Ruta de YouTube no compatible.".into());
            };
            let path_id = path
                .strip_prefix(prefix)
                .and_then(|value| value.strip_suffix('/').or(Some(value)))
                .unwrap_or("");
            if path_id.is_empty() || path_id.contains('/') || !validate_video_id(path_id) {
                return Err(format!("ID de {} no válido.", label));
            }
            if let Some(vid) = &raw_video_id {
                if vid != path_id {
                    return Err("La URL contiene IDs de video diferentes.".into());
                }
            }
            video_id = Some(path_id.to_string());
        }
    }

    let is_radio = playlist_id.as_ref().map(|p| is_radio_playlist(p)).unwrap_or(false) || start_radio;

    if is_radio {
        if let Some(vid) = &video_id {
            return Ok(YouTubeSource {
                source_type: YouTubeSourceType::Radio,
                canonical_url: format!("https://www.youtube.com/watch?v={}", vid),
            });
        }
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::Radio,
            canonical_url: String::new(),
        });
    }

    let is_direct_playlist = url.path() == "/playlist" || url.path() == "/playlist/";

    if is_direct_playlist {
        let pid = playlist_id.clone().ok_or_else(|| "Falta el ID de playlist.".to_string())?;
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::Playlist,
            canonical_url: format!("https://www.youtube.com/playlist?list={}", pid),
        });
    }

    if video_id.is_some() && playlist_id.is_some() {
        let vid = video_id.clone().unwrap();
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::VideoPlusPlaylist,
            canonical_url: format!("https://www.youtube.com/watch?v={}", vid),
        });
    }

    if let Some(vid) = &video_id {
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::Video,
            canonical_url: format!("https://www.youtube.com/watch?v={}", vid),
        });
    }

    if let Some(pid) = &playlist_id {
        return Ok(YouTubeSource {
            source_type: YouTubeSourceType::Playlist,
            canonical_url: format!("https://www.youtube.com/playlist?list={}", pid),
        });
    }

    Err("No se pudo identificar un video o playlist en la URL.".into())
}

pub(super) fn canonical_video_url(video_id: &str) -> String {
    format!("https://www.youtube.com/watch?v={}", video_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_video() {
        let result = classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_playlist() {
        let result = classify_url("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Playlist);
        assert_eq!(
            result.canonical_url,
            "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
        );
    }

    #[test]
    fn test_classify_video_plus_playlist() {
        let result = classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::VideoPlusPlaylist);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_radio_rd() {
        let result = classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabc&start_radio=1").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Radio);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_radio_only() {
        let result = classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDMMabc").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Radio);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_start_radio_without_playlist() {
        let result = classify_url(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start_radio=1",
        )
        .unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Radio);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_youtu_be() {
        let result = classify_url("https://youtu.be/dQw4w9WgXcQ").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_shorts() {
        let result = classify_url("https://www.youtube.com/shorts/dQw4w9WgXcQ").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_embed() {
        let result = classify_url("https://www.youtube.com/embed/dQw4w9WgXcQ").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }

    #[test]
    fn test_classify_generic() {
        let result = classify_url("https://vimeo.com/123456").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Generic);
    }

    #[test]
    fn test_reject_duplicate_params() {
        assert!(classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=abc").is_err());
        assert!(classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=a&list=b").is_err());
    }

    #[test]
    fn test_reject_invalid_video_id() {
        assert!(classify_url("https://www.youtube.com/watch?v=tooshort").is_err());
        assert!(classify_url("https://www.youtube.com/watch?v=invalid!id@here").is_err());
    }

    #[test]
    fn test_validate_thumbnail_url() {
        assert!(validate_thumbnail_url("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
        assert!(validate_thumbnail_url("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"));
        assert!(!validate_thumbnail_url("http://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
        assert!(!validate_thumbnail_url("https://evil.com/vi/dQw4w9WgXcQ/mqdefault.jpg"));
    }

    #[test]
    fn test_reject_radio_playlist_id() {
        assert!(is_radio_playlist("RDMMabc"));
        assert!(is_radio_playlist("RDabc"));
        assert!(!is_radio_playlist("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"));
    }

    #[test]
    fn test_music_youtube() {
        let result = classify_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
    }

    #[test]
    fn test_classify_with_index_and_tracking() {
        let result = classify_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&index=2&si=abc123&pp=ygUJdGVzdF9pZHg%3D").unwrap();
        assert_eq!(result.source_type, YouTubeSourceType::Video);
        assert_eq!(result.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
}
