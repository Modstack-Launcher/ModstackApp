# ModStack Multiplayer — Handoff Document

> **Rama:** `modstack-multiplayer`  
> **Repo:** https://github.com/Modstack-Launcher/ModstackApp  
> **Fecha de inicio:** Julio 25, 2026  
> **Estado actual:** Base funcional completa — pendiente integración de mods del perfil y polish de UI

---

## ¿Qué es ModStack Multiplayer?

Sistema de servidor local integrado directamente en el launcher. El usuario puede crear un servidor de Minecraft desde un panel visual sin abrir puertos, sin editar archivos manualmente, y sin instalar nada extra. Es el equivalente de Essential o Hamachi pero completamente local y manejado desde el propio launcher.

**Flujo básico:**
1. El usuario abre la tab Multiplayer en el NavBar
2. Configura nombre, puerto, gamemode, dificultad, RAM, jugadores
3. Presiona "Iniciar Servidor"
4. El backend descarga `server.jar` automáticamente (solo la primera vez)
5. Escribe `eula.txt` y `server.properties` con la config del usuario
6. Lanza el proceso Java con stdin/stdout/stderr pipedos
7. Los logs llegan en tiempo real al frontend por eventos Tauri
8. El usuario comparte su IP local con amigos para que se conecten

---

## Stack del Proyecto

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript + HeroUI |
| Backend nativo | Rust (Tauri v2 commands) |
| Build | Vite + Cargo |
| IPC | Tauri events + commands |

---

## Archivos creados en esta branch

### Backend Rust

**`src-tauri/src/commands/multiplayer.rs`**  
Núcleo del sistema. Contiene:
- `ServerConfig` — struct con toda la configuración del servidor
- `MultiplayerState` — estado del proceso hijo (Child, ChildStdin, server_dir)
- `multiplayer_start(app, config)` — descarga server.jar, escribe eula+properties, lanza Java, spawnea threads para stdout/stderr, emite eventos Tauri
- `multiplayer_stop(app)` — envía `stop` al stdin del server y espera que termine
- `multiplayer_send_command(app, command)` — escribe cualquier comando al stdin
- `multiplayer_get_status(app)` — retorna `"running"` o `"stopped"`
- `local_ip()` — detecta la IP local de red automáticamente
- `port_available(port)` — verifica que el puerto no esté ocupado antes de arrancar
- `download_server_jar(dir)` — descarga de Mojang si no existe localmente

**`src-tauri/src/commands/mod.rs`**  
Agregado: `pub mod multiplayer;`

**`src-tauri/src/main.rs`**  
Cambios:
- `use commands::multiplayer::*;`
- `.manage(Arc::new(Mutex::new(MultiplayerState::new())))`
- Comandos registrados: `multiplayer_start`, `multiplayer_stop`, `multiplayer_send_command`, `multiplayer_get_status`

### Frontend React/TypeScript

**`src/stores/multiplayerContext.tsx`**  
Context + Provider con estado global:
- `status: "stopped" | "starting" | "running" | "stopping"`
- `config: ServerConfig` con valores por defecto razonables
- `logs: string[]` — últimas 500 líneas del server
- `players: string[]` — jugadores conectados parseados del log
- `localIp: string` — IP local detectada al arrancar
- `startServer()`, `stopServer()`, `sendCommand(cmd)` — wrappers sobre los comandos Tauri
- Listeners Tauri: `multiplayer-log`, `multiplayer-players`, `multiplayer-stopped`

**`src/views/Multiplayer.tsx`**  
Vista principal con 3 tabs:
- **Panel** — botón Iniciar/Detener, estado visual, IP local con botón de copiar, lista de jugadores conectados, métricas (puerto/RAM/jugadores)
- **Configuración** — formulario completo: nombre del server, puerto, gamemode, dificultad, sliders de max players / view distance / RAM, toggle online-mode, campo para ruta de Java personalizada
- **Consola** — log en tiempo real con auto-scroll, input para enviar comandos directamente al proceso del server, líneas de error/warn en color diferente

