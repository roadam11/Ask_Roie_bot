const r = require('./evaluation-report.json');
const ids = ['I1','I2','I3','J1','J2','J3','J4'];
for (const id of ids) {
  const s = r.results.find(x => x.id === id);
  if (!s) { console.log(id + ': NOT FOUND'); continue; }
  const failed = s.assertions.filter(a => !a.passed).map(a => a.name).join(', ');
  console.log(id + ': ' + s.status + ' | tokens: ' + s.tokens_used + ' | failed: ' + (failed || 'none'));
  if (s.status !== 'PASS') {
    console.log('  Response: ' + s.response.slice(0, 250));
  }
}
console.log('\nOverall: ' + r.pass + '/' + r.totalScenarios + ' PASS, avg tokens: ' + r.avgTokens);
console.log('\nAll results:');
for (const s of r.results) {
  const failed = s.assertions.filter(a => !a.passed).map(a => a.name).join(', ');
  console.log('  ' + s.id + ': ' + s.status + ' | tok=' + s.tokens_used + (failed ? ' | FAILED: ' + failed : ''));
}
