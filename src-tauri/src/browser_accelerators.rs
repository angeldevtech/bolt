use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
use windows_core::Interface;

pub fn disable(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| {
        let result = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false))
        };

        if let Err(error) = result {
            log::error!("Failed to disable WebView2 browser accelerator keys: {error}");
        }
    })
}
