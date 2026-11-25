// src/material.ts
var defaults = Object.freeze({
  ior: 1.5168,
  transparency: 0,
  blurRadius: 18,
  refraction: 6,
  radius: 56,
  bevel: 16,
  highlight: 0.12,
  innerContour: 0.03,
  bodyLens: 0,
  environmentStrength: 0.35,
  environmentRadius: 24,
  compression: 0.5,
  protection: true,
  shadow: true,
  contour: "environment"
});
var limits = {
  ior: [1, 2],
  transparency: [0, 1],
  blurRadius: [0, 24],
  refraction: [0, 64],
  radius: [0, 256],
  bevel: [8, 48],
  highlight: [0, 0.4],
  innerContour: [0, 0.2],
  bodyLens: [0, 0.05],
  environmentStrength: [0, 1],
  environmentRadius: [0, 64],
  compression: [0, 1]
};
function material(patch, current = { ...defaults }) {
  const next = { ...current };
  for (const key of Object.keys(limits)) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = limits[key];
      next[key] = Math.min(max, Math.max(min, value));
    }
  }
  for (const key of ["protection", "shadow"])
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  if (patch.contour === "white" || patch.contour === "environment") next.contour = patch.contour;
  return next;
}
var bypass = (m) => m.transparency === 1 && (!m.protection || m.compression === 0);
function smoother(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * t * (t * (6 * t - 15) + 10);
}
function slope(c, n) {
  const k = Math.sqrt(Math.max(0, n * n - 1));
  return -k / (Math.sqrt(c * c + k * k) + Math.max(c, 1e-5) * n * n);
}

