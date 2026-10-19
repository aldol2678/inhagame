// Reviewed same-origin destinations only. Never derive navigation from user input.
export const LEARNING_ROUTES = Object.freeze({
  learn: '/learn/', campus: '/campus/?lobby=1',
  daily: '/campus/?lobby=1&shortcut=daily-quiz', account: '/?panel=account'
});
export function learningRoute(name) {
  if (!Object.hasOwn(LEARNING_ROUTES, name)) throw Error('UNREVIEWED_DESTINATION');
  return LEARNING_ROUTES[name];
}
export function clearLearningUrl(win) {
  // No OAuth/token/redirect consumption here. The existing account page owns OAuth.
  if (win.location.search || win.location.hash) win.history.replaceState(null, '', learningRoute('learn'));
}
