import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
import {FALLBACK_RELEASE} from '../../website/release-core.js';
import {normalizePublicRelease} from '../../website/release-core.js';
import {stampReleaseHtml} from '../../scripts/release-metadata.mjs';

const repository='https://github.com/Protonmatter/earth-radio';
const api='https://api.github.com/repos/Protonmatter/earth-radio/releases/latest';
for(const width of [320,390,768,1440]){
  test(`public website stays readable and usable at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route(api,route=>route.abort());
    await page.goto('/__website/');
    await expect(page.getByRole('heading',{level:1})).toHaveText('The worldis on air.');
    await expect(page.getByRole('link',{name:'Open Earth Radio'}).first()).toHaveAttribute('href','https://app.earthradio.stream/');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const image of await page.locator('img').all()){
      if(!await image.isVisible())continue;
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty('complete',true);
      expect(await image.evaluate(node=>node.naturalWidth)).toBeGreaterThan(0);
    }
    await page.getByRole('link',{name:'Installation steps'}).click();
    await expect(page.locator('#iphone-install')).toHaveAttribute('open','');
    await expect(page.getByText('Open as Web App',{exact:true})).toBeVisible();
    await expect(page.locator('[data-download="windowsSetup"]')).toHaveAttribute('href',FALLBACK_RELEASE.downloads.windowsSetup);
    // Inline prose links use the WCAG inline-target exception; navigation and
    // stand-alone actions must retain generous hit areas at every breakpoint.
    const targets=await page.locator('nav a, .launch, .download-links a, summary').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').map(node=>({text:node.textContent.trim(),height:node.getBoundingClientRect().height})).filter(node=>node.height>0&&node.height<44));
    expect(targets).toEqual([]);
    await page.goto('/__website/privacy');
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
  });
}

test('complete stable release updates every download together; keyboard and direct install anchor work',async({page})=>{
  // Keep this synthetic API release newer than the qualified fallback. Older
  // responses are covered separately and must never downgrade download links.
  const [major,minor,patch]=FALLBACK_RELEASE.version.split('.').map(Number);
  const version=`${major}.${minor}.${patch+1}`,tag=`v${version}`,base=`${repository}/releases/download/${tag}`;
  const names=[`EarthRadio-Setup-${version}-arm64.exe`,`EarthRadio-Portable-${version}-arm64.exe`,`EarthRadio-Setup-${version}-x64.exe`,`EarthRadio-Portable-${version}-x64.exe`,`EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${version}-macOS-x64-unnotarized.dmg`,'SHA256SUMS.txt','INSTALL.md'];
  await page.route(api,route=>route.fulfill({json:{draft:false,prerelease:false,tag_name:tag,html_url:`${repository}/releases/tag/${tag}`,assets:names.map(name=>({name,state:'uploaded',size:100,browser_download_url:`${base}/${name}`}))}}));
  await page.goto('/__website/#iphone-install');
  await expect(page.locator('[data-release-version]')).toHaveText(tag);
  await expect(page.locator('[data-download-group="windowsX64"]')).toBeVisible();
  for(const link of await page.locator('[data-download]').all())expect(await link.getAttribute('href')).toContain(`/${tag}/`);
  await expect(page.locator('#iphone-install')).toHaveAttribute('open','');
  await page.goto('/__website/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>location.hash)).toBe('#main');
});

for(const width of [320,1440])for(const prefix of ['','/__website'])test(`branded unknown route at ${prefix||'app'} is usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.route('https://**',route=>route.abort());
  await page.route('**/directory/snapshot',route=>route.fulfill({json:FIXTURE_STATIONS}));
  const response=await page.goto(prefix+'/places/route-fixture-missing');
  expect(response.status()).toBe(404);
  await expect(page.locator('[data-earth-radio-not-found]')).toBeVisible();
  await expect(page.locator('img[alt="Earth Radio"]')).toHaveJSProperty('complete',true);
  expect(await page.locator('img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const home=page.getByRole('link',{name:'Return home'}),box=await home.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');await expect(home).toBeFocused();await page.keyboard.press('Enter');
  if(prefix)await expect(page.getByRole('heading',{level:1})).toHaveText('The worldis on air.');
  else{
    await expect(page.locator('#er-today')).toBeVisible();
    await page.locator('.er-primary-nav [data-er-primary="search"]').click();
    await expect(page.locator('.station-card').first()).toBeVisible();
    await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  }
});

test('without JavaScript the staged download links use the verified published release',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();
  try{
    await page.goto('/__website/');
    await expect(page.locator('[data-release-version]')).toHaveText(FALLBACK_RELEASE.tag);
    for(const link of await page.locator('[data-download]:visible').all())expect(await link.getAttribute('href')).toContain(`/releases/download/${FALLBACK_RELEASE.tag}/`);
  }finally{await context.close();}
});

test('an older cached latest-release API response cannot downgrade the published fallback',async({page})=>{
  const tag='v0.29.1',version='0.29.1',base=`${repository}/releases/download/${tag}`;
  const names=[`EarthRadio-Setup-${version}-arm64.exe`,`EarthRadio-Portable-${version}-arm64.exe`,`EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${version}-macOS-x64-unnotarized.dmg`,'SHA256SUMS.txt','INSTALL.md'];
  await page.route(api,route=>route.fulfill({json:{draft:false,prerelease:false,tag_name:tag,html_url:`${repository}/releases/tag/${tag}`,assets:names.map(name=>({name,state:'uploaded',size:100,browser_download_url:`${base}/${name}`}))}}));
  await page.goto('/__website/');await page.waitForTimeout(200);
  await expect(page.locator('[data-release-version]')).toHaveText(FALLBACK_RELEASE.tag);
  await expect(page.locator('[data-download="windowsSetup"]')).toHaveAttribute('href',FALLBACK_RELEASE.downloads.windowsSetup);
});

test('quoted release links and boolean hidden attributes publish correctly without JavaScript',async({browser})=>{
  const version='0.32.2',tag='v'+version,base=`${repository}/releases/download/${tag}`;
  const names=[`EarthRadio-Setup-${version}-arm64.exe`,`EarthRadio-Portable-${version}-arm64.exe`,`EarthRadio-Setup-${version}-x64.exe`,`EarthRadio-Portable-${version}-x64.exe`,`EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${version}-macOS-x64-unnotarized.dmg`,'INSTALL.md','SHA256SUMS.txt'];
  const release=normalizePublicRelease({tag_name:tag,draft:false,prerelease:false,html_url:`${repository}/releases/tag/${tag}`,assets:names.map(name=>({name,state:'uploaded',size:100,browser_download_url:base+'/'+name}))});
  const links=Object.keys(release.downloads).map(key=>`<a data-download='${key}' href='https://old.example/stale'>${key}</a>`).join('');
  const source=`<strong data-release-version>old</strong><article data-download-group='windowsX64' hidden="">${links}</article><a data-release-install href='#old'>Guide</a><a data-release-checksums href='#old'>Checksums</a><a data-release-page href='#old'>Release</a>`;
  const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();
  try{
    await page.setContent(stampReleaseHtml(source,release));
    await expect(page.locator('[data-download-group]')).toBeVisible();
    for(const [key,url]of Object.entries(release.downloads))await expect(page.locator(`[data-download="${key}"]`)).toHaveAttribute('href',url);
  }finally{await context.close();}
});
