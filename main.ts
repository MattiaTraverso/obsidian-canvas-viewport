import { Plugin, TFile, View, Notice } from 'obsidian';

interface CameraPosition {
    tx: number;
    ty: number;
    tZoom: number;
}

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
    private openCanvasFiles: string[] = []; // Track file paths

    async onload() {
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
                            new Notice('Canvas viewport position deleted');
                        } else {
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
                // If this is a canvas file, check if we've already handled it
                const wasAlreadyOpen = file?.extension === 'canvas' && this.openCanvasFiles.includes(file.path);

                // Always update our tracking array with current canvas files
                const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                this.openCanvasFiles = canvasLeaves
                    .map(leaf => (leaf.view as CanvasView).file.path);

                // If this isn't a canvas file or was already open, we're done
                if (!file || file.extension !== 'canvas' || wasAlreadyOpen) return;

                await this.restoreViewport(file);
            })
        );
    }

    private async restoreViewport(file: TFile) {
        const position = await this.loadSavedPosition(file);
        if (!position) {
            new Notice('No saved viewport position found');
            return;
        }

        setTimeout(() => {
            const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
            if (canvasLeaves.length === 0) return;

            const canvasView = canvasLeaves[0].view as CanvasView;
            const canvas = canvasView.canvas;
            
            // First adjust zoom
            const currentZoom = canvas.tZoom;
            const zoomDelta = position.tZoom - currentZoom;
            (canvas as any).zoomBy(zoomDelta);
            
            // Then pan to position
            (canvas as any).panTo(position.tx, position.ty);
            
            // Ensure everything is updated
            (canvas as any).markViewportChanged();
            canvas.requestFrame();
        }, 0);
    }


    private async saveCurrentPosition(view: CanvasView) {
        if (!view?.file || !view?.canvas) return;
        
        try {
            const content = await this.app.vault.read(view.file);
            const canvasData = JSON.parse(content);
            
            canvasData.viewport = {
                tx: view.canvas.tx,
                ty: view.canvas.ty,
                tZoom: view.canvas.tZoom
            };
            
            await this.app.vault.modify(view.file, JSON.stringify(canvasData, null, 2));
            new Notice('Canvas viewport position saved');
        } catch (error) {
            console.error('Failed to save canvas viewport position:', error);
            new Notice('Failed to save viewport position');
        }
    }

    private async deleteSavedPosition(view: CanvasView): Promise<boolean> {
        if (!view?.file) return false;
        
        try {
            const content = await this.app.vault.read(view.file);
            const canvasData = JSON.parse(content);
            
            if (!canvasData.viewport) {
                return false;
            }
            
            delete canvasData.viewport;
            await this.app.vault.modify(view.file, JSON.stringify(canvasData, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to delete canvas viewport position:', error);
            return false;
        }
    }

    private async loadSavedPosition(file: TFile): Promise<CameraPosition | null> {
        try {
            const content = await this.app.vault.read(file);
            const canvasData = JSON.parse(content);
            return canvasData.viewport || null;
        } catch (error) {
            console.error('Failed to load canvas viewport position:', error);
            return null;
        }
    }

    onunload() {
        this.openCanvasFiles = [];
    }
}