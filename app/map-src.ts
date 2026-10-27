/*
 * Real-streets map bay (design-mock parallel), no Google billing needed.
 *
 * A WebView renders MapLibre GL with OpenFreeMap's free Liberty vector tiles
 * (keyless, no account, no cost). The page is held here as an inline HTML
 * string and loaded via loadDataWithBaseURL, so the default NS webpack setup
 * bundles it with the app code — no copy-plugin rules to maintain.
 *
 * Protocol (both pages):
 *   mountMap(web)      -> inject MAP_HTML once (guarded per page by caller)
 *   pushSpec(web, json)-> evaluateJavascript NZMap.update({...})
 *
 * Spec shape (degrees / km):
 *   { lat, lng, radiusKm, bubbles: [{lat,lng,text,fontSize}], padB?, padT? }
 * padB/padT = fitBounds padding: padB is the fraction of viewport height the
 * sheet eats on home (0.66), the location page uses 0.09; padT is top px.
 */

import { WebView } from '@nativescript/core'

export type MapBubble = {
  lat: number
  lng: number
  text: string
  fontSize: number
}

export type MapSpec = {
  lat: number
  lng: number
  radiusKm: number
  /* offer packets (home); a page without them simply omits the field */
  bubbles?: MapBubble[]
  padB?: number
  padT?: number
  /* optional viewport framing radius: zoom frames THIS while the ring layer
   * keeps drawing at the true radiusKm; the location page passes
   * fitKm = radiusKm so the slider drives the zoom continuously from
   * 0.5 km to 10 km (no cap — a big radius has to zoom out to stay framed) */
  fitKm?: number
}

function errTxt(err: unknown): string {
  const msg = err && (err as { message?: string }).message
  return String(msg || err)
}

