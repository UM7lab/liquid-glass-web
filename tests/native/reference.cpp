// Compile against the original 3.2 pipeline to generate independent comparison frames.
#include "refraction.cpp"
#include <fstream>
int main(int argc,char** argv) {
    constexpr unsigned w=480,h=280,pad=32;
    if(argc!=3)return 1;
    std::vector<uint32_t> scene(w*h);
    std::ifstream input(argv[1],std::ios::binary);
    if(!input.read(reinterpret_cast<char*>(scene.data()),scene.size()*4))return 2;
    SyntheticGlass gpu;gpu.input(w,h,scene);
    auto p=gpu.flat();p.opticsVersion=3;p.shapeVersion=2;p.dpi=1;
    p.panel[0]=w-2*pad;p.panel[1]=h-2*pad;p.outputSize[0]=w;p.outputSize[1]=h;
    p.origin[0]=p.origin[1]=p.gutter=pad;p.radius=56*1.419747773f;
    p.bevelWidth=16;p.refraction=6;p.ior=1.5168f;p.highlight=.12f;p.innerContour=.03f;
    p.environmentStrength=.35f;p.environmentRadius=24;p.environmentWidth=4;
    p.shadowOpacity=.08f;p.shadowSigma=2;p.shadowOffsetY=1;setCompression(p,50);
    auto plan=liquid_glass::blurPlan(18,1);BlurChain blur;
    blur.create(gpu.pipeline.device.Get(),w,h,plan.levels);
    blur.render(gpu.pipeline,gpu.sourceView.Get(),plan);blur.configure(p,plan);
    auto output=gpu.draw(p,blur.scene(gpu.sourceView.Get()));
    std::ofstream file(argv[2],std::ios::binary);
    return file.write(reinterpret_cast<const char*>(output.data()),output.size()*4)?0:3;
}
