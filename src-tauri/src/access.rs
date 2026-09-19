//! Native approvals and concurrency limits cannot be supplied by JavaScript.
use std::{
    collections::HashSet,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[derive(Default)]
pub struct Access {
    busy: Arc<AtomicBool>,
    last: Mutex<Option<Instant>>,
    approved: Mutex<HashSet<String>>,
}
pub struct Permit(Arc<AtomicBool>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl Access {
    pub fn begin(&self) -> Result<Permit, String> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            return Err("operation_busy".into());
        }
        let permit = Permit(self.busy.clone());
        let mut last = self.last.lock().map_err(|_| "settings_unavailable")?;
        if last.is_some_and(|t| t.elapsed() < Duration::from_millis(200)) {
            return Err("operation_busy".into());
        }
        *last = Some(Instant::now());
        Ok(permit)
    }
    pub fn require(&self, source: &str) -> Result<(), String> {
        if self
            .approved
            .lock()
            .map_err(|_| "settings_unavailable")?
            .contains(source)
        {
            Ok(())
        } else {
            Err("source_approval_required".into())
        }
    }
    pub fn approve(
        &self,
        app: &tauri::AppHandle,
        source: &str,
        explanation: &str,
    ) -> Result<(), String> {
        if self.require(source).is_ok() {
            return Ok(());
        }
        if !app
            .dialog()
            .message(explanation)
            .title("Agent World · Autorisation de source")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show()
        {
            return Err("source_approval_cancelled".into());
        }
        self.approved
            .lock()
            .map_err(|_| "settings_unavailable")?
            .insert(source.to_owned());
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hostile_ui_cannot_queue_processes_or_forge_approval() {
        let a = Access::default();
        assert!(a.require("/private").is_err());
        let p = a.begin().unwrap();
        assert!(a.begin().is_err());
        drop(p);
        assert!(a.begin().is_err()); // cooldown also applies to failed operations
        assert!(a.require("/private").is_err());
    }
}
