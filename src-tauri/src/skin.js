import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const modelCache = new Map();
const textureCache = new Map();
const MODEL_CACHE_MAX = 10;
const TEXTURE_CACHE_MAX = 50;

function lruGet(cache, key) {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
}

function lruSet(cache, key, value, maxSize, onEvict) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > maxSize) {
        const oldest = cache.keys().next().value;
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        if (onEvict && evicted) onEvict(evicted);
    }
}

const DEFAULT_ANIMATION_CONFIG = {
    baseAnimation: 'idle',
    randomAnimations: ['idle_sub_1', 'idle_sub_2', 'idle_sub_3'],
    randomAnimationInterval: 8000,
    transitionDuration: 0.2
};

async function loadModel(modelPath) {
    const cached = lruGet(modelCache, modelPath);
    if (cached) {
        const clone = cached.scene.clone(true);
        const animations = cached.animations.map(clip => clip.clone());
        return { scene: clone, animations };
    }

    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            modelPath,
            (gltf) => {
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                if (mat.map) { mat.map.dispose(); mat.map = null; }
                                mat.needsUpdate = true;
                            });
                        } else if (child.material) {
                            if (child.material.map) { child.material.map.dispose(); child.material.map = null; }
                            child.material.needsUpdate = true;
                        }
                    }
                });
        
                lruSet(modelCache, modelPath, {
                    scene: gltf.scene,
                    animations: gltf.animations
                }, MODEL_CACHE_MAX, null);
        
                resolve({ 
                    scene: gltf.scene.clone(true), 
                    animations: gltf.animations.map(c => c.clone()) 
                });
            },
            undefined,
            (error) => reject(error)
        );
    });
}

async function loadSkinTexture(url) {
    if (!url || typeof url !== "string") {
        console.warn("[SkinGLTF] textura inválida:", url);
        return null;
    }

    const cachedTexture = lruGet(textureCache, url);
    if (cachedTexture) {
        return cachedTexture.clone();
    }

    try {
        const img = new Image();
        img.crossOrigin = "anonymous";

        await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = url;
        });

        const texture = new THREE.Texture(img);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        lruSet(textureCache, url, texture, TEXTURE_CACHE_MAX, (t) => t.dispose());
        return texture;

    } catch (error) {
        console.error("[SkinGLTF] error textura:", error);
        return null;
    }
}

function applySkinTexture(model, texture, hasCape = false) {
    model.traverse((child) => {
        if (child.isMesh) {
            const name = child.name.toLowerCase();
            if (name.includes('cape')) {
                child.visible = hasCape;
                return;
            }

            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }

            child.material = new THREE.MeshStandardMaterial({
                map: texture,
                alphaTest: 0.1,
                transparent: true,
                side: THREE.FrontSide,
                roughness: 0.8,
                metalness: 0.1
            });

            child.material.needsUpdate = true; 
        }
    });
}
function applyCapeTexture(model, texture) {
    model.traverse((child) => {
        if (child.isMesh && child.name.toLowerCase().includes('cape')) {
            const material = new THREE.MeshStandardMaterial({
                map: texture,
                alphaTest: 0.1,
                transparent: true,
                side: THREE.DoubleSide,
                roughness: 0.8,
                metalness: 0.1
            });
            child.material = material;
        }
    });
}

export class SkinViewerGLTF {
    constructor(options) {
        this.canvas = options.canvas;
        this.width = options.width || 300;
        this.height = options.height || 400;
        this.skinUrl = options.skin || options.skinUrl;
        this.capeUrl = options.cape;
        this.model = options.model || 'classic';
        this.animationConfig = { ...DEFAULT_ANIMATION_CONFIG, ...(options.animationConfig || {}) };
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mixer = null;
        this.actions = {};
        this.currentAnimation = '';
        this.clock = new THREE.Clock();
        this.randomAnimationTimer = null;
        this.lastRandomAnimation = '';
        this.isDisposed = false;
        this.autoRotate = options.autoRotate !== false;
        this.autoRotateSpeed = options.autoRotateSpeed || 0.5;
        this.modelRotation = options.initialRotation || 0;
        this.isDragging = false;
        this.previousX = 0;
        this._init();
    }
    