// src/backdrop.ts
var ns = "http://www.w3.org/2000/svg";
var nextId = 0;
function svg(name, attrs = {}) {
  const node = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
function supportsBackdropDisplacement() {
  return /Chrom(e|ium)\//.test(navigator.userAgent) && CSS.supports("backdrop-filter", 'url("#glass")');
}
function displacement(w, h, m) {
  const scale = Math.min(0.75, 768 / Math.max(w, h)), mw = Math.max(1, Math.ceil(w * scale)), mh = Math.max(1, Math.ceil(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(mw, mh), reach = Math.min(m.radius * 1.419747773, w / 2, h / 2), bevel = Math.min(m.bevel, Math.min(w, h) * 0.24);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const px = (x + 0.5) * w / mw - w / 2, py = (y + 0.5) * h / mh - h / 2;
      const qx = Math.abs(px) - w / 2 + reach, qy = Math.abs(py) - h / 2 + reach;
      const ax = Math.max(0, qx), ay = Math.max(0, qy), norm = Math.cbrt(ax ** 3 + ay ** 3);
      const gx = norm > 0 ? ax * ax / (norm * norm) : Number(qx > qy), gy = norm > 0 ? ay * ay / (norm * norm) : Number(qy >= qx);
      const len = Math.hypot(gx, gy) || 1, d = (norm + Math.min(Math.max(qx, qy), 0) - reach) / Math.max(0.5, len);
      const bend = 1 - smoother(-d / Math.max(1, bevel)), z = Math.sqrt(Math.max(25e-4, 1 - bend * bend)), nl = Math.hypot(bend, z);
      const strength = bend / nl * slope(z / nl, m.ior);
      const i = (y * mw + x) * 4;
      image.data[i] = Math.round(127.5 + 127.5 * strength * gx * Math.sign(px) / len);
      image.data[i + 1] = Math.round(127.5 + 127.5 * strength * gy * Math.sign(py) / len);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
var Backdrop = class {
  constructor() {
    this.mode = supportsBackdropDisplacement() ? "svg" : "css";
    this.root = svg("svg", { "aria-hidden": "true", width: 0, height: 0 });
    this.filters = /* @__PURE__ */ new Map();
    this.maps = /* @__PURE__ */ new Map();
    this.root.setAttribute("style", "position:absolute;pointer-events:none");
    document.body.append(this.root);
  }
  apply(entries, m) {
    const used = /* @__PURE__ */ new Set();
    for (const [el, rect] of entries) {
      const w = Math.round(rect.width), h = Math.round(rect.height), opacity = 1 - m.transparency;
      let filter = "none";
      const filtering = m.protection && m.compression > 0 || opacity > 0 && (m.blurRadius > 0 || m.refraction > 0 && m.ior > 1);
      if (w > 0 && h > 0 && filtering && !bypass(m)) {
        if (this.mode === "svg") {
          const key = [
            w,
            h,
            m.radius,
            m.bevel,
            m.ior,
            m.refraction,
            m.blurRadius,
            opacity,
            m.protection,
            m.compression
          ].join(",");
          let def = this.filters.get(key);
          if (!def) {
            const id = "lgw-" + ++nextId;
            const node = svg("filter", {
              id,
              x: 0,
              y: 0,
              width: w,
              height: h,
              filterUnits: "userSpaceOnUse",
              "color-interpolation-filters": "sRGB"
            });
            let input = "SourceGraphic";
            if (m.blurRadius > 0 && opacity > 0 && opacity < 1) {
              node.append(
                svg("feGaussianBlur", {
                  in: input,
                  stdDeviation: m.blurRadius / 3,
                  edgeMode: "duplicate",
                  result: "soft"
                })
              );
              input = "soft";
            }
            if (m.ior > 1 && m.refraction > 0 && opacity > 0) {
              const mapKey = [w, h, m.radius, m.bevel, m.ior].join(",");
              let url = this.maps.get(mapKey);
              if (!url) {
                url = displacement(w, h, m);
                this.maps.set(mapKey, url);
                if (this.maps.size > 32) this.maps.delete(this.maps.keys().next().value);
              }
              node.append(
                svg("feImage", {
                  href: url,
                  width: w,
                  height: h,
                  preserveAspectRatio: "none",
                  result: "field"
                })
              );
              node.append(
                svg("feDisplacementMap", {
                  in: input,
                  in2: "field",
                  xChannelSelector: "R",
                  yChannelSelector: "G",
                  scale: 2 * m.refraction,
                  result: "glass"
                })
              );
              input = "glass";
            }
            if (opacity > 0 && opacity < 1 && input !== "SourceGraphic") {
              node.append(
                svg("feComposite", {
                  in: input,
                  in2: "SourceGraphic",
                  operator: "arithmetic",
                  k2: opacity,
                  k3: 1 - opacity,
                  result: "mixed"
                })
              );
              input = "mixed";
            }
            if (m.protection && m.compression > 0) {
              const transfer = svg("feComponentTransfer", { in: input });
              const curve = Array.from({ length: 129 }, (_, i) => {
                const s = i / 128, y = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4, x = Math.max(0, y - 0.06);
                const mapped = Math.min(y, 0.06) + x / (1 + 20 * m.compression * x);
                return mapped <= 31308e-7 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055;
              }).join(" ");
              for (const channel of ["R", "G", "B"])
                transfer.append(svg("feFunc" + channel, { type: "table", tableValues: curve }));
              node.append(transfer);
            }
            this.root.append(node);
            def = { id, node };
            this.filters.set(key, def);
          }
          used.add(key);
          const blur = opacity === 1 && m.blurRadius > 0 ? "blur(" + m.blurRadius / 3 + "px) " : "";
          filter = blur + 'url("#' + def.id + '")';
        } else {
          const sigma = m.blurRadius / 3 * opacity;
          const brightness = m.protection ? 1 - 0.46 * m.compression : 1;
          filter = "blur(" + sigma + "px) brightness(" + brightness + ")";
        }
      }
      el.style.setProperty("backdrop-filter", filter);
      el.style.setProperty("-webkit-backdrop-filter", filter);
      el.style.borderRadius = m.radius + "px";
      const shadow = m.shadow && opacity > 0 ? "0 1px 4px rgb(0 0 0 / " + 0.08 * opacity + ")" : "";
      const rim = m.highlight > 0 && opacity > 0 ? "inset 0 0 0 1px rgb(255 255 255 / " + m.highlight * opacity + ")" : "";
      el.style.boxShadow = [shadow, rim].filter(Boolean).join(",") || "none";
    }
    for (const [key, v] of this.filters)
      if (!used.has(key)) {
        v.node.remove();
        this.filters.delete(key);
      }
  }
  dispose() {
    this.root.remove();
    this.maps.clear();
    this.filters.clear();
  }
};

// src/shaders.ts
var vertex = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(uv * 2.0 - 1.0, 0, 1);
}`;
var header = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 result;
uniform sampler2D sharp, blurred;
uniform int encodedSource;
vec4 readSharp(vec2 point){
  vec4 value=texture(sharp,point);
  if(encodedSource==1)value.rgb=mix(value.rgb/12.92,pow((value.rgb+.055)/1.055,vec3(2.4)),greaterThan(value.rgb,vec3(.04045)));
  return value;
}
uniform vec4 sourceBox, crop;
vec2 imageUV(vec2 p) { return (p-sourceBox.xy)/sourceBox.zw; }
`;
var blurShader = header + `
uniform vec2 stepUV;
uniform float centerWeight;
uniform vec2 pairs[5];
uniform int pairCount, firstPass;
vec4 sampleAt(vec2 p) {
  return firstPass == 1 ? readSharp(imageUV(crop.xy+p*crop.zw)) : texture(blurred,p);
}
void main() {
  vec4 sum=sampleAt(uv)*centerWeight;
  for(int i=0;i<5;i++) {
    if(i>=pairCount) break;
    vec2 offset=stepUV*pairs[i].x;
    sum+=(sampleAt(uv-offset)+sampleAt(uv+offset))*pairs[i].y;
  }
  result=sum;
}`;
var glassShader = header + `
uniform vec4 panel, optics, light, env;
uniform vec4 finish;
uniform float dpi, compression, transparent, gutter, hasBlur;
const vec3 luma=vec3(.2126,.7152,.0722);
float unit(float x){return clamp(x,0.,1.);}
float smoother(float x){x=unit(x);return x*x*x*(x*(6.*x-15.)+10.);}
vec3 encode(vec3 x){x=max(x,0.);return mix(12.92*x,1.055*pow(x,vec3(1./2.4))-.055,greaterThan(x,vec3(.0031308)));}
vec3 filtered(vec2 p){return hasBlur>.5 ? texture(blurred,(p-crop.xy)/crop.zw).rgb : readSharp(imageUV(p)).rgb;}
float validity(vec2 p){
  vec2 e=min(p-sourceBox.xy,sourceBox.xy+sourceBox.zw-p)-.5/dpi;
  return smoother(min(e.x,e.y)/max(1./dpi,2.));
}
vec3 shape(vec2 p,vec2 halfSize,float reach){
  vec2 q=abs(p)-halfSize+reach,a=max(q,0.);
  float norm=pow(a.x*a.x*a.x+a.y*a.y*a.y,1./3.);
  vec2 g=dot(a,a)<.000001 ? sign(p)*(q.x>q.y?vec2(1,0):vec2(0,1)) : sign(p)*a*a/max(.000001,norm*norm);
  return vec3(g,norm+min(max(q.x,q.y),0.)-reach);
}
vec3 shoulder(vec3 rgb,float knee,float strength){
  float y=dot(rgb,luma),x=max(y-knee,0.);
  return rgb*((min(y,knee)+x/(1.+strength*x))/max(y,.000001));
}
vec3 protect(vec3 base,vec3 color,float inside,float opacity){
  float budget=(1.-smoother((inside-2.)/4.))*opacity;
  float knee=mix(.06,.20,budget),q=20.*compression;
  float rimQ=q*.1/mix(.1,.45,budget);
  vec3 outColor=shoulder(color,knee,rimQ);
  if(inside<6. && dot(base,luma)>.06) {
    vec3 body=shoulder(base,.06,q),delta=outColor-shoulder(base,knee,rimQ);
    vec3 gain=mix(vec3(1),body/max(-delta,vec3(.000001)),lessThan(delta,-body));
    outColor=max(vec3(0),body+min(min(gain.r,gain.g),gain.b)*delta);
  }
  return mix(outColor,color,(1.-smoother(inside*dpi/clamp(1.25*dpi,1.5,3.)))*opacity);
}
float fresnel(float c,float n){
  float ct=sqrt(max(0.,1.-(1.-c*c)/(n*n)));
  float rp=(n*c-ct)/max(.00001,n*c+ct),rs=(c-n*ct)/max(.00001,c+n*ct);
  return .5*(rp*rp+rs*rs);
}
vec4 environment(vec2 contour,vec2 outward){
  const float along[7]=float[7](-1.,-.5,0.,.5,1.,-.5,-.5);
  const float weights[7]=float[7](.10,.18,.24,.18,.10,.10,.10);
  vec2 tangent=vec2(-outward.y,outward.x);
  vec3 sum=vec3(0);float mass=0.;
  for(int i=0;i<7;i++){
    vec2 p=contour+env.y*(along[i]*outward+(i==5?-.25:i==6?.25:0.)*tangent);
    float w=weights[i]*validity(p);sum+=filtered(p)*w;mass+=w;
  }
  return vec4(sum/max(mass,.000001),mass);
}
void main(){
  vec2 size=panel.zw,halfSize=size*.5;
  vec2 pixel=vec2(uv.x,1.-uv.y)*(size+2.*gutter)-gutter,p=pixel-halfSize,pos=pixel+panel.xy;
  float reach=min(1.419747773*optics.x,min(halfSize.x,halfSize.y)),opacity=1.-transparent;
  vec3 s=shape(p,halfSize,reach);
  float d=s.z/max(.5,length(s.xy)),coverage=unit(.5-s.z/max(.001,fwidth(s.z)));
  float shadow=0.;
  if(finish.y>.5 && coverage<1.){
    vec3 sh=shape(p-vec2(0,1),halfSize,reach);
    float sd=sh.z/max(.5,length(sh.xy)),z=abs(sd)*.5,t=1./(1.+.2316419*z);
    float tail=.39894228*exp(-.5*z*z)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    shadow=.08*opacity*(sd<0.?1.-tail:tail)*(1.-smoother((max(sd,0.)*.5-2.5)/.5));
  }
  if(coverage<=0.){result=vec4(0.,0.,0.,shadow);return;}
  vec3 sharpColor=transparent>0.?readSharp(imageUV(pos)).rgb:vec3(0);
  if(transparent==1.){
    vec3 protectedSharp=compression>0.?shoulder(sharpColor,.06,20.*compression):sharpColor;
    result=vec4(encode(protectedSharp)*coverage,coverage);return;
  }
  float inside=max(-d,0.),bevel=max(1./dpi,min(optics.y,min(size.x,size.y)*.24));
  if (inside>=max(bevel,6.) && finish.x==0.) {
    vec3 body=mix(sharpColor,filtered(pos),opacity);
    if(compression>0.) body=shoulder(body,.06,20.*compression);
    result=vec4(encode(body),1.);return;
  }
  vec2 gradient=s.xy/max(length(s.xy),.000001);
  float u=unit(-d/bevel),bodyWeight=smoother(u),bend=1.-bodyWeight;
  vec3 bevelNormal=normalize(vec3(gradient*bend,sqrt(max(.0025,1.-bend*bend))));
  float bodyAmount=1.-1./(1.+finish.x);
  vec3 normal=normalize(vec3(bevelNormal.xy+p/max(halfSize,vec2(1./dpi))*bodyAmount*3.*bodyWeight,bevelNormal.z));
  float n=optics.z,k=sqrt(max(n*n-1.,0.)),c=max(normal.z,.00001);
  vec2 samplePos=pos-normal.xy*(k/(sqrt(c*c+k*k)+c*n*n))*optics.w-p*bodyAmount*bodyWeight;
  vec3 color=mix(filtered(pos),filtered(samplePos),validity(samplePos));
  float direction=dot(normal.xy,normalize(vec2(-.45,-.7)));
  float rim=exp(-abs(d+.7)/max(.5/dpi,1.1));
  float band=smoothstep(.03,.16,u)*(1.-smoothstep(.45,.8,u));
  color*=1.-light.y*band*(.35+.65*unit(-direction));
  vec3 base=color,hue=vec3(1);
  if(env.x>0. && inside<4.){
    vec4 e=environment(pos-d*gradient,gradient);
    float bandWeight=1.-smoother(inside/4.);
    color=mix(color,e.rgb,unit(env.x*fresnel(unit(normal.z),n)*bandWeight*e.a));
    float tint=.8*sqrt(env.x)*e.a*smoothstep(.003,.030,dot(e.rgb,luma))*bandWeight;
    hue=mix(hue,e.rgb/max(.0001,max(e.r,max(e.g,e.b))),tint);
  }
  float directional=pow(unit(direction),3.)+.35*pow(unit(-direction),3.);
  color+=hue*light.x*(rim*.12+pow(1.-unit(normal.z),5.)*.08+directional*bend*.3)*(1.-smoother(inside/6.));
  base=mix(sharpColor,base,opacity);color=mix(sharpColor,color,opacity);
  if(compression>0.) color=protect(base,color,inside,opacity);
  result=vec4(clamp(encode(color),0.,1.)*coverage,coverage+shadow*(1.-coverage));
}`;

// src/renderer.ts
var box = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
function overlap(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y)
  };
}
function union(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
function expand(b, p) {
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
}
function imageGeometry(source) {
  const bounds = box(source.getBoundingClientRect()), style = getComputedStyle(source);
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const content = { ...bounds };
  for (const [axis, extent, first, last] of [
    ["x", "w", "Left", "Right"],
    ["y", "h", "Top", "Bottom"]
  ]) {
    const inset = (side) => parseFloat(style.getPropertyValue("border-" + side.toLowerCase() + "-width")) + parseFloat(style.getPropertyValue("padding-" + side.toLowerCase()));
    content[axis] += inset(first);
    content[extent] -= inset(first) + inset(last);
  }
  let w = content.w, h = content.h;
  if (width && height && style.objectFit !== "fill") {
    let scale = Math.min(w / width, h / height);
    if (style.objectFit === "cover") scale = Math.max(w / width, h / height);
    if (style.objectFit === "none") scale = 1;
    if (style.objectFit === "scale-down") scale = Math.min(1, scale);
    w = width * scale;
    h = height * scale;
  }
  const pos = style.objectPosition.split(" ");
  const offset = (value, space) => value.endsWith("%") ? parseFloat(value) * space / 100 : parseFloat(value) || 0;
  const image = {
    x: content.x + offset(pos[0], content.w - w),
    y: content.y + offset(pos[1] ?? "50%", content.h - h),
    w,
    h
  };
  return { image, clip: overlap(content, image), width, height };
}
function program(gl, fragment) {
  const linked = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment]
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
    gl.attachShader(linked, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(linked) ?? "Shader link failed");
  const locations = /* @__PURE__ */ new Map();
  return {
    id: linked,
    u(name) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(linked, name));
      return locations.get(name);
    }
  };
}
function texture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function gaussian(sigma) {
  const count = Math.min(10, Math.ceil(3 * sigma)), weights = [1], pairs = new Float32Array(10);
  for (let i = 1; i <= count; i++) weights.push(Math.exp(-i * i / (2 * sigma * sigma)));
  const total = weights.reduce((a, b) => a + b) * 2 - 1;
  for (let i = 1; i <= count; i += 2) {
    const next = weights[i + 1] || 0, sum = weights[i] + next;
    pairs[i - 1] = i + next / sum;
    pairs[i] = sum / total;
  }
  return { center: 1 / total, pairs, count: Math.ceil(count / 2) };
}
var Renderer = class {
  constructor(source) {
    this.canvas = document.createElement("canvas");
    this.allocated = "";
    this.cached = "";
    this.revision = 0;
    this.imageSize = "";
    this.queries = [];
    this.uploads = 0;
    this.frames = 0;
    this.blurPasses = 0;
    this.gpuMs = null;
    const c = this.canvas;
    c.setAttribute("aria-hidden", "true");
    c.dataset.lgSurface = "";
    c.style.cssText = "position:fixed;pointer-events:none;left:0;top:0;margin:0;border:0;padding:0;max-width:none;max-height:none;background:transparent;";
    c.style.zIndex = getComputedStyle(source).zIndex;
    const gl = c.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "low-power"
    });
    if (!gl) throw Error("WebGL 2 unavailable");
    this.gl = gl;
    try {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      this.blur = program(gl, blurShader);
      this.glass = program(gl, glassShader);
      this.sourceTex = texture(gl);
      this.ping = texture(gl);
      this.pong = texture(gl);
      this.fb = gl.createFramebuffer();
      this.floatTarget = Boolean(gl.getExtension("EXT_color_buffer_float"));
      this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      source.after(c);
    } catch (e) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw e;
    }
  }
  render(source, geometry, panels, m, dirty, tier) {
    const { image, clip, width, height } = geometry, gl = this.gl, c = this.canvas;
    const viewport = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const visible = panels.map((p2) => overlap(overlap(expand(p2, 8), clip), viewport)).filter((p2) => p2.w > 0 && p2.h > 0);
    if (!visible.length || !width || !height) {
      c.hidden = true;
      return;
    }
    const bounds = visible.reduce(union), gutter = m.shadow ? 8 : 0;
    const x = Math.floor(bounds.x), y = Math.floor(bounds.y), w = Math.ceil(bounds.x + bounds.w) - x, h = Math.ceil(bounds.y + bounds.h) - y;
    const dpi = Math.min(
      devicePixelRatio || 1,
      this.maxSize / w,
      this.maxSize / h,
      Math.sqrt(8388608 / (w * h))
    );
    if (w < 1 || h < 1) return;
    c.hidden = false;
    if (c.style.width !== w + "px") c.style.width = w + "px";
    if (c.style.height !== h + "px") c.style.height = h + "px";
    const offset = c.getBoundingClientRect();
    if (Math.abs(x - offset.x) > 0.01) c.style.left = parseFloat(c.style.left) + x - offset.x + "px";
    if (Math.abs(y - offset.y) > 0.01) c.style.top = parseFloat(c.style.top) + y - offset.y + "px";
    const dw = Math.max(1, Math.round(w * dpi)), dh = Math.max(1, Math.round(h * dpi));
    if (c.width !== dw) c.width = dw;
    if (c.height !== dh) c.height = dh;
    if (width > this.maxSize || height > this.maxSize)
      throw Error("Background exceeds GPU texture limit");
    const encoded = !(source instanceof HTMLImageElement);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    if (dirty || this.uploads === 0) {
      if (this.imageSize !== width + "x" + height) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          encoded ? gl.RGBA8 : gl.SRGB8_ALPHA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source
        );
        if (gl.getError() !== gl.NO_ERROR) throw Error("Background texture allocation failed");
        this.imageSize = width + "x" + height;
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.uploads++;
      this.revision++;
    }
    const pad = m.blurRadius + m.refraction + m.environmentRadius + 8 + Math.max(w, h) * m.bodyLens;
    const region = overlap(expand(bounds, pad), clip);
    const useBlur = m.blurRadius > 0 && m.transparency < 1;
    const scale = Math.min(
      dpi,
      (tier === 0 ? 3 : tier === 1 ? 1.9 : 1.25) / Math.max(1, m.blurRadius / 3)
    );
    const bw = Math.max(1, Math.ceil(region.w * scale)), bh = Math.max(1, Math.ceil(region.h * scale));
    const setBox = (loc, b) => gl.uniform4f(loc, b.x, b.y, b.w, b.h);
    const signature = [
      this.revision,
      region.x - image.x,
      region.y - image.y,
      region.w,
      region.h,
      image.w,
      image.h,
      bw,
      bh,
      m.blurRadius,
      ...visible.flatMap((b) => [b.x - image.x, b.y - image.y, b.w, b.h]),
      pad
    ].join(",");
    if (this.timer && this.queries.length) {
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      if (disjoint) this.gpuMs = null;
      while (this.queries.length && (disjoint || gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE))) {
        const q = this.queries.shift();
        if (!disjoint) this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
    }
    const query = this.timer && this.queries.length < 3 ? gl.createQuery() : null;
    if (query) gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    gl.activeTexture(gl.TEXTURE1);
    if (useBlur && signature !== this.cached) {
      const p2 = this.blur, g = gaussian(Math.max(0.01, m.blurRadius / 3 * scale));
      const size = bw + "x" + bh;
      const resized = this.allocated !== size;
      if (resized) {
        for (const tex of [this.ping, this.pong]) {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            this.floatTarget ? gl.RGBA16F : gl.RGBA8,
            bw,
            bh,
            0,
            gl.RGBA,
            this.floatTarget ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
            null
          );
        }
        this.allocated = size;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(p2.id);
      setBox(p2.u("sourceBox"), image);
      setBox(p2.u("crop"), region);
      gl.uniform1i(p2.u("sharp"), 0);
      gl.uniform1i(p2.u("blurred"), 1);
      gl.uniform1i(p2.u("encodedSource"), Number(encoded));
      gl.uniform1f(p2.u("centerWeight"), g.center);
      gl.uniform1i(p2.u("pairCount"), g.count);
      gl.uniform2fv(p2.u("pairs"), g.pairs);
      for (const horizontal of [true, false]) {
        gl.bindTexture(gl.TEXTURE_2D, horizontal ? this.sourceTex : this.ping);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          horizontal ? this.ping : this.pong,
          0
        );
        if (resized && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw Error("Blur framebuffer unavailable");
        gl.uniform1i(p2.u("firstPass"), Number(horizontal));
        gl.uniform2f(p2.u("stepUV"), horizontal ? 1 / bw : 0, horizontal ? 0 : 1 / bh);
        if (visible.length > 1 && visible.reduce((area, b) => area + (b.w + 2 * pad) * (b.h + 2 * pad), 0) < region.w * region.h * 0.85) {
          gl.enable(gl.SCISSOR_TEST);
          for (const bounds2 of visible) {
            const r = overlap(expand(bounds2, pad), region);
            const x0 = Math.floor((r.x - region.x) * bw / region.w), y0 = Math.floor((r.y - region.y) * bh / region.h);
            gl.scissor(
              x0,
              y0,
              Math.ceil((r.x + r.w - region.x) * bw / region.w) - x0,
              Math.ceil((r.y + r.h - region.y) * bh / region.h) - y0
            );
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          gl.disable(gl.SCISSOR_TEST);
        } else gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.blurPasses++;
      }
      this.cached = signature;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, useBlur ? this.pong : this.sourceTex);
    const p = this.glass;
    gl.useProgram(p.id);
    setBox(p.u("sourceBox"), image);
    setBox(p.u("crop"), region);
    gl.uniform1i(p.u("sharp"), 0);
    gl.uniform1i(p.u("blurred"), 1);
    gl.uniform1f(p.u("dpi"), dpi);
    gl.uniform1i(p.u("encodedSource"), Number(encoded));
    gl.uniform4f(p.u("optics"), m.radius, m.bevel, m.ior, m.refraction);
    gl.uniform4f(p.u("light"), m.highlight, m.innerContour, 0, 0);
    gl.uniform4f(
      p.u("env"),
      m.contour === "white" ? 0 : m.environmentStrength,
      m.environmentRadius,
      0,
      0
    );
    gl.uniform4f(p.u("finish"), m.bodyLens, Number(m.shadow), 0, 0);
    gl.uniform1f(p.u("compression"), m.protection ? m.compression : 0);
    gl.uniform1f(p.u("transparent"), m.transparency);
    gl.uniform1f(p.u("gutter"), gutter);
    gl.uniform1f(p.u("hasBlur"), Number(useBlur));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const panel of panels) {
      const bb = expand(panel, gutter), xs = Math.round((bb.x - x) * dpi), ys = Math.round((bb.y - y) * dpi);
      gl.viewport(
        xs,
        dh - Math.round((bb.y + bb.h - y) * dpi),
        Math.max(1, Math.round((bb.x + bb.w - x) * dpi) - xs),
        Math.max(1, Math.round((bb.y + bb.h - y) * dpi) - ys)
      );
      setBox(p.u("panel"), panel);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    if (query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.queries.push(query);
    }
    this.frames++;
  }
  dispose() {
    this.canvas.remove();
    const gl = this.gl;
    for (const q of this.queries) gl.deleteQuery(q);
    for (const t of [this.sourceTex, this.ping, this.pong]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fb);
    gl.deleteProgram(this.blur.id);
    gl.deleteProgram(this.glass.id);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
};

