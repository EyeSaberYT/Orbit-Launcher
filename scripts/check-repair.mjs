// Browser regression check over Chromium's pipe. No HTTP server or native game process.
// Run: node scripts/check-repair.mjs [path-to-chromium-browser]
// GitHub-shaped news responses and native state are isolated fixtures, never production data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { representativeSettings, representativeInstances, assertRepresentativeData } from './fixtures/launcher-data.mjs';
import { representativeNews } from './fixtures/news-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = process.argv[2] || process.env.BROWSER_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const profile = await mkdtemp(join(tmpdir(), 'orbit-repair-'));
const captures = resolve(root, '../.taste/repair-checks');
const browser = spawn(browserPath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--in-process-gpu', '--disable-gpu-compositing', '--disable-extensions',
  '--allow-file-access-from-files', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let nextId = 0;
let incoming = Buffer.alloc(0);
const pending = new Map();
const errors = [];
let stderr = '';
browser.stderr.on('data', (chunk) => { stderr += chunk; });
browser.on('error', (error) => { for (const item of pending.values()) item.reject(error); });
browser.stdio[4].on('data', (chunk) => {
  incoming = Buffer.concat([incoming, chunk]);
  let end;
  while ((end = incoming.indexOf(0)) !== -1) {
    const payload = incoming.subarray(0, end).toString();
    incoming = incoming.subarray(end + 1);
    if (!payload) continue;
    const message = JSON.parse(payload);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    if (message.method === 'Runtime.consoleAPICalled' && ['assert', 'error'].includes(message.params.type)) errors.push(JSON.stringify(message.params.args));
  }
});
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out. ${stderr.slice(-500)}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
let session;
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (await evaluate(expression)) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Condition timed out: ${expression}`);
}
async function audit(name, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
  if (name.endsWith('-lower')) await evaluate('document.querySelector("#view").scrollTop=document.querySelector("#view").scrollHeight');
  await evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
  const result = await evaluate(`(() => {
    const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const targets = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button]')].filter(visible);
    return {
      headings: document.querySelectorAll('h1').length,
      targets: targets.filter(e => { const r=e.getBoundingClientRect();return r.width<43.99||r.height<43.99 }).map(e => ({label:e.getAttribute('aria-label')||e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),
      overflow: document.documentElement.scrollWidth > innerWidth,
      navOverflow: document.querySelector('#nav').getBoundingClientRect().right > innerWidth,
      metadata: [...document.querySelectorAll('.brand-subtitle,.home-section-label,.home-footer,.home-instance-meta>span')].filter(visible).map(e=>parseFloat(getComputedStyle(e).fontSize)),
      panels: [...document.querySelectorAll('.home-dashboard>section')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),
      toasts: document.querySelector('#toasts').children.length,
      fonts: document.fonts.status,
    };
  })()`);
  assert.equal(result.headings, 1, `${name}: one h1`);
  assert.deepEqual(result.targets, [], `${name}: hit targets ${JSON.stringify(result.targets)}`);
  assert.equal(result.overflow || result.navOverflow, false, `${name}: horizontal overflow`);
  assert.ok(result.metadata.every((size) => size >= 11), `${name}: metadata floor`);
  assert.equal(result.toasts, 0, `${name}: startup toast stack`);
  const artwork = await evaluate(`(async()=>{
    const marks=[...document.querySelectorAll('[data-asset-id="orbit-smooth-star-logo"]')];
    const svg=await (await fetch(new URL('assets/logo.svg',document.baseURI))).text();
    const raster=new Image();raster.src=new URL('assets/logo.png',document.baseURI);await raster.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const context=canvas.getContext('2d');context.drawImage(raster,0,0);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {loaded:marks.length>=1&&marks.every(i=>getComputedStyle(i).backgroundImage.includes('assets/logo.svg'))&&raster.naturalWidth===1024&&context.getImageData(0,0,1,1).data[3]===0,smooth:(svg.match(/<path /g)||[]).length===2&&svg.includes('fill="#fff"')&&!/965be8|slash|crispEdges|<rect/i.test(svg),motion:marks.every(i=>{const s=getComputedStyle(i);return s.filter==='none'&&s.boxShadow==='none'&&s.transform==='none'&&(reduced?s.animationName==='none'&&s.maskImage==='none':s.animationName==='orbit-star-shimmer'&&s.maskImage.includes('linear-gradient'))})};
  })()`);
  assert.ok(artwork.loaded && artwork.smooth && artwork.motion, `${name}: transparent logo with motion-preference-aware shimmer`);
  if (width >= 1324 && name.startsWith('ready-')) assert.ok(Math.abs(result.panels[0].bottom - result.panels[1].bottom) < 1, `${name}: dock edges`);
  await mkdir(captures, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(captures, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`${name}: one h1, 44px targets, readable metadata, no horizontal overflow or startup toasts`);
}

// Composite the actual shell CSS over both black and white. This checks contrast
// independently of the photograph's crop, including active, hover and focus states.
async function checkShellContrast(theme, width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  const { root: documentNode } = await send('DOM.getDocument', {}, session);
  const selectors = ['.nav-tab[data-section="home"]', '.nav-tab[data-section="library"]', '.account-btn'];
  const nodes = await Promise.all(selectors.map(async (selector) => (await send('DOM.querySelector', { nodeId: documentNode.nodeId, selector }, session)).nodeId));
  let minimum = Infinity;
  for (const pseudoClasses of [[], ['hover'], ['active'], ['focus', 'focus-visible']]) {
    await Promise.all(nodes.map((nodeId) => send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses }, session)));
    const values = await evaluate(`(() => {
      const paint=document.createElement('canvas');paint.width=paint.height=1;const ctx=paint.getContext('2d',{willReadFrequently:true});
      const rgba = s => {ctx.clearRect(0,0,1,1);ctx.fillStyle=s;ctx.fillRect(0,0,1,1);const p=[...ctx.getImageData(0,0,1,1).data];return [...p.slice(0,3),p[3]/255]};
      const over = (a,b) => a.slice(0,3).map((c,i)=>c*(a[3]??1)+b[i]*(1-(a[3]??1)));
      const luminance = rgb => rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
      return [...document.querySelectorAll('.nav-tab,.account-btn,.brand-subtitle,.topbar-status>.chip:first-child,.home-news-head h2,.home-news-head p,.home-news-status,.home-news-copy time,.home-news-meta>span,.home-news-copy h3,.home-news-copy p,.home-news-more')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>{
        void el.offsetWidth;
        el.getAnimations().forEach(a=>a.finish());
        const foreground=rgba(getComputedStyle(el).color), layers=[];
        if(el.matches('.nav-tab.active'))layers.unshift(rgba(getComputedStyle(document.querySelector('.nav-glider')).backgroundColor));
        for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n);if(s.backgroundImage.includes('linear-gradient'))layers.unshift([255,255,255,.07]);layers.unshift(rgba(s.backgroundColor));if(n.classList.contains('topbar')||n.classList.contains('home-news'))break;}
        const ratios=[0,255].map(level=>{
          let bg=[level,level,level];for(const layer of layers)bg=over(layer,bg);
          const fg=over(foreground,bg),a=luminance(fg),b=luminance(bg);
          return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        });
        return {label:el.textContent.trim(),ratio:Math.min(...ratios)};
      });
    })()`);
    for (const value of values) {
      minimum = Math.min(minimum, value.ratio);
      assert.ok(value.ratio >= 4.5, `${theme} ${width}px ${pseudoClasses}: ${value.label} contrast ${value.ratio}`);
    }
  }
  await Promise.all(nodes.map(nodeId => send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, session)));
  await evaluate('document.querySelectorAll(".nav-tab,.account-btn").forEach(e=>{void e.offsetWidth;e.getAnimations().forEach(a=>a.finish())})');
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  await writeFile(join(captures, `contrast-${theme}-${width}.png`), Buffer.from(data, 'base64'));
  console.log(`${theme} ${width}px: shell-label contrast >= ${minimum.toFixed(2)}:1 across normal, selected, hover, pressed and focus states`);
}

async function checkNews() {
  await waitFor('document.querySelector(".home-news-list")?.getAttribute("aria-busy")==="false"');
  assert.equal(await evaluate('document.querySelectorAll(".home-news-story").length'), 3, 'Representative GitHub response renders three posts');
  assert.equal(await evaluate(`Promise.all([...document.querySelectorAll('.home-news-story img')].map(i=>i.decode())).then(()=>true)`), true, 'Any supplied Orbit cover images decode');
  assert.equal(await evaluate(`document.querySelector('#home-news-heading').textContent==='Orbit news'&&[...document.querySelectorAll('.home-news-story,.home-news-more')].every(a=>a.href.startsWith('https://github.com/EyeSaberYT/Orbit-Launcher/releases'))`),true,'Only Orbit posts and links are shown');
  const sizes = [[1919, 947], [1440, 900], [1240, 780], [820, 1180], [390, 844]];
  for (const [width, height] of sizes) {
    await evaluate('document.querySelector("#view").scrollTop=0');
    await audit(`news-${width}`, width, height);
    const position = await evaluate(`(()=>{
      const n=document.querySelector('.home-news').getBoundingClientRect(),d=document.querySelector('.home-library').getBoundingClientRect(),i=document.querySelector('.home-intro').getBoundingClientRect();
      return {rail:n.left>=d.right+20&&Math.abs(n.top-d.top)<1,beside:n.left>=i.right+20,stacked:n.top>=d.bottom+15};
    })()`);
    assert.ok(width>1100 ? position.beside : position.stacked, `${width}px: original scenic news placement`);
  }
  await audit('news-phone-lower', 390, 844);
  await evaluate('document.querySelector("#view").scrollTop=0');
  await send('Emulation.setDeviceMetricsOverride', { width: 1919, height: 947, deviceScaleFactor: 1, mobile: false }, session);
  await evaluate('document.documentElement.dataset.theme="light"');
  await audit('news-light', 1919, 947);
  await evaluate('document.documentElement.dataset.theme="dark"');
  const customIcon = await evaluate(`(async()=>{const ui=await import('./js/ui.js');return String(ui.instanceIcon({id:'custom-orbit',name:'Custom Orbit',tags:['orbit-client'],icon:'https://example.com/custom.png'},38)).includes('https://example.com/custom.png')})()`);
  assert.equal(customIcon,true,'A custom managed-instance icon takes precedence over the default mark');
  assert.equal(await evaluate(`(()=>{const image=document.querySelector('.home-news-story img');if(image)image.dispatchEvent(new Event('error'));return document.querySelectorAll('.home-news-story').length===3&&document.querySelector('.home-news-story h3').textContent.length>0})()`), true, 'Absent or broken cover retains readable article');
  const checks = await evaluate(`(async()=>{
    const news=await import('./js/news.js');
    const official=await news.loadNews();
    const post=(name,tag,date,extra={})=>({name,tag_name:tag,published_at:date,html_url:'https://github.com/'+news.NEWS_REPOSITORY+'/releases/tag/'+tag,body:'A published update for the launcher.',draft:false,prerelease:false,...extra});
    const sample=[
      post('Earlier','v1','2026-01-01T12:00:00Z'),
      post('Later','v2','2026-02-01T12:00:00Z',{body:'![cover](https://untrusted.example/image.png)\\nA useful Orbit update.'}),
      post('Duplicate','v2','2026-02-01T12:00:00Z'),
      post('Bad link','bad','2026-02-01T12:00:00Z',{html_url:'javascript:alert(1)'}),
      post('Draft','draft','2026-02-01T12:00:00Z',{draft:true}),
      post('Unpublished','unpublished',null),
      post('Beta','v3-beta','2026-02-01T12:00:00Z',{prerelease:true}),
      post('Announcement','news-2026-03-01','2026-03-01T12:00:00Z',{prerelease:true})
    ];
    const normalized=news.normalizeNews(sample);
    const cover='https://github.com/'+news.NEWS_REPOSITORY+'/releases/download/news-cover/news-cover.png';
    const illustrated=news.normalizeNews([post('Cover','news-cover','2026-02-01T12:00:00Z',{assets:[{name:'news-cover.png',content_type:'image/png',browser_download_url:cover}]})]);
    const originalFetch=window.fetch;
    let requests=0;
    try {
      window.fetch=async()=>{requests++;await new Promise(r=>setTimeout(r,50));throw Error('Isolated offline check')};
      const [offline]=await Promise.all([news.loadNews({force:true}),news.loadNews({force:true}),news.loadNews({force:true})]);
      const cached=await news.loadNews();
      return {safe:normalized.length===3&&normalized[0].title==='Announcement'&&normalized[0].kind==='News'&&normalized.every(x=>x.image===null)&&illustrated[0].image===cover,deduplicated:requests===1,offline:offline.offline&&offline.entries[0].url===official.entries[0].url,cached:cached.fetchedAt===official.fetchedAt};
    } finally {window.fetch=originalFetch;}
  })()`);
  assert.deepEqual(checks, {safe:true,deduplicated:true,offline:true,cached:true}, 'News normalization, cache and offline fallback');
  await evaluate(`window.__newsFetch=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('api.github.com/repos/')){await new Promise(r=>setTimeout(r,100));throw Error('Isolated offline check')}return window.__newsFetch(...args)};document.querySelector('[data-refresh-news]').focus();document.querySelector('[data-refresh-news]').click()`);
  assert.equal(await evaluate('document.activeElement.matches("[data-refresh-news]")'), true, 'Refresh retains keyboard focus during loading');
  await waitFor('document.querySelector(".home-news-status").textContent.startsWith("Offline")');
  assert.equal(await evaluate('document.activeElement.matches("[data-refresh-news]")'), true, 'Refresh retains keyboard focus after loading');
  assert.equal(await evaluate('document.querySelectorAll(".home-news-story").length'), 3, 'Offline keeps cached stories');
  await audit('news-offline', 1919, 947);
  await evaluate(`window.fetch=async(...args)=>String(args[0]).includes('api.github.com/repos/')?new Response('[]',{status:200}):window.__newsFetch(...args);document.querySelector('[data-refresh-news]').click()`);
  await waitFor('document.querySelector(".home-news-empty")?.textContent.includes("No Orbit")');
  await evaluate(`window.fetch=async(...args)=>{if(!String(args[0]).includes('api.github.com/repos/'))return window.__newsFetch(...args);await new Promise(resolve=>window.__releaseNews=resolve);return new Response('[]',{status:200})};document.querySelector('[data-refresh-news]').click()`);
  await waitFor('document.querySelectorAll(".home-news-loading-row").length===3');
  assert.equal(await evaluate(`document.querySelector('.home-news-list').getAttribute('aria-busy')==='true'&&document.querySelector('.home-news-loading').getAttribute('aria-hidden')==='true'&&[...document.querySelectorAll('.home-news-loading-row > span')].every(e=>getComputedStyle(e).animationName==='none')`),true,'Pending news has still, decorative reading rows and a real busy status');
  await audit('news-loading-desktop',1440,900);
  await audit('news-loading-phone-lower',390,844);
  await evaluate('window.__releaseNews();delete window.__releaseNews');
  await waitFor('!!document.querySelector(".home-news-empty")');
  await evaluate(`(async()=>{const news=await import('./js/news.js');localStorage.removeItem('orbit.github-news.'+news.NEWS_REPOSITORY+'.v1');window.fetch=async(...args)=>{if(String(args[0]).includes('api.github.com/repos/'))throw Error('Isolated offline check');return window.__newsFetch(...args)};document.querySelector('[data-refresh-news]').click()})()`);
  await waitFor('!!document.querySelector(".home-news-empty [data-refresh-news]")');
  await audit('news-error', 1919, 947);
  await evaluate('window.fetch=window.__newsFetch;delete window.__newsFetch;document.querySelector(".home-news-empty [data-refresh-news]").click()');
  await waitFor('document.querySelectorAll(".home-news-story").length===3');
  console.log('Orbit GitHub news fixtures: responsive placement, safe links/covers, draft and beta exclusion, announcements, ordering, deduplicated refresh, cache, offline, empty, error and retry passed.');
}

async function checkCaptionContrast(state = 'unavailable') {
  for (const theme of ['dark','light']) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await audit(`scenic-${state}-${theme}`,390,844);
    const style = await evaluate(`(()=>{const title=document.querySelector('#home-heading');const region=document.querySelector('.home-intro');const panel=document.querySelector('.launch-card');const css=getComputedStyle(panel);return {title:title.textContent,headingSize:parseFloat(getComputedStyle(title).fontSize),blur:css.backdropFilter,image:css.backgroundImage,shadow:css.boxShadow,caption:!!region.querySelector(':scope > p'),primary:!!panel.querySelector('[data-launch],[data-retry-data],[data-stop]')}})()`);
    assert.equal(style.title, 'Minecraft.Your way.', 'Original Minecraft heading is restored');
    assert.equal(style.headingSize, 58, 'Original phone heading size is preserved');
    assert.equal(style.caption && style.primary, true, 'Original caption and real launcher action remain present');
    assert.notEqual(style.blur, 'none', 'Original glass material is preserved');
  }
  await evaluate('document.documentElement.dataset.theme="dark"');
}

async function captureMotion(name, width, height) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
  await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await mkdir(captures,{recursive:true});
  const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);
  await writeFile(join(captures,`${name}.png`),Buffer.from(data,'base64'));
}

async function checkBootMotion() {
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},session);
  const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__TAURI__={core:{invoke:()=>new Promise(()=>{})}}'},session);
  await send('Page.navigate',{url:pathToFileURL(join(root,'src/index.html')).href},session);
  await waitFor('document.querySelector(".nav-glider.is-ready") && document.querySelector("[data-boot-stage]").textContent.includes("preferences")');
  const moves=await evaluate(`(async()=>{const arc=document.querySelector('.boot-comet');const before=getComputedStyle(arc).transform;await new Promise(r=>setTimeout(r,100));return {before,after:getComputedStyle(arc).transform,animation:getComputedStyle(arc).animationName,logo:getComputedStyle(document.querySelector('.boot-logo')).animationName};})()`);
  assert.ok(moves.before!==moves.after&&moves.animation==='spin'&&moves.logo==='orbit-star-shimmer','Loading arcs move independently of the star shimmer: '+JSON.stringify(moves));
  const shimmer=await evaluate(`(()=>{
    const logo=document.querySelector('.boot-logo'), animation=logo.getAnimations()[0];
    const duration=animation.effect.getTiming().duration;
    animation.pause();animation.currentTime=duration*.3;
    const before=getComputedStyle(logo).maskPosition, rect=logo.getBoundingClientRect();
    animation.currentTime=duration*.55;
    const after=getComputedStyle(logo).maskPosition, next=logo.getBoundingClientRect();
    animation.currentTime=0;animation.play();
    return {duration,moves:before!==after,stable:rect.x===next.x&&rect.y===next.y&&rect.width===next.width&&rect.height===next.height,wordmark:getComputedStyle(document.querySelector('.brand-name')).animationName};
  })()`);
  assert.ok(shimmer.moves&&shimmer.stable&&shimmer.wordmark==='none','Shimmer sweeps within fixed star bounds and leaves the wordmark still');
  assert.equal(shimmer.duration,3200,'Stronger shimmer repeats every 3200ms');
  await captureMotion('motion-boot-desktop',1440,900);
  await captureMotion('motion-boot-phone',390,844);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Loading treatment fits phone');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},session);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".boot-comet")).animationName'), 'none','Reduced-motion loading remains still');
  assert.equal(await evaluate(`[...document.querySelectorAll('.orbit-mark')].every(el=>getComputedStyle(el).animationName==='none'&&getComputedStyle(el).maskImage==='none')`), true, 'Reduced motion restores fully visible, unanimated stars immediately');
  await captureMotion('motion-boot-reduced',390,844);
  await send('Emulation.setEmulatedMedia',{features:[]},session);
  await waitFor('!!document.querySelector("#home-heading")');
  assert.equal(await evaluate('document.querySelector(".home-state").textContent.includes("Loading")&&!document.querySelector("#boot-loading")'),true,'Slow backend opens usable shell without claiming readiness');
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier},session);
  console.log('Startup motion: real loading, star shimmer, still wordmark, phone fit, reduced motion, and slow-backend escape passed.');
}

async function checkStrongerShimmer() {
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},session);
  for (const theme of ['dark','light']) {
    for (const [width,height] of [[1440,900],[390,844]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const signatures=[];
      for (const [phase,time] of [['rest',0],['shine',736],['end',3200]]) {
        const state=await evaluate(`(async()=>{
          const marks=[...document.querySelectorAll('.orbit-mark')];
          for(const mark of marks){const a=mark.getAnimations()[0];a.pause();a.currentTime=${time};}
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          return marks.map(mark=>{const s=getComputedStyle(mark),r=mark.getBoundingClientRect();return {position:s.maskPosition,mask:s.maskImage,bounds:[r.x,r.y,r.width,r.height],duration:mark.getAnimations()[0].effect.getTiming().duration}});
        })()`);
        signatures.push(state);
        assert.ok(state.every(s=>s.duration===3200&&s.mask.includes('0.55')),'Shared stronger shimmer applies to every default Orbit mark');
        if(phase!=='end') await captureMotion(`strong-shimmer-${theme}-${width}-${phase}`,width,height);
      }
      assert.ok(signatures[0].every((s,i)=>s.position!==signatures[1][i].position),'Sheen moves across the artwork');
      assert.deepEqual(signatures[0].map(s=>s.bounds),signatures[1].map(s=>s.bounds),'Sheen does not change artwork bounds');
      // Both off-artwork positions use the same alpha floor, avoiding a reset flash.
      assert.deepEqual(signatures[0].map(s=>s.mask),signatures[2].map(s=>s.mask),'Repeat endpoints retain the same mask luminance stops');
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},session);
      assert.equal(await evaluate(`[...document.querySelectorAll('.orbit-mark')].every(mark=>getComputedStyle(mark).maskImage==='none'&&mark.getAnimations().length===0)`),true,'Mid-cycle reduced motion restores original artwork');
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},session);
      assert.equal(await evaluate(`[...document.querySelectorAll('.orbit-mark')].every(mark=>mark.getAnimations()[0]?.playState==='running')`),true,'Shimmer resumes without remounting after preference change');
    }
  }
  await evaluate(`document.documentElement.dataset.theme='dark'`);
  console.log('Stronger shimmer: desktop/phone in both themes, fixed artwork bounds, repeat endpoints, runtime reduced-motion changes and resumption passed.');
}

async function checkInteractionMotion() {
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},session);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false},session);
  await evaluate('document.querySelector("#view").scrollTop=0;location.hash="#/library"');
  await waitFor('document.querySelector(".nav-tab.active").dataset.section==="library"&&document.querySelector("[data-list]")');
  await waitFor('Math.abs(document.querySelector(".nav-glider").getBoundingClientRect().left-document.querySelector(".nav-tab.active").getBoundingClientRect().left)<1');
  await evaluate(`(async()=>{const {navigate}=await import('./js/router.js');navigate('/friends');await new Promise(r=>setTimeout(r,20));navigate('/library');await new Promise(r=>setTimeout(r,20));navigate('/');})()`);
  await waitFor('document.querySelector("#home-heading")&&document.querySelector(".nav-tab.active").dataset.section==="home"');
  assert.equal(await evaluate('document.querySelectorAll("h1").length'),1,'Rapid navigation settles on one active view');
  const menuTiming=await evaluate(`(()=>{const b=document.querySelector('[data-switch]');b.focus();b.click();return document.querySelector('.menu').getAnimations()[0]?.effect.getTiming().duration})()`);
  assert.equal(menuTiming,180,'Menu uses the shared transition duration');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},session);
  assert.equal(await evaluate('document.activeElement.matches(".menu-item")'),true,'Menu supports keyboard selection');
  await captureMotion('motion-switcher',1440,900);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},session);
  await waitFor('!document.querySelector(".menu")');
  assert.equal(await evaluate('document.activeElement.matches("[data-switch]")&&document.activeElement.getAttribute("aria-expanded")==="false"'),true,'Menu dismissal returns focus');
  const modalTiming=await evaluate(`(async()=>{const ui=await import('./js/ui.js');window.__motionModal=ui.openModal({title:'Motion check',body:'Dialog feedback check'});return window.__motionModal.root.getAnimations()[0]?.effect.getTiming().duration})()`);
  assert.equal(modalTiming,180,'Dialog uses shared transition duration');
  assert.equal(await evaluate('window.__motionModal.root===document.activeElement'),true,'Dialog opening moves keyboard focus inside');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
  assert.equal(await evaluate('window.__motionModal.root.contains(document.activeElement)'),true,'Tab stays in the active dialog');
  await evaluate('window.__motionModal.close()');
  await waitFor('!document.querySelector(".modal-backdrop")');
  assert.equal(await evaluate('document.activeElement.matches("[data-switch]")'),true,'Dialog close restores focus');
  await evaluate(`(async()=>{(await import('./js/pages/settings.js')).openSettings('general')})()`);
  await waitFor('!!document.querySelector(".settings-pane")');
  assert.equal(await evaluate('document.querySelectorAll("h1").length'),1,'Settings overlay retains one document h1');
  assert.equal(await evaluate(`(()=>{document.querySelector('[data-panel="appearance"]').click();return document.querySelector('.settings-pane').getAnimations()[0]?.effect.getTiming().duration})()`),180,'Settings panel transition is tied to tab selection');
  await evaluate('document.querySelector("[data-close-settings]").click()');
  await waitFor('!document.querySelector(".modal-backdrop")');
  const progress=await evaluate(`(async()=>{
    const store=(await import('./js/store.js')).store;
    store.set('progress',{stage:'assets',label:'Test download',current:25,total:100,filesDone:1,filesTotal:4});
    const fill=document.querySelector('#progress-footer .progress-fill');
    store.set('progress',{stage:'assets',label:'Test download',current:75,total:100,filesDone:3,filesTotal:4});
    const stable=fill===document.querySelector('#progress-footer .progress-fill')&&fill.style.width==='75%'&&document.querySelector('[data-progress-value]').textContent.includes('3/4');
    store.set('progress',null);
    return stable&&document.querySelector('#progress-footer').hidden;
  })()`);
  assert.equal(progress,true,'Download updates keep the fill node and real counts stable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},session);
  assert.equal(await evaluate(`(()=>{document.querySelector('[data-switch]').focus();document.querySelector('[data-switch]').click();return document.querySelector('.menu').getAnimations().length===0&&getComputedStyle(document.querySelector('.nav-glider')).transitionDuration==='0s'})()`),true,'Reduced motion skips spatial effects');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".menu")');
  await send('Emulation.setEmulatedMedia',{features:[]},session);
  console.log('Interaction motion: gliding navigation, rapid route changes, keyboard menus, dialog focus return, Settings tabs, stable progress updates and reduced motion passed.');
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('DOM.enable', {}, session);
  await send('CSS.enable', {}, session);
  await checkBootMotion();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original=window.fetch;
    window.fetch=(input,options)=>String(input).startsWith('https://api.github.com/repos/EyeSaberYT/Orbit-Launcher/releases')
      ?Promise.resolve(new Response(JSON.stringify(${JSON.stringify(representativeNews)}),{status:200,headers:{'Content-Type':'application/json'}}))
      :original(input,options);
    document.addEventListener('DOMContentLoaded',()=>{
      const view=document.querySelector('#view');
      new MutationObserver(()=>{
        const page=view.querySelector('.page');if(!page||page.querySelector('[data-fixture-notice]'))return;
        const place=page.querySelector('.home-footer')||page;if(!place)return;
        const notice=document.createElement('span');notice.dataset.fixtureNotice='';notice.className='small';notice.textContent='Sample data';place.append(notice);
      }).observe(view,{childList:true,subtree:true});
    });
  })();` }, session);
  await send('Page.navigate', { url: pathToFileURL(join(root, 'src/index.html')).href }, session);
  await waitFor('document.querySelector("[data-retry-data]")');
  await checkNews();
  const initialCopyStates = await evaluate(`(async()=>{
    const store=(await import('./js/store.js')).store;
    const previous={loadErrors:store.state.loadErrors,instancesLoaded:store.state.instancesLoaded};
    const read=()=>({subtitle:document.querySelector('.selected-instance p').textContent,status:document.querySelector('.home-state').textContent.trim()});
    try {
      store.set('instancesLoaded',false);
      store.set('loadErrors',{settings:null,instances:null,accounts:null});
      const loading=read();
      store.set('loadErrors',{settings:null,instances:'Test instance failure',accounts:null});
      const failedInstances=read();
      store.set('loadErrors',{settings:'Test settings failure',instances:null,accounts:null});
      return {loading,failedInstances,failedSettings:read()};
    } finally {
      store.set('instancesLoaded',previous.instancesLoaded);
      store.set('loadErrors',previous.loadErrors);
    }
  })()`);
  assert.deepEqual(initialCopyStates, {
    loading:{subtitle:'Waiting for your instance data',status:'Loading launcher data'},
    failedInstances:{subtitle:'Instance data unavailable',status:'Data unavailable'},
    failedSettings:{subtitle:'Instance data unavailable',status:'Data unavailable'},
  }, 'Selected subtitle and status agree for pending and failed initial requests');
  await checkCaptionContrast();
  assert.equal(await evaluate('document.querySelector(".home-state").textContent.trim()'), 'Data unavailable');
  assert.equal(await evaluate('document.querySelector("#home-library-heading span").textContent'), '-');
  await audit('unavailable-desktop', 1440, 900);
  await audit('unavailable-phone', 390, 844);
  for (const theme of ['dark','light']) {
    await checkShellContrast(theme, 1440, 900);
    await checkShellContrast(theme, 390, 844);
  }
  await evaluate('document.documentElement.dataset.theme="dark"');
  await evaluate('document.querySelector("#startup-status [data-dismiss]").click()');
  assert.equal(await evaluate('document.querySelector("#startup-status").hidden'), true);
  await evaluate('document.querySelector("[data-retry-data]").click()');
  await waitFor('!document.querySelector("[data-retry-data]").disabled');
  await audit('unavailable-retry', 960, 640);

  // Test-only native facade. Never included in the delivered frontend or production state.
  const fixture = `(() => {
    window.__checks = { mode:'empty', calls:0, slow:false, opened:[] };
    window.__TAURI__ = { core: { async invoke(command, args) {
      if (window.__checks.slow) await new Promise(r=>setTimeout(r,150));
      if (command==='settings_get' && window.__checks.settingsError) throw Error('Test settings failure');
      if (command==='auth_accounts' && window.__checks.accountsError) throw Error('Test accounts failure');
      if (command==='launch_instance') throw Error('Test launch failure');
      if (command==='settings_get') { window.__checks.calls++; return ${JSON.stringify(representativeSettings)}; }
      if (command==='app_info') return {version:'0.5.11'};
      if (command==='system_open_url') { window.__checks.opened.push(args.url); return null; }
      if (command==='instance_list') {
        if(window.__checks.mode==='error') throw Error('Test connection failure');
        const rows=${JSON.stringify(representativeInstances)};
        (${assertRepresentativeData.toString()})(rows, ${JSON.stringify(representativeSettings)});
        return window.__checks.mode==='empty' ? [] : rows;
      }
      if(command==='orbit_client_status') return {version:'1.21.11'};
      if(command==='modrinth_search') return {hits:[],totalHits:0,offset:0,limit:20};
      return [];
    }},event:{listen:async()=>()=>{}},window:{getCurrentWindow:()=>({isMaximized:async()=>false,onResized:()=>{}})} };
  })();`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fixture }, session);
  await send('Page.reload', {}, session);
  await waitFor('document.querySelector("[data-launch]")');
  await waitFor('document.querySelectorAll(".home-news-story").length===3');
  await evaluate('document.querySelector(".home-news-story").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, session);
  await waitFor('window.__checks.opened.length===1');
  assert.equal(await evaluate('window.__checks.opened[0]===document.querySelector(".home-news-story").href'), true, 'Keyboard article activation uses native browser opener');
  await evaluate('document.querySelector(".home-news-more").click()');
  assert.equal(await evaluate('window.__checks.opened[1]'), 'https://github.com/EyeSaberYT/Orbit-Launcher/releases', 'All updates opens Orbit GitHub releases');
  assert.equal(await evaluate('document.querySelector("#home-library-heading span").textContent'), '0');
  assert.equal(await evaluate('document.querySelector("[data-launch]").textContent.includes("Install & play")'), true);
  assert.equal(await evaluate('!!document.querySelector(".home-library-empty")'), true);
  await audit('empty-desktop', 1440, 900);
  await audit('empty-phone', 390, 844);
  await evaluate(`(async()=>{ window.__checks.mode='ready'; await (await import('./js/actions.js')).refreshLauncherData(); })()`);
  await waitFor('document.querySelectorAll("[data-select]").length===3');
  await checkCaptionContrast('ready');
  assert.equal(await evaluate('document.querySelector("#home-library-heading span").textContent'), '3');
  assert.equal(await evaluate('document.querySelectorAll("[data-asset-id=orbit-smooth-star-logo]").length'), 3, 'Ready managed identity appears in header, selected instance and managed row');
  await checkInteractionMotion();
  await checkStrongerShimmer();
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store.state;console.assert(s.instances.length===3,'Installed count');console.assert(s.instances.reduce((n,i)=>n+i.modCount,0)===46,'Mod total');console.assert(s.instances.reduce((n,i)=>n+i.playTimeSecs,0)===16200,'Play time seconds');})()`);
  await audit('ready-desktop', 1440, 900);
  await audit('ready-tablet', 820, 1180);
  await audit('ready-portrait-tablet', 768, 1024);
  await audit('ready-phone', 390, 844);
  await audit('ready-native-default', 1240, 780);
  await audit('ready-native-minimum', 960, 640);
  await audit('ready-small-desktop', 1024, 768);
  await evaluate('document.querySelector("#view").scrollTop=document.querySelector("#view").scrollHeight');
  await audit('ready-phone-lower', 390, 844);
  const fontStatus = await evaluate(`document.fonts.ready.then(()=>({family:getComputedStyle(document.body).fontFamily,ready:document.fonts.status,checks:[400,500,600,650,700].map(w=>document.fonts.check(w+' 14px "Segoe UI Variable"')),registeredFaces:document.fonts.size}))`);
  console.log('Device-local font checks: '+JSON.stringify(fontStatus)+'; no bundled font claimed.');
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('launching',new Set(['orbit']));})()`);
  assert.equal(await evaluate('document.querySelector("[data-launch]").disabled'), true, 'Preparing action protected');
  await audit('preparing-phone', 390, 844);
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('launching',new Set());s.set('runningCounts',new Map([['orbit',1]]));s.set('running',new Set(['orbit']));})()`);
  assert.equal(await evaluate('!!document.querySelector("[data-stop=orbit]")'), true, 'Running state offers Stop game');
  await audit('running-phone', 390, 844);
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('running',new Set());s.set('runningCounts',new Map());document.querySelector('[data-switch]').focus();document.querySelector('[data-switch]').click();})()`);
  await waitFor('!!document.querySelector(".menu")');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".menu")');
  await evaluate(`(async()=>{const ui=await import('./js/ui.js');ui.toast('Test notification',{duration:0});})()`);
  const dismissSize = await evaluate(`(()=>{const b=document.querySelector('#toasts button');const r=b.getBoundingClientRect();return {width:r.width,height:r.height}})()`);
  assert.ok(dismissSize.width>=44 && dismissSize.height>=44,'Toast dismiss hit target');
  await evaluate('document.querySelector("#toasts button").click()');
  await waitFor('document.querySelector("#toasts").children.length===0');
  await evaluate('document.querySelector("[data-select=survival]").click()');
  assert.equal(await evaluate('document.querySelector(".selected-instance h2").textContent'), 'Survival');
  await evaluate(`(async()=>{window.__checks.slow=true;const a=await import('./js/actions.js');const n=window.__checks.calls;await Promise.all([a.refreshLauncherData(),a.refreshLauncherData(),a.refreshLauncherData()]);console.assert(window.__checks.calls===n+1,'Retry deduplication');window.__checks.mode='error';await a.refreshLauncherData();})()`);
  await waitFor('document.querySelector(".home-state").textContent.includes("Data unavailable")');
  assert.equal(await evaluate('document.querySelector(".selected-instance p").textContent'), 'Instance data unavailable', 'Failed refresh replaces the waiting subtitle');
  assert.equal(await evaluate('document.querySelector("#home-library-heading span").textContent'), '-');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
  await audit('failed-refresh-phone', 390, 844);
  await evaluate('document.querySelector("#view").scrollTop=0;location.hash="#/library"');
  await waitFor('document.querySelector("[data-list]")?.textContent.includes("Instances unavailable")');
  assert.equal(await evaluate('document.querySelector("[data-metrics]").textContent.includes("0")'), false, 'Failed library metrics remain unknown');
  assert.equal(await evaluate('document.querySelectorAll("h1").length'), 1, 'Library retains one h1');
  await evaluate(`window.__checks.mode='ready';document.querySelector('#startup-status [data-retry]').click()`);
  await waitFor('document.querySelector("#startup-status").hidden && !document.querySelector("[data-list]").textContent.includes("Instances unavailable")');
  assert.equal(await evaluate('document.querySelector("[data-count]").textContent'), '3 instances', 'Retry restores real response counts');
  await audit('library-phone',390,844);
  await evaluate(`(()=>{const input=document.querySelector('[data-filter]');input.value='Survival';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  assert.equal(await evaluate('document.querySelector("[data-count]").textContent.includes("1")'),true,'Library search recomputes the visible count');
  await evaluate(`document.querySelector('[data-mode=list]').click()`);
  assert.equal(await evaluate('document.querySelector("[data-mode=list]").getAttribute("aria-pressed")'), 'true','Library layout toggle has selected semantics');
  await audit('library-list-phone',390,844);
  await evaluate(`location.hash='#/discover'`);
  await waitFor('!!document.querySelector(".dc-filter-disclosure")');
  assert.equal(await evaluate('document.querySelector(".dc-filter-disclosure").open'),false,'Phone filters start collapsed');
  await evaluate(`document.querySelector('.dc-filter-disclosure summary').click()`);
  assert.equal(await evaluate('document.querySelector(".dc-filter-disclosure").open'),true,'Native disclosure opens filters');
  await evaluate(`document.querySelector('.dc-filter-disclosure summary').click()`);
  await audit('discover-phone',390,844);
  assert.equal(await evaluate(`(()=>{const tabs=[...document.querySelectorAll('.dc-search .tabs .tab')].map(t=>t.getBoundingClientRect());return tabs.every((t,i)=>!i||t.left>=tabs[i-1].right-1)})()`),true,'Discover type tabs scroll without overlapping labels');
  await evaluate(`location.hash='#/friends'`);
  await waitFor('!!document.querySelector(".friends-side")');
  await audit('friends-phone',390,844);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".friends-chat")).display'), 'none','Phone shows one friends pane at a time');
  await evaluate(`(async()=>{(await import('./js/pages/settings.js')).openSettings('general')})()`);
  await waitFor('!!document.querySelector(".settings-pane")');
  await audit('settings-phone',390,844);
  await evaluate(`document.querySelector('[data-close-settings]').click()`);
  await waitFor('!document.querySelector(".modal-backdrop")');
  // Core-flow honesty: install state, per-instance memory, failed account and settings
  // loads, failed long tasks, and named dialogs. Fixture data only; nothing native runs.
  await evaluate(`location.hash='#/'`);
  await waitFor('!!document.querySelector("[data-select=survival]")');
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('instances',s.state.instances.map(i=>i.id==='survival'?{...i,installed:false,memoryMax:8192}:i));document.querySelector('[data-select=survival]').click();})()`);
  await waitFor('document.querySelector(".home-state").textContent.includes("Ready to install")');
  assert.equal(await evaluate('document.querySelector("[data-launch]").textContent.includes("Install & play")'), true, 'Uninstalled instance offers Install & play, not Ready to play');
  assert.equal(await evaluate('document.querySelector(".home-instance-meta").textContent.includes("8.0 GB configured")'), true, 'Home shows the instance memory, not the default');
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('instances',s.state.instances.map(i=>i.id==='survival'?{...i,installed:true,memoryMax:undefined}:i));})()`);
  await waitFor('document.querySelector(".home-state").textContent.includes("Ready to play")');
  await evaluate(`(async()=>{window.__checks.accountsError=true;await (await import('./js/actions.js')).refreshAccounts();})()`);
  await waitFor('!!document.querySelector("[data-retry-accounts]")');
  assert.equal(await evaluate('!!document.querySelector("[data-signin]")'), false, 'A failed account load is not shown as signed out');
  await audit('accounts-unavailable-phone', 390, 844);
  await audit('accounts-unavailable-tablet', 820, 1180);
  await audit('accounts-unavailable-desktop', 1440, 900);
  await evaluate('document.querySelector("[data-launch]").click()');
  await waitFor('document.querySelector("#toasts").textContent.includes("accounts couldn")');
  assert.equal(await evaluate('!!document.querySelector(".modal-backdrop")'), false, 'Play does not start a new sign-in when accounts failed to load');
  await evaluate(`window.__checks.accountsError=false;document.querySelector('[data-retry-accounts]').click()`);
  await waitFor('!!document.querySelector("[data-signin]")');
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;s.set('progress',{stage:'install',label:'Downloading test files',current:1,total:10,filesDone:0,filesTotal:0,finished:false});})()`);
  await waitFor('!document.querySelector("#progress-footer").hidden');
  await evaluate(`(async()=>{const api=await import('./js/api.js');await api.launch.instance('survival').catch(()=>{});})()`);
  await waitFor('document.querySelector("#progress-footer").hidden');
  await evaluate(`(async()=>{const s=(await import('./js/store.js')).store;window.__checks.settingsError=true;await (await import('./js/actions.js')).loadSettings().catch(()=>{});s.set('settings',null);(await import('./js/pages/settings.js')).openSettings('general');})()`);
  await waitFor('!!document.querySelector("[data-retry-settings]")');
  assert.equal(await evaluate('document.querySelector(".modal[role=dialog]").getAttribute("aria-label")'), 'Settings', 'Settings dialog has an accessible name');
  await evaluate(`window.__checks.settingsError=false;document.querySelector('[data-retry-settings]').click()`);
  await waitFor('!!document.querySelector(".settings-pane")');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".modal-backdrop")');
  await evaluate(`(async()=>{const b=document.querySelector('[data-new]');b.focus();const ui=await import('./js/ui.js');window.__m=ui.openModal({title:'Named dialog',description:'Described'});})()`);
  assert.equal(await evaluate(`(()=>{const d=document.querySelector('.modal[role=dialog]');return document.getElementById(d.getAttribute('aria-labelledby')).textContent+'|'+document.getElementById(d.getAttribute('aria-describedby')).textContent})()`), 'Named dialog|Described', 'Titled dialogs are named by their heading');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor('!document.querySelector(".modal-backdrop")');
  assert.equal(await evaluate('document.activeElement===document.querySelector("[data-new]")'), true, 'Escape returns focus to the opener');
  console.log('Core-flow honesty: install state, instance memory, account/settings load failures, failed-task progress, dialog names and focus return passed.');
  assert.deepEqual(errors, [], 'Browser exceptions and console assertions');
  console.log('Empty, ready, unavailable, recovery, selection, repeated retry and reduced-motion checks passed; test fixtures never launch native processes.');
} finally {
  try { await send('Browser.close'); } catch { browser.kill(); }
  await new Promise((done) => { if(browser.exitCode!==null) done(); else { browser.once('exit',done);setTimeout(done,2000); } });
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'Cleanup stays in the temporary directory');
  assert.ok(basename(profile).startsWith('orbit-repair-'), 'Cleanup targets only this test profile');
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
