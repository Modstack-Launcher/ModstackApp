<p align="center">
  <img alt="Modstack Logo" src="public/modstack-title.png" width="300">
</p>

<h1 align="center">Modstack</h1>

<p align="center">
  <b>The all-in-one Minecraft launcher.</b><br>
  Java & Bedrock, mods, skins, and instances — managed from a single beautiful interface.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.6-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-informational?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20React-orange?style=flat-square" alt="Stack">
</p>

---

## ✨ Features

### 🏠 Home — Instance Hub
Your instances front and center. Launch any profile with one click, track install & download progress in real time, and pin your favorites directly in the sidebar for instant access. Supports loading via short **Share Codes** for collaborative setups.

### 📦 Instances — Full Mod Management
Create isolated instance profiles with custom Java versions, loaders (Vanilla, Fabric, Forge, NeoForge), and resource packs. Browse and install content from both **Modrinth** and **CurseForge** without leaving the launcher.

- Search mods by relevance, popularity, or date
- One-click install with version selection
- Toggle mods on/off without deleting them
- Check for and apply mod updates
- Export instances as `.mrstack` files — drag one onto the launcher to import instantly
- Full console/log viewer per instance

### ⛏️ Bedrock — Minecraft Bedrock Edition
Install and launch Minecraft Bedrock Edition straight from Modstack. The launcher detects existing Store installations, manages updates, and tracks play state automatically.

### 👕 Skins — 3D Skin Manager
Preview your current skin on an interactive 3D model (slim or classic body type), apply new skins via Mojang's API, or inject skins locally for offline play. Cape support with the ability to switch your active cape.

### ⚙️ Settings
Fine-grained control over everything:
- **Launcher:** animations, animated background, hide-on-launch, Discord Rich Presence
- **Game:** window resolution, fullscreen toggle, min/max RAM allocation
- **Storage:** custom install directory with one-click reset to default
- **Bedrock:** separate install path management and uninstall

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 + TypeScript |
| Desktop Shell | Tauri 2 (Rust backend) |
| Styling | Tailwind CSS v4 + HeroUI |
| Mod APIs | Modrinth API + CurseForge API |
| Auth | Microsoft OAuth2 + Mojang API |
| Discord | Discord Rich Presence |
| Skin Preview | skinview3d |
| State Management | Zustand |
| Build Tool | Vite |

The Rust backend is split into focused crates:

- `mc_bootstrap` — classpath, manifest, and JVM rules
- `mc_downloader` — version manifest fetching and asset/file download
- `mc_service` — account, profile, and blocklist handling
- `minecraft-msa-auth` — Microsoft authentication flow

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable toolchain, 1.77.2+)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your OS

### Development

```bash
# Clone the repo
git clone <your-repo-url>
cd modstack

# Install JS dependencies
npm install

# Run in development mode (hot-reload)
npm run tauri dev
```

### Build

```bash
# Production build for your current platform
npm run tauri build
```

For a full release with updater artifacts:

```bash
# Requires a .env file with signing keys
npm run release:full
```

---

## 📁 Project Structure

```
modstack/
├── src/                    # React frontend
│   ├── views/              # Page-level components (Home, Instances, Skins, Bedrock, Settings)
│   ├── components/         # Shared UI (NavBar, Frame, NewsCarousel, Capes, InstanceLogger)
│   ├── stores/             # Zustand contexts (auth, instances, settings)
│   ├── utils/              # Helpers (mojang, bedrock, skinsStore, localInstances)
│   └── hooks/              # Custom hooks (useNavigation)
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri command handlers (auth, instance, modrinth, skin, bedrock, news, config)
│   │   ├── core/           # Instance manager and core logic
│   │   ├── java_runtime.rs # Java auto-detection and management
│   │   ├── skin_server.rs  # Local skin serving
│   │   └── discord.rs      # Discord RPC integration
│   └── Cargo.toml
├── crates/                 # Shared Rust crates
│   ├── mc_bootstrap/
│   ├── mc_downloader/
│   ├── mc_service/
│   └── minecraft-msa-auth/
├── scripts/                # Release automation scripts
└── public/                 # Static assets
```

---

## 📄 .mrstack Format

Modstack uses the `.mrstack` file format for portable instance sharing. Double-clicking a `.mrstack` file (registered as `application/x-mrstack`) will open Modstack and automatically import the instance. You can also export any local instance from the Instances view.

---

## 🔐 Authentication

Modstack supports:
- **Microsoft / Xbox Live** — full OAuth2 flow for official Minecraft Java accounts
- **Offline mode** — local accounts for offline play (no Microsoft account required)

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Lint
npm run lint

# Type check + build
npm run build
```

---

## ⚖️ License

Copyright © 2026 primeCigarrete. All Rights Reserved.

This source code is made available for **reading and personal reference only** under the following terms:

**✅ You MAY:**
- View and study the source code
- Fork the repository for personal, private use
- Submit pull requests and contributions to this project

**❌ You MAY NOT:**
- Sell, sublicense, or otherwise commercialize this software or any derivative of it
- Redistribute this code, in whole or in part, whether modified or unmodified, publicly or privately to third parties
- Publish, host, or release a fork or modified version of this project without explicit written permission from the author

Any use not explicitly permitted above is prohibited. For licensing inquiries or permission requests, contact the author directly.

> This is not an open-source license. The source is visible, but rights are reserved.

---

<p align="center">
  <i>Built with ❤️ by primeCigarrete</i>
</p>
