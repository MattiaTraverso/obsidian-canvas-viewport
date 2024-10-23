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
                    // Move the async operation inside
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

        this.registerEvent(
            this.app.workspace.on('file-open', async (file: TFile) => {
                if (!file || file.extension !== 'canvas') return;
                
                const position = await this.loadSavedPosition(file);
                if (!position) return;

                setTimeout(() => {
                    const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
                    if (canvasLeaves.length === 0) return;

                    const canvasView = canvasLeaves[0].view as CanvasView;
                    const canvas = canvasView.canvas;
                    canvas.tx = position.tx;
                    canvas.ty = position.ty;
                    canvas.tZoom = position.tZoom;
                    canvas.viewportChanged = true;
                    canvas.requestFrame();
                }, 100);
            })
        );
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
        // Clean up any event listeners if needed
    }
}