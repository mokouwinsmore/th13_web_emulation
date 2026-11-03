import http from 'node:http';
import {createReadStream,readFileSync,statSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),original=resolve(root,'../[th10] 东方风神录 (汉化版+日文版)'),th13=resolve(root,'local-games/th13'),args=process.argv.slice(2),portIndex=args.indexOf('--port'),port=Number(portIndex>=0?args[portIndex+1]:args.includes('--dist')?8090:8091),dist=args.includes('--dist')?resolve(root,'dist'):null,blockSize=262144;
const variants={jp:{program:'th10.exe',files:['th10.exe','th10.dat']},chs:{program:'th10chs.exe',files:['th10chs.exe','th10c.dat']}};
function manifestFor(game){const source=game==='th13'?th13:original,selected=game==='th13'?{jp:{program:'th13.exe',files:['th13.exe','th13.dat']}}:variants,version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version,withHashes=Object.fromEntries(Object.entries(selected).map(([name,variant])=>[name,{...variant,sha256:createHash('sha256').update(readFileSync(resolve(source,variant.program))).digest('hex')}]));return {game,version,variants:withHashes,music:{size:statSync(resolve(source,'thbgm.dat')).size,chunked:true,blockSize}};}
const data=new Set(['th10.exe','th10.dat','th10chs.exe','th10c.dat']);
const server=http.createServer((req,res)=>{
  let url,pathname;try{url=new URL(req.url,'http://127.0.0.1');pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}let path,start=0,end;const game=!dist&&url.searchParams.get('game')==='th13'?'th13':'th10',source=game==='th13'?th13:original;
  if(dist){path=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(dist+sep)){res.writeHead(403).end();return;}}
  else if(pathname==='/manifest.json'){try{const body=JSON.stringify(manifestFor(game));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'}).end(body);}catch(error){res.writeHead(404).end(String(error.message));}return;}
  else if(pathname==='/')path=resolve(root,'index.html');
  else if(/^\/runtime\/[a-z0-9-]+\.(?:mjs|js)$/.test(pathname))path=resolve(root,'.'+pathname);
  else if(pathname==='/vendor/v86.js')path=existsSync(resolve(root,'assets/vendor/v86.js'))?resolve(root,'assets/vendor/v86.js'):resolve(root,'node_modules/v86/build/libv86.js');
  else if(pathname==='/vendor/v86.wasm')path=existsSync(resolve(root,'assets/vendor/v86.wasm'))?resolve(root,'assets/vendor/v86.wasm'):resolve(root,'node_modules/v86/build/v86.wasm');
  else if(/^\/vendor\/[a-z0-9.-]+$/.test(pathname))path=resolve(root,'assets','.'+pathname);
  else if(/^\/fonts\/(?:blend\.bin\.gz|(?:128|134)\/\d+-400\.json\.gz)$/.test(pathname))path=resolve(root,'assets','.'+pathname);
  else if(pathname==='/native/d3dx9_31.dll')path=resolve(root,'reference/native/d3dx9_31.dll');
  else if(pathname==='/native/d3dx9_43.dll'&&game==='th13')path=resolve(root,'d3dx9_43.dll');
  else if(pathname.startsWith('/data/')&&(game==='th13'?new Set(['th13.exe','th13.dat']):data).has(pathname.slice(6)))path=resolve(source,pathname.slice(6));
  else if(/^\/data\/thbgm\/\d{4}\.bin$/.test(pathname)){path=resolve(source,'thbgm.dat');start=Number(pathname.match(/(\d+)\.bin$/)[1])*blockSize;end=Math.min(start+blockSize,statSync(path).size)-1;}
  else{res.writeHead(404).end();return;}
  if(!existsSync(path)||!statSync(path).isFile()){res.writeHead(404).end();return;}
  const size=statSync(path).size;end??=size-1;if(start>end){res.writeHead(416).end();return;}
  const type=({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.gz':'application/gzip'})[extname(path)]??'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Content-Length':end-start+1,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);
});
function openBrowser(){if(!args.includes('--open'))return;const url=`http://127.0.0.1:${port}`;const child=process.platform==='win32'?spawn('cmd.exe',['/d','/c','start','""',url],{stdio:'ignore',windowsHide:true}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});child.on('error',()=>{});child.unref();}
server.on('error',async error=>{if(error.code==='EADDRINUSE'){try{const response=await fetch(`http://127.0.0.1:${port}/manifest.json`,{signal:AbortSignal.timeout(2000)}),info=await response.json();if(info.game==='th10'){console.log(`风神录服务已经运行：http://127.0.0.1:${port}`);openBrowser();return;}}catch{}}console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被其他程序占用。请关闭占用该端口的程序后重试。`:error);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>{console.log(`东方风神录网页版 http://127.0.0.1:${server.address().port}`);console.log('游玩期间请保持此窗口打开。按 Ctrl+C 停止服务。');openBrowser();});
