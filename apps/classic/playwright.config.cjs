const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:'*.spec.cjs',timeout:60000,workers:1,
  reporter:[['list'],['json',{outputFile:'test-results/results.json'}]],
  use:{baseURL:process.env.PREVIEW_URL||'http://127.0.0.1:4173',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:process.env.PREVIEW_URL?undefined:{command:'npm run serve',url:'http://127.0.0.1:4173',reuseExistingServer:true},
  projects:[{name:'desktop-chromium',use:{browserName:'chromium',viewport:{width:1280,height:800}}},
    {name:'mobile-360-chromium',use:{browserName:'chromium',viewport:{width:360,height:740},isMobile:true,hasTouch:true}}]
});
