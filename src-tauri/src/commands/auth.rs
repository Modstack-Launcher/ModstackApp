use super::instance::offline_uuid;
use minecraft_msa_auth::MinecraftAuthorizationFlow;
use reqwest::Client;
use serde_json::{json, Value};
use tauri::command;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};
use urlencoding::decode;

const CLIENT_ID: &str = "28345b95-0610-4565-b77d-03a20a541560";
const REDIRECT_URI: &str = "http://localhost:7878/callback";

// ---------------------------------------------------------------------------
// Microsoft login
//
// Why it is built this way (each point fixed a real "login says success but the
// launcher never logs in" report):
// * The browser page is answered only AFTER the whole Microsoft -> Xbox ->
//   Minecraft chain finished, so it can show the real error instead of always
//   saying "success" (no Xbox profile, minors, no Minecraft Java license...).
// * Every connection is handled in its own task with a read timeout. Chrome/Edge
//   open speculative "preconnect" sockets that never send a request; reading
//   them inline used to block the real callback until the timeout.
// * We listen on both 127.0.0.1 and [::1]: "localhost" may resolve to IPv6.
// * Starting a new login cancels the previous one so port 7878 is freed
//   (closing the browser tab used to leave it busy -> "Port 7878 in use").
// * A random `state` is checked to reject stale/forged callbacks.
// ---------------------------------------------------------------------------

static ACTIVE_LOGIN: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>> =
    std::sync::Mutex::new(None);

const LOGIN_PAGE: &str = include_str!("../commands/auth_success.html");

struct LoginText {
    success_title: &'static str,
    success_message: &'static str,
    error_title: &'static str,
    expired: &'static str,
    cancelled: &'static str,
    no_xbox: &'static str,
    family: &'static str,
    region: &'static str,
    age: &'static str,
    no_minecraft: &'static str,
    generic: &'static str,
    open_button: &'static str,
}