**`src/App.tsx`**  
Cambios:
- Import de `Multiplayer` y `MultiplayerProvider`
- `multiplayer` agregado al objeto `views`
- `AppInner` envuelto en `<MultiplayerProvider>`
- Case `"multiplayer"` en `renderView()`

**`src/components/NavBar.tsx`**  
Cambios:
- Nuevo `MultiplayerNavButton` con `IconWifi`
- Punto verde pulsante cuando el servidor está corriendo
- Posicionado entre ServerBrowser y Skins en el NavBar

---

## Eventos Tauri (IPC)

| Evento | Dirección | Datos |
|---|---|---|
| `multiplayer-log` | Backend → Frontend | `string` (línea del log) |
| `multiplayer-stopped` | Backend → Frontend | `"stopped"` |
| `multiplayer-players` | Backend → Frontend | `string[]` (lista jugadores) — pendiente de implementar |

---

## Pendientes / Lo que falta

### Prioridad alta
- [ ] **Parser de jugadores mejorado** — el `parse_player_event` en Rust actualmente solo emite logs. Falta extraer el nombre del jugador del texto `"PlayerName joined the game"` y emitir `multiplayer-players` con la lista actualizada
- [ ] **Integración con instancias** — `ServerConfig` tiene `instance_id: Option<String>`. Falta implementar la lógica que cuando se selecciona una instancia, copie los mods del perfil al directorio del servidor automáticamente
- [ ] **Detección de cuando el server está listo** — parsear la línea `[Server thread/INFO]: Done` del log para cambiar el status de `"starting"` a `"running"`
- [ ] **Versión dinámica del server.jar** — actualmente está hardcodeado el jar de 1.21. Debería descargarse la versión que corresponde a la instancia seleccionada

### Prioridad media
- [ ] **Selector de instancia en la UI** — dropdown para elegir qué instancia/modpack usar como base del servidor
- [ ] **Port forwarding info** — mostrar instrucciones de cómo compartir el server con amigos fuera de la red local (ej. playit.gg o ngrok)
- [ ] **Autostart del server al abrir el launcher** — opción en config para que el server se inicie automáticamente
- [ ] **Whitelist y ops desde la UI** — botones para añadir jugadores a whitelist/ops sin usar la consola

### Prioridad baja
- [ ] **Backups automáticos** del mundo
- [ ] **Múltiples perfiles** de servidor guardados
- [ ] **Estadísticas** de uso de RAM/CPU en tiempo real

---

## Prompt para continuar en nuevo chat

Copia y pega esto en el nuevo chat:

```
Hola Perplexity. Soy Kld.S, desarrollador del proyecto Modstack Launcher.

Estamos trabajando en la branch `modstack-multiplayer` del repo:
https://github.com/Modstack-Launcher/ModstackApp

El proyecto es un launcher de Minecraft construido con Tauri v2 (React + TypeScript frontend, Rust backend).

Ya implementamos la base completa del sistema "ModStack Multiplayer" — un servidor local integrado en el launcher para que los usuarios puedan jugar con amigos sin configuraciones complejas. El handoff completo está en el archivo `MODSTACK_MULTIPLAYER_HANDOFF.md` en la misma branch.

Antes de hacer cualquier cambio, LEE ESE ARCHIVO PRIMERO. Tiene todo el contexto: qué archivos se crearon, cómo funciona el IPC, y qué está pendiente.

Lo que quiero continuar ahora es: [DESCRIBE AQUÍ LO QUE QUIERES HACER]

Por favor no añadas comentarios dentro del código. Haz commits simples y directos.
```

---

## Notas importantes

- El `server.jar` se descarga en `{app_data_dir}/multiplayer_server/server.jar` — solo la primera vez
- El estado del servidor es un `Arc<Mutex<MultiplayerState>>` manejado por Tauri — threadsafe
- El frontend usa Context API (no Zustand) para consistencia con el resto del proyecto
- No usar `localStorage` — el proyecto corre en iframes sandboxed de Tauri
- Siempre revisar que `reqwest` esté en `Cargo.toml` antes de compilar si se clona desde cero
