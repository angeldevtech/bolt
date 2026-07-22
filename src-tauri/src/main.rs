#![cfg_attr(
    all(not(debug_assertions), not(feature = "diagnostic")),
    windows_subsystem = "windows"
)]

fn main() {
    app_lib::run();
}
