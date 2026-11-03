importScripts('/vendor/v86.js');
let host,keys=new Set(),pulses=new Map(),gamepad=null,quitRequested=false;const saves=new Set();let saveError;
self.onmessage=({data})=>{
  if(data.type==='key'||data.type==='pulse'){data.down||data.type==='pulse'?keys.add(data.code):keys.delete(data.code);if(host){host.input.keys=new Set(keys);if(data.type==='pulse')pulses.set(data.code,host.d3d.frames+(data.frames??3));}}
  else if(data.type==='blur'){keys.clear();pulses.clear();host?.input.keys.clear();}
  else if(data.type==='focus')host?.focus(data.active);
  else if(data.type==='gamepad'){gamepad=data.pad;if(host)host.input.pad=gamepad;}
  else if(data.type==='quit')quitRequested=true;
  else if(data.type==='flush-saves')Promise.all(saves).then(()=>{if(saveError)throw saveError;postMessage({type:'saves-flushed',id:data.id});}).catch(error=>postMessage({type:'saves-flushed',id:data.id,error:String(error)}));
  else if(data.type==='start')start(data).catch(error=>postMessage({type:'error',message:error.stack??String(error)}));
};
async function start({canvas,audioPort,language='jp',game='th10',gamepad:pad,directViews=true,cacheRenderState=true,performanceTelemetry=false,legacySubmission=false,fastReturns=true,debugGLErrors=false}){
  const [{JitMachine},{Win32Host},{Scheduler},{WebGLD3D9},{loadLibrary},{installGDI},{GDIFonts,CanvasGDIFonts},{fetchBytes,fetchGzip,PagedMusic},{openNativeStorage}]=await Promise.all([
    import('./jit-machine.mjs'),import('./win32.mjs'),import('./scheduler.mjs'),import('./webgl.mjs'),import('./library.mjs'),import('./gdi.mjs'),import('./gdi-fonts.mjs'),import('./assets.mjs'),import('./storage.mjs')]);
  const gameName=game==='th13'?'神灵庙':'风神录',manifestURL=game==='th13'?'/manifest.json?game=th13':'/manifest.json';
  postMessage({type:'status',message:`读取${gameName}原版程序与资源…`});
  const manifest=await(await fetch(manifestURL)).json(),variant=manifest.variants[language],files=new Map();
  const dataURL=name=>`/data/${name}${game==='th13'?'?game=th13':''}`;
  await Promise.all(variant.files.map(async name=>files.set(name,await fetchBytes(dataURL(name)))));
  const exe=files.get(variant.program),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',exe)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==variant.sha256)throw new Error(`${gameName}程序校验失败`);
  const musicFetcher=game==='th13'?(url,options)=>{const target=new URL(url,location.href);target.searchParams.set('game','th13');return fetch(target,options);}:undefined;
  const music=new PagedMusic(manifest.music,{fetcher:musicFetcher});files.set('thbgm.dat',music);
  if(game==='th10'){const {musicTracks}=await import('./music-layout.mjs');postMessage({type:'status',message:'预读原版音乐入口…'});await music.prepare(musicTracks);}
  const libraryName=game==='th13'?'d3dx9_43.dll':'d3dx9_31.dll',libraryPath=`/native/${libraryName}${game==='th13'?'?game=th13':''}`;
  const [libraryBytes,blend,initialFont]=game==='th13'?[await fetchBytes(libraryPath),null,null]:await Promise.all([fetchBytes(libraryPath),fetchGzip('/fonts/blend.bin.gz'),fetchGzip(`/fonts/${language==='chs'?134:128}/32-400.json.gz`).then(bytes=>JSON.parse(new TextDecoder().decode(bytes)))]);
  const m=await JitMachine.create(exe,{factory:self.V86,wasmPath:'/vendor/v86.wasm',directViews,fastReturns});host=new Win32Host(m,files,{language,program:variant.program});host.input.keys=new Set(keys);host.input.pad=pad??gamepad;
  const openedPaths=new Set(),createFile=host.api.CreateFileA[1];host.api.CreateFileA[1]=args=>{openedPaths.add(host.path(host.text(args[0])));return createFile(args);};
  const dialogCalls=[],dialog=host.api.DialogBoxParamA[1];host.api.DialogBoxParamA[1]=args=>{dialogCalls.push(args.map(value=>value>>>0));return dialog(args);};
  const library=loadLibrary(m,libraryBytes,0x1000000,libraryName);m.call(library.entry,{args:[library.base,1,0]});
  if(game==='th13')host.d3dxCalls=[];
  let d3dxFast;
  if(game==='th10'){(await import('./lzss.mjs')).installLzss(host);d3dxFast=await import('./d3dx-fast.mjs');d3dxFast.installD3DXFastPaths(m,library,host);(await import('./texture-edges.mjs')).installTextureEdges(host);}
  const fonts=game==='th13'?new CanvasGDIFonts():new GDIFonts(blend,[initialFont]);let io;
  installGDI(host,{draw(dc,...args){const key=JSON.stringify([dc.font.font,dc.font.face]);if(!fonts.fonts.has(key)){
    io=fetchGzip(`/fonts/${dc.font.font[8]}/${dc.font.font[0]}-${dc.font.font[4]}.json.gz`).then(bytes=>{const font=JSON.parse(new TextDecoder().decode(bytes));if(JSON.stringify([font.font,font.face])!==key)throw new Error('字体参数不符 '+key);fonts.fonts.set(key,font);});m.cpu.emu_stop();return {blocked:true};
  }fonts.draw(dc,...args);return 1;}});
  const storage=await openNativeStorage(language,game);for(const [name,data] of await storage.load()){host.overlay.set(name,data);const parts=name.split('/');for(let i=1;i<parts.length;i++)host.directories.add(parts.slice(0,i).join('/'));}
  host.onSave=(name,data)=>{const pending=storage.save(name,data);saves.add(pending);pending.then(()=>saves.delete(pending),error=>{saveError=error;saves.delete(pending);});};
  const read=host.api.ReadFile[1];host.th13Reads=[];host.api.ReadFile[1]=a=>{const file=host.handles.get(a[0]),position=file?.position;if(game==='th13'&&file)host.th13Reads.push({name:file.name,position,requested:a[2],returned:Math.max(0,Math.min(file.data?.length??music.length,position+a[2])-position)});if(file?.name!=='thbgm.dat')return read(a);const data=music.subarray(file.position,file.position+a[2]);if(!data){io=music.pending;m.cpu.emu_stop();return {blocked:true};}m.write(a[1],data);file.position+=data.length;if(a[3])m.u32(a[3],data.length);return 1;};
  const scheduler=new Scheduler(m,host),renderer=new WebGLD3D9(canvas,host.d3d,{cacheState:cacheRenderState,measureWork:performanceTelemetry,reuseStaging:!legacySubmission,debugErrors:legacySubmission||debugGLErrors}),audio=audioPort?(await import('./audio-bridge.mjs')).connectAudio(host,audioPort):null;
  if(!legacySubmission)renderer.warmPrograms();
  const FramePerformance=performanceTelemetry?(await import('./frame-performance.mjs')).FramePerformance:null;
  let framePerformance;
  postMessage({type:'status',message:`初始化${gameName}…`});
  let lastFrame=0,lastTime=performance.now(),deadline=performance.now(),presentedClock=host.millis,textReady=false;
  const tasks=new MessageChannel();let resume;tasks.port1.onmessage=()=>resume();const yieldTask=()=>new Promise(resolve=>{resume=resolve;tasks.port2.postMessage(0);});
  let debugSteps=0;while(host.exitCode===undefined){if(saveError)throw saveError;if(quitRequested&&host.d3d.frames>0){quitRequested=false;host.messages.push([1,0x10,0,0]);}const previous=host.d3d.frames;
    const stepStart=framePerformance?performance.now():0;try{scheduler.step(500000);}catch(error){const esp=m.reg('ESP')>>>0,threads=scheduler.threads.map(t=>({id:t.id,eip:t.context.instruction_pointer[0].toString(16),esp:t.context.reg32[4].toString(16),wait:t.wait,waitUntil:t.waitUntil,ready:t.ready}));postMessage({type:'fault',frame:host.d3d.frames,millis:host.millis,threadId:host.currentThreadId,eip:m.reg('EIP').toString(16),esp:esp.toString(16),stack:esp>0x10000&&esp+80<m.memorySize?m.readWords(esp,20).map(value=>value.toString(16)):[],threads,waits:host.waits?[...host.waits]:[],calls:[...host.calls],error:String(error)});throw error;}if(framePerformance)framePerformance.addWork(performance.now()-stepStart);if(io){const pending=io;io=null;await pending;}
    if(game==='th13'&&++debugSteps%120===0){const rasterCallback=m.u32(0x4a2084)>>>0,mainThread=scheduler.threads.find(t=>t.id===1),mainSp=mainThread?.context.reg32[4]>>>0,mainStack=mainSp>0x10000&&mainSp+64<m.memorySize?m.readWords(mainSp,16).map(value=>value.toString(16)):[],waitHandle=mainThread?.wait??host.waitHandle,waitObject=host.handles.get(waitHandle);postMessage({type:'trace',frame:host.d3d.frames,millis:host.millis,sleepMs:host.sleepMs,waitHandle,waitDeadline:host.waitDeadline,waits:host.waits?[...host.waits]:[],waitObject:waitObject?{kind:waitObject.kind,done:waitObject.done,signaled:waitObject.signaled,exitCode:waitObject.exitCode}:null,mainStack,windowProc:host.windowProc?.toString(16),keys:[...host.input.keys],reads:host.th13Reads.slice(-20),d3dxCalls:host.d3dxCalls.slice(-20),loopGate:m.u32(0x4dcc5c),raster:host.d3d.rasterStatus,rasterCallback:rasterCallback.toString(16),callbackImport:m.importMap.get(rasterCallback)?.name,d3dCalls:[...host.calls].filter(([name])=>name.startsWith('IDirect3D')),gameCalls:[...host.calls].filter(([name])=>name.startsWith('D3DX')||name==='CreateFileA'||name==='ReadFile'||name==='FindFirstFileA'),openFiles:[...host.handles.values()].filter(value=>value.kind==='file').map(value=>value.name),messages:host.messages.slice(-12),exitCode:host.exitCode,pc:m.reg('EIP').toString(16),allCalls:[...host.calls],calls:[...host.calls].slice(-16),threads:scheduler.threads.map(t=>{const context=t.context,pc=context.instruction_pointer[0]>>>0,regs=context.reg32,esi=regs[6]>>>0,edi=regs[7]>>>0,esp=regs[4]>>>0,lock=host.critical.get(t.lock),safeEsi=esi>0x10000&&esi+0x12c<m.memorySize;return {id:t.id,entry:t.entry?.toString(16),parameter:t.parameter?.toString(16),done:t.done,ready:t.ready,wait:t.wait,waitUntil:t.waitUntil,lock:t.lock,lockOwner:lock?.owner,lockCount:lock?.count,import:m.importMap.get(pc)?.name,edi:edi.toString(16),ediImport:m.importMap.get(edi)?.name,esi:esi.toString(16),loopFlag:safeEsi?m.u32(esi+0x128):undefined,returnAddress:esp>0x10000&&esp+4<m.memorySize?m.u32(esp).toString(16):undefined,pc:pc.toString(16)};})});}
    if(!textReady&&host.d3d.device){textReady=true;if(d3dxFast)await d3dxFast.warmD3DXText(host,library);lastFrame=host.d3d.frames;lastTime=deadline=performance.now();presentedClock=host.millis;}
    if(host.d3d.frames!==previous){for(const [code,until] of pulses)if(host.d3d.frames>=until){keys.delete(code);host.input.keys.delete(code);pulses.delete(code);}audio?.sync();const now=performance.now();
      if(FramePerformance){const sample={time:now,frame:host.d3d.frames,calls:renderer.stats.calls,batches:renderer.stats.batches,submitMs:renderer.submitMs};if(!framePerformance)framePerformance=new FramePerformance(sample);else{const metrics=framePerformance.sample(sample);if(metrics)postMessage({type:'performance',build:game==='th10'?'th10-perf-5':'th13-dev-1',directViews,cacheRenderState,legacySubmission,fastReturns:m.fastReturns!==false,debugGLErrors:renderer.debugErrors,...metrics});}}
      if(host.d3d.frames-lastFrame>=(game==='th13'?1:30)){const screen=game==='th10'?{stage:m.u32(0x474c7c),character:m.u32(0x474c68),shot:m.u32(0x474c6c),difficulty:m.u32(0x474c74),lives:m.i32(0x474c70),power:m.i32(0x474c48),flags:m.u32(0x474ca0)}:undefined;postMessage({type:'frame',frame:host.d3d.frames,fps:(host.d3d.frames-lastFrame)*1000/(now-lastTime),draws:{...renderer.stats},...(screen?{screen}:{})});lastFrame=host.d3d.frames;lastTime=now;}
      deadline+=host.millis-presentedClock;presentedClock=host.millis;if(deadline<performance.now()-100)deadline=performance.now();const delay=deadline-performance.now();if(delay>1)await new Promise(resolve=>setTimeout(resolve,delay));else await yieldTask();
    }else await yieldTask();
  }
  await Promise.all(saves);scheduler.close();m.close();postMessage({type:'exit',code:host.exitCode});
}
