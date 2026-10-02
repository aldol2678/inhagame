const params = new URLSearchParams(location.search);

if (params.get('p3') === '1') {
  void import('./main');
} else if (params.get('growth') === '1') {
  void import('./home/growth');
} else if (params.get('ranking') === '1') {
  void import('./home/ranking');
} else if (params.get('play') === 'ranking-preview') {
  void import('./p4/main');
} else if (params.get('play') === 'campaign' || params.get('p4') === '1') {
  const stage = Number(params.get('stage'));
  if (params.get('play') === 'campaign' && params.has('stage')
    && ![1, 2, 3, 4, 5, 6].includes(stage)) {
    location.replace('./');
  } else if ((stage === 2 || stage === 3 || stage === 4 || stage === 5 || stage === 6) && params.get('play') === 'campaign') {
    void (async () => {
      const [{ InhaGameAccount }, { getStageStatus }] = await Promise.all([
        import('./account/InhaGameAccount'), import('./home/progress'),
      ]);
      const account = new InhaGameAccount();
      await account.init();
      if (getStageStatus(account.getProgress().campaign, stage) === 'LOCKED') {
        location.replace('./');
        return;
      }
      await import('./p4/main');
    })();
  } else {
    void import('./p4/main');
  }
} else {
  void import('./home/main');
}
