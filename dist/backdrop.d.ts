import { type Material } from './material.js';
export declare function supportsBackdropDisplacement(): boolean;
export declare class Backdrop {
    readonly mode: string;
    private root;
    private filters;
    private maps;
    constructor();
    apply(entries: Map<HTMLElement, DOMRectReadOnly>, m: Material): void;
    dispose(): void;
}