    _init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(35, this.width / this.height, 0.1, 100);
        this.camera.position.set(0, 1.5, 4.0);
        this.camera.lookAt(0, 1, 0);
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(2, 3, 2);
        this.scene.add(directionalLight);
        const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
        backLight.position.set(-2, 2, -2);
        this.scene.add(backLight);
        const topLight = new THREE.DirectionalLight(0xffffff, 0.5);
        topLight.position.set(0, 5, 0);
        this.scene.add(topLight);

        this._setupControls();
        this._animate();
    }
    
    _setupControls() {
        const canvas = this.canvas;
        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            this.isDragging = true;
            this.previousX = e.clientX;
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.previousX;
            this.modelRotation += deltaX * 0.01;
            this.previousX = e.clientX;
        });
        canvas.addEventListener('pointerup', (e) => {
            this.isDragging = false;
            canvas.releasePointerCapture(e.pointerId);
        });
    }
    
    async loadSkin(skinUrl, model = null) {
        if (model) this.model = model;
        this.skinUrl = skinUrl;
        const modelPath = this.model === 'slim' 
            ? '/models/slim-player.gltf'
            : '/models/classic-player.gltf';
        
        try {
            const [modelData, texture] = await Promise.all([
                loadModel(modelPath),
                loadSkinTexture(skinUrl)
            ]);
            if (this.playerModel) {
                this.scene.remove(this.playerModel);
            }
            this.playerModel = modelData.scene;
            const hasCape = this.capeUrl && this.capeUrl !== '' && this.capeUrl !== 'null';
            if (texture) {
            applySkinTexture(this.playerModel, texture, hasCape);
            }
            if (hasCape) {
                try {
                    const capeTexture = await loadSkinTexture(this.capeUrl);
                    applyCapeTexture(this.playerModel, capeTexture);
                } catch (e) {}
            }
            this.scene.add(this.playerModel);
            this._initAnimations(modelData.animations);
        } catch (error) {
            console.error('[SkinGLTF] Error cargando modelo:', error);
        }
    }
    
    async loadCape(capeUrl) {
        this.capeUrl = capeUrl;
        if (this.playerModel && capeUrl) {
            const capeTexture = await loadSkinTexture(capeUrl);
            applyCapeTexture(this.playerModel, capeTexture);
        }
    }
    
    _initAnimations(animations) {
        if (!animations || animations.length === 0) return;
        
        this.mixer = new THREE.AnimationMixer(this.playerModel);
        this.actions = {};
        animations.forEach(clip => {
            const action = this.mixer.clipAction(clip);
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            this.actions[clip.name] = action;
        });
        
        const baseAnim = this.animationConfig.baseAnimation;
        if (this.actions[baseAnim]) {
            this.actions[baseAnim].setLoop(THREE.LoopRepeat, Infinity);
            this._playAnimation(baseAnim);
            this._setupRandomAnimationLoop();
        } else {
            const firstAnim = Object.keys(this.actions)[0];
            if (firstAnim) {
                this.actions[firstAnim].setLoop(THREE.LoopRepeat, Infinity);
                this._playAnimation(firstAnim);
            }
        }
    }
    
    _playAnimation(name, transitionDuration = this.animationConfig.transitionDuration) {
        if (!this.actions[name]) return false;
        const action = this.actions[name];
        if (this.currentAnimation === name && action.isRunning()) return false;
        Object.entries(this.actions).forEach(([animName, animAction]) => {
            if (animName !== name && animAction.isRunning()) {
                animAction.fadeOut(transitionDuration);
            }
        });
        action.reset();
        if (name === this.animationConfig.baseAnimation) {
            action.setLoop(THREE.LoopRepeat, Infinity);
        } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        action.fadeIn(transitionDuration);
        action.play();
        this.currentAnimation = name;
        return true;
    }
    
    _setupRandomAnimationLoop() {
        const interval = this.animationConfig.randomAnimationInterval;
        const scheduleNext = () => {
            if (this.isDisposed) return;
            this.randomAnimationTimer = setTimeout(() => {
                if (this.currentAnimation === this.animationConfig.baseAnimation) {
                    const randomAnims = this.animationConfig.randomAnimations;
                    const available = randomAnims.filter(a => a !== this.lastRandomAnimation);
                    const pool = available.length > 0 ? available : randomAnims;
                    const randomAnim = pool[Math.floor(Math.random() * pool.length)];
                    if (this.actions[randomAnim]) {
                        this.lastRandomAnimation = randomAnim;
                        this._playRandomAnimation(randomAnim);
                    }
                } else {
                    scheduleNext();
                }
            }, interval);
        };
        scheduleNext();
    }
    
    _playRandomAnimation(name) {
        if (!this.actions[name]) return;
        const action = this.actions[name];
        const transitionDuration = this.animationConfig.transitionDuration;
        if (this.actions[this.animationConfig.baseAnimation]?.isRunning()) {
            this.actions[this.animationConfig.baseAnimation].fadeOut(transitionDuration);
        }
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.fadeIn(transitionDuration);
        action.play();
        this.currentAnimation = name;
        const onFinished = (event) => {
            if (event.action === action) {
                this.mixer.removeEventListener('finished', onFinished);
                const baseAction = this.actions[this.animationConfig.baseAnimation];
                if (baseAction) {
                    action.fadeOut(transitionDuration);
                    baseAction.reset();
                    baseAction.fadeIn(transitionDuration);
                    baseAction.play();
                    this.currentAnimation = this.animationConfig.baseAnimation;
                }
                this._setupRandomAnimationLoop();
            }
        };
        this.mixer.addEventListener('finished', onFinished);
    }
    
    _animate() {
        if (this.isDisposed) return;
        requestAnimationFrame(() => this._animate());
        const delta = this.clock.getDelta();
        if (this.mixer) this.mixer.update(delta);
        if (this.autoRotate && !this.isDragging && this.playerModel) {
            this.modelRotation += this.autoRotateSpeed * delta;
        }
        if (this.playerModel) {
            this.playerModel.rotation.y = this.modelRotation;
        }
        this.renderer.render(this.scene, this.camera);
    }
    
    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    playAnimationByName(name) {
        if (!this.actions[name]) return false;
        if (this.randomAnimationTimer) {
            clearTimeout(this.randomAnimationTimer);
            this.randomAnimationTimer = null;
        }
        this._playAnimation(name);
        return true;
    }
    
    getAvailableAnimations() {
        return Object.keys(this.actions);
    }
    
    resumeRandomAnimations() {
        if (this.currentAnimation === this.animationConfig.baseAnimation) {
            this._setupRandomAnimationLoop();
        }
    }
    
    dispose() {
        this.isDisposed = true;
        if (this.randomAnimationTimer) clearTimeout(this.randomAnimationTimer);
        if (this.mixer) this.mixer.stopAllAction();
        if (this.playerModel) {
            this.scene.remove(this.playerModel);
            this.playerModel.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
        if (this.renderer) this.renderer.dispose();
    }
}

export async function createSkinViewerGLTF(containerId, skinUrl, model = 'classic', capeUrl = null) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    
    let canvas = container.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        container.innerHTML = '';
        container.appendChild(canvas);
    }
    
    const viewer = new SkinViewerGLTF({
        canvas,
        width: container.clientWidth || 300,
        height: container.clientHeight || 400,
        skin: skinUrl,
        model,
        cape: capeUrl
    });
    
    await viewer.loadSkin(skinUrl, model);
    if (capeUrl) await viewer.loadCape(capeUrl);
    
    return viewer;
}