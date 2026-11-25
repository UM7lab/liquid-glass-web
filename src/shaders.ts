// The material equations follow the MIT-licensed Liquid Glass Windows 3.2 shader.
export const vertex = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(uv * 2.0 - 1.0, 0, 1);
}`
const header = `#version 300 es
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
`
export const blurShader =
  header +
  `
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
}`
export const glassShader =
  header +
  `
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
}`
