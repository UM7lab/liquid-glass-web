export declare const defaults: Readonly<{
    ior: 1.5168;
    transparency: 0;
    blurRadius: 18;
    refraction: 6;
    radius: 56;
    bevel: 16;
    highlight: 0.12;
    innerContour: 0.03;
    bodyLens: 0;
    environmentStrength: 0.35;
    environmentRadius: 24;
    compression: 0.5;
    protection: true;
    shadow: true;
    contour: "environment" | "white";
}>;
export type Material = {
    -readonly [K in keyof typeof defaults]: (typeof defaults)[K] extends number ? number : (typeof defaults)[K] extends boolean ? boolean : (typeof defaults)[K];
};
export declare const limits: {
    readonly ior: readonly [1, 2];
    readonly transparency: readonly [0, 1];
    readonly blurRadius: readonly [0, 24];
    readonly refraction: readonly [0, 64];
    readonly radius: readonly [0, 256];
    readonly bevel: readonly [8, 48];
    readonly highlight: readonly [0, 0.4];
    readonly innerContour: readonly [0, 0.2];
    readonly bodyLens: readonly [0, 0.05];
    readonly environmentStrength: readonly [0, 1];
    readonly environmentRadius: readonly [0, 64];
    readonly compression: readonly [0, 1];
};
export declare function material(patch: Partial<Material>, current?: Material): Material;
export declare const bypass: (m: Material) => boolean;
export declare function smoother(t: number): number;
export declare function slope(c: number, n: number): number;
