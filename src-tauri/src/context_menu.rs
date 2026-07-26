use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2ContextMenuItem, ICoreWebView2ContextMenuRequestedEventArgs,
    ICoreWebView2Controller, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
};
use webview2_com::{take_pwstr, ContextMenuRequestedEventHandler};
use windows_core::{Interface, BOOL, PWSTR};

const EDITABLE_COMMANDS: &[&str] = &[
    "undo",
    "cut",
    "copy",
    "paste",
    "pasteAsPlainText",
    "selectAll",
];
const READ_ONLY_SELECTION_COMMANDS: &[&str] = &["copy", "selectAll"];

pub fn setup(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| {
        if let Err(error) = register_handler(webview.controller()) {
            log::error!("Failed to register Windows context-menu filter: {error}");
        }
    })
}

fn register_handler(controller: ICoreWebView2Controller) -> Result<(), String> {
    let webview = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let webview = webview
        .cast::<ICoreWebView2_11>()
        .map_err(|error| error.to_string())?;
    let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else {
            return Ok(());
        };

        if let Err(error) = filter_menu(&args) {
            log::error!("Failed to filter Windows context menu: {error}");
            unsafe {
                let _ = args.SetHandled(true);
            }
        }

        Ok(())
    }));
    let mut token = 0;

    unsafe {
        webview
            .add_ContextMenuRequested(&handler, &mut token)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn filter_menu(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> Result<(), String> {
    let target = unsafe { args.ContextMenuTarget() }.map_err(|error| error.to_string())?;
    let mut is_editable = BOOL::default();
    let mut has_selection = BOOL::default();

    unsafe {
        target
            .IsEditable(&mut is_editable)
            .map_err(|error| error.to_string())?;
        target
            .HasSelection(&mut has_selection)
            .map_err(|error| error.to_string())?;
    }

    let is_editable = is_editable.as_bool();
    let has_selection = has_selection.as_bool();
    if !is_editable && !has_selection {
        unsafe {
            args.SetHandled(true).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let menu_items = unsafe { args.MenuItems() }.map_err(|error| error.to_string())?;
    let mut count = 0;
    unsafe {
        menu_items
            .Count(&mut count)
            .map_err(|error| error.to_string())?;
    }

    for index in (0..count).rev() {
        let item =
            unsafe { menu_items.GetValueAtIndex(index) }.map_err(|error| error.to_string())?;
        if !keep_item(&item, is_editable, has_selection)? {
            unsafe {
                menu_items
                    .RemoveValueAtIndex(index)
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    let mut remaining = 0;
    unsafe {
        menu_items
            .Count(&mut remaining)
            .map_err(|error| error.to_string())?;
        if remaining == 0 {
            args.SetHandled(true).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn keep_item(
    item: &ICoreWebView2ContextMenuItem,
    is_editable: bool,
    has_selection: bool,
) -> Result<bool, String> {
    let mut kind = Default::default();
    unsafe {
        item.Kind(&mut kind).map_err(|error| error.to_string())?;
    }
    if kind != COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND {
        return Ok(false);
    }

    let mut name = PWSTR::null();
    unsafe {
        item.Name(&mut name).map_err(|error| error.to_string())?;
    }
    let name = take_pwstr(name);

    Ok(should_keep_command(&name, is_editable, has_selection))
}

fn should_keep_command(name: &str, is_editable: bool, has_selection: bool) -> bool {
    if is_editable {
        EDITABLE_COMMANDS.contains(&name)
    } else {
        has_selection && READ_ONLY_SELECTION_COMMANDS.contains(&name)
    }
}

#[cfg(test)]
mod tests {
    use super::should_keep_command;

    #[test]
    fn keeps_all_editable_text_commands() {
        for command in [
            "undo",
            "cut",
            "copy",
            "paste",
            "pasteAsPlainText",
            "selectAll",
        ] {
            assert!(should_keep_command(command, true, false));
        }
    }

    #[test]
    fn keeps_copy_and_select_all_for_read_only_selections() {
        assert!(should_keep_command("copy", false, true));
        assert!(should_keep_command("selectAll", false, true));
        assert!(!should_keep_command("paste", false, true));
        assert!(!should_keep_command("copy", false, false));
    }

    #[test]
    fn rejects_browser_system_and_unknown_commands() {
        for command in [
            "back",
            "refresh",
            "saveAs",
            "print",
            "moreTools",
            "sendTabToYourDevice",
            "emoji",
            "passwordImport",
            "writingDirection",
            "futureCommand",
        ] {
            assert!(!should_keep_command(command, true, true));
            assert!(!should_keep_command(command, false, true));
        }
    }
}
