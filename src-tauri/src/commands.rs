pub(crate) mod downloads;
pub(crate) mod files;
mod manager;
mod process;
mod tools;
mod types;
pub(crate) mod updater;

pub use manager::{begin_shutdown, shutdown_complete, shutdown_downloads, DownloadManager};

#[cfg(test)]
mod tests;
