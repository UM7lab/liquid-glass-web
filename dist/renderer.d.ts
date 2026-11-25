import type { Material } from './material.js';
export type Media = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
export type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export declare const box: (r: DOMRectReadOnly) => Box;
export declare function overlap(a: Box, b: Box): Box;
export declare function imageGeometry(source: Media): {
    image: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    clip: Box;
    width: number;
    height: number;
};
export declare class Renderer {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    private blur;
    private glass;
    private sourceTex;
    private ping;
    private pong;
    private fb;
    private allocated;
    private cached;
    private revision;
    private imageSize;
    private floatTarget;
    private maxSize;
    private timer;
    private queries;
    uploads: number;
    frames: number;
    blurPasses: number;
    gpuMs: number | null;
    constructor(source: Media);
    render(source: Media, geometry: ReturnType<typeof imageGeometry>, panels: Box[], m: Material, dirty: boolean, tier: number): void;
    dispose(): void;
}
