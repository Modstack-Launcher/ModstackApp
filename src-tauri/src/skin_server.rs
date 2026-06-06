use std::sync::Arc;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rsa::{RsaPrivateKey, RsaPublicKey};
use rsa::pkcs8::{EncodePublicKey, LineEnding};
use rsa::pkcs1v15::SigningKey;
use rsa::signature::{Signer, SignatureEncoding};
use sha1::Sha1;
use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct ServerState {
    signing_key: SigningKey<Sha1>,
    public_key_pem: String,
    skin_bytes: Vec<u8>,
    skin_hash_hex: String,
    uuid_no_dash: String,
    username: String,
    port: u16,
    is_slim: bool,
}

pub async fn start_skin_server(
    skin_bytes: Vec<u8>,
    uuid: &str,
    username: &str,
    arm_style: &str,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<u16, String> {
    let private_key = RsaPrivateKey::new(&mut rand::thread_rng(), 2048)
        .map_err(|e| format!("RSA keygen: {}", e))?;
    let public_key = RsaPublicKey::from(&private_key);
    let public_key_pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| format!("PEM: {}", e))?;

    let signing_key = SigningKey::<Sha1>::new(private_key);
    let skin_hash_hex = hex::encode(sha2::Sha256::digest(&skin_bytes));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Bind: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Addr: {}", e))?
        .port();

    let state = Arc::new(ServerState {
        signing_key,
        public_key_pem,
        skin_bytes,
        skin_hash_hex,
        uuid_no_dash: uuid.replace('-', "").to_lowercase(),
        username: username.to_string(),
        port,
        is_slim: arm_style == "slim",
    });

    tokio::spawn(async move {
        tokio::pin!(cancel_rx);
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, _)) => {
                            let s = state.clone();
                            tokio::spawn(async move { handle_request(stream, s).await });
                        }
                        Err(_) => break,
                    }
                }
                _ = &mut cancel_rx => break,
            }
        }
    });

    Ok(port)
}

async fn handle_request(mut stream: tokio::net::TcpStream, state: Arc<ServerState>) {
    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .map(|p| p.split('?').next().unwrap_or(p))
        .unwrap_or("/");

    if path == "/" || path.is_empty() {
        let body = serde_json::json!({
            "meta": {
                "serverName": "Modstack",
                "implementationName": "modstack-skin-server",
                "implementationVersion": "1.0"
            },
            "skinDomains": ["127.0.0.1"],
            "signaturePublickey": state.public_key_pem
        })
        .to_string();
        send_response(&mut stream, 200, "application/json", body.as_bytes()).await;
    } else if path.contains("/profile/") {
        let req_uuid = path
            .split("/profile/")
            .last()
            .unwrap_or("")
            .replace('-', "")
            .to_lowercase();

        if req_uuid == state.uuid_no_dash {
            match build_profile_response(&state) {
                Ok(body) => send_response(&mut stream, 200, "application/json", body.as_bytes()).await,
                Err(_) => send_response(&mut stream, 500, "text/plain", b"error").await,
            }
        } else {
            send_response(&mut stream, 204, "text/plain", b"").await;
        }
    } else if path.starts_with("/textures/") {
        send_response(&mut stream, 200, "image/png", &state.skin_bytes).await;
    } else {
        send_response(&mut stream, 404, "text/plain", b"not found").await;
    }
}

async fn send_response(stream: &mut tokio::net::TcpStream, status: u16, ct: &str, body: &[u8]) {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status, status_text, ct, body.len()
    );
    let _ = stream.write_all(header.as_bytes()).await;
    if !body.is_empty() {
        let _ = stream.write_all(body).await;
    }
}

fn build_profile_response(state: &ServerState) -> Result<String, String> {
    let skin_entry = if state.is_slim {
        serde_json::json!({
            "url": format!("http://127.0.0.1:{}/textures/{}", state.port, state.skin_hash_hex),
            "metadata": { "model": "slim" }
        })
    } else {
        serde_json::json!({
            "url": format!("http://127.0.0.1:{}/textures/{}", state.port, state.skin_hash_hex)
        })
    };

    let texture_json = serde_json::json!({
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "profileId": state.uuid_no_dash,
        "profileName": state.username,
        "textures": {
            "SKIN": skin_entry
        }
    })
    .to_string();

    let texture_b64 = STANDARD.encode(texture_json.as_bytes());

    let sig: rsa::pkcs1v15::Signature = state.signing_key.sign(texture_b64.as_bytes());
    let sig_b64 = STANDARD.encode(&*sig.to_bytes());

    Ok(serde_json::json!({
        "id": state.uuid_no_dash,
        "name": state.username,
        "properties": [{
            "name": "textures",
            "value": texture_b64,
            "signature": sig_b64
        }]
    })
    .to_string())
}