fn login_text(language: &str) -> LoginText {
    match language {
        "es" => LoginText {
            success_title: "¡Sesión iniciada!",
            success_message: "Ya puedes volver a Modstack.",
            error_title: "No se pudo iniciar sesión",
            expired: "Este enlace de inicio de sesión caducó. Vuelve a iniciar sesión desde el launcher.",
            cancelled: "Cancelaste el inicio de sesión de Microsoft.",
            no_xbox: "Tu cuenta de Microsoft no tiene perfil de Xbox. Entra en xbox.com, crea tu perfil (gratis) y vuelve a intentarlo.",
            family: "La cuenta es de un menor de edad: un adulto debe añadirla a un grupo familiar de Microsoft (account.microsoft.com/family).",
            region: "Xbox Live no está disponible en el país de tu cuenta de Microsoft.",
            age: "Tu cuenta necesita verificación de edad. Entra en xbox.com con esta cuenta, complétala y vuelve a intentarlo.",
            no_minecraft: "Esta cuenta no tiene Minecraft: Java Edition. Si lo compraste con otra cuenta, inicia sesión con esa. Si tienes Game Pass, abre una vez el launcher oficial para activar la licencia.",
            generic: "Ocurrió un error al conectar con Microsoft/Xbox. Revisa tu conexión e inténtalo de nuevo.",
            open_button: "Abrir Modstack",
        },
        "pt" => LoginText {
            success_title: "Login concluído!",
            success_message: "Você já pode voltar ao Modstack.",
            error_title: "Não foi possível entrar",
            expired: "Este link de login expirou. Inicie o login novamente pelo launcher.",
            cancelled: "Você cancelou o login da Microsoft.",
            no_xbox: "Sua conta Microsoft não tem perfil Xbox. Acesse xbox.com, crie seu perfil (grátis) e tente de novo.",
            family: "A conta é de um menor de idade: um adulto precisa adicioná-la a um grupo familiar da Microsoft (account.microsoft.com/family).",
            region: "O Xbox Live não está disponível no país da sua conta Microsoft.",
            age: "Sua conta precisa de verificação de idade. Entre em xbox.com com esta conta, conclua e tente de novo.",
            no_minecraft: "Esta conta não tem Minecraft: Java Edition. Se você comprou com outra conta, entre com ela. Se tem Game Pass, abra o launcher oficial uma vez para ativar a licença.",
            generic: "Ocorreu um erro ao conectar com a Microsoft/Xbox. Verifique sua conexão e tente de novo.",
            open_button: "Abrir Modstack",
        },
        _ => LoginText {
            success_title: "You're signed in!",
            success_message: "You can go back to Modstack now.",
            error_title: "Sign-in failed",
            expired: "This sign-in link expired. Start the login again from the launcher.",
            cancelled: "You cancelled the Microsoft sign-in.",
            no_xbox: "Your Microsoft account has no Xbox profile. Go to xbox.com, create your (free) profile and try again.",
            family: "This account belongs to a minor: an adult must add it to a Microsoft family group (account.microsoft.com/family).",
            region: "Xbox Live is not available in your Microsoft account's country.",
            age: "Your account needs age verification. Sign in to xbox.com with this account, complete it and try again.",
            no_minecraft: "This account doesn't own Minecraft: Java Edition. If you bought it on another account, sign in with that one. With Game Pass, open the official launcher once to activate the license.",
            generic: "Something went wrong talking to Microsoft/Xbox. Check your connection and try again.",
            open_button: "Open Modstack",
        },
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_login_page(success: bool, title: &str, message: &str, button: &str) -> String {
    LOGIN_PAGE
        .replace("__MODSTACK_STATUS__", if success { "success" } else { "error" })
        .replace("__MODSTACK_TITLE__", &html_escape(title))
        .replace("__MODSTACK_MESSAGE__", &html_escape(message))
        .replace("__MODSTACK_OPEN__", &html_escape(button))
}

async fn write_http(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? != key {
            return None;
        }
        let value = kv.next().unwrap_or("").replace('+', " ");
        decode(&value).ok().map(|s| s.into_owned())
    })
}

enum Callback {
    Code(String),
    Error(String),
}

/// Reads the request line with a timeout. Returns None for idle/preconnect sockets.
async fn read_request_line(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    timeout(Duration::from_secs(10), async {
        loop {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(2).any(|w| w == b"\r\n") || buf.len() > 16 * 1024 {
                return Some(());
            }
        }
    })
    .await
    .ok()??;
    String::from_utf8_lossy(&buf)
        .lines()
        .next()
        .map(ToString::to_string)
}

fn spawn_accept_loop(
    listener: TcpListener,
    expected_state: String,
    expired_page: String,
    tx: tokio::sync::mpsc::Sender<(Callback, tokio::net::TcpStream)>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            };
            let tx = tx.clone();
            let expected_state = expected_state.clone();
            let expired_page = expired_page.clone();
            tokio::spawn(async move {
                let Some(first_line) = read_request_line(&mut stream).await else {
                    return;
                };
                let path = first_line.split_whitespace().nth(1).unwrap_or("");
                if !path.starts_with("/callback") {
                    write_http(&mut stream, "404 Not Found", "").await;
                    return;
                }
                let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
                if query_param(query, "state").as_deref() != Some(expected_state.as_str()) {
                    // A stale tab from an older attempt: answer it, keep waiting.
                    write_http(&mut stream, "200 OK", &expired_page).await;
                    return;
                }
                let callback = if let Some(error) = query_param(query, "error") {
                    let description = query_param(query, "error_description").unwrap_or_default();
                    Callback::Error(format!("{error}: {description}"))
                } else {
                    match query_param(query, "code").filter(|code| !code.is_empty()) {
                        Some(code) => Callback::Code(code),
                        None => Callback::Error("missing_code".into()),
                    }
                };
                let _ = tx.send((callback, stream)).await;
            });
        }
    })
}

