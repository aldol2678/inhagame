// CLOSED local candidate. Production Node/Vercel or non-loopback DB targets always return 404.
let candidate;
module.exports = async function handler(req, res) {
  candidate ??= import('../server/income-candidate-http.mjs').then(module => module.createConfiguredIncomeCandidateHandler());
  return (await candidate)(req, res);
};
