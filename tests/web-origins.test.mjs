import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {WEB_APP_ORIGINS,isWebAuthOrigin} from '../site/assets/auth-deployment.js';

test('only the owned app and legacy production origin enable web authentication',()=>{
  assert.deepEqual(WEB_APP_ORIGINS,['https://app.earthradio.stream','https://earth-radio.pages.dev']);
  for(const origin of WEB_APP_ORIGINS)assert.equal(isWebAuthOrigin(origin),true);
  for(const origin of ['https://earthradio.stream','https://auth.earthradio.stream','https://www.earthradio.stream','http://app.earthradio.stream','https://app.earthradio.stream:8443','https://app.earthradio.stream.evil.example','https://preview.earth-radio.pages.dev','null',null,{},'https://app.earthradio.stream/'])assert.equal(isWebAuthOrigin(origin),false,String(origin));
});

test('hosted source redirect configuration retains legacy and native returns',async()=>{
  const config=await readFile('supabase/config.toml','utf8');
  assert.match(config,/site_url = "https:\/\/app\.earthradio\.stream"/);
  for(const origin of WEB_APP_ORIGINS){assert.ok(config.includes(`"${origin}"`));assert.ok(config.includes(`"${origin}/"`));}
  assert.ok(config.includes('http://127.0.0.1:*/earth-radio-auth/callback/*'));
  assert.doesNotMatch(config,/https:\/\/\*\.earthradio\.stream/);
});