#[derive(Debug)]
enum LoginFailure {
    Cancelled,
    NoXbox,
    Family,
    Region,
    Age,
    NoMinecraft,
    Other(String),
}

impl LoginFailure {
    fn message(&self, text: &LoginText) -> String {
        match self {
            LoginFailure::Cancelled => text.cancelled.into(),
            LoginFailure::NoXbox => text.no_xbox.into(),
            LoginFailure::Family => text.family.into(),
            LoginFailure::Region => text.region.into(),
            LoginFailure::Age => text.age.into(),
            LoginFailure::NoMinecraft => text.no_minecraft.into(),
            LoginFailure::Other(detail) => format!("{} ({detail})", text.generic),
        }
    }
}

async fn finish_login(code: &str) -> Result<Value, LoginFailure> {
    use minecraft_msa_auth::MinecraftAuthorizationError as E;

    let (ms_access_token, ms_refresh_token) = exchange_code(code)
        .await
        .map_err(|e| LoginFailure::Other(format!("token: {e}")))?;

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let (mc_token, xuid) = mc_flow
        .exchange_microsoft_token_with_xuid(&ms_access_token)
        .await
        .map_err(|e| match e {
            E::NoXbox => LoginFailure::NoXbox,
            E::AddToFamily => LoginFailure::Family,
            E::RegionUnavailable => LoginFailure::Region,
            E::AgeVerification => LoginFailure::Age,
            other => LoginFailure::Other(format!("xbox: {other}")),
        })?;

    let profile = get_minecraft_profile(mc_token.access_token().as_ref())
        .await
        .map_err(|e| {
            if e.contains("404") {
                LoginFailure::NoMinecraft
            } else {
                LoginFailure::Other(format!("profile: {e}"))
            }
        })?;
    if profile["id"].as_str().unwrap_or("").is_empty() {
        return Err(LoginFailure::NoMinecraft);
    }

    Ok(json!({
        "type": "microsoft",
        "minecraft": {
            "name": profile["name"],
            "uuid": profile["id"],
            "xboxAccount": { "xuid": xuid },
            "access_token": mc_token.access_token().as_ref(),
            "refresh_token": ms_refresh_token,
            "ms_access_token": ms_access_token
        }
    }))
}

