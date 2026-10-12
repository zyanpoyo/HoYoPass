export async function testConnection() {
  try {
    const resp = await fetch('https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_global', {
      method: 'GET',
      credentials: 'include'
    });
    const data = await resp.json();
    console.log('[Spike Result]', data);
    return data;
  } catch (err) {
    console.error('[Spike Error]', err);
    return { error: err.message };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Spike installed. Run testConnection() in console.');
});
