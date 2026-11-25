import { type Options } from './index.js';
/** Hooks with the same source, quality and material share a renderer. */
export declare function useLiquidGlass<T extends HTMLElement = HTMLDivElement>(options?: Omit<Options, 'targets'>): import("react").RefObject<T>;
