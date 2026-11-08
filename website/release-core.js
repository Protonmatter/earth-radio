// Public download metadata only. Never accepts provider credentials or arbitrary links.
const REPOSITORY = 'https://github.com/Protonmatter/earth-radio';
const names = version => ({windowsSetup:`EarthRadio-Setup-${version}-arm64.exe`,windowsPortable:`EarthRadio-Portable-${version}-arm64.exe`,macArm64:`EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,macIntel:`EarthRadio-${version}-macOS-x64-unnotarized.dmg`});
function pinned(tag) {
  const version=tag.slice(1),base=`${REPOSITORY}/releases/download/${tag}`;
  return Object.freeze({tag,version,url:`${REPOSITORY}/releases/tag/${tag}`,checksums:`${base}/SHA256SUMS.txt`,install:`${base}/INSTALL.md`,downloads:Object.freeze(Object.fromEntries(Object.entries(names(version)).map(([key,name])=>[key,`${base}/${name}`])))});
}
export const FALLBACK_RELEASE=pinned('v0.29.0');
export const LATEST_RELEASE_API='https://api.github.com/repos/Protonmatter/earth-radio/releases/latest';
function exactUrl(value,expected) {
  if(typeof value!=='string'||value.length>500)return false;
  try{const url=new URL(value);return !url.username&&!url.password&&!url.search&&!url.hash&&url.href===expected;}catch{return false;}
}
export function normalizePublicRelease(value) {
  if(!value||value.draft!==false||value.prerelease!==false||typeof value.tag_name!=='string'||!/^v(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/.test(value.tag_name)||!Array.isArray(value.assets)||value.assets.length>100)return null;
  const result=pinned(value.tag_name);
  if(!exactUrl(value.html_url,result.url))return null;
  const expected=[...Object.values(names(result.version)),'SHA256SUMS.txt','INSTALL.md'];
  for(const name of expected){
    const matches=value.assets.filter(asset=>asset?.name===name);
    if(matches.length!==1)return null;const asset=matches[0];
    if(asset.state!=='uploaded'||!Number.isSafeInteger(asset.size)||asset.size<1||!exactUrl(asset.browser_download_url,`${REPOSITORY}/releases/download/${result.tag}/${name}`))return null;
  }
  return result;
}
