use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct InstanceLog {
    pub instance: String,
    pub r#type: String,
    pub message: String,
}

pub fn emit_log(app: &AppHandle, instance_id: &str, log_type: &str, message: &str) {
    println!("{}", message);
    app.emit(
        "instance-logger",
        InstanceLog {
            instance: instance_id.to_string(),
            r#type: log_type.to_string(),
            message: message.to_string(),
        },
    )
    .ok();
}

#[macro_export]
macro_rules! ilog {
    ($app:expr, $instance_id:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::logger::emit_log($app, $instance_id, "log", &msg);
    }};
}

#[macro_export]
macro_rules! ilog_err {
    ($app:expr, $instance_id:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::logger::emit_log($app, $instance_id, "error", &msg);
    }};
}
