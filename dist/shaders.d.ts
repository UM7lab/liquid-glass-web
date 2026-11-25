export declare const vertex = "#version 300 es\nout vec2 uv;\nvoid main() {\n  uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);\n  gl_Position = vec4(uv * 2.0 - 1.0, 0, 1);\n}";
export declare const blurShader: string;
export declare const glassShader: string;
