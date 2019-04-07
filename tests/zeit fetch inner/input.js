export async function retried(bail, currentAttempt) {
  let data;
  let res = await fetch(url, { ...opts, headers, agent })
  if (opts.throwOnHTTPError && (res.status < 200 || res.status >= 300)) {
    if (type === 'application/json') {
      data = await res.json()
    }
  } else if (res.status === 204) {
    // Since 204 means no content we return null
    data = null
  } else {
    data = await res.json()
  }
  return data;
}