fn focus_launcher(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[command]
pub async fn cancel_microsoft_login() -> Result<(), String> {
    if let Some(cancel) = ACTIVE_LOGIN.lock().map_err(|e| e.to_string())?.take() {
        let _ = cancel.send(());
    }
    Ok(())
}

#[command]
pub async fn login_microsoft(
    app: tauri::AppHandle,
    language: Option<String>,
) -> Result<Value, String> {
    let text = login_text(language.as_deref().unwrap_or("en"));

    // Cancel an older attempt (frees the port) and register this one.
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let previous = ACTIVE_LOGIN
        .lock()
        .map_err(|e| e.to_string())?
        .replace(cancel_tx);
    if let Some(previous) = previous {
        let _ = previous.send(());
    }

    let mut v4 = None;
    for _ in 0..25 {
        match TcpListener::bind("127.0.0.1:7878").await {
            Ok(listener) => {
                v4 = Some(listener);
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(120)).await,
        }
    }
    let v4 = v4.ok_or_else(|| {
        "El puerto 7878 está ocupado por otro programa. Ciérralo o reinicia el PC e inténtalo de nuevo."
            .to_string()
    })?;
    let v6 = TcpListener::bind("[::1]:7878").await.ok();

    let state: String = {
        use rand::Rng;
        rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect()
    };

    let expired_page = render_login_page(false, text.error_title, text.expired, text.open_button);
    let (tx, mut rx) = tokio::sync::mpsc::channel(4);
    let mut accept_tasks = vec![spawn_accept_loop(
        v4,
        state.clone(),
        expired_page.clone(),
        tx.clone(),
    )];
    if let Some(v6) = v6 {
        accept_tasks.push(spawn_accept_loop(v6, state.clone(), expired_page, tx.clone()));
    }
    drop(tx);
    let stop_listening = |tasks: &Vec<tokio::task::JoinHandle<()>>| {
        for task in tasks {
            task.abort();
        }
    };

    let url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize\
        ?client_id={}\
        &response_type=code\
        &redirect_uri={}\
        &scope=XboxLive.signin%20offline_access\
        &prompt=select_account\
        &state={}",
        CLIENT_ID,
        urlencoding::encode(REDIRECT_URI),
        state
    );

    if let Err(error) = open::that(&url) {
        stop_listening(&accept_tasks);
        return Err(format!(
            "No se pudo abrir el navegador: {error}. Abre manualmente: {url}"
        ));
    }

    let received = tokio::select! {
        message = rx.recv() => message,
        _ = &mut cancel_rx => None,
        _ = tokio::time::sleep(Duration::from_secs(300)) => {
            stop_listening(&accept_tasks);
            return Err("El inicio de sesión tardó demasiado (5 min). Inténtalo de nuevo.".into());
        }
    };
    // Stop listening right away so the port is free for a retry.
    stop_listening(&accept_tasks);

    let Some((callback, mut stream)) = received else {
        return Err("Inicio de sesión cancelado".into());
    };

    let result = match callback {
        Callback::Error(error) if error.starts_with("access_denied") => {
            Err(LoginFailure::Cancelled)
        }
        Callback::Error(error) => Err(LoginFailure::Other(error)),
        Callback::Code(code) => match timeout(Duration::from_secs(60), finish_login(&code)).await {
            Ok(result) => result,
            Err(_) => Err(LoginFailure::Other("timeout".into())),
        },
    };

    if let Ok(mut active) = ACTIVE_LOGIN.lock() {
        *active = None;
    }

    match result {
        Ok(user) => {
            let page = render_login_page(
                true,
                text.success_title,
                text.success_message,
                text.open_button,
            );
            write_http(&mut stream, "200 OK", &page).await;
            focus_launcher(&app);
            Ok(user)
        }
        Err(failure) => {
            log::warn!("Microsoft login failed: {failure:?}");
            let message = failure.message(&text);
            let page = render_login_page(false, text.error_title, &message, text.open_button);
            write_http(&mut stream, "200 OK", &page).await;
            focus_launcher(&app);
            Err(message)
        }
    }
}

#[command]
pub async fn refresh_microsoft_token(refresh_token: String) -> Result<Value, String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
        ("scope", "XboxLive.signin offline_access"),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!("Error refresh: {}", err));
    }

    let new_ms_access = json["access_token"]
        .as_str()
        .ok_or("No access_token")?
        .to_string();
    let new_ms_refresh = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token")?
        .to_string();

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let (mc_token, xuid) = mc_flow
        .exchange_microsoft_token_with_xuid(&new_ms_access)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "access_token": mc_token.access_token().as_ref(),
        "xuid": xuid,
        "refresh_token": new_ms_refresh,
        "ms_access_token": new_ms_access
    }))
}

async fn exchange_code(code: &str) -> Result<(String, String), String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", REDIRECT_URI),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!(
            "MS token error: {} — {}",
            err,
            json.get("error_description").unwrap_or(&Value::Null)
        ));
    }

    let access_token = json["access_token"]
        .as_str()
        .ok_or("No access_token en respuesta")?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token en respuesta")?
        .to_string();

    Ok((access_token, refresh_token))
}

async fn get_minecraft_profile(access_token: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Error perfil: {}", response.status()));
    }

    let profile: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(profile)
}

#[command]
pub async fn login_offline(username: String) -> Result<Value, String> {
    let uuid = offline_uuid(&username);
    Ok(json!({
        "type": "offline",
        "minecraft": {
            "name": username,
            "uuid": uuid
        }
    }))
}

#[command]
pub fn logout() {
    println!("Sesion cerrada");
}
