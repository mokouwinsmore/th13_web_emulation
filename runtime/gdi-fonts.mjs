export class GDIFonts {
  constructor(blend,fonts){this.blend=blend;this.fonts=new Map(fonts.map(font=>[JSON.stringify([font.font,font.face]),font]));}
  glyph(font,char){const glyph=font.glyphs[char];if(!glyph)throw new Error('Unbaked original GDI glyph '+JSON.stringify(char));if(typeof glyph[5]==='string')glyph[5]=Uint8Array.from(atob(glyph[5]),c=>c.charCodeAt(0));return glyph;}
  draw(dc,bitmap,x,y,text,pixels){if(bitmap.bpp!==16||dc.mode!==1)throw new Error('Unsupported GDI bitmap or background mode');const font=this.fonts.get(JSON.stringify([dc.font.font,dc.font.face]));if(!font)throw new Error('Unbaked original GDI font '+JSON.stringify([dc.font.font,dc.font.face]));const view=new DataView(pixels.buffer,pixels.byteOffset,pixels.byteLength),color=dc.color??0,red=color&255,green=(color>>8)&255,blue=(color>>16)&255;
    for(const char of text){const [advance,left,top,w,h,coverage]=this.glyph(font,char);for(let j=0;j<h;j++){const row=(y|0)+top+j;if(row<0||row>=bitmap.height)continue;for(let i=0;i<w;i++){const column=(x|0)+left+i,index=coverage[j*w+i];if(!index||column<0||column>=bitmap.width)continue;const p=row*bitmap.pitch+column*2,before=view.getUint16(p,true),base=index*8192,r=this.blend[base+(before>>10&31)*256+red],g=this.blend[base+(before>>5&31)*256+green],b=this.blend[base+(before&31)*256+blue];view.setUint16(p,r<<10|g<<5|b,true);}}x+=advance;}
  }
}

export class CanvasGDIFonts {
  constructor(){this.canvas=new OffscreenCanvas(1,1);this.context=this.canvas.getContext('2d',{willReadFrequently:true});this.fonts=new Map();}
  font(value){this.fonts.set(JSON.stringify([value.font,value.face]),value);}
  draw(dc,bitmap,x,y,text,pixels){
    if(bitmap.bpp!==16||dc.mode!==1)throw new Error('Unsupported GDI bitmap or background mode');
    if(this.canvas.width!==bitmap.width||this.canvas.height!==bitmap.height){this.canvas.width=bitmap.width;this.canvas.height=bitmap.height;}
    const context=this.context,[height,,,,weight,italic]=dc.font.font,face=dc.font.face||'sans-serif';
    context.clearRect(0,0,bitmap.width,bitmap.height);context.font=`${italic?'italic ':''}${weight||400} ${Math.max(1,Math.abs(height))}px "${face.replaceAll('"','\\"')}", "MS Gothic", "Noto Sans CJK JP", sans-serif`;
    context.textBaseline='top';context.fillStyle='#'+(dc.color&0xffffff).toString(16).padStart(6,'0');context.fillText(text,x,y);
    const rgba=context.getImageData(0,0,bitmap.width,bitmap.height).data,view=new DataView(pixels.buffer,pixels.byteOffset,pixels.byteLength),red=dc.color&255,green=dc.color>>8&255,blue=dc.color>>16&255;
    for(let row=0;row<bitmap.height;row++)for(let column=0;column<bitmap.width;column++){
      const source=(row*bitmap.width+column)*4,alpha=rgba[source+3];if(!alpha)continue;
      const target=row*bitmap.pitch+column*2,before=view.getUint16(target,true),r=Math.round(((before>>10&31)* (255-alpha)+Math.round(red*31/255)*alpha)/255),g=Math.round(((before>>5&31)*(255-alpha)+Math.round(green*31/255)*alpha)/255),b=Math.round(((before&31)*(255-alpha)+Math.round(blue*31/255)*alpha)/255);
      view.setUint16(target,r<<10|g<<5|b,true);
    }
  }
}