// src/index.ts
var styles = ["position", "backdrop-filter", "-webkit-backdrop-filter", "border-radius", "box-shadow"];
function snapshot(el) {
  return new Map(styles.map((k) => [k, [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]]));
}
function restore(el, values) {
  for (const [k, [v, p]] of values)
    if (v) el.style.setProperty(k, v, p);
    else el.style.removeProperty(k);
}
var LiquidGlass = class {
  constructor(options) {
    this.active = false;
    this.media = null;
    this.domSource = null;
    this.paintContext = null;
    this.gpu = null;
    this.lite = null;
    this.abort = null;
    this.ro = null;
    this.io = null;
    this.mo = null;
    this.panels = /* @__PURE__ */ new Map();
    this.visible = /* @__PURE__ */ new Set();
    this.raf = 0;
    this.videoTicket = null;
    this.dirty = true;
    this.layout = true;
    this.rectangles = /* @__PURE__ */ new Map();
    this.geometry = null;
    this.mode = "stopped";
    this.reason = "";
    this.failed = false;
    this.tier = 0;
    this.expensive = 0;
    this.cheap = 0;
    this.lastFrame = 0;
    this.totals = { frames: 0, uploads: 0, blurPasses: 0 };
    this.invalidate = () => {
      this.dirty = true;
      this.request();
    };
    this.geometryChanged = () => {
      this.layout = true;
      this.request();
    };
    this.refresh = () => {
      if (this.active) this.sync();
    };
    this.request = () => {
      if (this.active && !document.hidden && !this.raf) this.raf = requestAnimationFrame(this.render);
    };
    this.paint = () => {
      if (!this.active || document.hidden || !this.domSource || !this.paintContext || !(this.media instanceof HTMLCanvasElement))
        return;
      try {
        this.paintContext.clearRect(0, 0, this.media.width, this.media.height);
        this.paintContext.drawElementImage(this.domSource, 0, 0, this.media.width, this.media.height);
        this.invalidate();
      } catch (e) {
        this.fail(e);
        this.request();
      }
    };
    this.mediaChanged = () => {
      if (this.media instanceof HTMLVideoElement && this.media.paused) this.stopVideo();
      this.retry();
    };
    this.render = (time) => {
      this.raf = 0;
      if (!this.active || document.hidden) return;
      if (this.layout) {
        this.rectangles.clear();
        for (const el of this.visible) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)
            this.rectangles.set(el, r);
        }
        this.geometry = this.media ? imageGeometry(this.media) : null;
        this.layout = false;
      }
      if (!this.rectangles.size || bypass(this.m)) {
        this.stopVideo();
        if (bypass(this.m)) {
          this.release();
          this.clearLite();
          for (const [el, saved] of this.panels) restore(el, saved);
          this.mode = "bypass";
        } else {
          if (this.gpu) this.gpu.canvas.hidden = true;
          this.mode = "waiting";
        }
        return;
      }
      const source = this.media, geo = this.geometry;
      if (source && !this.failed && geo && geo.width && geo.height && !(source instanceof HTMLVideoElement && source.readyState < 2)) {
        try {
          this.clearLite();
          if (!this.gpu) {
            this.gpu = new Renderer(source);
            const renderer = this.gpu;
            renderer.canvas.addEventListener(
              "webglcontextlost",
              (e) => {
                e.preventDefault();
                if (this.gpu !== renderer) return;
                this.reason = "WebGL context lost";
                this.failed = true;
                renderer.canvas.hidden = true;
                this.request();
              },
              { signal: this.abort.signal }
            );
            renderer.canvas.addEventListener(
              "webglcontextrestored",
              () => {
                if (this.gpu === renderer) this.retry();
              },
              { once: true, signal: this.abort.signal }
            );
            for (const el of this.panels.keys())
              if (getComputedStyle(el).position === "static") el.style.position = "relative";
            this.dirty = true;
          }
          if (this.tier === 2 && this.dirty && time - this.lastFrame < 32 && this.lastFrame) {
            this.request();
            return;
          }
          const begin = performance.now();
          const viewport = overlap(geo.clip, { x: 0, y: 0, w: innerWidth, h: innerHeight });
          const panels = [...this.rectangles.values()].map(box).filter((r) => {
            const common = overlap(r, viewport);
            return common.w > 0 && common.h > 0;
          });
          if (!panels.length) {
            this.gpu.canvas.hidden = true;
            this.stopVideo();
            this.mode = "waiting";
            return;
          }
          this.gpu.render(source, geo, panels, this.m, this.dirty, this.tier);
          this.reason = "";
          this.mode = "webgl2";
          this.dirty = false;
          this.lastFrame = time;
          if (this.options.quality === void 0 || this.options.quality === "auto") {
            const cost = Math.max(performance.now() - begin, this.gpu.gpuMs ?? 0);
            this.expensive = cost > 5 ? this.expensive + 1 : 0;
            this.cheap = cost < 2 ? this.cheap + 1 : 0;
            if (this.expensive >= 6 || this.cheap >= 120) {
              this.tier = Math.max(0, Math.min(2, this.tier + (this.expensive >= 6 ? 1 : -1)));
              this.cheap = this.expensive = 0;
            }
          }
          this.trackVideo();
          return;
        } catch (e) {
          this.fail(e);
        }
      }
      if (this.gpu) this.gpu.canvas.hidden = true;
      if (!this.reason)
        this.reason = source ? "Waiting for a readable background" : "No explicit background";
      this.stopVideo();
      this.lite ?? (this.lite = new Backdrop());
      this.lite.apply(this.rectangles, this.m);
      this.mode = this.lite.mode;
    };
    this.options = { ...options };
    this.m = material(options.material ?? {});
  }
  get settings() {
    return { ...this.m };
  }
  get status() {
    const g = this.gpu;
    return {
      mode: this.mode,
      reason: this.reason,
      quality: ["full", "balanced", "economy"][this.tier],
      fpsLimit: this.tier === 2 ? 30 : null,
      frames: this.totals.frames + (g?.frames ?? 0),
      uploads: this.totals.uploads + (g?.uploads ?? 0),
      blurPasses: this.totals.blurPasses + (g?.blurPasses ?? 0),
      gpuMs: g?.gpuMs ?? null
    };
  }
  update(patch) {
    this.m = material(patch, this.m);
    this.request();
    return this;
  }
  reset(key) {
    this.m = key ? material({ [key]: defaults[key] }, this.m) : { ...defaults };
    this.request();
    return this;
  }
  start() {
    if (this.active) return this;
    this.active = true;
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    this.mode = "waiting";
    this.reason = "";
    this.failed = false;
    this.dirty = this.layout = true;
    this.tier = this.options.quality === "economy" ? 2 : this.options.quality === "balanced" ? 1 : 0;
    this.cheap = this.expensive = this.lastFrame = 0;
    this.ro = new ResizeObserver(this.geometryChanged);
    this.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting) this.visible.add(el);
        else this.visible.delete(el);
      }
      this.geometryChanged();
    });
    if (typeof this.options.targets === "string") {
      this.mo = new MutationObserver((records) => {
        const relevant = records.some(
          (r) => [...r.addedNodes, ...r.removedNodes].some(
            (n) => n instanceof HTMLElement && !n.hasAttribute("data-lg-surface")
          )
        );
        if (relevant) this.sync();
      });
      this.mo.observe(document.body, { subtree: true, childList: true });
    }
    window.addEventListener("resize", this.geometryChanged, options);
    document.addEventListener("scroll", this.geometryChanged, {
      ...options,
      capture: true,
      passive: true
    });
    window.visualViewport?.addEventListener("resize", this.geometryChanged, options);
    const watchDpr = () => {
      matchMedia("(resolution: " + devicePixelRatio + "dppx)").addEventListener(
        "change",
        () => {
          this.refresh();
          watchDpr();
        },
        { ...options, once: true }
      );
    };
    watchDpr();
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.stopVideo();
        } else {
          if (this.domSource)
            this.media.requestPaint?.();
          this.refresh();
        }
      },
      options
    );
    const src = this.options.source;
    if (src instanceof HTMLImageElement || src instanceof HTMLVideoElement || src instanceof HTMLCanvasElement)
      this.media = src;
    else if (src) {
      const host = src.parentElement;
      if (host instanceof HTMLCanvasElement && host.getAttribute("content") === "drawable" && src.hasAttribute("drawable")) {
        const ctx = host.getContext("2d");
        if (ctx?.drawElementImage) {
          this.media = host;
          this.domSource = src;
          this.paintContext = ctx;
          host.addEventListener("paint", this.paint, options);
          host.requestPaint?.();
        }
      }
      if (!this.media)
        this.reason = "This HTML background needs a drawable canvas and drawElementImage support";
    }
    if (this.media) {
      this.ro.observe(this.media);
      for (const e of ["load", "loadeddata", "seeked", "play", "pause", "emptied", "resize", "error"])
        this.media.addEventListener(e, this.mediaChanged, options);
    }
    this.sync();
    return this;
  }
  sync() {
    const t = this.options.targets;
    const next = new Set(
      typeof t === "string" ? document.querySelectorAll(t) : t instanceof HTMLElement ? [t] : t
    );
    for (const [el, saved] of this.panels)
      if (!next.has(el)) {
        restore(el, saved);
        this.ro?.unobserve(el);
        this.io?.unobserve(el);
        this.panels.delete(el);
        this.visible.delete(el);
      }
    for (const el of next)
      if (!this.panels.has(el)) {
        this.panels.set(el, snapshot(el));
        this.ro?.observe(el);
        this.io?.observe(el);
        if (this.gpu && getComputedStyle(el).position === "static") el.style.position = "relative";
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)
          this.visible.add(el);
      }
    this.geometryChanged();
  }
  stopVideo() {
    const v = this.media;
    if (v instanceof HTMLVideoElement && this.videoTicket !== null)
      v.cancelVideoFrameCallback?.(this.videoTicket);
    this.videoTicket = null;
  }
  trackVideo() {
    const v = this.media;
    if (!(v instanceof HTMLVideoElement) || v.paused || v.ended || this.videoTicket !== null) return;
    if (v.requestVideoFrameCallback)
      this.videoTicket = v.requestVideoFrameCallback(() => {
        this.videoTicket = null;
        this.invalidate();
      });
    else this.invalidate();
  }
  release() {
    if (this.gpu) {
      for (const k of ["frames", "uploads", "blurPasses"]) this.totals[k] += this.gpu[k];
      this.gpu.dispose();
      this.gpu = null;
    }
  }
  fail(e) {
    this.reason = e instanceof Error ? e.message : String(e);
    this.failed = true;
    this.release();
  }
  clearLite() {
    if (!this.lite) return;
    this.lite.dispose();
    this.lite = null;
    for (const [el, saved] of this.panels) restore(el, saved);
  }
  retry() {
    if (this.failed) this.release();
    this.failed = false;
    this.dirty = true;
    this.refresh();
    return this;
  }
  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopVideo();
    this.abort?.abort();
    this.ro?.disconnect();
    this.io?.disconnect();
    this.mo?.disconnect();
    this.release();
    this.clearLite();
    for (const [el, saved] of this.panels) restore(el, saved);
    this.panels.clear();
    this.visible.clear();
    this.rectangles.clear();
    this.media = null;
    this.domSource = null;
    this.paintContext = null;
    this.mode = "stopped";
    return this;
  }
};
export {
  LiquidGlass,
  defaults,
  limits
};
