import { Plugin, TFile, View, Notice, Platform, PluginSettingTab, Setting, App } from 'obsidian';

interface CameraPosition {
    tx: number;
    ty: number;
    tZoom: number;
}

interface CanvasViewportSettings {
    debugMode: boolean;
    useGlobalViewport: boolean;
}

const DEFAULT_SETTINGS: CanvasViewportSettings = {
    debugMode: false,
    useGlobalViewport: false,
};

interface CanvasView extends View {
    canvas: {
        tx: number;
        ty: number;
        tZoom: number;
        viewportChanged: boolean;
        requestFrame: () => void;
    };
    file: TFile;
}

export default class CanvasViewportPlugin extends Plugin {
    private openCanvasFiles: string[] = [];
    private currentDevice: string = '';
    settings: CanvasViewportSettings;

    // Custom logging function
    private log(...args: any[]) {
        if (this.settings.debugMode) {
            console.log(...args);
        }
    }

    private logGroup(name: string) {
        if (this.settings.debugMode) {
            console.group(name);
        }
    }

    private logGroupEnd() {
        if (this.settings.debugMode) {
            console.groupEnd();
        }
    }

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new CanvasViewportSettingTab(this.app, this));

        this.currentDevice = this.getDeviceIdentifier();

        this.addCommand({
            id: 'save-canvas-viewport',
            name: 'Save current viewport position',
            checkCallback: (checking) => {
                const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                if (canvasLeaves.length === 0) {
                    if (!checking) {
                        new Notice('Please open a canvas first');
                    }
                    return false;
                }

                if (!checking) {
                    const canvasView = canvasLeaves[0].view as CanvasView;
                    this.saveCurrentPosition(canvasView);
                }

                return true;
            }
        });

        this.addCommand({
            id: 'restore-canvas-viewport',
            name: 'Restore saved viewport position',
            checkCallback: (checking) => {
                const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                if (canvasLeaves.length === 0) {
                    if (!checking) {
                        new Notice('Please open a canvas first');
                    }
                    return false;
                }

                if (!checking) {
                    const canvasView = canvasLeaves[0].view as CanvasView;
                    this.restoreViewport(canvasView.file);
                }

                return true;
            }
        });

        this.addCommand({
            id: 'delete-canvas-viewport',
            name: 'Delete saved viewport position',
            checkCallback: (checking) => {
                const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                if (canvasLeaves.length === 0) {
                    if (!checking) {
                        new Notice('Please open a canvas first');
                    }
                    return false;
                }

                if (!checking) {
                    const canvasView = canvasLeaves[0].view as CanvasView;
                    this.deleteSavedPosition(canvasView).then(deleted => {
                        if (deleted) {
                            this.log(`Viewport position deleted for device: ${this.getViewportKey()}`);
                            new Notice(`Canvas viewport position deleted for ${this.getViewportKey()}`);
                        } else {
                            this.log(`No viewport position found to delete for device: ${this.getViewportKey()}`);
                            new Notice('No saved viewport position found');
                        }
                    });
                }

                return true;
            }
        });

        // The file-open event is triggered not just when opening files, but also during 
        // Canvas operations like copy/paste or deleting elements. These operations appear 
        // to cause a reload which fires this event. To prevent unwanted viewport 
        // restoration during these operations, we maintain a list of already-open canvas 
        // files and only restore the viewport when a canvas is truly being opened for 
        // the first time.
        this.registerEvent(
            this.app.workspace.on('file-open', async (file: TFile) => {
                this.logGroup('Canvas Viewport Plugin - File Open Event');

                const wasAlreadyOpen = file?.extension === 'canvas' && this.openCanvasFiles.includes(file.path);
                this.log('File path:', file?.path);
                this.log('File type:', file?.extension);
                this.log('Was already open:', wasAlreadyOpen);

                const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                this.openCanvasFiles = canvasLeaves
                    .map(leaf => (leaf.view as CanvasView).file.path);
                this.log('Currently open canvas files:', this.openCanvasFiles);

                if (!file || file.extension !== 'canvas' || wasAlreadyOpen) {
                    this.log('Skipping viewport restoration');
                    this.logGroupEnd();
                    return;
                }

                this.log('Proceeding with viewport restoration');
                await this.restoreViewport(file);
                this.logGroupEnd();
            })
        );
    }

    private getViewportKey(): string {
        return this.settings.useGlobalViewport ? 'global' : this.currentDevice;
    }

    private getDeviceIdentifier(): string {
        this.logGroup('Canvas Viewport Plugin - Device Detection');

        let deviceType = "Unknown";

        if (Platform.isMacOS) {
            deviceType = "MacOS";
        } else if (Platform.isWin) {
            deviceType = "Windows";
        } else if (Platform.isLinux) {
            deviceType = "Linux";
        }

        if (Platform.isMobile) {
            if (Platform.isPhone) {
                deviceType += "_Phone";
            } else if (Platform.isTablet) {
                deviceType += "_Tablet";
            }

            if (Platform.isIosApp) {
                deviceType = "iOS_" + deviceType;
            } else if (Platform.isAndroidApp) {
                deviceType = "Android_" + deviceType;
            }
        } else if (Platform.isDesktopApp) {
            deviceType += "_Desktop";
        }

        const resolution = `${window.screen.width}x${window.screen.height}`;
        const pixelRatio = window.devicePixelRatio;

        const deviceId = `${deviceType}_${resolution}@${pixelRatio}x`;
        this.log('Final device identifier:', deviceId);

        this.logGroupEnd();
        return deviceId;
    }

    private async restoreViewport(file: TFile) {
        this.logGroup('Canvas Viewport Plugin - Restore Viewport');

        const position = await this.loadSavedPosition(file);
        if (!position) {
            this.log('No saved viewport position found');
            new Notice('No saved viewport position found');
            this.logGroupEnd();
            return;
        }

        this.log('Loaded position:', position);

        // Add a small delay to ensure canvas is initialized
        await new Promise(resolve => setTimeout(resolve, 100));

        const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
        if (canvasLeaves.length === 0) {
            this.log('No canvas leaves found');
            this.logGroupEnd();
            return;
        }

        const canvasView = canvasLeaves[0].view as CanvasView;
        const canvas = canvasView.canvas;

        // Ensure the canvas view is properly initialized
        if (!canvas || typeof canvas.tZoom === 'undefined') {
            this.log('Canvas not yet initialized');
            this.logGroupEnd();
            return;
        }

        const currentZoom = canvas.tZoom;
        const zoomDelta = position.tZoom - currentZoom;
        this.log('Current zoom:', currentZoom);
        this.log('Target zoom:', position.tZoom);
        this.log('Zoom delta:', zoomDelta);
        this.log('Current Position:', canvas.tx, canvas.ty);
        this.log('Target Position', position);

        try {
            // Queue the viewport changes in the next animation frame
            requestAnimationFrame(() => {
                (canvas as any).zoomBy(zoomDelta);
                (canvas as any).panTo(position.tx, position.ty);
                (canvas as any).markViewportChanged();
                canvas.requestFrame();
                new Notice('Canvas viewport restored');
                this.log('Viewport changes applied successfully');
            });
        } catch (error) {
            console.error('Failed to restore viewport:', error);
            new Notice('Failed to restore viewport');
        }

        this.logGroupEnd();
    }

    private async saveCurrentPosition(view: CanvasView) {
        this.logGroup('Canvas Viewport Plugin - Save Position');

        if (!view?.file || !view?.canvas) {
            this.log('Invalid view or canvas');
            this.logGroupEnd();
            return;
        }

        try {
            const content = await this.app.vault.read(view.file);
            const canvasData = JSON.parse(content);

            if (!canvasData.viewports) {
                this.log('Initializing viewports object');
                canvasData.viewports = {};
            }

            const position = {
                tx: view.canvas.tx,
                ty: view.canvas.ty,
                tZoom: view.canvas.tZoom
            };

            const viewportKey = this.getViewportKey();
            canvasData.viewports[viewportKey] = position;
            this.log('Saving position for:', viewportKey);
            this.log('Position:', position);

            await this.app.vault.modify(view.file, JSON.stringify(canvasData, null, 2));
            this.log('Position saved successfully');
            new Notice('Canvas viewport position saved');

        } catch (error) {
            console.error('Failed to save canvas viewport position:', error);
            new Notice('Failed to save viewport position');
        }

        this.logGroupEnd();
    }

    private async deleteSavedPosition(view: CanvasView): Promise<boolean> {
        this.logGroup('Canvas Viewport Plugin - Delete Position');

        if (!view?.file) {
            this.log('Invalid view');
            this.logGroupEnd();
            return false;
        }

        try {
            const content = await this.app.vault.read(view.file);
            const canvasData = JSON.parse(content);
            const viewportKey = this.getViewportKey();

            if (!canvasData.viewports?.[viewportKey]) {
                this.log('No viewport found for:', viewportKey);
                this.logGroupEnd();
                return false;
            }

            this.log('Deleting viewport for:', viewportKey);
            delete canvasData.viewports[viewportKey];

            if (Object.keys(canvasData.viewports).length === 0) {
                this.log('Removing empty viewports object');
                delete canvasData.viewports;
            }

            await this.app.vault.modify(view.file, JSON.stringify(canvasData, null, 2));
            this.log('Position deleted successfully');

            this.logGroupEnd();
            return true;
        } catch (error) {
            console.error('Failed to delete canvas viewport position:', error);
            this.logGroupEnd();
            return false;
        }
    }

    private async loadSavedPosition(file: TFile): Promise<CameraPosition | null> {
        this.logGroup('Canvas Viewport Plugin - Load Position');

        try {
            const content = await this.app.vault.read(file);
            const canvasData = JSON.parse(content);
            const viewportKey = this.getViewportKey();
            const position = canvasData.viewports?.[viewportKey] || null;

            this.log('Loading position for:', viewportKey);
            this.log('Found position:', position);

            this.logGroupEnd();
            return position;
        } catch (error) {
            console.error('Failed to load canvas viewport position:', error);
            this.logGroupEnd();
            return null;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        this.log('Canvas Viewport Plugin - Unloading');
        this.openCanvasFiles = [];
    }
}

class CanvasViewportSettingTab extends PluginSettingTab {
    plugin: CanvasViewportPlugin;

    constructor(app: App, plugin: CanvasViewportPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('Enable debug logging in the console')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Global Viewport')
            .setDesc('Use the same viewport position across all devices')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useGlobalViewport)
                .onChange(async (value) => {
                    this.plugin.settings.useGlobalViewport = value;
                    await this.plugin.saveSettings();
                }));
    }
}