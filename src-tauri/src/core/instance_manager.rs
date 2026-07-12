use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub loader: String,
    pub minecraft_version: String,
    pub title: Option<String>,
    pub landscape: Option<String>,
    pub animation: Option<String>,
    pub slug: Option<String>,
    pub files_installed: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct InstanceManager {
    pub instances: Vec<Instance>,
}

impl InstanceManager {
    fn get_path() -> PathBuf {
        let dir = crate::commands::config::get_install_dir_path();
        fs::create_dir_all(&dir).unwrap();
        dir.join("instances.json")
    }

    pub fn save(&self) {
        let path = Self::get_path();
        let json = serde_json::to_string_pretty(&self).unwrap();
        fs::write(path, json).unwrap();
    }

    pub fn create_instance(
        &mut self,
        name: String,
        id: String,
        base_path: PathBuf,
        loader: String,
        minecraft_version: String,
        slug: Option<String>,
        title: Option<String>,
        landscape: Option<String>,
        animation: Option<String>,
    ) -> Instance {
        if let Some(existing) = self.instances.iter_mut().find(|i| i.id == id) {
            if existing.loader != loader || existing.minecraft_version != minecraft_version {
                existing.files_installed = Some(false);
            }
            existing.loader = loader;
            existing.minecraft_version = minecraft_version;
            existing.landscape = landscape;
            let updated = existing.clone();
            self.save();
            return updated;
        }

        let folder_name = slug.as_deref().unwrap_or(&name).to_string();
        let path = base_path.join(&folder_name);
        fs::create_dir_all(&path).unwrap();

        let instance = Instance {
            id,
            name,
            path,
            loader,
            minecraft_version,
            title,
            landscape,
            animation,
            slug,
            files_installed: Some(false),
        };
        self.instances.push(instance.clone());
        self.save();
        instance
    }

    pub fn mark_files_installed(&mut self, id: &str) {
        if let Some(instance) = self.instances.iter_mut().find(|i| i.id == id) {
            instance.files_installed = Some(true);
            self.save();
        }
    }
}
