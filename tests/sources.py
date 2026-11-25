"""Extra integration checks for inputs, resource lifecycle and documented fallbacks."""

import argparse
from playwright.sync_api import sync_playwright
from server import serve

parser = argparse.ArgumentParser()
parser.add_argument("--chrome", required=True)
args = parser.parse_args()
a, url = serve()
b, other = serve()
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path=args.chrome,
        headless=True,
        args=["--enable-gpu", "--use-angle=d3d11"],
    )
    page = browser.new_page(viewport={"width": 640, "height": 480})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def reset():
        page.goto(url + "/tests/fixture.html")
        page.wait_for_function('window.ready && glass.status.mode==="webgl2"')
        page.evaluate("glass.stop();void 0")

    def mode(name):
        page.wait_for_function("n=>glass.status.mode===n", arg=name, timeout=4500)

    reset()
    page.evaluate(
        """async()=>{const img=new Image();img.style.cssText='position:absolute;inset:0;width:100%;height:100%';img.src='../docs/fixtures/colors.png';await img.decode();stage.prepend(img);window.glass=new LiquidGlass({targets:'.panel',source:img}).start()}"""
    )
    mode("webgl2")
    page.evaluate("()=>{document.querySelector('.panel').style.top='1200px'}")
    mode("waiting")
    idle = page.evaluate("glass.status.frames")
    page.wait_for_timeout(160)
    assert page.evaluate("glass.status.frames") == idle
    page.evaluate("document.querySelector('.panel').style.top='32px'")
    mode("webgl2")
    page.evaluate(
        "()=>{const canvas=document.querySelector('[data-lg-surface]');window.loss=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');loss.loseContext()}"
    )
    page.wait_for_function("['svg','css'].includes(glass.status.mode)")
    page.evaluate("loss.restoreContext()")
    mode("webgl2")
    reset()
    page.evaluate(
        """async(u)=>{const img=new Image();img.src=u+'/docs/fixtures/grid.png';await img.decode();img.style.cssText='position:absolute;width:100%;height:100%';stage.prepend(img);window.glass=new LiquidGlass({targets:'.panel',source:img}).start()}""",
        other,
    )
    page.wait_for_function("['svg','css'].includes(glass.status.mode)")
    assert page.evaluate("glass.status.reason")
    reset()
    page.evaluate("""async()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.style.cssText='position:absolute;width:100%;height:100%';stage.prepend(v);
      window.stream=bg.captureStream(0);v.srcObject=stream;window.track=stream.getVideoTracks()[0];
      const play=v.play();const paint=()=>{bg.getContext('2d').fillRect(2,2,8,8);track.requestFrame()};paint();const timer=setInterval(paint,30);await play;clearInterval(timer);
      window.v=v;window.glass=new LiquidGlass({targets:'.panel',source:v}).start()}""")
    mode("webgl2")
    page.evaluate("v.pause()")
    page.wait_for_timeout(220)
    uploads = page.evaluate("glass.status.uploads")
    page.wait_for_timeout(330)
    assert page.evaluate("glass.status.uploads") == uploads
    page.evaluate("track.stop();glass.stop();void 0")
    reset()
    supported = page.evaluate(
        """()=>{const host=document.createElement('canvas');host.setAttribute('content','drawable');return host.content==='drawable' && typeof host.getContext('2d').drawElementImage==='function'}"""
    )
    page.evaluate(
        """()=>{const host=document.createElement('canvas');host.setAttribute('content','drawable');host.width=480;host.height=280;host.style.cssText='position:absolute;width:100%;height:100%';const html=document.createElement('div');html.setAttribute('drawable','');html.textContent='DOM background';html.style.cssText='width:480px;height:280px;background:red;color:white';host.append(html);stage.prepend(host);window.glass=new LiquidGlass({targets:'.panel',source:html}).start();window.host=host}"""
    )
    if supported:
        mode("webgl2")
        page.wait_for_function(
            "host.getContext('2d').getImageData(240,140,1,1).data[0]>128"
        )
    else:
        page.wait_for_function("['svg','css'].includes(glass.status.mode)")
    reset()
    page.evaluate(
        """()=>{HTMLCanvasElement.prototype.getContext=new Proxy(HTMLCanvasElement.prototype.getContext,{apply(fn,self,args){return args[0]==='webgl2'?null:Reflect.apply(fn,self,args)}});window.glass=new LiquidGlass({targets:'.panel',source:bg}).start()}"""
    )
    page.wait_for_function("['svg','css'].includes(glass.status.mode)")
    assert "WebGL 2 unavailable" in page.evaluate("glass.status.reason")
    page.evaluate("glass.stop();glass.stop();void 0")
    assert page.locator("[data-lg-surface]").count() == 0
    reset()
    page.add_script_tag(url=url + "/.local/react-fixture.js")
    page.wait_for_function(
        "document.querySelectorAll('[data-lg-surface]').length===1 && document.querySelectorAll('section article').length===2"
    )
    page.evaluate("renderCards(1.8,2)")
    page.wait_for_timeout(180)
    assert page.locator("[data-lg-surface]").count() == 1
    page.evaluate("unmountCards()")
    page.wait_for_function("document.querySelectorAll('[data-lg-surface]').length===0")
    page.add_script_tag(url=url + "/dist/glass.global.js")
    page.evaluate(
        "window.globalGlass=new LiquidGlassWeb.LiquidGlass({targets:'.panel'}).start()"
    )
    page.wait_for_function("['svg','css'].includes(globalGlass.status.mode)")
    page.evaluate("globalGlass.stop();void 0")
    assert not errors, errors
    print(
        "PASS image, offscreen/resume, context restoration, CORS, paused video, drawable DOM ("
        + str(supported)
        + "), unavailable WebGL and unmount"
    )
    browser.close()
a.shutdown()
b.shutdown()
