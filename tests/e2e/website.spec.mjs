import {test,expect} from '@playwright/test';

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
    await expect(page.locator('[data-download="windowsSetup"]')).toHaveAttribute('href',`${repository}/releases/download/v0.29.0/EarthRadio-Setup-0.29.0-arm64.exe`);
    // Inline prose links use the WCAG inline-target exception; navigation and
    // stand-alone actions must retain generous hit areas at every breakpoint.
    const targets=await page.locator('nav a, .launch, .download-links a, summary').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').map(node=>({text:node.textContent.trim(),height:node.getBoundingClientRect().height})).filter(node=>node.height>0&&node.height<44));
    expect(targets).toEqual([]);
    await page.goto('/__website/privacy');
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
  });
}

test('complete stable release updates every download together; keyboard and direct install anchor work',async({page})=>{
  const version='0.29.1',tag=`v${version}`,base=`${repository}/releases/download/${tag}`;
  const names=[`EarthRadio-Setup-${version}-arm64.exe`,`EarthRadio-Portable-${version}-arm64.exe`,`EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${version}-macOS-x64-unnotarized.dmg`,'SHA256SUMS.txt','INSTALL.md'];
  await page.route(api,route=>route.fulfill({json:{draft:false,prerelease:false,tag_name:tag,html_url:`${repository}/releases/tag/${tag}`,assets:names.map(name=>({name,state:'uploaded',size:100,browser_download_url:`${base}/${name}`}))}}));
  await page.goto('/__website/#iphone-install');
  await expect(page.locator('[data-release-version]')).toHaveText(tag);
  for(const link of await page.locator('[data-download]').all())expect(await link.getAttribute('href')).toContain(`/${tag}/`);
  await expect(page.locator('#iphone-install')).toHaveAttribute('open','');
  await page.goto('/__website/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>location.hash)).toBe('#main');
});
