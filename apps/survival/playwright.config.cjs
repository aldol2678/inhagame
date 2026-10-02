const {defineConfig}=require('@playwright/test');
// Fully offline: tests/offline.cjs serves every request from this checkout; DNS is disabled as a backstop.
module.exports=defineConfig({testDir:'./tests',testMatch:'*.spec.cjs',timeout:90000,workers:1,retries:0,
  reporter:[['list']],
  use:{headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',
    viewport:{width:1280,height:800},
    launchOptions:{
      executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH||undefined,
      args:['--host-resolver-rules=MAP * ~NOTFOUND','--use-angle=swiftshader','--enable-unsafe-swiftshader']
    }},
  projects:[{name:'chromium',use:{browserName:'chromium'}}]
});
