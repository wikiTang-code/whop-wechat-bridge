import http from 'http';

http.get('http://127.0.0.1:3000/api/zhao-positions', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('✅ zhao-positions API 吐出数据概况:');
      console.log(' - activeCampaignsCount:', json.data?.activeCampaignsCount);
      console.log(' - currentPositions 长度:', json.data?.currentPositions?.length);
      console.log(' - currentPositions 标的列表:', json.data?.currentPositions?.map(p => p.ticker).join(', '));
    } catch (e) {
      console.log('Raw output:', data);
    }
  });
}).on('error', err => console.error('Error:', err.message));