export const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet"/>
<script>
(function(){
/* NZMap is defined HERE, first, so NS pushes never race the library fetch.
 * boot() polls until maplibregl exists (the body-end src tag loads whenever
 * the network lets it) and only then builds the Map and drains the spec. */
var st={ready:false,pending:null,lastKey:'-',map:null,rIn:false,dot:null,marks:[],tries:0};
function msg(on){var el=document.getElementById('nzmsg');if(el){el.style.display=on?'block':'none';}}
function ringData(lat,lng,km){
 var n=64;var pts=[];var dLat=km/110.574;var dLng=km/(111.32*Math.cos(lat*Math.PI/180));
 for(var i=0;i<=n;i++){var a=(i/n)*2*Math.PI;pts.push([lng+dLng*Math.sin(a),lat+dLat*Math.cos(a)]);}
 return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:pts}}]};
}
function apply(){
 var m=st.map;if(!m||!st.ready){return;}
 var s=st.pending;if(!s){return;}
 var key=JSON.stringify(s);if(key===st.lastKey){return;}
 st.lastKey=key;msg(false);
 var h=window.innerHeight||640;
 var pB=s.padB==null?0.66:s.padB;var pT=s.padT==null?96:s.padT;
 var fk=s.fitKm==null?s.radiusKm:s.fitKm;
 var dLat=fk/110.574;var dLng=fk/(111.32*Math.cos(s.lat*Math.PI/180));
 m.fitBounds([[s.lng-dLng,s.lat-dLat],[s.lng+dLng,s.lat+dLat]],
  {padding:{top:pT,bottom:Math.round(h*pB),left:44,right:44},linear:true,duration:380,maxZoom:17});
 console.log('[NZ][map-fit] fit='+fk.toFixed(2)+' radius='+s.radiusKm.toFixed(2)+' zoom='+m.getZoom().toFixed(2)+' h='+Math.round(h));
 var dat=ringData(s.lat,s.lng,s.radiusKm);
 if(!st.rIn){
  m.addSource('nzr',{type:'geojson',data:dat});
  m.addLayer({id:'nzr',type:'line',source:'nzr',paint:{'line-color':'#FB4B32','line-width':4.5,'line-dasharray':[1.05,2.1],'line-opacity':0.95}});
  st.rIn=true;
 }else{var src=m.getSource('nzr');if(src){src.setData(dat);}}
 var el=document.createElement('div');el.className='nz-dot';
 if(!st.dot){st.dot=new maplibregl.Marker({element:el}).setLngLat([s.lng,s.lat]).addTo(m);}
 else{st.dot.setLngLat([s.lng,s.lat]);}
 for(var i=0;i<st.marks.length;i++){st.marks[i].remove();}
 st.marks=[];var bs=s.bubbles||[];
 for(var j=0;j<bs.length;j++){
  var b=bs[j];var w=document.createElement('div');w.className='nz-bub';
  var bb=document.createElement('div');bb.className='nz-bb';
  bb.style.fontSize=(b.fontSize||15.5)+'px';bb.textContent=b.text||'';
  w.appendChild(bb);
  var mk=new maplibregl.Marker({element:w,anchor:'bottom'}).setLngLat([b.lng,b.lat]).addTo(m);
  st.marks.push(mk);
 }
}
window.NZMap={update:function(s){st.pending=s;if(st.ready){apply();}}};
function boot(){
 if(typeof maplibregl==='undefined'){
  st.tries++;
  if(st.tries===15){msg(true);} /* ~6s without the library: say why */
  if(st.tries<120){setTimeout(boot,400);}
  return;
 }
 msg(false);
 st.map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',
  center:[22.5726,88.3639],zoom:12.6,attributionControl:false,dragRotate:false,
  pitchWithRotate:false,interactive:true});
 st.map.on('load',function(){st.ready=true;apply();});
 st.map.on('error',function(e){
  if(e&&e.error&&/fetch|network|Failed/i.test(String(e.error.message||''))){msg(true);}
 });
}
boot();
})();
</script>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#EFE4CF;}
#map{width:100%;height:100%;}
#map canvas{filter:saturate(.55) sepia(.28) brightness(1.04) contrast(.97);}
.nz-bub{pointer-events:none;}
.nz-bb{display:inline-block;background:#FFFDF6;border:2.4px solid #1C1B19;border-radius:14px;
box-shadow:2.5px 3px 0 #1C1B19;padding:4px 10px 5px;color:#1C1B19;white-space:nowrap;
font-family:Roboto,RobotoDraft,Helvetica,Arial,sans-serif;font-weight:900;line-height:1.06;position:relative;}
.nz-bb:after{content:'';position:absolute;left:50%;bottom:-6.5px;width:9px;height:9px;background:#FFFDF6;
border-right:2.4px solid #1C1B19;border-bottom:2.4px solid #1C1B19;transform:translateX(-50%) rotate(45deg);}
.nz-dot{z-index:9;width:15px;height:15px;border-radius:9px;background:#2A7BF6;border:2.6px solid #FFFFFF;
box-shadow:0 0 0 6px rgba(42,123,246,.24);}
.nz-msg{display:none;position:absolute;top:44px;left:0;right:0;text-align:center;color:#8E877E;
font-family:Roboto,Arial,sans-serif;font-size:12px;padding:0 24px;z-index:2;}
.nz-attr{position:absolute;left:8px;bottom:6px;color:rgba(28,27,25,.5);font-family:Roboto,Arial,sans-serif;
font-size:8.5px;z-index:1;}
</style>
</head>
<body>
<div id="map"></div>
<div id="nzmsg" class="nz-msg">Streets need a moment online &mdash; reopen with a signal and they return.</div>
<div class="nz-attr">&copy; OpenStreetMap &middot; openfreemap.org</div>
<script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
</body>
</html>`

/* inject the page; false when the native head isn't attached yet (retries allowed) */
export function mountMap(web: WebView | null): boolean {
  if (!web || !web.android) {
    return false
  }
  try {
    web.android.loadDataWithBaseURL('https://nz.local/nzmap', MAP_HTML, 'text/html', 'utf-8', null)
    return true
  } catch (err) {
    console.log('[NZ][map] mount failed:', errTxt(err))
    return false
  }
}

export function encodeSpec(spec: MapSpec): string {
  return JSON.stringify(spec)
}

export function pushSpec(web: WebView, json: string): void {
  if (!web.android) {
    return
  }
  try {
    // guarded: mid-boot pushes land as a silent no-op instead of a console
    // TypeError (the page's own boot poll applies the pending spec anyway)
    web.android.evaluateJavascript('if(window.NZMap){window.NZMap.update(' + json + ')}', null)
  } catch (err) {
    console.log('[NZ][map] sink blocked:', errTxt(err))
  }
}
